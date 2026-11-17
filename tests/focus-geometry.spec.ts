import { describe, expect, it } from 'vitest';
import {
	SCROLL_SLACK,
	canScroll,
	directionOf,
	isInDirection,
	nextIndex,
	nextInDirection,
	stepInSection,
	type Candidate,
	type Rect
} from '$lib/focus/geometry';

/**
 * Arrow keys move focus by geometry (doc/FOCUS.md). These pin the
 * rules the design draws: the nearest thing that way, the column kept in a
 * grid, no wrap at the end of a row, and an overlapping candidate winning.
 */

function rect(left: number, top: number, right: number, bottom: number): Rect {
	return { left, top, right, bottom };
}

const CELL = { w: 100, h: 150, gap: 10 };

/** A grid cell at a column and row, 0-based, with 10px gaps. */
function cell(col: number, row: number): Rect {
	const left = col * (CELL.w + CELL.gap);
	const top = row * (CELL.h + CELL.gap);
	return rect(left, top, left + CELL.w, top + CELL.h);
}

function labels(rects: Rect[]): Candidate<string>[] {
	return rects.map((r, i) => ({ rect: r, value: `c${i}` }));
}

describe('directionOf', () => {
	it('reads the four arrows and nothing else', () => {
		expect(directionOf('ArrowUp')).toBe('up');
		expect(directionOf('ArrowDown')).toBe('down');
		expect(directionOf('ArrowLeft')).toBe('left');
		expect(directionOf('ArrowRight')).toBe('right');
		expect(directionOf('Tab')).toBeNull();
		expect(directionOf('Enter')).toBeNull();
	});
});

describe('isInDirection', () => {
	it('tests edges, so the next row is not "right"', () => {
		const from = cell(5, 0);
		expect(isInDirection(from, cell(0, 1), 'right')).toBe(false);
		expect(isInDirection(from, cell(5, 1), 'right')).toBe(false);
		// A thing whose left edge starts after the focused right edge is.
		const beyond = rect(from.right + 4, from.top, from.right + 100, from.bottom);
		expect(isInDirection(from, beyond, 'right')).toBe(true);
	});

	it('lets things that touch count as in that direction', () => {
		const from = rect(0, 0, 100, 100);
		expect(isInDirection(from, rect(100, 0, 200, 100), 'right')).toBe(true);
		expect(isInDirection(from, rect(0, 100, 100, 200), 'down')).toBe(true);
	});
});

