import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	arrowKept,
	HOLD_MS,
	isBackKey,
	isOkKey,
	isOptionsKey,
	OkPress,
	sliderKeeps,
	type SliderShape
} from '$lib/focus/keys';
import type { Direction } from '$lib/focus/geometry';

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

	it('a held key sent as fresh keydowns still opens the options once (Android TV)', () => {
		const { ok, hold, click } = press();
		ok.down(false);
		for (let t = 0; t < HOLD_MS + 200; t += 50) {
			vi.advanceTimersByTime(50);
			ok.down(false);
		}
		expect(hold).toHaveBeenCalledTimes(1);
		ok.up();
		expect(click).not.toHaveBeenCalled();
		expect(ok.armed).toBe(false);
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

/**
 * A slider is a slider without being told (c259; doc/FOCUS.md, "Within it"):
 * the arrows along its axis are its own, the others leave. Every shape, every
 * direction, so a shape added later cannot fall between two cases.
 */
describe('the arrows a slider keeps', () => {
	const DIRECTIONS: Direction[] = ['left', 'right', 'up', 'down'];
	const plain: SliderShape = { adjust: null, slider: false, range: false, orientation: null };
	const kept = (shape: Partial<SliderShape>) =>
		DIRECTIONS.filter((d) => sliderKeeps({ ...plain, ...shape }, d));

	it('a role="slider" keeps ← → and lets ↑ ↓ leave, with no attribute', () => {
		expect(kept({ slider: true })).toEqual(['left', 'right']);
		expect(kept({ slider: true, orientation: 'horizontal' })).toEqual(['left', 'right']);
	});

	it('a native range does the same (it kept all four before c259, a trap on a remote)', () => {
		expect(kept({ range: true })).toEqual(['left', 'right']);
	});

	it('a vertical slider keeps ↑ ↓ and lets ← → leave: the arrows along its axis', () => {
		expect(kept({ slider: true, orientation: 'vertical' })).toEqual(['up', 'down']);
		expect(kept({ range: true, orientation: 'vertical' })).toEqual(['up', 'down']);
	});

	it('data-focus-adjust on a slider still says ← →, as before c259', () => {
		expect(kept({ slider: true, adjust: '' })).toEqual(['left', 'right']);
		// It wins over the axis: the attribute was always "← → are mine".
		expect(kept({ slider: true, adjust: '', orientation: 'vertical' })).toEqual(['left', 'right']);
	});

	it("data-focus-adjust on a thing that is not a slider (the TV rating's buttons) keeps ← →", () => {
		expect(kept({ adjust: '' })).toEqual(['left', 'right']);
	});

	it('data-focus-adjust="none" is the way out: a slider that must not adjust lets all four go', () => {
		expect(kept({ slider: true, adjust: 'none' })).toEqual([]);
		expect(kept({ range: true, adjust: 'none' })).toEqual([]);
		expect(kept({ slider: true, adjust: 'none', orientation: 'vertical' })).toEqual([]);
		expect(kept({ adjust: 'none' })).toEqual([]);
	});

	it('anything else keeps nothing', () => {
		expect(kept({})).toEqual([]);
		expect(kept({ orientation: 'vertical' })).toEqual([]);
	});

	describe('from the focused thing outward', () => {
		const at = (chain: Partial<SliderShape>[]) =>
			DIRECTIONS.map((d) =>
				arrowKept(
					chain.map((c) => ({ ...plain, ...c })),
					d
				)
			);

		it('a page with no slider leaves the arrows to the text-entry rules', () => {
			expect(at([{}, {}, {}])).toEqual([null, null, null, null]);
			expect(at([])).toEqual([null, null, null, null]);
		});

		it('a button inside an adjusting row is the row: ← → kept, ↑ ↓ leave', () => {
			expect(at([{}, { adjust: '' }, {}])).toEqual([true, true, false, false]);
		});

		it('a slider inside an adjusting row is its own slider, the nearest deciding', () => {
			expect(at([{ slider: true, orientation: 'vertical' }, { adjust: '' }])).toEqual([
				false,
				false,
				true,
				true
			]);
			expect(at([{ slider: true, adjust: 'none' }, { adjust: '' }])).toEqual([
				false,
				false,
				false,
				false
			]);
		});

		it('the thumb inside a slider is the slider', () => {
			expect(at([{}, { slider: true }, {}])).toEqual([true, true, false, false]);
		});
	});
});
