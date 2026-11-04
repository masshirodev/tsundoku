import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import {
	backupBytes,
	backupFolder,
	downloadBytes,
	hasBackup,
	mihonRoot,
	planMihonBackup,
	planMihonFolder,
	planMihonSeries
} from './mihon.ts';
import { join, relative } from '../fspath.ts';
import { readdirSync } from 'node:fs';
import { isUnder } from '../paths.ts';
import { hentoidBytes, hentoidRoot, planHentoidFolder } from './hentoid.ts';
import { epubBytes, epubRoot, planEpubFile, planEpubFolder } from './epub.ts';
import { animeBytes, animeSeriesDirs, planAnimeFolders, planAnimeSeries } from './anime.ts';
import { ANIME_FOLDER } from '../../library/anime-files.ts';
import { closeDeadJobs, ensureRoot, ensureNamedRoot, finishJob, writeSeries } from './write.ts';
import { reconcileDuplicates } from '../duplicates.ts';
import { refreshCovers } from '../covers.ts';
import { refreshLinks } from '../catalogue.ts';
import type { PlannedSeries } from '../../import/plan.ts';
import { dataPaths } from '../data-dirs.ts';

/**
 * Running an import (doc/IMPORT-MIHON.md, doc/IMPORT-HENTOID.md). One scan
 * job covers every device folder found under the library folder, one step
 * each, with the library's IMPORTING band following `scan_jobs`.
 */

/**
 * Where the library lives: a folder holding `<library>/Mihon` (a backup, and
 * tsundoku's downloads under `devices/tsundoku/`), `H/.Hentoid/` and the rest.
 */
export function libraryRoot(): string {
	return dataPaths().library;
}

export type Source = {
	name: 'Mihon' | 'Hentoid' | 'Library' | 'Anime';
	/** What the band and the log call the job, when not the source's name: MIHON BACKUP (c438). */
	label?: string;
	/** The job opened for it: IMPORT A BACKUP ties its row to the job (c438). */
	started?(db: Database.Database, jobId: number): void;
	/** After each series is written: IMPORT A BACKUP keeps which series it brought, and counts. */
	written?(db: Database.Database, series: PlannedSeries, created: boolean): void;
	/**
	 * Another device's copy (doc/SYNC.md, "Other devices"): `devices/<name>/`
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
	/**
	 * The series one file of it belongs to, planned as `plan` plans it: what a
	 * download attaches at once (attachWritten). Only the sources tsundoku's
	 * own downloaders write to.
	 */
	planOne?(file: string, now: number): Promise<PlannedSeries[]>;
};

