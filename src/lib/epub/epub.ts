/**
 * EPUB structure (doc/TEXT-READER.md): the container, the package (OPF), and
 * the table of contents, from their text. Pure and isomorphic: the importer
 * runs it on the workstation to make a series' entries, and the reader runs
 * it on the tablet to find an entry's pages in the downloaded book.
 *
 * Regular expressions rather than an XML parser, because the parts read here
 * are small and regular, the same code has to run in node and the browser,
 * and neither has a parser in common. The body text is never parsed here; the
 * reader hands it to the browser's own DOMParser.
 */

export type ManifestItem = { id: string; href: string; type: string; props: string[] };
export type SpineItem = { href: string; linear: boolean };
export type TocPoint = { label: string; href: string; depth: number };

export type Package = {
	title: string;
	creators: string[];
	/**
	 * Each creator with its MARC role (`aut`, `ill`, `trl`…), from an EPUB 2
	 * `opf:role` or an EPUB 3 `<meta refines="#id" property="role">`; '' when
	 * the file doesn't say. For suggesting a novel to Ranobe (doc/RANOBE.md).
	 */
	authors: { name: string; role: string }[];
	language: string;
	/** dc:publisher, or ''. */
	publisher: string;
	/** An ISBN among dc:identifier, digits only (10 or 13), or null. */
	isbn: string | null;
	manifest: ManifestItem[];
	spine: SpineItem[];
	/** The NCX, and the EPUB 3 navigation document, when the package names them. */
	ncx: string | null;
	nav: string | null;
	cover: string | null;
	/** The spine turns right to left: a vertical Japanese book. */
	rtl: boolean;
};

export class EpubError extends Error {}

// ---- text -----------------------------------------------------------------

const NAMED: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

export function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
		if (e[0] === '#') {
			const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
		}
		return NAMED[e.toLowerCase()] ?? whole;
	});
}

/** Text content of a fragment: tags dropped, entities decoded, space collapsed. */
export const textOf = (s: string) =>
	decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ''))
		.replace(/\s+/g, ' ')
		.trim();

/** A tag's attributes, by local name: `opf:role` and `role` both read as `role`. */
export function attrs(tag: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
		const name = m[1].includes(':') ? m[1].slice(m[1].indexOf(':') + 1) : m[1];
		out[name] = decodeEntities(m[3] ?? m[4] ?? '');
		out[m[1]] = out[name];
	}
	return out;
}

/** Every opening tag of a local name (any namespace prefix), in order. */
const openTags = (xml: string, name: string) =>
	[...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);

/** The inner text of the first element of a local name, or ''. */
function firstText(xml: string, name: string): string {
	const m = new RegExp(
		`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`,
		'i'
	).exec(xml);
	return m ? textOf(m[1]) : '';
}

// ---- paths ----------------------------------------------------------------

/** A zip path's directory, with the trailing slash, or ''. */
export const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/**
 * Resolve an href from the document at `from` to a path inside the zip,
 * keeping any `#fragment`. Hrefs are URL-encoded ("Chapter%201.xhtml"); zip
 * names aren't.
 */
export function resolveHref(from: string, href: string): string {
	const hash = href.indexOf('#');
	const path = hash >= 0 ? href.slice(0, hash) : href;
	const frag = hash >= 0 ? href.slice(hash) : '';
	if (path === '') return from + frag;
	let decoded = path;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		// A stray % that isn't an escape: keep the name as written.
	}
	const parts = (decoded.startsWith('/') ? decoded.slice(1) : dirOf(from) + decoded).split('/');
	const out: string[] = [];
	for (const p of parts) {
		if (p === '..') out.pop();
		else if (p !== '.' && p !== '') out.push(p);
	}
	return out.join('/') + frag;
}

export const splitHref = (href: string) => {
	const i = href.indexOf('#');
	return i >= 0 ? { doc: href.slice(0, i), anchor: href.slice(i + 1) } : { doc: href, anchor: '' };
};

// ---- container and package -------------------------------------------------

