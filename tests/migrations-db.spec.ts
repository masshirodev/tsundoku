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
