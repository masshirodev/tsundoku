import type Database from 'better-sqlite3';
import { getDb } from './db.ts';
import { parseAnimeKey } from '../library/downloads.ts';
import { KINDS, kindFacts } from '../library/kinds.ts';
import { libraryWhere } from './visibility.ts';

/**
 * What a series knows of each season's source (migration 75; doc/WORKS.md,
 * "Per-season sources"). A show merged from several source entries keeps
 * each one's key, folder and title here, one row a season, beside the season
 * links (`series_season_links`) and never holding one.
 *
 * **This module is the one answer to "where does this entry come from".**
 *
 * - **No row answers `series.origin_key`.** A series with no season rows, which
 *   is every series while nothing writes one, reads as it always has. So
 *   does a season without a row in a series where other seasons have one, and a
 *   row whose `origin_key` is NULL.
 * - **An entry with no season is season 0**, a flat list (`episodeEntry`):
 *   the same entry must not be one season to its link and another to its source.
 * - **A book's own key comes before any season's** (migration 76;
 *   doc/BOOKS.md, "Where a book's origin lives"). A one-off grouped into a
 *   series of books keeps its key in `entry_origins`; its `entries.season` is
 *   NULL, so a season row could otherwise answer for it as season 0.
 * - **Two seasons may share a key** (one source entry listing both). Two
 *   *series* may not: `heldByOther` is what a writer asks, as `series_origin`'s
 *   unique index answers for `series.origin_key`.
 */

export type SeasonFact = {
	seriesId: number;
	season: number;
	originKey: string | null;
	folder: string | null;
	sourceTitle: string;
};

type Row = {
	series_id: number;
	season: number;
	origin_key: string | null;
	folder: string | null;
	source_title: string;
};

const asFact = (r: Row): SeasonFact => ({
	seriesId: r.series_id,
	season: r.season,
	originKey: r.origin_key,
	folder: r.folder,
	sourceTitle: r.source_title
});

/** The row an entry's season reads: a NULL season is a flat list, season 0. */
export const seasonRowOf = (season: number | null): number => season ?? 0;

/**
 * An entry's key as a SQL expression, for a query that already has the entry
 * and its series in hand: `SELECT ${entryOriginSql('e', 's')} AS origin_key`.
 * It says what `seasonOrigin` says, row by row.
 */
export const entryOriginSql = (entry: string, series: string): string =>
	`COALESCE((SELECT eo.origin_key FROM entry_origins eo WHERE eo.entry_id = ${entry}.id),
		(SELECT sf.origin_key FROM series_season_facts sf
		WHERE sf.series_id = ${entry}.series_id AND sf.season = COALESCE(${entry}.season, 0)),
		${series}.origin_key)`;

export function seasonFacts(seriesId: number, db: Database.Database = getDb()): SeasonFact[] {
	return (
		db
			.prepare(`SELECT * FROM series_season_facts WHERE series_id = ? ORDER BY season`)
			.all(seriesId) as Row[]
	).map(asFact);
}

export function seasonFact(
	seriesId: number,
	season: number | null,
	db: Database.Database = getDb()
): SeasonFact | null {
	const r = db
		.prepare(`SELECT * FROM series_season_facts WHERE series_id = ? AND season = ?`)
		.get(seriesId, seasonRowOf(season)) as Row | undefined;
	return r ? asFact(r) : null;
}

const seriesKey = (seriesId: number, db: Database.Database): string | null =>
	(
		db.prepare(`SELECT origin_key FROM series WHERE id = ?`).get(seriesId) as
			{ origin_key: string | null } | undefined
	)?.origin_key ?? null;

/** A season's key: its own row's, else the series'. */
export function seasonOrigin(
	seriesId: number,
	season: number | null,
	db: Database.Database = getDb()
): string | null {
	return seasonFact(seriesId, season, db)?.originKey ?? seriesKey(seriesId, db);
}

/** An entry's key, by its own season; null when there's no such entry. */
export function entryOrigin(entryId: number, db: Database.Database = getDb()): string | null {
	const r = db
		.prepare(
			`SELECT ${entryOriginSql('e', 's')} AS k FROM entries e JOIN series s ON s.id = e.series_id
			WHERE e.id = ?`
		)
		.get(entryId) as { k: string | null } | undefined;
	return r?.k ?? null;
}

