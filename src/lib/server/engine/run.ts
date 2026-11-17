import { attachWritten, importRunning, libraryRoot, startScan } from '../import/index.ts';
import { getDb } from '../db.ts';
import { engineConfigured } from './client.ts';
import { startWorker } from './worker.ts';
import { followNew } from '../downloads.ts';
import { pruneRecords } from '../browsing.ts';
import { pendingNovelImports, startNovelWorker } from '../novels/downloader.ts';
import { pendingAnimeImports, startAnimeWorker } from '../anime/download.ts';

/**
 * Whether downloading is on here: tsundoku's engine, when ENGINE_URL and
 * ENGINE_TOKEN are set (doc/DOWNLOADS.md).
 */
export const downloadsBackend = (): 'engine' | 'none' => (engineConfigured() ? 'engine' : 'none');

/**
 * What a downloader just wrote, attached at once (doc/DOWNLOADS.md,
 * "Attaching"): the entry opens when the file lands, with no IMPORTING between.
 * A scan follows only for what didn't attach, or when one is already under
 * way: it was planned before these files existed, and writing its plan would
 * mark them gone again, so a scan of its own follows it (importSoon).
 */
async function arrived(files: string[]) {
	let left = files;
	try {
		left = await attachWritten(libraryRoot(), files);
	} catch (e) {
		console.warn(`tsundoku: attaching a download: ${(e as Error).message}`);
	}
	if (left.length > 0 || importRunning()) importSoon();
}

let importTimer: ReturnType<typeof setTimeout> | null = null;
let lastImport = 0;

/**
 * Twenty seconds after the last chapter landed, and never more than once a
 * minute: a series downloading chapter after chapter imports in batches, not
 * a scan each.
 */
function importSoon() {
	if (importTimer) clearTimeout(importTimer);
	const wait = Math.max(20_000, lastImport + 60_000 - Date.now());
	importTimer = setTimeout(() => void importNow(), wait);
	importTimer.unref();
}

/**
 * A scan already under way began before these chapters existed, and joining
 * it would miss them (seen live: two chapters written during a scan stayed
 * IMPORTING). So it is waited out, and a scan of its own follows.
 */
async function importNow() {
	importTimer = null;
	await importRunning()?.catch(() => {});
	lastImport = Date.now();
	startScan();
}

/** Chapters written but not imported yet: a restart dropped their import. */
const pendingImports = () =>
	(
		getDb()
			.prepare(
				`SELECT COUNT(*) AS n FROM engine_chapters c JOIN entries e ON e.id = c.entry_id
				WHERE c.downloaded_at IS NOT NULL AND e.available = 0`
			)
			.get() as { n: number }
	).n;
/**
 * FOLLOW's step every ten minutes (followNew asks each followed series'
 * source every six hours, a few a run). The app runs it itself, beside the
 * worker.
 */
const FOLLOW_STEP_MS = 10 * 60 * 1000;
let followTimer: ReturnType<typeof setInterval> | null = null;
let following = false;
async function followStep() {
	if (following) return;
	following = true;
	try {
		// Browsing records not opened for 30 days are forgotten on the same clock.
		pruneRecords();
		await followNew();
	} catch (e) {
		console.warn(`tsundoku: FOLLOW's step: ${(e as Error).message}`);
	} finally {
		following = false;
	}
}

process.once('SIGTERM', () => {
	if (importTimer) clearTimeout(importTimer);
	if (followTimer) clearInterval(followTimer);
});

let started = false;

/**
 * Starts the downloaders and FOLLOW's step once, when the engine is set up,
 * and imports what a restart left. The novel worker (novels/downloader.ts)
 * needs no engine, but everything that queues a novel (BROWSE, ADD) is
 * behind it, so it starts here too.
 */
export function ensureEngineWorker(): void {
	if (downloadsBackend() !== 'engine' || started) return;
	started = true;
	const onArrived = (files: string[]) => void arrived(files);
	startWorker(libraryRoot(), onArrived);
	startNovelWorker(libraryRoot(), onArrived);
	startAnimeWorker(libraryRoot(), onArrived);
	if (pendingImports() + pendingNovelImports() + pendingAnimeImports() > 0) importSoon();
	followTimer = setInterval(() => void followStep(), FOLLOW_STEP_MS);
	followTimer.unref();
}
