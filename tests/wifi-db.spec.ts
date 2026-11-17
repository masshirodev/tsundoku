import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The WI-FI panel's server side (`src/lib/server/wifi.ts`; doc/WIFI.md), on a
 * friend's install as serve.ts runs one in local mode: which routes and
 * actions may make a pairing code, and which only read it.
 *
 * Five wrong tries on `/pair/tv` burn the TV's code, and only someone at the
 * computer makes another: NEW CODE (`fresh`), ON (`fresh`) or opening SETTINGS
 * (`renew`). Neither the panel's 5 s poll nor the per-request check
 * (`tvBlockHere`) may replace a burned code, or anyone on the Wi-Fi would get
 * five more guesses every 5 s while the panel is open.
 */

// A friend's local install, read through `$env/dynamic/private` as the app reads it.
process.env.DATABASE_PATH = ':memory:';
process.env.TSUNDOKU_LOGIN = 'password';
process.env.TSUNDOKU_SERVE = 'local';
vi.mock('$env/dynamic/private', () => ({ env: process.env }));
// SETTINGS' load asks GitHub for a friend's updates: never from a test.
vi.mock('$lib/server/updates', () => ({ checkIfStale: () => {}, updateView: () => null }));

const { CODE_MS, TV_TRIES, TV_USED_SHOWN_MS, pairing, tvPairing } =
	await import('$lib/server/pairing');
const { settingsVisit, tvBlockHere, tvCodeNow, tvPanel, wifiView } =
	await import('$lib/server/wifi');
const api = await import('../src/routes/api/wifi/+server');
const settingsPage = await import('../src/routes/settings/+page.server');
const pairTvPage = await import('../src/routes/pair/tv/+page.server');
const pairTvApi = await import('../src/routes/api/pair/tv/+server');

type LanStatus = import('$lib/server/lan-listen').LanStatus;

/** serve.ts's listeners, as the one object it leaves on `globalThis` (lan-listen.ts). */
let status: LanStatus;
const lan = {
	status: () => status,
	setOn: async (on: boolean) => (status = { ...status, on, listening: on ? status.listening : [] }),
	close: async () => {},
	port: 42143
};
(globalThis as { __tsundokuLan?: unknown }).__tsundokuLan = lan;

const listening = (): LanStatus => ({
	on: true,
	reach: { kind: 'home', address: '192.168.1.23' } as LanStatus['reach'],
	listening: ['192.168.1.23:42143'],
	changed: null,
	error: null,
	firstTime: false
});

// Now, not a fixed instant: the route's own handlers read `Date.now()`.
const T0 = Date.now();
const wrongFor = (code: string) => (code === '000000' ? '111111' : '000000');

/** Five wrong guesses from a TV: the last one burns the code. */
function burnTv(now: number) {
	const c = tvPairing.current()!;
	for (let i = 0; i < TV_TRIES; i += 1) tvPairing.redeem(wrongFor(c.code), now, 'Android TV');
	expect(tvPairing.state(now)).toBe('burned');
	return c.code;
}

/** Bring the TV's code to each state it can be in, as the app itself does. */
const TV_STATES = {
	live: () => tvPairing.current()!.code,
	used: (now: number) => {
		const c = tvPairing.current()!;
		expect(tvPairing.redeem(c.code, now, 'Android TV')).toBe('ok');
		return c.code;
	},
	burned: burnTv,
	expired: () => tvPairing.current()!.code
} as const;
const nowFor = (state: keyof typeof TV_STATES) => (state === 'expired' ? T0 + CODE_MS : T0 + 1000);

beforeEach(() => {
	status = listening();
	pairing.fresh(T0);
	tvPairing.fresh(T0);
});

describe('the per-request check (tvBlockHere)', () => {
	it('leaves a burned code burned, and the same code', () => {
		const code = burnTv(T0 + 1000);
		// Asked by the load, NEW CODE's action and the DEVICES row's refresh, on
		// every request they serve. A friend's install with a panel: no block.
		expect(tvBlockHere({ via: 'local', paired: null })).toBe(false);
		expect(tvBlockHere({ via: 'lan', paired: null })).toBe(false);
		expect(tvPairing.current()!.code).toBe(code);
		expect(tvPairing.state(T0 + 2000)).toBe('burned');
		expect(tvPairing.triesLeft()).toBe(0);
	});
});

