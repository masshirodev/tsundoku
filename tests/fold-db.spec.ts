import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Msg } from './helpers/protobuf-writer';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { ASURA, backup, cbz, comicInfo, writeMihonFolder } = await import('./helpers/mihon-fixture');

/**
 * A download imported by its folder before a backup knew the manga, then
 * seen again once one does (src/lib/server/import/fold.ts).
 */
const library = mkdtempSync(join(tmpdir(), 'tsundoku-fold-'));
const root = writeMihonFolder(join(library, 'devices', 'tsundoku'));
process.env.LIBRARY_ROOT = library;

// A second download the first backup doesn't know.
const twinDir = join(root, 'downloads', 'Asura Scans (EN)', 'Second Orphan');
mkdirSync(twinDir, { recursive: true });
for (const n of [1, 2])
	writeFileSync(
		join(twinDir, `Chapter ${n}.cbz`),
		cbz(
			comicInfo({
				title: `Chapter ${n}`,
				series: 'Second Orphan',
				number: n,
				web: `https://asura.example/series/second-orphan/${n}`,
				source: 'Asura Scans'
			})
		)
	);

const db = getDb();
const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;
const all = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as T[];
const byKey = (key: string) =>
	one<{ id: number } | undefined>(`SELECT id FROM series WHERE origin_key = ?`, key)?.id;

const ORPHAN_DIR = 'mihon-dir:Asura Scans (EN)/Not In The Backup';
const ORPHAN_URL = `mihon:${ASURA}:/series/not-in-the-backup`;
const TWIN_DIR = 'mihon-dir:Asura Scans (EN)/Second Orphan';
const TWIN_URL = `mihon:${ASURA}:/series/second-orphan`;

const manga = (url: string, title: string, chapters: number[]): Msg => [
	[1, ASURA],
	[2, url],
	[3, title],
	...chapters.map((n): [number, Msg] => [
		16,
		[
			[1, `${url}/${n}`],
			[2, `Chapter ${n}`],
			[9, { f32: n }],
			[10, 10 - n]
		]
	]),
	// "Good"
	[17, 1]
];

let orphan: number;
let twin: number;
let current: number;

beforeAll(async () => {
	await runImport(library, { now: 1_800_000_000_000 });
	orphan = byKey(ORPHAN_DIR)!;
	twin = byKey(TWIN_DIR)!;
	expect(orphan).toBeTruthy();
	expect(twin).toBeTruthy();

	// What the owner did with the folder's series while it was the only one.
	db.prepare(`UPDATE entries SET read_at = 1_800_000_010_000 WHERE series_id = ?`).run(orphan);
	const [first] = all<{ id: number }>(
		`SELECT id FROM entries WHERE series_id = ? ORDER BY position`,
		twin
	);
	db.prepare(
		`UPDATE entries SET read_at = 1_800_000_020_000, last_opened_at = 1_800_000_020_000 WHERE id = ?`
	).run(first.id);
	db.prepare(`UPDATE series SET favourite = 1, rating = 6 WHERE id = ?`).run(twin);
	db.prepare(
		`INSERT INTO reading_events (at, series_id, entry_id, kind, page, duration_ms) VALUES (?, ?, ?, 'finish', 3, 60000)`
	).run(1_800_000_020_000, twin, first.id);

	// The old importer made a second series under the URL key, on the same files.
	current = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, path, origin_key, source, rating)
				SELECT root_id, title, kind, added_at, path, ?, source, 8 FROM series WHERE id = ?`
			)
			.run(TWIN_URL, twin).lastInsertRowid
	);
	db.prepare(
		`INSERT INTO entries (series_id, position, label, added_at, file, source_url, available)
		SELECT ?, position, label, added_at, file, '/series/second-orphan/' || CAST(position AS INTEGER), 1
		FROM entries WHERE series_id = ?`
	).run(current, twin);

	// A newer backup, taken after both were added to Mihon's library.
	writeFileSync(
		join(root, 'autobackup', 'app.mihon_2026-10-04_08-00.tachibk'),
		gzipSync(
			backup(
				[],
				[
					manga('/series/not-in-the-backup', 'Not In The Backup', [1]),
					manga('/series/second-orphan', 'Second Orphan', [1, 2])
				]
			)
		)
	);
	await runImport(library, { now: 1_800_000_100_000 });
});

describe('a download a backup now knows', () => {
	it('alone: the folder’s series takes the URL key, and keeps everything', () => {
		expect(byKey(ORPHAN_DIR)).toBeUndefined();
		expect(byKey(ORPHAN_URL)).toBe(orphan);
		const entries = all<{ source_url: string; read_at: number | null; available: number }>(
			`SELECT source_url, read_at, available FROM entries WHERE series_id = ? AND file LIKE 'Chapter 1%'`,
			orphan
		);
		expect(entries).toEqual([
			{ source_url: '/series/not-in-the-backup/1', read_at: 1_800_000_010_000, available: 1 }
		]);
	});

	it('beside a series under the URL key: folded into it, and gone', () => {
		expect(byKey(TWIN_DIR)).toBeUndefined();
		expect(byKey(TWIN_URL)).toBe(current);
		expect(
			one<{ n: number }>(`SELECT COUNT(*) AS n FROM series WHERE title = 'Second Orphan'`).n
		).toBe(1);

		const s = one<{ rating: number; favourite: number }>(
			`SELECT rating, favourite FROM series WHERE id = ?`,
			current
		);
		// Its own rating stays; the FAV only the folder's series had comes across.
		expect(s).toEqual({ rating: 8, favourite: 1 });

		const entries = all<{ label: string; read_at: number | null; available: number }>(
			`SELECT label, read_at, available FROM entries WHERE series_id = ? ORDER BY position`,
			current
		);
		expect(entries).toEqual([
			{ label: 'Ch. 1', read_at: 1_800_000_020_000, available: 1 },
			{ label: 'Ch. 2', read_at: null, available: 1 }
		]);
		const events = all<{ series_id: number; entry_id: number | null }>(
			`SELECT series_id, entry_id FROM reading_events WHERE at = 1_800_000_020_000`
		);
		expect(events).toHaveLength(1);
		expect(events[0].series_id).toBe(current);
		expect(events[0].entry_id).not.toBeNull();
	});

	it('stays settled on the next scan', async () => {
		await runImport(library, { now: 1_800_000_200_000 });
		expect(byKey(ORPHAN_DIR)).toBeUndefined();
		expect(byKey(TWIN_DIR)).toBeUndefined();
		expect(
			one<{ n: number }>(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ?`, current).n
		).toBe(2);
	});
});
