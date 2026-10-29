import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDocument } from 'htmlparser2';
import {
	chapterDocument,
	NOVEL_MANIFEST,
	novelBookMembers,
	parseNovelManifest,
	type NovelManifest
} from '$lib/import/novel-book';
import { planEpub } from '$lib/import/epub-plan';
import { entryDocs, planEntries } from '$lib/epub/epub';
import { chapterImages, chapterXhtml, hasText } from '$lib/server/novels/chapter-html';
import { readEpub } from '$lib/server/import/epub';
import { zip } from '$lib/server/zip-write';

// A novel's EPUB as tsundoku's device writes it (doc/NOVELS.md,
// "Downloading"; card c150): the chapters it holds, and a manifest of every
// chapter the series has, which the importer folds onto the series.
const work = mkdtempSync(join(tmpdir(), 'tsundoku-novel-book-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const H1 = 'OEBPS/Text/c-0000000000000001.xhtml';
const H3 = 'OEBPS/Text/c-0000000000000003.xhtml';
const manifest: NovelManifest = {
	format: 'tsundoku-novel',
	version: 1,
	plugin: 'good',
	path: '/novel/long',
	source: 'Good Novels',
	title: 'The Long <One>',
	lang: 'en',
	description: 'A long one.',
	status: 'ON_HIATUS',
	coverUrl: 'https://covers.example/long.jpg',
	tags: [
		{ namespace: 'author', value: 'Guiltythree' },
		{ namespace: 'genre', value: 'fantasy' }
	],
	chapters: [
		{ path: '/c/1', position: 1, label: 'Ch. 1', title: 'Start', addedAt: 10, href: H1 },
		{ path: '/c/2', position: 2, label: 'Ch. 2', title: '', addedAt: 20, href: null },
		{ path: '/c/3', position: 3, label: 'Ch. 3', title: '', addedAt: 30, href: H3 }
	]
};

function writeBook(name: string, m = manifest) {
	const docs = new Map([
		[
			H1,
			chapterDocument(
				'Ch. 1: Start',
				'<p>One.</p><p><img src="../Images/i-00000000000000aa.png" alt=""/></p>',
				'en'
			)
		],
		[H3, chapterDocument('Ch. 3', '<p>Three.</p>', 'en')]
	]);
	const images = new Map([
		['OEBPS/Images/i-00000000000000aa.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])]
	]);
	const path = join(work, name);
	writeFileSync(path, zip(novelBookMembers(m, docs, images, new Date(Date.UTC(2026, 9, 29)))));
	return path;
}

describe('a novel’s book', () => {
	it('holds what was downloaded, in reading order, and a manifest of every chapter', async () => {
		const path = writeBook('long.epub');
		const book = await readEpub(path);
		expect(book.pkg?.title).toBe('The Long <One>');
		expect(book.pkg?.creators).toEqual(['Guiltythree']);
		// Chapter 2 isn't downloaded: it isn't a document of the book at all.
		expect(book.pkg?.spine.map((s) => s.href)).toEqual([H1, H3]);
		expect(book.toc.map((t) => [t.label, t.href])).toEqual([
			['Ch. 1: Start', H1],
			['Ch. 3', H3]
		]);
		expect(book.novel?.chapters.map((c) => [c.path, c.href])).toEqual([
			['/c/1', H1],
			['/c/2', null],
			['/c/3', H3]
		]);
		expect(book.sizes.has(NOVEL_MANIFEST)).toBe(true);
		expect(book.sizes.has('OEBPS/Images/i-00000000000000aa.png')).toBe(true);
		// Each chapter's text is its own document, up to the next one in the book.
		const entries = planEntries(book.toc, book.pkg!.spine);
		expect(
			entryDocs(
				book.pkg!.spine,
				entries.map((e) => e.locator),
				0
			).map((d) => d.href)
		).toEqual([H1]);
	});

	it('is read by the importer as its series, each chapter by its path', async () => {
		const path = writeBook('plan.epub');
		const plan = planEpub({
			relPath: 'Library/Novels/Good Novels/plan.epub',
			dir: work,
			file: 'plan.epub',
			addedAt: 5,
			...(await readEpub(path))
		});
		expect(plan.originKey).toBe('lnreader:good:/novel/long');
		expect(plan.source).toBe('lnreader');
		expect(plan.kind).toBe('novel');
		expect(plan.path).toBe(work);
		expect(plan.tags).toEqual(manifest.tags);
		expect(
			plan.entries.map((e) => [e.sourceUrl, e.position, e.label, e.available, e.file, e.locator])
		).toEqual([
			['/c/1', 1, 'Ch. 1', true, 'plan.epub', H1],
			['/c/2', 2, 'Ch. 2', false, '', ''],
			['/c/3', 3, 'Ch. 3', true, 'plan.epub', H3]
		]);
		expect(plan.entries[0].bytes).toBeGreaterThan(0);
	});

	it('names a chapter it says it holds but doesn’t as not downloaded', async () => {
		const m = {
			...manifest,
			chapters: manifest.chapters.map((c) =>
				c.path === '/c/2' ? { ...c, href: 'OEBPS/Text/c-0000000000000002.xhtml' } : c
			)
		};
		// novelBookMembers leaves a chapter without a document out, manifest too.
		const book = await readEpub(writeBook('gap.epub', m));
		expect(book.novel?.chapters[1].href).toBeNull();
	});

	it('is any EPUB when its manifest isn’t tsundoku’s', () => {
		expect(parseNovelManifest('not json')).toBeNull();
		expect(parseNovelManifest(JSON.stringify({ ...manifest, format: 'other' }))).toBeNull();
		expect(parseNovelManifest(JSON.stringify({ ...manifest, plugin: '../x' }))).toBeNull();
		expect(
			parseNovelManifest(JSON.stringify({ ...manifest, chapters: [{ path: '' }] }))
		).toBeNull();
		// An href outside the chapters' folder is no document of the book.
		const odd = parseNovelManifest(
			JSON.stringify({
				...manifest,
				chapters: [{ ...manifest.chapters[0], href: 'META-INF/container.xml' }]
			})
		);
		expect(odd?.chapters[0].href).toBeNull();
		expect(parseNovelManifest(JSON.stringify(manifest))).toEqual(manifest);
	});
});

describe('a chapter from a plugin', () => {
	const base = 'https://good.example/novel/long/c/1';
	const html = `<div class="chapter"><script>track()</script><style>p{}</style>
		<h3 onclick="x()">Chapter 1 &amp; more</h3>
		<p style="color:red">Hello&nbsp;<b>wörld</b> 中文 <a href="https://ads.example">here</a><br>
		<img data-src="/img/a.png" src="data:image/gif;base64,R0lGOD"><img src="https://tracker.example/p.gif">
		<iframe src="https://ads.example"></iframe><p>unclosed <i>x
		<table><tr><td colspan="2" width="9">cell</td></tr></table>`;

	it('keeps its text and structure, as well-formed XHTML with nothing of the site’s page', () => {
		const images = new Map([
			['https://good.example/img/a.png', '../Images/i-00000000000000aa.png']
		]);
		const out = chapterXhtml(html, base, images);
		expect(out).toContain('<h3>Chapter 1 &amp; more</h3>');
		expect(out).toContain('<p>Hello <b>wörld</b> 中文 here<br/>');
		expect(out).toContain('<img src="../Images/i-00000000000000aa.png" alt=""/>');
		expect(out).toContain('<td colspan="2">cell</td>');
		for (const gone of [
			'script',
			'track',
			'style',
			'onclick',
			'iframe',
			'ads.example',
			'tracker',
			'href',
			'width'
		])
			expect(out).not.toContain(gone);
		// Parsed as XML it reads back the same: every tag closed, every entity XML's own.
		const xml = parseDocument(`<body>${out}</body>`, { xmlMode: true });
		expect(xml.children).toHaveLength(1);
		expect(out).not.toMatch(/&nbsp;|&[a-z]+;(?<!&amp;|&lt;|&gt;|&quot;)/);
	});

	it('lists its pictures as the page meant them, a lazy one by its real source', () => {
		expect(chapterImages(html, base)).toEqual([
			'https://good.example/img/a.png',
			'https://tracker.example/p.gif'
		]);
		expect(
			chapterImages('<img src="javascript:x"><img src="data:image/png;base64,AA">', base)
		).toEqual(['data:image/png;base64,AA']);
	});

	it('is empty when the site sent only its shell', () => {
		expect(hasText('<div><script>x</script> </div>')).toBe(false);
		expect(hasText('<p>Words.</p>')).toBe(true);
	});
});
