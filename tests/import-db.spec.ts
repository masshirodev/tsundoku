import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { writeMihonFolder } = await import('./helpers/mihon-fixture');
const { writeHentoidFolder } = await import('./helpers/hentoid-fixture');
const { groupIntoSeries } = await import('$lib/server/books');

const root = writeMihonFolder(mkdtempSync(join(tmpdir(), 'tsundoku-mihon-')));
const library = dirname(root);
const hentoid = writeHentoidFolder(library);
/** The Mihon part of a run's summary, flattened with the job's own fields. */
const importMihon = async (now?: number) => {
	const r = await runImport(library, { now });
	return { jobId: r.jobId, failedFiles: r.failedFiles, ...r.sources[0] };
};
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
	first = await importMihon(1_800_000_000_000);
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
		const again = await importMihon(1_800_000_100_000);
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
		await importMihon();
		const after = db().prepare(`SELECT title, rating FROM series WHERE id = ?`).get(d.id);
		expect(after).toEqual({ title: 'Drawing (mine)', rating: 1 });
		expect(entries(d.id).map((e) => e.available)).toEqual([0, 1, 0]);
	});
});

describe('the Hentoid import', () => {
	const bookSeries = (title: string) => series(title);
	const pagesOf = (entryId: number) =>
		(
			db()
				.prepare(`SELECT file FROM entry_pages WHERE entry_id = ? ORDER BY position`)
				.all(entryId) as { file: string }[]
		).map((p) => p.file);

	it('lands every book in the hidden Hentoid root', () => {
		const root = db().prepare(`SELECT name, hidden FROM roots WHERE path = ?`).get(hentoid);
		expect(root).toEqual({ name: 'Hentoid', hidden: 1 });
		for (const t of ['Summer Days', 'Summer Days 2', 'Quiet Rooms', 'Lost Json'])
			expect(bookSeries(t)).toMatchObject({ kind: 'doujin', source: 'hentoid' });
	});

	it('keeps a book’s rating, FAV and progress, with its pages and cover', () => {
		const s = bookSeries('Summer Days');
		expect(s).toMatchObject({ rating: 4, favourite: 1, path: hentoid });
		const e = db().prepare(`SELECT * FROM entries WHERE series_id = ?`).get(s.id) as Record<
			string,
			unknown
		> & { id: number };
		expect(e).toMatchObject({
			label: 'Book',
			file: 'nhentai/Aoi Rin - Summer Days - [111]',
			page_count: 4,
			cover_file: 'thumb.jpg'
		});
		expect(e.read_at).toBe(1_750_000_000_000);
		expect(pagesOf(e.id)).toEqual(['0001.jpg', '0002.jpg', '0003.jpg', '0004.jpg']);
	});

	it('splits a multi-chapter book into a series of books', () => {
		const s = bookSeries('Quiet Rooms');
		const books = db()
			.prepare(
				`SELECT id, label, page_count, read_at, last_position FROM entries WHERE series_id = ? ORDER BY position`
			)
			.all(s.id) as {
			id: number;
			label: string;
			page_count: number;
			read_at: number | null;
			last_position: number | null;
		}[];
		expect(books.map((b) => [b.label, b.page_count])).toEqual([
			['Ch. 1', 3],
			['Ch. 1.5', 2],
			['Ch. 2', 2]
		]);
		expect(books[1]).toMatchObject({ read_at: null, last_position: 1 });
		expect(pagesOf(books[2].id)).toEqual(['0006.jpg', '0007.jpg']);
		const tags = db()
			.prepare(
				`SELECT t.namespace, t.value FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = ?`
			)
			.all(books[0].id);
		expect(tags).toContainEqual({ namespace: 'artist', value: 'mori' });
	});

	it('does not count hidden arrivals on the band', () => {
		const job = db()
			.prepare(`SELECT series_found FROM scan_jobs WHERE id = ?`)
			.get(first.jobId) as { series_found: number };
		// Four visible Mihon series; Bunk Beds and every Hentoid book are hidden.
		expect(job.series_found).toBe(4);
	});

	it('finds a book the owner grouped, instead of making it again', async () => {
		const a = bookSeries('Summer Days');
		const b = bookSeries('Summer Days 2');
		const { seriesId } = groupIntoSeries({ seriesIds: [a.id, b.id], name: 'Summer Days' });
		const before = count(`SELECT COUNT(*) n FROM series`);
		await importMihon();
		expect(count(`SELECT COUNT(*) n FROM series`)).toBe(before);
		const grouped = db().prepare(`SELECT path FROM series WHERE id = ?`).get(seriesId);
		expect(grouped).toEqual({ path: hentoid });
	});

	it('marks a deleted book folder not downloaded, keeping its entry', async () => {
		rmSync(join(hentoid, 'nhentai', 'someone - Lost Json - [333]'), { recursive: true });
		await importMihon();
		const s = bookSeries('Lost Json');
		expect(entries(s.id).map((e) => e.available)).toEqual([0]);
	});
});

describe('Mihon’s local source', () => {
	it('imports each local folder as a single book in its own hidden root', () => {
		const root = db().prepare(`SELECT name, hidden FROM roots WHERE path LIKE '%/local'`).get();
		expect(root).toEqual({ name: 'Mihon local', hidden: 1 });
		const book = series('Local Book');
		expect(book).toMatchObject({ kind: 'doujin', rating: 0 });
		const e = db().prepare(`SELECT * FROM entries WHERE series_id = ?`).get(book.id) as Record<
			string,
			unknown
		>;
		expect(e).toMatchObject({
			label: 'Book',
			file: 'aoi rin - Local Book - [555]/chapter_1',
			page_count: 3,
			cover_file: '../cover.jpg',
			read_at: 1_760_000_000_000
		});
		const tags = db()
			.prepare(
				`SELECT t.namespace, t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id WHERE st.series_id = ?`
			)
			.all(book.id);
		expect(tags).toContainEqual({ namespace: 'artist', value: 'aoi rin' });
		expect(series('No Artist Here')).toBeDefined();
	});

	it('never turns the backup’s local manga into series in the visible Mihon root', () => {
		const n = (
			db()
				.prepare(`SELECT COUNT(*) n FROM series WHERE title = 'aoi rin - Local Book - [555]'`)
				.get() as { n: number }
		).n;
		expect(n).toBe(0);
	});
});
