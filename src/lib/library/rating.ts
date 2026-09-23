import type { Rating } from './types';

/**
 * One of five flat bars. `none` draws no track at all: that is unrated, which
 * is 0. A rated series draws its filled bars and the rest of the track.
 */
export type Bar = 'on' | 'off' | 'none';

export function ratingBars(rating: Rating): Bar[] {
	if (rating === 0) return ['none', 'none', 'none', 'none', 'none'];
	return [0, 1, 2, 3, 4].map((i) => (i < rating ? 'on' : 'off'));
}

/**
 * The picker's six cells, 0 through 5. 0 is unrated -- choosing it clears a
 * rating -- which is the owner's scale (decided 2026-09-22) and the same
 * convention Hentoid uses, so its ratings import as they are.
 */
export const RATING_OPTIONS: readonly Rating[] = [0, 1, 2, 3, 4, 5];

export const isRated = (rating: Rating) => rating > 0;

/**
 * Parse a rating from form input. The empty string also means unrated; any
 * other value outside 0-5 is refused rather than clamped, because a clamped 7
 * silently becomes a 5 nobody chose.
 */
export function parseRating(raw: unknown): Rating | undefined {
	if (raw === '' || raw === '—') return 0;
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (raw === null || !Number.isInteger(n) || n < 0 || n > 5) return undefined;
	return n as Rating;
}
