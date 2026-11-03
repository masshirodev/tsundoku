import { watchingAt } from '$lib/library/anime';
import { getDb } from './db';
import { m } from '../paraglide/messages.js';
import { HIDDEN_SQL, IN_LIBRARY_SQL, VISIBLE_SQL } from './visibility.ts';
import { getSetting } from './settings.ts';
import { langCode, openingEdition } from '$lib/library/editions';
import { likePattern } from '$lib/library/search';
import { dayStart, FILTER_KINDS, type FilterKind, type Filters } from '$lib/library/filters';
import { naturalDir, type Dir, type Sort } from '$lib/library/labels';
import {
	continuePart,
	facePart,
	inOrder,
	partState,
	type ContinueLine,
	type LibraryCard,
	type WorkTile
} from '$lib/library/works';
import { partsOfWorks, workRecords } from './works.ts';
import type {
	Kind,
	Rating,
	ScanJob,
	SeriesCard,
	SeriesDetail,
	Shelf,
	TagHit
} from '$lib/library/types';

/**
 * Every read here takes `reveal`. With it off, a hidden series -- hidden
 * directly or by its root -- is not listed, counted, searched or suggested,
 * and no count anywhere includes it. "Hidden means hidden" is enforced in SQL
 * rather than filtered in the page, so a hidden title never reaches the
 * browser at all while reveal is off.
 */
const VISIBLE = VISIBLE_SQL;
// Every listing here is the library's, so a browsing record is never in one.
const visibility = (reveal: boolean) =>
	reveal ? IN_LIBRARY_SQL : `${VISIBLE} AND ${IN_LIBRARY_SQL}`;

type CardRow = {
	id: number;
	title: string;
	kind: Kind;
	rating: number;
	favourite: number;
	hidden: number;
	hue: number;
	indexed_at: number | null;
	added_at: number;
	entry_count: number;
	read_count: number;
	new_count: number;
	cover_at: number | null;
	available: number;
	followed: number;
	opened: number;
	last_opened_at: number | null;
	language?: string | null;
	work_id?: number | null;
	work_name?: string | null;
	work_part?: number | null;
	work_size?: number | null;
};

/**
 * The per-series aggregates every card needs, for the series `where` picks
 * (with `s` and `r` in scope), in `order`. `new_count` is the entries that
 * arrived after the series was last opened -- "+3" means three chapters came
 * in since you last read it, not three unread. A series never opened has no
 * "new", only unread, so it reports 0 (the comparison with NULL is false).
 *
 * One grouped pass over the picked series' entries, not a subquery per
 * series: correlated counts re-ran MAX(last_opened_at) for every entry row,
 * and took the real library's ALL shelf 1.9 s (card "Make the library fast").
 * This takes about 16 ms, with the covering index `entries_card` (rung 12).
 * MATERIALIZED keeps SQLite from flattening it back into the slow shape.
 */
function cardQuery(where: string, order: string, limit = ''): string {
	return `
	WITH picked AS MATERIALIZED (
		SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id WHERE ${where}
	), stats AS MATERIALIZED (
		SELECT e.series_id,
			SUM(e.shadowed = 0 AND e.matter = '') AS entry_count,
			SUM(e.shadowed = 0 AND e.matter = '' AND e.read_at IS NOT NULL) AS read_count,
			MAX(e.last_opened_at) AS last_opened,
			MAX(e.available) AS available
		FROM entries e WHERE e.series_id IN (SELECT id FROM picked) GROUP BY e.series_id
	), langs AS MATERIALIZED (
		SELECT st.series_id, MIN(t.value) AS language FROM series_tags st JOIN tags t ON t.id = st.tag_id
		WHERE st.series_id IN (SELECT id FROM picked) AND t.namespace = 'language'
			AND t.value NOT IN ('translated', 'rewrite', 'speechless', 'text cleaned')
		GROUP BY st.series_id
	), fresh AS MATERIALIZED (
		SELECT e.series_id, COUNT(*) AS n FROM entries e JOIN stats t ON t.series_id = e.series_id
		WHERE e.shadowed = 0 AND (e.added_at > t.last_opened
			OR (e.read_at IS NULL AND COALESCE(e.arrived_at, 0) > t.last_opened))
		GROUP BY e.series_id
	)
	SELECT s.id, s.title, s.kind, s.rating, s.favourite,
		${HIDDEN_SQL} AS hidden, s.hue, s.indexed_at, s.added_at,
		s.cover_at,
		COALESCE(t.entry_count, 0) AS entry_count,
		COALESCE(t.read_count, 0) AS read_count,
		COALESCE(f.n, 0) AS new_count,
		COALESCE(t.available, 0) AS available,
		s.followed_at IS NOT NULL AS followed,
		t.last_opened IS NOT NULL AS opened,
		t.last_opened AS last_opened_at,
		l.language,
		ws.work_id AS work_id, w.name AS work_name, ws.position AS work_part,
		(SELECT COUNT(*) FROM work_series n WHERE n.work_id = ws.work_id) AS work_size
	FROM picked p JOIN series s ON s.id = p.id JOIN roots r ON r.id = s.root_id
	LEFT JOIN stats t ON t.series_id = s.id LEFT JOIN fresh f ON f.series_id = s.id
	LEFT JOIN langs l ON l.series_id = s.id
	LEFT JOIN work_series ws ON ws.series_id = s.id LEFT JOIN works w ON w.id = ws.work_id
	ORDER BY ${order} ${limit}`;
}

/**
 * Folded books among `cards` (doc/EDITIONS.md): each wears its opening
 * edition's title and says its languages. One indexed look at the editions,
 * however long the page; a library without any folded book pays nothing more.
 */
