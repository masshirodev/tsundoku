import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Rung 47 (doc/ANIME.md; card c153): `anime` among series.kind's values,
// written into the schema's text, since rebuilding the table would cascade
// its drop through the whole library. On a file, as the live database is.
const work = mkdtempSync(join(tmpdir(), 'tsundoku-rung47-'));
process.env.DATABASE_PATH = ':memory:';
afterAll(() => rmSync(work, { recursive: true, force: true }));

const { climb } = await import('$lib/server/db');

function at46() {
	const path = join(work, `lib-${Math.random().toString(36).slice(2)}.sqlite`);
	const conn = new Database(path);
	conn.pragma('foreign_keys = ON');
	climb(conn, 46);
	const root = Number(
		conn.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Library', '/l', 0)`).run()
			.lastInsertRowid
	);
	const series = Number(
		conn
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at) VALUES (?, 'A Manga', 'manga', 1)`
			)
			.run(root).lastInsertRowid
	);
	for (let i = 1; i <= 3; i++)
		conn
			.prepare(`INSERT INTO entries (series_id, position, label, added_at) VALUES (?, ?, ?, 1)`)
			.run(series, i, `Ch. ${i}`);
	return { conn, path, root, series };
}

describe('rung 47', () => {
	it('allows anime, still refuses what isn’t a kind, and keeps every row', () => {
		const { conn, path, root } = at46();
		expect(() =>
			conn
				.prepare(`INSERT INTO series (root_id, title, kind, added_at) VALUES (?, 'x', 'anime', 1)`)
				.run(root)
		).toThrow(/CHECK constraint failed/);
		climb(conn);
		expect(conn.pragma('user_version', { simple: true })).toBe(47);
		conn
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at) VALUES (?, 'An Anime', 'anime', 1)`
			)
			.run(root);
		expect(() =>
			conn
				.prepare(`INSERT INTO series (root_id, title, kind, added_at) VALUES (?, 'x', 'bogus', 1)`)
				.run(root)
		).toThrow(/CHECK constraint failed/);
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM entries`).get()).toEqual({ n: 3 });
		expect(conn.pragma('integrity_check', { simple: true })).toBe('ok');
		expect(conn.pragma('foreign_key_check')).toEqual([]);
		conn.close();
		// It holds in the file, for the next connection, defensive again.
		const again = new Database(path);
		expect(
			(
				again.prepare(`SELECT sql FROM sqlite_schema WHERE name = 'series'`).get() as {
					sql: string;
				}
			).sql
		).toContain(`'novel', 'anime'`);
		expect(() => again.prepare(`UPDATE sqlite_schema SET sql = sql`).run()).toThrow();
		again.close();
	});

	it('leaves the cascades as they were: deleting a series still takes its entries', () => {
		const { conn, series } = at46();
		climb(conn);
		conn.pragma('foreign_keys = ON');
		conn.prepare(`DELETE FROM series WHERE id = ?`).run(series);
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM entries`).get()).toEqual({ n: 0 });
		conn.close();
	});

	it('gives an episode its fields, FILLER and RECAP only', () => {
		const { conn, series } = at46();
		climb(conn);
		const e = conn.prepare(`SELECT id FROM entries WHERE series_id = ? LIMIT 1`).get(series) as {
			id: number;
		};
		conn
			.prepare(
				`UPDATE entries SET duration_s = 1440, season = 2, episode_note = 'recap', thumb_url = 'https://x/t.jpg', ending_at = 1350 WHERE id = ?`
			)
			.run(e.id);
		expect(() =>
			conn.prepare(`UPDATE entries SET episode_note = 'special' WHERE id = ?`).run(e.id)
		).toThrow(/CHECK constraint failed/);
		conn.close();
	});

	it('refuses to run on a series table it doesn’t recognise, changing nothing', () => {
		const { conn } = at46();
		// Simulate a schema that drifted: the CHECK spelled otherwise.
		conn.unsafeMode(true);
		conn.pragma('writable_schema = ON');
		conn
			.prepare(`UPDATE sqlite_schema SET sql = replace(sql, ?, ?) WHERE name = 'series'`)
			.run(`'doujin', 'novel'`, `'doujin',  'novel'`);
		conn.pragma('writable_schema = OFF');
		conn.unsafeMode(false);
		conn.close();
		const reopened = new Database(conn.name);
		expect(() => climb(reopened)).toThrow(/rung 47/);
		expect(reopened.pragma('user_version', { simple: true })).toBe(46);
		expect(
			(reopened.pragma('table_info(entries)') as { name: string }[]).some(
				(c) => c.name === 'duration_s'
			)
		).toBe(false);
		reopened.close();
	});
});
