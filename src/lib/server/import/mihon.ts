import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { pageMembers, readMember, withZip } from '../zip.ts';
import { hueFor } from '../../library/cover.ts';
import { parseComicInfo, type ComicInfo } from '../../import/comicinfo.ts';
import { decodeBackup, type MihonBackup } from '../../import/mihon-backup.ts';
import {
	planMihon,
	type DownloadedChapter,
	type DownloadedSeries,
	type MihonPlan,
	type PlannedSeries
} from '../../import/mihon-plan.ts';

/**
 * The Mihon importer (doc/IMPORT-MIHON.md). It reads a copy of the device's
 * `Mihon/` folder -- `downloads/` and `autobackup/` -- in place, without
 * moving a file, and writes the library from it.
 *
 * Idempotent: a rescan finds each series by its origin key and each chapter
 * by its source URL, adds what is new, attaches files that have arrived,
 * moves read state forward, and leaves alone everything the owner may have
 * edited since (rating, shelves, tags, hidden, title).
 */

const IMAGE = /\.(jpe?g|png|webp|gif|avif|jxl)$/i;

export type Progress = {
	bytesDone: number;
	bytesTotal: number;
	seriesFound: number;
	failedFiles: number;
};

async function dirs(path: string): Promise<string[]> {
	try {
		return (await readdir(path, { withFileTypes: true }))
			.filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.endsWith('_tmp'))
			.map((d) => d.name);
	} catch {
		return [];
	}
}

/** The newest backup, by name: Mihon names them `app.mihon_<date>_<time>.tachibk`. */
export async function newestBackup(root: string): Promise<string | null> {
	const folder = join(root, 'autobackup');
	try {
		const names = (await readdir(folder)).filter((n) => /\.(tachibk|proto\.gz)$/.test(n)).sort();
		return names.length ? join(folder, names[names.length - 1]) : null;
	} catch {
		return null;
	}
}

export async function readBackup(path: string): Promise<MihonBackup> {
	return decodeBackup(gunzipSync(await readFile(path)));
}

async function readChapter(path: string, file: string): Promise<DownloadedChapter> {
	const full = join(path, file);
	const info = await stat(full);
	if (info.isDirectory()) {
		// Mihon without "save as CBZ": a folder of images per chapter.
		const names = await readdir(full);
		const xml = names.includes('ComicInfo.xml')
			? await readFile(join(full, 'ComicInfo.xml'), 'utf8')
			: null;
		let bytes = 0;
		for (const n of names) bytes += (await stat(join(full, n))).size;
		return {
			file,
			bytes,
			pages: names.filter((n) => IMAGE.test(n)).length,
			info: xml ? parseComicInfo(xml) : null
		};
	}
	return withZip(full, async (fh, members) => {
		const comic = members.find((m) => m.name.toLowerCase() === 'comicinfo.xml');
		const parsed: ComicInfo | null = comic
			? parseComicInfo((await readMember(fh, comic)).toString('utf8'))
			: null;
		return { file, bytes: info.size, pages: pageMembers(members).length, info: parsed };
	});
}

/** Every downloaded series under `<root>/downloads/<source>/<series>/`. */
export async function scanDownloads(
	root: string,
	progress: (p: { bytes: number; failed: boolean }) => void = () => {}
): Promise<DownloadedSeries[]> {
	const out: DownloadedSeries[] = [];
	const downloads = join(root, 'downloads');
	for (const sourceDir of await dirs(downloads)) {
		for (const dir of await dirs(join(downloads, sourceDir))) {
			const path = join(downloads, sourceDir, dir);
			const chapters: DownloadedChapter[] = [];
			for (const entry of await readdir(path, { withFileTypes: true })) {
				const isChapter =
					(entry.isFile() && /\.cbz$/i.test(entry.name)) ||
					(entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.endsWith('_tmp'));
				if (!isChapter) continue;
				try {
					const c = await readChapter(path, entry.name);
					chapters.push(c);
					progress({ bytes: c.bytes, failed: false });
				} catch {
					progress({ bytes: 0, failed: true });
				}
			}
			if (chapters.length) out.push({ sourceDir, dir, path, chapters });
		}
	}
	return out;
}

