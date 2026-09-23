import { importMihon, mihonRoot } from './mihon.ts';

/**
 * Where the device copies live: a folder that mirrors the tablet's shared
 * storage, so `Mihon/` (and later `H/.Hentoid/`) sit in it as they do on the
 * device and can be refreshed with a plain rsync. doc/IMPORT-MIHON.md.
 */
export function libraryRoot(): string {
	return process.env.LIBRARY_ROOT ?? '/mnt/hdd2/tsundoku/library';
}

/**
 * START SCAN and `/scan`: start every importer that has something to read,
 * in the background, and return at once -- the library follows the job in
 * `scan_jobs`. Null when there is nothing to import, with where it looked.
 */
export function startScan(
	root = libraryRoot()
): { started: true } | { started: false; looked: string } {
	const mihon = mihonRoot(root);
	if (!mihon) return { started: false, looked: root };
	importMihon(mihon).catch((e: unknown) => {
		// The job row is already marked finished with a failure; the log says why.
		console.error('[import] Mihon import failed:', e);
	});
	return { started: true };
}
