import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { climb } from '$lib/server/db';

/**
 * Rungs that move data, run against a database stopped at the rung before,
 * filled the way it was then.
 */
describe('rung 29: ratings out of 10 (c67)', () => {
	const old = () => {
		const conn = new Database(':memory:');
		climb(conn, 28);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Mihon', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at, rating) VALUES
				(1, 1, 'Five', 'manga', 1, 5), (2, 1, 'Three', 'manga', 1, 3), (3, 1, 'Unrated', 'manga', 1, 0);
			INSERT INTO entries (series_id, position, label, added_at, rating) VALUES (1, 1, 'Ch. 1', 1, 4);
			INSERT INTO series_links (series_id, via, linked_at, filled_rating) VALUES
				(1, 'mihon', 1, 5), (2, 'exact', 1, NULL);
		`);
		return conn;
	};

	it('doubles every rating exactly, and leaves unrated unrated', () => {
		const conn = old();
		climb(conn);
		expect(conn.prepare(`SELECT id, rating FROM series ORDER BY id`).all()).toEqual([
			{ id: 1, rating: 10 },
			{ id: 2, rating: 6 },
			{ id: 3, rating: 0 }
		]);
		expect(conn.prepare(`SELECT rating FROM entries`).get()).toEqual({ rating: 8 });
		// UNDO gives back what the link filled in, so that doubles too.
		expect(
			conn.prepare(`SELECT series_id, filled_rating FROM series_links ORDER BY series_id`).all()
		).toEqual([
			{ series_id: 1, filled_rating: 10 },
			{ series_id: 2, filled_rating: null }
		]);
	});

	it('refuses a rating past 10', () => {
		const conn = old();
		climb(conn);
		expect(() => conn.prepare(`UPDATE series SET rating = 11 WHERE id = 1`).run()).toThrow(/CHECK/);
		expect(() => conn.prepare(`UPDATE entries SET rating = 11`).run()).toThrow(/CHECK/);
	});
});

describe('rung 34: arrivals', () => {
	it('dates a series an import made by that import, and leaves chapters unknown', () => {
		const conn = new Database(':memory:');
		climb(conn, 33);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Mihon', '/nowhere');
			INSERT INTO scan_jobs (id, started_at, finished_at) VALUES (7, 5000, 6000);
			INSERT INTO series (id, root_id, title, kind, added_at, scan_job_id) VALUES
				(1, 1, 'Imported', 'manga', 1, 7), (2, 1, 'Seeded', 'manga', 1, NULL);
			INSERT INTO entries (series_id, position, label, added_at) VALUES (1, 1, 'Ch. 1', 1);
		`);
		climb(conn, 34);
		expect(conn.prepare(`SELECT id, arrived_at FROM series ORDER BY id`).all()).toEqual([
			{ id: 1, arrived_at: 5000 },
			{ id: 2, arrived_at: null }
		]);
		expect(conn.prepare(`SELECT arrived_at FROM entries`).get()).toEqual({ arrived_at: null });

		// Rung 35 takes that guess back: it put the first import's whole library on NEW.
		climb(conn);
		expect(
			conn.prepare(`SELECT COUNT(*) AS n FROM series WHERE arrived_at IS NOT NULL`).get()
		).toEqual({ n: 0 });
	});
});

describe('rung 36: an arrival already read is not new', () => {
	it('dates a series by its newest unread arrival, or not at all', () => {
		const conn = new Database(':memory:');
		climb(conn, 35);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Mihon', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at, arrived_at) VALUES
				(1, 1, 'Mixed', 'manga', 1, 900), (2, 1, 'All read', 'manga', 1, 900);
			INSERT INTO entries (series_id, position, label, added_at, arrived_at, read_at) VALUES
				(1, 1, 'Ch. 1', 1, 500, NULL), (1, 2, 'Ch. 2', 1, 900, 950),
				(2, 1, 'Ch. 1', 1, 900, 950);
		`);
		climb(conn);
		expect(conn.prepare(`SELECT id, arrived_at FROM series ORDER BY id`).all()).toEqual([
			{ id: 1, arrived_at: 500 },
			{ id: 2, arrived_at: null }
		]);
	});
});

describe('rung 60: an episode’s marks (c239)', () => {
	it('keeps the source endings rung 47 already stored', () => {
		const conn = new Database(':memory:');
		climb(conn, 59);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Anime', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES (1, 1, 'Show', 'anime', 1);
			INSERT INTO entries (series_id, position, label, added_at, ending_at) VALUES
				(1, 1, 'Ep. 1', 1, 1290), (1, 2, 'Ep. 2', 1, NULL);
		`);
		climb(conn);
		expect(
			conn
				.prepare(
					`SELECT entry_id, method, intro_start, ending_start, ending_end, tried_at
					FROM episode_marks ORDER BY entry_id`
				)
				.all()
		).toEqual([
			{
				entry_id: 1,
				method: 'source',
				intro_start: null,
				ending_start: 1290,
				ending_end: 1380,
				tried_at: 0
			}
		]);
	});
});

