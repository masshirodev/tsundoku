/**
 * Import from the device copies under the library folder, without the app
 * running -- the way to do the first, large import:
 *
 *   yarn run import                       # LIBRARY_ROOT, or /mnt/hdd2/tsundoku/library
 *   yarn run import -- --root <folder>    # a folder holding Mihon/
 *
 * The same code START SCAN runs. See doc/IMPORT-MIHON.md.
 */
import { databasePath } from '../src/lib/server/db.ts';
import { importMihon, mihonRoot } from '../src/lib/server/import/mihon.ts';

const flag = process.argv.indexOf('--root');
const libraryRoot =
	flag >= 0 ? process.argv[flag + 1] : (process.env.LIBRARY_ROOT ?? '/mnt/hdd2/tsundoku/library');
const root = mihonRoot(libraryRoot);
if (!root) {
	console.error(`no Mihon/ folder in ${libraryRoot}; nothing to import.`);
	process.exit(1);
}
const started = Date.now();
console.log(`importing ${root} into ${databasePath()} …`);
const s = await importMihon(root);
console.log(
	[
		`backup:          ${s.backup ?? '(none found)'}`,
		`series created:  ${s.seriesCreated}`,
		`series updated:  ${s.seriesUpdated}`,
		`chapters added:  ${s.entriesAdded}`,
		`files attached:  ${s.filesAttached}`,
		`browsed only:    ${s.skipped} (not imported)`,
		`unreadable:      ${s.failedFiles}`,
		`took:            ${((Date.now() - started) / 1000).toFixed(1)}s`
	].join('\n')
);
