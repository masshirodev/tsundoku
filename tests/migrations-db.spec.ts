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

// Rung 67 (c463) has its own file, tests/aniskip-rung67-db.spec.ts, and rung
// 68 (c383) its own through the app's doors, tests/legacy-anime-rung68-db.spec.ts.
describe('rung 68: a link from before rung 62 becomes its season’s row (c383)', () => {
	it('moves an anime’s one link onto its first season and leaves a manga’s alone', () => {
		const conn = new Database(':memory:');
		climb(conn, 67);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Anime', '/a');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES
				(1, 1, 'Show', 'anime', 1), (2, 1, 'Book', 'manga', 1);
			INSERT INTO entries (id, series_id, position, label, added_at, season, episode_number) VALUES
				(1, 1, 1, 'S1E1', 1, 1, 1), (2, 1, 2, 'S2E1', 1, 2, 1);
			INSERT INTO series_links (series_id, anilist_id, mal_id, via, linked_at, filled_rating, score) VALUES
				(1, 10, 20, 'review', 5, 7, 70), (2, 11, 21, 'mihon', 5, NULL, NULL);
		`);
		const mirror = conn.prepare(`SELECT * FROM series_links ORDER BY series_id`).all();
		climb(conn, 68);
		expect(conn.pragma('user_version', { simple: true })).toBe(68);
		expect(
			conn
				.prepare(
					`SELECT series_id, season, part, anilist_id, mal_id, via, filled_rating, score FROM series_season_links`
				)
				.all()
		).toEqual([
			{
				series_id: 1,
				season: 1,
				part: 1,
				anilist_id: 10,
				mal_id: 20,
				via: 'review',
				filled_rating: 7,
				score: 70
			}
		]);
		expect(conn.prepare(`SELECT * FROM series_links ORDER BY series_id`).all()).toEqual(mirror);
	});
});

describe('rung 69: a novel’s reading direction, its own column (c440)', () => {
	it('adds text_direction as NULL for every series and keeps every direction stored', () => {
		const conn = new Database(':memory:');
		climb(conn, 68);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Books', '/b');
			INSERT INTO series (id, root_id, title, kind, added_at, direction) VALUES
				(1, 1, 'Paged novel', 'novel', 1, 'paged'), (2, 1, 'Scrolled novel', 'novel', 1, 'scroll'),
				(3, 1, 'Unset novel', 'novel', 1, NULL), (4, 1, 'Manga', 'manga', 1, 'rtl'),
				(5, 1, 'Comic', 'manga', 1, 'ltr'), (6, 1, 'Manhwa', 'manhwa', 1, 'vertical');
		`);
		const before = conn.prepare(`SELECT id, direction FROM series ORDER BY id`).all();
		climb(conn, 69);
		expect(conn.pragma('user_version', { simple: true })).toBe(69);
		expect(conn.prepare(`SELECT id, direction FROM series ORDER BY id`).all()).toEqual(before);
		expect(
			conn.prepare(`SELECT COUNT(*) AS n FROM series WHERE text_direction IS NOT NULL`).get()
		).toEqual({ n: 0 });
	});

	it('takes L→R, R→L and NULL, and nothing else', () => {
		const conn = new Database(':memory:');
		climb(conn, 69);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Books', '/b');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES (1, 1, 'Novel', 'novel', 1);
		`);
		const set = conn.prepare(`UPDATE series SET text_direction = ? WHERE id = 1`);
		for (const v of ['ltr', 'rtl', null]) expect(() => set.run(v)).not.toThrow();
		for (const v of ['vertical', 'paged', 'scroll', 'RTL', ''])
			expect(() => set.run(v)).toThrow(/CHECK constraint failed/);
	});
});

describe('rung 70: a comic’s link keeps its country and start year (c520)', () => {
	it('adds both as NULL to every link and moves nothing stored', () => {
		const conn = new Database(':memory:');
		climb(conn, 69);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Lib', '/l');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES
				(1, 1, 'Manhwa', 'manhwa', 1), (2, 1, 'Manga', 'manga', 1), (3, 1, 'Mihon only', 'manga', 1);
			INSERT INTO series_links (series_id, anilist_id, mal_id, via, title, cover_url, linked_at, resolved_at, filled_rating, score, format) VALUES
				(1, 85143, 122663, 'review', 'Tower of God', 'https://x/1.jpg', 10, 11, 8, 8.5, 'MANGA'),
				(2, 30013, NULL, 'pasted', 'One Piece', '', 20, 21, NULL, NULL, 'MANGA'),
				(3, NULL, 2, 'mihon', '', '', 30, NULL, NULL, NULL, NULL);
		`);
		const before = conn.prepare(`SELECT * FROM series_links ORDER BY series_id`).all();
		climb(conn, 70);
		expect(conn.pragma('user_version', { simple: true })).toBe(70);
		const after = conn.prepare(`SELECT * FROM series_links ORDER BY series_id`).all() as Record<
			string,
			unknown
		>[];
		// Every row as it was, with the two new columns NULL.
		expect(after).toEqual(
			(before as Record<string, unknown>[]).map((r) => ({ ...r, country: null, year: null }))
		);
	});
});

