import type { Rating } from './types';

/**
 * One of five flat bars. `none` draws no track at all, which is how unrated
 * stays visibly different from a deliberate 0 (five `off` bars).
 */
export type Bar = 'on' | 'off' | 'none';

export function ratingBars(rating: Rating): Bar[] {
	if (rating === null) return ['none', 'none', 'none', 'none', 'none'];
	return [0, 1, 2, 3, 4].map((i) => (i < rating ? 'on' : 'off'));
}

/**
 * The picker's seven cells, in the order the design draws them: `—` clears the
 * rating back to unrated, then 0 through 5.
 */
export const RATING_OPTIONS: readonly Rating[] = [null, 0, 1, 2, 3, 4, 5];

export function ratingLabel(rating: Rating): string {
	return rating === null ? '—' : String(rating);
}

/**
 * Parse a rating from form input. The empty string and `—` mean unrated; any
 * other value outside 0-5 is refused rather than clamped, because a clamped 7
 * silently becomes a 5 nobody chose.
 */
export function parseRating(raw: unknown): Rating | undefined {
	if (raw === null || raw === '' || raw === '—' || raw === 'null') return null;
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isInteger(n) || n < 0 || n > 5) return undefined;
	return n as Rating;
}
