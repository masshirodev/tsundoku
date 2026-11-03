/**
 * What a kind of series is, and what each kind can do (doc/KINDS.md; card
 * c301). One entry per kind, filled from what the code already did at
 * `c14a5d4e` -- this slice changes no behaviour, so every fact here has the
 * line it was read from beside it.
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

/** `anime` is a series of episodes (rung 47; doc/ANIME.md). */
export type Kind = 'manga' | 'manhwa' | 'doujin' | 'novel' | 'anime';

/** Is it pages, text or video? The reader or the player, and how progress is said. */
export type Medium = 'pages' | 'text' | 'video';

/** The extension families that feed a series (`mihon:`, `lnreader:`/`ln:`, `aniyomi:`). */
export type SourceFamily = 'mihon' | 'lnreader' | 'aniyomi';

export type KindFacts = {
	kind: Kind;
	medium: Medium;
	/** What one entry is called: CH, VOL, EP; and READ or WATCHED. */
	unit: { short: string; long: string; done: string };
	/** Where its metadata and its link come from. */
	catalogue:
		{ provider: 'anilist'; type: 'MANGA' | 'ANIME' } | { provider: 'tmdb'; type: 'movie' | 'tv' };
	/** Kinds it may be linked or matched against (an anime never to a manga). */
	matches: readonly Kind[];
	/** The extension families that may feed it. Empty for a kind no extension serves. */
	sources: readonly SourceFamily[];
	/** Where its files live: tsundoku's library root, or Jellyfin's folders. */
	storage: 'library' | 'jellyfin';
	/** The default the reader or player starts from (`defaultDirection`, series.ts). */
	layout?: 'paged' | 'vertical' | 'rtl' | 'ltr';
	/** Whether MOVE between sources is offered. */
	movable: boolean;
};

/**
 * The registry. Its key order is `KINDS`'s order, which is `FILTER_KINDS`'s,
 * which is the order the FILTER panel lists kind chips in
 * (`kindsAmong`, filters.ts; `src/lib/server/library.ts:440`).
 *
 * `as const` keeps each entry's literals, so `MoveKind` and `SourceKind` are
 * derived at the type level rather than restated.
 */
