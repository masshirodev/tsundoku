import type { PlannedTag } from './plan.ts';

/**
 * A novel's EPUB as tsundoku's device writes it (doc/NOVELS.md,
 * "Downloading"). Pure: the writer (server/novels/downloader.ts)
 * hands over the chapters' documents and gets the book's members back, and
 * the importer reads the manifest out of the file it finds.
 *
 * The book holds the chapters downloaded so far, in reading order, and a
 * manifest of every chapter the series has, `META-INF/tsundoku-novel.json`.
 * Not every chapter as a stub document, as first planned: an entry's text
 * runs up to the next entry of its file (`entryDocs`), so a stub between two
 * downloaded chapters would read as the end of the first, and a table of
 * contents may only point into the spine. The manifest is what makes the
 * file this series' own: its key and its chapters' paths at the source, so
 * the importer folds it onto the series ADD made, entry by entry, as Mihon's
 * backup does a download folder.
 */

export const NOVEL_MANIFEST = 'META-INF/tsundoku-novel.json';

/** A chapter document's place in the book: named from its path at the source, so a chapter inserted later moves no other. */
export const CHAPTER_HREF = /^OEBPS\/Text\/c-[0-9a-f]{16}\.xhtml$/;
/** EPUB 3's own picture types: an AVIF or JPEG XL a page carries isn't kept. */
export const IMAGE_HREF = /^OEBPS\/Images\/i-[0-9a-f]{16}\.(jpg|png|gif|webp)$/;

export type NovelBookChapter = {
	/** Its path at the source: the entry's identity. */
	path: string;
	position: number;
	label: string;
	title: string;
	addedAt: number;
	/** Its document in this book, or null for a chapter not downloaded. */
	href: string | null;
};

export type NovelManifest = {
	format: 'tsundoku-novel';
	version: 1;
	/** The series is `lnreader:<plugin>:<path>`. */
	plugin: string;
	path: string;
	/** The plugin's name when the book was written: the `source:` tag. */
	source: string;
	title: string;
	lang: string;
	description: string;
	status: string;
	coverUrl: string;
	tags: PlannedTag[];
	/** Every chapter the series has, in reading order. */
	chapters: NovelBookChapter[];
};

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The manifest of a book, or null for anything that isn't one tsundoku
 * wrote: the importer then reads the file as any other EPUB.
 */
export function parseNovelManifest(text: string | null): NovelManifest | null {
	if (!text) return null;
	let v: unknown;
	try {
		v = JSON.parse(text);
	} catch {
		return null;
	}
	const m = v as Partial<NovelManifest> | null;
	if (!m || m.format !== 'tsundoku-novel' || m.version !== 1) return null;
	if (!isString(m.plugin) || !/^[A-Za-z0-9._-]{1,100}$/.test(m.plugin)) return null;
	if (!isString(m.path) || m.path === '' || !isString(m.title) || !Array.isArray(m.chapters))
		return null;
	const chapters: NovelBookChapter[] = [];
	for (const c of m.chapters as Partial<NovelBookChapter>[]) {
		if (!c || !isString(c.path) || c.path === '' || !isNumber(c.position)) return null;
		const href = isString(c.href) && CHAPTER_HREF.test(c.href) ? c.href : null;
		chapters.push({
			path: c.path,
			position: c.position,
			label: isString(c.label) ? c.label : '',
			title: isString(c.title) ? c.title : '',
			addedAt: isNumber(c.addedAt) ? c.addedAt : 0,
			href
		});
	}
	const tags = (Array.isArray(m.tags) ? m.tags : []).filter(
		(t): t is PlannedTag => !!t && isString(t.namespace) && isString(t.value)
	);
	return {
		format: 'tsundoku-novel',
		version: 1,
		plugin: m.plugin,
		path: m.path,
		source: isString(m.source) ? m.source : '',
		title: m.title,
		lang: isString(m.lang) ? m.lang : '',
		description: isString(m.description) ? m.description : '',
		status: isString(m.status) ? m.status : '',
		coverUrl: isString(m.coverUrl) ? m.coverUrl : '',
		tags,
		chapters
	};
}

export const escapeXml = (s: string) =>
	s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		// Characters XML 1.0 can't carry at all, which a scraped page sometimes has.
		// eslint-disable-next-line no-control-regex
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g, '');

/** What a chapter is called in the book's contents: its label, and its title when it has one. */
export const tocLabel = (c: Pick<NovelBookChapter, 'label' | 'title'>) =>
	c.title ? `${c.label}: ${c.title}` : c.label;

