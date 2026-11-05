import { describe, expect, it } from 'vitest';
import { deviceLabel, isTvApp } from '../src/lib/settings/catalog.ts';
import {
	CODE_MS,
	TV_TRIES,
	TV_USED_SHOWN_MS,
	TvPairing,
	addPaired,
	friendPaired,
	pairedLabel,
	sixDigits,
	tailnetDoor,
	tailnetHost,
	tvBlockFor,
	tvDoor
} from '../src/lib/server/pairing.ts';

// Read by getDb() the first time a test reaches the database; the pure cases
// above never open one, and nothing here touches the live library.
process.env.DATABASE_PATH = ':memory:';

/**
 * The TV's typed code (c236; doc/TV.md, "Claims to check"): six digits, one
 * TV, once, ten minutes, and five wrong tries burn it. The clock and the
 * digits are given, as `Pairing`'s are, so every answer the route can give is
 * pinned without a server.
 */
describe('a TV code (doc/TV.md)', () => {
	let n = 0;
	const make = () => new TvPairing(() => `00000${++n}`);

	it('signs one TV in, once, within 10 minutes', () => {
		const p = make();
		expect(p.state(0)).toBe('none');
		// Nothing to type yet: the route can only say the code is gone.
		expect(p.redeem('000001', 0, 'Android TV')).toBe('expired');
		const c = p.fresh(1000);
		expect(p.state(1000)).toBe('live');
		expect(p.redeem('999999', 2000, 'Android TV')).toBe('wrong');
		expect(p.redeem(c.code, 2000, 'Android TV · Chrome')).toBe('ok');
		expect(p.state(2000)).toBe('used');
		expect(p.current()?.used).toEqual({ at: 2000, who: 'Android TV · Chrome' });
		// The same code again, from the same TV or another.
		expect(p.redeem(c.code, 3000, 'Android TV')).toBe('used');
	});

	it('spends a try on each wrong code, and the fifth burns it', () => {
		expect(TV_TRIES).toBe(5);
		const p = make();
		const c = p.fresh(0);
		expect(p.triesLeft()).toBe(TV_TRIES);
		expect(p.redeem('111111', 1, 'tv')).toBe('wrong');
		expect(p.triesLeft()).toBe(TV_TRIES - 1);
		expect(p.state(1)).toBe('live');
		for (let i = 2; i < TV_TRIES; i += 1) expect(p.redeem('111111', i, 'tv')).toBe('wrong');
		expect(p.triesLeft()).toBe(1);
		// The fifth wrong one is not `wrong`: there is nothing left to try.
		expect(p.redeem('111111', 5, 'tv')).toBe('burned');
		expect(p.triesLeft()).toBe(0);
		expect(p.state(5)).toBe('burned');
		// Burned is burned: the right code no longer opens anything.
		expect(p.redeem(c.code, 6, 'tv')).toBe('burned');
		// A new code starts with all five again.
		p.fresh(7);
		expect(p.triesLeft()).toBe(TV_TRIES);
		expect(p.state(7)).toBe('live');
	});

	it('expires unscanned, and a new code replaces the old', () => {
		const p = make();
		const old = p.fresh(1000);
		expect(p.redeem(old.code, CODE_MS + 1000, 'tv')).toBe('expired');
		const next = p.fresh(CODE_MS + 1001);
		expect(p.redeem(old.code, CODE_MS + 1002, 'tv')).toBe('wrong');
		expect(p.redeem(next.code, CODE_MS + 1002, 'tv')).toBe('ok');
	});

	/**
	 * /pair/tv's own door (c246; the owner's (b), 2026-11-04): a TV that is not
	 * paired and has nothing it can type gets a code, except where only the
	 * computer may make one. Every state a code can be in, as the doors reach it.
	 */
	describe('renewForTv (c246)', () => {
		const burn = (p: TvPairing, at: number) => {
			for (let i = 0; i < TV_TRIES; i += 1) p.redeem('999999', at, 'tv');
			expect(p.state(at)).toBe('burned');
		};

		it('makes one where there is none', () => {
			const p = make();
			expect(p.renewForTv(0)).toBe(true);
			expect(p.state(0)).toBe('live');
			expect(p.triesLeft()).toBe(TV_TRIES);
		});

		it('keeps a live code, to its last millisecond', () => {
			const p = make();
			const c = p.fresh(0);
			expect(p.renewForTv(CODE_MS - 1)).toBe(false);
			expect(p.current()).toBe(c);
		});

		it('replaces a code that has merely expired, and the new one pairs', () => {
			const p = make();
			const old = p.fresh(0);
			expect(p.state(CODE_MS)).toBe('expired');
			expect(p.renewForTv(CODE_MS)).toBe(true);
			const next = p.current()!;
			expect(next.code).not.toBe(old.code);
			expect(p.state(CODE_MS)).toBe('live');
			expect(p.redeem(next.code, CODE_MS + 1, 'tv')).toBe('ok');
		});

		it('keeps a burned code burned, and keeps it once its 10 minutes have run out too', () => {
			const p = make();
			const c = p.fresh(0);
			burn(p, 1);
			expect(p.renewForTv(2)).toBe(false);
			// Burned first, then the clock ran out: still burned (c581).
			expect(p.state(CODE_MS)).toBe('burned');
			expect(p.state(CODE_MS * 50)).toBe('burned');
			// And PAIR with the right digits says so too, not THAT CODE EXPIRED.
			expect(p.redeem(c.code, CODE_MS, 'tv')).toBe('burned');
			expect(p.renewForTv(CODE_MS)).toBe(false);
			expect(p.renewForTv(CODE_MS * 50)).toBe(false);
			expect(p.current()).toBe(c);
			expect(p.triesLeft()).toBe(0);
		});

		it('keeps a used code while the computer shows ✓ USED, then replaces it', () => {
			const p = make();
			const c = p.fresh(0);
			expect(p.redeem(c.code, 1000, 'tv')).toBe('ok');
			expect(p.renewForTv(1000 + TV_USED_SHOWN_MS)).toBe(false);
			expect(p.current()).toBe(c);
			expect(p.renewForTv(1001 + TV_USED_SHOWN_MS)).toBe(true);
			expect(p.state(1001 + TV_USED_SHOWN_MS)).toBe('live');
		});

		it('carries the wrong tries over, so only the computer gives five again', () => {
			const p = make();
			p.fresh(0);
			for (let i = 0; i < TV_TRIES - 1; i += 1) expect(p.redeem('999999', 1, 'tv')).toBe('wrong');
			// Expired with one try left: the new code has that one try, not five.
			expect(p.renewForTv(CODE_MS)).toBe(true);
			expect(p.triesLeft()).toBe(1);
			expect(p.redeem('999999', CODE_MS + 1, 'tv')).toBe('burned');
			// And a burned chain stays burned however often the page is opened.
			expect(p.renewForTv(CODE_MS * 3)).toBe(false);
			// The owner's NEW CODE is what gives five again.
			p.fresh(CODE_MS * 3);
			expect(p.triesLeft()).toBe(TV_TRIES);
		});

		it('gives a guesser at most five wrong tries per code the computer makes', () => {
			// Opening /pair/tv every 10 minutes for a day. The careful guesser
			// stops one short of burning each code and waits for the next; the
			// greedy one guesses until told no. Neither gets past five.
			for (const careful of [true, false]) {
				const p = make();
				p.fresh(0);
				let wrong = 0;
				for (let t = 0; t < 24 * 60 * 60_000; t += CODE_MS) {
					p.renewForTv(t);
					let here = 0;
					while (p.state(t) === 'live' && (!careful || here < TV_TRIES - 1)) {
						p.redeem('999999', t, 'tv');
						here += 1;
						wrong += 1;
					}
				}
				expect(wrong, careful ? 'careful' : 'greedy').toBe(TV_TRIES);
			}
		});

		it('holds on its own output: a second call right after makes nothing', () => {
			for (const at of [0, CODE_MS, CODE_MS * 2]) {
				const p = make();
				if (at > 0) p.fresh(0);
				p.renewForTv(at);
				const c = p.current();
				expect(p.renewForTv(at)).toBe(false);
				expect(p.current()).toBe(c);
			}
		});
	});

	it('is six digits, leading zeros kept', () => {
		for (let i = 0; i < 200; i += 1) expect(sixDigits()).toMatch(/^\d{6}$/);
	});

	it('names a TV a TV in DEVICES, not an Android tablet', () => {
		const ua =
			'Mozilla/5.0 (Linux; Android 9; BRAVIA 4K GB Build/PTT1.190515.001.S52) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/94.0.4606.80 Mobile Safari/537.36 TsundokuTV/1.0.0';
		// The app says itself and its version where a browser's name was (c521).
		expect(pairedLabel(ua)).toBe('Android TV · app 1.0.0');
		// The phone's own label is unchanged.
		expect(pairedLabel('Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari Chrome/131')).toBe(
			'Android phone · Chrome'
		);
	});
});

