/**
 * The shapes the library screen reads. Server rows are mapped into these in
 * `$lib/server/library.ts`; nothing in `$lib/library` touches the database, so
 * every rule here is testable as a pure function.
 */

export type Kind = 'manga' | 'manhwa' | 'doujin' | 'novel';

export const KINDS: readonly Kind[] = ['manga', 'manhwa', 'doujin', 'novel'];

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
	readCount: number;
	/** Hue for the striped cover placeholder, 0-359. */
	hue: number;
	/** The cover thumbnail's version, or null when there's none yet (doc/COVERS.md). */
	cover: number | null;
	/** False while the scanner has found the series but not yet indexed it. */
	indexed: boolean;
	addedAt: number;
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
	/** `all`, `favourites`, `rated4`, `new`, `downloaded`, `k:<kind>` for manga/manhwa/novels, `c:<id>` for a collection, `r:<id>` for a root. */
	key: string;
	name: string;
	kind: ShelfKind;
	count: number;
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
