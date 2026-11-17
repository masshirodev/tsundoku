import { parseDocument } from 'htmlparser2';
import type { ChildNode, Element } from 'domhandler';

/**
 * A chapter as a plugin gives it (`parseChapter`: a site's HTML, cut out of
 * its page) as the body of a chapter document in tsundoku's EPUB
 * (doc/NOVELS.md, "Downloading"). The reader rebuilds every book
 * from an allowlist anyway (src/lib/reader/text-dom.ts); this is the same
 * allowlist on the way in, so the file is well-formed XHTML any reader opens,
 * and nothing from the site's page (a script, a tracker's image, a style)
 * is kept in it at all.
 *
 * Elements outside the list are unwrapped, so their text stays; the ones
 * whose content is never text (scripts, styles, frames, forms) go whole. No
 * attributes are kept but an image's source and alt and a cell's spans. An
 * image is kept only when the caller has it in the book: a page's pictures
 * are fetched by the worker, never left pointing at the site.
 */

const KEEP = new Set([
	// blocks
	'p',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'blockquote',
	'pre',
	'table',
	'ul',
	'ol',
	'hr',
	'figure',
	'div',
	'section',
	'article',
	// inside a block
	'li',
	'tr',
	'td',
	'th',
	'thead',
	'tbody',
	'tfoot',
	'caption',
	'figcaption',
	'dl',
	'dt',
	'dd',
	// inline
	'em',
	'i',
	'strong',
	'b',
	'br',
	'ruby',
	'rt',
	'rp',
	'rb',
	'sub',
	'sup',
	'small',
	'u',
	's',
	'code',
	'q',
	'cite',
	'abbr',
	'mark',
	'img'
]);

/** Gone with everything in them. */
const DROP = new Set([
	'script',
	'style',
	'noscript',
	'template',
	'iframe',
	'frame',
	'frameset',
	'object',
	'embed',
	'applet',
	'form',
	'input',
	'button',
	'select',
	'textarea',
	'svg',
	'math',
	'canvas',
	'video',
	'audio',
	'head',
	'title',
	'meta',
	'link',
	'base'
]);

const VOID = new Set(['br', 'hr', 'img']);

const ATTRS: Record<string, string[]> = {
	img: ['alt'],
	td: ['colspan', 'rowspan'],
	th: ['colspan', 'rowspan']
};

const text = (s: string) =>
	s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		// eslint-disable-next-line no-control-regex -- XML 1.0 can't carry these at all
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g, '');
const attr = (s: string) => text(s).replace(/"/g, '&quot;');

const isElement = (n: ChildNode): n is Element =>
	n.type === 'tag' || n.type === 'script' || n.type === 'style';

/** An image's address as the page meant it: relative to the chapter's own page. */
function resolve(src: string, base: string): string | null {
	const s = src.trim();
	if (/^data:image\//i.test(s)) return s;
	try {
		const u = new URL(s, base);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

function srcOf(el: Element): string {
	// Lazy-loading sites put the real picture in a data- attribute and a placeholder in src.
	const a = el.attribs;
	return a['data-src'] || a['data-lazy-src'] || a['data-original'] || a.src || '';
}

function walk(nodes: ChildNode[], visit: (el: Element) => void) {
	for (const n of nodes) {
		if (!isElement(n)) continue;
		const name = n.name.toLowerCase();
		if (DROP.has(name)) continue;
		visit(n);
		walk(n.children, visit);
	}
}

/** The pictures a chapter shows, as absolute addresses (or data: URIs), each once, in order. */
export function chapterImages(html: string, base: string): string[] {
	const out: string[] = [];
	walk(parseDocument(html).children, (el) => {
		if (el.name.toLowerCase() !== 'img') return;
		const url = resolve(srcOf(el), base);
		if (url && !out.includes(url)) out.push(url);
	});
	return out;
}

/**
 * The chapter's body as XHTML. [images] maps each picture's address (as
 * chapterImages gives it) to its place relative to the chapter document;
 * a picture it doesn't name is dropped.
 */
export function chapterXhtml(html: string, base: string, images: Map<string, string>): string {
	const out: string[] = [];
	const emit = (nodes: ChildNode[]) => {
		for (const n of nodes) {
			if (n.type === 'text') {
				out.push(text((n as unknown as { data: string }).data));
				continue;
			}
			if (!isElement(n)) continue;
			const name = n.name.toLowerCase();
			if (DROP.has(name)) continue;
			if (!KEEP.has(name)) {
				emit(n.children);
				continue;
			}
			let attrs = '';
			if (name === 'img') {
				const url = resolve(srcOf(n), base);
				const local = url ? images.get(url) : undefined;
				if (!local) continue;
				attrs += ` src="${attr(local)}" alt="${attr(n.attribs.alt ?? '')}"`;
			} else
				for (const a of ATTRS[name] ?? []) {
					const v = n.attribs[a];
					if (v !== undefined && /^\d{1,3}$/.test(v)) attrs += ` ${a}="${v}"`;
				}
			if (VOID.has(name)) {
				out.push(`<${name}${attrs}/>`);
				continue;
			}
			out.push(`<${name}${attrs}>`);
			emit(n.children);
			out.push(`</${name}>`);
		}
	};
	emit(parseDocument(html).children);
	return out.join('').trim();
}

/** Whether a chapter has any words in it: a page that came back as its site's shell has none. */
export function hasText(html: string): boolean {
	let found = false;
	const look = (nodes: ChildNode[]) => {
		for (const n of nodes) {
			if (found) return;
			if (n.type === 'text' && (n as unknown as { data: string }).data.trim()) found = true;
			else if (isElement(n) && !DROP.has(n.name.toLowerCase())) look(n.children);
		}
	};
	look(parseDocument(html).children);
	return found;
}
