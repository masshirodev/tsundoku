import { importRunning, libraryRoot, startScan } from '../import/index.ts';
import { getDb } from '../db.ts';
import { engineConfigured } from './client.ts';
import { startWorker } from './worker.ts';

/**
 * Which backend the download screens ask (doc/DOWNLOADER.md, "Until parity"):
 * Suwayomi until the engine's has parity, the engine with
 * `DOWNLOADS_BACKEND=engine`. Both can run side by side; the switch is one
 * line in `.env`.
 */
export const downloadsBackend = (): 'engine' | 'suwayomi' =>
	process.env.DOWNLOADS_BACKEND === 'engine' && engineConfigured() ? 'engine' : 'suwayomi';

let importTimer: ReturnType<typeof setTimeout> | null = null;
let lastImport = 0;

/**
 * Twenty seconds after the last chapter landed, and never more than once a
 * minute, as the Suwayomi watcher imports (suwayomi-watch.ts): a series
 * downloading chapter after chapter imports in batches, not a scan each.
 */
function importSoon() {
	if (importTimer) clearTimeout(importTimer);
	const wait = Math.max(20_000, lastImport + 60_000 - Date.now());
	importTimer = setTimeout(() => void importNow(), wait);
	importTimer.unref();
}

/**
 * A scan already under way began before these chapters existed, and joining
 * it would miss them (seen live on 2026-10-28: two chapters written during a
 * scan stayed IMPORTING). So it is waited out, and a scan of its own follows.
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
process.once('SIGTERM', () => importTimer && clearTimeout(importTimer));

let started = false;

/** Starts the downloader once, when the engine backend is on, and imports what a restart left. */
export function ensureEngineWorker(): void {
	if (downloadsBackend() !== 'engine' || started) return;
	started = true;
	startWorker(libraryRoot(), importSoon);
	if (pendingImports() > 0) importSoon();
}