describe('nextInDirection', () => {
	const grid = [
		cell(0, 0),
		cell(1, 0),
		cell(2, 0),
		cell(3, 0),
		cell(0, 1),
		cell(1, 1),
		cell(2, 1),
		cell(3, 1)
	];

	it('goes right to the next cell in the row', () => {
		expect(nextIndex(cell(1, 0), 'right', labels(grid))).toBe(2);
	});

	it('goes left to the previous cell in the row', () => {
		expect(nextIndex(cell(1, 0), 'left', labels(grid))).toBe(0);
	});

	it('keeps its column going down, even though the next column is as near', () => {
		expect(nextIndex(cell(2, 0), 'down', labels(grid))).toBe(6);
		expect(nextIndex(cell(1, 1), 'up', labels(grid))).toBe(1);
	});

	it('stops at the end of a row rather than wrapping', () => {
		expect(nextIndex(cell(3, 0), 'right', labels(grid))).toBeNull();
		expect(nextIndex(cell(0, 0), 'left', labels(grid))).toBeNull();
		expect(nextIndex(cell(0, 0), 'up', labels(grid))).toBeNull();
	});

	it('lands on the nearest cell of a ragged last row', () => {
		const ragged = [cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0)];
		ragged.push(cell(0, 1), cell(1, 1));
		// Nothing is below column 3; the nearest thing in that row is column 1.
		expect(nextIndex(cell(3, 0), 'down', labels(ragged))).toBe(5);
	});

	it('picks the leftmost of two cells a wide card overlaps', () => {
		// A CONTINUE card spanning two 6-wide columns: both cells overlap it
		// equally, and the design says the last one is under the card's left edge.
		const card = rect(0, 0, 2 * CELL.w + CELL.gap, 120);
		const below = [cell(0, 1), cell(1, 1), cell(2, 1)];
		expect(nextIndex(card, 'down', labels(below))).toBe(0);
	});

	it('prefers the overlapping candidate over a nearer one out of line', () => {
		const from = rect(0, 0, 100, 100);
		const overlapping = rect(0, 110, 100, 210);
		const nearerButAside = rect(150, 102, 250, 202);
		expect(nextIndex(from, 'down', labels([nearerButAside, overlapping]))).toBe(1);
	});

	it('returns null when nothing lies that way', () => {
		const single = [{ rect: rect(0, 0, 100, 100), value: 'only' }];
		for (const direction of ['up', 'down', 'left', 'right'] as const) {
			expect(nextInDirection(rect(0, 0, 100, 100), direction, single)).toBeNull();
		}
	});

	it('still finds a candidate scrolled off the screen', () => {
		const from = rect(0, 0, 100, 100);
		const farBelow = rect(0, 5000, 100, 5100);
		const above = rect(0, -5000, 100, -4900);
		expect(nextInDirection(from, 'down', labels([above, farBelow]))).toBe('c1');
		// And one off-screen the other way is never a candidate.
		expect(nextInDirection(from, 'down', labels([above]))).toBeNull();
	});

	it('ignores a rect with no area', () => {
		const from = rect(0, 0, 100, 100);
		const empty = rect(200, 0, 200, 0);
		const real = rect(300, 0, 400, 100);
		expect(nextIndex(from, 'right', labels([empty, real]))).toBe(1);
	});

	it('ties by DOM order, which is the leftmost then the topmost', () => {
		const from = rect(0, 0, 100, 100);
		const one = rect(0, 200, 100, 300);
		const two = rect(0, 200, 100, 300);
		expect(nextIndex(from, 'down', labels([one, two]))).toBe(0);
	});

	it('lands on the player’s seek bar above a cell, not the far top bar that overlaps it', () => {
		// The player's bar at 960x540: ▶❚❚ is 49–125 and the top bar's ←
		// is 48–113, so it overlaps the cell; the seek bar's line was 126–826,
		// one pixel aside, and the overlap rule sent ↑ to the far link. The line's
		// own box now reaches 106, so the bar is the overlapping, nearer thing.
		const cell = rect(49, 457, 125, 511);
		const top = rect(48, 0, 113, 85);
		const reached = rect(106, 424, 826, 428);
		expect(nextInDirection(cell, 'up', labels([top, reached]))).toBe('c1');
		// The old line: no overlap, so the link that overlaps wins despite the
		// 372 px between them.
		const short = rect(126, 424, 826, 428);
		expect(nextInDirection(cell, 'up', labels([top, short]))).toBe('c0');
		// The same 1 px was why ← left the bar: with the line at 126, ▶❚❚'s
		// right edge (125) was a stop to its left; reaching to 106 leaves the
		// key to the slider itself (data-focus-adjust, or the player's seek).
		expect(nextInDirection(short, 'left', labels([cell]))).toBe('c0');
		expect(nextInDirection(reached, 'left', labels([cell]))).toBeNull();
	});
});

/**
 * c578: which scroller ↑ ↓ move when nothing is that way, on a TV. A scroller
 * at its end in the key's direction is passed over for the next one out.
 */
