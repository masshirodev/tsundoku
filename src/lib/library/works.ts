/**
 * Works: a level above series that merges nothing (doc/WORKS.md). Browsing
 * shows the run as one tile and one CONTINUE row; finding shows the series.
 * Everything the tile, the row and the Work screen derive -- which part
 * CONTINUE opens, the face and foot, the rating and FAV rule, the default
 * name, the kinds and the verb -- is decided here and tested in
 * tests/works.spec.ts, not in markup.
 */

import { sharedStart, titleWords } from './books';
import { kindLabel } from './labels';
import type { Kind, Rating } from './types';

/** How a Work's parts are ordered: the owner's hand, when each was added, or its title. */
export type WorkOrder = 'hand' | 'added' | 'title';

/**
 * One part of a Work, as the server read it. A Work never merges its parts:
 * each keeps its own rating, FAV, cover, source and progress, and these are
 * that part's own facts.
 */
export type WorkPart = {
	seriesId: number;
	title: string;
	kind: Kind;
	rating: Rating;
	favourite: boolean;
	/** The cover thumbnail's version, or null when there's none yet (doc/COVERS.md). */
	cover: number | null;
	/** 1-based place in the owner's order. */
	position: number;
	/** Chapters or episodes counted, and how many are read. */
	entries: number;
	read: number;
	/** The most recent open of any of its entries; null when never opened. */
	lastOpenedAt: number | null;
	/** The source's word: 'ongoing', 'completed' or ''. */
	status: string;
};

/** A part with nothing left to read. A part with no entries at all is never finished. */
export const isFinished = (p: WorkPart) => p.entries > 0 && p.read >= p.entries;

/**
 * What a part is at, in the handoff's words (Work-States, Work-Screen).
 * Caught up and read through are both "all of it read"; the difference is
 * whether the source may still add to it.
 */
export type PartState = 'not-started' | 'in-progress' | 'caught-up' | 'read-through';

export function partState(p: WorkPart): PartState {
	if (isFinished(p)) return p.status.toLowerCase() === 'ongoing' ? 'caught-up' : 'read-through';
	return p.lastOpenedAt === null && p.read === 0 ? 'not-started' : 'in-progress';
}

/** Parts in the owner's order. Ties fall back to the id, so the answer is never the array's accident. */
export const inOrder = (parts: WorkPart[]) =>
	[...parts].sort((a, b) => a.position - b.position || a.seriesId - b.seriesId);

/**
 * The part CONTINUE opens (Works Calls, question 4): the part the owner was in,
 * and when that one is finished, the next unfinished part after it in the
 * owner's order. So a run behaves as an order and a manga beside its anime
 * follows the owner. Nothing unfinished means the run is read, and null.
 *
 * "The part the owner was in" is the most recently opened one, finished or
 * not: a finished part that is still the anchor is exactly how a run crosses
 * from one part to the next. If a later part was finished and nothing after
 * it is unfinished, the run is not called read while an earlier part still
 * has something in it, so the first unfinished part is the answer.
 */
export function continuePart(parts: WorkPart[]): WorkPart | null {
	const ordered = inOrder(parts);
	if (ordered.length === 0) return null;
	let anchor: WorkPart | null = null;
	for (const p of ordered)
		if (p.lastOpenedAt !== null && (anchor === null || p.lastOpenedAt > anchor.lastOpenedAt!))
			anchor = p;
	if (anchor && !isFinished(anchor)) return anchor;
	if (anchor) {
		const next = ordered.find((p) => p.position > anchor!.position && !isFinished(p));
		if (next) return next;
	}
	return ordered.find((p) => !isFinished(p)) ?? null;
}

/** The part whose cover the tile wears: CONTINUE's part, or the last part once the run is read. */
export function facePart(parts: WorkPart[]): WorkPart | null {
	const ordered = inOrder(parts);
	return continuePart(ordered) ?? ordered[ordered.length - 1] ?? null;
}

/**
 * The tile foot's segments: done grey, current ink, to come dark (Work-Library).
 * A part that is not the current one and is unfinished is "to come" whatever
 * its place, because the foot says where the run is, not how much of each part
 * the owner has read.
 */
export type FootSegment = 'done' | 'now' | 'to-come';

