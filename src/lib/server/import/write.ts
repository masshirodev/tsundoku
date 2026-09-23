import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { hueFor } from '../../library/cover.ts';
import type { PlannedEntry, PlannedSeries } from '../../import/plan.ts';

/**
 * The one writer every importer uses (doc/IMPORT-MIHON.md, doc/IMPORT-HENTOID.md):
 * a planned series into the database, in one transaction, idempotently.
 *
 * - A series is found again by its origin key. Failing that, by its entries:
 *   a Hentoid book the owner grouped into a series of books lives on in
 *   that series, and its own singleton row is gone -- so the book is updated
 *   where it now is, and no second copy is made.
 * - An entry is found by its source URL (or its file, when it has none).
 * - What the source owns is refreshed: files, sizes, pages, availability.
 *   Read state only moves forward. What the owner edits -- title, rating,
 *   favourite, hidden, shelves, tags, kind, direction -- is set once, when
 *   the series is created, and never again.
 */

export function ensureRoot(
	db: Database.Database,
	name: string,
	path: string,
	hidden: boolean
): number {
	const row = db.prepare(`SELECT id FROM roots WHERE path = ?`).get(path) as
		{ id: number } | undefined;
	if (row) return row.id;
	return Number(
		db
			.prepare(`INSERT INTO roots (name, path, hidden) VALUES (?, ?, ?)`)
			.run(name, path, hidden ? 1 : 0).lastInsertRowid
	);
}