describe('rung 55: a season the series named, not its episodes (c219)', () => {
	it('stamps the episodes of an anime kept as its own season, and leaves the rest alone', () => {
		const conn = new Database(':memory:');
		climb(conn, 54);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Anime', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at, origin_key) VALUES
				(1, 1, 'Honzuki no Gekokujou 3rd Season', 'anime', 1,
					'aniyomi:7:/ascendance-of-a-bookworm-season-3-d2a9'),
				(2, 1, 'Kaminaki Sekai no Kamisama Katsudou', 'anime', 1, 'aniyomi:7:/kamikatsu-f8e7'),
				(3, 1, 'Named per episode', 'anime', 1, 'aniyomi:7:/a-show-season-2');
			INSERT INTO entries (series_id, position, label, added_at, season) VALUES
				(1, 1, 'Ep. 1', 1, NULL), (1, 2, 'Ep. 2', 1, NULL),
				(2, 1, 'Ep. 1', 1, NULL),
				(3, 1, 'Ep. 1', 1, 1);
		`);
		climb(conn, 55);
		expect(
			conn
				.prepare(
					`SELECT series_id, COUNT(*) AS n, MAX(season) AS season FROM entries
					GROUP BY series_id ORDER BY series_id`
				)
				.all()
		).toEqual([
			{ series_id: 1, n: 2, season: 3 },
			{ series_id: 2, n: 1, season: null },
			{ series_id: 3, n: 1, season: 1 }
		]);
	});
});

describe('rung 61: Works (c275)', () => {
	it('adds the three tables and moves no row of the library', () => {
		const conn = new Database(':memory:');
		climb(conn, 60);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Library', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, rating, favourite, added_at) VALUES
				(1, 1, 'The Breaker', 'manhwa', 9, 1, 100),
				(2, 1, 'The Breaker: New Waves', 'manhwa', 0, 0, 200);
			INSERT INTO entries (series_id, position, label, added_at, read_at) VALUES
				(1, 1, 'Ch. 1', 100, 150), (2, 1, 'Ch. 1', 200, NULL);
			INSERT INTO series_links (series_id, anilist_id, via, linked_at, filled_rating)
				VALUES (1, 900001, 'mihon', 100, 9);
			INSERT INTO reading_events (at, series_id, entry_id, kind) VALUES (150, 1, 1, 'finish');
		`);
		const snapshot = () => ({
			series: conn.prepare(`SELECT * FROM series ORDER BY id`).all(),
			entries: conn.prepare(`SELECT * FROM entries ORDER BY id`).all(),
			links: conn.prepare(`SELECT * FROM series_links ORDER BY series_id`).all(),
			events: conn.prepare(`SELECT * FROM reading_events ORDER BY id`).all()
		});
		const before = snapshot();

		climb(conn, 61);
		expect(conn.pragma('user_version', { simple: true })).toBe(61);

		const sqlOf = (name: string) =>
			(
				conn
					.prepare(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?`)
					.get(name) as { sql: string } | undefined
			)?.sql;
		const columns = (name: string) =>
			(conn.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);

		expect(columns('works')).toEqual(['id', 'name', 'created_at', 'order_mode']);
		expect(columns('work_series')).toEqual(['work_id', 'series_id', 'position']);
		expect(columns('work_dismissals')).toEqual(['series_ids', 'dismissed_at']);
		expect(sqlOf('works')).toContain("order_mode IN ('hand', 'added', 'title')");
		// `series_id UNIQUE` is what makes a series belong to at most one Work,
		// and the cascade from series is the card's rule.
		expect(sqlOf('work_series')).toContain('series_id INTEGER NOT NULL UNIQUE');
		expect(sqlOf('work_series')).toContain('REFERENCES series(id) ON DELETE CASCADE');
		expect(
			conn
				.prepare(`SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = 'work_series_work'`)
				.get()
		).toBeTruthy();

		// Nothing the rung did not name moved.
		expect(snapshot()).toEqual(before);
	});

	it('makes a series belong to one Work, refuses an order it doesn’t know, and cascades', () => {
		const conn = new Database(':memory:');
		climb(conn);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Library', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES
				(1, 1, 'The Breaker', 'manhwa', 100), (2, 1, 'New Waves', 'manhwa', 200),
				(3, 1, 'Other One', 'manhwa', 300), (4, 1, 'Other Two', 'manhwa', 400);
			INSERT INTO works (id, name, created_at, order_mode) VALUES
				(1, 'The Breaker', 100, 'hand'), (2, 'Other', 100, 'title');
			INSERT INTO work_series (work_id, series_id, position) VALUES (1, 1, 1);
			INSERT INTO work_series (work_id, series_id, position) VALUES (1, 2, 2);
			INSERT INTO work_series (work_id, series_id, position) VALUES (2, 3, 1);
			INSERT INTO work_series (work_id, series_id, position) VALUES (2, 4, 2);
		`);
		// A second Work cannot hold a series the first already has.
		expect(() =>
			conn.prepare(`INSERT INTO work_series (work_id, series_id, position) VALUES (2, 1, 1)`).run()
		).toThrow(/UNIQUE/);
		expect(() =>
			conn.prepare(`INSERT INTO works (name, created_at, order_mode) VALUES ('X', 1, 'date')`).run()
		).toThrow(/CHECK/);
		// A dismissed offer is its own table, so the books' reader never sees one.
		conn
			.prepare(`INSERT INTO work_dismissals (series_ids, dismissed_at) VALUES ('work:1:2', 100)`)
			.run();
		// Deleting a series takes its membership with it, and the rung's trigger
		// ends the Work the delete leaves with one series: the cascade then takes
		// that last membership too. The row is gone because of the trigger, not
		// the FK, and `work_series` holding only the other Work is what proves both ran.
		conn.prepare(`DELETE FROM series WHERE id = 1`).run();
		expect(conn.prepare(`SELECT series_id FROM work_series ORDER BY series_id`).all()).toEqual([
			{ series_id: 3 },
			{ series_id: 4 }
		]);
		expect(conn.prepare(`SELECT id FROM works ORDER BY id`).all()).toEqual([{ id: 2 }]);
	});
});