export function parseContainer(xml: string): string {
	const root = openTags(xml, 'rootfile')
		.map(attrs)
		.find((a) => (a['media-type'] ?? 'application/oebps-package+xml').includes('oebps-package'));
	if (!root?.['full-path']) throw new EpubError('CONTAINER.XML NAMES NO PACKAGE');
	return root['full-path'];
}

export function parsePackage(xml: string, opfPath: string): Package {
	const manifest: ManifestItem[] = openTags(xml, 'item').map((t) => {
		const a = attrs(t);
		return {
			id: a.id ?? '',
			href: resolveHref(opfPath, a.href ?? ''),
			type: a['media-type'] ?? '',
			props: (a.properties ?? '').split(/\s+/).filter(Boolean)
		};
	});
	const byId = new Map(manifest.map((i) => [i.id, i]));
	const spineTag = openTags(xml, 'spine')[0] ?? '';
	const spine: SpineItem[] = openTags(xml, 'itemref')
		.map(attrs)
		.map((a) => ({ item: byId.get(a.idref ?? ''), linear: a.linear !== 'no' }))
		.filter((r): r is { item: ManifestItem; linear: boolean } => !!r.item)
		.map((r) => ({ href: r.item.href, linear: r.linear }));
	const ncxId = attrs(spineTag).toc;
	const ncx =
		(ncxId && byId.get(ncxId)?.href) ||
		manifest.find((i) => i.type === 'application/x-dtbncx+xml')?.href ||
		null;
	const nav = manifest.find((i) => i.props.includes('nav'))?.href ?? null;
	const coverMeta = openTags(xml, 'meta')
		.map(attrs)
		.find((a) => a.name === 'cover')?.content;
	const cover =
		manifest.find((i) => i.props.includes('cover-image'))?.href ??
		(coverMeta ? (byId.get(coverMeta)?.href ?? null) : null);
	const creators = [
		...xml.matchAll(/<(?:[\w-]+:)?creator\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?creator>/gi)
	]
		.map((m) => textOf(m[1]))
		.filter(Boolean);
	// EPUB 3 gives a creator's role in a meta that refines its id.
	const refined = new Map<string, string>();
	for (const m of xml.matchAll(/<(?:[\w-]+:)?meta\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?meta>/gi)) {
		const a = attrs(`<meta ${m[1]}>`);
		if (a.property === 'role' && a.refines?.startsWith('#'))
			refined.set(a.refines.slice(1), textOf(m[2]));
	}
	const authors = [
		...xml.matchAll(/<(?:[\w-]+:)?creator\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?creator>/gi)
	]
		.map((m) => {
			const a = attrs(`<creator ${m[1]}>`);
			return {
				name: textOf(m[2]),
				role: (a['opf:role'] ?? a.role ?? (a.id ? refined.get(a.id) : undefined) ?? '').trim()
			};
		})
		.filter((c) => c.name);
	const isbn =
		[...xml.matchAll(/<(?:[\w-]+:)?identifier\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?identifier>/gi)]
			.map((m) => {
				const scheme = attrs(`<identifier ${m[1]}>`)['opf:scheme'] ?? '';
				const v = textOf(m[2]);
				const isIsbn = /isbn/i.test(scheme) || /^urn:isbn:/i.test(v);
				const digits = v.replace(/^urn:isbn:/i, '').replace(/[\s-]/g, '');
				return isIsbn && /^(\d{9}[\dX]|\d{13})$/i.test(digits) ? digits.toUpperCase() : null;
			})
			.find((x) => x !== null) ?? null;
	return {
		title: firstText(xml, 'title'),
		creators: [...new Set(creators)],
		authors,
		language: firstText(xml, 'language'),
		publisher: firstText(xml, 'publisher'),
		isbn,
		manifest,
		spine,
		ncx,
		nav,
		cover,
		rtl: attrs(spineTag)['page-progression-direction'] === 'rtl'
	};
}

/**
 * The pages a package offers as its cover when the package itself names no
 * cover image: a toc entry called Cover (Haibara's EPUBs), then a
 * manifest document named `cover.xhtml`. Most likely first.
 */
