/**
 * Ranobe (doc/RANOBE.md), by hand: the pass an import runs, now. Novels
 * linked by the AniList and MAL ids they have, editions found or suggested,
 * entries mapped onto units, and what's read sent.
 *
 *   yarn run ranobe
 *
 * Logs counts only, never titles. Needs RANOBE_TOKEN in .env.
 */
import { fileURLToPath } from 'node:url';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	// No .env: the defaults.
}

const { syncRanobe } = await import('../src/lib/server/ranobe.ts');
const started = Date.now();
const r = await syncRanobe();
if (!r) {
	console.log('ranobe: no RANOBE_TOKEN in .env, nothing to do (doc/SECRETS.md)');
	process.exit(0);
}
console.log(`ranobe: ${r.linked} linked by id`);
console.log(
	`  editions:  ${r.editions.found} found, ${r.editions.suggested} suggested, ${r.editions.waiting} waiting on review`
);
console.log(`  mapped:    ${r.mapped} entries onto units`);
console.log(
	`  sent:      ${r.sent.read} read, ${r.sent.unread} unread, ${r.sent.works} ratings/favourites, ${r.sent.failed} failed`
);
if (r.unreachable) console.log('  Ranobe unreachable: the next run carries on');
console.log(`took ${Math.round((Date.now() - started) / 1000)}s`);