describe('the panel’s poll (GET /api/wifi, wifiView() with nothing asked)', () => {
	for (const state of Object.keys(TV_STATES) as (keyof typeof TV_STATES)[])
		it(`reports a ${state} TV code as it is, and keeps it`, () => {
			const now = nowFor(state);
			const code = TV_STATES[state](now);
			const v = wifiView({ now })!;
			expect(v.tv).toMatchObject({ code, state });
			expect(tvPairing.current()!.code).toBe(code);
			expect(tvPairing.state(now)).toBe(state);
		});

	it('reports a burned code with no tries left, poll after poll', async () => {
		const code = burnTv(T0 + 1000);
		for (let i = 0; i < 3; i += 1) {
			const r = await api.GET({ locals: { via: 'local' } } as never);
			const body = (await r.json()) as { tv: { code: string; state: string; left: number } };
			expect(body.tv).toEqual({ code, state: 'burned', minutes: expect.any(Number), left: 0 });
		}
		expect(tvPairing.current()!.code).toBe(code);
		// So /pair/tv still refuses the right code: no one got five more tries.
		expect(tvPairing.redeem(code, Date.now(), 'Android TV')).not.toBe('ok');
	});

	it('leaves an expired phone code, and a phone code used long ago, as they are', () => {
		const phone = pairing.current()!.code;
		expect(wifiView({ now: T0 + CODE_MS })!.code).toMatchObject({ state: 'expired' });
		expect(pairing.current()!.code).toBe(phone);

		pairing.fresh(T0);
		const used = pairing.current()!.code;
		expect(pairing.redeem(used, T0 + 1, 'Android phone · Chrome')).toBe('ok');
		expect(wifiView({ now: T0 + 10 * 60_000 })!.code).toMatchObject({ state: 'used' });
		expect(pairing.current()!.code).toBe(used);
	});

	it('OFF makes no code either', async () => {
		const code = burnTv(T0 + 1000);
		const r = await api.POST({
			locals: { via: 'local' },
			request: new Request('http://localhost/api/wifi', {
				method: 'POST',
				body: JSON.stringify({ action: 'off' })
			})
		} as never);
		expect(((await r.json()) as { on: boolean }).on).toBe(false);
		expect(tvPairing.current()!.code).toBe(code);
		expect(tvPairing.state(Date.now())).toBe('burned');
	});
});

describe('the actions that may make a code', () => {
	it('opening SETTINGS (renew) replaces a spent code and keeps a live or just-used one', () => {
		for (const state of Object.keys(TV_STATES) as (keyof typeof TV_STATES)[]) {
			tvPairing.fresh(T0);
			const now = nowFor(state);
			const code = TV_STATES[state](now);
			const v = wifiView({ renew: true, now })!;
			if (state === 'live' || state === 'used') {
				expect(v.tv, state).toMatchObject({ code, state });
			} else {
				expect(v.tv!.code, state).not.toBe(code);
				expect(v.tv, state).toMatchObject({ state: 'live', left: TV_TRIES });
			}
		}
	});

	it('/pair/tv (renewForTv) waits out ✓ USED exactly as long as opening SETTINGS does', () => {
		// pairing.ts's TV_USED_SHOWN_MS is a copy of this file's USED_SHOWN_MS:
		// held here by behaviour, either side of the boundary, so the two can't drift.
		for (const age of [1, TV_USED_SHOWN_MS - 1, TV_USED_SHOWN_MS, TV_USED_SHOWN_MS + 1, CODE_MS]) {
			const usedAt = T0 + 1000;
			const replaced = (door: () => void) => {
				tvPairing.fresh(T0);
				const code = TV_STATES.used(usedAt);
				door();
				return tvPairing.current()!.code !== code;
			};
			const settings = replaced(() => wifiView({ renew: true, now: usedAt + age }));
			const tv = replaced(() => tvPairing.renewForTv(usedAt + age));
			expect(tv, `used ${age} ms ago`).toBe(settings);
		}
	});

	it('/pair/tv never replaces a burned code, where opening SETTINGS does', () => {
		for (const now of [T0 + 2000, T0 + CODE_MS + 1]) {
			tvPairing.fresh(T0);
			const code = burnTv(T0 + 1000);
			expect(tvPairing.renewForTv(now)).toBe(false);
			expect(tvPairing.current()!.code).toBe(code);
			expect(wifiView({ renew: true, now })!.tv!.code).not.toBe(code);
		}
	});

	it('NEW CODE (fresh) replaces both codes, live ones included', async () => {
		const phone = pairing.current()!.code;
		const tv = tvPairing.current()!.code;
		const r = await api.POST({
			locals: { via: 'local' },
			request: new Request('http://localhost/api/wifi', {
				method: 'POST',
				body: JSON.stringify({ action: 'code' })
			})
		} as never);
		const v = (await r.json()) as { code: { url: string }; tv: { code: string; state: string } };
		expect(pairing.current()!.code).not.toBe(phone);
		expect(tvPairing.current()!.code).not.toBe(tv);
		expect(v.tv).toMatchObject({ code: tvPairing.current()!.code, state: 'live' });
	});

	it('makes nothing while WI-FI has no address a phone opens', () => {
		status = { ...listening(), on: false, listening: [] };
		const code = burnTv(T0 + 1000);
		expect(wifiView({ renew: true, now: T0 + 2000 })!.tv).toBeNull();
		expect(tvPairing.current()!.code).toBe(code);
	});
});

