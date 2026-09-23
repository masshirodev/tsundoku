/**
 * Bring every series' cover up to date (doc/COVERS.md):
 *
 *   yarn run covers            # from files, then from the source sites
 *   yarn run covers --local    # from files only; nothing leaves the workstation
 *
 * The import runs the same thing after every scan.
 */
import { fileURLToPath } from 'node:url';
import { coverDir, refreshCovers } from '../src/lib/server/covers.ts';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	// No .env: the defaults.
}

const remote = !process.argv.includes('--local');
const started = Date.now();
let done = 0;
const counts = await refreshCovers({
	remote,
	progress: () => {
		if (++done % 500 === 0) console.log(`  ${done} …`);
	}
});
console.log(`covers in ${coverDir()}${remote ? '' : ' (local only)'}`);
console.log(`  made:    ${counts.made}`);
console.log(`  kept:    ${counts.kept}`);
console.log(`  none:    ${counts.none}`);
console.log(`  failed:  ${counts.failed}`);
console.log(`took ${((Date.now() - started) / 1000).toFixed(1)}s`);
