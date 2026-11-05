import { describe, expect, it } from 'vitest';
import {
	hoverAction,
	ProgressClock,
	IDLE_CAP_MS,
	IDLE_CAPS,
	isWatching,
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
	shapeOf,
	DRAG_PX,
	EDGE_GIVE,
	SWIPE_PX,
	TURN_MS,
	dragGive,
	dragStarts,
	forwardBy
} from '$lib/reader/reader';
import {
	DEFAULT_SETTINGS,
	TEXT_FONTS,
	fontOf,
	settingsLabel as textSettingsLabel,
	TEXT_DIRECTIONS,
	parseTextDirection,
	textDirectionName,
	textFont,
	textMode,
	textSettings
} from '$lib/reader/text';
import { OnePointer } from '$lib/reader/pointer';

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

describe('the slide of a paged turn (c441)', () => {
	it('is the numbers both readers had: 220 ms, 8px before a drag, a quarter at an edge, 40px to turn', () => {
		expect(TURN_MS).toBe(220);
		expect(DRAG_PX).toBe(8);
		expect(EDGE_GIVE).toBe(0.25);
		expect(SWIPE_PX).toBe(40);
	});

	it('follows a press once it has gone 8px, at least as far sideways as down', () => {
		expect(dragStarts(7, 0)).toBe(false);
		expect(dragStarts(8, 0)).toBe(true);
		expect(dragStarts(-8, 0)).toBe(true);
		expect(dragStarts(8, 9)).toBe(false);
		expect(dragStarts(9, 9)).toBe(true);
		expect(dragStarts(0, 40)).toBe(false);
	});

	it('measures a drag towards the next page the way swipeAction turns, in every mode', () => {
		// For every mode, a drag far enough to swipe turns the way forwardBy's sign says.
		for (const mode of ['ltr', 'rtl', 'vertical'] as const)
			for (const dx of [-120, 120]) {
				const f = forwardBy(dx, mode);
				const swipe = swipeAction(dx, 0, mode);
				if (mode === 'vertical') {
					expect(f).toBe(0);
					expect(swipe).toBeNull();
				} else expect(swipe).toBe(f > 0 ? 'next' : 'prev');
			}
		expect(forwardBy(-30, 'ltr')).toBe(30);
		expect(forwardBy(30, 'rtl')).toBe(30);
	});

	it('gives the whole drag where a page lies that way, and a quarter where none does', () => {
		expect(dragGive(40, true, false)).toBe(40);
		expect(dragGive(40, false, true)).toBe(10);
		expect(dragGive(-40, true, false)).toBe(-10);
		expect(dragGive(-40, false, true)).toBe(-40);
		expect(dragGive(0, false, false)).toBe(0);
		// The image reader's old `dx / 4`, to the bit.
		for (const d of [-137, -1, 3, 41, 999]) expect(d * EDGE_GIVE).toBe(d / 4);
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

describe('what counts as watching (c481)', () => {
	const playing = {
		paused: false,
		seeking: false,
		visibility: 'visible' as DocumentVisibilityState,
		pip: false
	};
	it('counts a picture playing on a page in view', () => {
		expect(isWatching(playing)).toBe(true);
	});
	it('does not count a paused picture, even in a floating window', () => {
		expect(isWatching({ ...playing, paused: true })).toBe(false);
		expect(isWatching({ ...playing, paused: true, pip: true })).toBe(false);
	});
	it('does not count a seek, even in a floating window', () => {
		expect(isWatching({ ...playing, seeking: true })).toBe(false);
		expect(isWatching({ ...playing, seeking: true, pip: true })).toBe(false);
	});
	it('does not count a hidden page, unless the picture is in a floating window', () => {
		expect(isWatching({ ...playing, visibility: 'hidden' })).toBe(false);
		expect(isWatching({ ...playing, visibility: 'hidden', pip: true })).toBe(true);
	});
	it('counts a floating window over a page in view as it counts the page', () => {
		expect(isWatching({ ...playing, pip: true })).toBe(true);
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

describe('the text reader’s fonts (c442)', () => {
	it('lists Plex first and OpenDyslexic beside it, each with a stack that keeps JP and KR', () => {
		expect(TEXT_FONTS.map((f) => [f.id, f.name, f.word, f.lazy])).toEqual([
			['serif', 'Plex Serif', 'SERIF', false],
			['sans', 'Plex Sans', 'SANS', false],
			['opendyslexic', 'OpenDyslexic', 'DYSLEXIC', true]
		]);
		// A face with no CJK glyphs falls through to Plex's, never to boxes.
		for (const f of TEXT_FONTS)
			if (f.lazy) expect(f.family).toMatch(/'IBM Plex Sans JP', 'IBM Plex Sans KR'/);
	});

	it('reads a stored FONT this build knows as itself, and anything else as the default', () => {
		for (const f of TEXT_FONTS) expect(textFont(f.id)).toBe(f.id);
		for (const v of ['comic', '', null, undefined, 3, 'SERIF', 'OpenDyslexic'])
			expect(textFont(v)).toBe('serif');
		// It holds on its own output.
		for (const f of TEXT_FONTS) expect(textFont(textFont(f.id))).toBe(f.id);
		expect(fontOf('opendyslexic').name).toBe('OpenDyslexic');
	});

	it('lays the stored settings over the defaults, an old value kept and an unknown one not', () => {
		expect(textSettings(null)).toEqual(DEFAULT_SETTINGS);
		// Saved before c442: still read as saved.
		expect(textSettings({ font: 'sans', size: 21 })).toMatchObject({ font: 'sans', size: 21 });
		// From a newer build: the default font, and the rest kept.
		expect(textSettings({ font: 'literata' as never, theme: 'paper' }).font).toBe('serif');
		expect(textSettings({ font: 'literata' as never, theme: 'paper' }).theme).toBe('paper');
	});

	it('says the font in READING’s cell by its own word', () => {
		const at = (font: (typeof TEXT_FONTS)[number]['id']) =>
			textSettingsLabel({
				layout: 'paged',
				font,
				size: 20,
				theme: 'dark',
				vertical: false,
				furigana: 'all'
			});
		expect(TEXT_FONTS.map((f) => at(f.id))).toEqual([
			'PAGED · SERIF 20 · DARK',
			'PAGED · SANS 20 · DARK',
			'PAGED · DYSLEXIC 20 · DARK'
		]);
	});
});

describe('one finger turns a page (c515)', () => {
	const first = { pointerId: 7, isPrimary: true };
	const second = { pointerId: 8, isPrimary: false };

	it('the primary pointer starts a press, and only its own events are the press’s', () => {
		const one = new OnePointer();
		expect(one.down(first)).toBe('start');
		expect(one.owns(first)).toBe(true);
		expect(one.owns(second)).toBe(false);
		one.end();
		expect(one.owns(first)).toBe(false);
	});

	it('a second finger mid-press cancels it, and neither finger is the press’s afterwards', () => {
		const one = new OnePointer();
		one.down(first);
		expect(one.down(second)).toBe('cancel');
		expect(one.owns(first)).toBe(false);
		expect(one.owns(second)).toBe(false);
		// A third finger, or the second again, starts nothing either.
		expect(one.down({ pointerId: 9, isPrimary: false })).toBe('ignore');
		expect(one.owns({ pointerId: 9 })).toBe(false);
	});

	it('a non-primary pointer with no press under way is ignored', () => {
		expect(new OnePointer().down(second)).toBe('ignore');
	});

	it('a primary pointer always starts afresh, so a lift that never arrived holds nothing up', () => {
		const one = new OnePointer();
		one.down(first);
		// The first press's lift was lost; the next touch is primary again.
		const next = { pointerId: 12, isPrimary: true };
		expect(one.down(next)).toBe('start');
		expect(one.owns(next)).toBe(true);
		expect(one.owns(first)).toBe(false);
	});
});

describe('a novel’s reading direction (c440)', () => {
	const layouts = ['paged', 'scroll'] as const;
	const directions = ['ltr', 'rtl'] as const;

	it('turns the way DIRECTION says in PAGED, and only for horizontal text', () => {
		// Every combination: the domain is twelve cases, all of them asserted.
		const got = layouts.flatMap((layout) =>
			[false, true].flatMap((vertical) =>
				[undefined, ...directions].map(
					(d) => `${layout} ${vertical} ${d}: ${textMode(layout, vertical, d)}`
				)
			)
		);
		expect(got).toEqual([
			'paged false undefined: ltr',
			'paged false ltr: ltr',
			'paged false rtl: rtl',
			'paged true undefined: rtl',
			'paged true ltr: rtl',
			'paged true rtl: rtl',
			'scroll false undefined: vertical',
			'scroll false ltr: vertical',
			'scroll false rtl: vertical',
			'scroll true undefined: vertical',
			'scroll true ltr: vertical',
			'scroll true rtl: vertical'
		]);
	});

	it('reads only L→R and R→L, and holds on its own output', () => {
		for (const [d] of TEXT_DIRECTIONS) expect(parseTextDirection(parseTextDirection(d))).toBe(d);
		for (const bad of ['vertical', 'paged', 'scroll', 'RTL', '', null, undefined, 1])
			expect(parseTextDirection(bad)).toBeNull();
		expect(TEXT_DIRECTIONS.map(([d]) => textDirectionName(d))).toEqual(['L→R', 'R→L']);
	});

	it('says R→L in READING’s cell only when PAGED turns that way', () => {
		const label = (layout: 'paged' | 'scroll', direction: 'ltr' | 'rtl', vertical = false) =>
			textSettingsLabel({
				layout,
				font: 'serif',
				size: 20,
				theme: 'dark',
				vertical,
				furigana: 'all',
				direction
			});
		expect(label('paged', 'ltr')).toBe('PAGED · SERIF 20 · DARK');
		expect(label('paged', 'rtl')).toBe('PAGED R→L · SERIF 20 · DARK');
		expect(label('scroll', 'rtl')).toBe('SCROLL · SERIF 20 · DARK');
		expect(label('paged', 'rtl', true)).toBe('VERTICAL · SANS JP 20 · FURIGANA ALL');
	});
});