/**
 * The last season a series knows of, by its rows and by its entries, so a
 * season whose episodes haven't arrived yet and a season nobody wrote a row
 * for both count. Null when it has neither.
 */
export function lastSeason(seriesId: number, db: Database.Database = getDb()): number | null {
	const r = db
		.prepare(
			`SELECT MAX(n) AS n FROM (
				SELECT season AS n FROM series_season_facts WHERE series_id = ?
				UNION ALL
				SELECT COALESCE(season, 0) FROM entries WHERE series_id = ? AND shadowed = 0
			)`
		)
		.get(seriesId, seriesId) as { n: number | null };
	return r.n;
}

export type FollowOrigin = {
	/** The key FOLLOW and REFRESH ask; null when the series has none. */
	key: string | null;
	/**
	 * The season every episode this key lists belongs to, when the key is that
	 * one season's alone. Null when it answers for more than one (the series'
	 * own key, or a key two seasons share): then the source's own stamps say.
	 */
	season: number | null;
};

/**
 * What FOLLOW and REFRESH ask: the **last** season's source, the one that can
 * still air (doc/ANIME.md, "FOLLOW"). A series with no rows, or whose last
 * season has none, asks the series' own key, as it always has.
 */
export function followOrigin(seriesId: number, db: Database.Database = getDb()): FollowOrigin {
	const own = seriesKey(seriesId, db);
	const facts = seasonFacts(seriesId, db);
	// A group of one-offs has no key of its own: its first book's says that the
	// row has a source to ask, and `refreshSeries` asks every book.
	if (facts.length === 0) return { key: own ?? firstBookKey(seriesId, db), season: null };
	const last = lastSeason(seriesId, db);
	const fact = facts.find((f) => f.season === last);
	if (!fact?.originKey) return { key: own, season: null };
	const key = fact.originKey;
	const alone = key !== own && facts.filter((f) => f.originKey === key).length === 1;
	return { key, season: alone ? fact.season : null };
}

export type KeyHolder = { id: number; title: string; in_library: number };

/**
 * The series holding a source entry: the one whose own key it is, else the
 * one a season of which it is (the lowest id, so the answer is the same each
 * time, however a key came to be held twice).
 */
export function seriesHolding(key: string, db: Database.Database = getDb()): KeyHolder | null {
	return (
		(db
			.prepare(
				`SELECT id, title, in_library FROM series WHERE origin_key = @key
				UNION ALL
				SELECT * FROM (
					SELECT s.id, s.title, s.in_library FROM series_season_facts f
					JOIN series s ON s.id = f.series_id WHERE f.origin_key = @key ORDER BY s.id LIMIT 1
				)
				UNION ALL
				SELECT * FROM (
					SELECT s.id, s.title, s.in_library FROM entry_origins eo
					JOIN entries e ON e.id = eo.entry_id JOIN series s ON s.id = e.series_id
					WHERE eo.origin_key = @key ORDER BY s.id LIMIT 1
				)
				LIMIT 1`
			)
			.get({ key }) as KeyHolder | undefined) ?? null
	);
}

/**
 * Another series holding this key, as its own or a season's. The series
 * itself never counts: two of its seasons may share a source.
 */
export function heldByOther(
	key: string,
	seriesId: number,
	db: Database.Database = getDb()
): { id: number; title: string } | null {
	return (
		(db
			.prepare(
				`SELECT id, title FROM series WHERE origin_key = @key AND id != @id
				UNION ALL
				SELECT * FROM (
					SELECT s.id, s.title FROM series_season_facts f JOIN series s ON s.id = f.series_id
					WHERE f.origin_key = @key AND f.series_id != @id ORDER BY s.id LIMIT 1
				)
				UNION ALL
				SELECT * FROM (
					SELECT s.id, s.title FROM entry_origins eo
					JOIN entries e ON e.id = eo.entry_id JOIN series s ON s.id = e.series_id
					WHERE eo.origin_key = @key AND s.id != @id ORDER BY s.id LIMIT 1
				)
				LIMIT 1`
			)
			.get({ key, id: seriesId }) as { id: number; title: string } | undefined) ?? null
	);
}