/**
 * Every source the library reads. The library folder's own: a Mihon backup, a
 * Hentoid copy, EPUBs, the episodes tsundoku downloaded. Then each folder
 * under `devices/`: tsundoku's own `Mihon/` (its downloads) and any device's
 * `Hentoid/` and `Library/` (doc/SYNC.md, "Other devices").
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
 * a favourite, on no shelf, not linked, and in no Work. Not a delete: no
 * tombstone, so a download finished later imports as it would have.
 *
 * "Linked" is every row a link leaves (c382): `series_links`, and since rung
 * 62 a season's own link or decision, which a series can hold with no
 * `series_links` mirror at all (`syncSeriesLink` mirrors season 1 alone). The
 * cascade would take those rows with the series. A Work is the owner's
 * grouping, as a shelf is, and its delete would end the Work it leaves with
 * one (rung 61's trigger).
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
				AND NOT EXISTS (SELECT 1 FROM series_links l WHERE l.series_id = series.id)
				AND NOT EXISTS (SELECT 1 FROM series_season_links l WHERE l.series_id = series.id)
				AND NOT EXISTS (SELECT 1 FROM season_link_decisions d WHERE d.series_id = series.id)
				AND NOT EXISTS (SELECT 1 FROM work_series w WHERE w.series_id = series.id)`
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
	// c191: the mirror scan is gone (the tablet's, the phone's and Waydroid's
	// `Mihon/` folders); what a library reads from a `Mihon/` folder now is a
	// backup, and tsundoku's own downloads in the one device it writes
	// (doc/IMPORT-MIHON.md, "Where it reads from"). A folder with no backup in
	// it is no source (c268, c292): a scan of it would find nothing and leave
	// no band, where refusing says where it looked. Asked here rather than in
	// the plan, so no job is opened for it and the same answer serves the
	// refusal's sentence.
	if (mihon && device === null && hasBackup(mihon))
		out.push({
			name: 'Mihon',
			device,
			root: mihon,
			hidden: false,
			// Nothing on disk is this source's to mark gone: a folder is not a device's copy.
			markMissing: false,
			bytes: () => backupBytes(mihon),
			plan: (progress, now) => planMihonBackup(mihon, now)
		});
	// tsundoku's own downloads, in Mihon's layout, read back the way they were
	// written (doc/DOWNLOADER.md): the one folder source left.
	if (mihon && device === 'tsundoku')
		out.push({
			name: 'Mihon',
			device,
			root: mihon,
			hidden: false,
			markMissing: true,
			bytes: () => downloadBytes(mihon),
			plan: (progress, now) => planMihonFolder(mihon, progress, now),
			planOne: (file, now) => planMihonSeries(mihon, file, now)
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
			}),
			planOne: async (file, now) => [await planEpubFile(file, library, () => {}, now)]
		});
	// Episodes tsundoku downloaded, in Jellyfin's layout (doc/ANIME.md, "Downloading"):
	// the library folder's own, since only the workstation downloads them.
	if (device === null && animeSeriesDirs(library).length > 0)
		out.push({
			name: 'Anime',
			device,
			root: join(library, ANIME_FOLDER),
			hidden: false,
			// An episode file deleted from the folder is NOT DOWNLOADED again; it still streams.
			markMissing: true,
			bytes: async () => animeBytes(library),
			plan: async (progress, now) => ({
				series: planAnimeFolders(library, progress, now),
				skipped: 0
			}),
			planOne: async (file, now) => planAnimeSeries(library, file, now)
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

/** The import under way, if one is: a caller whose files arrived after it began waits for it, then starts its own. */
export const importRunning = (): Promise<ImportSummary> | null => running;

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
	if (opts.covers) afterImport(running);
	return running;
}

/**
 * One source run as its own job once nothing else runs (c438: IMPORT A
 * BACKUP). One import or scan at a time, as runImport keeps it; this one
 * waits its turn rather than joining the running one, because it reads a file
 * the running one knows nothing of. `waiting` is called when it has to wait.
 */
export async function runQueued(
	source: Source,
	opts: { covers?: boolean; waiting?: () => void } = {}
): Promise<ImportSummary> {
	if (running) opts.waiting?.();
	while (running) await running.catch(() => {});
	running = run([source], Date.now()).finally(() => {
		running = null;
	});
	if (opts.covers) afterImport(running);
	return running;
}

function afterImport(running: Promise<ImportSummary>): void {
	// Covers follow the scan, in the background: the library is usable at once,
	// and tiles gain their covers as they're made (doc/COVERS.md). Opt-in, so
	// the specs never write to the library disk or reach the internet.
	// Catalogue links go first (doc/LINKS.md): a series linked in this pass
	// has its cover from the link in the same pass.
	void running
		.then(() =>
			refreshLinks({ log: (line) => console.log(`[import] ${line}`) }).catch((e: unknown) => {
				console.error('tsundoku: links after the scan failed:', e);
			})
		)
		// The owner's lists, when signed in: links and what each says (doc/TRACKING.md).
		.then(() => import('../tracking.ts').then((t) => t.readLists()))
		// Novels and comics to Ranobe: links by id, editions, units, reads (doc/RANOBE.md).
		.then(() =>
			import('../ranobe.ts').then((r) =>
				r.syncRanobe().catch((e: unknown) => console.error('tsundoku: Ranobe pass failed:', e))
			)
		)
		.then(() => refreshCovers())
		.catch((e: unknown) => {
			console.error('tsundoku: covers after the scan failed:', e);
		});
}

