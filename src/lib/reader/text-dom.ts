import { resolveHref, splitHref, type DocRange } from '$lib/epub/epub';
import type { ZipReader } from '$lib/epub/unzip';

/**
 * The text reader's DOM side (doc/TEXT-READER.md): a chapter's XHTML, from
 * the downloaded book, turned into the reader's own blocks, and the first
 * character on a page found and found again.
 *
 * A book's markup never reaches the page as it is. It's parsed by the
 * browser (DOMParser, which runs no scripts), then rebuilt element by element
 * from an allowlist: paragraphs, headings, lists, quotes, code, tables,
 * images and inline emphasis and ruby, with no attributes but an image's
 * source and a cell's span. No book styles, no links, no scripts, no fonts.
 * What that loses (a centred scene break, a coloured word) is the price of
 * the reader's type settings applying to every book alike.
 */

/** Top-level blocks the flow is made of; each carries `data-b`, its index. */
const BLOCK = new Set([
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
	'figure'
]);
/** Containers whose children are the blocks. */
const WRAPPER = new Set([
	'body',
	'div',
	'section',
	'article',
	'main',
	'aside',
	'header',
	'footer',
	'nav',
	'center'
]);
const INLINE = new Set([
	'em',
	'i',
	'strong',
	'b',
	'span',
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
	'mark'
]);
/** Inside a block: the structure a list or a table needs. */
const INNER = new Set([
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
	'dd'
]);

export type Images = {
	/** A blob: URL for an image in the book, made once and kept for the session. */
	url(path: string): Promise<string | null>;
};

export function bookImages(zip: ZipReader): Images & { revoke(): void } {
	const made = new Map<string, Promise<string | null>>();
	const type = (p: string) =>
		/\.png$/i.test(p)
			? 'image/png'
			: /\.gif$/i.test(p)
				? 'image/gif'
				: /\.svg$/i.test(p)
					? 'image/svg+xml'
					: /\.webp$/i.test(p)
						? 'image/webp'
						: 'image/jpeg';
	return {
		url(path) {
			if (!made.has(path))
				made.set(
					path,
					zip.has(path)
						? zip
								.bytesOf(path)
								.then((b) => URL.createObjectURL(new Blob([b as BlobPart], { type: type(path) })))
								.catch(() => null)
						: Promise.resolve(null)
				);
			return made.get(path)!;
		},
		revoke() {
			for (const p of made.values()) void p.then((u) => u && URL.revokeObjectURL(u));
			made.clear();
		}
	};
}

function parse(markup: string): Document {
	const xml = new DOMParser().parseFromString(markup, 'application/xhtml+xml');
	// Plenty of "XHTML" in the wild isn't well-formed: HTML parsing forgives it.
	if (xml.getElementsByTagName('parsererror').length === 0 && xml.body) return xml;
	return new DOMParser().parseFromString(markup, 'text/html');
}

function byAnchor(doc: Document, anchor: string): Element | null {
	if (!anchor) return null;
	return (
		doc.getElementById(anchor) ??
		[...doc.querySelectorAll('[id], a[name]')].find(
			(e) => e.getAttribute('id') === anchor || e.getAttribute('name') === anchor
		) ??
		null
	);
}

/** The part of one document an entry owns: from its anchor, up to the next entry's. */
function slice(doc: Document, range: DocRange): Node {
	const body = doc.body ?? doc.documentElement;
	const from = byAnchor(doc, range.from);
	const to = byAnchor(doc, range.to);
	if (!from && !to) return body;
	const r = doc.createRange();
	if (from) r.setStartBefore(from);
	else r.setStart(body, 0);
	if (to) r.setEndBefore(to);
	else r.setEnd(body, body.childNodes.length);
	const holder = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
	holder.appendChild(r.cloneContents());
	return holder;
}

type Ctx = { out: Document; images: Images; docHref: string; pending: Promise<void>[] };

const local = (n: Node) => (n as Element).localName?.toLowerCase() ?? '';

/** An image element for a book path, its src filled in once the blob is ready. */
function image(ctx: Ctx, src: string | null, alt: string): HTMLElement | null {
	if (!src) return null;
	const img = ctx.out.createElement('img');
	img.alt = alt;
	img.decoding = 'async';
	// The reader's own, not the book's: a mouse drag on an illustration turns
	// the page as one on text does, where the browser's image drag cancels
	// the press (on a vertical book's cover page, for one).
	img.draggable = false;
	ctx.pending.push(
		ctx.images.url(splitHref(resolveHref(ctx.docHref, src)).doc).then((u) => {
			if (u) img.src = u;
		})
	);
	return img;
}