/** Whether a folder under the library belongs to any series, or to any season of one. */
export function folderTaken(folder: string, db: Database.Database = getDb()): boolean {
	return !!db
		.prepare(
			`SELECT 1 FROM anime_series WHERE folder = @folder
			UNION ALL SELECT 1 FROM series_season_facts WHERE folder = @folder`
		)
		.get({ folder });
}

/** A series' season folders as written, for telling a folder of its own from a stray one. */
export function seasonFolders(seriesId: number, db: Database.Database = getDb()): string[] {
	return (
		db
			.prepare(`SELECT folder FROM series_season_facts WHERE series_id = ? AND folder IS NOT NULL`)
			.all(seriesId) as { folder: string }[]
	).map((r) => r.folder);
}

/** Whether a path on disk is one of a series' season folders (`Anime/<Name>` under any library). */
export function isSeasonFolder(
	seriesId: number,
	path: string,
	db: Database.Database = getDb()
): boolean {
	return seasonFolders(seriesId, db).some((f) => path === f || path.endsWith(`/${f}`));
}

// ---- a book's own origin (migration 76) ----------------------------------------------

export type BookOrigin = {
	entryId: number;
	key: string;
	/** What the singleton was called, the name its source knows it by. */
	sourceTitle: string;
	engineUrl: string | null;
	/** `engine_series.title`'s twin: fixed at the first download, it names the folder. */
	engineTitle: string | null;
	resolvedAt: number | null;
};

type BookRow = {
	entry_id: number;
	origin_key: string;
	source_title: string;
	engine_url: string | null;
	engine_title: string | null;
	resolved_at: number | null;
};

const asBook = (r: BookRow): BookOrigin => ({
	entryId: r.entry_id,
	key: r.origin_key,
	sourceTitle: r.source_title,
	engineUrl: r.engine_url,
	engineTitle: r.engine_title,
	resolvedAt: r.resolved_at
});

/** A book's own origin; null for an entry that reads its series' key. */
export function bookOrigin(entryId: number, db: Database.Database = getDb()): BookOrigin | null {
	const r = db.prepare(`SELECT * FROM entry_origins WHERE entry_id = ?`).get(entryId) as
		BookRow | undefined;
	return r ? asBook(r) : null;
}

/** The origins of a series' books, in reading order. */
export function bookOrigins(seriesId: number, db: Database.Database = getDb()): BookOrigin[] {
	return (
		db
			.prepare(
				`SELECT eo.* FROM entry_origins eo JOIN entries e ON e.id = eo.entry_id
				WHERE e.series_id = ? ORDER BY e.position, e.id`
			)
			.all(seriesId) as BookRow[]
	).map(asBook);
}

/**
 * The first book's key that FOLLOW's and REFRESH's row can ask: a Mihon
 * source's, the only family with a per-book downloader.
 */
function firstBookKey(seriesId: number, db: Database.Database): string | null {
	return (
		(
			db
				.prepare(
					`SELECT eo.origin_key AS k FROM entry_origins eo JOIN entries e ON e.id = eo.entry_id
					WHERE e.series_id = ? AND eo.origin_key GLOB 'mihon:*' ORDER BY e.position, e.id LIMIT 1`
				)
				.get(seriesId) as { k: string } | undefined
		)?.k ?? null
	);
}

export class SeasonFactError extends Error {}

/**
 * The one function that writes a row: a season's facts, whole. Only its
 * specs call it; it is here so the rule
 * the table cannot hold, that one source entry is one series, is never a rule
 * each writer has to remember.
 */
export function putSeasonFact(
	fact: {
		seriesId: number;
		season: number;
		originKey?: string | null;
		folder?: string | null;
		sourceTitle?: string;
	},
	db: Database.Database = getDb()
): void {
	if (fact.originKey && heldByOther(fact.originKey, fact.seriesId, db))
		throw new SeasonFactError('That source entry is another series in the library');
	db.prepare(
		`INSERT INTO series_season_facts (series_id, season, origin_key, folder, source_title)
		VALUES (@series, @season, @key, @folder, @title)
		ON CONFLICT (series_id, season) DO UPDATE SET origin_key = excluded.origin_key,
			folder = excluded.folder, source_title = excluded.source_title`
	).run({
		series: fact.seriesId,
		season: fact.season,
		key: fact.originKey ?? null,
		folder: fact.folder ?? null,
		title: fact.sourceTitle ?? ''
	});
}

