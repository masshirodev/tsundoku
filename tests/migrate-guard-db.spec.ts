import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const work = mkdtempSync(join(tmpdir(), 'tsundoku-guard-'));
const dbPath = join(work, 'library.sqlite');
// Before anything imports db.ts: getDb() reads these once.
process.env.DATABASE_PATH = dbPath;
process.env.BACKUP_DIR = join(work, 'backups');

const { climb, closeDb, getDb } = await import('$lib/server/db');

const version = () => {
	const conn = new Database(dbPath, { readonly: true });
	const v = conn.pragma('user_version', { simple: true });
	conn.close();
	return v as number;
};

describe('TSUNDOKU_MIGRATE=off: what the timers run with', () => {
	it('refuses a database behind the code, and leaves it where it was', () => {
		const old = new Database(dbPath);
		climb(old, 28);
		old.close();
		process.env.TSUNDOKU_MIGRATE = 'off';
		expect(() => getDb()).toThrow(/at v28 .*Deploy first/);
		expect(version()).toBe(28);
		// Refusing leaves nothing open behind it: the next call tries afresh.
		expect(() => getDb()).toThrow(/at v28/);
	});

	it('the served app, without it, migrates as always', () => {
		delete process.env.TSUNDOKU_MIGRATE;
		getDb();
		expect(version()).toBeGreaterThan(28);
		closeDb();
		process.env.TSUNDOKU_MIGRATE = 'off';
		expect(() => getDb()).not.toThrow();
	});
});
