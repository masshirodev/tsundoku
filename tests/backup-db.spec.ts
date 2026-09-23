import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const work = mkdtempSync(join(tmpdir(), 'tsundoku-backup-'));
const dbPath = join(work, 'library.sqlite');
const dir = join(work, 'backups');
// Before anything imports db.ts: getDb() reads these once.
process.env.DATABASE_PATH = dbPath;
process.env.BACKUP_DIR = dir;

const { getDb } = await import('$lib/server/db');
const { snapshotBeforeMigration, takeSnapshot, verify } = await import('$lib/server/backup');
const { snapshotName } = await import('$lib/backup/retention');

beforeAll(() => {
	getDb().exec(`
		INSERT INTO roots (id, name, path) VALUES (1, 'Mihon', '/nowhere');
		INSERT INTO series (root_id, title, kind, added_at) VALUES (1, 'Frieren', 'manga', 1790000000000);
	`);
});

describe('takeSnapshot', () => {
	it('copies the open database, with its latest write, and checks it', () => {
		const s = takeSnapshot(dbPath, { dir, now: new Date(2026, 8, 23, 4) });
		expect(s.path).toBe(join(dir, 'library-20260923-040000.sqlite'));
		expect(s.series).toBe(1);
		expect(s.userVersion).toBeGreaterThan(0);
		const copy = new Database(s.path, { readonly: true });
		expect(copy.prepare(`SELECT title FROM series`).get()).toEqual({ title: 'Frieren' });
		copy.close();
		expect(readdirSync(dir).some((n) => n.endsWith('.partial'))).toBe(false);
	});

	it('prunes what the tiers drop, after the new one is safely in place', () => {
		const tiers = { daily: 2, weekly: 0, monthly: 0 };
		takeSnapshot(dbPath, { dir, now: new Date(2026, 8, 24, 4), tiers });
		const s = takeSnapshot(dbPath, { dir, now: new Date(2026, 8, 25, 4), tiers });
		expect(s.pruned).toEqual([snapshotName('library', new Date(2026, 8, 23, 4))]);
		expect(readdirSync(dir).sort()).toEqual([
			'library-20260924-040000.sqlite',
			'library-20260925-040000.sqlite'
		]);
	});

	it('refuses a file that is not a whole database', () => {
		const junk = join(work, 'junk.sqlite');
		writeFileSync(junk, 'not a database');
		expect(() => verify(junk)).toThrow();
	});
});

describe('snapshotBeforeMigration', () => {
	it('names the copy for the rung about to be climbed, where retention never prunes it', () => {
		const kept = snapshotBeforeMigration(getDb(), dbPath, 9, new Date(2026, 8, 23, 12));
		expect(kept).toBe(join(dir, 'library-pre-v10-20260923-120000.sqlite'));
		expect(existsSync(kept)).toBe(true);
		takeSnapshot(dbPath, {
			dir,
			now: new Date(2026, 8, 26, 4),
			tiers: { daily: 1, weekly: 0, monthly: 0 }
		});
		expect(existsSync(kept)).toBe(true);
	});
});
