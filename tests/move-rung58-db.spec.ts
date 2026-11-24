import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Migration 58 (doc/MOVE.md): every key a series has left, not only the
// one migration 57 kept, and every address an entry has left. On a file, as the
// live database is, and never editing a migration below it.
const work = mkdtempSync(join(tmpdir(), 'tsundoku-migration58-'));
process.env.DATABASE_PATH = ':memory:';
afterAll(() => rmSync(work, { recursive: true, force: true }));

const { climb } = await import('$lib/server/db');

function at57() {
	const path = join(work, `lib-${Math.random().toString(36).slice(2)}.sqlite`);
	const conn = new Database(path);
	// No fsync: the climb commits every rung, about 250 syncs a case, and on a
	// disk TMPDIR (a wave gate's) under a busy suite those took a case past
	// vitest's 5 s. What is tested is the rung, not durability (c951).
	conn.pragma('synchronous = OFF');
	conn.pragma('foreign_keys = ON');
	climb(conn, 57);
	const root = Number(
		conn.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Library', '/l', 0)`).run()
			.lastInsertRowid
	);
	const series = Number(
		conn
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, former_key, former_at, former_source)
				VALUES (?, 'Movenberg', 'manga', 1, 'mihon:1:/a', 'mihon:1:/old', 5, 'Asura Scans')`
			)
			.run(root).lastInsertRowid
	);
	const entry = Number(
		conn
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, source_url, former_url)
				VALUES (?, 1, 'Ch. 1', 1, '/a/c1', '/old/c1')`
			)
			.run(series).lastInsertRowid
	);
	return { conn, path, root, series, entry };
}

describe('migration 58', () => {
	it('copies the former key and the former URL migration 57 kept', () => {
		const { conn, series, entry } = at57();
		climb(conn, 58);
		expect(conn.pragma('user_version', { simple: true })).toBe(58);
		expect(
			conn
				.prepare(`SELECT origin_key, source, left_at FROM series_former_keys WHERE series_id = ?`)
				.get(series)
		).toEqual({ origin_key: 'mihon:1:/old', source: 'Asura Scans', left_at: 5 });
		expect(
			conn
				.prepare(`SELECT former_url, left_at FROM entry_former_urls WHERE entry_id = ?`)
				.get(entry)
		).toEqual({ former_url: '/old/c1', left_at: 0 });
		expect(conn.pragma('integrity_check', { simple: true })).toBe('ok');
		expect(conn.pragma('foreign_key_check')).toEqual([]);
		conn.close();
	});

	it('leaves a key or URL that is also the current one out of the table', () => {
		const { conn, series, entry } = at57();
		// Migration 57 could hold this; the table says a current key is not a former one.
		conn.prepare(`UPDATE series SET former_key = origin_key WHERE id = ?`).run(series);
		conn.prepare(`UPDATE entries SET former_url = source_url WHERE id = ?`).run(entry);
		climb(conn, 58);
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM series_former_keys`).get()).toEqual({ n: 0 });
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM entry_former_urls`).get()).toEqual({ n: 0 });
		conn.close();
	});

	it('takes both records with the series when it goes', () => {
		const { conn, series } = at57();
		climb(conn, 58);
		conn.prepare(`DELETE FROM series WHERE id = ?`).run(series);
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM series_former_keys`).get()).toEqual({ n: 0 });
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM entry_former_urls`).get()).toEqual({ n: 0 });
		conn.close();
	});
});
