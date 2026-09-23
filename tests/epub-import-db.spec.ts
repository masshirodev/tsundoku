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

describe('volumes grouped into one novel', () => {
	const vol = () =>
		db()
			.prepare(
				`SELECT e.label, e.file, e.volume, e.available, e.position, s.title AS series
				FROM entries e JOIN series s ON s.id = e.series_id
				WHERE s.title IN ('Frieren', 'Frieren: Volume 1', 'Frieren: Volume 2')
				ORDER BY s.id, e.position`
			)
			.all() as {
			label: string;
			file: string;
			volume: string;
			available: number;
			position: number;
			series: string;
		}[];

	it('takes each book as a volume, files named from the folder they share', async () => {
		const { groupIntoSeries } = await import('$lib/server/books');
		const one = idOf('Frieren: Volume 1');
		const two = idOf('Frieren: Volume 2');
		// Read a chapter of the first, so progress can be seen to travel.
		db()
			.prepare(`UPDATE entries SET read_at = 5 WHERE series_id = ? AND label = 'Prologue'`)
			.run(one);
		const r = groupIntoSeries({ seriesIds: [one, two], name: 'Frieren' });
		expect(r.volumes).toHaveLength(2);
		const s = seriesPage(r.seriesId, false)!;
		expect(s.kind).toBe('novel');
		expect(s.path).toBe(join(library, 'Library'));
		expect(s.entries.map((e) => [e.label, e.file, e.volume])).toEqual([
			['Cover', 'Light novels/Frieren Vol 1.epub', 'Frieren: Volume 1'],
			['Prologue', 'Light novels/Frieren Vol 1.epub', 'Frieren: Volume 1'],
			['Chapter 1', 'Light novels/Frieren Vol 1.epub', 'Frieren: Volume 1'],
			['Chapter 2', 'Light novels/Frieren Vol 1.epub', 'Frieren: Volume 1'],
			['Afterword', 'Light novels/Frieren Vol 1.epub', 'Frieren: Volume 1'],
			['Cover', 'Frieren Vol 2.epub', 'Frieren: Volume 2'],
			['Chapter 3', 'Frieren Vol 2.epub', 'Frieren: Volume 2'],
			['Chapter 4', 'Frieren Vol 2.epub', 'Frieren: Volume 2'],
			['Afterword', 'Frieren Vol 2.epub', 'Frieren: Volume 2']
		]);
		expect(s.entries[1].readAt).toBe(5);
		expect(db().prepare(`SELECT 1 FROM series WHERE id IN (?, ?)`).all(one, two)).toEqual([]);
	});

	it('serves each volume its own EPUB', async () => {
		const { epubVersions, readEpubFile } = await import('$lib/server/epub');
		const id = idOf('Frieren');
		const versions = await epubVersions(id, false);
		expect(Object.keys(versions)).toEqual([
			'Light novels/Frieren Vol 1.epub',
			'Frieren Vol 2.epub'
		]);
		const two = await readEpubFile(id, false, 'Frieren Vol 2.epub');
		expect(two?.size).toBe(Number(versions['Frieren Vol 2.epub']!.split('-')[0]));
		expect(await readEpubFile(id, false, 'elsewhere.epub')).toBeNull();
	});

	it('changes nothing on a rescan: no copy, no reordering, nothing marked missing', async () => {
		const before = vol();
		const r = await runImport(library);
		expect(r.sources[0].seriesCreated).toBe(0);
		expect(vol()).toEqual(before);
	});

	it('keeps a volume’s place when its book gains a chapter', async () => {
		writeFileSync(
			join(library, 'Library', 'Light novels', 'Frieren Vol 1.epub'),
			sampleEpub({
				title: 'Frieren: Volume 1',
				hue: 120,
				chapters: ['Prologue', 'Chapter 1', 'Chapter 1.5', 'Chapter 2']
			})
		);
		await runImport(library);
		expect(vol().map((e) => e.label)).toEqual([
			'Cover',
			'Prologue',
			'Chapter 1',
			'Chapter 1.5',
			'Chapter 2',
			'Afterword',
			'Cover',
			'Chapter 3',
			'Chapter 4',
			'Afterword'
		]);
		expect(vol().map((e) => e.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(vol()[3]).toMatchObject({
			file: 'Light novels/Frieren Vol 1.epub',
			volume: 'Frieren: Volume 1',
			available: 1
		});
	});

	it('UNGROUP gives each volume its series back, found by its file again', async () => {
		const { takeOutVolumes } = await import('$lib/server/books');
		const made = takeOutVolumes(idOf('Frieren'));
		expect(made).toHaveLength(2);
		const one = seriesPage(idOf('Frieren: Volume 1'), false)!;
		expect(one.path).toBe(join(library, 'Library', 'Light novels'));
		expect(one.entries.every((e) => e.file === 'Frieren Vol 1.epub' && e.volume === '')).toBe(true);
		expect(one.entries.map((e) => e.number)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(one.entries[1].readAt).toBe(5);
		const before = vol();
		const r = await runImport(library);
		expect(r.sources[0].seriesCreated).toBe(0);
		expect(vol()).toEqual(before);
	});
});
