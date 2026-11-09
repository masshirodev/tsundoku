import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zip } from './helpers/zip-writer';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { samplePage } = await import('$lib/server/pages/sample');
const { groupIntoSeries, takeOutVolumes } = await import('$lib/server/books');
const { refreshCovers, coverDir, readCover, readVolumeCover } = await import('$lib/server/covers');
const { setHidden } = await import('$lib/server/library');
const { coverImageOfPage, coverPages } = await import('$lib/epub/epub');

/**
 * A volume's own cover (c835), derived from its EPUB file and kept in the cover
 * directory with no new column: a manifest cover, or the image a `Cover` page
 * holds when the package names none (the shape Haibara's books have). Also the
 * lifetime the cover has when a volume moves: taken out, grouped again, a file
 * replaced by a rescan, and hidden while reveal is off.
 */

const library = mkdtempSync(join(tmpdir(), 'tsundoku-volume-covers-'));
mkdirSync(join(library, 'Library'), { recursive: true });

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const doc = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(title)}</title></head>
<body>${body}</body></html>`;

/**
 * A book laid out as Haibara's are: no manifest `cover-image`, no
 * `<meta name="cover">`, and a Cover entry whose page is an image alone.
 * `cover: 'manifest'` writes the ordinary EPUB instead.
 */
function book(o: { title: string; hue: number; cover: 'page' | 'manifest' | 'none' }): Buffer {
	const items = [
		`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>`,
		o.cover === 'none'
			? ''
			: `<item id="plate" href="images/cover.png" media-type="image/png"${o.cover === 'manifest' ? ' properties="cover-image"' : ''}/>`,
		`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`
	];
	return zip([
		{ name: 'mimetype', data: 'application/epub+zip' },
		{
			name: 'META-INF/container.xml',
			data: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
		},
		{
			name: 'OEBPS/content.opf',
			data: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">e2e:${esc(o.title)}</dc:identifier><dc:title>${esc(o.title)}</dc:title><dc:language>en</dc:language></metadata>
<manifest>${items.filter(Boolean).join('\n')}</manifest>
<spine toc="ncx"><itemref idref="cover"/><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`
		},
		{
			name: 'OEBPS/toc.ncx',
			data: `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint id="p0" playOrder="1"><navLabel><text>Cover</text></navLabel><content src="cover.xhtml"/></navPoint><navPoint id="p1" playOrder="2"><navLabel><text>Chapter 1</text></navLabel><content src="ch1.xhtml"/></navPoint><navPoint id="p2" playOrder="3"><navLabel><text>Chapter 2</text></navLabel><content src="ch2.xhtml"/></navPoint></navMap></ncx>`
		},
		{
			name: 'OEBPS/cover.xhtml',
			data: doc('Cover', '<p><img src="images/cover.png" alt="Cover"/></p>')
		},
		{ name: 'OEBPS/ch1.xhtml', data: doc('Chapter 1', '<h1>Chapter 1</h1><p>One.</p>') },
		{ name: 'OEBPS/ch2.xhtml', data: doc('Chapter 2', '<h1>Chapter 2</h1><p>Two.</p>') },
		...(o.cover === 'none' ? [] : [{ name: 'OEBPS/images/cover.png', data: samplePage(o.hue, 1) }])
	]);
}

