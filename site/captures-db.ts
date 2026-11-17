/**
 * Readies the capture run's scratch database (captures.config.ts), after the
 * seed and before the app serves it. Every sample series carries the same
 * fixture description, which says it is a fixture and names the hidden
 * Hentoid root ("Development sample. ... Hentoid has none ..."): right for
 * development, wrong on a public page. Cleared, the series screen draws the
 * way it does for any series without a description, so the figure is still
 * the app as it is, not a retouched picture of it.
 */
import Database from 'better-sqlite3';

const path = process.env.DATABASE_PATH;
if (!path || !path.includes('tsundoku-site-captures-'))
	throw new Error(`captures-db.ts only touches a capture run's scratch database, not ${path}`);
const db = new Database(path);
const { changes } = db
	.prepare(`UPDATE series SET description = '' WHERE description LIKE 'Development sample.%'`)
	.run();
// The seed keeps one doujin in the visible library (Hoshi no Umi no Tabibito).
// The site names no doujinshi at all, so it goes into the hidden root with the
// others: hidden the way the app hides anything, which reveal-off then keeps
// out of view.
const hidden = db.prepare(`SELECT id FROM roots WHERE hidden = 1 ORDER BY id LIMIT 1`).get() as
	{ id: number } | undefined;
if (!hidden) throw new Error('the seed has no hidden root to move the visible doujin into');
const moved = db
	.prepare(
		`UPDATE series SET root_id = ? WHERE kind = 'doujin' AND root_id IN (SELECT id FROM roots WHERE hidden = 0)`
	)
	.run(hidden.id).changes;
db.close();
console.log(
	`site captures: cleared the fixture description from ${changes} series, hid ${moved} visible doujin`
);
