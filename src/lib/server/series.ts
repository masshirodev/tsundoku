import { getDb } from './db';
import { VISIBLE_SQL, visibleWhere } from './visibility';
import { seriesDetail } from './library';
import { scanlatorsOf } from './duplicates';
import type { Direction, SeriesEntry, SeriesPage, SeriesTag } from '$lib/library/series';

/**
 * Everything the series screen reads, and the writes only it makes. Reads
 * take `reveal` like every read in library.ts: a hidden series answers null
 * while reveal is off, so the page 404s exactly as for a series that does not
 * exist.
 */

type SeriesRow = {
	alt_titles: string;
	source: string;
	status: string;
	description: string;
	direction: Direction | null;
	path: string;
	scanlator: string | null;
};

type EntryRow = {
	id: number;
	position: number;
	label: string;
	title: string;
	read_at: number | null;
	last_position: number | null;
	last_opened_at: number | null;
	page_count: number;
	file: string;
	bytes: number;
	rating: number;
	favourite: number;
	added_at: number;
	cover_page: number | null;
	available: number;
	locator: string;
	matter: string;
	last_offset: number | null;
};

function parseAlts(raw: string): string[] {
	try {
		const v: unknown = JSON.parse(raw);
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

export function seriesPage(id: number, reveal: boolean): SeriesPage | null {
	const card = seriesDetail(id, reveal);
	if (!card) return null;
	const db = getDb();
	const row = db
		.prepare(
			`SELECT alt_titles, source, status, description, direction, path, scanlator FROM series WHERE id = ?`
		)
		.get(id) as SeriesRow;
	const entries = (
		db
			.prepare(
				`SELECT id, position, label, title, read_at, last_position, last_opened_at, page_count, file, bytes,
					rating, favourite, added_at, cover_page, available, locator, matter, last_offset
				FROM entries WHERE series_id = ? AND shadowed = 0 ORDER BY position, id`
			)
			.all(id) as EntryRow[]
	).map((e): SeriesEntry => ({
		id: e.id,
		number: e.position,
		label: e.label,
		title: e.title,
		readAt: e.read_at,
		lastPosition: e.last_position,
		lastOpenedAt: e.last_opened_at,
		pageCount: e.page_count,
		file: e.file,
		bytes: e.bytes,
		rating: e.rating as SeriesEntry['rating'],
		favourite: e.favourite === 1,
		addedAt: e.added_at,
		coverPage: e.cover_page,
		available: e.available === 1,
		locator: e.locator,
		matter: e.matter as SeriesEntry['matter'],
		lastOffset: e.last_offset,
		tags: []
	}));
	if (entries.length > 1) {
		// A series of books: each book carries its own tags.
		const byEntry = db.prepare(
			`SELECT t.namespace, t.value FROM entry_tags et JOIN tags t ON t.id = et.tag_id
			WHERE et.entry_id = ? ORDER BY t.namespace, t.value COLLATE NOCASE`
		);
		for (const e of entries) e.tags = byEntry.all(e.id) as SeriesTag[];
	}
	const tags = db
		.prepare(
			`SELECT t.namespace, t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
			WHERE st.series_id = ? ORDER BY t.namespace, t.value COLLATE NOCASE`
		)
		.all(id) as SeriesTag[];
	return {
		...card,
		altTitles: parseAlts(row.alt_titles),
		source: row.source,
		status: row.status,
		description: row.description,
		direction: row.direction,
		path: row.path,
		tags,
		entries,
		duplicates: (
			db
				.prepare(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND shadowed = 1`)
				.get(id) as { n: number }
		).n,
		scanlators: scanlatorsOf(id),
		scanlator: row.scanlator
	};
}

/**
 * Mark entries read or unread. Only ids belonging to `seriesId` are touched,
 * so a crafted form cannot reach into another series.
 */
export function markEntries(
	seriesId: number,
	ids: number[],
	read: boolean,
	now = Date.now()
): number {
	if (ids.length === 0) return 0;
	const db = getDb();
	const marks = ids.map(() => '?').join(',');
	return db
		.transaction(() => {
			// Only the entries that actually change state, so the log records what
			// happened rather than what was asked for.
			const changing = db
				.prepare(
					`SELECT id FROM entries WHERE series_id = ? AND id IN (${marks})
					AND read_at IS ${read ? '' : 'NOT '}NULL`
				)
				.all(seriesId, ...ids) as { id: number }[];
			const update = db.prepare(`UPDATE entries SET read_at = ? WHERE id = ?`);
			const log = db.prepare(
				`INSERT INTO reading_events (at, series_id, entry_id, kind) VALUES (?, ?, ?, ?)`
			);
			// The copies a chapter's representative stands for follow it, or the
			// next reconcile would carry an old "read" back (doc/DUPLICATES.md).
			const copies = db.prepare(
				`UPDATE entries SET read_at = ? WHERE series_id = ? AND shadowed = 1
				AND position = (SELECT position FROM entries WHERE id = ?)`
			);
			for (const { id } of changing) {
				update.run(read ? now : null, id);
				copies.run(read ? now : null, seriesId, id);
				// A manual mark is logged as a mark, not as reading: stats count it as
				// finished, never as time spent.
				log.run(now, seriesId, id, read ? 'mark_read' : 'mark_unread');
			}
			return changing.length;
		})
		.immediate();
}

/**
 * A long press on a chapter row (doc/SERIES.md): that chapter and every one
 * before it in reading order, read. Returns the ids that changed, so UNDO can
 * put back exactly those, and not a chapter that was already read.
 */
export function markReadThrough(seriesId: number, entryId: number, now = Date.now()): number[] {
	const db = getDb();
	const ids = (
		db
			.prepare(
				`SELECT e.id FROM entries e JOIN entries t ON t.id = ? AND t.series_id = e.series_id
				WHERE e.series_id = ? AND e.shadowed = 0 AND e.read_at IS NULL AND e.position <= t.position`
			)
			.all(entryId, seriesId) as { id: number }[]
	).map((r) => r.id);
	markEntries(seriesId, ids, true, now);
	return ids;
}

export type ReadingEvent = {
	seriesId: number;
	entryId: number;
	kind: 'open' | 'page' | 'finish' | 'close';
	page?: number | null;
	/** Text: the character in paragraph `page`, and the paragraphs in the entry. */
	offset?: number;
	total?: number;
	durationMs?: number;
	now?: number;
};

/**
 * What the reader will call on every open, page turn, finish and close: it
 * moves the entry's position and appends the event, in one transaction, so
 * progress and the log can never disagree.
 *
 * Built ahead of the reader on purpose (doc/READING-LOG.md). The reader's
 * incognito mode is the one caller that must not reach this at all.
 */
export function recordReading(e: ReadingEvent): void {
	const db = getDb();
	const now = e.now ?? Date.now();
	const page = e.page ?? null;
	const duration = Math.max(0, Math.round(e.durationMs ?? 0));
	db.transaction(() => {
		const owned = db
			.prepare(`SELECT 1 FROM entries WHERE id = ? AND series_id = ?`)
			.get(e.entryId, e.seriesId);
		if (!owned) throw new Error(`entry ${e.entryId} is not in series ${e.seriesId}`);
		db.prepare(
			`INSERT INTO reading_events (at, series_id, entry_id, kind, page, duration_ms)
			VALUES (?, ?, ?, ?, ?, ?)`
		).run(now, e.seriesId, e.entryId, e.kind, page, duration);
		// Position and last-opened only move forward in time: an event read
		// offline and sent later is logged at its own time, but never drags the
		// entry back past something read since (doc/OFFLINE.md).
		const newer = `(last_opened_at IS NULL OR @now >= last_opened_at)`;
		db.prepare(
			`UPDATE entries SET
				read_at = CASE WHEN @finish THEN COALESCE(read_at, @now) ELSE read_at END,
				last_position = CASE WHEN ${newer} THEN COALESCE(@page, last_position) ELSE last_position END,
				last_offset = CASE WHEN ${newer} AND @page IS NOT NULL THEN @offset ELSE last_offset END,
				page_count = COALESCE(@total, page_count),
				last_opened_at = MAX(COALESCE(last_opened_at, 0), @now)
			WHERE id = @id`
		).run({
			now,
			page,
			offset: e.offset ?? null,
			total: e.total ?? null,
			finish: e.kind === 'finish' ? 1 : 0,
			id: e.entryId
		});
	}).immediate();
}

/**
 * Whether the entry is in the series and the series can be read now: a
 * hidden one only while reveal is on. The reader asks this on every page
 * turn, so it is one indexed lookup rather than the whole series page.
 */
export function readableEntry(seriesId: number, entryId: number, reveal: boolean): boolean {
	return (
		getDb()
			.prepare(
				`SELECT 1 FROM entries e JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
				WHERE e.id = ? AND s.id = ? AND (? OR ${VISIBLE_SQL})`
			)
			.get(entryId, seriesId, reveal ? 1 : 0) !== undefined
	);
}

export function setDirection(seriesId: number, direction: Direction | null): void {
	getDb().prepare(`UPDATE series SET direction = ? WHERE id = ?`).run(direction, seriesId);
}

export function addTag(seriesId: number, tag: SeriesTag): void {
	const db = getDb();
	db.transaction(() => {
		const { id } = db
			.prepare(
				`INSERT INTO tags (namespace, value) VALUES (?, ?)
				ON CONFLICT (namespace, value) DO UPDATE SET value = excluded.value RETURNING id`
			)
			.get(tag.namespace, tag.value) as { id: number };
		db.prepare(`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
			seriesId,
			id
		);
	}).immediate();
}

export function removeTag(seriesId: number, tag: SeriesTag): number {
	return getDb()
		.prepare(
			`DELETE FROM series_tags WHERE series_id = ? AND tag_id =
			(SELECT id FROM tags WHERE namespace = ? AND value = ?)`
		)
		.run(seriesId, tag.namespace, tag.value).changes;
}

export type TagSuggestion = SeriesTag & { count: number; onThis: boolean };

/**
 * Existing tags that start with what is being typed, so a new tag reuses an
 * old spelling instead of adding a second one. Counts are over visible series
 * only: a suggestion must not reveal how many hidden series carry a tag.
 */
export function suggestTags(
	seriesId: number,
	input: SeriesTag,
	reveal: boolean,
	limit = 6
): TagSuggestion[] {
	const visible = visibleWhere(reveal);
	const prefix = `${input.value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
	const rows = getDb()
		.prepare(
			`SELECT t.namespace, t.value,
				COUNT(DISTINCT CASE WHEN ${visible} THEN s.id END) AS n,
				MAX(st.series_id = ?) AS on_this
			FROM tags t
			LEFT JOIN series_tags st ON st.tag_id = t.id
			LEFT JOIN series s ON s.id = st.series_id
			LEFT JOIN roots r ON r.id = s.root_id
			WHERE t.value LIKE ? ESCAPE '\\' ${input.namespace ? 'AND t.namespace = ?' : ''}
			GROUP BY t.id
			HAVING n > 0 OR on_this = 1
			ORDER BY on_this DESC, n DESC, t.value COLLATE NOCASE
			LIMIT ?`
		)
		.all(seriesId, prefix, ...(input.namespace ? [input.namespace] : []), limit) as {
		namespace: string;
		value: string;
		n: number;
		on_this: number | null;
	}[];
	return rows.map((r) => ({
		namespace: r.namespace,
		value: r.value,
		count: r.n,
		onThis: r.on_this === 1
	}));
}