/** A chapter document: its body is already XHTML (server/novels/chapter-html.ts). */
export function chapterDocument(title: string, body: string, lang: string): string {
	const l = escapeXml(lang || 'en');
	return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${l}" lang="${l}">
<head><title>${escapeXml(title)}</title></head>
<body>
${body}
</body>
</html>`;
}

export type BookMember = { name: string; data: string | Buffer; deflate?: boolean };

const IMAGE_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp'
};

/** OEBPS/Text/c-….xhtml as the package names it, relative to OEBPS/. */
const inPackage = (href: string) => href.slice('OEBPS/'.length);
const idOf = (href: string) => href.slice(href.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

/**
 * The book's members, `mimetype` first and stored as the format requires.
 * [docs] are the chapter documents by href, [images] the pictures they use
 * by href; a chapter with an href but no document is left out of the book.
 * [modified] is the package's dcterms:modified, which EPUB 3 requires.
 */
export function novelBookMembers(
	m: NovelManifest,
	docs: Map<string, string | Buffer>,
	images: Map<string, Buffer>,
	modified: Date
): BookMember[] {
	const chapters = m.chapters.map((c) => ({
		...c,
		href: c.href && docs.has(c.href) ? c.href : null
	}));
	const inBook = chapters.filter((c) => c.href !== null) as (NovelBookChapter & { href: string })[];
	const manifest: NovelManifest = { ...m, chapters };
	const lang = escapeXml(m.lang || 'en');
	const authors = m.tags.filter((t) => t.namespace === 'author');
	const stamp = modified.toISOString().replace(/\.\d{3}Z$/, 'Z');
	const pics = [...images.keys()].filter((h) => IMAGE_HREF.test(h)).sort();

	const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">${escapeXml(`urn:tsundoku:lnreader:${m.plugin}:${m.path}`)}</dc:identifier>
<dc:title>${escapeXml(m.title)}</dc:title>
${authors.map((a) => `<dc:creator>${escapeXml(a.value)}</dc:creator>`).join('\n')}
<dc:language>${lang}</dc:language>
${m.source ? `<dc:publisher>${escapeXml(m.source)}</dc:publisher>\n` : ''}${m.description ? `<dc:description>${escapeXml(m.description)}</dc:description>\n` : ''}<meta property="dcterms:modified">${stamp}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${inBook.map((c) => `<item id="${idOf(c.href)}" href="${inPackage(c.href)}" media-type="application/xhtml+xml"/>`).join('\n')}
${pics.map((h) => `<item id="${idOf(h)}" href="${inPackage(h)}" media-type="${IMAGE_TYPES[h.slice(h.lastIndexOf('.') + 1)]}"/>`).join('\n')}
</manifest>
<spine toc="ncx">
${inBook.map((c) => `<itemref idref="${idOf(c.href)}"/>`).join('\n')}
</spine>
</package>`;

	const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${escapeXml(`urn:tsundoku:lnreader:${m.plugin}:${m.path}`)}"/></head>
<docTitle><text>${escapeXml(m.title)}</text></docTitle>
<navMap>
${inBook.map((c, i) => `<navPoint id="p${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXml(tocLabel(c))}</text></navLabel><content src="${inPackage(c.href)}"/></navPoint>`).join('\n')}
</navMap>
</ncx>`;

	const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><title>${escapeXml(m.title)}</title></head>
<body>
<nav epub:type="toc" id="toc"><ol>
${inBook.map((c) => `<li><a href="${inPackage(c.href)}">${escapeXml(tocLabel(c))}</a></li>`).join('\n')}
</ol></nav>
</body>
</html>`;

	return [
		{ name: 'mimetype', data: 'application/epub+zip' },
		{
			name: 'META-INF/container.xml',
			data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
		},
		{ name: NOVEL_MANIFEST, data: JSON.stringify(manifest), deflate: true },
		{ name: 'OEBPS/content.opf', data: opf, deflate: true },
		{ name: 'OEBPS/toc.ncx', data: ncx, deflate: true },
		{ name: 'OEBPS/nav.xhtml', data: nav, deflate: true },
		...inBook.map((c) => ({ name: c.href, data: docs.get(c.href)!, deflate: true })),
		// Pictures are compressed already.
		...pics.map((h) => ({ name: h, data: images.get(h)! }))
	];
}
