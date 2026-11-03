import { describe, expect, it } from 'vitest';
import {
	directionOf,
	isInDirection,
	nextIndex,
	nextInDirection,
	type Candidate,
	type Rect
} from '$lib/focus/geometry';

/**
 * Arrow keys move focus by geometry (card c234, doc/FOCUS.md). These pin the
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
		// The player's bar at 960x540 (c296): ▶❚❚ is 49–125 and the top bar's ←
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
