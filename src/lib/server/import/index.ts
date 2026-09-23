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
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { hentoidBytes, hentoidRoot, planHentoidFolder } from './hentoid.ts';
import { ensureRoot, finishJob, writeSeries } from './write.ts';
import { reconcileDuplicates } from '../duplicates.ts';
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
	name: 'Mihon' | 'Mihon local' | 'Hentoid';
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

export function sourcesIn(library: string): Source[] {
	const out: Source[] = [];
	const mihon = mihonRoot(library);
	if (mihon)
		out.push({
			name: 'Mihon',
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
						const rows = db
							.prepare(
								`SELECT e.id, e.file FROM entries e JOIN series s ON s.id = e.series_id
								WHERE s.root_id = ? AND e.available = 1`
							)
							.all(rootId) as { id: number; file: string }[];
						for (const r of rows)
							if (!present.has(r.file.split('/')[0]))
								db.prepare(`UPDATE entries SET available = 0 WHERE id = ?`).run(r.id);
					}
				};
			}
		});
	const hentoid = hentoidRoot(library);
	if (hentoid)
		out.push({
			name: 'Hentoid',
			root: hentoid,
			hidden: true,
			markMissing: false,
			bytes: () => hentoidBytes(hentoid),
			plan: async (progress, now) => {
				const { series, folders } = await planHentoidFolder(hentoid, progress, now);
				return {
					series,
					skipped: 0,
					// A book folder deleted from the device: its entries stay, not downloaded.
					after: (db, rootId) => {
						const rows = db
							.prepare(
								`SELECT e.id, e.file FROM entries e JOIN series s ON s.id = e.series_id
								WHERE s.root_id = ? AND e.available = 1`
							)
							.all(rootId) as { id: number; file: string }[];
						for (const r of rows)
							if (!folders.has(r.file))
								db.prepare(`UPDATE entries SET available = 0 WHERE id = ?`).run(r.id);
					}
				};
			}
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
export function runImport(library: string, opts: { now?: number } = {}): Promise<ImportSummary> {
	if (running) return running;
	running = run(sourcesIn(library), opts.now ?? Date.now()).finally(() => {
		running = null;
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
			.run(now, sources.map((s) => s.name.toUpperCase()).join(' + '), sources.length)
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
			const rootId = ensureRoot(db, source.name, source.root, source.hidden);
			const out: SourceSummary = {
				name: source.name,
				seriesCreated: 0,
				seriesUpdated: 0,
				entriesAdded: 0,
				filesAttached: 0,
				skipped: plan.skipped,
				backup: plan.backup
			};
			let written = 0;
			for (const series of plan.series) {
				const r = writeSeries(series, { rootId, jobId, now, markMissing: source.markMissing }, db);
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
	runImport(root).catch((e: unknown) => {
		// The job row is already marked finished with a failure; the log says why.
		console.error('[import] failed:', e);
	});
	return { started: true };
}
