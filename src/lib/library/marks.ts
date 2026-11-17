import type { Range } from './streams.ts';

/**
 * An episode's opening and ending, the pure part (doc/ANIME.md, "Openings and
 * endings"). Three finders answer for an episode, and the first
 * that has a mark wins: the source's own timestamps, then AniSkip, then a
 * fingerprint of the episodes themselves. A finder may know one and not the
 * other, so each part is chosen on its own.
 */

/** Who found a mark: a source's timestamps, AniSkip, or a fingerprint. */
export type MarkMethod = 'source' | 'aniskip' | 'fingerprint';

/** One finder's answer for one episode; either part may be missing. */
export type MarkRow = {
	method: MarkMethod;
	intro: Range | null;
	ending: Range | null;
};

export type ChosenMarks = {
	intro: Range | null;
	ending: Range | null;
	/** Where each mark came from; null when there is none. */
	introFrom: MarkMethod | null;
	endingFrom: MarkMethod | null;
};

/** Best first, as doc/ANIME.md states the precedence. */
export const MARK_ORDER: readonly MarkMethod[] = ['source', 'aniskip', 'fingerprint'];

/** A fingerprint is an opening or an ending only within these lengths, seconds. */
export const INTRO_MIN_S = 15;
export const INTRO_MAX_S = 120;
export const ENDING_MIN_S = 15;
export const ENDING_MAX_S = 180;

/** A span that is a mark at all: positive, and inside the episode, when the length is known. */
export function saneRange(r: Range | null, durationS: number | null): r is Range {
	if (!r || !Number.isFinite(r.start) || !Number.isFinite(r.end)) return false;
	if (r.start < 0 || r.end <= r.start) return false;
	return durationS === null || durationS <= 0 || r.end <= durationS + 1;
}

/** Whether a span's length is within a finder's bounds (the fingerprint's, in practice). */
export const withinBounds = (r: Range, minS: number, maxS: number) =>
	r.end - r.start >= minS && r.end - r.start <= maxS;

/**
 * What the player should use: for each part, the first finder that has a
 * usable one. A source's timestamps beat AniSkip's, and both beat a
 * fingerprint's; a later finder fills only what the earlier ones left empty.
 */
export function chooseMarks(rows: MarkRow[], durationS: number | null = null): ChosenMarks {
	const usable = (r: Range | null) => (saneRange(r, durationS) ? r : null);
	const pick = (part: 'intro' | 'ending') => {
		for (const method of MARK_ORDER) {
			const row = rows.find((r) => r.method === method);
			const r = row ? usable(row[part]) : null;
			if (r) return { r, method };
		}
		return null;
	};
	const intro = pick('intro');
	const ending = pick('ending');
	return {
		intro: intro?.r ?? null,
		ending: ending?.r ?? null,
		introFrom: intro?.method ?? null,
		endingFrom: ending?.method ?? null
	};
}
