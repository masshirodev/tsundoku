/**
 * What a kind of series is, and what each kind can do (doc/KINDS.md). One
 * entry per kind; every fact here has the line it was read from beside it.
 *
 * Ask the question, not the name: `kindFacts(s.kind).unit.short`, never
 * `s.kind === 'anime'`. A new kind gets the right behaviour wherever the
 * question is already asked, and the compiler names every place that needs a
 * new fact. `tests/kinds.spec.ts` holds a ratchet over the comparisons that
 * are left (doc/KINDS.md, "No new kind checks").
 *
 * Pure: nothing here imports `$lib/server` or touches the database. `Kind` is
 * defined here, not in `types.ts`, because `KIND_FACTS` is keyed by it;
 * `types.ts` re-exports both, so every existing import still works.
 */

/** `anime` is a series of episodes (migration 47; doc/ANIME.md). */
export type Kind = 'manga' | 'manhwa' | 'doujin' | 'novel' | 'anime' | 'movie' | 'show';

/** Is it pages, text or video? The reader or the player, and how progress is said. */
export type Medium = 'pages' | 'text' | 'video';

/** The extension families that feed a series, by key prefix: `mihon:`, `lnreader:`, `aniyomi:`. */
export type SourceFamily = 'mihon' | 'lnreader' | 'aniyomi';

export type KindFacts = {
	kind: Kind;
	medium: Medium;
	/**
	 * What one entry is called: CH, VOL, EP; and READ or WATCHED. **Absent for
	 * a film**, which has one entry and no list: screens draw no count at all
	 * (`kindUnit` answers empty words, and `sheetMeta` skips the count).
	 */
	unit?: { short: string; long: string; done: string };
	/** Where its metadata and its link come from. */
	catalogue:
		{ provider: 'anilist'; type: 'MANGA' | 'ANIME' } | { provider: 'tmdb'; type: 'movie' | 'tv' };
	/** Kinds it may be linked or matched against (an anime never to a manga). */
	matches: readonly Kind[];
	/**
	 * The extension families whose key a series of this kind can carry
	 * (`origin_key`, as `parseKey`/`parseNovelKey`/`parseAnimeKey` read it in
	 * library/downloads.ts). Read from the writers, not from what a kind is
	 * "for". A key no family parses (`hentoid:`, `hentoid-dir:`, `mihon-dir:`,
	 * `epub:`, or none) is not listed: those are not families yet.
	 */
	sources: readonly SourceFamily[];
	/** The default the reader or player starts from (`defaultDirection`, series.ts). */
	layout?: 'paged' | 'vertical' | 'rtl' | 'ltr';
	/** Whether MOVE between sources is offered. */
	movable: boolean;
	/**
	 * What GROUP binds this kind's series into (src/lib/server/books.ts):
	 * `books`, single books into a series of books (`groupIntoSeries`), which
	 * is also what folds editions (`foldEditions`) and gives a series of books
	 * its first book's cover (`firstBookSource`, covers.ts); `volumes`, one
	 * EPUB volume per series into one novel (`groupVolumes`); null, GROUP does
	 * not take it (Works groups across kinds: doc/WORKS.md).
	 */
	grouping: 'books' | 'volumes' | null;
	/**
	 * Where a video kind's downloads go under the one library root
	 * (doc/DOWNLOADS.md, "Where files go"): its folder, the folder a hidden
	 * series goes to instead (never one a Jellyfin library would read: Jellyfin
	 * has no reveal), and the layout inside, `seasons` (`<Series>/Season 01/…
	 * S01E07 …mkv`, tvshow.nfo) or `film` (`<Title (Year)>/<Title (Year)>.mkv`,
	 * its `<movie>` NFO beside it). Absent for a kind tsundoku never downloads
	 * as video. One root on purpose: the delete guard, backups, the hidden
	 * folders and RESCAN all assume it.
	 */
	storage?: { folder: string; hidden: string; layout: 'seasons' | 'film' };
};

/**
 * The registry. Its key order is `KINDS`'s order, which is `FILTER_KINDS`'s,
 * which is the order the FILTER panel lists kind chips in and the KIND band
 * its cells (`kindsAmong` and `kindCells`, filters.ts, the band's over
 * `kindCounts`, `src/lib/server/library.ts`).
 *
 * `as const` keeps each entry's literals, so `MoveKind` and `SourceKind` are
 * derived at the type level rather than restated.
 */