const db = () => getDb();
const idOf = (title: string) =>
	(db().prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
const firstEntry = (seriesId: number) =>
	(
		db()
			.prepare(`SELECT id FROM entries WHERE series_id = ? ORDER BY position, id LIMIT 1`)
			.get(seriesId) as { id: number }
	).id;

writeFileSync(
	join(library, 'Library', 'Plain Cover.epub'),
	book({ title: 'Plain Cover', hue: 40, cover: 'manifest' })
);
writeFileSync(
	join(library, 'Library', 'Page Cover.epub'),
	book({ title: 'Page Cover', hue: 100, cover: 'page' })
);
writeFileSync(
	join(library, 'Library', 'No Image.epub'),
	book({ title: 'No Image', hue: 200, cover: 'none' })
);
writeFileSync(
	join(library, 'Library', 'Second.epub'),
	book({ title: 'Second', hue: 300, cover: 'page' })
);

describe('a cover page', () => {
	it('reads the image its Cover entry holds, and knows the pages to look at', () => {
		expect(
			coverImageOfPage('<p><img alt="Cover" src="images/plate.jpg"/></p>', 'OEBPS/cover.xhtml')
		).toBe('OEBPS/images/plate.jpg');
		// An SVG cover page: the image is an <image>, with either spelling of the href.
		expect(
			coverImageOfPage('<svg><image xlink:href="../pics/a.png"/></svg>', 'OEBPS/text/cover.xhtml')
		).toBe('OEBPS/pics/a.png');
		expect(coverImageOfPage('<p>No picture</p>', 'OEBPS/cover.xhtml')).toBeNull();
		const pkg = {
			title: '',
			creators: [],
			authors: [],
			language: '',
			publisher: '',
			isbn: null,
			manifest: [
				{ id: 'c', href: 'OEBPS/cover.xhtml', type: 'application/xhtml+xml', props: [] },
				{ id: 'pl', href: 'OEBPS/other.xhtml', type: 'application/xhtml+xml', props: [] }
			],
			spine: [],
			ncx: null,
			nav: null,
			cover: null,
			rtl: false
		};
		expect(coverPages(pkg, [{ label: 'Cover', href: 'OEBPS/other.xhtml', depth: 0 }])).toEqual([
			'OEBPS/other.xhtml',
			'OEBPS/cover.xhtml'
		]);
	});
});

describe("a volume's own cover", () => {
	it('is the EPUB’s own, or the image its Cover page holds when the package names none', async () => {
		const r = await runImport(library);
		expect(r.failedFiles).toBe(0);
		const plain = await readVolumeCover(firstEntry(idOf('Plain Cover')), false);
		const page = await readVolumeCover(firstEntry(idOf('Page Cover')), false);
		expect(plain?.body.length, 'a manifest cover-image').toBeGreaterThan(0);
		expect(page?.body.length, 'the Cover page’s image').toBeGreaterThan(0);
		expect(await readVolumeCover(firstEntry(idOf('No Image')), false)).toBeNull();
		// The covers are in the cover directory, named by their file, not by a row.
		const files = readdirSync(join(coverDir(), 'volumes'));
		expect(files.length).toBe(2);
		expect(files.every((f) => /^[0-9a-f]{20}-[0-9a-f]{12}\.webp$/.test(f))).toBe(true);
	});

	it('gives the series its cover too: the Cover page is not a dead end', async () => {
		const id = idOf('Page Cover');
		await refreshCovers({ ids: [id], remote: false });
		expect(
			(await readCover(id, false))?.body.length,
			'the series’ cover, from the same page'
		).toBeGreaterThan(0);
	});

	it('removes the cover of a file a rescan replaced', async () => {
		const entry = firstEntry(idOf('Second'));
		expect(await readVolumeCover(entry, false), 'the singleton has one first').not.toBeNull();
		const before = new Set(readdirSync(join(coverDir(), 'volumes')));
		writeFileSync(
			join(library, 'Library', 'Second.epub'),
			book({ title: 'Second', hue: 10, cover: 'page' })
		);
		await runImport(library);
		// The head asks for the volume again, as it does on any screen visit: the
		// new file's cover is made and the old one for that file is removed.
		const again = (
			db()
				.prepare(
					`SELECT e.id FROM entries e WHERE e.file LIKE '%Second.epub' ORDER BY e.id LIMIT 1`
				)
				.get() as { id: number }
		).id;
		expect(await readVolumeCover(again, false)).not.toBeNull();
		await refreshCovers({ remote: false });
		const after = new Set(readdirSync(join(coverDir(), 'volumes')));
		// The untouched files keep theirs; the replaced one made a new cover and
		// its old file went, so one per file, not two for one.
		expect(after.size, 'one cover per file').toBe(before.size);
		expect([...before].filter((f) => !after.has(f)).length, 'one cover replaced').toBe(1);
		expect([...after].filter((f) => !before.has(f)).length, 'and one made').toBe(1);
	});

	it('is the same for every chapter of the volume, and kept across take-out and re-grouping', async () => {
		const one = idOf('Plain Cover');
		const two = idOf('Second');
		const entries = (series: number) =>
			db().prepare(`SELECT id FROM entries WHERE series_id = ? ORDER BY position`).all(series) as {
				id: number;
			}[];
		const before = await readVolumeCover(entries(one)[0].id, false);
		expect(await readVolumeCover(entries(one)[1].id, false)).toEqual(before);
		const files = () => new Set(readdirSync(join(coverDir(), 'volumes')));
		const made = files();
		const grouped = groupIntoSeries({ seriesIds: [one, two], name: 'Grouped' });
		expect(await readVolumeCover(firstEntry(grouped.seriesId), false)).toEqual(before);
		// UNGROUP: each volume a series again, the same EPUB file, the same cover file.
		const taken = takeOutVolumes(grouped.seriesId);
		expect(files()).toEqual(made);
		const again = groupIntoSeries({ seriesIds: taken, name: 'Grouped Again' });
		expect(await readVolumeCover(firstEntry(again.seriesId), false)).toEqual(before);
	});

	it('is a 404 while the series is hidden and reveal is off, as the series’ cover is', async () => {
		const id = idOf('Page Cover');
		const entry = firstEntry(id);
		expect(await readVolumeCover(entry, true)).not.toBeNull();
		setHidden([id], true);
		expect(await readVolumeCover(entry, false)).toBeNull();
		expect(await readVolumeCover(entry, true)).not.toBeNull();
		setHidden([id], false);
	});

	it('answers null for a sample that has no file, and for an entry that is not an EPUB', async () => {
		const { seedSample } = await import('$lib/server/fixtures');
		seedSample(db());
		const sample = db()
			.prepare(
				`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id WHERE s.kind = 'novel' LIMIT 1`
			)
			.get() as { id: number } | undefined;
		if (sample) expect(await readVolumeCover(sample.id, false)).toBeNull();
		const manga = db()
			.prepare(
				`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id WHERE s.kind = 'manga' LIMIT 1`
			)
			.get() as { id: number };
		expect(await readVolumeCover(manga.id, false)).toBeNull();
	});
});
