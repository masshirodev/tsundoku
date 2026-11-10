import type { TextSpan } from '$lib/library/highlights';

/**
 * The text reader's marks (Highlights H2, c702; doc/TEXT-READER.md,
 * "Highlights"): the marker and the selection, drawn into the book's blocks
 * as spans around pieces of their text nodes. Wrapping leaves a block's
 * `textContent` as it was, which is what every saved position
 * (`src/lib/reader/text-dom.ts`) counts in, so a mark never moves a place.
 *
 * Two kinds of number are in play. A **position** counts every character of
 * `textContent`, furigana and a wide block's own head included: it is what
 * `positionAt` answers and what a highlight's row stores. The **words** are
 * what a person reads, with those left out: what a quote's copy holds and what
 * re-finding compares. `blockWords` turns one into the other.
 *
 * A wide block's head never changes length: what depends on the viewport (`· 640PX,
 * 320 SHOWN`) is the label's `data-shown`, drawn by CSS, so the same stored
 * numbers land on the same words on a cut and an uncut screen.
 */

/** Not the words: furigana, and the label a wide block carries over its text. */
const NOT_WORDS = 'rt, rp, .wide-head';

const notWords = (t: Text) => !!t.parentElement?.closest(NOT_WORDS);

/** A block's text nodes, in order, as a list: painting changes the tree under a walker. */
function textNodes(block: HTMLElement): Text[] {
	const out: Text[] = [];
	const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
	for (let t = walk.nextNode(); t; t = walk.nextNode()) out.push(t as Text);
	return out;
}

export type BlockWords = {
	/** What it says, without furigana. */
	words: string;
	/** A position's offset, in the words: inside furigana, the character it reads. */
	wordsAt(full: number): number;
	/** An offset in the words, as a position. */
	fullAt(clean: number): number;
};

/** One block's words, and the way between them and its positions. */
export function blockWords(block: HTMLElement): BlockWords {
	let words = '';
	// Where the left-out runs are, in positions: [start, length].
	const gaps: [number, number][] = [];
	let full = 0;
	for (const t of textNodes(block)) {
		const n = t.data.length;
		if (notWords(t)) gaps.push([full, n]);
		else words += t.data;
		full += n;
	}
	return {
		words,
		wordsAt(at) {
			let out = at;
			for (const [start, n] of gaps) {
				if (at <= start) break;
				out -= Math.min(n, at - start);
			}
			return out;
		},
		fullAt(clean) {
			let out = clean;
			for (const [start, n] of gaps) {
				if (out < start) break;
				out += n;
			}
			return out;
		}
	};
}

/** How many of a block's words come before `el`, inside it (a list item in its list). */
export function wordsBefore(block: HTMLElement, el: HTMLElement): number {
	let n = 0;
	for (const t of textNodes(block)) {
		if (el.contains(t)) return n;
		if (!notWords(t)) n += t.data.length;
	}
	return n;
}

/**
 * The stretch of a block's words a table cell holds, around a place in the
 * words; null when that place isn't in a cell. A table's cells have nothing
 * between them, so without this FLAGVALUEMEANING would read as one word.
 */
export function cellAround(block: HTMLElement, at: number): { start: number; end: number } | null {
	let n = 0;
	for (const t of textNodes(block)) {
		if (notWords(t)) continue;
		const len = t.data.length;
		if (at < n + len) {
			const cell = t.parentElement?.closest<HTMLElement>('td, th');
			if (!cell || !block.contains(cell)) return null;
			const start = wordsBefore(block, cell);
			let size = 0;
			for (const c of textNodes(cell)) if (!notWords(c)) size += c.data.length;
			return { start, end: start + size };
		}
		n += len;
	}
	return null;
}

/** A word found inside a cell's own text, as a place in the block's. */
export const shiftWord = <T extends { start: number; end: number }>(
	word: T | null,
	cell: { start: number }
): T | null =>
	word ? { ...word, start: word.start + cell.start, end: word.end + cell.start } : null;

/** Every piece of [from, to) of a block's text, each in a span of its own. */
function paintBlock(block: HTMLElement, from: number, to: number, make: () => HTMLElement) {
	let at = 0;
	const pieces: HTMLElement[] = [];
	for (const t of textNodes(block)) {
		const n = t.data.length;
		const start = Math.max(from, at);
		const end = Math.min(to, at + n);
		if (start < end && !notWords(t)) {
			let piece = t;
			if (start > at) piece = piece.splitText(start - at);
			if (end - start < piece.data.length) piece.splitText(end - start);
			const span = make();
			piece.replaceWith(span);
			span.append(piece);
			pieces.push(span);
		}
		at += n;
	}
	return pieces;
}

/** A span across its blocks. `blockOf` finds a block by number: the current chapter's only. */
export function paintSpan(
	blockOf: (n: number) => HTMLElement | null,
	span: TextSpan,
	make: () => HTMLElement
): HTMLElement[] {
	const out: HTMLElement[] = [];
	for (let b = span.block; b <= span.endBlock; b++) {
		const el = blockOf(b);
		if (!el) continue;
		const from = b === span.block ? span.offset : 0;
		const to = b === span.endBlock ? span.endOffset : (el.textContent ?? '').length;
		out.push(...paintBlock(el, from, to, make));
	}
	return out;
}

/** Take a kind of mark off, leaving the text as it was, one node to a run. */
export function unpaint(root: ParentNode, selector: string) {
	for (const el of root.querySelectorAll<HTMLElement>(selector)) {
		const parent = el.parentNode;
		if (el.childNodes.length) el.replaceWith(...el.childNodes);
		else el.remove();
		parent?.normalize();
	}
}

/** How the marker is drawn on a piece of a highlight, and on the note's cell after it. */
export const MARK_SELECTOR = '.mk, .nm';

/** The first and last boxes of a run of pieces, which is what the bar and handles stand on. */
export function endsOf(pieces: HTMLElement[]): { first: DOMRect; last: DOMRect } | null {
	const a = pieces[0]?.getClientRects();
	const b = pieces.at(-1)?.getClientRects();
	if (!a?.length || !b?.length) return null;
	return { first: a[0], last: b[b.length - 1] };
}

/** Whether the point is within a few pixels of the character the caret found. */
export function onRect(r: DOMRect | null, x: number, y: number, slack = 6): boolean {
	return (
		!!r &&
		x >= r.left - slack &&
		x <= r.right + slack &&
		y >= r.top - slack &&
		y <= r.bottom + slack
	);
}

/** Copy to the clipboard, where the browser refuses it on a plain address too. */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// `navigator.clipboard` is undefined on plain http, which a tailnet address can be.
		const area = document.createElement('textarea');
		area.value = text;
		area.style.position = 'fixed';
		area.style.opacity = '0';
		document.body.append(area);
		area.select();
		try {
			return document.execCommand('copy');
		} catch {
			return false;
		} finally {
			area.remove();
		}
	}
}