export type WorkFoot = {
	segments: FootSegment[];
	/** "PART 2 OF 3", "UP NEXT · PART 2", or null when there is no place to state. */
	label: string | null;
	/** The part CONTINUE opens has not been started: the foot says UP NEXT instead. */
	upNext: boolean;
};

export const PART_NONE: WorkFoot = { segments: [], label: null, upNext: false };

export function workFoot(parts: WorkPart[]): WorkFoot {
	const ordered = inOrder(parts);
	// A Work of one cannot exist; if one is ever handed here, say nothing
	// rather than "PART 1 OF 1".
	if (ordered.length < 2) return PART_NONE;
	const current = continuePart(ordered);
	const segments = ordered.map((p): FootSegment => {
		if (current && p.seriesId === current.seriesId) return 'now';
		return isFinished(p) ? 'done' : 'to-come';
	});
	if (!current)
		return { segments, label: `PART ${ordered.length} OF ${ordered.length}`, upNext: false };
	const n = ordered.findIndex((p) => p.seriesId === current.seriesId) + 1;
	if (partState(current) === 'not-started')
		return { segments, label: `UP NEXT · PART ${n}`, upNext: true };
	return { segments, label: `PART ${n} OF ${ordered.length}`, upNext: false };
}

/**
 * The shown rating: the average of the rated parts, rounded the way the
 * screen's number is (a whole number out of 10, 0 unrated). It is settable
 * while the parts agree -- every part unrated, or every part one rating --
 * so one tap never overwrites ratings given apart (doc/WORKS.md).
 */
export type WorkRating = {
	/** 0 when no part is rated. */
	shown: Rating;
	settable: boolean;
	/** The value a set starts from (0 when all are unrated); null while mixed. */
	value: Rating | null;
};

export function workRating(parts: WorkPart[]): WorkRating {
	if (parts.length === 0) return { shown: 0, settable: false, value: null };
	const rated = parts.filter((p) => p.rating > 0);
	const shown = rated.length
		? (Math.round(rated.reduce((n, p) => n + p.rating, 0) / rated.length) as Rating)
		: 0;
	const same = parts.every((p) => p.rating === parts[0].rating);
	return { shown, settable: same, value: same ? parts[0].rating : null };
}

/**
 * FAV follows the same rule: settable while every part agrees (all FAV or
 * none), and mixed parts show the Work as not FAV with how many are. FAV never
 * goes to a tracker either way; only ratings do.
 */
export type WorkFavourite = {
	/** true when every part is a favourite, false when none, null while mixed. */
	value: boolean | null;
	settable: boolean;
	/** How many parts are a favourite: the control's "+N" while mixed. */
	count: number;
};

export function workFavourite(parts: WorkPart[]): WorkFavourite {
	const count = parts.filter((p) => p.favourite).length;
	const same = parts.length > 0 && (count === parts.length || count === 0);
	return { value: same ? count === parts.length : null, settable: same, count };
}

/**
 * The default NAME: the words every title starts with (the books stem rule,
 * src/lib/library/books.ts), or empty when they share nothing so the sheet
 * can say NAME IT FOR YOURSELF. `sharedStart` falls back to the first title
 * when the titles share nothing, which is right for a series of books and a
 * lie for a Work; this checks that what it found really is every title's
 * start before keeping it.
 */
export function defaultWorkName(titles: string[]): string {
	if (titles.length === 0) return '';
	const start = sharedStart(titles).trim();
	if (start === '') return '';
	const stem = titleWords(start);
	if (stem.length === 0) return '';
	const every = titles.every((t) => {
		const words = titleWords(t);
		return stem.length <= words.length && stem.every((w, i) => words[i] === w);
	});
	return every ? start : '';
}

/** "WORK · MANGA + ANIME": the kinds the parts are, deduplicated, in their own order. */
export function workKinds(parts: WorkPart[]): string {
	const kinds: string[] = [];
	for (const p of inOrder(parts)) {
		const label = kindLabel(p.kind);
		if (!kinds.includes(label)) kinds.push(label);
	}
	return `WORK · ${kinds.join(' + ')}`;
}

/** What CONTINUE does with the part it opens: watching an anime, reading anything else. */
export const workVerb = (kind: Kind) => (kind === 'anime' ? 'WATCH' : 'READ');