/**
 * An anime's positions are one run across its seasons (migration 47): put them
 * back in reading order. Season facts mean episodes arrive from several
 * sources, each numbering from one, so a check needs this as a MOVE does.
 */
export function resequenceAnime(db: Database.Database, seriesId: number): void {
	const rows = db
		.prepare(`SELECT id, position, season, episode_number FROM entries WHERE series_id = ?`)
		.all(seriesId) as {
		id: number;
		position: number;
		season: number | null;
		episode_number: number | null;
	}[];
	rows.sort(
		(a, b) =>
			(a.season ?? 0) - (b.season ?? 0) ||
			(a.episode_number ?? a.position) - (b.episode_number ?? b.position) ||
			a.id - b.id
	);
	const set = db.prepare(`UPDATE entries SET position = ? WHERE id = ?`);
	rows.forEach((r, i) => set.run(i + 1, r.id));
}

/**
 * The facts one GROUP AS ONE SHOW row's second line draws:
 * `<SOURCE> · 12 EP. · 2026 · 6 WATCHED · 3 HERE`.
 * The episode count and WATCHED come off the library card the selection
 * already keeps; these three are the rest, and each one's writer is named
 * beside it:
 *
 * - **`source`** is the season's own source, the name its SOURCE row shows:
 *   `engine_sources.name` for the id in the key `seasonOrigin` answers
 *   (`move.ts`'s `sourceName`). A series with no source answers null.
 * - **`year`** is the season's AniList entry, `series_season_links.year`, which
 *   `season-links.ts` writes from the catalogue's `seasonYear`, not an
 *   arrival date.
 * - **`here`** is a file on disk: `entries.available = 1`, which for an anime
 *   is what `import/write.ts` sets when the episode's file is named. It is not
 *   "has a source" and not "watched".
 *
 * Only the series the viewer can see are answered (`libraryWhere`), so a
 * hidden series outside reveal is never read for, nor drawn.
 */
export type ShowRowFacts = { source: string | null; year: number | null; here: number };

export function showRowFacts(
	ids: readonly number[],
	reveal: boolean,
	db: Database.Database = getDb()
): Record<string, ShowRowFacts> {
	const out: Record<string, ShowRowFacts> = {};
	if (ids.length === 0) return out;
	// Only a kind whose seasons can merge draws this line (`mergeSeasons` asks
	// the registry's `medium`), and the library asks for every tile it draws:
	// without the narrowing this is five queries per tile for rows that can
	// never show a word of it.
	const mergeable = KINDS.filter((k) => kindFacts(k).medium === 'video');
	if (mergeable.length === 0) return out;
	const rows = db
		.prepare(
			`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.id IN (${ids.map(() => '?').join(',')})
			AND s.kind IN (${mergeable.map(() => '?').join(',')})
			AND ${libraryWhere(reveal)}`
		)
		.all(...ids, ...mergeable) as { id: number }[];
	const year = db.prepare(
		`SELECT year FROM series_season_links WHERE series_id = ? ORDER BY season, part LIMIT 1`
	);
	const here = db.prepare(
		`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND available = 1`
	);
	for (const row of rows) {
		const key = seasonOrigin(row.id, 0, db);
		// `engine_sources.name`, the column `sourceName` reads (move.ts); asked here
		// rather than imported, so this module stays out of the engine's own graph
		// (`site/`'s tsconfig reaches `books.ts`, and through it this file).
		const id = parseAnimeKey(key)?.sourceId ?? '';
		const source =
			(
				db.prepare(`SELECT name FROM engine_sources WHERE id = ?`).get(id) as
					{ name: string } | undefined
			)?.name || null;
		out[String(row.id)] = {
			source,
			year: (year.get(row.id) as { year: number | null } | undefined)?.year ?? null,
			here: (here.get(row.id) as { n: number }).n
		};
	}
	return out;
}