describe('rung 71: a job keeps the Works its folds dropped (c570)', () => {
	it('gives every job already stored an empty list, and moves nothing else', () => {
		const conn = new Database(':memory:');
		climb(conn, 70);
		conn.exec(`
			INSERT INTO scan_jobs (id, started_at, finished_at, bytes_done, bytes_total, series_found, source_label, step, steps, failed_files, dismissed_at) VALUES
				(1, 10, 20, 5, 5, 2, 'MIHON', 1, 1, 0, NULL),
				(2, 30, NULL, 0, 9, 0, 'MIHON BACKUP', 1, 1, 1, NULL),
				(3, 40, 50, 1, 1, 0, '', 1, 1, 0, 50);
		`);
		const before = conn.prepare(`SELECT * FROM scan_jobs ORDER BY id`).all();
		climb(conn, 71);
		expect(conn.pragma('user_version', { simple: true })).toBe(71);
		const after = conn.prepare(`SELECT * FROM scan_jobs ORDER BY id`).all();
		// Nothing recorded what an old job's folds dropped, so it lists none.
		expect(after).toEqual(
			(before as Record<string, unknown>[]).map((r) => ({ ...r, dropped: '[]' }))
		);
		// A job opened after the rung, which names no list, starts with none too.
		conn.exec(`INSERT INTO scan_jobs (started_at) VALUES (60)`);
		expect(conn.prepare(`SELECT dropped FROM scan_jobs WHERE started_at = 60`).get()).toEqual({
			dropped: '[]'
		});
		expect(() => conn.exec(`UPDATE scan_jobs SET dropped = NULL WHERE id = 1`)).toThrow(
			/NOT NULL constraint failed/
		);
	});
});

describe('rung 72: highlights, a copy and a pointer (c701)', () => {
	it('adds the table to a v71 library, moves no row of it, and nothing cascades into it', () => {
		const conn = new Database(':memory:');
		climb(conn, 71);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Mihon', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at, origin_key) VALUES
				(1, 1, 'Hoshizora', 'novel', 1, 'lnreader:ranobe:/h');
			INSERT INTO entries (id, series_id, position, label, added_at) VALUES (1, 1, 3, 'Ch. 3', 1);
		`);
		const before = [
			conn.prepare(`SELECT * FROM series`).all(),
			conn.prepare(`SELECT * FROM entries`).all()
		];
		climb(conn, 72);
		expect(conn.pragma('user_version', { simple: true })).toBe(72);
		expect([
			conn.prepare(`SELECT * FROM series`).all(),
			conn.prepare(`SELECT * FROM entries`).all()
		]).toEqual(before);
		const columns = (conn.prepare(`PRAGMA table_info(highlights)`).all() as { name: string }[]).map(
			(c) => c.name
		);
		// Main 05's record: kind, the pointer, the place, the snapshot, colour,
		// note, made_at, hidden, the copy's path and the pointer's state.
		for (const name of [
			'kind',
			'series_id',
			'entry_id',
			'origin_key',
			'number',
			'season',
			'block',
			'block_offset',
			'end_block',
			'end_offset',
			'page',
			'clip_in',
			'clip_out',
			'series_title',
			'series_kind',
			'cover',
			'entry_label',
			'colour',
			'note',
			'made_at',
			'hidden',
			'copy_path',
			'state'
		])
			expect(columns).toContain(name);
		// No foreign key at all: a delete can never take a highlight with it.
		expect(conn.prepare(`PRAGMA foreign_key_list(highlights)`).all()).toEqual([]);
		expect(
			(
				conn
					.prepare(
						`SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'highlights'`
					)
					.all() as { name: string }[]
			)
				.map((r) => r.name)
				.sort()
		).toEqual(['highlights_entry', 'highlights_lost', 'highlights_made', 'highlights_series']);
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM highlights`).get()).toEqual({ n: 0 });
	});

	it('takes its three kinds and colours for quotes only, and refuses a series kind', () => {
		const conn = new Database(':memory:');
		climb(conn);
		const put = (kind: string, colour: string | null) =>
			conn
				.prepare(
					`INSERT INTO highlights (kind, series_title, series_kind, colour, made_at) VALUES (?, 'T', 'novel', ?, 1)`
				)
				.run(kind, colour);
		expect(() => put('quote', 'yellow')).not.toThrow();
		expect(() => put('page', null)).not.toThrow();
		expect(() => put('clip', null)).not.toThrow();
		expect(() => put('novel', null)).toThrow(/CHECK constraint failed/);
		expect(() => put('page', 'blue')).toThrow(/CHECK constraint failed/);
		expect(() => put('quote', 'green')).toThrow(/CHECK constraint failed/);
		expect(() => conn.exec(`UPDATE highlights SET state = 'gone' WHERE kind = 'quote'`)).toThrow(
			/CHECK constraint failed/
		);
	});
});

