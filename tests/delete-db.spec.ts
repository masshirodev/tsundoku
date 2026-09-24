import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { deleteBook, deleteSeries } = await import('$lib/server/delete');
const { groupIntoSeries } = await import('$lib/server/books');
const { writeMihonFolder } = await import('./helpers/mihon-fixture');
const { writeHentoidFolder } = await import('./helpers/hentoid-fixture');

const library = dirname(writeMihonFolder(mkdtempSync(join(tmpdir(), 'tsundoku-delete-'))));
const hentoid = writeHentoidFolder(library);
const trash = mkdtempSync(join(tmpdir(), 'tsundoku-trash-'));
process.env.LIBRARY_ROOT = library;
process.env.TRASH_DIR = trash;

const db = getDb();
const idOf = (title: string) =>
	(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number } | undefined)
		?.id;
const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
const inTrash = (rel: string) => {
	const stamps = readdirSync(trash);
	return stamps.some((s) => existsSync(join(trash, s, rel)));
};

beforeAll(async () => {
	await runImport(library, { now: 1_800_000_000_000 });
});

describe('deleting a series', () => {
	it('removes it, moves its files to the trash under their library path, and keeps it gone', async () => {
		const id = idOf('Drawing: Saikyou Mangaka')!;
		const weeb = join('Mihon', 'downloads', 'Weeb Central (EN)', 'Drawing_ Saikyou Mangaka');
		expect(existsSync(join(library, weeb, 'Unknown_Chapter 2_abc2.cbz'))).toBe(true);

		const r = await deleteSeries([id], false, 1_800_000_100_000);
		expect(r).toMatchObject({ series: 1, files: 2 });
		expect(idOf('Drawing: Saikyou Mangaka')).toBeUndefined();
		expect(count(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ${id}`)).toBe(0);
		expect(existsSync(join(library, weeb, 'Unknown_Chapter 2_abc2.cbz'))).toBe(false);
		expect(inTrash(join(weeb, 'Unknown_Chapter 2_abc2.cbz'))).toBe(true);

		// Mihon's backup still lists it: the rescan must not bring it back.
		await runImport(library, { now: 1_800_000_200_000 });
		expect(idOf('Drawing: Saikyou Mangaka')).toBeUndefined();
	});

	it('leaves a hidden series alone while reveal is off', async () => {
		const id = idOf('Summer Days')!;
		expect(await deleteSeries([id], false)).toMatchObject({ series: 0, files: 0 });
		expect(idOf('Summer Days')).toBe(id);
	});
});

describe('deleting one book of a series of books', () => {
	it('takes the book out for good, and the series keeps the rest', async () => {
		const books = db
			.prepare(
				`SELECT s.id, s.title FROM series s JOIN roots r ON r.id = s.root_id
				WHERE r.name = 'Hentoid' AND s.kind = 'doujin'
				AND (SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id) = 1 ORDER BY s.id LIMIT 3`
			)
			.all() as { id: number; title: string }[];
		expect(books.length).toBe(3);
		const g = groupIntoSeries({ seriesIds: books.map((b) => b.id), name: 'To Trim' });
		const [first] = g.entryIds;
		const file = db
			.prepare(
				`SELECT s.path, e.file FROM entries e JOIN series s ON s.id = e.series_id WHERE e.id = ?`
			)
			.get(first) as { path: string; file: string };
		const r = await deleteBook(g.seriesId, first, true, 1_800_000_300_000);
		expect(r).toMatchObject({ entries: 1, seriesGone: false });
		expect(existsSync(join(file.path, file.file))).toBe(false);
		expect(count(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ${g.seriesId}`)).toBe(2);
		expect(
			db
				.prepare(`SELECT position FROM entries WHERE series_id = ? ORDER BY position`)
				.all(g.seriesId)
		).toEqual([{ position: 1 }, { position: 2 }]);

		// Neither a singleton of it nor the book comes back on a rescan.
		await runImport(library, { now: 1_800_000_400_000 });
		expect(idOf(books[0].title)).toBeUndefined();
		expect(count(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ${g.seriesId}`)).toBe(2);
		expect(hentoid).toBeTruthy();
	});
});