describe("the TV app's user agent (doc/TV-APP.md)", () => {
	const tv =
		'Mozilla/5.0 (Linux; Android 9; BRAVIA 4K GB) AppleWebKit/537.36 Chrome/94.0 Safari/537.36 TsundokuTV/1.0.0';
	const tablet =
		'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

	it('is the one sign a browser is a TV', () => {
		expect(isTvApp(tv)).toBe(true);
		expect(isTvApp(tablet)).toBe(false);
	});

	it('names the row a TV, whatever kind the page said of itself', () => {
		// /api/devices/sync reads the same user agent and stores the row as a TV
		// (c244): the page's own kind is only what its screen can say.
		expect(deviceLabel(tv, isTvApp(tv) ? 'tv' : 'desktop')).toBe('Android TV · app 1.0.0');
	});
});

describe("a TV's cookie on the owner's tailnet (c245; doc/SIGN-IN.md)", () => {
	it('opens only on the instance’s own public host', () => {
		// https mode: tailscale serve's certificate name, and the port serve.ts
		// puts in ORIGIN (443 has none).
		expect(tailnetHost('https://name.ts.net:8443')).toBe('name.ts.net:8443');
		expect(tailnetHost('https://name.ts.net')).toBe('name.ts.net');
		// http mode: the tailnet address itself.
		expect(tailnetHost('http://100.101.102.103:42143')).toBe('100.101.102.103:42143');
		expect(tailnetDoor('https://name.ts.net:8443', 'name.ts.net:8443')).toBe(true);
		expect(tailnetDoor('https://name.ts.net:8443', 'NAME.TS.NET:8443')).toBe(true);
	});

	it('never on a loopback name: the computer itself gains nothing from it', () => {
		for (const origin of ['http://localhost:42143', 'http://127.0.0.1:42143', 'http://[::1]:42143'])
			expect(tailnetHost(origin)).toBeNull();
		expect(tailnetDoor('https://name.ts.net:8443', 'localhost:8443')).toBe(false);
		expect(tailnetDoor('https://name.ts.net:8443', '127.0.0.1:8443')).toBe(false);
		expect(tailnetDoor('https://name.ts.net:8443', '[::1]:8443')).toBe(false);
	});

	it('fails closed: no origin, or another host, is no door at all', () => {
		expect(tailnetHost(undefined)).toBeNull();
		expect(tailnetHost('')).toBeNull();
		expect(tailnetHost('not a url')).toBeNull();
		expect(tailnetDoor(undefined, 'name.ts.net:8443')).toBe(false);
		expect(tailnetDoor('not a url', 'name.ts.net:8443')).toBe(false);
		// The port is part of the door, and another name is another door.
		expect(tailnetDoor('https://name.ts.net:8443', 'name.ts.net')).toBe(false);
		expect(tailnetDoor('https://name.ts.net:8443', 'other.ts.net:8443')).toBe(false);
		expect(tailnetDoor('https://name.ts.net:8443', null)).toBe(false);
	});
});