export const KIND_FACTS = {
	// The comic family in
	// `sameKind` (library/catalogue.ts:171-175): manga, manhwa and a doujin
	// are one family to AniList. A Mihon source's series, by the backup's
	// importer and by browse's ADD alike (`planMihon`'s
	// `mihon:<source>:<url>`, src/lib/import/mihon-plan.ts:388;
	// `addToLibrary`, src/lib/server/engine/backend.ts:593); a downloaded
	// folder the backup does not know is `mihon-dir:`, which is no family
	// (mihon-plan.ts:447). Pages, R→L by default (`defaultDirection`,
	// library/series.ts:89-93). MOVE is offered: `movableKind` reads this fact.
	manga: {
		kind: 'manga',
		medium: 'pages',
		unit: { short: 'CH', long: 'CHAPTER', done: 'READ' },
		catalogue: { provider: 'anilist', type: 'MANGA' },
		matches: ['manga', 'manhwa', 'doujin'],
		sources: ['mihon'],
		layout: 'rtl',
		movable: true,
		grouping: null
	},
	// `defaultDirection` reads a manhwa as a vertical strip
	// (library/series.ts:90), and the image reader draws it that way. Same
	// comic family and same Mihon source as a manga. MOVE is offered for it
	// too, planned as a manga: a comic matches by chapter number (`moveKindOf`,
	// by medium).
	manhwa: {
		kind: 'manhwa',
		medium: 'pages',
		unit: { short: 'CH', long: 'CHAPTER', done: 'READ' },
		catalogue: { provider: 'anilist', type: 'MANGA' },
		matches: ['manga', 'manhwa', 'doujin'],
		sources: ['mihon'],
		layout: 'vertical',
		movable: true,
		grouping: null
	},
	// A doujin's own peculiarity: one book with no count (labels.ts:30-38,
	// `continueSub`), and a series of two or more books is a cover grid
	// (library/series.ts:207-208, `isBookSeries`). Its unit is still a chapter
	// in `unitLabel` (labels.ts:45). Grouping: books, because GROUP binds only
	// single doujin books into a series of books, and folds only their editions
	// (`groupIntoSeries`, `moveBook`, `foldEditions`, src/lib/server/books.ts).
	// Sources: a Mihon gallery source's series is a doujin whatever its genres
	// say (`isGallerySource` and `kindOf`, src/lib/import/mihon-plan.ts:106,
	// 127-128) and keeps its `mihon:` key (:388; doc/IMPORT-MIHON.md:123-143,
	// pinned by tests/mihon-plan.spec.ts:400), at the backup's import and at
	// browse's ADD, which plans through the same `planMihon`. A doujin also
	// comes from Hentoid (`hentoid:<site>:<url>` or `hentoid-dir:<folder>`,
	// src/lib/import/hentoid-plan.ts:215), and a grouped series of books has
	// no key at all (src/lib/server/books.ts:218); Hentoid's keys are not a
	// `SourceFamily` yet, and making them one is a change of its own.
	// Not movable, although a gallery doujin's key is one MOVE could read.
	// Catalogue: read, although no LINK queue lists a doujin. A gallery
	// doujin's Mihon MAL tracker is linked at import (`malLink`,
	// mihon-plan.ts:414; server/import/write.ts:448), and `resolveLinks`
	// reads that id in this catalogue (server/catalogue.ts:487-545). Pinned by
	// tests/kinds-db.spec.ts ("a doujin's catalogue").
	doujin: {
		kind: 'doujin',
		medium: 'pages',
		unit: { short: 'CH', long: 'CHAPTER', done: 'READ' },
		catalogue: { provider: 'anilist', type: 'MANGA' },
		matches: ['manga', 'manhwa', 'doujin'],
		sources: ['mihon'],
		layout: 'rtl',
		movable: false,
		grouping: 'books'
	},
	// Text: the text reader, volumes, READ (labels.ts:45). One EPUB volume is
	// one series, grouped books are volumes (`volumesIn` and `isVolumeSeries`,
	// library/series.ts:191, 203-204). LNReader's plugins are `lnreader:` keys
	// (`novelKeyOf`/`parseNovelKey`, src/lib/library/downloads.ts:56-63;
	// written by src/lib/import/novel-plan.ts:102,135, the backup and browse's
	// ADD alike); an EPUB's is `epub:<path>` (src/lib/import/epub-plan.ts:35),
	// which is no family. `ln:` is a plugin's source id, not a key (:86).
	// `matches` is itself alone: a novel is another work from its comic
	// (doc/LINKS.md:69, 106-111), and the cover-only crossing is `coverOnly`,
	// not a match. Not movable, although LNReader feeds it. Grouping:
	// volumes, because GROUP binds novels' EPUBs into one novel and takes one
	// apart again (`groupVolumes`, `takeOutVolumes`, src/lib/server/books.ts).
	novel: {
		kind: 'novel',
		medium: 'text',
		unit: { short: 'VOL', long: 'VOLUME', done: 'READ' },
		catalogue: { provider: 'anilist', type: 'MANGA' },
		matches: ['novel'],
		sources: ['lnreader'],
		layout: 'paged',
		movable: false,
		grouping: 'volumes'
	},
	// Video: episodes, WATCHED, the player (library/anime.ts:3-9,
	// labels.ts:45-54). Its own AniList catalogue (doc/LINKS.md:70-73),
	// its own `aniyomi:` keys (`animeKeyOf`/`parseAnimeKey`,
	// src/lib/library/downloads.ts:69-75; every writer: the backup's
	// src/lib/import/anime-plan.ts:156, browse's ADD and a folder's
	// `tvshow.nfo`, which refuses any other key, library/anime-files.ts:154)
	// and its MAL family. An anime matches only an anime: `coverOnly` refuses
	// the crossing (library/catalogue.ts:224-231). Movable, and MOVE's map kind for
	// video (`moveKindOf`).
	anime: {
		kind: 'anime',
		medium: 'video',
		unit: { short: 'EP', long: 'EPISODE', done: 'WATCHED' },
		catalogue: { provider: 'anilist', type: 'ANIME' },
		matches: ['anime'],
		sources: ['aniyomi'],
		layout: 'rtl',
		movable: true,
		grouping: null,
		storage: { folder: 'Anime', hidden: 'Anime (hidden)', layout: 'seasons' }
	},
	// A film is a series with one entry (doc/FILMS-SHOWS.md):
	// video, no unit, no list, TMDB's `movie`, and an Aniyomi
	// source's key. It matches only a film: a film is not the twin of the book
	// it adapts (that is OTHER FORMS). Movable between sources, read as video.
	movie: {
		kind: 'movie',
		medium: 'video',
		catalogue: { provider: 'tmdb', type: 'movie' },
		matches: ['movie'],
		sources: ['aniyomi'],
		movable: true,
		grouping: null,
		storage: { folder: 'Movies', hidden: 'Movies (hidden)', layout: 'film' }
	},
	// A show is the anime-shaped series with its seasons as the source gave
	// them: EP, TMDB's `tv`, an Aniyomi source. It matches only a show.
	show: {
		kind: 'show',
		medium: 'video',
		unit: { short: 'EP', long: 'EPISODE', done: 'WATCHED' },
		catalogue: { provider: 'tmdb', type: 'tv' },
		matches: ['show'],
		sources: ['aniyomi'],
		movable: true,
		grouping: null,
		storage: { folder: 'Shows', hidden: 'Shows (hidden)', layout: 'seasons' }
	}
} as const satisfies Readonly<Record<Kind, KindFacts>>;