describe('rung 73: an anime’s relation graph, cached (c358)', () => {
	it('adds the table to a v72 library empty, moves no row of it, and goes with its series', () => {
		const conn = new Database(':memory:');
		climb(conn, 72);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Aniyomi', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES
				(1, 1, 'Bookworm 3', 'anime', 1), (2, 1, 'Bookworm 2', 'anime', 1);
			INSERT INTO series_season_links (series_id, season, anilist_id, via, linked_at) VALUES
				(1, 3, 103, 'review', 1), (2, 2, 102, 'review', 1);
		`);
		const before = [
			conn.prepare(`SELECT * FROM series`).all(),
			conn.prepare(`SELECT * FROM series_season_links`).all()
		];
		climb(conn, 73);
		expect(conn.pragma('user_version', { simple: true })).toBe(73);
		expect([
			conn.prepare(`SELECT * FROM series`).all(),
			conn.prepare(`SELECT * FROM series_season_links`).all()
		]).toEqual(before);
		// Nothing was cached before: every anime waits for the next pass.
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM series_relations`).get()).toEqual({ n: 0 });
		expect(
			(conn.prepare(`PRAGMA table_info(series_relations)`).all() as { name: string }[]).map(
				(c) => c.name
			)
		).toEqual(['series_id', 'graph', 'fetched_at', 'tried_at']);
		conn
			.prepare(
				`INSERT INTO series_relations (series_id, graph, fetched_at, tried_at) VALUES (1, '{"nodes":{}}', 5, 5)`
			)
			.run();
		// A series deleted takes its cache with it.
		conn.exec(`DELETE FROM series WHERE id = 1`);
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM series_relations`).get()).toEqual({ n: 0 });
	});

	it('refuses a graph without its moment, and a moment without a graph', () => {
		const conn = new Database(':memory:');
		climb(conn);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Aniyomi', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES (1, 1, 'B', 'anime', 1);
		`);
		const put = (graph: string | null, at: number | null) =>
			conn
				.prepare(
					`INSERT OR REPLACE INTO series_relations (series_id, graph, fetched_at, tried_at) VALUES (1, ?, ?, 1)`
				)
				.run(graph, at);
		expect(() => put(null, null)).not.toThrow();
		expect(() => put('{"nodes":{}}', 1)).not.toThrow();
		expect(() => put('{"nodes":{}}', null)).toThrow(/CHECK constraint failed/);
		expect(() => put(null, 1)).toThrow(/CHECK constraint failed/);
		expect(() =>
			conn.exec(`INSERT INTO series_relations (series_id, tried_at) VALUES (9, 1)`)
		).toThrow(/FOREIGN KEY constraint failed/);
	});
});

