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
 * away. A chapter number counts in figures, kanji or English words, and a
 * short blockquote can be a title line too (c741). A web-novel chapter from a
 * source often has no heading at all, and there the band is the only place
 * its name is shown.
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
 * heading among the leading blocks, or else the first short paragraph, or
 * else a short blockquote. A block without text (an illustration, a rule) is
 * passed over; a long paragraph is the text itself starting, and the search
 * stops there.
 */
export function leadLine(blocks: readonly LeadBlock[]): string | null {
	return leadAt(blocks)?.text ?? null;
}

/**
 * Every line the book may print the chapter's title in. Usually that is
 * `leadLine` alone, and a short blockquote before it (c741: an epigraph reads
 * as a different line, so it costs nothing to look). A publisher's EPUB often
 * prints the number and the title in two blocks (`<h1>Chapter 1</h1><h2>The
 * Article</h2>`, two short paragraphs, `<h2>第一章</h2><h1>旅立ち</h1>`): when
 * the lead is only a chapter number, the line next to it is read as well, and
 * the two joined are a candidate too. That is the short paragraph right
 * before it (c741: the title line can stand over the number) and the next
 * block with text, if it is a heading or a short line inside the
 * `LEAD_BLOCKS`. Empty where `leadLine` is null.
 */
export function leadLines(blocks: readonly LeadBlock[]): string[] {
	const lead = leadAt(blocks);
	if (!lead) return [];
	const lines = lead.quote === null ? [lead.text] : [lead.text, lead.quote];
	if (!numberOnly(lead.text)) return lines;
	const also = (line: string | null) => {
		if (line !== null) lines.push(line, `${lead.text} ${line}`);
	};
	// The line after it must still be one of the leading blocks.
	if (lead.seen < LEAD_BLOCKS) also(lineAfter(blocks, lead.index));
	also(lineBefore(blocks, lead.index));
	return lines;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A short block of this element can be a title line. */
const shortLine = (tag: string, text: string) =>
	(tag === 'p' || tag === 'blockquote') && text.length <= SHORT_LINE;

/** The next block with text after `index`, if it is a heading or a short line. */
function lineAfter(blocks: readonly LeadBlock[], index: number): string | null {
	for (let i = index + 1; i < blocks.length; i++) {
		const text = clean(blocks[i].text);
		if (!text) continue;
		const tag = blocks[i].tag.toLowerCase();
		return HEADING.test(tag) || shortLine(tag, text) ? text : null;
	}
	return null;
}

/** The nearest block with text before `index`, if it is a short paragraph. */
function lineBefore(blocks: readonly LeadBlock[], index: number): string | null {
	for (let i = index - 1; i >= 0; i--) {
		const text = clean(blocks[i].text);
		if (!text) continue;
		return blocks[i].tag.toLowerCase() === 'p' && text.length <= SHORT_LINE ? text : null;
	}
	return null;
}

type Lead = { text: string; index: number; seen: number; quote: string | null };

/** The lead line, where it is, how many blocks with text came up to it, and a short blockquote. */
function leadAt(blocks: readonly LeadBlock[]): Lead | null {
	let short: Omit<Lead, 'quote'> | null = null;
	let quote: Omit<Lead, 'quote'> | null = null;
	let seen = 0;
	for (let i = 0; i < blocks.length; i++) {
		const text = clean(blocks[i].text);
		if (!text) continue;
		const tag = blocks[i].tag.toLowerCase();
		if (HEADING.test(tag)) return { text, index: i, seen: seen + 1, quote: quote?.text ?? null };
		if (tag === 'p') {
			if (text.length > SHORT_LINE) break;
			short ??= { text, index: i, seen: seen + 1 };
		} else if (tag === 'blockquote' && shortLine(tag, text)) {
			quote ??= { text, index: i, seen: seen + 1 };
		}
		if (++seen >= LEAD_BLOCKS) break;
	}
	if (short) return { ...short, quote: quote?.text ?? null };
	return quote && { ...quote, quote: null };
}

/*
 * A chapter number in English words, 1 to 999: "One", "Twenty-One", "One
 * Hundred and Five". Only ever read after "Chapter" (SPACED_PREFIX), so a
 * title like "One Piece" or "Seven Seas" is never taken for a number.
 */
const WORD_VALUE: Record<string, number> = Object.fromEntries([
	...'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'
		.split(' ')
		.map((w, i) => [w, i + 1]),
	...'twenty thirty forty fifty sixty seventy eighty ninety'
		.split(' ')
		.map((w, i) => [w, (i + 2) * 10])
]);
const ONES = 'one|two|three|four|five|six|seven|eight|nine';
const UNDER_100 = `(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\\s](?:${ONES}))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|${ONES})`;
const SPELLED = `(?:(?:(?:${ONES})\\s+)?hundred(?:\\s+(?:and\\s+)?${UNDER_100})?|${UNDER_100})`;

/** Words the number pattern matched, in figures. */
function wordsToArabic(s: string): string {
	let n = 0;
	for (const w of s.split(/[-\s]+/)) {
		if (w === 'hundred') n = (n || 1) * 100;
		else if (w !== 'and') n += WORD_VALUE[w];
	}
	return String(n);
}

const KANJI_DIGIT: Record<string, number> = {
	〇: 0,
	零: 0,
	一: 1,
	二: 2,
	三: 3,
	四: 4,
	五: 5,
	六: 6,
	七: 7,
	八: 8,
	九: 9
};
const KANJI_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/**
 * A number the CJK prefix matched, in figures: 第一章 and 第1章 are one chapter.
 * Figures alone are left as written. Otherwise digits add up in place and a
 * unit takes what came before it, or 1: 二十一 is 21, 百二十 is 120, 二〇二 is 202.
 */
function kanjiToArabic(s: string): string {
	if (/^\d+$/.test(s)) return s;
	let total = 0;
	let digits = 0;
	for (const c of s) {
		const unit = KANJI_UNIT[c];
		if (unit) {
			total += (digits || 1) * unit;
			digits = 0;
		} else {
			digits = digits * 10 + (KANJI_DIGIT[c] ?? Number(c));
		}
	}
	return String(total + digits);
}

// "Chapter 212:", "Chap. 12 -", "Ch. 212 –", "CH IV.", "Chapter One:", with the
// number kept. A Roman numeral or a word needs a space or a dot before it and
// a boundary after, so "Child", "Chimera" or "Chapter Oneness" is never read
// as a chapter and a number.
const SPACED_PREFIX = new RegExp(
	String.raw`^(?:chapter|chap|ch)(?:\.?\s*(\d+)|(?:\.\s*|\s+)([ivxlcdm]+)\b|(?:\.\s*|\s+)(${SPELLED})\b)\s*[:：.\-–—·|]?\s*`,
	'u'
);
// 第212話, 第十二章, 第3回, 第4節: a Japanese or Chinese chapter's number.
const CJK_PREFIX =
	/^第\s*([0-9〇零一二三四五六七八九十百千]+)\s*[話话章回節节]\s*[:：.\-–—·|]?\s*/u;
// "1. ", "12) ": a table of contents numbering its chapters. It needs the dot
// or bracket and the space, so "1984" and "3.14 Pi" keep their figures.
const NUMBERED = /^(\d+)[.)]\s+/u;
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
	const numbered = NUMBERED.exec(t);
	if (numbered) {
		n = numbered[1];
		t = t.slice(numbered[0].length);
	}
	for (let m = SPACED_PREFIX.exec(t) ?? CJK_PREFIX.exec(t); m;) {
		n = m[3] ? wordsToArabic(m[3]) : (m[2] ?? kanjiToArabic(m[1]));
		t = t.slice(m[0].length);
		m = SPACED_PREFIX.exec(t) ?? CJK_PREFIX.exec(t);
	}
	t = t.replace(NOISE, '');
	for (let m = COMPACT_PREFIX.exec(t) ?? COMPACT_CJK.exec(t); m;) {
		n = kanjiToArabic(m[1]);
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
