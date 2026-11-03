/**
 * Works: a level above series that merges nothing (doc/WORKS.md). Browsing
 * shows the run as one tile and one CONTINUE row; finding shows the series.
 * Everything the tile, the row and the Work screen derive -- which part
 * CONTINUE opens, the face and foot, the rating and FAV rule, the default
 * name, the kinds and the verb -- is decided here and tested in
 * tests/works.spec.ts, not in markup.
 */

import { sharedStart, titleWords } from './books';
import { kindLabel, unitLabel } from './labels';
import { ago } from './tracking';
import type { ContinueItem, Kind, Rating, SeriesCard } from './types';

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
	/** When the series entered the library, for the 'added' order and W2's sort. */
	addedAt: number;
	/** Chapters or episodes counted, and how many are read. */
	entries: number;
	read: number;
	/** The most recent open of any of its entries; null when never opened. */
	lastOpenedAt: number | null;
	/** The source's word: 'ongoing', 'completed' or ''. */
	status: string;
	/** Hidden itself or through its root, and not made public (doc/LIBRARY.md). */
	hidden: boolean;
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
export const inOrder = <T extends WorkPart>(parts: T[]): T[] =>
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
 *
 * `total` is how many parts the Work holds, which is not always how many the
 * caller can see: a reveal-off read drops hidden parts. A page that cannot see
 * every part cannot know they agree, so it says not settable rather than
 * offering a control the server will refuse. The server passes the count it
 * acts on, so the page and the write decide on the same set.
 */
export type WorkRating = {
	/** 0 when no part is rated. */
	shown: Rating;
	settable: boolean;
	/** The value a set starts from (0 when all are unrated); null while mixed. */
	value: Rating | null;
};

export function workRating(parts: WorkPart[], total: number): WorkRating {
	if (parts.length === 0) return { shown: 0, settable: false, value: null };
	const rated = parts.filter((p) => p.rating > 0);
	const shown = rated.length
		? (Math.round(rated.reduce((n, p) => n + p.rating, 0) / rated.length) as Rating)
		: 0;
	const same = parts.length === total && parts.every((p) => p.rating === parts[0].rating);
	return { shown, settable: same, value: same ? parts[0].rating : null };
}

/**
 * FAV follows the same rule: settable while every part agrees (all FAV or
 * none), and mixed parts show the Work as not FAV with how many are. FAV never
 * goes to a tracker either way; only ratings do. `total` is the Work's member
 * count, as for `workRating`: a partial view is never settable.
 */
export type WorkFavourite = {
	/** true when every part is a favourite, false when none, null while mixed. */
	value: boolean | null;
	settable: boolean;
	/** How many parts are a favourite: the control's "+N" while mixed. */
	count: number;
};

