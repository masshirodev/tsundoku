/**
 * The shapes the library screen reads. Server rows are mapped into these in
 * `$lib/server/library.ts`; nothing in `$lib/library` touches the database, so
 * every rule here is testable as a pure function.
 */

import type { Kind } from './kinds.ts';

/**
 * `Kind` and `KINDS` live in the registry, which is keyed by the kind itself
 * (doc/KINDS.md; card c301). Re-exported here because this is where most of
 * the tree imports them from: a kind's facts are `kinds.ts`'s, its shape is
 * this file's.
 */
export type { Kind };
export { KINDS } from './kinds.ts';

/**
 * 0-10, where 0 is unrated and 1-10 is the owner's judgement: five steps with
 * halves (rung 29, card c67). A series is rated or it is not; there is no
 * "rated nothing".
 */
export type Rating = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type SeriesCard = {
	id: number;
	title: string;
	kind: Kind;
	rating: Rating;
	favourite: boolean;
	/** Hidden directly, or by living in a hidden root. */
	hidden: boolean;
	/** Entries newer than the last one read. */
	newCount: number;
	/** Entries total, and how many are finished. */
	entryCount: number;
	/**
	 * One book and nothing beside it (c651): exactly one listed entry, and it
	 * is the series' only entry that is not a folded edition. An extra or a
	 * set-aside duplicate beside the book makes this false, and FOLD refuses
	 * it (`?/fold`), so the bulk bar does not offer it. Optional: only the
	 * library's card query sends it.
	 */
	alone?: boolean;
	readCount: number;
	/** Hue for the striped cover placeholder, 0-359. */
	hue: number;
	/** The cover thumbnail's version, or null when there's none yet (doc/COVERS.md). */
	cover: number | null;
	/** False while the scanner has found the series but not yet indexed it. */
	indexed: boolean;
	addedAt: number;
	/** A chapter on disk, so readable without the internet: what ?dl= asks. */
	downloaded?: boolean;
	/** FOLLOW is on (doc/DOWNLOADING.md): what FOLLOWED filters on the device. */
	followed?: boolean;
	/** An entry has been opened: what READING's UNREAD tells apart on the device. */
	opened?: boolean;
	/**
	 * A book folded from several languages (doc/EDITIONS.md): their codes,
	 * the one it opens in first ("EN · JA"). Absent for any other.
	 */
	languages?: string[];
	/** Its `language:` tag (one, not "translated"): what FOLD AS LANGUAGES reads. */
	language?: string | null;
};

export type ContinueItem = SeriesCard & {
	/** Label of the entry being read, e.g. "Ch. 41" or "Vol. 13". */
	entryLabel: string;
	lastReadAt: number;
	/** The entry ▶ opens (`resumeEntry`). */
	resumeId: number | null;
	/**
	 * How far into the episode being watched, 0-1, for an anime series: its bar
	 * is the episode's, not the series' (Index Anime Library). Absent elsewhere.
	 */
	entryFraction?: number;
};

/**
 * What one REFRESH of a selection did (card c221): the library's band reads
 * this. `asked` counts the series whose source was asked, failures included;
 * a series with no source is `skipped`, never asked and never refused.
 */
export type RefreshBatch = {
	asked: number;
	/** Series that gained at least one chapter or episode. */
	found: number;
	skipped: number;
	/** Titles, sorted, of the sources that threw or did not answer. */
	failed: string[];
	/** Selected but past the run's bound, in the selection's order. */
	remaining: number[];
};

/** What the long-press sheet shows. */
export type SeriesDetail = SeriesCard & {
	/** Collection ids this series is on. */
	collections: number[];
	artist: string | null;
	/** Label of the first unread entry, for the resume button. */
	nextEntry: string | null;
	/** The entry that button opens. */
	nextEntryId: number | null;
};

export type ShelfKind = 'smart' | 'collection' | 'root';

export type Shelf = {
	/** `all`, `new`, `series`, `oneoff`, `k:<kind>` for manga/manhwa/novels, `c:<id>` for a collection, `r:<id>` for a root, `people`. */
	key: string;
	name: string;
	kind: ShelfKind;
	count: number;
	/** Written in place of the count: the active tab's "44 OF 188" while filtered. */
	countText?: string;
};

export type TagHit = { namespace: string; value: string; count: number; key: string };

export type ScanJob = {
	id: number;
	startedAt: number;
	finishedAt: number | null;
	bytesDone: number;
	bytesTotal: number;
	seriesFound: number;
	sourceLabel: string;
	step: number;
	steps: number;
	failedFiles: number;
	dismissedAt: number | null;
};