export function coverPages(pkg: Package, toc: TocPoint[]): string[] {
	const named = toc
		.filter((t) => /^\s*cover(\s+page)?\s*$/i.test(t.label))
		.map((t) => splitHref(t.href).doc);
	const files = pkg.manifest
		.filter((i) => i.type.includes('html') && /(^|\/)cover(\.[a-z0-9]+)?\.x?html?$/i.test(i.href))
		.map((i) => i.href);
	return [...new Set([...named, ...files].filter(Boolean))];
}

/**
 * The image a cover page holds: its `<img src>`, or an SVG's `<image>`.
 * Resolved against the page, so it is the zip member's name.
 */
export function coverImageOfPage(html: string, pageHref: string): string | null {
	const m =
		/<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(html) ??
		/<image\b[^>]*\b(?:xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)')/i.exec(html);
	const raw = (m?.[2] ?? m?.[3] ?? '').trim();
	return raw === '' ? null : resolveHref(pageHref, raw);
}

// ---- tables of contents -------------------------------------------------------

/**
 * The NCX's navMap, flattened in order with each point's depth. Only the
 * navMap: a pageList's numbered targets ("167") are print page numbers, not
 * chapters.
 */
export function parseNcx(xml: string, ncxPath: string): TocPoint[] {
	const map = /<(?:[\w-]+:)?navMap\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?navMap>/i.exec(xml)?.[1] ?? '';
	const out: TocPoint[] = [];
	let depth = 0;
	let open: TocPoint | null = null;
	const re =
		/(<(?:[\w-]+:)?navPoint\b[^>]*>)|(<\/(?:[\w-]+:)?navPoint>)|<(?:[\w-]+:)?text\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?text>|(<(?:[\w-]+:)?content\b[^>]*>)/gi;
	for (const m of map.matchAll(re)) {
		if (m[1]) {
			depth += 1;
			open = { label: '', href: '', depth };
			out.push(open);
		} else if (m[2]) {
			depth -= 1;
			open = null;
		} else if (m[3] !== undefined && open && open.label === '') {
			open.label = textOf(m[3]);
		} else if (m[4] && open && open.href === '') {
			const src = attrs(m[4]).src;
			if (src) open.href = resolveHref(ncxPath, src);
		}
	}
	return out.filter((p) => p.href !== '');
}

