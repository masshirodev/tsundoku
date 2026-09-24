import { describe, expect, it } from 'vitest';
import {
	ProgressClock,
	IDLE_CAP_MS,
	chapterCells,
	metaLine,
	pageLabel,
	scrubFill,
	scrubPage,
	settingsLabel,
	spreadOf,
	spreads,
	swipeAction,
	pagesAhead,
	nearEnd,
	stripWindow,
	mouseAction,
	tapAction
} from '$lib/reader/reader';

describe('mouse buttons', () => {
	it('click turns forward and right click back, whichever way the pages run', () => {
		for (const mode of ['ltr', 'rtl'] as const) {
			expect(mouseAction(0, mode)).toBe('next');
			expect(mouseAction(2, mode)).toBe('prev');
			expect(mouseAction(1, mode)).toBe('chrome');
		}
	});

	it('leaves vertical to the touch rules', () => {
		expect(mouseAction(0, 'vertical')).toBeNull();
		expect(mouseAction(2, 'vertical')).toBeNull();
	});
});

describe('tap zones', () => {
	it('turns forward on the left edge in R→L, the right edge in L→R', () => {
		expect(tapAction(50, 800, 'rtl')).toBe('next');
		expect(tapAction(750, 800, 'rtl')).toBe('prev');
		expect(tapAction(50, 800, 'ltr')).toBe('prev');
		expect(tapAction(750, 800, 'ltr')).toBe('next');
	});

	it('gives the whole middle to the controls, edges at 16%', () => {
		expect(tapAction(127, 800, 'rtl')).toBe('next');
		expect(tapAction(129, 800, 'rtl')).toBe('chrome');
		expect(tapAction(400, 800, 'rtl')).toBe('chrome');
		expect(tapAction(672, 800, 'ltr')).toBe('chrome');
	});

	it('never turns on a tap in vertical scroll', () => {
		expect(tapAction(10, 800, 'vertical')).toBe('chrome');
	});
});

describe('swipes', () => {
	it('pulls the next page in from the reading direction', () => {
		expect(swipeAction(120, 5, 'rtl')).toBe('next');
		expect(swipeAction(-120, 5, 'rtl')).toBe('prev');
		expect(swipeAction(-120, 5, 'ltr')).toBe('next');
	});

	it('ignores short, vertical, and scroll-mode drags', () => {
		expect(swipeAction(20, 0, 'rtl')).toBeNull();
		expect(swipeAction(80, 90, 'rtl')).toBeNull();
		expect(swipeAction(200, 0, 'vertical')).toBeNull();
	});
});

describe('spreads', () => {
	const tall = { w: 800, h: 1136 };
	const wide = { w: 1600, h: 1136 };

	it('is one page per screen when off', () => {
		expect(spreads([tall, tall, tall], false)).toEqual([[0], [1], [2]]);
	});

	it('shows the cover alone, then pairs, with a wide page alone', () => {
		expect(spreads([tall, tall, tall, wide, tall, tall], true)).toEqual([[0], [1, 2], [3], [4, 5]]);
	});

	it('shifts the pairing by one when asked', () => {
		expect(spreads([tall, tall, tall, tall], true, true)).toEqual([
			[0, 1],
			[2, 3]
		]);
	});

	it('leaves an odd page alone before a wide one', () => {
		expect(spreads([tall, tall, wide], true)).toEqual([[0], [1], [2]]);
		expect(spreadOf([[0], [1, 2], [3]], 2)).toBe(1);
	});
});

describe('what the chrome says', () => {
	it('labels pages and spreads', () => {
		expect(pageLabel([13], 22)).toBe('P. 14 OF 22');
		expect(pageLabel([13, 14], 22)).toBe('P. 14–15 OF 22');
	});

	it('writes the meta line, NOT SAVED while incognito', () => {
		const base = {
			kind: 'manga' as const,
			entry: 'CH. 41',
			count: 58,
			page: 'P. 14 OF 22',
			single: false
		};
		expect(metaLine({ ...base, incognito: false })).toBe('MANGA · CH. 41 OF 58 · P. 14 OF 22');
		expect(metaLine({ ...base, incognito: true })).toBe(
			'MANGA · CH. 41 OF 58 · P. 14 OF 22 · NOT SAVED'
		);
		expect(metaLine({ ...base, kind: 'doujin', single: true, incognito: false })).toBe(
			'DOUJIN · P. 14 OF 22'
		);
	});

	it('names the settings', () => {
		expect(settingsLabel('rtl', 'screen', false)).toBe('R→L · FIT SCREEN');
		expect(settingsLabel('rtl', 'screen', true)).toBe('R→L · SPREAD · FIT SCREEN');
		expect(settingsLabel('vertical', 'screen', true)).toBe('VERTICAL · FIT WIDTH');
	});

	it('puts the next chapter on the reading side', () => {
		expect(chapterCells('rtl', 'CH. 40', 'CH. 42')).toEqual({
			left: { label: '← CH. 42', to: 'next' },
			right: { label: 'CH. 40 →', to: 'prev' }
		});
		expect(chapterCells('ltr', 'CH. 40', null)).toEqual({
			left: { label: '← CH. 40', to: 'prev' },
			right: null
		});
	});

	it('fills the scrubber from the right in R→L, and reads it back', () => {
		expect(scrubFill(13, 22, 'rtl').left).toBeCloseTo(100 - (14 / 22) * 100);
		expect(scrubFill(13, 22, 'ltr')).toEqual({ left: 0, width: (14 / 22) * 100 });
		expect(scrubPage(0.99, 22, 'rtl')).toBe(0);
		expect(scrubPage(0.99, 22, 'ltr')).toBe(21);
		expect(scrubPage(1, 22, 'ltr')).toBe(21);
	});
});

describe('reading time', () => {
	it('counts the gap since the last event, capped, and not time away', () => {
		const c = new ProgressClock(0);
		expect(c.lap(30_000)).toBe(30_000);
		expect(c.lap(30_000 + 10 * 60_000)).toBe(IDLE_CAP_MS);
		c.resume(10_000_000);
		expect(c.lap(10_005_000)).toBe(5_000);
	});
});

describe("the vertical strip's chapters", () => {
	const ch = (id: number, loaded = false) => ({ id, loaded });
	it('holds the chapter being read and its neighbours, keeping what it had loaded', () => {
		const held = [ch(1, true), ch(2, true), ch(3, true)];
		// Onward into 3: 1 goes, 2 and 3 stay as they were, 4 comes.
		expect(stripWindow(held, ch(3), ch(2), ch(4))).toEqual([ch(2, true), ch(3, true), ch(4)]);
		// Back into 1: 3 goes, 0 comes above.
		expect(stripWindow(held, ch(1), ch(0), ch(2))).toEqual([ch(0), ch(1, true), ch(2, true)]);
	});

	it('has no neighbour where there is none to read', () => {
		expect(stripWindow([], ch(5), null, null)).toEqual([ch(5)]);
	});
});

describe('preloading', () => {
	const groups = [[0], [1, 2], [3], [4], [5]];
	it('fetches the next two screens and the one before, the next first', () => {
		expect(pagesAhead(groups, 1)).toEqual([3, 0, 4]);
		expect(pagesAhead(groups, 0)).toEqual([1, 2, 3]);
		// The last screen: only the one before it, page 4.
		expect(pagesAhead(groups, 4)).toEqual([4]);
	});

	it('reaches for the next chapter in the last two screens', () => {
		expect(nearEnd(groups, 2)).toBe(false);
		expect(nearEnd(groups, 3)).toBe(true);
	});
});