function withEditions<T extends SeriesCard>(cards: T[]): T[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT e.series_id, e.id, e.title, e.language, e.edition_of FROM entries e
			WHERE e.edition_of IS NOT NULL OR e.id IN (SELECT edition_of FROM entries WHERE edition_of IS NOT NULL)
			ORDER BY e.edition_of IS NOT NULL, e.id`
		)
		.all() as {
		series_id: number;
		id: number;
		title: string;
		language: string | null;
		edition_of: number | null;
	}[];
	if (!rows.length) return cards;
	const bySeries = Map.groupBy(rows, (r) => r.series_id);
	const state = new Map(
		(
			db
				.prepare(
					`SELECT id, edition_lang, edition_read FROM series WHERE id IN (${[...bySeries.keys()].join(',')})`
				)
				.all() as { id: number; edition_lang: string | null; edition_read: string | null }[]
		).map((s) => [s.id, s])
	);
	const preferred = getSetting('edition_language');
	return cards.map((c) => {
		const eds = bySeries.get(c.id);
		if (!eds || eds.length < 2) return c;
		const s = state.get(c.id);
		const pick = openingEdition(
			eds.map((e) => ({
				entryId: e.id,
				language: e.language ?? '',
				rows: [],
				base: e.edition_of === null
			})),
			{ own: s?.edition_lang ?? null, preferred, lastRead: s?.edition_read ?? null }
		);
		const first = eds.find((e) => e.id === pick.entryId)!;
		return {
			...c,
			title: first.title || c.title,
			languages: [first, ...eds.filter((e) => e !== first)].map((e) => langCode(e.language ?? '??'))
		};
	});
}

function toCard(row: CardRow): LibraryCard {
	return {
		id: row.id,
		title: row.title,
		kind: row.kind,
		rating: row.rating as Rating,
		favourite: row.favourite === 1,
		hidden: row.hidden === 1,
		newCount: row.new_count,
		entryCount: row.entry_count,
		readCount: row.read_count,
		hue: row.hue,
		indexed: row.indexed_at !== null,
		addedAt: row.added_at,
		cover: row.cover_at,
		downloaded: row.available === 1,
		followed: row.followed === 1,
		opened: row.opened === 1,
		lastOpenedAt: row.last_opened_at,
		language: row.language ?? null,
		work:
			row.work_id == null
				? null
				: {
						id: row.work_id,
						name: row.work_name ?? '',
						part: row.work_part ?? 0,
						of: row.work_size ?? 0
					}
	};
}

/**
 * RANDOM: a multiplicative hash of the id and the seed, so a seed is one fixed
 * shuffle -- paging through it never repeats a card, and back finds it again.
 * The seed is an integer parsed from the URL (parseSeed), never text.
 */
const randomOrder = (seed: number) => {
	const k = Math.trunc(seed);
	// Mixed, then squared, modulo a prime under 2^31: every step stays inside
	// SQLite's 64-bit integers, and neighbouring ids and seeds land far apart.
	// The seed is its own term, apart from the id: added to it, seed n + 1 would
	// only be seed n's order shifted by one.
	const h = `((s.id * 1103515245 + ${k} * 40503 + 12345) % 2147483647)`;
	return `((${h} * ${h}) % 2147483647), s.id`;
};

const orderOf = (sort: Sort, dir: Dir, seed = 1) =>
	sort === 'random' ? randomOrder(seed) : ORDER[sort](dir.toUpperCase() as 'ASC' | 'DESC');

/** NEWEST on the NEW shelf is by arrival: added_at is the source's date (rung 34). */
const orderFor = (opts: { shelf?: string; sort?: Sort; dir?: Dir; seed?: number }) => {
	const sort = opts.sort ?? 'recent';
	const dir = opts.dir ?? naturalDir(sort);
	return opts.shelf === 'new' && sort === 'added'
		? `s.arrived_at ${dir.toUpperCase()}, s.id ${dir.toUpperCase()}`
		: orderOf(sort, dir, opts.seed);
};

/**
 * PROGRESS's tiers (doc/LIBRARY.md, "Sort and direction"), as progressOf
 * decides them: begun and unfinished (one page opened is begun), then never
 * opened, then the rest, which is the finished. ↓ puts the begun first, ↑
 * last; inside a tier it's always most recent first, by last read or, never
 * opened, by date added.
 */
function progressTier(d: 'ASC' | 'DESC'): string {
	const read = 'COALESCE(t.read_count, 0)';
	const begun = `(t.last_opened IS NOT NULL OR ${read} > 0)`;
	const reading = `(${begun} AND ${read} < COALESCE(t.entry_count, 0))`;
	return d === 'DESC'
		? `CASE WHEN ${reading} THEN 0 WHEN NOT ${begun} THEN 1 ELSE 2 END`
		: `CASE WHEN NOT ${begun} THEN 0 WHEN ${reading} THEN 2 ELSE 1 END`;
}

/**
 * Each sort in either direction (`?dir=`). Never-read series stay last under
 * RECENTLY READ both ways: turned round it's the longest-untouched first, not
 * the never-opened. RATING's ties stay A–Z whichever way it runs.
 */
const ORDER: Record<Exclude<Sort, 'random'>, (d: 'ASC' | 'DESC') => string> = {
	progress: (d) => `${progressTier(d)}, COALESCE(t.last_opened, s.added_at) DESC, s.id DESC`,
	recent: (d) => `t.last_opened ${d} NULLS LAST, s.added_at ${d}, s.id ${d}`,
	title: (d) => `s.title COLLATE NOCASE ${d}, s.id ${d}`,
	rating: (d) => `s.rating ${d}, s.title COLLATE NOCASE ASC, s.id ASC`,
	added: (d) => `s.added_at ${d}, s.id ${d}`
};

/**
 * The import the library is showing: the newest one (a running import is
 * always the newest, run() closes the rest first), while it runs or until it
 * is dismissed. Never an older one: an import that brought nothing dismisses
 * itself, and reaching past it handed the band back to whichever import last
 * brought something, days before (21 such on 2026-11-02, one dismissal each).
 * The band is about it; the NEW shelf is not (NEW_SQL).
 */
const CURRENT_SCAN_ID = `SELECT id FROM scan_jobs WHERE id = (SELECT MAX(id) FROM scan_jobs)
	AND (finished_at IS NULL OR dismissed_at IS NULL)`;

/** How long an arrival stays on the NEW shelf unopened (doc/LIBRARY.md). */
export const NEW_DAYS = 14;

/**
 * The NEW shelf: a series that arrived (made by an import, or a chapter's
 * file came in, rung 34) in the last NEW_DAYS and hasn't been opened since.
 * Not tied to an import: a later one, or TIDY NEW, mustn't empty it.
 */
const NEW_SQL = `(s.arrived_at > ? AND NOT EXISTS (SELECT 1 FROM entries e
	WHERE e.series_id = s.id AND e.last_opened_at >= s.arrived_at))`;
const newSince = (now = Date.now()) => now - NEW_DAYS * 86_400_000;

/** Where a shelf key narrows the listing. Unknown keys fall back to all. */
/**
 * A single book: a doujin series holding one (isSingleton, src/lib/server/books.ts).
 * ONE-OFF is these; SERIES is everything else (Library Filters turn 3). A
 * Mihon series with one chapter so far is still a series.
 */
const ONE_OFF_SQL = `(s.kind = 'doujin' AND (SELECT COUNT(*) FROM entries e
	WHERE e.series_id = s.id AND e.shadowed = 0) <= 1)`;

/** Something to read without the internet: a chapter on disk. */
const DOWNLOADED_SQL =
	'EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.available = 1)';

/**
 * READING (`?progress=`), as progressOf in src/lib/library/filters.ts.
 * UNREAD: no entry opened, not a page, and none read (a counted one: not
 * shadowed, not front matter). READ: begun, and no counted entry left unread.
 */
const BEGUN_SQL = `EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id
	AND (e.last_opened_at IS NOT NULL
		OR (e.shadowed = 0 AND e.matter = '' AND e.read_at IS NOT NULL)))`;
const PROGRESS_SQL = {
	unread: `NOT ${BEGUN_SQL}`,
	read: `(${BEGUN_SQL} AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id
		AND e.shadowed = 0 AND e.matter = '' AND e.read_at IS NULL))`
};

/** `language:` values that describe a book rather than name a language. */
const NOT_LANGUAGES = `('translated', 'rewrite', 'speechless', 'text cleaned')`;

function shelfClause(shelf: string): { sql: string; params: unknown[] } {
	if (shelf === 'series') return { sql: `NOT ${ONE_OFF_SQL}`, params: [] };
	if (shelf === 'oneoff') return { sql: ONE_OFF_SQL, params: [] };
	if (shelf === 'new') return { sql: NEW_SQL, params: [newSince()] };
	const kind = /^k:(manga|manhwa|novel|anime)$/.exec(shelf);
	if (kind) return { sql: 's.kind = ?', params: [kind[1]] };
	const collection = /^c:(\d+)$/.exec(shelf);
	if (collection) {
		return {
			sql: 's.id IN (SELECT series_id FROM collection_series WHERE collection_id = ?)',
			params: [Number(collection[1])]
		};
	}
	const root = /^r:(\d+)$/.exec(shelf);
	if (root) return { sql: 's.root_id = ?', params: [Number(root[1])] };
	return { sql: '1', params: [] };
}

function tagClause(tag: string | null): { sql: string; params: unknown[] } {
	if (!tag) return { sql: '1', params: [] };
	const at = tag.indexOf(':');
	const namespace = at < 0 ? '' : tag.slice(0, at);
	const value = at < 0 ? tag : tag.slice(at + 1);
	return {
		sql: `s.id IN (SELECT st.series_id FROM series_tags st JOIN tags t ON t.id = st.tag_id
			WHERE t.namespace = ? AND t.value = ?)`,
		params: [namespace, value]
	};
}

type ListOpts = {
	reveal: boolean;
	shelf?: string;
	tag?: string | null;
	sort?: Sort;
	/** The sort's direction; its natural one when absent. */
	dir?: Dir;
	/** The FILTER panel's narrowing (doc/FILTERS.md), on top of the shelf. */
	filters?: Filters;
};

/**
 * The `language:` values and edition languages that write as `code` (`ja`
 * is `japanese`), across the whole library: what `?lang=` asks for. Names,
 * because that's how both are stored.
 */
function languageNames(code: string): string[] {
	const rows = getDb()
		.prepare(
			`SELECT t.value AS name FROM tags t WHERE t.namespace = 'language'
				AND t.value NOT IN ${NOT_LANGUAGES}
			UNION SELECT DISTINCT language FROM entries WHERE language IS NOT NULL`
		)
		.all() as { name: string }[];
	return rows.map((r) => r.name).filter((n) => langCode(n).toLowerCase() === code);
}

/**
 * The filters as SQL, with `s` in scope. HIDDEN is only ever asked for with
 * reveal on: parseFilters drops it otherwise, and this checks again.
 */
function filterClause(f: Filters | undefined, reveal: boolean): { sql: string; params: unknown[] } {
	if (!f) return { sql: '1', params: [] };
	const sql: string[] = [];
	const params: unknown[] = [];
	if (f.unrated) sql.push('s.rating = 0');
	else if (f.min !== null) {
		sql.push('s.rating >= ?');
		params.push(f.min);
	}
	if (f.fav !== null) {
		sql.push('s.favourite = ?');
		params.push(f.fav);
	}
	if (f.kind) {
		sql.push('s.kind = ?');
		params.push(f.kind);
	}
	if (f.lang) {
		const names = languageNames(f.lang);
		if (names.length === 0) sql.push('0');
		else {
			const marks = names.map(() => '?').join(', ');
			// A folded book matches each of its languages (doc/EDITIONS.md).
			sql.push(`(s.id IN (SELECT st.series_id FROM series_tags st JOIN tags t ON t.id = st.tag_id
				WHERE t.namespace = 'language' AND t.value IN (${marks}))
				OR EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.language IN (${marks})))`);
			params.push(...names, ...names);
		}
	}
	if (f.added) {
		sql.push('s.added_at >= ?');
		params.push(dayStart(f.added));
	}
	if (f.dl !== null) sql.push(f.dl ? DOWNLOADED_SQL : `NOT ${DOWNLOADED_SQL}`);
	if (f.followed) sql.push('s.followed_at IS NOT NULL');
	if (f.progress) sql.push(PROGRESS_SQL[f.progress]);
	if (f.hidden && reveal) sql.push(HIDDEN_SQL);
	return { sql: sql.length ? sql.join(' AND ') : '1', params };
}

function listWhere(opts: ListOpts): { sql: string; params: unknown[] } {
	const shelf = shelfClause(opts.shelf ?? 'all');
	const tag = tagClause(opts.tag ?? null);
	const filters = filterClause(opts.filters, opts.reveal);
	return {
		sql: `${visibility(opts.reveal)} AND ${shelf.sql} AND ${tag.sql} AND ${filters.sql}`,
		params: [...shelf.params, ...tag.params, ...filters.params]
	};
}

/** The kinds on a shelf as it stands without filters, in KIND's order: what KIND offers. */
export function kindsOn(opts: Omit<ListOpts, 'filters'>): FilterKind[] {
	const where = listWhere({ ...opts, filters: undefined });
	const have = new Set(
		(
			getDb()
				.prepare(
					`SELECT DISTINCT s.kind FROM series s JOIN roots r ON r.id = s.root_id WHERE ${where.sql}`
				)
				.all(...where.params) as { kind: string }[]
		).map((r) => r.kind)
	);
	return FILTER_KINDS.filter((k) => have.has(k));
}

/**
 * The languages on a shelf as it stands without filters, as lower-case codes:
 * what LANGUAGE offers. Only what the viewer can see; never `translated`.
 */
export function languagesOn(opts: Omit<ListOpts, 'filters'>): string[] {
	const where = listWhere({ ...opts, filters: undefined });
	const rows = getDb()
		.prepare(
			`WITH picked AS MATERIALIZED (
				SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id WHERE ${where.sql}
			)
			SELECT DISTINCT t.value AS name FROM series_tags st JOIN tags t ON t.id = st.tag_id
				WHERE st.series_id IN (SELECT id FROM picked) AND t.namespace = 'language'
					AND t.value NOT IN ${NOT_LANGUAGES}
			UNION SELECT DISTINCT e.language FROM entries e
				WHERE e.series_id IN (SELECT id FROM picked) AND e.language IS NOT NULL`
		)
		.all(...where.params) as { name: string }[];
	return [...new Set(rows.map((r) => langCode(r.name).toLowerCase()))].sort();
}

/**
 * A shelf's cards in order. `limit` and `offset` page through it: the library
 * grid loads a page at a time as it scrolls (doc/LIBRARY.md, "Pages"). With
 * no limit, all of them.
 */
export function listSeries(
	opts: ListOpts & { limit?: number; offset?: number; seed?: number }
): LibraryCard[] {
	const where = listWhere(opts);
	const rows = getDb()
		.prepare(cardQuery(where.sql, orderFor(opts), 'LIMIT ? OFFSET ?'))
		// SQLite reads a negative LIMIT as none.
		.all(...where.params, opts.limit ?? -1, opts.offset ?? 0) as CardRow[];
	return withEditions(rows.map(toCard));
}

/** How many cards a shelf holds: what paging runs up to. */
export function countListed(opts: ListOpts): number {
	return countTilesOn(opts);
}

/**
 * Every series id a shelf's tiles hold, in no order: what SELECT ALL means
 * now that a tile can be a Work. A Work contributes every part the viewer can
 * see, not only the one that put it on the shelf -- a kind, collection, NEW or
 * FAV shelf picks one part, and selecting only that one would leave the Work
 * diverged under a bulk HIDE (doc/WORKS.md).
 */
export function tileIds(opts: ListOpts & { seed?: number }): number[] {
	const where = listWhere(opts);
	const sort = opts.sort ?? 'recent';
	const order = unitOrder(sort, opts.dir ?? naturalDir(sort), opts.shelf, opts.seed);
	const rows = getDb()
		.prepare(unitQuery(where.sql, visibility(opts.reveal), order))
		.all(...where.params) as UnitRow[];
	const workIds = [...new Set(rows.map((r) => r.workId).filter((id): id is number => id != null))];
	const parts = byWork(partsOfWorks(workIds, opts.reveal));
	const ids = new Set<number>();
	for (const row of rows) {
		if (row.workId == null) ids.add(row.seriesId);
		else for (const p of parts.get(row.workId) ?? []) ids.add(p.seriesId);
	}
	return [...ids];
}

export function countSeries(reveal: boolean): number {
	const row = getDb()
		.prepare(
			`SELECT COUNT(*) AS n FROM series s JOIN roots r ON r.id = s.root_id WHERE ${visibility(reveal)}`
		)
		.get() as { n: number };
	return row.n;
}

/**
 * Every card the library holds, counting tiles: a Work of three parts is one.
 * The sidebar's ALL and "is the library empty" must count what the grid draws
 * (doc/WORKS.md, "The one rule"), or a Work makes the count disagree with the
 * screen on its own.
 */
export function countTiles(reveal: boolean): number {
	return countUnitsOf(visibility(reveal), []);
}

/** A Work's parts grouped, for a page of tiles. */
function byWork(parts: ReturnType<typeof partsOfWorks>): Map<number, typeof parts> {
	const out = new Map<number, typeof parts>();
	for (const p of parts) {
		const list = out.get(p.workId);
		if (list) list.push(p);
		else out.set(p.workId, [p]);
	}
	return out;
}

/** The cards for these series, in one query: a page asks once, never per tile. */
function cardsOf(ids: number[]): Map<number, LibraryCard> {
	if (ids.length === 0) return new Map();
	const rows = getDb()
		.prepare(cardQuery(`s.id IN (${ids.map(() => '?').join(',')})`, 's.id'))
		.all(...ids) as CardRow[];
	return new Map(withEditions(rows.map(toCard)).map((c) => [c.id, c]));
}

/**
 * A Work's card: the face's own fields, with the marks a run carries -- any
 * part a favourite, the parts' new chapters summed, the parts' downloads
 * summed. The foot draws segments rather than rating bars (a Work has no
 * rating of its own), so the average is only what a focus line may say.
 */
function workCard(
	id: number,
	name: string,
	face: LibraryCard,
	parts: ReturnType<typeof partsOfWorks>,
	total: number
): LibraryCard & { tile: WorkTile } {
	const ordered = inOrder(parts);
	const rated = ordered.filter((p) => p.rating > 0);
	return {
		...face,
		title: name,
		rating: (rated.length
			? Math.round(rated.reduce((n, p) => n + p.rating, 0) / rated.length)
			: 0) as Rating,
		favourite: ordered.some((p) => p.favourite),
		hidden: ordered.some((p) => p.hidden),
		newCount: ordered.reduce((n, p) => n + p.newCount, 0),
		entryCount: ordered.reduce((n, p) => n + p.entries, 0),
		readCount: ordered.reduce((n, p) => n + p.read, 0),
		downloaded: ordered.some((p) => p.downloaded > 0),
		opened: ordered.some((p) => p.lastOpenedAt !== null),
		addedAt: Math.max(face.addedAt, ...ordered.map((p) => p.addedAt)),
		tile: {
			id,
			name,
			face,
			parts: ordered,
			total,
			newCount: ordered.reduce((n, p) => n + p.newCount, 0),
			downloaded: ordered.reduce((n, p) => n + p.downloaded, 0)
		} satisfies WorkTile
	};
}

type UnitRow = {
	workId: number | null;
	seriesId: number;
	workName: string | null;
	workTotal: number | null;
};

/**
 * A Work's place in an order is its most recent part's (doc/WORKS.md, "The one
 * rule"): its latest read, its newest chapter, its latest added. The keys are
 * aggregates over every part, so a Work sits where the part the owner would
 * open sits, not where its first part was added.
 */
function unitOrder(sort: Sort, dir: Dir, shelf: string | undefined, seed = 1): string {
	const d = dir.toUpperCase() as 'ASC' | 'DESC';
	if (sort === 'title') return `COALESCE(w.name, fs.title) COLLATE NOCASE ${d}, u.series ${d}`;
	if (sort === 'added')
		return shelf === 'new' ? `k.arrived_at ${d}, u.series ${d}` : `k.added_at ${d}, u.series ${d}`;
	if (sort === 'rating')
		return `COALESCE(k.rating, 0) ${d}, COALESCE(w.name, fs.title) COLLATE NOCASE ASC, u.series ASC`;
	if (sort === 'progress') {
		const begun = `(k.opened > 0 OR k.read_count > 0)`;
		const reading = `(${begun} AND k.read_count < k.entry_count)`;
		const tier =
			d === 'DESC'
				? `CASE WHEN ${reading} THEN 0 WHEN NOT ${begun} THEN 1 ELSE 2 END`
				: `CASE WHEN NOT ${begun} THEN 0 WHEN ${reading} THEN 2 ELSE 1 END`;
		return `${tier}, COALESCE(k.last_opened, k.added_at) DESC, u.series DESC`;
	}
	if (sort === 'random') {
		const k = Math.trunc(seed);
		const h = `(((COALESCE(u.work, 0) * 7919 + u.series) * 1103515245 + ${k} * 40503 + 12345) % 2147483647)`;
		return `((${h} * ${h}) % 2147483647), u.series`;
	}
	return `k.last_opened ${d} NULLS LAST, k.added_at ${d}, u.series ${d}`;
}

/**
 * The browse list's units: one row per Work whose any part is picked, and one
 * per series in no Work. The face is chosen among the picked parts by
 * CONTINUE's own rule, so on MANGA a Work of a manga and its anime wears the
 * manga's cover and on ALL it wears the part CONTINUE would open.
 *
 * Three independent reads, never one per tile: the units here, the page's
 * cards in `cardsOf`, and every part of every Work on the page in
 * `partsOfWorks` (doc/handoff-notes/works.md, the W1 gaps).
 */
function unitQuery(where: string, vis: string, order: string, limit = ''): string {
	return `
	WITH picked AS MATERIALIZED (
		SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id WHERE ${where}
	), wids AS MATERIALIZED (
		SELECT DISTINCT ws.work_id AS id FROM work_series ws JOIN picked p ON p.id = ws.series_id
	), members AS MATERIALIZED (
		SELECT ws.work_id AS work, ws.series_id AS series, ws.position AS position,
			(p.id IS NOT NULL) AS picked
		FROM work_series ws
		JOIN series s ON s.id = ws.series_id JOIN roots r ON r.id = s.root_id
		LEFT JOIN picked p ON p.id = ws.series_id
		WHERE ws.work_id IN (SELECT id FROM wids) AND ${vis}
		UNION ALL
		SELECT NULL, p.id, 0, 1 FROM picked p
		WHERE NOT EXISTS (SELECT 1 FROM work_series ws WHERE ws.series_id = p.id)
	), stats AS MATERIALIZED (
		SELECT e.series_id,
			SUM(e.shadowed = 0 AND e.matter = '') AS entry_count,
			SUM(e.shadowed = 0 AND e.matter = '' AND e.read_at IS NOT NULL) AS read_count,
			MAX(e.last_opened_at) AS last_opened
		FROM entries e WHERE e.series_id IN (SELECT series FROM members) GROUP BY e.series_id
	), keys AS MATERIALIZED (
		SELECT COALESCE(CAST(m.work AS TEXT), 's' || m.series) AS unit,
			MAX(st.last_opened) AS last_opened, MAX(s.arrived_at) AS arrived_at,
			MAX(s.added_at) AS added_at, AVG(NULLIF(s.rating, 0)) AS rating,
			SUM(COALESCE(st.entry_count, 0)) AS entry_count,
			SUM(COALESCE(st.read_count, 0)) AS read_count,
			COUNT(st.last_opened) AS opened
		FROM members m JOIN series s ON s.id = m.series
		LEFT JOIN stats st ON st.series_id = m.series
		GROUP BY unit
	), face AS MATERIALIZED (
		SELECT work, series FROM (
			SELECT m.work, m.series, ROW_NUMBER() OVER (PARTITION BY m.work ORDER BY
				m.picked DESC,
				CASE WHEN COALESCE(st.entry_count, 0) > 0
					AND COALESCE(st.read_count, 0) >= COALESCE(st.entry_count, 0) THEN 1 ELSE 0 END ASC,
				CASE WHEN st.last_opened IS NULL THEN 1 ELSE 0 END ASC,
				st.last_opened DESC, m.position ASC) AS rn
			FROM members m LEFT JOIN stats st ON st.series_id = m.series
			WHERE m.work IS NOT NULL
		) WHERE rn = 1
	), units AS MATERIALIZED (
		SELECT work, series FROM members WHERE work IS NULL
		UNION ALL SELECT work, series FROM face
	)
	SELECT u.work AS workId, u.series AS seriesId, w.name AS workName,
		(SELECT COUNT(*) FROM work_series x WHERE x.work_id = u.work) AS workTotal
	FROM units u LEFT JOIN works w ON w.id = u.work
	JOIN series fs ON fs.id = u.series
	LEFT JOIN keys k ON k.unit = COALESCE(CAST(u.work AS TEXT), 's' || u.series)
	ORDER BY ${order} ${limit}`;
}

/**
 * A shelf's cards as browsing draws them: a Work once, a series in no Work as
 * itself. `limit`/`offset` page the tiles, not the series underneath.
 */
export function listTiles(
	opts: ListOpts & { limit?: number; offset?: number; seed?: number }
): LibraryCard[] {
	const where = listWhere(opts);
	const sort = opts.sort ?? 'recent';
	const order = unitOrder(sort, opts.dir ?? naturalDir(sort), opts.shelf, opts.seed);
	const rows = getDb()
		.prepare(unitQuery(where.sql, visibility(opts.reveal), order, 'LIMIT ? OFFSET ?'))
		.all(...where.params, opts.limit ?? -1, opts.offset ?? 0) as UnitRow[];
	if (rows.length === 0) return [];
	const cards = cardsOf([...new Set(rows.map((r) => r.seriesId))]);
	const workIds = [...new Set(rows.map((r) => r.workId).filter((id): id is number => id != null))];
	const parts = byWork(partsOfWorks(workIds, opts.reveal));
	return rows.map((row) => {
		const face = cards.get(row.seriesId)!;
		if (row.workId == null) return { ...face, work: null };
		const own = parts.get(row.workId) ?? [];
		return workCard(row.workId, row.workName ?? face.title, face, own, row.workTotal ?? own.length);
	});
}

/**
 * How many tiles a shelf holds. The same two arms as `listTiles`: a Work whose
 * any part is picked is one, and a series in no Work is one. `where` is any
 * clause over `s` and `r` (the shelf, a tag, the filters), and its params
 * appear twice -- once in each arm.
 */
function countUnitsOf(where: string, params: unknown[]): number {
	const free = `NOT EXISTS (SELECT 1 FROM work_series ws WHERE ws.series_id = s.id)`;
	const works = `EXISTS (SELECT 1 FROM work_series ws JOIN series s ON s.id = ws.series_id
		JOIN roots r ON r.id = s.root_id WHERE ws.work_id = w.id AND ${where})`;
	return (
		getDb()
			.prepare(
				`SELECT (
					(SELECT COUNT(*) FROM series s JOIN roots r ON r.id = s.root_id
						WHERE ${where} AND ${free})
					+ (SELECT COUNT(*) FROM works w WHERE ${works})
				) AS n`
			)
			.get(...params, ...params) as { n: number }
	).n;
}

/** How many tiles a shelf holds: what paging runs up to. */
export function countTilesOn(opts: ListOpts): number {
	const where = listWhere(opts);
	return countUnitsOf(where.sql, where.params);
}

/**
 * Series with an entry opened and not everything read, most recent first.
 * `total` is how many are open, which is what the section label counts; the
 * screen shows fewer on a phone.
 */
/**
 * Where ▶ resumes a series: the unread entry opened last, else the first
 * unread one, else the first. The same rule as the series screen's CONTINUE
 * (`currentEntry`), in SQL for the library's lists.
 */
export function resumeEntry(seriesId: number): { id: number; label: string } | null {
	return (
		(getDb()
			.prepare(
				`SELECT id, label FROM entries WHERE series_id = ? AND shadowed = 0 AND matter = ''
				ORDER BY (read_at IS NULL AND last_opened_at IS NOT NULL) DESC,
					CASE WHEN read_at IS NULL AND last_opened_at IS NOT NULL THEN -last_opened_at END,
					(read_at IS NULL) DESC, position
				LIMIT 1`
			)
			.get(seriesId) as { id: number; label: string } | undefined) ?? null
	);
}

export function continueReading(
	reveal: boolean,
	limit = 4
): { items: ContinueLine[]; total: number } {
	const db = getDb();
	const open = `
		FROM series s JOIN roots r ON r.id = s.root_id
		WHERE ${visibility(reveal)}
			AND EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.last_opened_at IS NOT NULL)
			AND EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0 AND e.matter = '' AND e.read_at IS NULL)`;
	const rows = db
		.prepare(cardQuery(`s.id IN (SELECT s.id ${open})`, `t.last_opened DESC`))
		.all() as CardRow[];
	// A book in a series of books is named by its place in the owner's order
	// ("Book 3"), since its own label is just "Book" (doc/BOOKS.md).
	const last = db.prepare(
		`SELECT e.id, e.position, e.label, e.last_opened_at, e.read_at, e.last_position, e.duration_s, e.season, e.episode_number,
			(SELECT COUNT(*) FROM entries x WHERE x.series_id = e.series_id AND x.shadowed = 0 AND x.position <= e.position) AS rank,
			EXISTS (SELECT 1 FROM entries x WHERE x.series_id = e.series_id AND x.season IS NOT NULL) AS seasons
		FROM entries e WHERE e.series_id = ? AND e.shadowed = 0 AND e.last_opened_at IS NOT NULL
		ORDER BY e.last_opened_at DESC LIMIT 1`
	);
	const cards = withEditions(rows.map(toCard));
	const byId = new Map(cards.map((c) => [c.id, c]));

	/** The label and the way in for a card, from the entry the owner last had open. */
	function entryLine(card: LibraryCard) {
		const entry = last.get(card.id) as
			| {
					id: number;
					position: number;
					label: string;
					last_opened_at: number;
					read_at: number | null;
					last_position: number | null;
					duration_s: number | null;
					season: number | null;
					episode_number: number | null;
					rank: number;
					seasons: number;
			  }
			| undefined;
		if (!entry) return null;
		// An episode says where watching got to: "S2 EP. 7 · 14:32 LEFT" (doc/ANIME.md).
		const entryLabel =
			card.kind === 'anime'
				? watchingAt(
						{
							id: entry.id,
							number: entry.position,
							readAt: entry.read_at,
							lastPosition: entry.last_position,
							lastOpenedAt: entry.last_opened_at,
							episode: {
								durationS: entry.duration_s,
								season: entry.season,
								number: entry.episode_number,
								note: '',
								thumb: '',
								endingAt: null
							}
						},
						entry.seasons === 1
					)
				: card.kind === 'doujin' && card.entryCount > 1
					? `Book ${entry.rank}`
					: entry.label;
		return {
			entryLabel,
			lastReadAt: entry.last_opened_at,
			resumeId: resumeEntry(card.id)?.id ?? null,
			...(card.kind === 'anime' && entry.duration_s && entry.last_position !== null
				? { entryFraction: Math.min(1, entry.last_position / entry.duration_s) }
				: {})
		};
	}

	// A Work is open when any part of it has ever been opened, and its CONTINUE
	// part is not the last finished one: a run read through to part 1 still
	// points at part 2 (Work-Library, the Akasaka row), which the series rule --
	// opened *and* something unread in the same series -- cannot say.
	const workIds = (
		db
			.prepare(
				`SELECT DISTINCT ws.work_id AS id FROM work_series ws
				JOIN series s ON s.id = ws.series_id JOIN roots r ON r.id = s.root_id
				WHERE ${visibility(reveal)} AND EXISTS (
					SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.last_opened_at IS NOT NULL)`
			)
			.all() as { id: number }[]
	).map((r) => r.id);
	const partsByWork = byWork(partsOfWorks(workIds, reveal));
	const works = new Map(workRecords(workIds).map((w) => [w.id, w]));
	type WorkPick = {
		seriesId: number;
		work: Omit<NonNullable<ContinueLine['work']>, 'partTitle'>;
		lastReadAt: number;
	};
	const picks: WorkPick[] = [];
	for (const id of workIds) {
		const own = partsByWork.get(id) ?? [];
		const work = works.get(id);
		if (!work || own.length === 0) continue;
		const current = continuePart(own);
		if (!current) continue;
		const part = inOrder(own).findIndex((p) => p.seriesId === current.seriesId) + 1;
		const upNext = partState(current) === 'not-started';
		picks.push({
			seriesId: current.seriesId,
			work: { id, name: work.name, part, of: own.length, upNext },
			lastReadAt: Math.max(0, ...own.map((p) => p.lastOpenedAt ?? 0))
		});
	}
	// The part CONTINUE opens may be the one it has not started, which the
	// open-series query above does not carry (it has no last open). One read for
	// all of them, never one per Work on the page.
	const missing = [...new Set(picks.map((p) => p.seriesId).filter((id) => !byId.has(id)))];
	const extra = cardsOf(missing);

	// Sort and slice on the card query's own fields first: `entryLine` costs two
	// prepared reads per row, and the section only ever shows `limit` of them.
	type Candidate = {
		card: LibraryCard;
		lastReadAt: number;
		work: (Omit<NonNullable<ContinueLine['work']>, 'partTitle'> & { partTitle: string }) | null;
	};
	const candidates: Candidate[] = [];
	for (const card of cards) {
		// A series in a Work is not a row of its own; the Work's row is below.
		if (card.work) continue;
		candidates.push({ card, lastReadAt: card.lastOpenedAt ?? 0, work: null });
	}
	for (const pick of picks) {
		const card = byId.get(pick.seriesId) ?? extra.get(pick.seriesId);
		if (!card) continue;
		candidates.push({
			card,
			lastReadAt: pick.lastReadAt,
			work: { ...pick.work, partTitle: card.title }
		});
	}
	candidates.sort((a, b) => b.lastReadAt - a.lastReadAt);
	const total = candidates.length;

	const items: ContinueLine[] = [];
	for (const candidate of candidates.slice(0, limit)) {
		const line = entryLine(candidate.card);
		if (line) {
			items.push({
				...candidate.card,
				...line,
				...(candidate.work ? { title: candidate.work.name } : {}),
				work: candidate.work
			});
			continue;
		}
		if (!candidate.work) continue;
		// Between parts: the next one has not been started, so ▶ opens its first
		// chapter and the row says UP NEXT (Work-Library, the Akasaka row).
		const first = resumeEntry(candidate.card.id);
		items.push({
			...candidate.card,
			title: candidate.work.name,
			entryLabel: first?.label ?? '',
			lastReadAt: candidate.lastReadAt,
			resumeId: first?.id ?? null,
			work: candidate.work
		});
	}

	return { items, total };
}

/** The kinds with a shelf of their own. Doujins are books, grouped by other means. */
// Functions, not words: a shelf's name is the reader's language, asked per request (doc/I18N.md).
const KIND_SHELVES = [
	['manga', m.nav_shelf_manga],
	['manhwa', m.nav_shelf_manhwa],
	['novel', m.nav_shelf_novel],
	['anime', m.nav_shelf_anime]
] as const;

export function listShelves(opts: { reveal: boolean; withNew: boolean }): Shelf[] {
	const db = getDb();
	const where = visibility(opts.reveal);
	// A shelf's count is its tiles (doc/WORKS.md): a Work of three parts is one.
	const n = (extra: string, ...params: unknown[]) => countUnitsOf(`${where} AND ${extra}`, params);

	const shelves: Shelf[] = [];
	// While an import runs, or while anything is new.
	const fresh = n(NEW_SQL, newSince());
	if (opts.withNew || fresh > 0)
		shelves.push({ key: 'new', name: m.nav_shelf_new(), kind: 'smart', count: fresh });
	shelves.push({ key: 'all', name: m.nav_shelf_all(), kind: 'smart', count: n('1') });
	// DOWNLOADED, FAVOURITES and RATED became filters (Library Filters turn
	// 3); SERIES and ONE-OFF split the library by what a thing is instead.
	shelves.push({
		key: 'series',
		name: m.nav_shelf_series(),
		kind: 'smart',
		count: n(`NOT ${ONE_OFF_SQL}`)
	});
	shelves.push({ key: 'oneoff', name: m.nav_shelf_oneoff(), kind: 'smart', count: n(ONE_OFF_SQL) });
	// One shelf per kind of reading, only while the library has some: a
	// library of manga alone doesn't need a MANHWA shelf reading 0.
	for (const [kind, name] of KIND_SHELVES) {
		const count = n('s.kind = ?', kind);
		if (count > 0) shelves.push({ key: `k:${kind}`, name: name(), kind: 'smart', count });
	}

	const collections = db
		.prepare(`SELECT id, name FROM collections ORDER BY position, id`)
		.all() as {
		id: number;
		name: string;
	}[];
	for (const c of collections) {
		shelves.push({
			key: `c:${c.id}`,
			name: c.name,
			kind: 'collection',
			count: n(shelfClause(`c:${c.id}`).sql, c.id)
		});
	}

	// A hidden root is itself a shelf while reveal is on, and does not exist
	// while it is off -- not even as a name.
	if (opts.reveal) {
		const roots = db.prepare(`SELECT id, name FROM roots WHERE hidden = 1 ORDER BY id`).all() as {
			id: number;
			name: string;
		}[];
		for (const r of roots)
			shelves.push({
				key: `r:${r.id}`,
				name: r.name,
				kind: 'root',
				count: n('s.root_id = ?', r.id)
			});
	}
	return shelves;
}

export type SearchResult = {
	tags: TagHit[];
	shelves: Shelf[];
	/**
	 * Works whose own name matched, drawn before their parts (doc/WORKS.md,
	 * "The one rule"): finding opens a Work only when its name is what was
	 * typed, and then it is the first thing found.
	 */
	works: WorkTile[];
	titles: (LibraryCard & { why: string })[];
	/** Tiles found: the matching Works plus the matching series. */
	titleTotal: number;
};

export function search(query: string, reveal: boolean, limit = 30): SearchResult {
	const db = getDb();
	const like = likePattern(query);
	const where = visibility(reveal);

	const tags = db
		.prepare(
			`SELECT t.namespace, t.value, COUNT(DISTINCT s.id) AS n
			FROM tags t JOIN series_tags st ON st.tag_id = t.id
			JOIN series s ON s.id = st.series_id JOIN roots r ON r.id = s.root_id
			WHERE t.value LIKE ? ESCAPE '\\' AND ${where}
			GROUP BY t.id ORDER BY n DESC, t.value LIMIT 8`
		)
		.all(like) as { namespace: string; value: string; n: number }[];

	const shelves = listShelves({ reveal, withNew: false }).filter(
		(s) => s.kind !== 'smart' && s.name.toLowerCase().includes(query.trim().toLowerCase())
	);

	// A title match ranks above a tag match, and each series appears once with
	// the reason it matched.
	const matched = `
		FROM series s JOIN roots r ON r.id = s.root_id
		WHERE ${where} AND (s.title LIKE @like ESCAPE '\\' OR s.id IN (
			SELECT st.series_id FROM series_tags st JOIN tags t ON t.id = st.tag_id
			WHERE t.value LIKE @like ESCAPE '\\'))`;
	const titleTotal = (db.prepare(`SELECT COUNT(*) AS n ${matched}`).get({ like }) as { n: number })
		.n;
	const rows = db
		.prepare(
			cardQuery(
				`s.id IN (SELECT s.id ${matched})`,
				`(s.title LIKE @like ESCAPE '\\') DESC, s.title COLLATE NOCASE`,
				'LIMIT @limit'
			)
		)
		.all({ like, limit }) as CardRow[];
	const firstTag = db.prepare(
		`SELECT t.namespace, t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
		WHERE st.series_id = ? AND t.value LIKE ? ESCAPE '\\' ORDER BY t.namespace, t.value LIMIT 1`
	);
	const q = query.trim().toLowerCase();
	const titles = rows.map((row) => {
		if (row.title.toLowerCase().includes(q)) return { ...toCard(row), why: 'TITLE' };
		const t = firstTag.get(row.id, like) as { namespace: string; value: string } | undefined;
		const why = t ? `TAG ${t.namespace ? `${t.namespace} · ` : ''}${t.value}` : 'TAG';
		return { ...toCard(row), why };
	});

	// A Work is found by its own name, whatever its parts are called: the run
	// is one thing and searching for it must not hide it behind a part.
	const workRows = db
		.prepare(
			`SELECT w.id, w.name FROM works w
			WHERE w.name LIKE @like ESCAPE '\\' AND EXISTS (
				SELECT 1 FROM work_series ws JOIN series s ON s.id = ws.series_id
				JOIN roots r ON r.id = s.root_id WHERE ws.work_id = w.id AND ${where})
			ORDER BY w.name COLLATE NOCASE, w.id LIMIT @limit`
		)
		.all({ like, limit }) as { id: number; name: string }[];
	const workIds = workRows.map((w) => w.id);
	const parts = byWork(partsOfWorks(workIds, reveal));
	// The face is CONTINUE's part, or the last part once the run is read
	// (`facePart`): a Work whose every part is finished is still one the owner
	// typed the name of, and leaving it out of the hits would hide it entirely.
	const faceIds = workIds
		.map((id) => facePart(parts.get(id) ?? [])?.seriesId)
		.filter((id): id is number => id !== undefined);
	const faces = cardsOf([...new Set(faceIds)]);
	const works: WorkTile[] = [];
	for (const row of workRows) {
		const own = parts.get(row.id) ?? [];
		const face = faces.get(facePart(own)?.seriesId ?? -1);
		if (!face) continue;
		works.push(workCard(row.id, row.name, face, own, own.length).tile);
	}

	return {
		tags: tags.map((t) => ({
			namespace: t.namespace || 'tag',
			value: t.value,
			count: t.n,
			key: `${t.namespace}:${t.value}`
		})),
		shelves,
		works,
		titles,
		titleTotal: titleTotal + works.length
	};
}

export function seriesDetail(id: number, reveal: boolean): SeriesDetail | null {
	const db = getDb();
	// Asked by id, a browsing record (doc/BROWSING.md) is found: its player and
	// reader run on it. Only hiddenness applies.
	const row = db.prepare(cardQuery(`s.id = ? AND ${reveal ? '1' : VISIBLE}`, 's.id')).get(id) as
		CardRow | undefined;
	if (!row) return null;
	const collections = (
		db.prepare(`SELECT collection_id FROM collection_series WHERE series_id = ?`).all(id) as {
			collection_id: number;
		}[]
	).map((r) => r.collection_id);
	const artist = db
		.prepare(
			`SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
			WHERE st.series_id = ? AND t.namespace = 'artist' ORDER BY t.value LIMIT 1`
		)
		.get(id) as { value: string } | undefined;
	const next = resumeEntry(id);
	return {
		...toCard(row),
		collections,
		artist: artist?.value ?? null,
		nextEntry: next?.label ?? null,
		nextEntryId: next?.id ?? null
	};
}

/**
 * Writes. Each takes the ids the owner acted on and touches only those; a
 * bulk action over three series is three rows changed and nothing else.
 */
function inList(ids: number[]): string {
	return ids.map(() => '?').join(',');
}

export function setRating(ids: number[], rating: Rating): number {
	if (ids.length === 0) return 0;
	const changed = getDb()
		.prepare(`UPDATE series SET rating = ? WHERE id IN (${inList(ids)})`)
		.run(rating, ...ids).changes;
	// The rating is the score AniList and MAL get (doc/TRACKING.md, "One
	// number"): sent behind the answer, never waited on.
	void import('./tracking.ts')
		.then((t) => t.afterRating(ids, rating))
		.catch((e: unknown) => console.error('tsundoku: sending a rating as a score failed:', e));
	// And a novel's rating is its work's on Ranobe (doc/RANOBE.md).
	void import('./ranobe.ts')
		.then((r) => r.afterRating(ids, rating))
		.catch((e: unknown) => console.error('tsundoku: sending a rating to Ranobe failed:', e));
	return changed;
}

export function setFavourite(ids: number[], favourite: boolean): number {
	if (ids.length === 0) return 0;
	const changed = getDb()
		.prepare(`UPDATE series SET favourite = ? WHERE id IN (${inList(ids)})`)
		.run(favourite ? 1 : 0, ...ids).changes;
	void import('./ranobe.ts')
		.then((r) => r.afterFavourite(ids, favourite))
		.catch((e: unknown) => console.error('tsundoku: sending a favourite to Ranobe failed:', e));
	return changed;
}

/**
 * HIDE and UNHIDE. Hiding sets the series' own flag and takes back any
 * `public`. Unhiding clears it, and in a hidden root also makes the series
 * public -- otherwise UNHIDE would change nothing the owner could see.
 */
export function setHidden(ids: number[], hidden: boolean): number {
	if (ids.length === 0) return 0;
	return getDb()
		.prepare(
			`UPDATE series SET hidden = ?,
				public = CASE WHEN ? = 1 THEN 0 ELSE (SELECT r.hidden FROM roots r WHERE r.id = series.root_id) END
			WHERE id IN (${inList(ids)})`
		)
		.run(hidden ? 1 : 0, hidden ? 1 : 0, ...ids).changes;
}

export function setInCollection(ids: number[], collectionId: number, on: boolean): number {
	const db = getDb();
	const stmt = on
		? db.prepare(`INSERT OR IGNORE INTO collection_series (collection_id, series_id) VALUES (?, ?)`)
		: db.prepare(`DELETE FROM collection_series WHERE collection_id = ? AND series_id = ?`);
	return db
		.transaction(() => ids.reduce((n, id) => n + stmt.run(collectionId, id).changes, 0))
		.immediate();
}

export function createCollection(name: string): number {
	const trimmed = name.trim();
	if (trimmed === '') throw new Error('a shelf needs a name');
	const db = getDb();
	const existing = db.prepare(`SELECT id FROM collections WHERE name = ?`).get(trimmed) as
		{ id: number } | undefined;
	if (existing) return existing.id;
	const position = (
		db.prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS p FROM collections`).get() as { p: number }
	).p;
	return Number(
		db.prepare(`INSERT INTO collections (name, position) VALUES (?, ?)`).run(trimmed, position)
			.lastInsertRowid
	);
}

