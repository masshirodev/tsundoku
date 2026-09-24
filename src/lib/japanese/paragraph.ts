/**
 * The text reader's lookup (Index Japanese 2a; doc/JAPANESE.md): the
 * paragraph under a point, its text as read, and which character was pressed.
 * Furigana in the book's own ruby (`rt`, `rp`) isn't part of the text: the
 * tokenizer would read it as words.
 */

const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, figcaption, td, th';

/** A paragraph's text nodes, furigana left out. */
function textNodes(el: Element): Text[] {
	const out: Text[] = [];
	const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
		acceptNode: (n) =>
			n.parentElement?.closest('rt, rp') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
	});
	for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text);
	return out;
}

/** The text and caret under a point, from whichever API this browser has. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
	const d = document as Document & {
		caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
	};
	const p = d.caretPositionFromPoint?.(x, y);
	if (p) return { node: p.offsetNode, offset: p.offset };
	const r = d.caretRangeFromPoint?.(x, y);
	return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

export type Pressed = {
	el: HTMLElement;
	text: string;
	/** The character pressed, in `text`. */
	at: number;
	/** 1-based among the chapter's paragraphs: "¶ 3". */
	n: number;
};

/** The paragraph pressed at (x, y) inside `root`, or null off the text. */
export function paragraphAt(root: HTMLElement, x: number, y: number): Pressed | null {
	const caret = caretAt(x, y);
	if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
	const el = caret.node.parentElement?.closest<HTMLElement>(BLOCKS);
	if (!el || !root.contains(el) || caret.node.parentElement?.closest('rt, rp')) return null;
	let at = 0;
	let text = '';
	for (const t of textNodes(el)) {
		if (t === caret.node) at = text.length + Math.min(caret.offset, t.data.length);
		text += t.data;
	}
	// A press past the end of a line lands on the last character.
	at = Math.min(at, Math.max(0, text.length - 1));
	if (!text.trim()) return null;
	const n = [...root.querySelectorAll(BLOCKS)].indexOf(el) + 1;
	return { el, text, at, n };
}
