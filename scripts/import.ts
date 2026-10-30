/**
 * Import from the device copies under the library folder, without the app
 * running -- the way to do the first, large import:
 *
 *   yarn run import                       # LIBRARY_ROOT, or TSUNDOKU_HOME/library
 *   yarn run import -- --root <folder>    # a folder holding Mihon/ and/or H/.Hentoid/
 *
 * The same code START SCAN runs. See doc/IMPORT-MIHON.md, doc/IMPORT-HENTOID.md.
 */
import { fileURLToPath } from 'node:url';
import { databasePath } from '../src/lib/server/db.ts';
import { libraryRoot, runImport, sourcesIn } from '../src/lib/server/import/index.ts';

// DATABASE_PATH and LIBRARY_ROOT live in .env; without it this would import
// into the dev database. Shell variables still win.
try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	// No .env: the defaults.
}

const flag = process.argv.indexOf('--root');
const library = flag >= 0 ? process.argv[flag + 1] : libraryRoot();
const sources = sourcesIn(library);
if (sources.length === 0) {
	console.error(`no Mihon/ or H/.Hentoid/ in ${library}; nothing to import.`);
	process.exit(1);
}
const started = Date.now();
console.log(`importing ${sources.map((s) => s.root).join(', ')} into ${databasePath()} …`);
const summary = await runImport(library, { covers: false });
for (const s of summary.sources) {
	console.log(`\n${s.name}`);
	if (s.backup !== undefined) console.log(`  backup:          ${s.backup ?? '(none found)'}`);
	console.log(`  series created:  ${s.seriesCreated}`);
	console.log(`  series updated:  ${s.seriesUpdated}`);
	console.log(`  entries added:   ${s.entriesAdded}`);
	console.log(`  files attached:  ${s.filesAttached}`);
	if (s.skipped) console.log(`  browsed only:    ${s.skipped} (not imported)`);
}
console.log(`\nunreadable:        ${summary.failedFiles}`);
console.log(`took:              ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`\ncovers:            run \`yarn run covers\` (the app does this after START SCAN)`);