describe("where the TV's six digits are drawn (c245; doc/WIFI.md)", () => {
	const block = (o: Partial<Parameters<typeof tvBlockFor>[0]> = {}) =>
		tvBlockFor({ hasWifi: false, viaLan: false, paired: false, friend: false, door: true, ...o });

	it('draws on the token install, and on no install whose cookie is refused', () => {
		// The owner's own instance: no WI-FI panel, and the cookie those digits
		// set is a door on its tailnet host.
		expect(block()).toBe(true);
		// A friend's local install has the WI-FI panel to carry them.
		expect(block({ hasWifi: true })).toBe(false);
		// A phone over Wi-Fi, and a device already signed in, never see a code.
		expect(block({ viaLan: true })).toBe(false);
		expect(block({ paired: true })).toBe(false);
		// A friend's install served over the tailnet has no panel -- but its
		// guard reads a paired cookie only over Wi-Fi, so drawing the digits
		// there would pair a TV and land it on /login (the bug c245 removes).
		expect(block({ friend: true })).toBe(false);
		expect(block({ friend: true, hasWifi: true })).toBe(false);
	});

	it('draws nowhere the hook refuses every TV cookie: no ORIGIN, or a loopback one (c264)', () => {
		// The token install with no door: `yarn run dev`, `vite preview` and
		// serve.ts's local mode. A TV paired there would land on /login.
		expect(block({ door: false })).toBe(false);
		// And no other fact brings it back.
		for (const hasWifi of [false, true])
			for (const viaLan of [false, true])
				for (const paired of [false, true])
					for (const friend of [false, true])
						expect(block({ hasWifi, viaLan, paired, friend, door: false })).toBe(false);
	});

	it('has a door exactly where tailnetDoor can open for some host (c264)', () => {
		// The same ORIGIN the hook reads, judged the same way: whatever fails
		// tailnetHost fails here, and the block's door is that answer.
		for (const origin of [
			undefined,
			'',
			'not a url',
			'http://localhost:42143',
			'http://127.0.0.1:42143',
			'http://[::1]:42143'
		]) {
			expect(tvDoor(origin)).toBe(false);
			expect(tailnetDoor(origin, 'localhost:42143')).toBe(false);
		}
		for (const origin of ['https://name.ts.net:8443', 'http://100.101.102.103:42143']) {
			expect(tvDoor(origin)).toBe(true);
			expect(tailnetDoor(origin, new URL(origin).host)).toBe(true);
		}
	});

	it("reads the process's ORIGIN when given none, as the hook does (c264)", () => {
		const kept = process.env.ORIGIN;
		try {
			delete process.env.ORIGIN;
			expect(tvDoor()).toBe(false);
			process.env.ORIGIN = 'http://localhost:42143';
			expect(tvDoor()).toBe(false);
			process.env.ORIGIN = 'https://name.ts.net:8443';
			expect(tvDoor()).toBe(true);
		} finally {
			if (kept === undefined) delete process.env.ORIGIN;
			else process.env.ORIGIN = kept;
		}
	});
});

describe("a friend's paired cookie (c245; doc/SIGN-IN.md)", () => {
	it('signs in only over Wi-Fi, never on a localhost request', () => {
		const token = addPaired({ label: 'Android phone · Chrome', address: '192.168.1.23:42143' });
		// The read stays in the friend branch: off Wi-Fi it is not attempted, so
		// a phone's cookie cannot become this computer's password bypass.
		expect(friendPaired(false, token)).toBeNull();
		expect(friendPaired(true, token)?.address).toBe('192.168.1.23:42143');
	});
});
