import { getDb } from './db';
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
const VISIBLE = `(s.hidden = 0 AND r.hidden = 0)`;
const visibility = (reveal: boolean) => (reveal ? '1' : VISIBLE);

type CardRow = {
	id: number;
	title: string;
	kind: Kind;
	rating: number | null;
	favourite: number;
	hidden: number;
	hue: number;
	indexed_at: number | null;
	entry_count: number;
	read_count: number;
	new_count: number;
};

/**
 * The per-series aggregates every card needs. `new_count` is the entries that
 * arrived after the series was last opened -- "+3" means three chapters came
 * in since you last read it, not three unread. A series never opened has no
 * "new", only unread, so it reports 0 (the comparison with NULL is false).
 */
const CARD_SELECT = `
	SELECT s.id, s.title, s.kind, s.rating, s.favourite,
		(s.hidden OR r.hidden) AS hidden, s.hue, s.indexed_at,
		(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id) AS entry_count,
		(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.read_at IS NOT NULL) AS read_count,
		(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.added_at > (
			SELECT MAX(x.last_opened_at) FROM entries x WHERE x.series_id = s.id
		)) AS new_count
	FROM series s JOIN roots r ON r.id = s.root_id`;

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
		indexed: row.indexed_at !== null
	};
}

const ORDER: Record<Sort, string> = {
	recent: `(SELECT MAX(e.last_opened_at) FROM entries e WHERE e.series_id = s.id) DESC NULLS LAST, s.added_at DESC, s.id DESC`,
	title: `s.title COLLATE NOCASE ASC, s.id ASC`,
	rating: `s.rating DESC NULLS LAST, s.title COLLATE NOCASE ASC`,
	added: `s.added_at DESC, s.id DESC`
};

/** Where a shelf key narrows the listing. Unknown keys fall back to all. */
function shelfClause(shelf: string): { sql: string; params: unknown[] } {
	if (shelf === 'favourites') return { sql: 's.favourite = 1', params: [] };
	if (shelf === 'rated4') return { sql: 's.rating >= 4', params: [] };
	if (shelf === 'new') {
		return {
			sql: 's.scan_job_id = (SELECT MAX(id) FROM scan_jobs)',
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
			`${CARD_SELECT}
			WHERE ${visibility(opts.reveal)} AND ${shelf.sql} AND ${tag.sql}
			ORDER BY ${ORDER[opts.sort ?? 'recent']}
			LIMIT ?`
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
export function continueReading(
	reveal: boolean,
	limit = 4
): { items: ContinueItem[]; total: number } {
	const db = getDb();
	const open = `
		FROM series s JOIN roots r ON r.id = s.root_id
		WHERE ${visibility(reveal)}
			AND EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.last_opened_at IS NOT NULL)
			AND EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.read_at IS NULL)`;
	const total = (db.prepare(`SELECT COUNT(*) AS n ${open}`).get() as { n: number }).n;
	const rows = db
		.prepare(
			`${CARD_SELECT}
			WHERE s.id IN (SELECT s.id ${open})
			ORDER BY (SELECT MAX(e.last_opened_at) FROM entries e WHERE e.series_id = s.id) DESC
			LIMIT ?`
		)
		.all(limit) as CardRow[];
	const last = db.prepare(
		`SELECT label, last_opened_at FROM entries WHERE series_id = ? AND last_opened_at IS NOT NULL
		ORDER BY last_opened_at DESC LIMIT 1`
	);
	const items = rows.map((row) => {
		const entry = last.get(row.id) as { label: string; last_opened_at: number };
		return { ...toCard(row), entryLabel: entry.label, lastReadAt: entry.last_opened_at };
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
			`${CARD_SELECT}
			WHERE s.id IN (SELECT s.id ${matched})
			ORDER BY (s.title LIKE @like ESCAPE '\\') DESC, s.title COLLATE NOCASE
			LIMIT @limit`
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
	const row = db.prepare(`${CARD_SELECT} WHERE s.id = ? AND ${visibility(reveal)}`).get(id) as
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
	const next = db
		.prepare(
			`SELECT label FROM entries WHERE series_id = ? AND read_at IS NULL ORDER BY position LIMIT 1`
		)
		.get(id) as { label: string } | undefined;
	return {
		...toCard(row),
		collections,
		artist: artist?.value ?? null,
		nextEntry: next?.label ?? null
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

export function setHidden(ids: number[], hidden: boolean): number {
	if (ids.length === 0) return 0;
	return getDb()
		.prepare(`UPDATE series SET hidden = ? WHERE id IN (${inList(ids)})`)
		.run(hidden ? 1 : 0, ...ids).changes;
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
	const row = getDb()
		.prepare(
			`SELECT * FROM scan_jobs WHERE finished_at IS NULL OR dismissed_at IS NULL
			ORDER BY (finished_at IS NULL) DESC, id DESC LIMIT 1`
		)
		.get() as Record<string, number | string | null> | undefined;
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
