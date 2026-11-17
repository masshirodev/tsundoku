/**
 * Fill an empty development database with the design's sample library, so
 * the library screen has something to show without an import.
 *
 *   yarn run seed
 *
 * Refuses a database that already holds series: this is a development aid,
 * and seeding sample titles into a real library would be a mess to undo.
 */
import { getDb, databasePath } from '../src/lib/server/db.ts';
import { seedSample } from '../src/lib/server/fixtures.ts';

const db = getDb();
const { n } = db.prepare('SELECT COUNT(*) AS n FROM series').get() as { n: number };
if (n > 0) {
	console.error(`${databasePath()} already holds ${n} series; refusing to seed over it.`);
	process.exit(1);
}
seedSample(db);
const after = db.prepare('SELECT COUNT(*) AS n FROM series').get() as { n: number };
console.log(`seeded ${after.n} sample series into ${databasePath()}`);
