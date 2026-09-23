import { describe, expect, it } from 'vitest';
import {
	entryDocs,
	parseContainer,
	parseNav,
	parseNcx,
	parsePackage,
	planEntries,
	protectionOf,
	resolveHref,
	type SpineItem
} from '$lib/epub/epub';
import { Zip } from '$lib/epub/unzip';
import { sampleEpub } from '$lib/server/pages/sample-epub';
import { zip } from './helpers/zip-writer';

const spine = (...hrefs: string[]): SpineItem[] => hrefs.map((href) => ({ href, linear: true }));

describe('paths', () => {
	it('resolves relative, parent and encoded hrefs, keeping the fragment', () => {
		expect(resolveHref('OEBPS/toc.ncx', 'Text/ch1.xhtml#s2')).toBe('OEBPS/Text/ch1.xhtml#s2');
		expect(resolveHref('OEBPS/ncx/toc.ncx', '../Text/Chapter%201.xhtml')).toBe(
			'OEBPS/Text/Chapter 1.xhtml'
		);
		expect(resolveHref('content.opf', 'toc.ncx')).toBe('toc.ncx');
	});
});

describe('the package', () => {
	const opf = `<package><metadata>
		<dc:title>The Apothecary Diaries: Volume 5</dc:title>
		<dc:creator opf:role="aut">Natsu Hyuuga</dc:creator><dc:creator>Kevin Steinbach</dc:creator>
		<dc:language>en</dc:language><meta name="cover" content="img"/></metadata>
		<manifest>
			<item id="c1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/>
			<item id="c2" href="Text/chapter2.xhtml" media-type="application/xhtml+xml"/>
			<item id="img" href="Images/cover.jpg" media-type="image/jpeg"/>
			<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
		</manifest>
		<spine toc="ncx"><itemref idref="c1"/><itemref idref="c2" linear="no"/><itemref idref="gone"/></spine>
	</package>`;

	it('reads the title, creators, spine, contents and cover', () => {
		const p = parsePackage(opf, 'OEBPS/content.opf');
		expect(p.title).toBe('The Apothecary Diaries: Volume 5');
		expect(p.creators).toEqual(['Natsu Hyuuga', 'Kevin Steinbach']);
		expect(p.spine).toEqual([
			{ href: 'OEBPS/Text/chapter1.xhtml', linear: true },
			{ href: 'OEBPS/Text/chapter2.xhtml', linear: false }
		]);
		expect(p.ncx).toBe('OEBPS/toc.ncx');
		expect(p.cover).toBe('OEBPS/Images/cover.jpg');
	});

	it('finds the package through the container', () => {
		expect(
			parseContainer(
				`<container><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
			)
		).toBe('OEBPS/package.opf');
		expect(() => parseContainer('<container/>')).toThrow();
	});
});

describe('tables of contents', () => {
	it('reads only the navMap, not the page list', () => {
		const ncx = `<ncx><navMap>
			<navPoint><navLabel><text>&quot;Coliseum&quot;</text></navLabel><content src="Text/a.xhtml"/></navPoint>
		</navMap><pageList><pageTarget><navLabel><text>167</text></navLabel><content src="Text/a.xhtml#pg_167"/></pageTarget></pageList></ncx>`;
		expect(parseNcx(ncx, 'OEBPS/toc.ncx')).toEqual([
			{ label: '"Coliseum"', href: 'OEBPS/Text/a.xhtml', depth: 1 }
		]);
	});

	it('reads an EPUB 3 nav with its nesting', () => {
		const nav = `<html><body><nav epub:type="landmarks"><ol><li><a href="x.xhtml">Cover</a></li></ol></nav>
			<nav epub:type="toc"><ol><li><a href="v1.xhtml">Volume 1</a><ol><li><a href="c1.xhtml">Chapter 1</a></li></ol></li></ol></nav></body></html>`;
		expect(parseNav(nav, 'EPUB/nav.xhtml')).toEqual([
			{ label: 'Volume 1', href: 'EPUB/v1.xhtml', depth: 1 },
			{ label: 'Chapter 1', href: 'EPUB/c1.xhtml', depth: 2 }
		]);
	});
});

describe('planEntries', () => {
	it('drops sections inside their chapter, keeps chapters in files of their own', () => {
		const entries = planEntries(
			[
				{ label: 'Chapter 1', href: 'a.html', depth: 1 },
				{ label: 'Register Set', href: 'a.html#s1', depth: 2 },
				{ label: 'Volume 1', href: 'v1.html', depth: 1 },
				{ label: 'Chapter 2', href: 'b.html', depth: 2 }
			],
			spine('a.html', 'v1.html', 'b.html')
		);
		expect(entries.map((e) => e.label)).toEqual(['Chapter 1', 'Volume 1', 'Chapter 2']);
	});

	it('follows the spine, not the contents, and merges two points at one place', () => {
		const entries = planEntries(
			[
				{ label: 'Start', href: 'title.html', depth: 1 },
				{ label: 'Cover', href: 'title.html', depth: 1 },
				{ label: 'Chapter 1', href: 'c1.html', depth: 1 },
				{ label: 'Color Illustrations', href: 'colour.html', depth: 1 }
			],
			spine('title.html', 'colour.html', 'c1.html')
		);
		expect(entries.map((e) => e.label)).toEqual(['Start', 'Color Illustrations', 'Chapter 1']);
	});

	it('names an untitled point, and marks matter only at the edges', () => {
		const entries = planEntries(
			[
				{ label: 'Cover', href: 'c.html', depth: 1 },
				{ label: 'Prologue', href: 'p.html', depth: 1 },
				{ label: '', href: 'x.html', depth: 1 },
				{ label: 'Credits', href: 'k.html', depth: 1 },
				{ label: 'Epilogue', href: 'e.html', depth: 1 },
				{ label: 'Afterword', href: 'a.html', depth: 1 }
			],
			spine('c.html', 'p.html', 'x.html', 'k.html', 'e.html', 'a.html')
		);
		expect(entries.map((e) => [e.label, e.matter])).toEqual([
			['Cover', 'front'],
			['Prologue', ''],
			['Chapter 3', ''],
			['Credits', ''],
			['Epilogue', ''],
			['Afterword', 'back']
		]);
	});
});

describe('entryDocs', () => {
	const s = spine('front.html', 'body.html', 'c2.html', 'c3a.html', 'c3b.html');
	const locators = ['body.html', 'body.html#two', 'c3a.html'];

	it('takes whatever comes before the first entry, and stops at the next anchor', () => {
		expect(entryDocs(s, locators, 0)).toEqual([
			{ href: 'front.html', from: '', to: '' },
			{ href: 'body.html', from: '', to: 'two' }
		]);
	});

	it('runs from an anchor to the next entry’s document, and the last to the end', () => {
		expect(entryDocs(s, locators, 1)).toEqual([
			{ href: 'body.html', from: 'two', to: '' },
			{ href: 'c2.html', from: '', to: '' }
		]);
		expect(entryDocs(s, locators, 2).map((d) => d.href)).toEqual(['c3a.html', 'c3b.html']);
	});
});

describe('protection', () => {
	it('tells Adobe DRM from harmless font obfuscation', () => {
		expect(protectionOf(['META-INF/rights.xml'], null)).toBe('adobe');
		const fonts = `<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>`;
		expect(protectionOf([], fonts)).toBeNull();
		const drm = `<encryption xmlns:adept="http://ns.adobe.com/adept"><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>`;
		expect(protectionOf([], drm)).toBe('adobe');
	});
});

describe('the browser unzip', () => {
	it('reads stored and deflated members', async () => {
		const z = new Zip(
			new Uint8Array(
				zip([
					{ name: 'mimetype', data: 'application/epub+zip' },
					{ name: 'OEBPS/ch1.xhtml', data: '<p>Life size.</p>'.repeat(50), deflate: true }
				])
			)
		);
		expect(await z.textOf('mimetype')).toBe('application/epub+zip');
		expect((await z.textOf('OEBPS/ch1.xhtml')).startsWith('<p>Life size.</p>')).toBe(true);
		await expect(z.textOf('missing')).rejects.toThrow();
		expect(() => new Zip(new Uint8Array(10))).toThrow();
	});

	it('opens the seed’s sample book, all the way down to its chapters', async () => {
		const z = new Zip(
			new Uint8Array(sampleEpub({ title: 'Sample', hue: 30, chapters: ['Vol. 1', 'Vol. 2'] }))
		);
		const opf = parseContainer(await z.textOf('META-INF/container.xml'));
		const pkg = parsePackage(await z.textOf(opf), opf);
		const toc = parseNcx(await z.textOf(pkg.ncx!), pkg.ncx!);
		expect(planEntries(toc, pkg.spine).map((e) => [e.label, e.matter])).toEqual([
			['Cover', 'front'],
			['Vol. 1', ''],
			['Vol. 2', ''],
			['Afterword', 'back']
		]);
		expect(await z.textOf('OEBPS/ch2.xhtml')).toContain('<table>');
	});
});
