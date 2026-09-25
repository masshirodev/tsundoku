import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import {
	downloadBytes,
	localBytes,
	mihonRoot,
	newestBackup,
	planMihonFolder,
	readBackup,
	scanLocal
} from './mihon.ts';
import { planMihonLocal } from '../../import/mihon-local-plan.ts';
import { join, relative } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { isUnder } from '../paths.ts';
import { hentoidBytes, hentoidRoot, planHentoidFolder } from './hentoid.ts';
import { epubBytes, epubRoot, planEpubFolder } from './epub.ts';
import { ensureRoot, ensureNamedRoot, finishJob, writeSeries } from './write.ts';
import { reconcileDuplicates } from '../duplicates.ts';
import { refreshCovers } from '../covers.ts';
import { refreshLinks } from '../catalogue.ts';
import type { PlannedSeries } from '../../import/plan.ts';

/**
 * Running an import (doc/IMPORT-MIHON.md, doc/IMPORT-HENTOID.md). One scan
 * job covers every device folder found under the library folder, one step
 * each, with the library's IMPORTING band following `scan_jobs`.
 */

/**
 * Where the device copies live: a folder that mirrors the tablet's shared
 * storage, so `Mihon/` and `H/.Hentoid/` sit in it as they do on the device
 * and a plain rsync refreshes them.
 */
export function libraryRoot(): string {
	return process.env.LIBRARY_ROOT ?? '/mnt/hdd2/tsundoku/library';
}

type Source = {
	name: 'Mihon' | 'Mihon local' | 'Hentoid' | 'Library';
	/**
	 * Another device's copy (doc/SYNC.md, "Two devices"): `devices/<name>/`
	 * under the library folder. Null for the library folder's own.
	 */
	device: string | null;
	root: string;
	/** The Hentoid root is hidden: its books show only with /reveal. */
	hidden: boolean;
	bytes(): Promise<number>;
	plan(
		progress: (p: { bytes: number; failed: boolean }) => void,
		now: number
	): Promise<{
		series: PlannedSeries[];
		skipped: number;
		backup?: string | null;
		/** After writing: mark what vanished from disk. */
		after?: (db: Database.Database, rootId: number) => void;
	}>;
	markMissing: boolean;
};

/**
 * Every device's sources: the library folder's own, then each folder under
 * `devices/` (the phone), which holds the same `Mihon/`, `Hentoid/` and
 * `Library/` for its device.
 */
export function sourcesIn(library: string): Source[] {
	const devices = join(library, 'devices');
	let names: string[] = [];
	try {
		names = readdirSync(devices, { withFileTypes: true })
			.filter((d) => d.isDirectory() && !d.name.startsWith('.'))
			.map((d) => d.name)
			.sort();
	} catch {
		// No other device.
	}
	return [...sourcesAt(library, null), ...names.flatMap((n) => sourcesAt(join(devices, n), n))];
}

/**
 * The entries of `rootId` whose files are in `folder`, named from there: what
 * one device's copy answers for, when another device's files share the root.
 */
/**
 * What earlier imports made of folders that turn out to hold no pages: an
 * entry planned from nothing but the thumbnail, and a series left with no
 * entries at all. Removed only while untouched -- never opened, unrated, not
 * a favourite, on no shelf, not linked. Not a delete: no tombstone, so a
 * download finished later imports as it would have.
 */
export function prunePageless(
	db: Database.Database,
	rootId: number,
	folder: string,
	pageless: Set<string>
): { entries: number; series: number } {
	const all = db
		.prepare(
			`SELECT e.id, s.path, e.file FROM entries e JOIN series s ON s.id = e.series_id
			WHERE s.root_id = ? AND e.read_at IS NULL AND e.last_position IS NULL
				AND e.last_opened_at IS NULL AND e.rating = 0 AND e.favourite = 0`
		)
		.all(rootId) as { id: number; path: string; file: string }[];
	const drop = db.prepare(`DELETE FROM entries WHERE id = ?`);
	let entries = 0;
	for (const r of all) {
		const abs = join(r.path, r.file);
		if (isUnder(abs, folder) && pageless.has(relative(folder, abs))) {
			drop.run(r.id);
			entries += 1;
		}
	}
	const series = db
		.prepare(
			`DELETE FROM series WHERE root_id = ? AND COALESCE(rating, 0) = 0 AND favourite = 0
				AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.series_id = series.id)
				AND NOT EXISTS (SELECT 1 FROM collection_series c WHERE c.series_id = series.id)
				AND NOT EXISTS (SELECT 1 FROM series_links l WHERE l.series_id = series.id)`
		)
		.run(rootId).changes;
	return { entries, series };
}

