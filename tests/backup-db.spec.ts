import Database from 'better-sqlite3';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const work = mkdtempSync(join(tmpdir(), 'tsundoku-backup-'));
const dbPath = join(work, 'library.sqlite');
const dir = join(work, 'backups');
// Before anything imports db.ts: getDb() reads these once.
process.env.DATABASE_PATH = dbPath;
process.env.BACKUP_DIR = dir;
// The data folder's highlights, empty here: the snapshots above mirror nothing.
process.env.HIGHLIGHTS_DIR = join(work, 'no-highlights');

const { getDb } = await import('$lib/server/db');
const { GONE_DAYS, mirrorHighlights, snapshotBeforeMigration, takeSnapshot, verify } =
	await import('$lib/server/backup');
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

describe('the highlights’ copies (c701)', () => {
	const source = join(work, 'highlights');
	const put = (rel: string, body: string) => {
		mkdirSync(join(source, rel, '..'), { recursive: true });
		writeFileSync(join(source, rel), body);
	};

	it('mirrors every copy beside the snapshot, and only what is new the next night', () => {
		put('pages/1.webp', 'page one');
		put('clips/2.mkv', 'clip two');
		put('stills/2.webp', 'still');
		const s = takeSnapshot(dbPath, {
			dir: join(work, 'mirrored'),
			now: new Date(2026, 10, 7, 4),
			highlights: source
		});
		expect(s.copies).toEqual({ copied: 3, kept: 0, setAside: 0, pruned: 0 });
		const mirror = join(work, 'mirrored', 'highlights');
		expect(readFileSync(join(mirror, 'clips', '2.mkv'), 'utf8')).toBe('clip two');
		put('pages/3.webp', 'page three');
		const next = takeSnapshot(dbPath, {
			dir: join(work, 'mirrored'),
			now: new Date(2026, 10, 8, 4),
			highlights: source
		});
		expect(next.copies).toEqual({ copied: 1, kept: 3, setAside: 0, pruned: 0 });
		// Retention reads only snapshot names: the mirror's folder is never pruned as one.
		expect(next.pruned).toEqual([]);
		expect(existsSync(mirror)).toBe(true);
	});

	it('sets a deleted highlight’s copy aside for GONE_DAYS, then lets it go', () => {
		const mirror = join(work, 'aside', 'highlights');
		mkdirSync(join(work, 'aside'), { recursive: true });
		put('pages/9.webp', 'nine');
		mirrorHighlights(source, mirror, new Date(2026, 10, 1, 4));
		rmSync(join(source, 'pages', '9.webp'));
		const r = mirrorHighlights(source, mirror, new Date(2026, 10, 2, 4));
		expect(r.setAside).toBe(1);
		expect(existsSync(join(mirror, 'pages', '9.webp'))).toBe(false);
		expect(readFileSync(join(mirror, '.gone', '20261102-040000', 'pages', '9.webp'), 'utf8')).toBe(
			'nine'
		);
		expect(mirrorHighlights(source, mirror, new Date(2026, 10, 2 + GONE_DAYS, 4)).pruned).toBe(0);
		expect(mirrorHighlights(source, mirror, new Date(2026, 10, 3 + GONE_DAYS, 4)).pruned).toBe(1);
		expect(existsSync(join(mirror, '.gone', '20261102-040000'))).toBe(false);
	});

	it('copies a copy whose size changed (a half-written one from a night that failed)', () => {
		const mirror = join(work, 'resized', 'highlights');
		put('pages/5.webp', 'five');
		mirrorHighlights(source, mirror, new Date(2026, 10, 1, 4));
		writeFileSync(join(mirror, 'pages', '5.webp'), 'fi');
		expect(mirrorHighlights(source, mirror, new Date(2026, 10, 2, 4)).copied).toBe(1);
		expect(readFileSync(join(mirror, 'pages', '5.webp'), 'utf8')).toBe('five');
	});

	it('mirrors nothing when told not to', () => {
		const s = takeSnapshot(dbPath, {
			dir: join(work, 'none'),
			now: new Date(2026, 10, 7, 4),
			highlights: null
		});
		expect(s.copies).toBeNull();
		expect(existsSync(join(work, 'none', 'highlights'))).toBe(false);
	});
});
