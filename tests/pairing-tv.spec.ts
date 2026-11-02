import { describe, expect, it } from 'vitest';
import { deviceLabel, isTvApp } from '../src/lib/settings/catalog.ts';
import { CODE_MS, TV_TRIES, TvPairing, pairedLabel, sixDigits } from '../src/lib/server/pairing.ts';

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

	it('is six digits, leading zeros kept', () => {
		for (let i = 0; i < 200; i += 1) expect(sixDigits()).toMatch(/^\d{6}$/);
	});

	it('names a TV a TV in DEVICES, not an Android tablet', () => {
		const ua =
			'Mozilla/5.0 (Linux; Android 9; BRAVIA 4K GB Build/PTT1.190515.001.S52) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/94.0.4606.80 Mobile Safari/537.36 TsundokuTV/1.0.0';
		expect(pairedLabel(ua)).toBe('Android TV · Chrome');
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
		expect(deviceLabel(tv, isTvApp(tv) ? 'tv' : 'desktop')).toBe('Android TV · Chrome');
	});
});
