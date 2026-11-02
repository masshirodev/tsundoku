import type { Direction } from '$lib/library/series';
import type { Kind, Rating } from '$lib/library/types';

/**
 * What an importer will write, shared by every importer and by the one
 * writer (src/lib/server/import/write.ts). An importer works out a plan
 * without touching the database; the writer applies it idempotently.
 */

export type PlannedEntry = {
	position: number;
	label: string;
	title: string;
	/** The entry's identity across rescans: a chapter URL, or an importer key. */
	sourceUrl: string;
	available: boolean;
	/** Relative to the series path: a CBZ, or a book's folder. */
	file: string;
	bytes: number;
	pageCount: number;
	addedAt: number;
	readAt: number | null;
	lastPosition: number | null;
	lastOpenedAt: number | null;
	/** The source's last read of this entry, imported into the reading log. */
	history: { at: number; finished: boolean; page: number | null; durationMs: number } | null;
	/**
	 * The pages, in order, relative to `file`, when the importer knows them
	 * (a folder of loose images). Archives list their own at read time.
	 */
	pages?: string[];
	/** A novel's entry: where it starts inside its EPUB, 'doc.xhtml#anchor'. */
	locator?: string;
	/** Front or back matter of a book, which isn't a chapter. */
	matter?: '' | 'front' | 'back';
	/** Who translated this copy of the chapter; '' when the source doesn't say. */
	scanlator?: string;
	/** A cover image that isn't a page (Hentoid's thumb), relative to `file`. */
	coverFile?: string | null;
	/** Perceptual hash of the cover, as the source computed it, in hex. */
	coverPhash?: string | null;
	/** An anime's episode (doc/ANIME.md): its season, its number in it, and what the source says of it. */
	episode?: {
		season: number | null;
		number: number | null;
		note: '' | 'filler' | 'recap';
		durationS: number | null;
		thumbUrl: string;
	};
	/**
	 * A book's own tags, for an entry that is a book in a series of books:
	 * person pages find those by their own tags (doc/BOOKS.md).
	 */
	tags?: PlannedTag[];
};

export type PlannedTag = { namespace: string; value: string };

export type PlannedSeries = {
	/** The series' identity across rescans ("mihon:<source>:<url>", "hentoid:<site>:<url>"). */
	originKey: string;
	/**
	 * The key it was imported under before, when that differs: a Mihon download
	 * is keyed by its folder until a backup knows it (server/import/fold.ts).
	 */
	formerKey?: string;
	/**
	 * The source and title a download of this series is filed under on disk
	 * (`<source dir>/<series dir>`). A series a backup names and one imported by
	 * its folder are the same series, on the same device or another: the writer
	 * finds the other by these (server/import/fold.ts, "a folder a backup now
	 * knows").
	 */
	folder?: { source: string; title: string };
	/** `series.source`: 'mihon', 'hentoid'. */
	source: string;
	title: string;
	kind: Kind;
	rating: Rating;
	favourite: boolean;
	hidden: boolean;
	shelves: string[];
	tags: PlannedTag[];
	description: string;
	status: string;
	direction: Direction | null;
	addedAt: number;
	sourceUrl: string;
	/** The source site's cover image, when the source knows one (Mihon's backup). */
	coverUrl?: string;
	/**
	 * Its MyAnimeList entry, from a tracker in Mihon's backup (doc/LINKS.md),
	 * with the score given there (0 to 10, 0 for none).
	 */
	malLink?: { id: number; score: number };
	/** Where the entries' files are relative to, or '' for a series with nothing on disk. */
	path: string;
	entries: PlannedEntry[];
};