/**
 * A spent code renews only on a real
 * visit to SETTINGS. The load runs for that visit and for every reload of the
 * page's data alike (`invalidateAll()`, an enhanced form, the layout's RESCAN
 * or theme); only the first may replace a code five wrong tries burned.
 */
describe('a real visit to SETTINGS, and a reload of its data', () => {
	it('settingsVisit: a document GET only, over every request the load can run for', () => {
		const seen: string[] = [];
		for (const isDataRequest of [false, true])
			for (const method of ['GET', 'HEAD', 'POST'])
				if (settingsVisit({ isDataRequest, method })) seen.push(`${isDataRequest}:${method}`);
		expect(seen).toEqual(['false:GET']);
	});

	/** SETTINGS' own load, on this friend's install at the computer, as SvelteKit runs it. */
	async function load(isDataRequest: boolean, method = 'GET') {
		const url = new URL('http://localhost/settings');
		return (await settingsPage.load({
			cookies: { get: () => undefined },
			url,
			locals: { via: 'local', paired: null },
			isDataRequest,
			request: new Request(url, { method })
		} as never)) as { wifi: { tv: { code: string; state: string } | null } | null };
	}

	it('a reload of the data leaves a burned code burned; opening the page makes a new one', async () => {
		const code = burnTv(T0 + 1000);
		// Any number of reloads: a setting changed, a phone paired, RESCAN.
		for (let i = 0; i < 3; i += 1) {
			const data = await load(true);
			expect(data.wifi!.tv).toMatchObject({ code, state: 'burned' });
			expect(tvPairing.current()!.code).toBe(code);
		}
		// The load after a form posted without script is the form's, not a visit.
		expect((await load(false, 'POST')).wifi!.tv).toMatchObject({ code, state: 'burned' });
		// A real visit: the page opened, typed or reloaded by the browser.
		const opened = await load(false);
		expect(opened.wifi!.tv!.code).not.toBe(code);
		expect(opened.wifi!.tv).toMatchObject({ state: 'live', left: TV_TRIES });
		expect(tvPairing.current()!.code).toBe(opened.wifi!.tv!.code);
	});

	it('a reload leaves an expired code expired, and a used one used past its 2 minutes', () => {
		// The load's own two calls, with what a reload passes them.
		const code = tvPairing.current()!.code;
		expect(wifiView({ renew: false, now: T0 + CODE_MS })!.tv).toMatchObject({
			code,
			state: 'expired'
		});
		expect(tvPanel({ renew: false, now: T0 + CODE_MS })).toMatchObject({ code, state: 'expired' });
		tvPairing.fresh(T0);
		const used = TV_STATES.used(T0 + 1000);
		const later = T0 + 1000 + TV_USED_SHOWN_MS + 1;
		expect(tvPanel({ renew: false, now: later })).toMatchObject({ code: used, state: 'used' });
		expect(tvPairing.current()!.code).toBe(used);
	});

	it('tvPanel: renew replaces exactly what opening the page does, over every state', () => {
		for (const state of Object.keys(TV_STATES) as (keyof typeof TV_STATES)[]) {
			tvPairing.fresh(T0);
			const now = nowFor(state);
			const code = TV_STATES[state](now);
			const read = tvPanel({ now });
			expect(read, `${state}, nothing asked`).toMatchObject({ code, state });
			expect(tvPairing.current()!.code, `${state}, nothing asked`).toBe(code);
			const opened = tvPanel({ renew: true, now })!;
			// As wifiView({ renew }) above: a live or just-used code kept, a spent one replaced.
			if (state === 'live' || state === 'used')
				expect(opened, state).toMatchObject({ code, state });
			else
				expect(opened, state).toMatchObject({
					code: expect.not.stringMatching(code),
					state: 'live'
				});
		}
	});

	it('?/renew, the page’s own word for a client-side visit, renews as a document visit does', async () => {
		const code = burnTv(T0 + 1000);
		const renew = settingsPage.actions.renew!;
		// Over the Wi-Fi it renews nothing: a phone is shown no code.
		await renew({ locals: { via: 'lan', paired: null } } as never);
		expect(tvPairing.current()!.code).toBe(code);
		expect(tvPairing.state(Date.now())).toBe('burned');
		// At the computer it does.
		await renew({ locals: { via: 'local', paired: null } } as never);
		expect(tvPairing.current()!.code).not.toBe(code);
		expect(tvPairing.state(Date.now())).toBe('live');
		expect(tvPairing.triesLeft()).toBe(TV_TRIES);
	});
});

