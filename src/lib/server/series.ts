import type { Episode } from '../library/anime.ts';
import { pictureRoute } from './anime/pictures.ts';
import { getDb } from './db.ts';
import { editionToBase } from '../library/editions.ts';
import { libraryWhere, VISIBLE_SQL } from './visibility.ts';
import { seriesDetail } from './library.ts';
import { scanlatorsOf } from './duplicates.ts';
import { getSetting, isSettingKey } from './settings.ts';
import { sourceOfKey } from '../library/downloads.ts';
import type { Kind } from '../library/types.ts';
import type { Direction, SeriesEntry, SeriesPage, SeriesTag } from '../library/series.ts';

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
	origin_key: string | null;
	former_key: string | null;
	former_source: string;
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
	volume: string;
	duration_s: number | null;
	season: number | null;
	episode_number: number | null;
	episode_note: string;
	ending_at: number | null;
	thumb_at: number | null;
	origin_source: string;
};

function parseAlts(raw: string): string[] {
	try {
		const v: unknown = JSON.parse(raw);
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

/**
 * Source ids as the names a row shows (doc/MOVE.md): an engine source's or a
 * novel plugin's, with the series' remembered former source standing in when
 * the extension that named it is gone. An id nothing knows stays unnamed, so
 * the row falls back to its number rather than inventing a name.
 */
function sourceNames(
	db: ReturnType<typeof getDb>,
	ids: string[],
	former: [string | null, string]
): Map<string, string> {
	const out = new Map<string, string>();
	if (!ids.length) return out;
	const marks = ids.map(() => '?').join(',');
	for (const r of db
		.prepare(`SELECT id, name FROM engine_sources WHERE id IN (${marks})`)
		.all(...ids) as { id: string; name: string }[])
		out.set(r.id, r.name);
	const novels = ids.filter((i) => i.startsWith('ln:')).map((i) => i.slice(3));
	if (novels.length)
		for (const r of db
			.prepare(
				`SELECT id, name FROM novel_plugins WHERE id IN (${novels.map(() => '?').join(',')})`
			)
			.all(...novels) as { id: string; name: string }[])
			out.set(`ln:${r.id}`, r.name);
	// The source the series left, when its extension has since gone.
	const [formerId, formerName] = former;
	if (formerId && formerName && !out.has(formerId)) out.set(formerId, formerName);
	return out;
}

export function seriesPage(id: number, reveal: boolean): SeriesPage | null {
	const card = seriesDetail(id, reveal);
	if (!card) return null;
	const db = getDb();
	const row = db
		.prepare(
			`SELECT alt_titles, source, status, description, direction, path, scanlator, origin_key,
				former_key, former_source FROM series WHERE id = ?`
		)
		.get(id) as SeriesRow;
	const raw = db
		.prepare(
			`SELECT id, position, label, title, read_at, last_position, last_opened_at, page_count, file, bytes,
				rating, favourite, added_at, cover_page, available, locator, matter, last_offset, volume,
				duration_s, season, episode_number, episode_note, ending_at, thumb_at, origin_source
			FROM entries WHERE series_id = ? AND shadowed = 0 ORDER BY position, id`
		)
		.all(id) as EntryRow[];
	// A chapter kept from the source the series left says that source's name,
	// not its id (doc/MOVE.md). A move within one site keeps it too: the site is
	// the same, the entry it came from isn't.
	const names = sourceNames(
		db,
		[...new Set(raw.map((e) => e.origin_source).filter(Boolean))],
		[sourceOfKey(row.former_key), row.former_source]
	);
	const entries = raw.map((e): SeriesEntry => ({
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
		volume: e.volume,
		originSource: names.get(e.origin_source) ?? '',
		tags: [],
		// An episode's own (doc/ANIME.md). Its picture is made on the workstation (c225).
		episode:
			card.kind === 'anime'
				? {
						durationS: e.duration_s,
						season: e.season,
						number: e.episode_number,
						note: e.episode_note as Episode['note'],
						thumb: pictureRoute(e.id, e.thumb_at),
						endingAt: e.ending_at
					}
				: null
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
		kindDirection: kindDirection(card.kind),
		path: row.path,
		tags,
		entries,
		duplicates: (
			db
				.prepare(
					`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND shadowed = 1 AND edition_of IS NULL`
				)
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
			// Marked unread is remembered (rung 28), so an import doesn't bring an old read back.
			const update = db.prepare(`UPDATE entries SET read_at = ?, unread_at = ? WHERE id = ?`);
			const log = db.prepare(
				`INSERT INTO reading_events (at, series_id, entry_id, kind) VALUES (?, ?, ?, ?)`
			);
			// The copies a chapter's representative stands for follow it, or the
			// next reconcile would carry an old "read" back (doc/DUPLICATES.md).
			const copies = db.prepare(
				`UPDATE entries SET read_at = ?, unread_at = ? WHERE series_id = ? AND shadowed = 1
				AND position = (SELECT position FROM entries WHERE id = ?)`
			);
			for (const { id } of changing) {
				update.run(read ? now : null, read ? null : now, id);
				copies.run(read ? now : null, read ? null : now, seriesId, id);
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
	/** An episode (doc/ANIME.md): `page` is seconds into it, and this its length as the player measured it. */
	lengthS?: number;
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
	let page = e.page ?? null;
	let total = e.total ?? null;
	let entryId = e.entryId;
	const duration = Math.max(0, Math.round(e.durationMs ?? 0));
	db.transaction(() => {
		// An edition of a folded book (doc/EDITIONS.md) keeps no progress of its
		// own: its page is the base's matched page, so every language resumes
		// at the same place, and the one read is remembered.
		const ed = db
			.prepare(
				`SELECT edition_of, edition_rows, language FROM entries WHERE id = ? AND series_id = ?`
			)
			.get(e.entryId, e.seriesId) as
			| { edition_of: number | null; edition_rows: string | null; language: string | null }
			| undefined;
		if (ed?.edition_of) {
			entryId = ed.edition_of;
			if (page !== null) page = editionToBase(JSON.parse(ed.edition_rows ?? '[]'), page).page;
			total = null;
		}
		if (ed?.language)
			db.prepare(
				`UPDATE series SET edition_read = ? WHERE id = ?
				AND EXISTS (SELECT 1 FROM entries WHERE series_id = ? AND edition_of IS NOT NULL)`
			).run(ed.language, e.seriesId, e.seriesId);
		const owned = db
			.prepare(`SELECT 1 FROM entries WHERE id = ? AND series_id = ?`)
			.get(e.entryId, e.seriesId);
		if (!owned) throw new Error(`entry ${e.entryId} is not in series ${e.seriesId}`);
		db.prepare(
			`INSERT INTO reading_events (at, series_id, entry_id, kind, page, duration_ms)
			VALUES (?, ?, ?, ?, ?, ?)`
		).run(now, e.seriesId, entryId, e.kind, page, duration);
		// Position and last-opened only move forward in time: an event read
		// offline and sent later is logged at its own time, but never drags the
		// entry back past something read since (doc/OFFLINE.md).
		const newer = `(last_opened_at IS NULL OR @now >= last_opened_at)`;
		db.prepare(
			`UPDATE entries SET
				read_at = CASE WHEN @finish THEN COALESCE(read_at, @now) ELSE read_at END,
				unread_at = CASE WHEN @finish THEN NULL ELSE unread_at END,
				last_position = CASE WHEN ${newer} THEN COALESCE(@page, last_position) ELSE last_position END,
				last_offset = CASE WHEN ${newer} AND @page IS NOT NULL THEN @offset ELSE last_offset END,
				page_count = COALESCE(@total, page_count),
				duration_s = COALESCE(@length, duration_s),
				last_opened_at = MAX(COALESCE(last_opened_at, 0), @now)
			WHERE id = @id`
		).run({
			now,
			page,
			offset: e.offset ?? null,
			total,
			length: e.lengthS !== undefined && e.lengthS > 0 ? e.lengthS : null,
			finish: e.kind === 'finish' ? 1 : 0,
			id: entryId
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

/** Where a series of [kind] starts reading, as SETTINGS has it (doc/SETTINGS.md; card c171). */
export function kindDirection(kind: Kind): Direction | undefined {
	const key = `mode_${kind}`;
	return isSettingKey(key) ? (getSetting(key) as Direction) : undefined;
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
	limit = 6,
	/** A book of the series: ✓ ON THIS is the book's own tags, not the series'. */
	entryId?: number
): TagSuggestion[] {
	// Counted over the library: a browsing record's tags suggest nothing.
	const visible = libraryWhere(reveal);
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
	const onBook = entryId
		? new Set(
				(
					getDb()
						.prepare(
							`SELECT t.namespace || ':' || t.value AS k FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = ?`
						)
						.all(entryId) as { k: string }[]
				).map((r) => r.k)
			)
		: null;
	return rows.map((r) => ({
		namespace: r.namespace,
		value: r.value,
		count: r.n,
		onThis: onBook ? onBook.has(`${r.namespace}:${r.value}`) : r.on_this === 1
	}));
}
