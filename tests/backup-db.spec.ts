import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const { GONE_DAYS, mirrorHighlights, namedCopies, snapshotBeforeMigration, takeSnapshot, verify } =
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
	/** A highlight row naming its copies, as the readers will write it. */
	const row = (copy: string, still = '') =>
		Number(
			getDb()
				.prepare(
					`INSERT INTO highlights (kind, series_title, series_kind, made_at, copy_path, still_path)
					VALUES ('page', 'Frieren', 'manga', 1790000000000, ?, ?)`
				)
				.run(copy, still).lastInsertRowid
		);
	const drop = (id: number) => getDb().prepare(`DELETE FROM highlights WHERE id = ?`).run(id);
	const names = (...rel: string[]) => new Set(rel);

	it('mirrors every copy the rows name beside the snapshot, and only what is new the next night', () => {
		put('pages/1.webp', 'page one');
		put('clips/2.mkv', 'clip two');
		put('stills/2.webp', 'still');
		const one = row('pages/1.webp');
		const two = row('clips/2.mkv', 'stills/2.webp');
		const s = takeSnapshot(dbPath, {
			dir: join(work, 'mirrored'),
			now: new Date(2026, 10, 7, 4),
			highlights: source
		});
		expect(s.copies).toEqual({
			copied: 3,
			kept: 0,
			setAside: 0,
			pruned: 0,
			missing: 0,
			skipped: null
		});
		const mirror = join(work, 'mirrored', 'highlights');
		expect(readFileSync(join(mirror, 'clips', '2.mkv'), 'utf8')).toBe('clip two');
		put('pages/3.webp', 'page three');
		const three = row('pages/3.webp');
		const next = takeSnapshot(dbPath, {
			dir: join(work, 'mirrored'),
			now: new Date(2026, 10, 8, 4),
			highlights: source
		});
		expect(next.copies).toEqual({
			copied: 1,
			kept: 3,
			setAside: 0,
			pruned: 0,
			missing: 0,
			skipped: null
		});
		// Retention reads only snapshot names: the mirror's folder is never pruned as one.
		expect(next.pruned).toEqual([]);
		expect(existsSync(mirror)).toBe(true);
		for (const id of [one, two, three]) drop(id);
	});

	it('names the copies from the snapshot’s rows, the UNDO window’s deleted ones too', () => {
		const kept = row('pages/7.webp');
		getDb().prepare(`UPDATE highlights SET deleted_at = 1 WHERE id = ?`).run(kept);
		const gone = row('pages/8.webp');
		drop(gone);
		const escapes = row('../../outside.webp', '/etc/passwd');
		const s = takeSnapshot(dbPath, {
			dir: join(work, 'named'),
			now: new Date(2026, 10, 7, 4),
			highlights: null
		});
		expect([...namedCopies(s.path)]).toEqual(['pages/7.webp']);
		for (const id of [kept, escapes]) drop(id);
	});

	it('sets a copy aside once its row is gone, for GONE_DAYS, then lets it go', () => {
		const mirror = join(work, 'aside', 'highlights');
		mkdirSync(join(work, 'aside'), { recursive: true });
		put('pages/9.webp', 'nine');
		put('pages/10.webp', 'ten');
		mirrorHighlights(
			source,
			mirror,
			names('pages/9.webp', 'pages/10.webp'),
			new Date(2026, 10, 1, 4)
		);
		// The row is gone; the file is still in the folder (an unlink that failed).
		const r = mirrorHighlights(source, mirror, names('pages/10.webp'), new Date(2026, 10, 2, 4));
		expect(r.setAside).toBe(1);
		expect(existsSync(join(mirror, 'pages', '9.webp'))).toBe(false);
		expect(readFileSync(join(mirror, '.gone', '20261102-040000', 'pages', '9.webp'), 'utf8')).toBe(
			'nine'
		);
		const later = (day: number) =>
			mirrorHighlights(source, mirror, names('pages/10.webp'), new Date(2026, 10, day, 4));
		expect(later(2 + GONE_DAYS).pruned).toBe(0);
		expect(later(3 + GONE_DAYS).pruned).toBe(1);
		expect(existsSync(join(mirror, '.gone', '20261102-040000'))).toBe(false);
		expect(existsSync(join(mirror, 'pages', '10.webp'))).toBe(true);
	});

	it('sets nothing aside, and keeps every mirrored copy, when the source folder is missing', () => {
		const mirror = join(work, 'unmounted', 'highlights');
		put('pages/11.webp', 'eleven');
		put('pages/12.webp', 'twelve');
		const both = names('pages/11.webp', 'pages/12.webp');
		mirrorHighlights(source, mirror, both, new Date(2026, 10, 1, 4));
		const absent = join(work, 'not-mounted');
		const r = mirrorHighlights(absent, mirror, both, new Date(2026, 10, 2, 4));
		expect(r).toEqual({
			copied: 0,
			kept: 0,
			setAside: 0,
			pruned: 0,
			missing: 0,
			skipped: 'no source'
		});
		// And a whole month of such nights later, they are all still there.
		mirrorHighlights(absent, mirror, both, new Date(2026, 10, 3 + GONE_DAYS, 4));
		expect(readFileSync(join(mirror, 'pages', '11.webp'), 'utf8')).toBe('eleven');
		expect(readFileSync(join(mirror, 'pages', '12.webp'), 'utf8')).toBe('twelve');
		expect(existsSync(join(mirror, '.gone'))).toBe(false);
	});

	it('sets nothing aside when the source folder lists no file while rows name copies', () => {
		const mirror = join(work, 'emptied', 'highlights');
		put('pages/13.webp', 'thirteen');
		mirrorHighlights(source, mirror, names('pages/13.webp'), new Date(2026, 10, 1, 4));
		const empty = join(work, 'empty-mount');
		mkdirSync(empty, { recursive: true });
		const r = mirrorHighlights(empty, mirror, names('pages/13.webp'), new Date(2026, 10, 2, 4));
		expect(r.skipped).toBe('no source');
		expect(existsSync(join(mirror, 'pages', '13.webp'))).toBe(true);
	});

	it('keeps the mirrored copy of a row whose copy is missing from the source', () => {
		const mirror = join(work, 'lost-one', 'highlights');
		put('pages/14.webp', 'fourteen');
		put('pages/15.webp', 'fifteen');
		const both = names('pages/14.webp', 'pages/15.webp');
		mirrorHighlights(source, mirror, both, new Date(2026, 10, 1, 4));
		rmSync(join(source, 'pages', '14.webp'));
		const r = mirrorHighlights(source, mirror, both, new Date(2026, 10, 2, 4));
		expect(r).toMatchObject({ setAside: 0, missing: 1, skipped: null });
		expect(readFileSync(join(mirror, 'pages', '14.webp'), 'utf8')).toBe('fourteen');
	});

	it('copies a copy whose size changed (a half-written one from a night that failed)', () => {
		const mirror = join(work, 'resized', 'highlights');
		put('pages/5.webp', 'five');
		mirrorHighlights(source, mirror, names('pages/5.webp'), new Date(2026, 10, 1, 4));
		writeFileSync(join(mirror, 'pages', '5.webp'), 'fi');
		expect(
			mirrorHighlights(source, mirror, names('pages/5.webp'), new Date(2026, 10, 2, 4)).copied
		).toBe(1);
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

	it('a mirror that fails leaves the snapshot in place and pruned, and says why (c730)', () => {
		// A file where the mirror's folder should be: what ENOSPC or EACCES do, on demand.
		const at = join(work, 'blocked');
		mkdirSync(at, { recursive: true });
		writeFileSync(join(at, 'highlights'), 'not a folder');
		put('pages/20.webp', 'twenty');
		const id = row('pages/20.webp');
		const tiers = { daily: 1, weekly: 0, monthly: 0 };
		takeSnapshot(dbPath, { dir: at, now: new Date(2026, 10, 6, 4), tiers, highlights: null });
		const s = takeSnapshot(dbPath, {
			dir: at,
			now: new Date(2026, 10, 7, 4),
			tiers,
			highlights: source
		});
		expect(s.copiesError).toMatch(/ENOTDIR|EEXIST/);
		expect(s.copies).toBeNull();
		expect(s.path).toBe(join(at, 'library-20261107-040000.sqlite'));
		expect(s.series).toBe(1);
		expect(s.pruned).toEqual(['library-20261106-040000.sqlite']);
		expect(readdirSync(at).sort()).toEqual(['highlights', 'library-20261107-040000.sqlite']);
		drop(id);
	});

	it('a mirror that ran, or was told not to, has no error', () => {
		const s = takeSnapshot(dbPath, {
			dir: join(work, 'no-error'),
			now: new Date(2026, 10, 7, 4),
			highlights: null
		});
		expect(s.copiesError).toBeNull();
	});
});

