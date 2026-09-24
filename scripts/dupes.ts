/**
 * Find duplicate books (doc/DUPLICATE-BOOKS.md): books whose covers are
 * alike are paired, and each new pair's pages are hashed and lined up for the
 * review. The app runs the same after every import; this is the by-hand way.
 *
 *   yarn run dupes
 *
 * Logs counts only, never titles.
 */
import { fileURLToPath } from 'node:url';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	// No .env: the defaults.
}

const { findDuplicates } = await import('../src/lib/server/dupes.ts');
const started = Date.now();
const r = await findDuplicates({ log: (l) => console.log(l) });
console.log(`dupes: ${r.pairs} pairs, took ${Math.round((Date.now() - started) / 1000)}s`);