function entriesIn(
	db: Database.Database,
	rootId: number,
	folder: string
): { id: number; rel: string }[] {
	return (
		db
			.prepare(
				`SELECT e.id, s.path, e.file FROM entries e JOIN series s ON s.id = e.series_id
				WHERE s.root_id = ? AND e.available = 1`
			)
			.all(rootId) as { id: number; path: string; file: string }[]
	)
		.map((r) => ({ id: r.id, abs: join(r.path, r.file) }))
		.filter((r) => isUnder(r.abs, folder))
		.map((r) => ({ id: r.id, rel: relative(folder, r.abs) }));
}

function sourcesAt(library: string, device: string | null): Source[] {
	const out: Source[] = [];
	const mihon = mihonRoot(library);
	if (mihon)
		out.push({
			name: 'Mihon',
			device,
			root: mihon,
			hidden: false,
			markMissing: true,
			bytes: () => downloadBytes(mihon),
			plan: (progress, now) => planMihonFolder(mihon, progress, now)
		});
	// Mihon's local source: books put on the tablet by hand, hidden like
	// Hentoid's (doc/IMPORT-MIHON.md, "Local source").
	const local = mihon ? join(mihon, 'local') : null;
	if (mihon && local && existsSync(local))
		out.push({
			name: 'Mihon local',
			device,
			root: local,
			hidden: true,
			markMissing: false,
			bytes: () => localBytes(mihon),
			plan: async (progress, now) => {
				const folders = await scanLocal(mihon, progress);
				const backupPath = await newestBackup(mihon);
				const backup = backupPath ? await readBackup(backupPath) : null;
				const present = new Set(folders.map((f) => f.dir));
				return {
					series: planMihonLocal(backup, folders, local, now),
					skipped: 0,
					// A local folder deleted from the device: its entries stay, not downloaded.
					after: (db, rootId) => {
						for (const r of entriesIn(db, rootId, local))
							if (!present.has(r.rel.split('/')[0]))
								db.prepare(`UPDATE entries SET available = 0 WHERE id = ?`).run(r.id);
					}
				};
			}
		});
	const hentoid = hentoidRoot(library);
	if (hentoid)
		out.push({
			name: 'Hentoid',
			device,
			root: hentoid,
			hidden: true,
			markMissing: false,
			bytes: () => hentoidBytes(hentoid),
			plan: async (progress, now) => {
				const { series, folders, pageless } = await planHentoidFolder(hentoid, progress, now);
				return {
					series,
					skipped: 0,
					after: (db, rootId) => {
						// A book folder deleted from the device: its entries stay, not downloaded.
						for (const r of entriesIn(db, rootId, hentoid))
							if (!folders.has(r.rel))
								db.prepare(`UPDATE entries SET available = 0 WHERE id = ?`).run(r.id);
						// A folder with no pages was never a book (c64): what an earlier
						// import made of it goes, unless the owner touched it.
						prunePageless(db, rootId, hentoid, pageless);
					}
				};
			}
		});
	// Moon+ Reader's books: every EPUB under Library/ (doc/IMPORT-EPUB.md).
	const books = epubRoot(library);
	if (books)
		out.push({
			name: 'Library',
			device,
			root: books,
			hidden: false,
			markMissing: false,
			bytes: () => epubBytes(books),
			plan: async (progress, now) => ({
				// Named from the device's own folder, so the same book on two devices
				// has one key (`epub:Library/…`).
				series: await planEpubFolder(books, library, progress, now),
				skipped: 0
			})
		});
	return out;
}

export type SourceSummary = {
	name: string;
	seriesCreated: number;
	seriesUpdated: number;
	entriesAdded: number;
	filesAttached: number;
	skipped: number;
	backup?: string | null;
};

export type ImportSummary = { jobId: number; failedFiles: number; sources: SourceSummary[] };

let running: Promise<ImportSummary> | null = null;

/**
 * Import every device folder under `library`. One at a time: a second call
 * while one runs gets the running one.
 */
export function runImport(
	library: string,
	opts: { now?: number; covers?: boolean } = {}
): Promise<ImportSummary> {
	if (running) return running;
	running = run(sourcesIn(library), opts.now ?? Date.now()).finally(() => {
		running = null;
	});
	// Covers follow the scan, in the background: the library is usable at once,
	// and tiles gain their covers as they're made (doc/COVERS.md). Opt-in, so
	// the specs never write to the library disk or reach the internet.
	// Catalogue links go first (doc/LINKS.md): a series linked in this pass
	// has its cover from the link in the same pass.
	if (opts.covers)
		void running
			.then(() =>
				refreshLinks({ log: (line) => console.log(`[import] ${line}`) }).catch((e: unknown) => {
					console.error('tsundoku: links after the scan failed:', e);
				})
			)
			.then(() => refreshCovers())
			.catch((e: unknown) => {
				console.error('tsundoku: covers after the scan failed:', e);
			});
	return running;
}

