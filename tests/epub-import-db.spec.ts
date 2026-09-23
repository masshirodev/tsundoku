import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { sampleEpub } = await import('$lib/server/pages/sample-epub');
const { seriesPage } = await import('$lib/server/series');
const { listSeries } = await import('$lib/server/library');

const library = mkdtempSync(join(tmpdir(), 'tsundoku-epub-'));
mkdirSync(join(library, 'Library', 'Light novels'), { recursive: true });
writeFileSync(
	join(library, 'Library', 'Light novels', 'Frieren Vol 1.epub'),
	sampleEpub({
		title: 'Frieren: Volume 1',
		hue: 120,
		chapters: ['Prologue', 'Chapter 1', 'Chapter 2']
	})
);
writeFileSync(join(library, 'Library', 'broken.epub'), 'not a zip');
// A second book laid out like the first, as publishers' books are.
writeFileSync(
	join(library, 'Library', 'Frieren Vol 2.epub'),
	sampleEpub({ title: 'Frieren: Volume 2', hue: 120, chapters: ['Chapter 3', 'Chapter 4'] })
);

const db = () => getDb();
const idOf = (title: string) =>
	(db().prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;

describe('the EPUB import', () => {
	it('makes each EPUB a novel series, its contents the entries, in reading order', async () => {
		const r = await runImport(library);
		expect(r.sources.map((s) => s.name)).toEqual(['Library']);
		expect(r.sources[0].seriesCreated).toBe(3);
		expect(r.failedFiles).toBe(1);
		const s = seriesPage(idOf('Frieren: Volume 1'), false)!;
		expect(s.kind).toBe('novel');
		expect(s.entries.map((e) => [e.label, e.matter, e.locator])).toEqual([
			['Cover', 'front', 'OEBPS/cover.xhtml'],
			['Prologue', '', 'OEBPS/ch1.xhtml'],
			['Chapter 1', '', 'OEBPS/ch2.xhtml'],
			['Chapter 2', '', 'OEBPS/ch3.xhtml'],
			['Afterword', 'back', 'OEBPS/afterword.xhtml']
		]);
		expect(s.entries.every((e) => e.file === 'Frieren Vol 1.epub' && e.bytes > 0)).toBe(true);
		expect(s.tags).toContainEqual({ namespace: 'author', value: 'Development Sample' });
	});

	it('keeps two books with the same inside apart', () => {
		const two = seriesPage(idOf('Frieren: Volume 2'), false)!;
		expect(two.entries.map((e) => e.label)).toEqual([
			'Cover',
			'Chapter 3',
			'Chapter 4',
			'Afterword'
		]);
		expect(two.entries.every((e) => e.file === 'Frieren Vol 2.epub')).toBe(true);
	});

	it('counts chapters, not matter, and starts on the first chapter', () => {
		const card = listSeries({ reveal: false }).find((c) => c.title === 'Frieren: Volume 1')!;
		expect(card.entryCount).toBe(3);
		expect(card.readCount).toBe(0);
	});

	it('lists a file that is not an EPUB as one entry, so the reader can say so', () => {
		const s = seriesPage(idOf('broken'), false)!;
		expect(s.entries.map((e) => e.label)).toEqual(['Book']);
	});

	it('changes nothing on a rescan', async () => {
		const before = db()
			.prepare(`SELECT id, locator, matter, position FROM entries ORDER BY id`)
			.all();
		await runImport(library);
		expect(
			db().prepare(`SELECT id, locator, matter, position FROM entries ORDER BY id`).all()
		).toEqual(before);
	});
});
