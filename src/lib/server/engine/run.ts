import { libraryRoot, startScan } from '../import/index.ts';
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
	importTimer = setTimeout(() => {
		importTimer = null;
		lastImport = Date.now();
		startScan();
	}, wait);
	importTimer.unref();
}
process.once('SIGTERM', () => importTimer && clearTimeout(importTimer));

/** Starts the downloader once, when the engine backend is on. */
export function ensureEngineWorker(): void {
	if (downloadsBackend() !== 'engine') return;
	startWorker(libraryRoot(), importSoon);
}
