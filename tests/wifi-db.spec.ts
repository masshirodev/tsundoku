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

const { CODE_MS, TV_TRIES, pairing, tvPairing } = await import('$lib/server/pairing');
const { tvBlockHere, wifiView } = await import('$lib/server/wifi');
const api = await import('../src/routes/api/wifi/+server');

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