/** One kind's facts. */
export const kindFacts = <K extends Kind>(kind: K): (typeof KIND_FACTS)[K] => KIND_FACTS[kind];

/**
 * The words for one entry, or none for a film: `unit` is absent
 * there, and a screen that concatenates a count asks this rather than each
 * site deciding what absent means. `done` stays WATCHED, which a film's one
 * entry is.
 */
export const kindUnit = (kind: Kind): { short: string; long: string; done: string } =>
	(kindFacts(kind) as KindFacts).unit ?? { short: '', long: '', done: 'WATCHED' };

/** The default reading layout, or undefined for a kind with no reader (a film, a show). */
export const kindLayout = (kind: Kind): KindFacts['layout'] =>
	(kindFacts(kind) as KindFacts).layout;

/**
 * Every kind, in the registry's order: the library's, the FILTER's and KIND's.
 * Readonly because `FILTER_KINDS` is the same object and that order is
 * load-bearing: one in-place sort in a screen would reorder the registry.
 */
export const KINDS: readonly Kind[] = Object.keys(KIND_FACTS) as Kind[];

/** The kinds MOVE offers between sources (`movable`: a manga, a manhwa, an anime). */
export type MovableKind = {
	[K in Kind]: (typeof KIND_FACTS)[K]['movable'] extends true ? K : never;
}[Kind];

/** The movable kinds at runtime, in the registry's order. */
export const MOVABLE_KINDS = KINDS.filter((k): k is MovableKind => KIND_FACTS[k].movable);

/**
 * How MOVE reads a movable kind: the shape of its by-number map. A manhwa is
 * a comic, so it matches by chapter number exactly as a manga does; only an
 * anime matches by episode and season (`moveKindOf` below). `satisfies` is
 * what makes a new movable kind say how it maps instead of falling through to
 * chapters.
 */