export function collectionExists(id: number): boolean {
	return getDb().prepare(`SELECT 1 FROM collections WHERE id = ?`).get(id) !== undefined;
}

/**
 * The scan the screen should talk about: one still running, else the latest
 * finished one nobody has dismissed yet.
 */
export function currentScan(): ScanJob | null {
	const row = getDb().prepare(`SELECT * FROM scan_jobs WHERE id = (${CURRENT_SCAN_ID})`).get() as
		Record<string, number | string | null> | undefined;
	if (!row) return null;
	return {
		id: row.id as number,
		startedAt: row.started_at as number,
		finishedAt: row.finished_at as number | null,
		bytesDone: row.bytes_done as number,
		bytesTotal: row.bytes_total as number,
		seriesFound: row.series_found as number,
		sourceLabel: row.source_label as string,
		step: row.step as number,
		steps: row.steps as number,
		failedFiles: row.failed_files as number,
		dismissedAt: row.dismissed_at as number | null
	};
}

export function dismissScan(id: number, now = Date.now()): void {
	getDb()
		.prepare(`UPDATE scan_jobs SET dismissed_at = ? WHERE id = ? AND finished_at IS NOT NULL`)
		.run(now, id);
}

/** Whether a series the viewer can see is followed: FOLLOWED is offered only then. */
export function anyFollowed(reveal: boolean): boolean {
	return !!getDb()
		.prepare(
			`SELECT 1 FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.followed_at IS NOT NULL AND ${visibility(reveal)} LIMIT 1`
		)
		.get();
}