async function run(sources: Source[], now: number): Promise<ImportSummary> {
	const db = getDb();
	// A job left unfinished by a process that died is over.
	db.prepare(`UPDATE scan_jobs SET finished_at = ? WHERE finished_at IS NULL`).run(now);
	const jobId = Number(
		db
			.prepare(`INSERT INTO scan_jobs (started_at, source_label, steps, step) VALUES (?, ?, ?, 1)`)
			.run(now, [...new Set(sources.map((s) => s.name.toUpperCase()))].join(' + '), sources.length)
			.lastInsertRowid
	);
	const p = { bytesDone: 0, bytesTotal: 0, seriesFound: 0, failedFiles: 0, step: 1 };
	const update = db.prepare(
		`UPDATE scan_jobs SET bytes_done = @bytesDone, bytes_total = @bytesTotal, series_found = @seriesFound,
			failed_files = @failedFiles, step = @step WHERE id = @id`
	);
	const flush = () => update.run({ ...p, id: jobId });
	const summary: ImportSummary = { jobId, failedFiles: 0, sources: [] };
	let created = 0;

	try {
		for (const s of sources) p.bytesTotal += await s.bytes();
		flush();
		for (const [i, source] of sources.entries()) {
			p.step = i + 1;
			flush();
			let last = 0;
			const plan = await source.plan(({ bytes, failed }) => {
				p.bytesDone += bytes;
				if (failed) p.failedFiles += 1;
				if (Date.now() - last > 500) {
					last = Date.now();
					flush();
				}
			}, now);
			// Another device's copy joins the library folder's root of the same
			// name: one hidden Hentoid shelf, and a grouped book found on either.
			const rootId = source.device
				? ensureNamedRoot(db, source.name, source.root, source.hidden)
				: ensureRoot(db, source.name, source.root, source.hidden);
			const out: SourceSummary = {
				name: source.device ? `${source.name} · ${source.device}` : source.name,
				seriesCreated: 0,
				seriesUpdated: 0,
				entriesAdded: 0,
				filesAttached: 0,
				skipped: plan.skipped,
				backup: plan.backup
			};
			let written = 0;
			for (const series of plan.series) {
				const r = writeSeries(
					series,
					{ rootId, jobId, now, markMissing: source.markMissing, deviceRoot: source.root },
					db
				);
				if (r.created) out.seriesCreated += 1;
				else out.seriesUpdated += 1;
				out.entriesAdded += r.entriesAdded;
				out.filesAttached += r.filesAttached;
				// The band counts arrivals ("N SERIES SO FAR") and is shown while
				// reveal may be off: nothing hidden, by series or by root, counts.
				if (r.created && !series.hidden && !source.hidden) p.seriesFound += 1;
				if (++written % 20 === 0) {
					flush();
					// Let requests in between batches: the library polls this job.
					await new Promise((r) => setImmediate(r));
				}
			}
			plan.after?.(db, rootId);
			created += out.seriesCreated;
			summary.sources.push(out);
		}
		// Once every source is in: a chapter from two scanlators is one chapter.
		reconcileDuplicates(undefined, db);
		summary.failedFiles = p.failedFiles;
		p.bytesDone = p.bytesTotal;
		flush();
		finishJob(db, jobId, created);
		return summary;
	} catch (e) {
		flush();
		db.prepare(
			`UPDATE scan_jobs SET finished_at = ?, failed_files = failed_files + 1 WHERE id = ?`
		).run(Date.now(), jobId);
		throw e;
	}
}

/**
 * START SCAN and `/scan`: start the import in the background and return at
 * once. `started: false` when there is nothing to import, with where it looked.
 */
export function startScan(
	root = libraryRoot()
): { started: true } | { started: false; looked: string } {
	if (sourcesIn(root).length === 0) return { started: false, looked: root };
	runImport(root, { covers: true })
		// New books are compared with the rest (doc/DUPLICATE-BOOKS.md). Loaded
		// here, not above: finding also runs from a plain node script.
		.then(() => import('../dupes.ts'))
		.then(({ findDuplicates }) =>
			findDuplicates({ log: (line) => console.log(`[import] ${line}`) })
		)
		.catch((e: unknown) => {
			// The job row is already marked finished with a failure; the log says why.
			console.error('[import] failed:', e);
		});
	return { started: true };
}
