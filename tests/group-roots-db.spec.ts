import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { groupIntoSeries, GroupingError } = await import('$lib/server/books');
const { writeHentoidFolder, book, content } = await import('./helpers/hentoid-fixture');

/**
 * The same work in two folders: the library's Hentoid copy and the phone's,
 * both hidden (doc/SYNC.md, "Other devices"), and a visible book beside them.
 * The first two group; a visible book and a hidden one don't.
 *
 * The Mihon local source is not imported, so the pair is two devices' Hentoid
 * copies --
 * the cross-folder case the grouping actually has to survive.
 */
const library = mkdtempSync(join(tmpdir(), 'tsundoku-roots-'));
writeHentoidFolder(library);
const phone = writeHentoidFolder(join(library, 'devices', 'phone'));
book(
	phone,
	'nhentai/Aoi Rin - Phone Only - [999]',
	content({ title: 'Phone Only', site: 'NHENTAI', url: '/g/999/', pages: [{ name: '0001' }] }),
	['0001.jpg']
);
const db = getDb();
const row = (title: string) =>
	db
		.prepare(
			`SELECT s.id, r.name AS root FROM series s JOIN roots r ON r.id = s.root_id WHERE s.title = ?`
		)
		.get(title) as { id: number; root: string } | undefined;

beforeAll(async () => {
	await runImport(library, { now: 1_800_000_000_000 });
});

describe('grouping across sources', () => {
	it('groups two devices’ books, both still readable', () => {
		const phoneBook = row('Phone Only')!;
		const hentoid = row('Summer Days')!;
		expect([phoneBook.root, hentoid.root]).toEqual(['Hentoid', 'Hentoid']);
		const g = groupIntoSeries({ seriesIds: [hentoid.id, phoneBook.id], name: 'Across Sources' });
		const s = db.prepare(`SELECT path FROM series WHERE id = ?`).get(g.seriesId) as {
			path: string;
		};
		const files = db.prepare(`SELECT file FROM entries WHERE series_id = ?`).all(g.seriesId) as {
			file: string;
		}[];
		expect(files).toHaveLength(2);
		for (const f of files) expect(existsSync(join(s.path, f.file)), f.file).toBe(true);
	});

	it('keeps them grouped through a rescan: neither single comes back', async () => {
		await runImport(library, { now: 1_800_000_100_000 });
		expect(row('Phone Only')).toBeUndefined();
		expect(row('Summer Days')).toBeUndefined();
		expect(
			(
				db
					.prepare(
						`SELECT COUNT(*) AS n FROM entries e JOIN series s ON s.id = e.series_id WHERE s.title = 'Across Sources'`
					)
					.get() as { n: number }
			).n
		).toBe(2);
	});

	it('refuses a hidden book and a visible one, saying why', () => {
		// Nothing visible is imported from this fixture, so a
		// visible root stands in for the library's own.
		db.prepare(`INSERT OR IGNORE INTO roots (name, path, hidden) VALUES ('Library', ?, 0)`).run(
			join(library, 'Library')
		);
		const visible = db
			.prepare(
				`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
				WHERE r.hidden = 0 AND s.kind = 'doujin' LIMIT 1`
			)
			.get() as { id: number } | undefined;
		const hidden = row('Summer Days 2')!;
		// The fixture's visible doujin, if any; otherwise make one visible book.
		const v =
			visible?.id ??
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, added_at) VALUES ((SELECT id FROM roots WHERE hidden = 0 LIMIT 1), 'Visible One', 'doujin', 0)`
					)
					.run().lastInsertRowid
			);
		if (!visible)
			db.prepare(
				`INSERT INTO entries (series_id, position, label, added_at) VALUES (?, 1, 'Book', 0)`
			).run(v);
		expect(() => groupIntoSeries({ seriesIds: [v, hidden.id], name: 'Mixed' })).toThrow(
			GroupingError
		);
		expect(() => groupIntoSeries({ seriesIds: [v, hidden.id], name: 'Mixed' })).toThrow(
			/hidden and visible/
		);
	});
});