export const KIND_FACTS = {
	// `KINDS` as it was in `types.ts` at `c14a5d4e`; the comic family in
	// `sameKind` (library/catalogue.ts:171-175): manga, manhwa and a doujin
	// are one family to AniList. A doujin is Hentoid's, so no extension feeds
	// it (`src/lib/library/downloads.ts:49-54`, `parseKey`: "null for any
	// other key (Hentoid, a folder, `mihon-dir:`)" -- its `origin_key` has no
	// `mihon:`/`ln:`/`aniyomi:` prefix). Pages, R→L by default
	// (`defaultDirection`, library/series.ts:89-93). MOVE is offered
	// (`movableKind`, src/lib/server/move.ts:56-57).
	manga: {
		kind: 'manga',
		medium: 'pages',
		unit: { short: 'CH', long: 'CHAPTER', done: 'READ' },
		catalogue: { provider: 'anilist', type: 'MANGA' },
		matches: ['manga', 'manhwa', 'doujin'],
		sources: ['mihon'],
		storage: 'library',
		layout: 'rtl',
		movable: true
	},
	// `defaultDirection` reads a manhwa as a vertical strip
	// (library/series.ts:90), and the image reader draws it that way. Same
	// comic family and same Mihon source as a manga. MOVE is offered for it
	// too (`movableKind`, src/lib/server/move.ts:56-57), planned as a manga:
	// a comic matches by chapter number (src/lib/server/move.ts:268).
	manhwa: {
		kind: 'manhwa',
		medium: 'pages',
		unit: { short: 'CH', long: 'CHAPTER', done: 'READ' },
		catalogue: { provider: 'anilist', type: 'MANGA' },
		matches: ['manga', 'manhwa', 'doujin'],
		sources: ['mihon'],
		storage: 'library',
		layout: 'vertical',
		movable: true
	},
	// A doujin's own peculiarity: one book with no count (labels.ts:31-38,
	// `continueSub`), and a series of two or more books is a cover grid
	// (library/series.ts:208, `isBookSeries`). Its unit is still a chapter in
	// `unitLabel` (labels.ts:45). Not movable.
	doujin: {
		kind: 'doujin',
		medium: 'pages',
		unit: { short: 'CH', long: 'CHAPTER', done: 'READ' },
		catalogue: { provider: 'anilist', type: 'MANGA' },
		matches: ['manga', 'manhwa', 'doujin'],
		sources: [],
		storage: 'library',
		layout: 'rtl',
		movable: false
	},
	// Text: the text reader, volumes, READ (labels.ts:45). One EPUB volume is
	// one series, grouped books are volumes (library/series.ts:192, 204).
	// LNReader's plugins are `lnreader:`/`ln:` keys
	// (src/lib/library/downloads.ts:56-85).
	// `matches` is itself alone: a novel is another work from its comic
	// (doc/LINKS.md:69, 106-111), and the cover-only crossing is `coverOnly`,
	// not a match. Not movable.
	novel: {
		kind: 'novel',
		medium: 'text',
		unit: { short: 'VOL', long: 'VOLUME', done: 'READ' },
		catalogue: { provider: 'anilist', type: 'MANGA' },
		matches: ['novel'],
		sources: ['lnreader'],
		storage: 'library',
		layout: 'paged',
		movable: false
	},
	// Video: episodes, WATCHED, the player (library/anime.ts:1-8,
	// labels.ts:45-51). Its own AniList catalogue (doc/LINKS.md:70-73;
	// c298), its own `aniyomi:` keys (src/lib/library/downloads.ts:64-75) and
	// its MAL family. An anime matches only an anime: `coverOnly` refuses the
	// crossing (library/catalogue.ts:224-232). Movable (library/move.ts:63).
	anime: {
		kind: 'anime',
		medium: 'video',
		unit: { short: 'EP', long: 'EPISODE', done: 'WATCHED' },
		catalogue: { provider: 'anilist', type: 'ANIME' },
		matches: ['anime'],
		sources: ['aniyomi'],
		storage: 'library',
		layout: 'rtl',
		movable: true
	}
} as const satisfies Readonly<Record<Kind, KindFacts>>;

/** One kind's facts. */
export const kindFacts = <K extends Kind>(kind: K): (typeof KIND_FACTS)[K] => KIND_FACTS[kind];

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
 * anime matches by episode and season (`s.kind === 'anime' ? 'anime' :
 * 'manga'`, src/lib/server/move.ts:268). `satisfies` is what makes a new
 * movable kind say how it maps instead of falling through to chapters.
 */
export const MOVE_MAP = {
	manga: 'manga',
	manhwa: 'manga',
	anime: 'anime'
} as const satisfies Record<MovableKind, 'manga' | 'anime'>;

/** MOVE's own kind, narrower than `Kind` and narrower than the movable kinds. */
export type MoveKind = (typeof MOVE_MAP)[MovableKind];

/**
 * The kind each source family names a row by: a Mihon row is a manga, an
 * LNReader row a novel, an Aniyomi row an anime (`BrowseRow.kind`,
 * src/lib/server/engine/browse.ts:38, 70). FIRST READ's source list reads it
 * (`FirstReadSource`, library/start.ts:315).
 */
export const SOURCE_KINDS = {
	mihon: 'manga',
	lnreader: 'novel',
	aniyomi: 'anime'
} as const satisfies Record<SourceFamily, Kind>;

export type SourceKind = (typeof SOURCE_KINDS)[SourceFamily];

/** The AniList catalogue a kind is looked up in: `MANGA` for everything but an anime. */
export function anilistType(kind: Kind): 'MANGA' | 'ANIME' {
	const c = kindFacts(kind).catalogue;
	if (c.provider !== 'anilist') throw new Error(`${kind} is not in AniList's catalogue`);
	return c.type;
}
