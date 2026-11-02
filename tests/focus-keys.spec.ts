import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, isBackKey, isOkKey, isOptionsKey, OkPress } from '$lib/focus/keys';

/**
 * The remote's keys, as decisions (card c235, doc/TV.md): which key is BACK,
 * which is MENU, and what a held OK does that a short one does not. The DOM
 * wiring is tests/tv-keys.e2e.ts; this is the part a browser cannot pin.
 */

describe('the keys', () => {
	it('BACK is Escape and the two names a browser gives the back button', () => {
		expect(isBackKey('Escape')).toBe(true);
		expect(isBackKey('BrowserBack')).toBe(true);
		expect(isBackKey('GoBack')).toBe(true);
		expect(isBackKey('Enter')).toBe(false);
		expect(isBackKey('Backspace')).toBe(false);
	});

	it('MENU is ContextMenu, and nothing else is', () => {
		expect(isOptionsKey('ContextMenu')).toBe(true);
		expect(isOptionsKey('Contextmenu')).toBe(false);
		expect(isOptionsKey('Enter')).toBe(false);
	});

	it('OK is Enter: the D-pad centre arrives as one', () => {
		expect(isOkKey('Enter')).toBe(true);
		expect(isOkKey('NumpadEnter')).toBe(false);
		expect(isOkKey(' ')).toBe(false);
	});
});

describe('OkPress', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const press = () => {
		const hold = vi.fn();
		const click = vi.fn();
		return { hold, click, ok: new OkPress(hold, click) };
	};

	it('a short press is the click its release would have made', () => {
		const { ok, hold, click } = press();
		ok.down(false);
		vi.advanceTimersByTime(HOLD_MS - 50);
		ok.up();
		expect(click).toHaveBeenCalledTimes(1);
		expect(hold).not.toHaveBeenCalled();
	});

	it('held past the hold time opens the options, and the release does not click', () => {
		const { ok, hold, click } = press();
		ok.down(false);
		vi.advanceTimersByTime(HOLD_MS);
		expect(hold).toHaveBeenCalledTimes(1);
		ok.up();
		expect(click).not.toHaveBeenCalled();
	});

	it('a repeat neither opens the sheet twice nor clicks', () => {
		const { ok, hold, click } = press();
		ok.down(false);
		vi.advanceTimersByTime(HOLD_MS);
		ok.down(true);
		ok.down(true);
		vi.advanceTimersByTime(HOLD_MS);
		expect(hold).toHaveBeenCalledTimes(1);
		ok.up();
		expect(click).not.toHaveBeenCalled();
	});

	it('a repeat released quickly does nothing at all', () => {
		const { ok, hold, click } = press();
		ok.down(false);
		ok.down(true);
		ok.up();
		vi.advanceTimersByTime(HOLD_MS);
		expect(hold).not.toHaveBeenCalled();
		expect(click).toHaveBeenCalledTimes(1);
	});

	it('a cancel (the window blurring) touches nothing', () => {
		const { ok, hold, click } = press();
		ok.down(false);
		ok.cancel();
		vi.advanceTimersByTime(HOLD_MS);
		ok.up();
		expect(hold).not.toHaveBeenCalled();
		expect(click).not.toHaveBeenCalled();
	});
});
