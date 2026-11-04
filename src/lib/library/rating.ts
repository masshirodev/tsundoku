import type { Rating } from './types.ts';

/**
 * Ratings out of 10 (card c67; doc/SERIES.md, "Rating"): five steps with
 * halves, as Ranobe rates, and 0 is unrated. Rung 29 doubled the old 0-5
 * exactly. The pure part of the blocky slider (Ratings out of 10.dc.html)
 * lives here: where a finger is, what the blocks fill, what the readout says.
 */

export const RATING_MAX = 10;

/**
 * One of five flat bars on a tile. A half is the left half of a bar, on its
 * track (1e). `none` draws no track at all: that is unrated, which is 0.
 */
export type Bar = 'on' | 'half' | 'off' | 'none';

export function ratingBars(rating: Rating): Bar[] {
	if (rating === 0) return ['none', 'none', 'none', 'none', 'none'];
	return [0, 1, 2, 3, 4].map((i) =>
		rating >= i * 2 + 2 ? 'on' : rating === i * 2 + 1 ? 'half' : 'off'
	);
}

export const isRated = (rating: Rating) => rating > 0;

/**
 * Parse a rating from form input. The empty string also means unrated; any
 * other value outside 0-10 is refused rather than clamped, because a clamped
 * 12 silently becomes a 10 nobody chose.
 */
export function parseRating(raw: unknown): Rating | undefined {
	if (raw === '' || raw === '—') return 0;
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (raw === null || !Number.isInteger(n) || n < 0 || n > RATING_MAX) return undefined;
	return n as Rating;
}

/** Written out, a rating is the stored number out of 10 (1f): "7 OF 10". */
export const ratingText = (rating: Rating) => (rating ? `${rating} OF 10` : 'UNRATED');

// ---- the slider --------------------------------------------------------------------------

/** Rating a series, or the least rating a shelf or filter lets in (turn 2). */
export type SliderMode = 'rate' | 'min';

/**
 * The value under a pointer at `x` across a track `width` wide: one of ten
 * halves, 1-10. Rating, a finger off the left end clears (0); a threshold
 * never includes unrated, so it stops at 1.
 */
export function valueAt(x: number, width: number, mode: SliderMode = 'rate'): number {
	if (x < -6 && mode === 'rate') return 0;
	if (width <= 0) return 1;
	return Math.max(1, Math.min(RATING_MAX, Math.ceil((x / width) * RATING_MAX)));
}

/**
 * Whether half `i` (0-9, left to right) is filled. Rating fills up to the
 * value; a threshold fills from itself up, the ratings it lets in.
 */
export function halfOn(i: number, value: number, mode: SliderMode = 'rate'): boolean {
	return mode === 'min' ? value > 0 && i + 1 >= value : i < value;
}

/** The drag readout above the finger (1b): the number, and it in five steps. */
export function readout(n: number, mode: SliderMode = 'rate'): { num: string; sub: string } {
	if (n === 0) return { num: '0', sub: 'UNRATED' };
	if (mode === 'min') return { num: minLabel(n), sub: `${n}–10` };
	return { num: String(n), sub: `${n % 2 ? `${(n - 1) / 2}½` : n / 2} OF 5` };
}

// ---- AT LEAST, in the FILTER panel (doc/FILTERS.md) ---------------------------------------

/** 4+ (8 and up) is where AT LEAST starts, as RATED 4+ always did. */
export const DEFAULT_MIN = 8;

/** A threshold in the slider's own five steps, so the name matches the blocks: 4+, 3.5+. */
export const minLabel = (min: number) => `${min / 2}+`;
