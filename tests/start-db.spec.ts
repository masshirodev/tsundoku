import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { startFacts } = await import('$lib/server/start');

/**
 * GET STARTED's facts (doc/ONBOARDING.md, "What ticks a step"; card c209):
 * a series a scan brought in is 03's, one ADD made is 06's, a browsing record
 * is 05's, the queue and what's downloaded are 07's, and a hidden series ticks
 * nothing for someone who can't see it.
 */

let entry = 0;
function series(o: {
	root: number;
	key?: string;
	job?: number;
	inLibrary?: 0 | 1;
	hidden?: 0 | 1;
}): number {
	const db = getDb();
	const id = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, indexed_at, origin_key, scan_job_id, in_library, hidden)
				VALUES (?, ?, 'manga', 0, 0, ?, ?, ?, ?)`
			)
			.run(
				o.root,
				`S${o.key ?? entry}`,
				o.key ?? null,
				o.job ?? null,
				o.inLibrary ?? 1,
				o.hidden ?? 0
			).lastInsertRowid
	);
	return id;
}
function chapter(seriesId: number): number {
	entry += 1;
	return Number(
		getDb()
			.prepare(`INSERT INTO entries (series_id, position, label, added_at) VALUES (?, ?, ?, 0)`)
			.run(seriesId, entry, `Ch. ${entry}`).lastInsertRowid
	);
}

let root: number;
let hiddenRoot: number;
beforeAll(() => {
	const db = getDb();
	root = Number(
		db.prepare(`INSERT INTO roots (name, path) VALUES ('Mihon', '/l/Mihon')`).run().lastInsertRowid
	);
	hiddenRoot = Number(
		db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('H', '/l/H', 1)`).run()
			.lastInsertRowid
	);
});

describe('the facts', () => {
	it('an empty library has none', () => {
		expect(startFacts(false)).toMatchObject({
			series: 0,
			records: 0,
			added: 0,
			queued: 0,
			downloaded: 0
		});
	});

	it('a scan, a key-less series, ADD and a record each count where they belong', () => {
		const job = Number(
			getDb().prepare(`INSERT INTO scan_jobs (started_at) VALUES (0)`).run().lastInsertRowid
		);
		// A Mihon backup's series: its key, and the scan that brought it.
		series({ root, key: 'mihon:1:/a', job });
		// One written before keys, or by hand: no key, so brought in.
		series({ root });
		// ADD from a preview: a key and no scan.
		const added = series({ root, key: 'mihon:1:/b' });
		// Read online, not added.
		series({ root, key: 'mihon:1:/c', inLibrary: 0 });
		expect(startFacts(false)).toMatchObject({ series: 2, added: 1, records: 1 });

		// A chapter queued, one downloaded by the engine.
		const db = getDb();
		db.prepare(
			`INSERT INTO download_queue (entry_id, series_id, position, queued_at) VALUES (?, ?, 1, 0)`
		).run(chapter(added), added);
		db.prepare(
			`INSERT INTO engine_chapters (entry_id, engine_url, downloaded_at) VALUES (?, '/x', 1)`
		).run(chapter(added));
		db.prepare(`INSERT INTO engine_chapters (entry_id, engine_url) VALUES (?, '/y')`).run(
			chapter(added)
		);
		expect(startFacts(false)).toMatchObject({ queued: 1, downloaded: 1 });
	});

	it('a hidden series ticks nothing until reveal', () => {
		const before = startFacts(false);
		const h = series({ root: hiddenRoot, key: 'mihon:1:/h' });
		getDb()
			.prepare(
				`INSERT INTO download_queue (entry_id, series_id, position, queued_at) VALUES (?, ?, 2, 0)`
			)
			.run(chapter(h), h);
		series({ root, key: 'mihon:1:/r', inLibrary: 0, hidden: 1 });
		expect(startFacts(false)).toMatchObject({
			added: before.added,
			queued: before.queued,
			records: before.records
		});
		expect(startFacts(true)).toMatchObject({
			added: before.added + 1,
			queued: before.queued + 1,
			records: before.records + 1
		});
	});
});
