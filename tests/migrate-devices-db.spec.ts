import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Rung 59 (doc/SETTINGS.md, "How a device is kept"): `tv` among
// devices.kind's values, written into the schema's text for the reason rung 47
// gives. On a file, as the live database is.
process.env.DATABASE_PATH = ':memory:';
mkdirSync(join(process.cwd(), 'temp'), { recursive: true });
const work = mkdtempSync(join(process.cwd(), 'temp', 'tsundoku-rung59-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const { climb } = await import('$lib/server/db');

const DESK = 'a1b2c3d4-e5f6-7081-92a3-b4c5d6e7f809';
const TV = 'b2c3d4e5-f607-8192-a3b4-c5d6e7f80910';
const BOGUS = 'c3d4e5f6-0718-29a3-b4c5-d6e7f8091011';
const SETTINGS = JSON.stringify({ 'tsundoku.reader.fit': { v: 'width', at: 100 } });

function at58() {
	const path = join(work, `lib-${Math.random().toString(36).slice(2)}.sqlite`);
	const conn = new Database(path);
	conn.pragma('foreign_keys = ON');
	climb(conn, 58);
	conn
		.prepare(
			`INSERT INTO devices (id, kind, label, seen_at, settings) VALUES (?, 'desktop', 'Linux desktop · Firefox', 100, ?)`
		)
		.run(DESK, SETTINGS);
	return { conn, path };
}

const insert = (conn: Database.Database, id: string, kind: string) =>
	conn
		.prepare(`INSERT INTO devices (id, kind, label, seen_at, settings) VALUES (?, ?, 'x', 1, '{}')`)
		.run(id, kind);

describe('rung 59', () => {
	it('allows tv, still refuses what isn’t a kind, and keeps every row', () => {
		const { conn, path } = at58();
		expect(() => insert(conn, TV, 'tv')).toThrow(/CHECK constraint failed/);
		climb(conn, 59);
		expect(conn.pragma('user_version', { simple: true })).toBe(59);
		insert(conn, TV, 'tv');
		expect(() => insert(conn, BOGUS, 'bogus')).toThrow(/CHECK constraint failed/);
		expect(
			conn.prepare(`SELECT id, kind, label, seen_at, settings FROM devices ORDER BY id`).all()
		).toEqual([
			{
				id: DESK,
				kind: 'desktop',
				label: 'Linux desktop · Firefox',
				seen_at: 100,
				settings: SETTINGS
			},
			{ id: TV, kind: 'tv', label: 'x', seen_at: 1, settings: '{}' }
		]);
		expect(conn.pragma('integrity_check', { simple: true })).toBe('ok');
		conn.close();
		// It holds in the file, for the next connection, defensive again.
		const again = new Database(path);
		expect(
			(
				again.prepare(`SELECT sql FROM sqlite_schema WHERE name = 'devices'`).get() as {
					sql: string;
				}
			).sql
		).toContain(`'desktop', 'tv'`);
		expect(() => again.prepare(`UPDATE sqlite_schema SET sql = sql`).run()).toThrow();
		again.close();
	});

	it('refuses to run on a devices table it doesn’t recognise, changing nothing', () => {
		const { conn, path } = at58();
		// Simulate a schema that drifted: the CHECK spelled otherwise.
		conn.unsafeMode(true);
		conn.pragma('writable_schema = ON');
		conn
			.prepare(`UPDATE sqlite_schema SET sql = replace(sql, ?, ?) WHERE name = 'devices'`)
			.run(`'tablet', 'desktop'`, `'tablet',  'desktop'`);
		conn.pragma('writable_schema = OFF');
		conn.unsafeMode(false);
		conn.close();
		const reopened = new Database(path);
		expect(() => climb(reopened)).toThrow(/rung 59/);
		expect(reopened.pragma('user_version', { simple: true })).toBe(58);
		expect(() => insert(reopened, TV, 'tv')).toThrow(/CHECK constraint failed/);
		reopened.close();
	});
});