/** Bytes of every chapter archive, for the progress band's total. */
export async function downloadBytes(root: string): Promise<number> {
	let total = 0;
	const downloads = join(root, 'downloads');
	for (const s of await dirs(downloads))
		for (const d of await dirs(join(downloads, s))) {
			for (const e of await readdir(join(downloads, s, d), { withFileTypes: true })) {
				if (e.isFile() && /\.cbz$/i.test(e.name))
					total += (await stat(join(downloads, s, d, e.name))).size;
			}
		}
	return total;
}

// ---- writing ---------------------------------------------------------------------

function ensureRoot(db: Database.Database, path: string): number {
	const row = db.prepare(`SELECT id FROM roots WHERE path = ?`).get(path) as
		{ id: number } | undefined;
	if (row) return row.id;
	return Number(
		db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Mihon', ?, 0)`).run(path)
			.lastInsertRowid
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

export type WriteResult = { created: boolean; entriesAdded: number; filesAttached: number };

/** One planned series into the database, in one transaction. */
export function writeSeries(
	s: PlannedSeries,
	opts: { rootId: number; jobId: number | null; now: number },
	db: Database.Database = getDb()
): WriteResult {
	return db
		.transaction((): WriteResult => {
			const existing = db
				.prepare(`SELECT id, path FROM series WHERE origin_key = ?`)
				.get(s.originKey) as { id: number; path: string } | undefined;
			let seriesId: number;
			const created = !existing;
			if (existing) {
				seriesId = existing.id;
				// Only what the source owns: where the files are, and metadata the
				// owner never filled in.
				db.prepare(
					`UPDATE series SET
						path = CASE WHEN ? != '' THEN ? ELSE path END,
						status = CASE WHEN status = '' THEN ? ELSE status END,
						description = CASE WHEN description = '' THEN ? ELSE description END
					WHERE id = ?`
				).run(s.path, s.path, s.status, s.description, seriesId);
			} else {
				seriesId = Number(
					db
						.prepare(
							`INSERT INTO series (root_id, title, kind, rating, favourite, hidden, hue, added_at,
								indexed_at, scan_job_id, alt_titles, source, status, description, direction, path,
								source_url, origin_key)
							VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, '[]', 'mihon', ?, ?, ?, ?, ?, ?)`
						)
						.run(
							opts.rootId,
							s.title,
							s.kind,
							s.rating,
							s.hidden ? 1 : 0,
							hueFor(s.title),
							s.addedAt,
							opts.now,
							opts.jobId,
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
				WHERE series_id = ? AND ((? != '' AND source_url = ?) OR (? != '' AND file = ?)) LIMIT 1`
			);
			const insert = db.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, read_at, last_position,
					last_opened_at, page_count, file, bytes, source_url, available)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			);
			const log = db.prepare(
				`INSERT INTO reading_events (at, series_id, entry_id, kind, page, duration_ms)
				SELECT @at, @series, @entry, @kind, @page, @duration
				WHERE NOT EXISTS (SELECT 1 FROM reading_events WHERE entry_id = @entry AND at = @at AND kind = @kind)`
			);
			let entriesAdded = 0;
			let filesAttached = 0;
			const seenFiles = new Set<string>();
			for (const e of s.entries) {
				if (e.available) seenFiles.add(e.file);
				const had = find.get(seriesId, e.sourceUrl, e.sourceUrl, e.file, e.file) as
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
							e.available ? 1 : 0
						).lastInsertRowid
					);
					entriesAdded += 1;
					if (e.available) filesAttached += 1;
				} else {
					entryId = had.id;
					if (e.available && !had.available) filesAttached += 1;
					if (e.available)
						db.prepare(
							`UPDATE entries SET available = 1, file = ?, bytes = ?, page_count = ? WHERE id = ?`
						).run(e.file, e.bytes, e.pageCount, entryId);
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
			// A file that was on disk last time and isn't now: the chapter stays,
			// marked not downloaded.
			if (s.path !== '') {
				const onDisk = db
					.prepare(
						`SELECT id, file FROM entries WHERE series_id = ? AND available = 1 AND file != ''`
					)
					.all(seriesId) as { id: number; file: string }[];
				for (const r of onDisk)
					if (!seenFiles.has(r.file))
						db.prepare(`UPDATE entries SET available = 0 WHERE id = ?`).run(r.id);
			}
			return { created, entriesAdded, filesAttached };
		})
		.immediate();
}

// ---- running a job ---------------------------------------------------------------

export type ImportSummary = {
	jobId: number;
	seriesCreated: number;
	seriesUpdated: number;
	entriesAdded: number;
	filesAttached: number;
	skipped: number;
	failedFiles: number;
	backup: string | null;
};

/** Where the owner's copy of the device's `Mihon/` folder lives. */
export function mihonRoot(libraryRoot: string): string | null {
	const path = join(libraryRoot, 'Mihon');
	return existsSync(path) ? path : null;
}

let running: Promise<ImportSummary> | null = null;

export const importRunning = () => running !== null;

/**
 * Import `root` (a `Mihon/` folder) as one scan job, reporting progress into
 * `scan_jobs` for the library's IMPORTING band. One import at a time: a
 * second call while one runs gets the running one.
 */
export function importMihon(root: string, opts: { now?: number } = {}): Promise<ImportSummary> {
	if (running) return running;
	running = run(root, opts.now ?? Date.now()).finally(() => {
		running = null;
	});
	return running;
}

async function run(root: string, now: number): Promise<ImportSummary> {
	const db = getDb();
	// A job left unfinished by a process that died is over.
	db.prepare(`UPDATE scan_jobs SET finished_at = ? WHERE finished_at IS NULL`).run(now);
	const jobId = Number(
		db
			.prepare(
				`INSERT INTO scan_jobs (started_at, source_label, steps, step) VALUES (?, 'MIHON', 2, 1)`
			)
			.run(now).lastInsertRowid
	);
	const update = db.prepare(
		`UPDATE scan_jobs SET bytes_done = @bytesDone, bytes_total = @bytesTotal, series_found = @seriesFound,
			failed_files = @failedFiles, step = @step WHERE id = @id`
	);
	const p: Progress & { step: number } = {
		bytesDone: 0,
		bytesTotal: 0,
		seriesFound: 0,
		failedFiles: 0,
		step: 1
	};
	const flush = () => update.run({ ...p, id: jobId });

	try {
		p.bytesTotal = await downloadBytes(root);
		flush();
		let last = 0;
		const downloads = await scanDownloads(root, ({ bytes, failed }) => {
			p.bytesDone += bytes;
			if (failed) p.failedFiles += 1;
			if (Date.now() - last > 500) {
				last = Date.now();
				flush();
			}
		});
		const backupPath = await newestBackup(root);
		const backup = backupPath ? await readBackup(backupPath) : null;
		const plan: MihonPlan = planMihon(backup, downloads, now);

		p.step = 2;
		flush();
		const rootId = ensureRoot(db, root);
		const summary: ImportSummary = {
			jobId,
			seriesCreated: 0,
			seriesUpdated: 0,
			entriesAdded: 0,
			filesAttached: 0,
			skipped: plan.skipped,
			failedFiles: 0,
			backup: backupPath
		};
		let written = 0;
		for (const s of plan.series) {
			const r = writeSeries(s, { rootId, jobId, now }, db);
			if (r.created) summary.seriesCreated += 1;
			else summary.seriesUpdated += 1;
			summary.entriesAdded += r.entriesAdded;
			summary.filesAttached += r.filesAttached;
			// The band counts arrivals ("N SERIES SO FAR"), and it is shown
			// while reveal may be off, so a hidden series is not one of them.
			if (r.created && !s.hidden) p.seriesFound += 1;
			if (++written % 20 === 0) {
				flush();
				// Let requests in between batches: the library polls this job.
				await new Promise((r) => setImmediate(r));
			}
		}
		summary.failedFiles = p.failedFiles;
		p.bytesDone = p.bytesTotal;
		flush();
		// A rescan that brought nothing new has nothing to tidy: no band.
		const done = Date.now();
		db.prepare(
			`UPDATE scan_jobs SET finished_at = ?, dismissed_at = CASE WHEN ? = 0 THEN ? END WHERE id = ?`
		).run(done, summary.seriesCreated, done, jobId);
		return summary;
	} catch (e) {
		flush();
		db.prepare(
			`UPDATE scan_jobs SET finished_at = ?, failed_files = failed_files + 1 WHERE id = ?`
		).run(Date.now(), jobId);
		throw e;
	}
}