export const MOVE_MAP = {
	manga: 'manga',
	manhwa: 'manga',
	anime: 'anime',
	movie: 'anime',
	show: 'anime'
} as const satisfies Record<MovableKind, 'manga' | 'anime'>;

/** MOVE's own kind, narrower than `Kind` and narrower than the movable kinds. */
export type MoveKind = (typeof MOVE_MAP)[MovableKind];

/**
 * Whether MOVE is offered for a kind: its `movable` fact. This is
 * what `movableKind` (src/lib/server/move.ts) asks, so a kind added here moves
 * or doesn't by saying so, never by being missing from a list of names. A
 * doujin does not move although a gallery's key is `mihon:` (doc/KINDS.md,
 * "A doujin carries a family's key and does not move").
 */
export const isMovable = (kind: Kind): kind is MovableKind => KIND_FACTS[kind].movable;

/**
 * The shape of MOVE's by-number map for a series of this kind, read from its
 * medium: video maps by episode and season (`anime`), and
 * everything else by number (`manga`). On every movable kind it is
 * `MOVE_MAP`'s answer (tests/kinds.spec.ts asserts it for each). It answers
 * every kind, not only the movable ones, because MOVE BACK and its candidate
 * read it without asking `movable` (`applyMoveBack`, `formerCandidate`):
 * there a novel or a doujin reads as `manga`, which is what the map always
 * said for a kind that is not video.
 */
export function moveKindOf(kind: Kind): MoveKind {
	return KIND_FACTS[kind].medium === 'video' ? MOVE_MAP.anime : MOVE_MAP.manga;
}

/**
 * The kind each source family names a row by: a Mihon row is a manga, an
 * LNReader row a novel, an Aniyomi row an anime (`BrowseRow.kind`,
 * src/lib/server/engine/browse.ts:38, 70). FIRST READ's source list reads it
 * (`FirstReadSource`, library/start.ts:313-317).
 */
export const SOURCE_KINDS = {
	mihon: 'manga',
	lnreader: 'novel',
	aniyomi: 'anime'
} as const satisfies Record<SourceFamily, Kind>;

export type SourceKind = (typeof SOURCE_KINDS)[SourceFamily];

/**
 * The prefix each family's `origin_key` starts with, before its first `:`:
 * `mihon:<source>:<url>`, `lnreader:<plugin>:<path>`,
 * `aniyomi:<source>:<url>`. `keyOf`, `novelKeyOf` and `animeKeyOf` build keys
 * from it and `parseKey`, `parseNovelKey` and `parseAnimeKey` read them with
 * it (library/downloads.ts), so the map is stated here once. Who writes each
 * (doc/KINDS.md):
 * Mihon's backup and browse's ADD through `planMihon`
 * (src/lib/import/mihon-plan.ts:388), LNReader's through `novelKeyOf`
 * (src/lib/import/novel-plan.ts:102, 135), Aniyomi's through `animeKeyOf`
 * (src/lib/import/anime-plan.ts:156; engine/anime-source.ts) and a folder's
 * `tvshow.nfo` (library/anime-files.ts:154), and MOVE's re-key through
 * `keyOf`/`animeKeyOf` (server/move.ts, `candidateOf`).
 *
 * **No family is a real answer.** A key with any other prefix is no family's:
 * Hentoid's `hentoid:<site>:<url>` and `hentoid-dir:<folder>`
 * (src/lib/import/hentoid-plan.ts:215), a downloaded folder's `mihon-dir:`
 * (mihon-plan.ts:447), an EPUB's `epub:<path>` (epub-plan.ts:35;
 * server/books.ts when a volume is taken out), and a series with no key.
 * `keyFamily` says `null` for them, and every caller decides what null means
 * (no downloader, no FOLLOW, no MOVE). Hentoid is not a family yet: making it
 * one would give its series a downloader to ask, which is a behaviour change
 * of its own.
 */
export const KEY_PREFIX = {
	mihon: 'mihon',
	lnreader: 'lnreader',
	aniyomi: 'aniyomi'
} as const satisfies Record<SourceFamily, string>;

/** Every source family, in `SOURCE_KINDS`' order. */
export const SOURCE_FAMILIES = Object.keys(SOURCE_KINDS) as readonly SourceFamily[];

