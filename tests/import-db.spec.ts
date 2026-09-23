import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { importMihon } = await import('$lib/server/import/mihon');
const { writeMihonFolder } = await import('./helpers/mihon-fixture');

const root = writeMihonFolder(mkdtempSync(join(tmpdir(), 'tsundoku-mihon-')));
const db = () => getDb();
const series = (title: string) =>
	db().prepare(`SELECT * FROM series WHERE title = ?`).get(title) as Record<string, unknown> & {
		id: number;
	};
const entries = (id: number) =>
	db()
		.prepare(
			`SELECT label, available, file, page_count, read_at, last_position FROM entries WHERE series_id = ? ORDER BY position`
		)
		.all(id) as {
		label: string;
		available: number;
		file: string;
		page_count: number;
		read_at: number | null;
		last_position: number | null;
	}[];
const count = (sql: string) => (db().prepare(sql).get() as { n: number }).n;

let first: Awaited<ReturnType<typeof importMihon>>;
beforeAll(async () => {
	first = await importMihon(root, { now: 1_800_000_000_000 });
});

describe('the Mihon import', () => {
	it('imports the library and the unknown download, skips what was only browsed', () => {
		expect(first).toMatchObject({ seriesCreated: 5, skipped: 1, failedFiles: 1 });
		expect(series('Only Browsed')).toBeUndefined();
		// Its ComicInfo says "Manga", and a series' own genre beats its source.
		expect(series('Not In The Backup')).toMatchObject({ kind: 'manga' });
	});

	it('attaches the files it found, with page counts, and marks the rest not downloaded', () => {
		const d = series('Drawing: Saikyou Mangaka');
		expect(d).toMatchObject({ rating: 4, hidden: 0, source: 'mihon', status: 'ongoing' });
		expect(entries(d.id).map((e) => [e.label, e.available, e.page_count])).toEqual([
			['Ch. 1', 0, 0],
			['Ch. 2', 1, 12],
			['Ch. 3', 1, 13]
		]);
		const a = series('Academy’s Undercover Professor');
		expect(entries(a.id).find((e) => e.label === 'Ch. 98')).toMatchObject({
			available: 1,
			file: 'Chapter 98 - Lindenborough.cbz'
		});
	});

	it('hides the "+" series and shelves To Read', () => {
		expect(series('Bunk Beds')).toMatchObject({ hidden: 1, rating: 4 });
		const shelf = db()
			.prepare(
				`SELECT c.name FROM collections c JOIN collection_series cs ON cs.collection_id = c.id
				JOIN series s ON s.id = cs.series_id WHERE s.title = 'Myst, Might, Mayhem'`
			)
			.all();
		expect(shelf).toEqual([{ name: 'To Read' }]);
	});

	it('writes Mihon’s history into the reading log', () => {
		const d = series('Drawing: Saikyou Mangaka');
		const events = db()
			.prepare(
				`SELECT kind, at, page, duration_ms FROM reading_events WHERE series_id = ? ORDER BY at`
			)
			.all(d.id);
		expect(events).toEqual([
			{ kind: 'finish', at: 1_750_000_000_000, page: 0, duration_ms: 600_000 },
			{ kind: 'page', at: 1_750_000_100_000, page: 4, duration_ms: 120_000 }
		]);
	});

	it('counts only visible arrivals on the band', () => {
		const job = db().prepare(`SELECT * FROM scan_jobs WHERE id = ?`).get(first.jobId) as Record<
			string,
			number
		>;
		expect(job.series_found).toBe(4);
		expect(job.finished_at).not.toBeNull();
		expect(job.dismissed_at).toBeNull();
	});
});

describe('a rescan', () => {
	it('changes nothing when nothing changed, and leaves no band', async () => {
		const before = [
			count(`SELECT COUNT(*) n FROM entries`),
			count(`SELECT COUNT(*) n FROM reading_events`)
		];
		const again = await importMihon(root, { now: 1_800_000_100_000 });
		expect(again).toMatchObject({
			seriesCreated: 0,
			seriesUpdated: 5,
			entriesAdded: 0,
			filesAttached: 0
		});
		expect([
			count(`SELECT COUNT(*) n FROM entries`),
			count(`SELECT COUNT(*) n FROM reading_events`)
		]).toEqual(before);
		const job = db()
			.prepare(`SELECT dismissed_at FROM scan_jobs WHERE id = ?`)
			.get(again.jobId) as { dismissed_at: number };
		expect(job.dismissed_at).not.toBeNull();
	});

	it('keeps what the owner changed, and marks a file that went away', async () => {
		const d = series('Drawing: Saikyou Mangaka');
		db().prepare(`UPDATE series SET rating = 1, title = 'Drawing (mine)' WHERE id = ?`).run(d.id);
		rmSync(
			join(
				root,
				'downloads',
				'Weeb Central (EN)',
				'Drawing_ Saikyou Mangaka',
				'Unknown_Chapter 3_abc3.cbz'
			)
		);
		await importMihon(root);
		const after = db().prepare(`SELECT title, rating FROM series WHERE id = ?`).get(d.id);
		expect(after).toEqual({ title: 'Drawing (mine)', rating: 1 });
		expect(entries(d.id).map((e) => e.available)).toEqual([0, 1, 0]);
	});
});