describe('rung 66: IMPORT A BACKUP and its log (c438)', () => {
	it('adds the two tables to a v65 library and moves no row of it', () => {
		const conn = new Database(':memory:');
		climb(conn, 65);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Mihon', '/lib/Mihon');
			INSERT INTO scan_jobs (id, started_at, finished_at, source_label, series_found)
				VALUES (1, 100, 200, 'MIHON', 1);
			INSERT INTO series (id, root_id, title, kind, added_at, scan_job_id, origin_key)
				VALUES (1, 1, 'Drawing', 'manga', 100, 1, 'mihon:1:/a');
		`);
		const before = {
			series: conn.prepare(`SELECT * FROM series`).all(),
			jobs: conn.prepare(`SELECT * FROM scan_jobs`).all()
		};
		climb(conn, 66);
		expect(conn.pragma('user_version', { simple: true })).toBe(66);
		expect({
			series: conn.prepare(`SELECT * FROM series`).all(),
			jobs: conn.prepare(`SELECT * FROM scan_jobs`).all()
		}).toEqual(before);
		conn
			.prepare(
				`INSERT INTO imports (id, created_at, app, file_name, state, job_id) VALUES (1, 300, 'mihon', 'a.tachibk', 'done', 1)`
			)
			.run();
		conn
			.prepare(`INSERT INTO import_series (import_id, series_id, created) VALUES (1, 1, 1)`)
			.run();
		// A state the log does not know is refused.
		expect(() =>
			conn
				.prepare(`INSERT INTO imports (created_at, file_name, state) VALUES (1, 'x', 'gone')`)
				.run()
		).toThrow(/CHECK/);
		// A series deleted takes its import row with it; the import stays.
		conn.prepare(`DELETE FROM series WHERE id = 1`).run();
		expect(conn.prepare(`SELECT COUNT(*) n FROM import_series`).get()).toEqual({ n: 0 });
		expect(conn.prepare(`SELECT COUNT(*) n FROM imports`).get()).toEqual({ n: 1 });
		// A job forgotten leaves the import, unlinked.
		conn.prepare(`DELETE FROM scan_jobs WHERE id = 1`).run();
		expect(conn.prepare(`SELECT job_id FROM imports`).get()).toEqual({ job_id: null });
	});
});
