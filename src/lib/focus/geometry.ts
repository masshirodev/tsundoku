/**
 * Where an arrow key sends focus: the pure half of the focus layer
 * (doc/FOCUS.md). No DOM, no Svelte, so it is unit-tested against rectangles
 * alone.
 *
 * The rule is geometric, because a D-pad is: the nearest focusable thing that
 * way. "That way" is an edge test -- a candidate to the right starts at or
 * after the focused thing's right edge -- so an arrow never wraps to the next
 * row the way Tab does. Among the candidates that way, one that overlaps the
 * focused thing on the other axis wins (in a grid, the column is kept); then
 * the nearer one; then the one with the most overlap; then the first in the
 * DOM, which for a grid is the leftmost of a tie.
 */

export type Rect = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

export type Direction = 'up' | 'down' | 'left' | 'right';

export type Candidate<T> = {
	rect: Rect;
	value: T;
};

/** The arrow keys the remote sends, as directions. */
const DIRECTIONS: Record<string, Direction> = {
	ArrowUp: 'up',
	ArrowDown: 'down',
	ArrowLeft: 'left',
	ArrowRight: 'right'
};

export function directionOf(key: string): Direction | null {
	return DIRECTIONS[key] ?? null;
}

/** Rects that touch count as being in that direction: the layout's 1px gaps. */
const EPSILON = 0.5;

/**
 * Whether `to` lies in `direction` from `from`. The comparison is by edges, not
 * centres: a thing that starts left of the focused thing's left edge is not
 * "to the right" even if its centre is. That is what stops → at the end of a
 * row from jumping to the row below.
 */
export function isInDirection(from: Rect, to: Rect, direction: Direction): boolean {
	switch (direction) {
		case 'right':
			return to.left >= from.right - EPSILON;
		case 'left':
			return to.right <= from.left + EPSILON;
		case 'down':
			return to.top >= from.bottom - EPSILON;
		case 'up':
			return to.bottom <= from.top + EPSILON;
	}
}

/** The gap along the way, which is what "nearest" means. */
function primaryGap(from: Rect, to: Rect, direction: Direction): number {
	switch (direction) {
		case 'right':
			return Math.max(0, to.left - from.right);
		case 'left':
			return Math.max(0, from.left - to.right);
		case 'down':
			return Math.max(0, to.top - from.bottom);
		case 'up':
			return Math.max(0, from.top - to.bottom);
	}
}

/** How much the candidate overlaps the focused thing across the way. */
function crossOverlap(from: Rect, to: Rect, direction: Direction): number {
	const [aLow, aHigh, bLow, bHigh] =
		direction === 'left' || direction === 'right'
			? [from.top, from.bottom, to.top, to.bottom]
			: [from.left, from.right, to.left, to.right];
	return Math.max(0, Math.min(aHigh, bHigh) - Math.max(aLow, bLow));
}

/** The distance across the way, zero when they overlap. */
function crossGap(from: Rect, to: Rect, direction: Direction): number {
	const [aLow, aHigh, bLow, bHigh] =
		direction === 'left' || direction === 'right'
			? [from.top, from.bottom, to.top, to.bottom]
			: [from.left, from.right, to.left, to.right];
	if (bHigh <= aLow) return aLow - bHigh;
	if (bLow >= aHigh) return bLow - aHigh;
	return 0;
}

/**
 * The index of the next candidate in `direction`, or null when nothing lies
 * that way. An off-screen candidate is still a candidate: the layer scrolls it
 * into view once it is focused. Only its geometry matters.
 */
export function nextIndex<T>(
	from: Rect,
	direction: Direction,
	candidates: readonly Candidate<T>[]
): number | null {
	let best = -1;
	let bestRank: [number, number, number, number, number] | null = null;

	for (let i = 0; i < candidates.length; i++) {
		const { rect } = candidates[i];
		if (rect.left === rect.right && rect.top === rect.bottom) continue;
		if (!isInDirection(from, rect, direction)) continue;

		const overlap = crossOverlap(from, rect, direction);
		const rank: [number, number, number, number, number] = [
			// An overlap wins over a nearer thing that is out of line: ↓ in a
			// grid keeps its column rather than sliding to the next one.
			overlap > 0 ? 0 : 1,
			primaryGap(from, rect, direction),
			crossGap(from, rect, direction),
			-overlap,
			i
		];
		if (!bestRank || compare(rank, bestRank) < 0) {
			bestRank = rank;
			best = i;
		}
	}

	return best === -1 ? null : best;
}

function compare(a: readonly number[], b: readonly number[]): number {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
	return 0;
}

/** `nextIndex` for callers holding values: the chosen value, or null. */
export function nextInDirection<T>(
	from: Rect,
	direction: Direction,
	candidates: readonly Candidate<T>[]
): T | null {
	const index = nextIndex(from, direction, candidates);
	return index === null ? null : candidates[index].value;
}

/** What a scroller says about itself: `Element`'s own three numbers. */
export type ScrollMetrics = {
	scrollTop: number;
	clientHeight: number;
	scrollHeight: number;
};

/**
 * How far from an end a scroller still counts as at it. `scrollHeight` and
 * `clientHeight` are integers each rounded from a fractional layout, while
 * `scrollTop` is not, so at its very end a scroller's `scrollTop +
 * clientHeight` can fall short of `scrollHeight` by up to a pixel (MDN's own
 * test for "at the bottom" allows 1). The rects' `EPSILON` (half a pixel)
 * would call such a scroller movable, and ↓ would go to a scroller that
 * cannot move: the very bug c578 is.
 */
export const SCROLL_SLACK = 1;

/**
 * Whether a vertical scroller can still move `direction` (c578): what
 * `stepScroll` asks of each ancestor, so ↑ ↓ chain past a scroller at its end
 * to the next one out, and finally the page, as the browser's own arrow
 * scroll does. One with nothing to scroll is at both ends.
 */
export function canScroll(m: ScrollMetrics, direction: 'up' | 'down'): boolean {
	if (direction === 'up') return m.scrollTop > SCROLL_SLACK;
	return m.scrollTop + m.clientHeight < m.scrollHeight - SCROLL_SLACK;
}