/** Inline content, rebuilt from the allowlist; anything else keeps only its children. */
function inline(ctx: Ctx, from: Node, into: HTMLElement) {
	for (const n of [...from.childNodes]) {
		if (n.nodeType === Node.TEXT_NODE) {
			into.append(ctx.out.createTextNode(n.textContent ?? ''));
			continue;
		}
		if (n.nodeType !== Node.ELEMENT_NODE) continue;
		const name = local(n);
		if (name === 'img' || name === 'image') {
			const el = n as Element;
			const img = image(
				ctx,
				el.getAttribute('src') ?? el.getAttribute('xlink:href') ?? el.getAttribute('href'),
				el.getAttribute('alt') ?? ''
			);
			if (img) into.append(img);
		} else if (INLINE.has(name) || INNER.has(name)) {
			const el = ctx.out.createElement(name);
			for (const a of ['colspan', 'rowspan'])
				if ((n as Element).hasAttribute(a)) el.setAttribute(a, (n as Element).getAttribute(a)!);
			inline(ctx, n, el);
			into.append(el);
		} else if (BLOCK.has(name) || WRAPPER.has(name)) {
			// A block inside inline content (a div in a li): its content, on a new line.
			if (into.childNodes.length) into.append(ctx.out.createElement('br'));
			inline(ctx, n, into);
		} else {
			inline(ctx, n, into);
		}
	}
}