describe('scripts/backup.ts, the nightly run (c730)', () => {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const covers = join(work, 'covers');
	const episodes = join(covers, 'episodes');
	const hl = join(work, 'script-highlights');
	/** A picture of an entry that is gone, old enough for the sweep to take. */
	const staleEpisode = () => {
		mkdirSync(episodes, { recursive: true });
		const f = join(episodes, '987654.webp');
		writeFileSync(f, 'gone');
		const old = Date.now() / 1000 - 3 * 3600;
		utimesSync(f, old, old);
		return f;
	};
	const run = (backups: string) =>
		spawnSync(
			process.execPath,
			['--disable-warning=ExperimentalWarning', '--experimental-strip-types', 'scripts/backup.ts'],
			{
				cwd: root,
				encoding: 'utf8',
				env: {
					...process.env,
					DATABASE_PATH: dbPath,
					BACKUP_DIR: backups,
					HIGHLIGHTS_DIR: hl,
					COVER_DIR: covers,
					TSUNDOKU_MIGRATE: 'off'
				}
			}
		);
	const row = (copy: string) =>
		Number(
			getDb()
				.prepare(
					`INSERT INTO highlights (kind, series_title, series_kind, made_at, copy_path, still_path)
					VALUES ('page', 'Frieren', 'manga', 1790000000000, ?, '')`
				)
				.run(copy).lastInsertRowid
		);
	const drop = (id: number) => getDb().prepare(`DELETE FROM highlights WHERE id = ?`).run(id);

	it('a failed mirror: the snapshot lands, the sweep runs, the exit is 1', () => {
		const backups = join(work, 'script-blocked');
		mkdirSync(backups, { recursive: true });
		writeFileSync(join(backups, 'highlights'), 'not a folder');
		mkdirSync(join(hl, 'pages'), { recursive: true });
		writeFileSync(join(hl, 'pages', '30.webp'), 'thirty');
		const id = row('pages/30.webp');
		const pic = staleEpisode();
		const r = run(backups);
		drop(id);
		expect(r.stdout).toMatch(/^saved .*library-\d{8}-\d{6}\.sqlite/m);
		expect(r.stderr).toMatch(/^highlights' copies failed: .*(ENOTDIR|EEXIST)/m);
		expect(r.stderr).not.toContain('backup failed');
		expect(r.stdout).toContain('swept 1 episode files of entries that are gone');
		expect(existsSync(pic)).toBe(false);
		expect(r.status).toBe(1);
		expect(readdirSync(backups).filter((n) => n.endsWith('.sqlite'))).toHaveLength(1);
	});

	it('a mirror that ran says what it did, after the pruned lines, and exits 0', () => {
		const backups = join(work, 'script-ran');
		// Two snapshots of one old day: every tier keeps a day's newest only, so the
		// earlier is pruned and the run has a pruned line.
		mkdirSync(backups, { recursive: true });
		for (const old of ['library-20200101-040000.sqlite', 'library-20200101-050000.sqlite'])
			writeFileSync(join(backups, old), 'old');
		mkdirSync(join(hl, 'pages'), { recursive: true });
		writeFileSync(join(hl, 'pages', '31.webp'), 'thirty-one');
		const id = row('pages/31.webp');
		const r = run(backups);
		drop(id);
		expect(r.stderr).toBe('');
		const lines = r.stdout.trim().split('\n');
		expect(lines[0]).toMatch(/^saved /);
		expect(lines[1]).toBe('pruned library-20200101-040000.sqlite');
		expect(lines[2]).toBe("highlights' copies: 1 copied, 0 kept, 0 missing, 0 set aside, 0 pruned");
		expect(r.status).toBe(0);
	});

	it('a night with no highlights folder says it was skipped, and exits 0', () => {
		const backups = join(work, 'script-skipped');
		rmSync(hl, { recursive: true, force: true });
		const id = row('pages/32.webp');
		const r = run(backups);
		drop(id);
		expect(r.stdout).toContain(
			"highlights' copies: skipped (no source), nothing copied or set aside"
		);
		expect(r.status).toBe(0);
	});
});
