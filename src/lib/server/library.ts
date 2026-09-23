import { getDb } from './db';
import { HIDDEN_SQL, VISIBLE_SQL } from './visibility.ts';
import { likePattern } from '$lib/library/search';
import type { Sort } from '$lib/library/labels';
import type {
	ContinueItem,
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
const visibility = (reveal: boolean) => (reveal ? '1' : VISIBLE);

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
			MAX(e.last_opened_at) AS last_opened
		FROM entries e WHERE e.series_id IN (SELECT id FROM picked) GROUP BY e.series_id
	), fresh AS MATERIALIZED (
		SELECT e.series_id, COUNT(*) AS n FROM entries e JOIN stats t ON t.series_id = e.series_id
		WHERE e.shadowed = 0 AND e.added_at > t.last_opened GROUP BY e.series_id
	)
	SELECT s.id, s.title, s.kind, s.rating, s.favourite,
		${HIDDEN_SQL} AS hidden, s.hue, s.indexed_at, s.added_at,
		s.cover_at,
		COALESCE(t.entry_count, 0) AS entry_count,
		COALESCE(t.read_count, 0) AS read_count,
		COALESCE(f.n, 0) AS new_count
	FROM picked p JOIN series s ON s.id = p.id JOIN roots r ON r.id = s.root_id
	LEFT JOIN stats t ON t.series_id = s.id LEFT JOIN fresh f ON f.series_id = s.id
	ORDER BY ${order} ${limit}`;
}

function toCard(row: CardRow): SeriesCard {
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
		cover: row.cover_at
	};
}

const ORDER: Record<Sort, string> = {
	recent: `t.last_opened DESC NULLS LAST, s.added_at DESC, s.id DESC`,
	title: `s.title COLLATE NOCASE ASC, s.id ASC`,
	rating: `s.rating DESC, s.title COLLATE NOCASE ASC`,
	added: `s.added_at DESC, s.id DESC`
};

/**
 * The import the library is showing: the one running, else the newest one
 * nobody has dismissed. The band, and the NEW shelf, are both about it.
 */
const CURRENT_SCAN_ID = `SELECT id FROM scan_jobs WHERE finished_at IS NULL OR dismissed_at IS NULL
	ORDER BY (finished_at IS NULL) DESC, id DESC LIMIT 1`;

/** Where a shelf key narrows the listing. Unknown keys fall back to all. */
function shelfClause(shelf: string): { sql: string; params: unknown[] } {
	if (shelf === 'favourites') return { sql: 's.favourite = 1', params: [] };
	if (shelf === 'rated4') return { sql: 's.rating >= 4', params: [] };
	if (shelf === 'new') {
		return {
			// The import the band is about, not the newest one: a later rescan
			// that found nothing closes its own band, and must not empty NEW
			// under a band still saying "23 SERIES".
			sql: `s.scan_job_id = (${CURRENT_SCAN_ID})`,
			params: []
		};
	}
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

export function listSeries(opts: {
	reveal: boolean;
	shelf?: string;
	tag?: string | null;
	sort?: Sort;
	limit?: number;
}): SeriesCard[] {
	const shelf = shelfClause(opts.shelf ?? 'all');
	const tag = tagClause(opts.tag ?? null);
	const rows = getDb()
		.prepare(
			cardQuery(
				`${visibility(opts.reveal)} AND ${shelf.sql} AND ${tag.sql}`,
				ORDER[opts.sort ?? 'recent'],
				'LIMIT ?'
			)
		)
		.all(...shelf.params, ...tag.params, opts.limit ?? 5000) as CardRow[];
	return rows.map(toCard);
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
): { items: ContinueItem[]; total: number } {
	const db = getDb();
	const open = `
		FROM series s JOIN roots r ON r.id = s.root_id
		WHERE ${visibility(reveal)}
			AND EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.last_opened_at IS NOT NULL)
			AND EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0 AND e.matter = '' AND e.read_at IS NULL)`;
	const total = (db.prepare(`SELECT COUNT(*) AS n ${open}`).get() as { n: number }).n;
	const rows = db
		.prepare(cardQuery(`s.id IN (SELECT s.id ${open})`, `t.last_opened DESC`, 'LIMIT ?'))
		.all(limit) as CardRow[];
	// A book in a series of books is named by its place in the owner's order
	// ("Book 3"), since its own label is just "Book" (doc/BOOKS.md).
	const last = db.prepare(
		`SELECT e.label, e.last_opened_at,
			(SELECT COUNT(*) FROM entries x WHERE x.series_id = e.series_id AND x.shadowed = 0 AND x.position <= e.position) AS rank
		FROM entries e WHERE e.series_id = ? AND e.shadowed = 0 AND e.last_opened_at IS NOT NULL
		ORDER BY e.last_opened_at DESC LIMIT 1`
	);
	const items = rows.map((row) => {
		const entry = last.get(row.id) as { label: string; last_opened_at: number; rank: number };
		const card = toCard(row);
		const entryLabel =
			card.kind === 'doujin' && card.entryCount > 1 ? `Book ${entry.rank}` : entry.label;
		return {
			...card,
			entryLabel,
			lastReadAt: entry.last_opened_at,
			resumeId: resumeEntry(row.id)?.id ?? null
		};
	});
	return { items, total };
}

export function listShelves(opts: { reveal: boolean; withNew: boolean }): Shelf[] {
	const db = getDb();
	const where = visibility(opts.reveal);
	const n = (extra: string, ...params: unknown[]) =>
		(
			db
				.prepare(
					`SELECT COUNT(*) AS n FROM series s JOIN roots r ON r.id = s.root_id WHERE ${where} AND ${extra}`
				)
				.get(...params) as { n: number }
		).n;

	const shelves: Shelf[] = [];
	if (opts.withNew)
		shelves.push({ key: 'new', name: 'New', kind: 'smart', count: n(shelfClause('new').sql) });
	shelves.push({ key: 'all', name: 'All', kind: 'smart', count: n('1') });
	shelves.push({
		key: 'favourites',
		name: 'Favourites',
		kind: 'smart',
		count: n('s.favourite = 1')
	});
	shelves.push({ key: 'rated4', name: 'Rated 4+', kind: 'smart', count: n('s.rating >= 4') });

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
	titles: (SeriesCard & { why: string })[];
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

	return {
		tags: tags.map((t) => ({
			namespace: t.namespace || 'tag',
			value: t.value,
			count: t.n,
			key: `${t.namespace}:${t.value}`
		})),
		shelves,
		titles,
		titleTotal
	};
}

export function seriesDetail(id: number, reveal: boolean): SeriesDetail | null {
	const db = getDb();
	const row = db.prepare(cardQuery(`s.id = ? AND ${visibility(reveal)}`, 's.id')).get(id) as
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
	return getDb()
		.prepare(`UPDATE series SET rating = ? WHERE id IN (${inList(ids)})`)
		.run(rating, ...ids).changes;
}

export function setFavourite(ids: number[], favourite: boolean): number {
	if (ids.length === 0) return 0;
	return getDb()
		.prepare(`UPDATE series SET favourite = ? WHERE id IN (${inList(ids)})`)
		.run(favourite ? 1 : 0, ...ids).changes;
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