/**
 * The kinds a source of a family may serve: the family's own
 * default first, then any kind a source of it can be set to. A Mihon source
 * feeds comics, so it may be a manga, a manhwa (a webtoon-only source, a
 * source whose series all say so) or a gallery's doujin; LNReader is novels
 * and Aniyomi is anime, one each until the film and show kinds land.
 *
 * `SOURCE_KINDS` stays the family's default — what a source serves until the
 * user says otherwise — and a reader that asked it for "what this row is"
 * must ask the source instead once it can serve more than one
 * (`source-kind.ts`). `tests/kinds.spec.ts` holds the two lists together.
 */
export const SOURCE_KIND_CHOICES = {
	mihon: ['manga', 'manhwa', 'doujin'],
	lnreader: ['novel'],
	aniyomi: ['anime', 'movie', 'show']
} as const satisfies Record<SourceFamily, readonly Kind[]>;

/** The kinds one source family can serve, its default first. */
export const sourceKindChoices = (family: SourceFamily): readonly Kind[] =>
	SOURCE_KIND_CHOICES[family];

/** What a source of this family serves until a kind is set for it: its family's own. */
export const defaultSourceKind = (family: SourceFamily): Kind => SOURCE_KIND_CHOICES[family][0];

/**
 * The source family a stored kind names: the inverse of `SOURCE_KINDS`,
 * which gives each family one kind of its own. An
 * extension's row stores `manga` or `anime` (`engine_extensions.kind`, an
 * APK's listing the same), and that word is decoded here, once, instead of
 * being compared with a family's kind wherever a family is asked. Null for a
 * word no family names (`manhwa` and `doujin` included: no family stores
 * them). `engine/repo-index.ts` re-exports it as `familyOfKind`.
 */
const FAMILY_OF_KIND = new Map<string, SourceFamily>(
	SOURCE_FAMILIES.map((family) => [SOURCE_KINDS[family], family])
);
export const sourceFamilyOf = (kind: string): SourceFamily | null =>
	FAMILY_OF_KIND.get(kind) ?? null;

/**
 * The kinds GROUP binds the given way (`grouping`): `['doujin']` for books,
 * `['novel']` for volumes today. The BOOKS screen's SQL lists them.
 */
export const kindsGrouped = (grouping: 'books' | 'volumes'): readonly Kind[] =>
	KINDS.filter((k) => KIND_FACTS[k].grouping === grouping);

/** The AniList catalogue a kind is looked up in: `MANGA` for everything but an anime. */
export function anilistType(kind: Kind): 'MANGA' | 'ANIME' {
	const c = kindFacts(kind).catalogue;
	if (c.provider !== 'anilist') throw new Error(`${kind} is not in AniList's catalogue`);
	return c.type;
}

/**
 * The AniList type a kind is looked up in, or **null** for a kind another
 * catalogue holds (a film's TMDB, a show's) — the safe question for a caller
 * that is not certain the series is AniList's. `anilistType`
 * stays the loud one for the code that is AniList's by construction.
 */
export function anilistTypeOf(kind: Kind): 'MANGA' | 'ANIME' | null {
	const c = kindFacts(kind).catalogue;
	return c.provider === 'anilist' ? c.type : null;
}

/**
 * Where a kind's downloads go: asked of the registry, so a video
 * kind added later says its own folder. A kind with none is never downloaded
 * as video, and asking is a mistake the caller made.
 */
export function storageOf(kind: Kind): NonNullable<KindFacts['storage']> {
	const st = (kindFacts(kind) as KindFacts).storage;
	if (!st) throw new Error(`a ${kind} is not downloaded as video`);
	return st;
}

/** Every video kind's folders, for the importer's scan: each kind once. */
export const VIDEO_STORAGE = KINDS.flatMap((k) => {
	const st = (kindFacts(k) as KindFacts).storage;
	return st ? [{ kind: k, ...st }] : [];
});

/**
 * The video kinds as SQL: `s.kind IN ('anime', 'movie', 'show')`,
 * asked of the registry's `medium`, so a series' player, its files and its
 * pictures are a film's and a show's as much as an anime's. `episodic` is the
 * ones with a unit, a list of episodes: what an intro fingerprint is read
 * across, which a film has nothing to compare with.
 *
 * The registry is not a column, so SQL that filters by kind spells the kinds;
 * this is the one place they are spelled, and the kind ratchet counts any
 * other (tests/kinds.spec.ts).
 */
export function videoKindsSql(alias: string, o: { episodic?: boolean } = {}): string {
	const kinds = KINDS.filter((k) => {
		const f = kindFacts(k) as KindFacts;
		return f.medium === 'video' && (!o.episodic || f.unit !== undefined);
	});
	return `${alias ? `${alias}.` : ''}kind IN (${kinds.map((k) => `'${k}'`).join(', ')})`;
}
