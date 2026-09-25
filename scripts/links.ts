/**
 * Catalogue links (doc/LINKS.md), by hand: Mihon's MAL links resolved on
 * AniList, then every series that can be searched is, not just the pass's
 * sixty. Sure matches link; the rest wait for the review at /links.
 *
 *   yarn run links              # every series not yet searched
 *   yarn run links --limit 100  # at most 100
 *   yarn run links --again      # search again what the pass couldn't link
 *
 * Logs counts only, never titles. Covers follow with `yarn run covers`.
 */
import { fileURLToPath } from 'node:url';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	// No .env: the defaults.
}

const { refreshLinks, linkCount, requeueSearched } = await import('../src/lib/server/catalogue.ts');
if (process.argv.includes('--again')) console.log(`links: ${requeueSearched()} to search again`);
const at = process.argv.indexOf('--limit');
const limit = at > 0 ? Number(process.argv[at + 1]) : 100_000;
const started = Date.now();
const r = await refreshLinks({ limit, log: (line) => console.log(`  ${line}`) });
console.log(`links: ${r.resolved} resolved on AniList`);
console.log(`  searched:  ${r.searched}`);
console.log(`  linked:    ${r.linked} (exact)`);
console.log(`  to review: ${r.offered}`);
if (r.unreachable) console.log(`  AniList unreachable (${r.reason}): the next run carries on`);
console.log(`${linkCount()} linked in all, took ${Math.round((Date.now() - started) / 1000)}s`);