describe('canScroll', () => {
	const at = (scrollTop: number, clientHeight = 300, scrollHeight = 900) => ({
		scrollTop,
		clientHeight,
		scrollHeight
	});

	it('moves down until its end, and up until its top', () => {
		expect(canScroll(at(0), 'down')).toBe(true);
		expect(canScroll(at(0), 'up')).toBe(false);
		expect(canScroll(at(300), 'down')).toBe(true);
		expect(canScroll(at(300), 'up')).toBe(true);
		expect(canScroll(at(600), 'down')).toBe(false);
		expect(canScroll(at(600), 'up')).toBe(true);
	});

	it('is at its end within a pixel, which rounding leaves (SCROLL_SLACK)', () => {
		expect(SCROLL_SLACK).toBe(1);
		// scrollHeight and clientHeight are rounded integers; scrollTop is not.
		for (const short of [0.2, 0.5, 0.75, 1])
			expect(canScroll(at(600 - short), 'down'), `${short} px short`).toBe(false);
		expect(canScroll(at(600 - 1.5), 'down')).toBe(true);
		for (const off of [0.25, 0.5, 1])
			expect(canScroll(at(off), 'up'), `${off} px down`).toBe(false);
		expect(canScroll(at(1.5), 'up')).toBe(true);
	});

	it('has no end to move toward when there is nothing to scroll', () => {
		for (const d of ['up', 'down'] as const) {
			expect(canScroll(at(0, 300, 300), d)).toBe(false);
			// A pixel of overflow is rounding, not content.
			expect(canScroll(at(0, 300, 301), d)).toBe(false);
		}
		expect(canScroll(at(0, 300, 302), 'down')).toBe(true);
	});
});