/**
 * Another device's copy joins the library folder's root of the same name:
 * one hidden Hentoid shelf, and a grouped book found on either.
 */
function rootOf(db: Database.Database, source: Source): number {
	return source.device
		? ensureNamedRoot(db, source.name, source.root, source.hidden)
		: ensureRoot(db, source.name, source.root, source.hidden);
}

/**
 * What tsundoku's own downloaders just wrote, attached at once (card c170;
 * doc/DOWNLOADER.md, "Attaching"): each file's series planned by the source
 * that holds it, exactly as a scan plans it, and written by the same writer
 * with the same root and the same marking of what's gone. A later scan reads
 * the same files and changes nothing; it stays the cross-check, and the way
 * in for anything that arrives otherwise.
 *
 * Returns the files no source could take, which the caller leaves to a scan.
 */
export async function attachWritten(
	library: string,
	files: string[],
	now = Date.now()
): Promise<string[]> {
	const db = getDb();
	const sources = sourcesIn(library);
	const left: string[] = [];
	const touched = new Set<number>();
	// One plan per series: a batch of chapters is one folder.
	const planned = new Set<string>();
	for (const file of files) {
		// The innermost root holding it: a device's own folder sits inside the
		// library's, so the deepest match is the one that owns the file.
		const source = sources
			.filter((s) => s.planOne && isUnder(file, s.root))
			.sort((a, b) => b.root.length - a.root.length)[0];
		if (!source) {
			left.push(file);
			continue;
		}
		const series = await source.planOne!(file, now);
		if (series.length === 0) left.push(file);
		const rootId = rootOf(db, source);
		for (const s of series) {
			if (planned.has(s.path)) continue;
			planned.add(s.path);
			writeSeries(
				s,
				{ rootId, jobId: null, now, markMissing: source.markMissing, deviceRoot: source.root },
				db
			);
			const id = db.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(s.originKey) as
				{ id: number } | undefined;
			if (id) touched.add(id.id);
		}
	}
	if (touched.size > 0) reconcileDuplicates([...touched], db);
	return left;
}

async function run(sources: Source[], now: number): Promise<ImportSummary> {
	const db = getDb();
	// A job left unfinished by a process that died is over.
	closeDeadJobs(db, now);
	const jobId = Number(
		db
			.prepare(`INSERT INTO scan_jobs (started_at, source_label, steps, step) VALUES (?, ?, ?, 1)`)
			.run(
				now,
				[...new Set(sources.map((s) => s.label ?? s.name.toUpperCase()))].join(' + '),
				sources.length
			).lastInsertRowid
	);
	for (const s of sources) s.started?.(db, jobId);
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
			const rootId = rootOf(db, source);
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
				source.written?.(db, series, r.created);
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
 * Where a scan with nothing to import looked: the library folder, and, when it
 * has a `Mihon/` folder, the folder in it a backup is read from (c268), so an
 * empty `Mihon/` answers with where the backup should have been.
 */
export type Looked = { looked: string; backups: string | null };

export function whereItLooked(root: string): Looked {
	const mihon = mihonRoot(root);
	return { looked: root, backups: mihon ? backupFolder(mihon) : null };
}

/**
 * The sentence a refused scan shows (START SCAN, RESCAN, `/scan`): what it
 * found nothing in, by the folders it read.
 */
export function nothingToImport(l: Looked): string {
	return l.backups
		? `NOTHING TO IMPORT · NO BACKUP IN ${l.backups} AND NO H/.Hentoid/ FOLDER IN ${l.looked}`
		: `NOTHING TO IMPORT · NO Mihon/ FOLDER OR H/.Hentoid/ FOLDER IN ${l.looked}`;
}

/**
 * START SCAN and `/scan`: start the import in the background and return at
 * once. `started: false` when there is nothing to import, with where it looked.
 */
export function startScan(
	root = libraryRoot()
): { started: true } | ({ started: false; message: string } & Looked) {
	if (sourcesIn(root).length === 0) {
		const looked = whereItLooked(root);
		return { started: false, ...looked, message: nothingToImport(looked) };
	}
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