export function workFavourite(parts: WorkPart[], total: number): WorkFavourite {
	const count = parts.filter((p) => p.favourite).length;
	const same =
		parts.length > 0 && parts.length === total && (count === parts.length || count === 0);
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

/** WATCH for an episode, READ for a page. */
export const kindVerb = (kind: Kind) => (kind === 'anime' ? 'WATCH' : 'READ');

/** What CONTINUE does with the part it opens: WATCH, READ, or null once the run is read. */
export function workVerb(parts: WorkPart[]): 'READ' | 'WATCH' | null {
	const current = continuePart(parts);
	return current ? kindVerb(current.kind) : null;
}

/** What a run row's status column says: the ink, and the quieter line under it. */
export type RunStatus = { ink: string; sub: string };

/**
 * THE RUN's status column (Work-Screen; Work-States 3 and 6): `READ ✓ ·
 * FINISHED 12 MAR`, `CH. 15 OF 205 · OPENED 2 H AGO`, `NOT STARTED · +4 NEW`.
 * The unit and the finished mark follow the part's kind, so an anime part --
 * the designed manga-plus-anime Work -- says `EP. 5 OF 12` and `WATCH ✓`, not
 * `CH.` and `READ ✓` beside its own `ANIME · EP.` meta line.
 *
 * A never-opened part's `newCount` is read against the Work's last open, not
 * its own (there is none): chapters that arrived since the owner last read any
 * part of the run are what `+N NEW` means there. A series tile keeps the
 * library's rule that a never-opened series has only unread (doc/LIBRARY.md,
 * "New chapters").
 *
 * The formatters come from the caller so the screen's date and time words stay
 * the screen's (`ago`, the month's locale), and this stays testable alone.
 */
export function runStatus(
	p: WorkPart & { finishedAt?: number | null; newCount?: number },
	opts: {
		current?: boolean;
		/** The label of the entry ▶ opens, for the part CONTINUE opens. */
		resumeLabel?: string | null;
		now?: number;
		month?: (ms: number) => string;
	} = {}
): RunStatus {
	const state = partState(p);
	if (state === 'read-through' || state === 'caught-up')
		return {
			ink: state === 'caught-up' ? 'CAUGHT UP ✓' : `${kindVerb(p.kind)} ✓`,
			sub: p.finishedAt ? `FINISHED ${monthOf(opts)(p.finishedAt)}` : ''
		};
	if (state === 'not-started')
		return {
			ink: '',
			sub: `NOT STARTED${(p.newCount ?? 0) > 0 ? ` · +${p.newCount} NEW` : ''}`
		};
	const chapter =
		opts.current && opts.resumeLabel
			? opts.resumeLabel.toUpperCase()
			: `${unitLabel(p.kind)}. ${p.read + 1}`;
	return {
		ink: `${chapter} OF ${p.entries}`,
		sub: p.lastOpenedAt ? `OPENED ${ago(p.lastOpenedAt, opts.now ?? Date.now())}` : 'IN PROGRESS'
	};
}

const monthOf = (opts: { month?: (ms: number) => string }) =>
	opts.month ??
	((ms: number) =>
		new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase());

/**
 * The Work screen's count line (Work-Screen): "3 SERIES · 375 CHAPTERS · 86
 * READ", and "2 SERIES · 227 CHAPTERS · ALL READ" once the run is read. The
 * chapter count is the parts' own counted entries, front and back matter left
 * out, as every count in the library is (doc/LIBRARY.md).
 */
export type WorkCounts = { series: number; chapters: number; read: number; allRead: boolean };

export function workCounts(parts: WorkPart[]): WorkCounts {
	const chapters = parts.reduce((n, p) => n + p.entries, 0);
	const read = parts.reduce((n, p) => n + p.read, 0);
	return { series: parts.length, chapters, read, allRead: chapters > 0 && read >= chapters };
}

/**
 * A Work as a browse list draws it (doc/WORKS.md, "The one rule"): the run is
 * one tile. `face` is the part whose cover the tile wears -- the part on the
 * shelf being browsed, which is CONTINUE's part on ALL and on a shelf every
 * part is on; `parts` is every part the viewer can see, for the foot, the
 * counts and the badges. `newCount` is the parts' sum, which is the tile's +N;
 * `↓` is the device's own cache, never this row. `hidden` is the Work's, not
 * the face's: a Work is hidden or shown whole, and the face can be the one part
 * that is not (doc/WORKS.md, "The one rule").
 */
export type WorkTile = {
	id: number;
	name: string;
	face: SeriesCard;
	parts: WorkPart[];
	newCount: number;
	hidden: boolean;
};

/**
 * Finding a series that belongs to a Work (search, a tag filter, a person's
 * page): the match is the series, and its foot says where in the run it sits
 * -- "PART 2 · THE BREAKER".
 */
export type WorkFootFacts = { id: number; name: string; part: number; of: number };

/**
 * A library row: a series as it always was, or a whole Work when the list is
 * browsing. A Work row keeps the face series' card fields so that everything
 * which reads a card (its cover, its hue, its focus line) keeps working, and
 * carries `tile` for the tile's own marks.
 */
export type LibraryCard = SeriesCard & {
	/** The series' most recent open, or null when it has never been opened. */
	lastOpenedAt: number | null;
	/** Finding: the Work this series is a part of, or null. */
	work?: WorkFootFacts | null;
	/** Browsing: set when this row is a Work rather than a series. */
	tile?: WorkTile;
};

/**
 * A row of the + ADD A SERIES picker: a series the Work could take, and the
 * Work it would move out of. The picker reads its own page when it opens, so
 * this is a page of the library, never the whole of it (doc/WORKS.md).
 */
export type AddableSeries = {
	seriesId: number;
	title: string;
	kind: Kind;
	hue: number;
	cover: number | null;
	inWork: string | null;
};

export type AddablePage = { items: AddableSeries[]; total: number };

/**
 * A CONTINUE row: a series, or a Work. A Work's row says the part and the
 * Work's name ("WORK · PART 2 · CH. 15"), and between parts it says UP NEXT and
 * points at the next part's first chapter.
 */
export type ContinueLine = ContinueItem & {
	work?: {
		id: number;
		name: string;
		part: number;
		of: number;
		upNext: boolean;
		/** The part CONTINUE opens (or the next one), named in the row's own line. */
		partTitle: string;
	} | null;
};

/** "PART 2", "NEXT", "ALL READ": the tile foot's label, in the phone's shorter words. */
export function workFootShort(foot: WorkFoot, parts: WorkPart[]): string {
	if (foot.label === null) return '';
	if (foot.upNext) return 'NEXT';
	const current = continuePart(parts);
	if (!current) return 'ALL READ';
	const n = inOrder(parts).findIndex((p) => p.seriesId === current.seriesId) + 1;
	return `${n} OF ${parts.length}`;
}