/**
 * A burned code is burned for good, on both screens. Were `TvPairing.state`
 * to ask the clock first, a burned code's 10 minutes running out would make
 * the DEVICES row's refresh (`tvCodeNow`, `GET /settings/tv`) and the WI-FI
 * panel say EXPIRED and start the row's 5 s poll (`tvPolls`: every state but
 * burned) again, while `/pair/tv` said NO TRIES LEFT by a rule of its own
 * (`shown`). Every reader goes through `state`; this asks each one, either
 * side of the 10 minutes and long after them.
 */
describe('a burned code past its 10 minutes', () => {
	const AT = [T0 + CODE_MS - 1, T0 + CODE_MS, T0 + CODE_MS + 1, T0 + CODE_MS * 6];

	it('reads burned from the computer’s routes, and none of them makes a new one', async () => {
		const code = burnTv(T0 + 1000);
		for (const now of AT) {
			const at = `${now - T0} ms after it was made`;
			// The DEVICES row's refresh: what `GET /settings/tv` answers. Its
			// state is what keys the row's 5 s poll, so `burned` keeps it off.
			expect(tvCodeNow(now), at).toMatchObject({ code, state: 'burned', left: 0 });
			// SETTINGS' load on a reload of its data, and the panel's poll.
			expect(tvPanel({ now }), at).toMatchObject({ code, state: 'burned' });
			expect(wifiView({ now })!.tv, at).toMatchObject({ code, state: 'burned', left: 0 });
			expect(tvPairing.current()!.code, at).toBe(code);
		}
		// The computer's own read, at its real clock.
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			for (const now of AT) {
				vi.setSystemTime(now);
				const r = await pairTvApi.GET({ url: new URL('http://localhost/api/pair/tv') } as never);
				expect(await r.json()).toMatchObject({ code, state: 'burned', left: 0 });
			}
		} finally {
			vi.useRealTimers();
		}
		// A real visit to SETTINGS is still what replaces it.
		expect(wifiView({ renew: true, now: AT.at(-1)! })!.tv).toMatchObject({ state: 'live' });
	});

	it('reads burned from the TV’s page, the one rule both screens share', async () => {
		const code = burnTv(T0 + 1000);
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			for (const now of AT) {
				vi.setSystemTime(now);
				const at = `${now - T0} ms after it was made`;
				const data = (await pairTvPage.load({
					cookies: { get: () => undefined },
					url: new URL('http://localhost/pair/tv'),
					request: new Request('http://localhost/pair/tv')
				} as never)) as { state: string };
				// /pair/tv's load: NO TRIES LEFT, and no code made in its place.
				expect(data.state, at).toBe('burned');
				expect(data.state, at).toBe(tvCodeNow(now)!.state);
				expect(tvPairing.current()!.code, at).toBe(code);
				// PAIR with the right digits: the band says NO TRIES LEFT, not EXPIRED.
				const form = new FormData();
				form.set('code', code);
				const posted = await Promise.resolve(
					pairTvPage.actions.default!({
						request: new Request('http://localhost/pair/tv', { method: 'POST', body: form }),
						cookies: { get: () => undefined, set: () => {} },
						url: new URL('http://localhost/pair/tv')
					} as never)
				).then(
					() => null,
					(e: { location?: string }) => e.location ?? String(e)
				);
				expect(posted, at).toBe('/pair/tv?r=burned');
				expect(tvPairing.current()!.code, at).toBe(code);
			}
		} finally {
			vi.useRealTimers();
		}
	});

	it('an unburned code still expires: four wrong tries, then the clock', () => {
		const c = tvPairing.current()!;
		for (let i = 0; i < TV_TRIES - 1; i += 1)
			expect(tvPairing.redeem(wrongFor(c.code), T0 + 1000, 'Android TV')).toBe('wrong');
		expect(tvCodeNow(T0 + CODE_MS - 1)).toMatchObject({ state: 'live', left: 1 });
		expect(tvCodeNow(T0 + CODE_MS)).toMatchObject({ state: 'expired', left: 1 });
		expect(tvPairing.redeem(c.code, T0 + CODE_MS, 'Android TV')).toBe('expired');
	});
});