describe('rung 74: an anime keeps no mirror of its first season (c467)', () => {
	const link = (conn: Database.Database, id: number, anilist: number) =>
		conn
			.prepare(
				`INSERT INTO series_links (series_id, anilist_id, via, title, linked_at) VALUES (?, ?, 'review', 'T', 1)`
			)
			.run(id, anilist);
	const season = (conn: Database.Database, id: number, n: number, anilist: number) =>
		conn
			.prepare(
				`INSERT INTO series_season_links (series_id, season, part, anilist_id, via, title, linked_at)
				VALUES (?, ?, 1, ?, 'review', 'T', 1)`
			)
			.run(id, n, anilist);

	it('takes only the rows that have a season row beside them', () => {
		const conn = new Database(':memory:');
		climb(conn, 73);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Aniyomi', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES
				(1, 1, 'Mirrored', 'anime', 1),
				(2, 1, 'Later season only', 'anime', 1),
				(3, 1, 'Before the seasons', 'anime', 1),
				(4, 1, 'Decided, never linked by season', 'anime', 1),
				(5, 1, 'A comic', 'manga', 1),
				(6, 1, 'A novel', 'novel', 1);
			INSERT INTO season_link_decisions (series_id, season, part, decision, at)
				VALUES (4, 2, 1, 'none', 1);
		`);
		link(conn, 1, 101);
		season(conn, 1, 1, 101);
		season(conn, 1, 2, 102);
		// Rung 68 left this row as it was even with its one link at season 2.
		link(conn, 2, 201);
		season(conn, 2, 2, 201);
		link(conn, 3, 301);
		link(conn, 4, 401);
		link(conn, 5, 501);
		link(conn, 6, 601);

		climb(conn, 74);

		const kept = () =>
			(
				conn.prepare(`SELECT series_id FROM series_links ORDER BY series_id`).all() as {
					series_id: number;
				}[]
			).map((r) => r.series_id);
		// The seasons' own rows are untouched: they are the links.
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM series_season_links`).get()).toEqual({ n: 3 });
		expect(kept()).toEqual([3, 4, 5, 6]);
		expect(conn.prepare(`SELECT anilist_id FROM series_links WHERE series_id = 3`).get()).toEqual({
			anilist_id: 301
		});
	});

	it('leaves a comic with a season row alone, whatever a bad row says', () => {
		// No door writes a comic's season row; the rung still asks the kind, so
		// a row out of place cannot cost a comic its link.
		const conn = new Database(':memory:');
		climb(conn, 73);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Aniyomi', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES (1, 1, 'A comic', 'manhwa', 1);
		`);
		link(conn, 1, 11);
		season(conn, 1, 1, 11);
		climb(conn, 74);
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM series_links`).get()).toEqual({ n: 1 });
	});
});

describe('rung 75: a series’ sources, a season at a time (c282)', () => {
	const stopped = () => {
		const conn = new Database(':memory:');
		climb(conn, 74);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Aniyomi', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at, origin_key) VALUES
				(1, 1, 'A show', 'anime', 1, 'aniyomi:7:/show'),
				(2, 1, 'Another', 'anime', 1, 'aniyomi:7:/another');
			INSERT INTO anime_series (series_id, folder) VALUES (1, 'Anime/A show');
		`);
		return conn;
	};

	it('gives existing series no rows, and leaves what they hold as it was', () => {
		const conn = stopped();
		climb(conn, 75);
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM series_season_facts`).get()).toEqual({ n: 0 });
		expect(conn.prepare(`SELECT origin_key FROM series WHERE id = 1`).get()).toEqual({
			origin_key: 'aniyomi:7:/show'
		});
		expect(conn.prepare(`SELECT folder FROM anime_series WHERE series_id = 1`).get()).toEqual({
			folder: 'Anime/A show'
		});
	});

	it('holds no link: a season with a source and no AniList or MAL link is a row', () => {
		const conn = stopped();
		climb(conn, 75);
		conn
			.prepare(
				`INSERT INTO series_season_facts (series_id, season, origin_key, folder, source_title)
				VALUES (1, 2, 'aniyomi:9:/s2', 'Anime/S2', 'A show II')`
			)
			.run();
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM series_season_links`).get()).toEqual({ n: 0 });
		const columns = (conn.pragma('table_info(series_season_facts)') as { name: string }[]).map(
			(c) => c.name
		);
		expect(columns).toEqual(['series_id', 'season', 'origin_key', 'folder', 'source_title']);
	});

	it('lets two seasons share a key, and no two seasons share a folder', () => {
		const conn = stopped();
		climb(conn, 75);
		const put = conn.prepare(
			`INSERT INTO series_season_facts (series_id, season, origin_key, folder) VALUES (?, ?, ?, ?)`
		);
		put.run(1, 1, 'aniyomi:9:/both', 'Anime/One');
		put.run(1, 2, 'aniyomi:9:/both', null);
		put.run(2, 1, null, null);
		put.run(2, 2, null, null);
		expect(() => put.run(2, 3, null, 'Anime/One')).toThrow(/UNIQUE/);
	});

	it('goes with its series', () => {
		const conn = stopped();
		climb(conn, 75);
		conn.pragma('foreign_keys = ON');
		conn.prepare(`INSERT INTO series_season_facts (series_id, season) VALUES (1, 1), (2, 1)`).run();
		conn.prepare(`DELETE FROM series WHERE id = 1`).run();
		expect(conn.prepare(`SELECT series_id FROM series_season_facts`).all()).toEqual([
			{ series_id: 2 }
		]);
	});

	// The top rung's own block says it is the top; the next rung moves this line.
	it('is the top of a fresh database', () => {
		const conn = new Database(':memory:');
		climb(conn);
		expect(conn.pragma('user_version', { simple: true })).toBe(75);
	});
});
