import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The WI-FI panel's server side (`src/lib/server/wifi.ts`; doc/WIFI.md), on a
 * friend's install as serve.ts runs one in local mode: which doors may make a
 * pairing code, and which only read it (c460).
 *
 * Five wrong tries on `/pair/tv` burn the TV's code, and only the owner makes
 * another: NEW CODE (`fresh`), ON (`fresh`) or opening SETTINGS on the
 * computer (`renew`). Before c460 the panel's 5 s poll and the door check
 * (`tvBlockHere`) both replaced a burned code, so anyone on the Wi-Fi got five
 * more guesses every 5 s while the panel was open.
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
const { settingsVisit, tvBlockHere, tvPanel, wifiView } = await import('$lib/server/wifi');
const api = await import('../src/routes/api/wifi/+server');
const settingsPage = await import('../src/routes/settings/+page.server');

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

/** Bring the TV's code to each state it can be in, as the app's own doors do. */
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

describe('the door check (tvBlockHere)', () => {
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

describe('the doors that may make a code', () => {
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

	it('/pair/tv (renewForTv) waits out ✓ USED exactly as long as opening SETTINGS does (c246)', () => {
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

	it('/pair/tv never replaces a burned code, where opening SETTINGS does (c246)', () => {
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
 * c531, the owner's call of 2026-11-04: a spent code renews only on a real
 * visit to SETTINGS. The load runs for that visit and for every reload of the
 * page's data alike (`invalidateAll()`, an enhanced form, the layout's RESCAN
 * or theme); only the first may replace a code five wrong tries burned.
 */
describe('a real visit to SETTINGS, and a reload of its data (c531)', () => {
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
