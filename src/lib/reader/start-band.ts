/**
 * The band at a chapter's start (c705; doc/TEXT-READER.md, "A chapter's
 * start"): when it names the chapter's table-of-contents title, and when it
 * leaves it out because the book already prints it.
 *
 * The handoff's kicker was left out because a title from the table of
 * contents over the book's own heading printed "Chapter 1: The Article"
 * twice. The band keeps that: the title is drawn only when the chapter's
 * first heading (or, with none, its first short line) says something else
 * once case, punctuation, whitespace and a leading chapter number are folded
 * away. A web-novel chapter from a source often has no heading at all, and
 * there the band is the only place its name is shown.
 *
 * Pure: the reader hands it each leading block's tag and text.
 */

/** A top-level block, as the reader sees it: its element's name and its text. */
export type LeadBlock = { tag: string; text: string };

/** A line no longer than this, with no heading before it, can be the chapter's title line. */
export const SHORT_LINE = 100;
/** How many blocks with text are looked at for a heading before giving up. */
export const LEAD_BLOCKS = 6;

const HEADING = /^h[1-6]$/;

/**
 * The line the book opens the chapter with, if it names it: the first
 * heading among the leading blocks, or else the first short paragraph. A
 * block without text (an illustration, a rule) is passed over; a long
 * paragraph is the text itself starting, and the search stops there.
 */
export function leadLine(blocks: readonly LeadBlock[]): string | null {
	return leadAt(blocks)?.text ?? null;
}

/**
 * Every line the book may print the chapter's title in. Usually that is
 * `leadLine` alone. A publisher's EPUB often prints the number and the title
 * in two blocks (`<h1>Chapter 1</h1><h2>The Article</h2>`, two short
 * paragraphs, `<h2>第一章</h2><h1>旅立ち</h1>`): when the lead is only a
 * chapter number, the next block with text is read as well, if it is a
 * heading or a short paragraph inside the `LEAD_BLOCKS`, and the two joined
 * are a candidate too. Empty where `leadLine` is null.
 */
export function leadLines(blocks: readonly LeadBlock[]): string[] {
	const lead = leadAt(blocks);
	if (!lead) return [];
	if (!numberOnly(lead.text)) return [lead.text];
	// The line after it must still be one of the leading blocks.
	if (lead.seen >= LEAD_BLOCKS) return [lead.text];
	for (let i = lead.index + 1; i < blocks.length; i++) {
		const text = clean(blocks[i].text);
		if (!text) continue;
		const tag = blocks[i].tag.toLowerCase();
		const line = HEADING.test(tag) || (tag === 'p' && text.length <= SHORT_LINE);
		return line ? [lead.text, text, `${lead.text} ${text}`] : [lead.text];
	}
	return [lead.text];
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The lead line, where it is, and how many blocks with text were counted up to it. */
function leadAt(
	blocks: readonly LeadBlock[]
): { text: string; index: number; seen: number } | null {
	let short: { text: string; index: number; seen: number } | null = null;
	let seen = 0;
	for (let i = 0; i < blocks.length; i++) {
		const text = clean(blocks[i].text);
		if (!text) continue;
		const tag = blocks[i].tag.toLowerCase();
		if (HEADING.test(tag)) return { text, index: i, seen: seen + 1 };
		if (tag === 'p') {
			if (text.length > SHORT_LINE) break;
			short ??= { text, index: i, seen: seen + 1 };
		}
		if (++seen >= LEAD_BLOCKS) break;
	}
	return short;
}

// "Chapter 212:", "Chap. 12 -", "Ch. 212 –", "CH IV.", with the number kept.
// A Roman numeral needs a space or a dot before it and a boundary after, so
// "Child" or "Chimera" is never read as "Ch." and a numeral.
const SPACED_PREFIX =
	/^(?:chapter|chap|ch)(?:\.?\s*(\d+)|(?:\.\s*|\s+)([ivxlcdm]+)\b)\s*[:：.\-–—·|]?\s*/u;
// 第212話, 第十二章, 第3回, 第4節: a Japanese or Chinese chapter's number.
const CJK_PREFIX =
	/^第\s*([0-9〇零一二三四五六七八九十百千]+)\s*[話话章回節节]\s*[:：.\-–—·|]?\s*/u;
// The same prefixes once punctuation and spaces are gone: what a folded
// string can still start with, so folding twice changes nothing.
const COMPACT_PREFIX = /^(?:chapter|chap|ch)(\d+)/u;
const COMPACT_CJK = /^第([0-9〇零一二三四五六七八九十百千]+)[話话章回節节]/u;
const NOISE = /[\p{P}\p{S}\s]+/gu;

/**
 * A title folded for comparison: NFKC (full-width digits are digits), lower
 * case, a leading chapter number taken off, then punctuation, symbols and
 * whitespace dropped. A title that is only its number ("Chapter 212",
 * "第212話", "212") folds to the number, so two of those still compare. It
 * holds on its own output: `foldTitle(foldTitle(s)) === foldTitle(s)`.
 */
export function foldTitle(s: string): string {
	const { rest, n } = splitTitle(s);
	return rest || (n ?? '');
}

/** A title's text once its leading chapter number is off, and that number. */
function splitTitle(s: string): { rest: string; n: string | null } {
	let t = s.normalize('NFKC').toLowerCase().trim();
	let n: string | null = null;
	for (let m = SPACED_PREFIX.exec(t) ?? CJK_PREFIX.exec(t); m;) {
		n = m[1] ?? m[2];
		t = t.slice(m[0].length);
		m = SPACED_PREFIX.exec(t) ?? CJK_PREFIX.exec(t);
	}
	t = t.replace(NOISE, '');
	for (let m = COMPACT_PREFIX.exec(t) ?? COMPACT_CJK.exec(t); m;) {
		n = m[1];
		t = t.slice(m[0].length);
		m = COMPACT_PREFIX.exec(t) ?? COMPACT_CJK.exec(t);
	}
	return { rest: t, n };
}

/** A line that says the chapter's number and nothing else: "Chapter 1", "第一章", "12". */
function numberOnly(s: string): boolean {
	const { rest, n } = splitTitle(s);
	return n !== null ? rest === '' : /^\d+$/.test(rest);
}

/**
 * Whether the band names the chapter: it has a title, and none of the
 * book's own opening lines (`leadLines`, or one `leadLine`) already says it.
 */
export function bandTitle(tocTitle: string, lead: string | readonly string[] | null): boolean {
	const own = foldTitle(tocTitle);
	if (!own) return false;
	const lines = lead === null ? [] : typeof lead === 'string' ? [lead] : lead;
	return lines.every((l) => foldTitle(l) !== own);
}