describe('stepInSection', () => {
	/** A two-column screen: the panel at x 0 to 100, the list at x 200 to 300. */
	const panel = (top: number, bottom = top + 40) => rect(0, top, 100, bottom);
	const list = (top: number, bottom = top + 40) => rect(200, top, 300, bottom);
	const stops = (...c: [Rect, 'panel' | 'list' | null][]) =>
		c.map(([r, section], i) => ({ rect: r, value: `c${i}`, section }));
	const view = { top: 0, bottom: 400 };
	/** The panel column's own box. */
	const area = rect(0, 0, 100, 400);

	it('keeps ↓ in its own section, however near the other column is', () => {
		const c = stops([panel(100), 'panel'], [list(50), 'list']);
		expect(stepInSection(panel(0), 'down', 'panel', c, null, area)).toEqual({
			kind: 'move',
			value: 'c0'
		});
	});

	it('keeps ↑ in its own section', () => {
		const c = stops([panel(100), 'panel'], [list(250), 'list']);
		expect(stepInSection(panel(300), 'up', 'panel', c, null, area)).toEqual({
			kind: 'move',
			value: 'c0'
		});
	});

	it('at the last stop scrolls while the section can, never the other column', () => {
		const c = stops([list(300), 'list']);
		expect(stepInSection(panel(100), 'down', 'panel', c, view, area)).toEqual({ kind: 'scroll' });
		expect(stepInSection(panel(100), 'up', 'panel', c, view, area)).toEqual({ kind: 'scroll' });
	});

	it('at the section’s real end does nothing, with the other column right there', () => {
		const c = stops([list(300), 'list']);
		expect(stepInSection(panel(100), 'down', 'panel', c, null, area)).toEqual({ kind: 'stay' });
		expect(stepInSection(panel(100), 'up', 'panel', stops([list(0), 'list']), null, area)).toEqual({
			kind: 'stay'
		});
	});

	it('at its real end reaches a thing outside any section, such as the screen’s bar', () => {
		const c = stops([list(0), 'list'], [rect(0, -60, 100, -20), null]);
		expect(stepInSection(panel(0), 'up', 'panel', c, null, area)).toEqual({
			kind: 'move',
			value: 'c1'
		});
	});

	it('looks for the bar from the section’s edge, not from a stop scrolled away', () => {
		const bar = stops([rect(0, -60, 100, -20), null]);
		// DETAILS, scrolled 400 px up the column: the bar is "below" it on the page.
		expect(stepInSection(panel(-400), 'down', 'panel', bar, null, area)).toEqual({ kind: 'stay' });
	});

	it('scrolls before it leaves for the bar', () => {
		const c = stops([rect(0, -60, 100, -20), null]);
		expect(stepInSection(panel(0), 'up', 'panel', c, view, area)).toEqual({ kind: 'scroll' });
	});

	it('scrolls rather than jump over more than the column shows', () => {
		const far = stops([panel(900), 'panel']);
		expect(stepInSection(panel(100), 'down', 'panel', far, view, area)).toEqual({ kind: 'scroll' });
		const above = stops([panel(-500), 'panel']);
		expect(stepInSection(panel(100), 'up', 'panel', above, view, area)).toEqual({ kind: 'scroll' });
	});

	it('goes straight to a stop within one column’s height, either way', () => {
		// next.bottom − view.bottom is exactly the view's height: nothing passes unseen.
		const edge = stops([panel(760), 'panel']);
		expect(stepInSection(panel(100), 'down', 'panel', edge, view, area)).toEqual({
			kind: 'move',
			value: 'c0'
		});
		const up = stops([panel(-400), 'panel']);
		expect(stepInSection(panel(100), 'up', 'panel', up, view, area)).toEqual({
			kind: 'move',
			value: 'c0'
		});
	});

	describe('a stop pinned over the section’s bottom edge (SaveBand)', () => {
		/** A column under a 56 px bar, down to the screen's bottom; its band, pinned over that. */
		const column = rect(0, 84, 100, 540);
		const topBar = rect(0, 0, 100, 56);
		const band = rect(0, 460, 100, 540);
		const row = (top: number) => rect(0, top, 100, top + 56);

		it('is taken by ↓ from a stop above it, though it starts above the section’s edge', () => {
			expect(stepInSection(row(200), 'down', 'panel', stops([band, null]), null, column)).toEqual({
				kind: 'move',
				value: 'c0'
			});
		});

		it('is taken by a stop that ends exactly where it starts', () => {
			expect(stepInSection(row(404), 'down', 'panel', stops([band, null]), null, column)).toEqual({
				kind: 'move',
				value: 'c0'
			});
		});

		it('is not taken by a stop it covers part of, as the ordinary rule would not', () => {
			expect(stepInSection(row(440), 'down', 'panel', stops([band, null]), null, column)).toEqual({
				kind: 'stay'
			});
		});

		it('waits for the section’s own stops, and for its scroller', () => {
			const c = stops([band, null], [row(300), 'panel']);
			expect(stepInSection(row(200), 'down', 'panel', c, null, column)).toEqual({
				kind: 'move',
				value: 'c1'
			});
			const v = { top: 84, bottom: 540 };
			expect(stepInSection(row(200), 'down', 'panel', stops([band, null]), v, column)).toEqual({
				kind: 'scroll'
			});
		});

		it('is still below a stop the column scrolled away above the screen', () => {
			expect(stepInSection(row(-400), 'down', 'panel', stops([band, null]), null, column)).toEqual({
				kind: 'move',
				value: 'c0'
			});
		});

		it('does not make the top bar count as below a stop scrolled away above it', () => {
			expect(
				stepInSection(row(-400), 'down', 'panel', stops([topBar, null]), null, column)
			).toEqual({ kind: 'stay' });
		});

		it('is not above a stop the column scrolled away below the screen', () => {
			expect(stepInSection(row(900), 'up', 'panel', stops([band, null]), null, column)).toEqual({
				kind: 'stay'
			});
		});

		it('never makes another section count, pinned over the edge or not', () => {
			const other = stops([rect(200, 460, 300, 540), 'list'], [rect(0, 460, 100, 540), 'list']);
			expect(stepInSection(row(200), 'down', 'panel', other, null, column)).toEqual({
				kind: 'stay'
			});
		});
	});

	it('goes straight to the stop when the section cannot scroll, however far', () => {
		const far = stops([panel(900), 'panel']);
		expect(stepInSection(panel(100), 'down', 'panel', far, null, area)).toEqual({
			kind: 'move',
			value: 'c0'
		});
	});
});