function ensureShelf(db: Database.Database, name: string): number {
	const row = db.prepare(`SELECT id FROM collections WHERE name = ?`).get(name) as
		{ id: number } | undefined;
	if (row) return row.id;
	const { p } = db
		.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM collections`)
		.get() as { p: number };
	return Number(
		db.prepare(`INSERT INTO collections (name, position) VALUES (?, ?)`).run(name, p)
			.lastInsertRowid
	);
}

function ensureTag(db: Database.Database, namespace: string, value: string): number {
	return (
		db
			.prepare(
				`INSERT INTO tags (namespace, value) VALUES (?, ?)
				ON CONFLICT (namespace, value) DO UPDATE SET value = value RETURNING id`
			)
			.get(namespace, value) as { id: number }
	).id;
}

function setPages(db: Database.Database, entryId: number, e: PlannedEntry): void {
	if (!e.pages) return;
	db.prepare(`DELETE FROM entry_pages WHERE entry_id = ?`).run(entryId);
	const add = db.prepare(`INSERT INTO entry_pages (entry_id, position, file) VALUES (?, ?, ?)`);
	e.pages.forEach((file, i) => add.run(entryId, i, file));
}

export type WriteResult = { created: boolean; entriesAdded: number; filesAttached: number };

export function writeSeries(
	s: PlannedSeries,
	opts: {
		rootId: number;
		jobId: number | null;
		now: number;
		/** Entries of this series whose file is no longer planned become not downloaded. */
		markMissing?: boolean;
	},
	db: Database.Database = getDb()
): WriteResult {
	return db
		.transaction((): WriteResult => {
			let seriesId: number | null =
				(
					db.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(s.originKey) as
						{ id: number } | undefined
				)?.id ?? null;
			let created = false;
			// Grouped since the last scan: the entries are elsewhere in this root.
			if (seriesId === null) {
				const moved = s.entries
					.filter((e) => e.sourceUrl !== '')
					.map(
						(e) =>
							db
								.prepare(
									`SELECT e.series_id AS id FROM entries e JOIN series s ON s.id = e.series_id
									WHERE s.root_id = ? AND e.source_url = ? LIMIT 1`
								)
								.get(opts.rootId, e.sourceUrl) as { id: number } | undefined
					)
					.find((r) => r !== undefined);
				if (moved) seriesId = moved.id;
			}

			if (seriesId !== null) {
				db.prepare(
					`UPDATE series SET
						path = CASE WHEN ? != '' THEN ? ELSE path END,
						status = CASE WHEN status = '' THEN ? ELSE status END,
						description = CASE WHEN description = '' THEN ? ELSE description END
					WHERE id = ?`
				).run(s.path, s.path, s.status, s.description, seriesId);
			} else {
				created = true;
				seriesId = Number(
					db
						.prepare(
							`INSERT INTO series (root_id, title, kind, rating, favourite, hidden, hue, added_at,
								indexed_at, scan_job_id, alt_titles, source, status, description, direction, path,
								source_url, origin_key)
							VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?)`
						)
						.run(
							opts.rootId,
							s.title,
							s.kind,
							s.rating,
							s.favourite ? 1 : 0,
							s.hidden ? 1 : 0,
							hueFor(s.title),
							s.addedAt,
							opts.now,
							opts.jobId,
							s.source,
							s.status,
							s.description,
							s.direction,
							s.path,
							s.sourceUrl,
							s.originKey
						).lastInsertRowid
				);
				for (const t of s.tags)
					db.prepare(`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
						seriesId,
						ensureTag(db, t.namespace, t.value)
					);
				for (const shelf of s.shelves)
					db.prepare(
						`INSERT OR IGNORE INTO collection_series (collection_id, series_id) VALUES (?, ?)`
					).run(ensureShelf(db, shelf), seriesId);
			}

			const find = db.prepare(
				`SELECT id, read_at, last_opened_at, available FROM entries
				WHERE series_id = @series AND ((@url != '' AND source_url = @url) OR (@url = '' AND file = @file))
				LIMIT 1`
			);
			const insert = db.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, read_at, last_position,
					last_opened_at, page_count, file, bytes, source_url, available, cover_file, cover_phash,
					scanlator)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			);
			const log = db.prepare(
				`INSERT INTO reading_events (at, series_id, entry_id, kind, page, duration_ms)
				SELECT @at, @series, @entry, @kind, @page, @duration
				WHERE NOT EXISTS (SELECT 1 FROM reading_events WHERE entry_id = @entry AND at = @at AND kind = @kind)`
			);
			let entriesAdded = 0;
			let filesAttached = 0;
			const planned = new Set<string>();
			for (const e of s.entries) {
				if (e.available) planned.add(e.file);
				const had = find.get({ series: seriesId, url: e.sourceUrl, file: e.file }) as
					| { id: number; read_at: number | null; last_opened_at: number | null; available: number }
					| undefined;
				let entryId: number;
				if (!had) {
					entryId = Number(
						insert.run(
							seriesId,
							e.position,
							e.label,
							e.title,
							e.addedAt,
							e.readAt,
							e.lastPosition,
							e.lastOpenedAt,
							e.pageCount,
							e.file,
							e.bytes,
							e.sourceUrl,
							e.available ? 1 : 0,
							e.coverFile ?? null,
							e.coverPhash ?? null,
							e.scanlator ?? ''
						).lastInsertRowid
					);
					setPages(db, entryId, e);
					for (const t of e.tags ?? [])
						db.prepare(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)`).run(
							entryId,
							ensureTag(db, t.namespace, t.value)
						);
					entriesAdded += 1;
					if (e.available) filesAttached += 1;
				} else {
					entryId = had.id;
					// Rung 10 came after the first imports: a rescan fills it in.
					if (e.scanlator)
						db.prepare(`UPDATE entries SET scanlator = ? WHERE id = ?`).run(e.scanlator, entryId);
					if (e.available) {
						if (!had.available) filesAttached += 1;
						db.prepare(
							`UPDATE entries SET available = 1, file = ?, bytes = ?, page_count = ?,
								cover_file = COALESCE(?, cover_file), cover_phash = COALESCE(?, cover_phash)
							WHERE id = ?`
						).run(e.file, e.bytes, e.pageCount, e.coverFile ?? null, e.coverPhash ?? null, entryId);
						setPages(db, entryId, e);
					}
					// Read state only moves forward: never un-read what tsundoku read.
					if (e.readAt !== null && had.read_at === null)
						db.prepare(`UPDATE entries SET read_at = ? WHERE id = ?`).run(e.readAt, entryId);
					if (
						e.lastOpenedAt !== null &&
						(had.last_opened_at === null || e.lastOpenedAt > had.last_opened_at)
					)
						db.prepare(
							`UPDATE entries SET last_opened_at = ?, last_position = COALESCE(?, last_position) WHERE id = ?`
						).run(e.lastOpenedAt, e.lastPosition, entryId);
				}
				if (e.history)
					log.run({
						at: e.history.at,
						series: seriesId,
						entry: entryId,
						kind: e.history.finished ? 'finish' : 'page',
						page: e.history.page,
						duration: Math.max(0, e.history.durationMs)
					});
			}
			if (opts.markMissing && s.path !== '') {
				const onDisk = db
					.prepare(
						`SELECT id, file FROM entries WHERE series_id = ? AND available = 1 AND file != ''`
					)
					.all(seriesId) as { id: number; file: string }[];
				for (const r of onDisk)
					if (!planned.has(r.file))
						db.prepare(`UPDATE entries SET available = 0 WHERE id = ?`).run(r.id);
			}
			return { created, entriesAdded, filesAttached };
		})
		.immediate();
}

/**
 * Close a job: a run that brought no new series has nothing to tidy, so it
 * leaves no band.
 */
export function finishJob(db: Database.Database, jobId: number, seriesCreated: number): void {
	const done = Date.now();
	db.prepare(
		`UPDATE scan_jobs SET finished_at = ?, dismissed_at = CASE WHEN ? = 0 THEN ? END WHERE id = ?`
	).run(done, seriesCreated, done, jobId);
}
