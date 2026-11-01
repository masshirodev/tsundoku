import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Rung 57 (doc/MOVE.md; card c139): the old origin key and when it was left,
// each entry's own source, and the NO SERVER failures a move's band reads. On
// a file, as the live database is, and never editing a rung below it.
const work = mkdtempSync(join(tmpdir(), 'tsundoku-rung57-'));
process.env.DATABASE_PATH = ':memory:';
afterAll(() => rmSync(work, { recursive: true, force: true }));

const { climb } = await import('$lib/server/db');

function at56() {
	const path = join(work, `lib-${Math.random().toString(36).slice(2)}.sqlite`);
	const conn = new Database(path);
	conn.pragma('foreign_keys = ON');
	climb(conn, 56);
	const root = Number(
		conn.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Library', '/l', 0)`).run()
			.lastInsertRowid
	);
	const series = Number(
		conn
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key) VALUES (?, 'Movenberg', 'manga', 1, 'mihon:1:/a')`
			)
			.run(root).lastInsertRowid
	);
	const entry = Number(
		conn
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, source_url) VALUES (?, 1, 'Ch. 1', 1, '/a/c1')`
			)
			.run(series).lastInsertRowid
	);
	return { conn, path, series, entry };
}

describe('rung 57', () => {
	it('adds the columns with defaults and keeps every row', () => {
		const { conn, series, entry } = at56();
		climb(conn, 57);
		expect(conn.pragma('user_version', { simple: true })).toBe(57);
		expect(
			conn
				.prepare(
					`SELECT former_key, former_at, former_source, move_dismissed_at, origin_key FROM series WHERE id = ?`
				)
				.get(series)
		).toEqual({
			former_key: null,
			former_at: null,
			former_source: '',
			move_dismissed_at: null,
			origin_key: 'mihon:1:/a'
		});
		expect(
			conn
				.prepare(`SELECT origin_source, former_url, source_url FROM entries WHERE id = ?`)
				.get(entry)
		).toEqual({ origin_source: '', former_url: '', source_url: '/a/c1' });
		expect(conn.pragma('integrity_check', { simple: true })).toBe('ok');
		expect(conn.pragma('foreign_key_check')).toEqual([]);
		conn.close();
	});

	it('keeps the former key resolvable and a failure per episode', () => {
		const { conn, series, entry } = at56();
		climb(conn, 57);
		conn
			.prepare(`UPDATE series SET former_key = 'mihon:2:/b', former_at = 5 WHERE id = ?`)
			.run(series);
		expect(
			(
				conn.prepare(`SELECT id FROM series WHERE former_key = 'mihon:2:/b'`).get() as {
					id: number;
				}
			).id
		).toBe(series);
		conn
			.prepare(
				`INSERT INTO episode_failures (entry_id, series_id, first_at, last_at, tries)
				VALUES (?, ?, 10, 20, 1)`
			)
			.run(entry, series);
		expect(() =>
			conn
				.prepare(
					`INSERT INTO episode_failures (entry_id, series_id, first_at, last_at, tries)
					VALUES (?, ?, 10, 20, 1)`
				)
				.run(entry, series)
		).toThrow(/UNIQUE/);
		conn.close();
	});

	it('takes a failure with its episode when the entry goes', () => {
		const { conn, series, entry } = at56();
		climb(conn, 57);
		conn
			.prepare(
				`INSERT INTO episode_failures (entry_id, series_id, first_at, last_at, tries) VALUES (?, ?, 1, 2, 1)`
			)
			.run(entry, series);
		conn.pragma('foreign_keys = ON');
		conn.prepare(`DELETE FROM entries WHERE id = ?`).run(entry);
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM episode_failures`).get()).toEqual({ n: 0 });
		conn.close();
	});
});