/** The EPUB 3 navigation document's `toc` nav, flattened the same way. */
export function parseNav(xhtml: string, navPath: string): TocPoint[] {
	const navs = [...xhtml.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi)];
	const toc = navs.find((m) => /type\s*=\s*["'][^"']*\btoc\b/i.test(m[1])) ?? navs[0];
	if (!toc) return [];
	const out: TocPoint[] = [];
	let depth = 0;
	for (const m of toc[2].matchAll(/(<ol\b[^>]*>)|(<\/ol>)|<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
		if (m[1]) depth += 1;
		else if (m[2]) depth -= 1;
		else {
			const href = attrs(`<a ${m[3]}>`).href;
			if (href) out.push({ label: textOf(m[4]), href: resolveHref(navPath, href), depth });
		}
	}
	return out;
}

// ---- entries ------------------------------------------------------------------

export type Matter = '' | 'front' | 'back';

export type BookEntry = {
	label: string;
	/** `doc#anchor`, resolved inside the zip: where the entry starts. */
	locator: string;
	spineIndex: number;
	matter: Matter;
};

/**
 * Front and back matter by what they're called. Only at the edges of the book
 * (see `planEntries`), so a chapter that happens to be called "Credits" in
 * the middle of a novel stays a chapter.
 */
const MATTER =
	/^(cover|start|front page|intro page|title( page)?|information|(table of )?contents( page)?|toc|copyrights?( and credits| page)?|credits|dedication|insert\b.*|colou?r(ed)? (inserts?|illustrations?)|illustrations?|character (design|gallery|introductions?).*|characters?|cast|newsletter|about (the author|j-novel club|yen press|seven seas).*|also (by|available).*|sign ?up.*|afterword|translator'?s? notes|bonus translator[’']?s notes|back matter|front matter)$/i;

/**
 * The table of contents as reading-order entries:
 *
 * - a child that points into its parent's file is a section of it (a
 *   technical book's subsections), not an entry; a child in a file of its own
 *   is one (a web novel's chapters under a "Volume 1" point);
 * - two points at the same place are one entry, the first;
 * - order is the spine's, not the TOC's: a publisher that lists its colour
 *   illustrations last still has them first in the book;
 * - an untitled point is named from its place ("Chapter 1427");
 * - matter is decided at the edges: front before the first entry that isn't
 *   called like matter, back after the last one.
 */
export function planEntries(toc: TocPoint[], spine: SpineItem[]): BookEntry[] {
	const indexOf = new Map(spine.map((s, i) => [s.href, i]));
	const kept: (TocPoint & { order: number })[] = [];
	const parents: TocPoint[] = [];
	const seen = new Set<string>();
	toc.forEach((p, order) => {
		parents.length = p.depth - 1;
		const parent = parents[p.depth - 2];
		parents[p.depth - 1] = p;
		const { doc } = splitHref(p.href);
		if (!indexOf.has(doc)) return;
		if (parent && splitHref(parent.href).doc === doc) return;
		if (seen.has(p.href)) return;
		seen.add(p.href);
		kept.push({ ...p, order });
	});
	kept.sort(
		(a, b) =>
			indexOf.get(splitHref(a.href).doc)! - indexOf.get(splitHref(b.href).doc)! || a.order - b.order
	);
	const entries = kept.map((p, i): BookEntry => ({
		label: p.label || `Chapter ${i + 1}`,
		locator: p.href,
		spineIndex: indexOf.get(splitHref(p.href).doc)!,
		matter: ''
	}));
	const isMatter = entries.map((e) => MATTER.test(e.label.replace(/[.:]\s*$/, '').trim()));
	const first = isMatter.indexOf(false);
	const last = isMatter.lastIndexOf(false);
	entries.forEach((e, i) => {
		if (first < 0) return;
		if (i < first && isMatter[i]) e.matter = 'front';
		else if (i > last && isMatter[i]) e.matter = 'back';
	});
	return entries;
}

/**
 * Where an entry's text is: from its own start up to the next entry's, as a
 * run of spine documents. The first document may start at an anchor, and the
 * last may stop at one. Spine documents before the first entry belong to it:
 * nothing in the book is unreachable.
 */
export type DocRange = { href: string; from: string; to: string };

export function entryDocs(spine: SpineItem[], locators: string[], index: number): DocRange[] {
	const indexOf = new Map(spine.map((s, i) => [s.href, i]));
	const at = (loc: string) => {
		const { doc, anchor } = splitHref(loc);
		return { i: indexOf.get(doc) ?? -1, anchor };
	};
	const start = at(locators[index]);
	if (start.i < 0) return [];
	const first = index === 0 ? 0 : start.i;
	const next = index + 1 < locators.length ? at(locators[index + 1]) : null;
	// The next entry starts at the top of its own document: this one ends before it.
	const lastDoc = !next ? spine.length - 1 : next.anchor ? next.i : next.i - 1;
	const out: DocRange[] = [];
	for (let i = first; i <= Math.max(first, lastDoc); i++) {
		out.push({
			href: spine[i].href,
			// The first entry also takes whatever comes before its anchor.
			from: i === start.i && index > 0 ? start.anchor : '',
			to: next && next.anchor && i === next.i ? next.anchor : ''
		});
	}
	return out;
}

// ---- protection -----------------------------------------------------------------

export type Protection = null | 'adobe' | 'other';

/**
 * DRM, from the files that carry it. Font obfuscation (IDPF's, and Adobe's)
 * also lives in encryption.xml and is harmless: only fonts are scrambled, and
 * the reader never uses a book's fonts.
 */
export function protectionOf(names: string[], encryptionXml: string | null): Protection {
	if (names.includes('META-INF/rights.xml')) return 'adobe';
	if (!encryptionXml) return null;
	const algorithms = openTags(encryptionXml, 'EncryptionMethod').map((t) => attrs(t).Algorithm);
	const fontOnly = algorithms.every(
		(a) => a === 'http://www.idpf.org/2008/embedding' || a === 'http://ns.adobe.com/pdf/enc#RC'
	);
	if (fontOnly) return null;
	return /adobe/i.test(encryptionXml) ? 'adobe' : 'other';
}
