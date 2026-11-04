import { describe, expect, it } from 'vitest';
import {
	hoverAction,
	ProgressClock,
	IDLE_CAP_MS,
	IDLE_CAPS,
	WatchClock,
	WATCH_LAP_CAP_MS,
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
	WheelTurn,
	WHEEL_PX,
	WHEEL_QUIET_MS,
	wheelForward,
	tapAction,
	TEXT_EDGE,
	shapeOf
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

	it("gives a novel's text wider strips, at 30%", () => {
		expect(tapAction(239, 800, 'ltr', TEXT_EDGE)).toBe('prev');
		expect(tapAction(241, 800, 'ltr', TEXT_EDGE)).toBe('chrome');
		expect(tapAction(561, 800, 'ltr', TEXT_EDGE)).toBe('next');
		expect(tapAction(561, 800, 'rtl', TEXT_EDGE)).toBe('prev');
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

	it('gives text its own cap: a long page of prose is not cut at two minutes (c443)', () => {
		expect(IDLE_CAP_MS).toBe(2 * 60_000);
		const text = new ProgressClock(0, IDLE_CAPS.text);
		expect(text.lap(4 * 60_000)).toBe(4 * 60_000);
		expect(text.lap(4 * 60_000 + 60 * 60_000)).toBe(5 * 60_000);
		// The image reader's clock is unchanged.
		const pages = new ProgressClock(0);
		expect(pages.lap(4 * 60_000)).toBe(2 * 60_000);
	});
});

describe('watching time (c443)', () => {
	/** Plays from `from` seconds for `seconds` at `rate`, a timeupdate every 250 ms of wall time. */
	function play(
		c: WatchClock,
		t: { now: number; pos: number },
		seconds: number,
		opts: { rate?: number; watching?: boolean; advance?: boolean } = {}
	) {
		const rate = opts.rate ?? 1;
		for (let i = 0; i < seconds * 4; i++) {
			t.now += 250;
			if (opts.advance !== false) t.pos += 0.25 * rate;
			c.tick(t.now, t.pos, { rate, watching: opts.watching });
		}
	}

	it('counts what played, and nothing while paused', () => {
		const c = new WatchClock();
		const t = { now: 1_000_000, pos: 0 };
		c.tick(t.now, t.pos);
		play(c, t, 15);
		expect(c.lap()).toBe(15_000);
		// Paused for ten minutes: no timeupdates, and the player stops the clock.
		c.stop();
		t.now += 10 * 60_000;
		c.tick(t.now, t.pos);
		play(c, t, 5);
		expect(c.lap()).toBe(5_000);
	});

	it('a pause the player never reported still counts nothing', () => {
		const c = new WatchClock();
		const t = { now: 0, pos: 100 };
		c.tick(t.now, t.pos);
		t.now += 10 * 60_000;
		t.pos += 0.25;
		c.tick(t.now, t.pos);
		expect(c.lap()).toBe(250);
	});

	it('buffering is not watching: the position stands still while the clock runs', () => {
		const c = new WatchClock();
		const t = { now: 0, pos: 30 };
		c.tick(t.now, t.pos);
		play(c, t, 10, { advance: false });
		expect(c.lap()).toBe(0);
		play(c, t, 3);
		expect(c.lap()).toBe(3_000);
	});

	it('a seek either way is not watching, and counting goes on from where it landed', () => {
		const c = new WatchClock();
		const t = { now: 0, pos: 0 };
		c.tick(t.now, t.pos);
		play(c, t, 4);
		t.now += 250;
		t.pos += 85; // SKIP INTRO
		c.tick(t.now, t.pos);
		play(c, t, 4);
		t.now += 250;
		t.pos -= 30; // back ten, three times
		c.tick(t.now, t.pos);
		play(c, t, 2);
		expect(c.lap()).toBe(10_000);
	});

	it('a hidden document is not watching', () => {
		const c = new WatchClock();
		const t = { now: 0, pos: 0 };
		c.tick(t.now, t.pos);
		play(c, t, 20, { watching: false });
		expect(c.lap()).toBe(0);
		play(c, t, 2);
		expect(c.lap()).toBe(2_000);
	});

	it('faster playback counts the time spent, not the video watched', () => {
		const c = new WatchClock();
		const t = { now: 0, pos: 0 };
		c.tick(t.now, t.pos, { rate: 2 });
		play(c, t, 10, { rate: 2 });
		expect(t.pos).toBe(20);
		expect(c.lap()).toBe(10_000);
	});

	it('a lap is capped where the heartbeat should have been', () => {
		const c = new WatchClock();
		const t = { now: 0, pos: 0 };
		c.tick(t.now, t.pos);
		play(c, t, 5 * 60);
		expect(c.lap()).toBe(WATCH_LAP_CAP_MS);
		expect(c.lap()).toBe(0);
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

describe('the mouse at the edge of the window', () => {
	const h = 900;
	const hidden = { shown: false, byHover: false, overBars: false };
	it('shows the controls at the top or the bottom', () => {
		expect(hoverAction(10, h, hidden)).toBe('show');
		expect(hoverAction(h - 10, h, hidden)).toBe('show');
		expect(hoverAction(h / 2, h, hidden)).toBeNull();
	});
	it('keeps them while the pointer is on the bars, and puts them away after', () => {
		const up = { shown: true, byHover: true, overBars: true };
		expect(hoverAction(120, h, up)).toBeNull();
		expect(hoverAction(h / 2, h, { ...up, overBars: false })).toBe('hide');
	});
	it('brings nothing up over the end page, and puts away what it brought (its own cells sit there)', () => {
		const end = { shown: false, byHover: false, overBars: false, overEnd: true };
		expect(hoverAction(h - 10, h, end)).toBeNull();
		expect(hoverAction(h - 10, h, { ...end, shown: true, byHover: true })).toBe('hide');
		// Opened on purpose (Esc, the middle button), they stay.
		expect(hoverAction(h - 10, h, { ...end, shown: true })).toBeNull();
	});
	it("never hides controls it didn't bring up", () => {
		expect(hoverAction(h / 2, h, { shown: true, byHover: false, overBars: false })).toBeNull();
	});
});

describe('the wheel', () => {
	const ev = (deltaY: number, deltaX = 0, deltaMode = 0) => ({ deltaX, deltaY, deltaMode });

	it('down reads on and up goes back, in both directions', () => {
		for (const mode of ['ltr', 'rtl'] as const) {
			expect(wheelForward(ev(100), mode)).toBe(100);
			expect(wheelForward(ev(-100), mode)).toBe(-100);
		}
	});

	it('sideways is spatial: in R->L a scroll to the left reads on', () => {
		expect(wheelForward(ev(0, 100), 'ltr')).toBe(100);
		expect(wheelForward(ev(0, -100), 'rtl')).toBe(100);
	});

	it('counts lines and pages in pixels, and never turns in scroll', () => {
		expect(wheelForward(ev(3, 0, 1), 'ltr')).toBe(48);
		expect(wheelForward(ev(1, 0, 2), 'ltr')).toBe(800);
		expect(wheelForward(ev(100), 'vertical')).toBe(0);
	});

	it('one gesture turns one page, however long its inertia lasts', () => {
		const w = new WheelTurn();
		expect(w.feed(10, 0)).toBeNull();
		expect(w.feed(35, 16)).toBe('next');
		for (let t = 32; t < 1000; t += 16) expect(w.feed(30, t)).toBeNull();
		// Quiet long enough: the next notch is a new gesture.
		expect(w.feed(-100, 1000 + WHEEL_QUIET_MS)).toBe('prev');
	});

	it('a wheel notch turns at once', () => {
		const w = new WheelTurn();
		expect(w.feed(WHEEL_PX, 0)).toBe('next');
		expect(w.feed(WHEEL_PX, 1000)).toBe('next');
	});
});

describe('shapeOf', () => {
	const known = { w: 800, h: 1200 };
	const unknown = { w: 0, h: 0 };
	const tall = { w: 720, h: 3600 };

	it('keeps a page whose shape the manifest gave', () => {
		expect(shapeOf(known, tall, tall)).toBe(known);
	});

	it('takes the shape the page loaded with, over the last one seen', () => {
		expect(shapeOf(unknown, tall, known)).toBe(tall);
	});

	it('guesses the last shape seen while the page is on its way', () => {
		expect(shapeOf(unknown, null, tall)).toBe(tall);
	});

	it('stays unknown with nothing to go on', () => {
		expect(shapeOf(unknown)).toBe(unknown);
	});
});