/** The blocks of one container, in order; loose inline content becomes a paragraph. */
function blocks(ctx: Ctx, from: Node, out: HTMLElement[]) {
	let loose: HTMLElement | null = null;
	const flush = () => {
		if (loose && ((loose.textContent ?? '').trim() !== '' || loose.querySelector('img')))
			out.push(loose);
		loose = null;
	};
	for (const n of [...from.childNodes]) {
		const name = n.nodeType === Node.ELEMENT_NODE ? local(n) : '';
		if (name && (WRAPPER.has(name) || name === 'svg')) {
			flush();
			if (name === 'svg') {
				// A cover or plate as <svg><image/></svg>: just the image.
				const el = (n as Element).querySelector('image, img');
				const img = el
					? image(
							ctx,
							el.getAttribute('xlink:href') ?? el.getAttribute('href') ?? el.getAttribute('src'),
							''
						)
					: null;
				if (img) out.push(figure(ctx, img));
			} else blocks(ctx, n, out);
		} else if (name && BLOCK.has(name)) {
			flush();
			out.push(block(ctx, n as Element, name));
		} else if (name === 'img' || name === 'image') {
			flush();
			const el = n as Element;
			const img = image(
				ctx,
				el.getAttribute('src') ?? el.getAttribute('xlink:href'),
				el.getAttribute('alt') ?? ''
			);
			if (img) out.push(figure(ctx, img));
		} else if (
			n.nodeType === Node.TEXT_NODE ||
			(name && name !== 'script' && name !== 'style' && name !== 'head')
		) {
			if (n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').trim() && !loose) continue;
			loose ??= ctx.out.createElement('p');
			if (n.nodeType === Node.TEXT_NODE) loose.append(ctx.out.createTextNode(n.textContent ?? ''));
			else inline(ctx, { childNodes: [n] } as unknown as Node, loose);
		}
	}
	flush();
}

function figure(ctx: Ctx, img: HTMLElement): HTMLElement {
	const f = ctx.out.createElement('figure');
	f.className = 'illus';
	f.append(img);
	return f;
}

function block(ctx: Ctx, el: Element, name: string): HTMLElement {
	if (name === 'hr') return ctx.out.createElement('hr');
	// A paragraph that is only an image is an illustration.
	if (name === 'p' || name === 'figure') {
		const imgs = el.querySelectorAll('img, image');
		if (imgs.length === 1 && !(el.textContent ?? '').trim()) {
			const i = imgs[0];
			const img = image(
				ctx,
				i.getAttribute('src') ?? i.getAttribute('xlink:href') ?? i.getAttribute('href'),
				i.getAttribute('alt') ?? ''
			);
			if (img) return figure(ctx, img);
		}
	}
	if (name === 'pre' || name === 'table') {
		// Wider than the column is common: boxed, cut at the margin, and
		// opened whole with OPEN (the component measures and labels it).
		const box = ctx.out.createElement('div');
		box.className = `wide ${name === 'pre' ? 'code' : 'table'}`;
		const head = ctx.out.createElement('div');
		head.className = 'wide-head';
		const label = ctx.out.createElement('span');
		label.className = 'wlabel';
		label.textContent = name === 'pre' ? 'LISTING' : 'TABLE';
		const open = ctx.out.createElement('span');
		open.className = 'open';
		open.setAttribute('role', 'button');
		open.textContent = 'OPEN ↗';
		head.append(label, open);
		const body = ctx.out.createElement('div');
		body.className = 'wide-body';
		const inner = ctx.out.createElement(name);
		if (name === 'pre') inner.textContent = el.textContent ?? '';
		else inline(ctx, el, inner);
		body.append(inner);
		box.append(head, body);
		return box;
	}
	const out = ctx.out.createElement(name === 'figure' ? 'div' : name);
	inline(ctx, el, out);
	return out;
}

export type Chapter = { blocks: HTMLElement[]; chars: number };

/** An entry's blocks, from its documents in the book, each numbered with `data-b`. */
export async function chapterBlocks(
	zip: ZipReader,
	docs: DocRange[],
	images: Images,
	out: Document = document
): Promise<Chapter> {
	const all: HTMLElement[] = [];
	const pending: Promise<void>[] = [];
	for (const d of docs) {
		if (!zip.has(d.href)) continue;
		const doc = parse(await zip.textOf(d.href));
		blocks({ out, images, docHref: d.href, pending }, slice(doc, d), all);
	}
	await Promise.all(pending);
	let chars = 0;
	all.forEach((b, i) => {
		b.dataset.b = String(i);
		chars += (b.textContent ?? '').length;
	});
	return { blocks: all, chars };
}

// ---- positions ---------------------------------------------------------------------

export type TextPosition = { block: number; offset: number };

/** Characters from the start of `block` to the caret. */
function offsetIn(block: Element, node: Node, offset: number): number {
	const r = document.createRange();
	r.setStart(block, 0);
	try {
		r.setEnd(node, offset);
	} catch {
		return 0;
	}
	return r.toString().length;
}

/** The character under a point, as a position; null when nothing is there. */
export function positionAt(x: number, y: number): TextPosition | null {
	type CaretDoc = Document & {
		caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
		caretRangeFromPoint?(x: number, y: number): Range | null;
	};
	const d = document as CaretDoc;
	let node: Node | null = null;
	let offset = 0;
	const p = d.caretPositionFromPoint?.(x, y);
	if (p) {
		node = p.offsetNode;
		offset = p.offset;
	} else {
		const r = d.caretRangeFromPoint?.(x, y);
		if (r) {
			node = r.startContainer;
			offset = r.startOffset;
		}
	}
	if (!node) return null;
	const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as Element | null;
	const block = el?.closest('[data-b]');
	if (!block) return null;
	return { block: Number((block as HTMLElement).dataset.b), offset: offsetIn(block, node, offset) };
}

/** Where a position is on screen now: the rectangle of its character, or its block's. */
export function rectOf(flow: HTMLElement, pos: TextPosition): DOMRect | null {
	const block = flow.querySelector<HTMLElement>(`[data-b="${pos.block}"]`);
	if (!block) return null;
	let left = pos.offset;
	const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
	for (let t = walk.nextNode(); t; t = walk.nextNode()) {
		const len = t.textContent?.length ?? 0;
		if (left <= len) {
			const r = document.createRange();
			r.setStart(t, Math.min(left, len));
			r.setEnd(t, Math.min(left + 1, len));
			const rect = r.getClientRects()[0];
			if (rect) return rect;
			break;
		}
		left -= len;
	}
	return block.getBoundingClientRect();
}

/** Characters from a position to the end of the chapter, for time left. */
export function charsAfter(chapter: Chapter, pos: TextPosition): number {
	let n = 0;
	for (const b of chapter.blocks.slice(pos.block)) n += (b.textContent ?? '').length;
	return Math.max(0, n - pos.offset);
}
