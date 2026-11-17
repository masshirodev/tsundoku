import { beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb, climb } = await import('$lib/server/db');
const { startFacts } = await import('$lib/server/start');
const { tickingImport } = await import('$lib/server/import/log');

/**
 * GET STARTED's facts (doc/ONBOARDING.md, "What ticks a step"):
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

/**
 * 03's done row names the door that ticked the step (c634; c511 put the row
 * there): the import's line only when the series that first ticked 03 came
 * from an import's job, else the scan's own count. Nothing records the tick,
 * so it is read from the lowest id among the series 03 counts -- the first
 * row still there that made the count non-zero -- and that row's job.
 * Each case builds a database of its own, climbed to the code's top rung.
 */
describe('the import that ticked 03', () => {
	const fresh = () => {
		const conn = new Database(':memory:');
		climb(conn);
		// A discarded scan job first, so the first import's id and the first
		// job's id differ: a case that passed the import's id where a job's
		// belongs would then answer no import and go red.
		job(conn, 'EARLIER SCAN');
		return conn;
	};
	let n = 0;
	function rootOf(conn: Database.Database): number {
		n += 1;
		return Number(
			conn.prepare(`INSERT INTO roots (name, path) VALUES ('Mihon', ?)`).run(`/l/c634-${n}`)
				.lastInsertRowid
		);
	}
	function job(conn: Database.Database, label = 'MIHON BACKUP'): number {
		return Number(
			conn
				.prepare(`INSERT INTO scan_jobs (started_at, finished_at, source_label) VALUES (1, 2, ?)`)
				.run(label).lastInsertRowid
		);
	}
	function importOf(conn: Database.Database, jobId: number, app = 'mihon'): number {
		return Number(
			conn
				.prepare(
					`INSERT INTO imports (created_at, app, file_name, state, job_id, series_total, series_done)
					VALUES (1, ?, 'a.tachibk', 'done', ?, 0, 0)`
				)
				.run(app, jobId).lastInsertRowid
		);
	}
	/** A series as a scan or a backup wrote it; `created` is its place in the import. */
	function row(
		conn: Database.Database,
		root: number,
		o: { job?: number | null; key?: string | null; hidden?: 0 | 1; of?: number } = {}
	): number {
		n += 1;
		const id = Number(
			conn
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, indexed_at, origin_key, scan_job_id, in_library, hidden)
					VALUES (?, ?, 'manga', 0, 0, ?, ?, 1, ?)`
				)
				.run(root, `S${n}`, o.key ?? null, o.job ?? null, o.hidden ?? 0).lastInsertRowid
		);
		if (o.of) {
			conn
				.prepare(`INSERT INTO import_series (import_id, series_id, created) VALUES (?, ?, 1)`)
				.run(o.of, id);
		}
		return id;
	}

	it('a library scanned first keeps the scan’s line though a backup came later', () => {
		const conn = fresh();
		const root = rootOf(conn);
		const scan = job(conn, 'LIBRARY');
		row(conn, root, { job: scan });
		const impJob = job(conn);
		const imp = importOf(conn, impJob);
		// An import writes its series with its job's id (`write.ts`), not
		// ADD-shaped with the source's key and no job.
		row(conn, root, { job: impJob, key: 'mihon:1:/late', of: imp });
		expect(tickingImport(false, conn)).toBeNull();
	});

	it('a backup that came first names itself and its own count', () => {
		const conn = fresh();
		const root = rootOf(conn);
		const impJob = job(conn);
		const imp = importOf(conn, impJob);
		// Two series 03 counts, both the import's: one it made, one it merged.
		const made = row(conn, root, { job: impJob });
		const merged = row(conn, root, { job: impJob });
		conn
			.prepare(`INSERT INTO import_series (import_id, series_id, created) VALUES (?, ?, 1)`)
			.run(imp, made);
		conn
			.prepare(`INSERT INTO import_series (import_id, series_id, created) VALUES (?, ?, 0)`)
			.run(imp, merged);
		// A scan later counts for 03 too, but not for the line.
		row(conn, root, { job: job(conn, 'LIBRARY') });
		expect(tickingImport(false, conn)).toEqual({ id: imp, app: 'mihon', series: 2 });
		expect(tickingImport(true, conn)).toEqual({ id: imp, app: 'mihon', series: 2 });
	});

	it('a backup whose series are all hidden later leaves the scan’s line, until reveal', () => {
		const conn = fresh();
		const root = rootOf(conn);
		const impJob = job(conn);
		const imp = importOf(conn, impJob);
		row(conn, root, { job: impJob, hidden: 1, of: imp });
		row(conn, root, { job: impJob, hidden: 1, of: imp });
		const scan = job(conn, 'LIBRARY');
		row(conn, root, { job: scan });
		// Reveal off, only the scan's series is seen: the line is the scan's.
		expect(tickingImport(false, conn)).toBeNull();
		// Reveal on, the backup's own series are the first 03 counted.
		expect(tickingImport(true, conn)).toEqual({ id: imp, app: 'mihon', series: 2 });
	});

	it('the count is what the viewer sees, and a first row with no job keeps the scan’s line', () => {
		const conn = fresh();
		const root = rootOf(conn);
		const impJob = job(conn);
		const imp = importOf(conn, impJob);
		row(conn, root, { job: impJob, hidden: 1, of: imp });
		row(conn, root, { job: impJob, of: imp });
		expect(tickingImport(false, conn)).toEqual({ id: imp, app: 'mihon', series: 1 });

		// A series written before jobs (no key, no job) ticks 03 and has no door.
		const other = fresh();
		const otherRoot = rootOf(other);
		row(other, otherRoot, {});
		const laterJob = job(other);
		const later = importOf(other, laterJob);
		row(other, otherRoot, { job: laterJob, of: later });
		expect(tickingImport(false, other)).toBeNull();

		// An ADD made first (its key, no job) is not 03's, so the backup still names it.
		const added = fresh();
		const addedRoot = rootOf(added);
		row(added, addedRoot, { key: 'mihon:9:/added' });
		const backupJob = job(added);
		const backup = importOf(added, backupJob, 'aniyomi');
		row(added, addedRoot, { job: backupJob, of: backup });
		expect(tickingImport(false, added)).toEqual({ id: backup, app: 'aniyomi', series: 1 });

		// Nothing counted at all: no line.
		expect(tickingImport(false, fresh())).toBeNull();
	});

	it('a backup still running, or one that failed, keeps the scan’s line until it is done', () => {
		const conn = fresh();
		const root = rootOf(conn);
		const impJob = job(conn);
		const imp = importOf(conn, impJob);
		row(conn, root, { job: impJob, of: imp });
		const set = (state: string) =>
			conn.prepare(`UPDATE imports SET state = ? WHERE id = ?`).run(state, imp);
		// A partial count is not a done line: only `done` may name the step.
		for (const state of ['waiting', 'running', 'failed']) {
			set(state);
			expect(tickingImport(false, conn)).toBeNull();
		}
		set('done');
		expect(tickingImport(false, conn)).toEqual({ id: imp, app: 'mihon', series: 1 });
	});
});
