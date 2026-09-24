import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { foldEditions } = await import('$lib/server/books');
const { bookEditions } = await import('$lib/server/editions');
const { writeHentoidFolder } = await import('./helpers/hentoid-fixture');

/**
 * A folded book survives the next import (doc/EDITIONS.md): its edition's
 * file is still where Hentoid put it, and the importer must find the entry
 * where the fold moved it rather than bring its old single back.
 */
const library = mkdtempSync(join(tmpdir(), 'tsundoku-editions-'));
writeHentoidFolder(library);
const db = getDb();
const idOf = (title: string) =>
	(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number } | undefined)
		?.id;
const setLanguage = (seriesId: number, language: string) => {
	const t = db
		.prepare(
			`INSERT INTO tags (namespace, value) VALUES ('language', ?) ON CONFLICT DO UPDATE SET value = value RETURNING id`
		)
		.get(language) as { id: number };
	db.prepare(
		`DELETE FROM series_tags WHERE series_id = ? AND tag_id IN (SELECT id FROM tags WHERE namespace = 'language')`
	).run(seriesId);
	db.prepare(`INSERT INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(seriesId, t.id);
};

beforeAll(async () => {
	await runImport(library, { now: 1_800_000_000_000 });
});

describe('a folded book and the importer', () => {
	it('stays one book in two languages through a rescan', async () => {
		const en = idOf('Summer Days')!;
		const ja = idOf('Summer Days 2')!;
		setLanguage(en, 'english');
		setLanguage(ja, 'japanese');
		foldEditions(en, [ja], () => [{ a: 1, b: 1 }]);
		expect(bookEditions(en)!.editions.map((e) => e.code)).toEqual(['EN', 'JA']);

		await runImport(library, { now: 1_800_000_100_000 });
		expect(idOf('Summer Days 2')).toBeUndefined();
		expect(bookEditions(en)!.editions.map((e) => e.code)).toEqual(['EN', 'JA']);
		const edition = db
			.prepare(`SELECT shadowed, series_id FROM entries WHERE edition_of IS NOT NULL`)
			.get();
		expect(edition).toEqual({ shadowed: 1, series_id: en });
	});
});
