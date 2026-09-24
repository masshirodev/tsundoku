import type Database from 'better-sqlite3';
import { posix } from 'node:path';
import { fileIn, isUnder, widenTo } from '../paths.ts';
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

/**
 * The root of this name, whatever its path: another device's copy of a
 * source (doc/SYNC.md, "Two devices") shares the library folder's root, and
 * makes it only if there's none yet.
 */
export function ensureNamedRoot(
	db: Database.Database,
	name: string,
	path: string,
	hidden: boolean
): number {
	const row = db.prepare(`SELECT id FROM roots WHERE name = ? ORDER BY id LIMIT 1`).get(name) as
		{ id: number } | undefined;
	return row?.id ?? ensureRoot(db, name, path, hidden);
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
		/**
		 * The device folder this plan was read from (doc/SYNC.md, "Two devices").
		 * A series whose files are outside it has them on another device too.
		 */
		deviceRoot?: string;
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

			// A book grouped as a volume of a novel (doc/BOOKS.md): the series is
			// the owner's, holding other books too. This book's entries are found
			// by its own prefix; its files are named from the series' folder; and
			// its chapters keep the volume's place among the others.
			const own = s.source === 'epub' ? `${s.originKey}!` : '';
			let volume: { path: string; name: string } | null = null;
			if (seriesId !== null && own) {
				const row = db
					.prepare(
						`SELECT path,
							(SELECT COUNT(*) FROM entries WHERE series_id = s.id AND substr(source_url, 1, ?) != ?) AS others,
							(SELECT volume FROM entries WHERE series_id = s.id AND substr(source_url, 1, ?) = ? AND volume != '' LIMIT 1) AS name
						FROM series s WHERE id = ?`
					)
					.get(own.length, own, own.length, own, seriesId) as {
					path: string;
					others: number;
					name: string | null;
				};
				if (row.others > 0) volume = { path: row.path, name: row.name ?? s.title };
			}
			// A series another device has files in too (doc/SYNC.md, "Two devices"):
			// its path is left where it is, widened only when this device brings a
			// file the series has no copy of, and this device's files are named from
			// there. The same manga downloaded on the tablet and the phone is one
			// series, its chapters from whichever device has them.
			let shared: string | null = null;
			if (seriesId !== null && volume === null && opts.deviceRoot && s.path !== '') {
				const { path } = db.prepare(`SELECT path FROM series WHERE id = ?`).get(seriesId) as {
					path: string;
				};
				if (path !== '' && path !== s.path && !isUnder(path, opts.deviceRoot)) {
					const have = db.prepare(
						`SELECT 1 FROM entries WHERE series_id = ? AND source_url = ? AND available = 1`
					);
					const brings = s.entries
						.filter((e) => e.available && (e.sourceUrl === '' || !have.get(seriesId, e.sourceUrl)))
						.map((e) => posix.join(s.path, e.file));
					shared = brings.length ? widenTo(db, seriesId, brings) : path;
				}
			}
			const fileOf = (e: PlannedEntry) =>
				volume
					? posix.relative(volume.path, posix.join(s.path, e.file))
					: shared !== null
						? fileIn(shared, posix.join(s.path, e.file))
						: e.file;

			if (seriesId !== null && volume === null) {
				const path = shared === null ? s.path : '';
				db.prepare(
					`UPDATE series SET
						path = CASE WHEN ? != '' THEN ? ELSE path END,
						status = CASE WHEN status = '' THEN ? ELSE status END,
						description = CASE WHEN description = '' THEN ? ELSE description END,
						cover_url = CASE WHEN ? != '' THEN ? ELSE cover_url END
					WHERE id = ?`
				).run(path, path, s.status, s.description, s.coverUrl ?? '', s.coverUrl ?? '', seriesId);
			} else if (seriesId === null) {
				created = true;
				seriesId = Number(
					db
						.prepare(
							`INSERT INTO series (root_id, title, kind, rating, favourite, hidden, hue, added_at,
								indexed_at, scan_job_id, alt_titles, source, status, description, direction, path,
								source_url, origin_key, cover_url)
							VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?)`
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
							s.originKey,
							s.coverUrl ?? ''
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

			const seriesPath = (
				db.prepare(`SELECT path FROM series WHERE id = ?`).get(seriesId) as { path: string }
			).path;
			const find = db.prepare(
				`SELECT id, read_at, last_opened_at, available, file FROM entries
				WHERE series_id = @series AND ((@url != '' AND source_url = @url) OR (@url = '' AND file = @file))
				LIMIT 1`
			);
			const insert = db.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, read_at, last_position,
					last_opened_at, page_count, file, bytes, source_url, available, cover_file, cover_phash,
					scanlator, locator, matter, volume)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
				const file = fileOf(e);
				if (e.available) planned.add(file);
				const had = find.get({ series: seriesId, url: e.sourceUrl, file }) as
					| {
							id: number;
							read_at: number | null;
							last_opened_at: number | null;
							available: number;
							file: string;
					  }
					| undefined;
				// Another device's copy, already here: kept, rather than swapped for this one.
				const elsewhere =
					!!had?.available &&
					(shared !== null || volume !== null) &&
					!isUnder(posix.join(seriesPath, had.file), s.path);
				let entryId: number;
				if (!had) {
					entryId = Number(
						insert.run(
							seriesId,
							// Placed among the other volumes below.
							volume ? VOLUME_PENDING + e.position : e.position,
							e.label,
							e.title,
							e.addedAt,
							e.readAt,
							e.lastPosition,
							e.lastOpenedAt,
							e.pageCount,
							file,
							e.bytes,
							e.sourceUrl,
							e.available ? 1 : 0,
							e.coverFile ?? null,
							e.coverPhash ?? null,
							e.scanlator ?? '',
							e.locator ?? '',
							e.matter ?? '',
							volume?.name ?? ''
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
					// A book's structure is the file's: a new edition moves its places.
					if (e.locator !== undefined)
						db.prepare(
							`UPDATE entries SET locator = ?, matter = ?, position = COALESCE(?, position), label = ?, bytes = ? WHERE id = ?`
						).run(e.locator, e.matter ?? '', volume ? null : e.position, e.label, e.bytes, entryId);
					if (e.available && !elsewhere) {
						if (!had.available) filesAttached += 1;
						db.prepare(
							`UPDATE entries SET available = 1, file = ?, bytes = ?, page_count = ?,
								cover_file = COALESCE(?, cover_file), cover_phash = COALESCE(?, cover_phash)
							WHERE id = ?`
						).run(file, e.bytes, e.pageCount, e.coverFile ?? null, e.coverPhash ?? null, entryId);
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
			if (volume) placeVolume(db, seriesId, own, s.entries);
			if (opts.markMissing && s.path !== '') {
				// A volume answers only for its own entries: the others are other files.
				const onDisk = (
					db
						.prepare(
							`SELECT id, file, source_url FROM entries WHERE series_id = ? AND available = 1 AND file != ''`
						)
						.all(seriesId) as { id: number; file: string; source_url: string }[]
				)
					.filter((r) => !volume || r.source_url.startsWith(own))
					// With another device's files in the series, this one answers for its own only.
					.filter((r) => shared === null || isUnder(posix.join(seriesPath, r.file), s.path));
				for (const r of onDisk)
					if (!planned.has(r.file))
						db.prepare(`UPDATE entries SET available = 0 WHERE id = ?`).run(r.id);
			}
			return { created, entriesAdded, filesAttached };
		})
		.immediate();
}

/** Above any real position: a volume's new entries, until placeVolume puts them in their run. */
const VOLUME_PENDING = 1e9;

/**
 * Put one volume's entries back into its run in a series of volumes, in the
 * book's order: where its first entry already was, or at the end if it had
 * none there. The other volumes keep their order, and positions run 1..n.
 */
function placeVolume(
	db: Database.Database,
	seriesId: number,
	own: string,
	planned: PlannedEntry[]
): void {
	const rows = db
		.prepare(
			`SELECT id, source_url, position FROM entries WHERE series_id = ? ORDER BY position, id`
		)
		.all(seriesId) as { id: number; source_url: string; position: number }[];
	const mine = (r: { source_url: string }) => r.source_url.startsWith(own);
	const order = new Map(planned.map((e, i) => [e.sourceUrl, i]));
	const rank = (r: { source_url: string }) => order.get(r.source_url) ?? planned.length;
	const volume = rows.filter(mine).sort((a, b) => rank(a) - rank(b));
	const others = rows.filter((r) => !mine(r));
	const first = rows.findIndex((r) => mine(r) && r.position < VOLUME_PENDING);
	const at = first < 0 ? others.length : rows.slice(0, first).filter((r) => !mine(r)).length;
	const all = [...others.slice(0, at), ...volume, ...others.slice(at)];
	const set = db.prepare(`UPDATE entries SET position = ? WHERE id = ?`);
	all.forEach((r, i) => set.run(i + 1, r.id));
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
