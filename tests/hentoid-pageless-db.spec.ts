import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { writeHentoidFolder, book, content } = await import('./helpers/hentoid-fixture');

/**
 * Hentoid folders with no pages. A download that failed leaves its
 * contentV2.json and the thumbnail; Hentoid's "(1)" copy of a folder can hold
 * only the thumbnail. Neither is a book, and what an earlier import made of
 * them goes, unless the user touched it.
 */
const library = mkdtempSync(join(tmpdir(), 'tsundoku-pageless-'));
const hentoid = writeHentoidFolder(library);
const failed = content({ title: 'Failed Download', site: 'NHENTAI', url: '/542267/', pages: [] });
book(hentoid, 'nhentai/mine - Failed Download - [542267]', failed, ['thumb.webp']);
book(hentoid, 'nhentai/mine - Failed Download - [542267] (1)', null, ['thumb.webp']);

const db = () => getDb();
const titles = () =>
	(db().prepare(`SELECT title FROM series ORDER BY title`).all() as { title: string }[]).map(
		(r) => r.title
	);
const rootId = () =>
	(db().prepare(`SELECT id FROM roots WHERE path = ?`).get(hentoid) as { id: number }).id;

describe('a Hentoid folder with no pages', () => {
	it('is no book: neither the failed download nor its thumbnail-only copy', async () => {
		await runImport(library);
		expect(titles()).not.toContain('Failed Download');
		expect(titles().some((t) => t.includes('Failed Download'))).toBe(false);
		// The real books are all there.
		expect(titles()).toEqual(
			expect.arrayContaining(['Summer Days', 'Summer Days 2', 'Quiet Rooms', 'Lost Json'])
		);
	});

	it('takes away what an earlier import made of it, while nobody has touched it', async () => {
		const now = Date.now();
		const add = (title: string, origin: string) =>
			Number(
				db()
					.prepare(
						`INSERT INTO series (root_id, title, kind, rating, added_at, source, path, origin_key)
						VALUES (?, ?, 'doujin', 0, ?, 'hentoid', ?, ?)`
					)
					.run(rootId(), title, now, hentoid, origin).lastInsertRowid
			);
		// What the old importer made: an empty series, and a one-page "book" of the thumbnail.
		add('Failed Download', 'hentoid:NHENTAI:/542267/');
		const copy = add(
			'Failed Download (1)',
			'hentoid-dir:nhentai/mine - Failed Download - [542267] (1)'
		);
		db()
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, file, page_count)
				VALUES (?, 1, 'Book', ?, 'nhentai/mine - Failed Download - [542267] (1)', 1)`
			)
			.run(copy, now);
		// One the user rated stays, entries or not.
		const kept = add('Rated Anyway', 'hentoid:NHENTAI:/999/');
		db().prepare(`UPDATE series SET rating = 3 WHERE id = ?`).run(kept);

		await runImport(library, { now: now + 1 });
		expect(titles()).not.toContain('Failed Download');
		expect(titles()).not.toContain('Failed Download (1)');
		expect(titles()).toContain('Rated Anyway');
		// Not a delete: nothing buried, so a finished download would import.
		expect(db().prepare(`SELECT COUNT(*) AS n FROM tombstones`).get()).toEqual({ n: 0 });
	});

	it('imports as a book once its pages arrive', async () => {
		book(hentoid, 'nhentai/mine - Failed Download - [542267]', null, ['0001.jpg', '0002.jpg']);
		await runImport(library, { now: Date.now() + 2 });
		expect(titles()).toContain('Failed Download');
	});
});
