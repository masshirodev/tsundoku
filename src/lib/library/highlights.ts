import { KINDS, kindFacts, type Kind } from './kinds.ts';
import { formatNumber } from './series.ts';

/**
 * Highlights (doc/HIGHLIGHTS.md; card c701, H1 of c444): the rules the
 * highlights page, the series screen's row, DELETE's and MOVE's lines and the
 * exports derive, pure, so they are tested without a database or a page.
 *
 * A highlight is a copy and a pointer. The copy (a quote and its paragraph, a
 * page, a clip) is its own and never changes; the pointer goes back to the
 * place while the place exists, and says where it came from when it doesn't.
 *
 * A highlight's kind is its own, `quote`, `page` or `clip`, and never a
 * series' kind: what a series is called comes from the registry
 * (`kindFacts`), asked with the series kind the snapshot kept.
 */

export const HIGHLIGHT_KINDS = ['quote', 'page', 'clip'] as const;
export type HighlightKind = (typeof HIGHLIGHT_KINDS)[number];

/** Three colours and no meanings (Main 02); quotes only. YELLOW is the default. */
export const COLOURS = ['yellow', 'orange', 'blue'] as const;
export type Colour = (typeof COLOURS)[number];

/**
 * The pointer's state (Main 05). `orphan_series`: the series is no longer in
 * the library; `orphan_entry`: the series is, the chapter or episode isn't;
 * `detached`: a quote its chapter's text no longer holds (H2 re-finds them).
 */
export type PointerState = 'ok' | 'orphan_series' | 'orphan_entry' | 'detached';

export type Highlight = {
	id: number;
	kind: HighlightKind;
	seriesId: number | null;
	entryId: number | null;
	/** The entry's number when it was last seen: a chapter's, or an episode's in its season. */
	number: number | null;
	season: number | null;
	/** A quote's place: its first block and offset, and where it ends. */
	block: number | null;
	offset: number | null;
	endBlock: number | null;
	endOffset: number | null;
	/** A page's index, 0-based, and the second page of a spread kept as BOTH. */
	page: number | null;
	pageEnd: number | null;
	/** A clip's in and out points, in seconds into the episode. */
	clipIn: number | null;
	clipOut: number | null;
	/** The snapshot: what the place was called when the highlight was made. */
	seriesTitle: string;
	seriesKind: string;
	entryLabel: string;
	entryTitle: string;
	volume: string;
	quote: string;
	paragraph: string;
	/** The paragraph before the quote's, shown dimmed for its context. */
	context: string;
	colour: Colour | null;
	note: string;
	madeAt: number;
	hidden: boolean;
	copyPath: string;
	stillPath: string;
	copyBytes: number;
	width: number | null;
	height: number | null;
	quality: string;
	/** The subtitle tracks a clip kept, and the one showing when it was made. */
	tracks: string[];
	track: string | null;
	state: PointerState;
	orphanedAt: number | null;
};

/** The series kind the snapshot kept, as the registry knows it; a novel's words if it doesn't. */
const knownKind = (k: string): Kind =>
	(KINDS as readonly string[]).includes(k) ? (k as Kind) : 'novel';
export const unitOf = (h: Pick<Highlight, 'seriesKind'>) => kindFacts(knownKind(h.seriesKind)).unit;

const KIND_WORD: Record<HighlightKind, string> = { quote: 'QUOTE', page: 'PAGE', clip: 'CLIP' };
const KIND_PLURAL: Record<HighlightKind, string> = {
	quote: 'QUOTES',
	page: 'PAGES',
	clip: 'CLIPS'
};
export const kindWord = (k: HighlightKind) => KIND_WORD[k];
export const kindPlural = (k: HighlightKind) => KIND_PLURAL[k];

/** 12:04, 1:32, 1:02:09: a clip's points and length as the player says them. */
export function clock(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const r = String(s % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** A clip's points as the handoff writes them: 12:04–13:36, the minutes padded. */
const point = (seconds: number) => {
	const c = clock(seconds);
	return c.length === 4 ? `0${c}` : c;
};

export const clipLength = (h: Pick<Highlight, 'clipIn' | 'clipOut'>) =>
	h.clipIn !== null && h.clipOut !== null ? clock(h.clipOut - h.clipIn) : '';

/** The entry as the label kept it, in capitals: CH. 3, EP. 7, VOL. 2. */
export function entryWord(h: Pick<Highlight, 'entryLabel' | 'number' | 'seriesKind'>): string {
	if (h.entryLabel.trim()) return h.entryLabel.trim().toUpperCase();
	if (h.number !== null) return `${unitOf(h).short}. ${formatNumber(h.number)}`;
	return unitOf(h).long;
}

/** Where in the entry: CH. 3 · ¶ 4, CH. 42 · P. 14, S1 · EP. 7 · 12:04–13:36. */
export function placeOf(h: Highlight, opts: { season?: boolean; points?: boolean } = {}): string {
	const parts: string[] = [];
	if (h.kind === 'clip' && h.season !== null && opts.season !== false) parts.push(`S${h.season}`);
	parts.push(entryWord(h));
	if (h.kind === 'quote' && h.block !== null) parts.push(`¶ ${h.block + 1}`);
	if (h.kind === 'page' && h.page !== null)
		parts.push(
			h.pageEnd !== null && h.pageEnd !== h.page
				? `P. ${h.page + 1}–${h.pageEnd + 1}`
				: `P. ${h.page + 1}`
		);
	if (h.kind === 'clip' && h.clipIn !== null && h.clipOut !== null && opts.points !== false)
		parts.push(`${point(h.clipIn)}–${point(h.clipOut)}`);
	return parts.join(' · ');
}

const MONTHS = [
	'JAN',
	'FEB',
	'MAR',
	'APR',
	'MAY',
	'JUN',
	'JUL',
	'AUG',
	'SEP',
	'OCT',
	'NOV',
	'DEC'
] as const;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** 5 NOV, or 5 NOV 2025 when it isn't this year. */
export function dayWord(at: number, now: number): string {
	const d = new Date(at);
	const year = d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`;
	return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

/** The day heading: TODAY, then the day itself. */
export function dayHeading(at: number, now: number): string {
	return dayKey(new Date(at)) === dayKey(new Date(now)) ? 'TODAY' : dayWord(at, now);
}

/** The orphan's and the detached one's tag (Main 02, ORPHANS AND DETACHED ARE SAID). */
export function stateTag(h: Highlight, short = false): string | null {
	if (h.state === 'orphan_series')
		return short ? 'NO LONGER IN THE LIBRARY' : 'FROM A SERIES NO LONGER IN THE LIBRARY';
	if (h.state === 'orphan_entry') {
		if (short) return 'NO LONGER IN THE SERIES';
		const unit = unitOf(h).long;
		return `FROM ${/^[AEIOU]/.test(unit) ? 'AN' : 'A'} ${unit} NO LONGER IN THE SERIES`;
	}
	if (h.state === 'detached') return 'DETACHED · THE CHAPTER CHANGED';
	return null;
}

/** Whether → goes anywhere: the place is there (a detached quote opens its chapter at the paragraph). */
export const hasWayBack = (h: Pick<Highlight, 'state' | 'entryId'>) =>
	(h.state === 'ok' || h.state === 'detached') && h.entryId !== null;

/**
 * → back to the place (Main 01, THE WAY BACK): a quote opens its chapter on
 * the page holding its first character (the text reader's own `?at=block.offset`),
 * a page its chapter on that page (`?p=`, 1-based), a clip its episode at its
 * in point (`?t=`, seconds, c734). A detached quote opens at the paragraph where
 * it was, drawing nothing. Null when the place is gone.
 */
export function wayBackHref(h: Highlight): string | null {
	if (!hasWayBack(h)) return null;
	if (h.kind === 'quote')
		return `/read/${h.entryId}?at=${h.block ?? 0}.${h.state === 'detached' ? 0 : (h.offset ?? 0)}`;
	if (h.kind === 'page') return `/read/${h.entryId}?p=${(h.page ?? 0) + 1}`;
	// Three places at most, and through Number, so the query never reads 1e-7.
	if (h.kind === 'clip' && h.clipIn !== null)
		return `/read/${h.entryId}?t=${Number(h.clipIn.toFixed(3))}`;
	return `/read/${h.entryId}`;
}

/**
 * The player's `?t=` (c734): the second an episode opens at, or null for
 * anything that isn't one, so a bad link opens at the saved place as a plain one
 * does. Plain decimal seconds only: `Number()` alone would take '', '1e9', '0x10'
 * and 'Infinity'. A second at or past a length that is known is no place in the
 * episode; an unknown length (`null` or 0, a catalogue that didn't say) is left
 * for the file's own, which the player checks when it arrives.
 */
export function startSecond(raw: string | null, durationS: number | null): number | null {
	if (raw === null || !/^\d+(\.\d+)?$/.test(raw)) return null;
	const t = Number(raw);
	if (!Number.isFinite(t)) return null;
	return durationS && t >= durationS ? null : t;
}

/** The way back's cell: CH. 3 →, CH. 42 · P. 14 →, EPISODE · 12:04 →. */
export function wayBackLabel(h: Highlight): string {
	if (h.kind === 'clip') return `${unitOf(h).long} · ${point(h.clipIn ?? 0)} →`;
	if (h.kind === 'page') return `${placeOf(h)} →`;
	return `${entryWord(h)} →`;
}

/** The list row's meta line: QUOTE · CH. 3 · ¶ 4 · ≡, or the orphan's DELETED 1 NOV. */
export function metaLine(h: Highlight, now: number, opts: { short?: boolean } = {}): string {
	const parts = [KIND_WORD[h.kind], placeOf(h, opts.short ? { season: false, points: false } : {})];
	if (h.state === 'orphan_series' && h.orphanedAt !== null && !opts.short)
		parts.push(`DELETED ${dayWord(h.orphanedAt, now)}`);
	if (h.note.trim()) parts.push('≡');
	return parts.join(' · ');
}

// ---- filters, search and counts -------------------------------------------------------

export type HighlightFilter = {
	kind: HighlightKind | null;
	series: number | null;
	/** NO WAY BACK: only the orphans. */
	lost: boolean;
	q: string;
};

export const NO_FILTER: HighlightFilter = { kind: null, series: null, lost: false, q: '' };

/** Where a search found it: the quote, the note, or the series' name (Page P5). */
export type Found = 'quote' | 'note' | 'series';

export function foundIn(h: Highlight, q: string): Found | null {
	const needle = q.trim().toLowerCase();
	if (needle === '') return null;
	if (h.kind === 'quote' && h.quote.toLowerCase().includes(needle)) return 'quote';
	if (h.note.toLowerCase().includes(needle)) return 'note';
	if (h.seriesTitle.toLowerCase().includes(needle)) return 'series';
	return null;
}

export const isLost = (h: Pick<Highlight, 'state'>) =>
	h.state === 'orphan_series' || h.state === 'orphan_entry';

export function filterHighlights(list: Highlight[], f: HighlightFilter): Highlight[] {
	return list.filter(
		(h) =>
			(f.kind === null || h.kind === f.kind) &&
			(f.series === null || h.seriesId === f.series) &&
			(!f.lost || isLost(h)) &&
			(f.q.trim() === '' || foundIn(h, f.q) !== null)
	);
}

export type KindCounts = { all: number; quote: number; page: number; clip: number; lost: number };

export function kindCounts(list: Highlight[]): KindCounts {
	const out: KindCounts = { all: list.length, quote: 0, page: 0, clip: 0, lost: 0 };
	for (const h of list) {
		out[h.kind] += 1;
		if (isLost(h)) out.lost += 1;
	}
	return out;
}

/** The series that have highlights, for SERIES ↓: by name, each once. */
export function seriesOf(list: Highlight[]): { id: number; title: string; n: number }[] {
	const by = new Map<number, { id: number; title: string; n: number }>();
	for (const h of list) {
		if (h.seriesId === null) continue;
		const s = by.get(h.seriesId);
		if (s) s.n += 1;
		else by.set(h.seriesId, { id: h.seriesId, title: h.seriesTitle, n: 1 });
	}
	return [...by.values()].sort((a, b) => a.title.localeCompare(b.title));
}

// ---- the two orders -------------------------------------------------------------------

/** Every highlight newest first, grouped by the day it was made (Page P1). */
export function byDay(list: Highlight[], now: number): { day: string; items: Highlight[] }[] {
	const sorted = [...list].sort((a, b) => b.madeAt - a.madeAt || b.id - a.id);
	const out: { day: string; items: Highlight[] }[] = [];
	for (const h of sorted) {
		const day = dayHeading(h.madeAt, now);
		const last = out.at(-1);
		if (last && last.day === day) last.items.push(h);
		else out.push({ day, items: [h] });
	}
	return out;
}

/** A place's own order inside its entry: the paragraph, the page, the in point. */
const within = (h: Highlight) =>
	h.kind === 'quote'
		? (h.block ?? 0) * 1e6 + (h.offset ?? 0)
		: h.kind === 'page'
			? (h.page ?? 0)
			: (h.clipIn ?? 0);

/** A series' highlights in reading order: by season and number, then where in the entry. */
export function inReadingOrder(list: Highlight[]): Highlight[] {
	return [...list].sort(
		(a, b) =>
			(a.season ?? 0) - (b.season ?? 0) ||
			(a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) ||
			within(a) - within(b) ||
			a.madeAt - b.madeAt ||
			a.id - b.id
	);
}

export type EntryGroup = {
	key: string;
	/** CH. 3 — THE THIRTEENTH LAMP, S1 · EP. 7 — FOG, CH. 50 · NO LONGER IN THE SERIES. */
	heading: string;
	/** The chapter or episode is gone: the group is dashed. */
	gone: boolean;
	items: Highlight[];
};

/** Reading order, grouped by chapter or by season and episode (Series S3–S5). */
export function byEntry(list: Highlight[]): EntryGroup[] {
	const out: EntryGroup[] = [];
	for (const h of inReadingOrder(list)) {
		const key = `${h.season ?? ''}:${h.number ?? ''}:${h.entryLabel}`;
		const last = out.at(-1);
		if (last && last.key === key) {
			last.items.push(h);
			continue;
		}
		const where = [h.season !== null ? `S${h.season}` : '', entryWord(h)]
			.filter(Boolean)
			.join(' · ');
		const gone = isLost(h);
		const heading = gone
			? `${where} · NO LONGER IN THE SERIES`
			: h.entryTitle.trim()
				? `${where} — ${h.entryTitle.trim().toUpperCase()}`
				: where;
		out.push({ key, heading, gone, items: [h] });
	}
	return out;
}

// ---- the lines other screens say ------------------------------------------------------

/**
 * The series screen's row (Series S1, S2): HIGHLIGHTS, then `14 · 3 NOTES`, a
 * manga's `6 PAGES · 1 NOTE`, an anime's `4 CLIPS`. One kind per series, so a
 * book's quotes need no word; a series holding more than one kind says the
 * bare total.
 */
export function seriesLine(list: Pick<Highlight, 'kind' | 'note'>[]): string {
	if (list.length === 0) return '';
	const kinds = new Set(list.map((h) => h.kind));
	const n = list.length;
	const only = kinds.size === 1 ? [...kinds][0] : null;
	const head =
		only === null || only === 'quote'
			? String(n)
			: `${n} ${n === 1 ? KIND_WORD[only] : KIND_PLURAL[only]}`;
	const notes = list.filter((h) => h.note.trim() !== '').length;
	return notes ? `${head} · ${notes} ${notes === 1 ? 'NOTE' : 'NOTES'}` : head;
}

const highlightsWord = (n: number) => (n === 1 ? 'HIGHLIGHT' : 'HIGHLIGHTS');

/** DELETE's row (Out X4): 14 HIGHLIGHTS ARE KEPT. */
export const keptLine = (n: number) => `${n} ${highlightsWord(n)} ${n === 1 ? 'IS' : 'ARE'} KEPT`;

/** A bulk delete's (Out X4): 31 HIGHLIGHTS IN 4 SERIES ARE KEPT. */
export const keptAcrossLine = (n: number, series: number) =>
	series <= 1 ? keptLine(n) : `${n} ${highlightsWord(n)} IN ${series} SERIES ARE KEPT`;

/** With DELETE THEM TOO on, the action names them: DELETE WITH 14 HIGHLIGHTS. */
export const deleteWithLine = (n: number) => `DELETE WITH ${n} ${highlightsWord(n)}`;

/**
 * MOVE's summary (Out X5): 6 FOLLOW · 1 LOSES ITS WAY BACK. `follow` are the
 * highlights whose entry stays (matched, or kept from the old source);
 * `lose` those whose entry the move takes away.
 */
export function moveLine(follow: number, lose: number): string {
	const parts = [`${follow} FOLLOW${follow === 1 ? 'S' : ''}`];
	if (lose) parts.push(`${lose} ${lose === 1 ? 'LOSES ITS' : 'LOSE THEIR'} WAY BACK`);
	return parts.join(' · ');
}

/** The MOVED band after a MOVE BACK took entries away: 2 HIGHLIGHTS LOST THEIR WAY BACK. */
export const lostLine = (n: number) =>
	`${n} ${highlightsWord(n)} ${n === 1 ? 'LOST ITS' : 'LOST THEIR'} WAY BACK`;

/** The disk line's sizes: 14 MB, 412 MB, 1.2 GB, 640 KB. */
export function sizeWord(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
	if (bytes > 0) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return '0 MB';
}

// ---- getting them out -----------------------------------------------------------------

/** A name a file can carry: lower case, dashes, nothing a disk refuses. */
export function slug(text: string): string {
	return (
		text
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'highlights'
	);
}

const two = (n: number) => String(n).padStart(2, '0');

/** SAVE IMAGE's and SAVE CLIP's names (Out X2, X3): kaze-no-tou-no-shoujo-ch42-p14.jpg. */
export function copyName(h: Highlight, ext: string): string {
	const unit = unitOf(h).short.toLowerCase();
	const num = h.number !== null ? formatNumber(h.number).replace('.', '_') : '';
	if (h.kind === 'page') return `${slug(h.seriesTitle)}-${unit}${num}-p${(h.page ?? 0) + 1}.${ext}`;
	const at = h.clipIn !== null ? clock(h.clipIn).replace(/:/g, '') : '';
	return `${slug(h.seriesTitle)}-${unit}${h.number !== null ? two(Number(num) || 0) : ''}-${at}.${ext}`;
}

export type MarkdownOptions = {
	/** COLOURS: LEAVE OUT, or AS A TAG. */
	colours: 'leave' | 'tag';
	now: number;
	/** The page's EXPORT →: grouped by series, a heading each. */
	bySeries?: boolean;
};

const quoteBlock = (text: string) =>
	text
		.split(/\r?\n/)
		.map((l) => `> ${l}`)
		.join('\n');

function entryHeading(h: Highlight): string {
	const where = [h.season !== null ? `S${h.season}` : '', h.entryLabel.trim() || entryWord(h)]
		.filter(Boolean)
		.join(' · ');
	return h.entryTitle.trim() ? `${where} — ${h.entryTitle.trim()}` : where;
}

function itemMarkdown(h: Highlight, opts: MarkdownOptions): string {
	const lines: string[] = [];
	if (h.kind === 'quote') {
		lines.push(quoteBlock(h.quote));
		if (opts.colours === 'tag' && h.colour) lines.push('', `#${h.colour}`);
	} else {
		lines.push(`*${KIND_WORD[h.kind].toLowerCase()}: ${placeOf(h)}*`);
	}
	if (h.note.trim()) lines.push('', h.note.trim());
	const tag = stateTag(h);
	if (h.state === 'detached')
		lines.push('', '*Detached: the chapter changed after this was kept.*');
	else if (tag) lines.push('', `*${tag[0]}${tag.slice(1).toLowerCase()}.*`);
	return lines.join('\n');
}

function seriesMarkdown(list: Highlight[], opts: MarkdownOptions, level: number): string[] {
	const out: string[] = [];
	const hashes = '#'.repeat(level);
	for (const g of byEntry(list)) {
		out.push(`${hashes} ${entryHeading(g.items[0])}`, '');
		for (const h of g.items) out.push(itemMarkdown(h, opts), '');
	}
	return out;
}

/**
 * A book's highlights as Markdown (Out X1): quotes as block quotes, notes as
 * plain paragraphs under them, one heading per chapter in reading order. A
 * page or a clip is a line saying where it is: the file is its own export.
 */
export function toMarkdown(list: Highlight[], title: string, opts: MarkdownOptions): string {
	const notes = list.filter((h) => h.note.trim() !== '').length;
	const d = new Date(opts.now);
	const head = [
		`# ${title}`,
		'',
		`${list.length} ${list.length === 1 ? 'highlight' : 'highlights'} · ${notes} ${notes === 1 ? 'note' : 'notes'} · from tsundoku, ${d.getDate()} ${MONTHS[d.getMonth()][0]}${MONTHS[d.getMonth()].slice(1).toLowerCase()} ${d.getFullYear()}`,
		''
	];
	if (!opts.bySeries)
		return [...head, ...seriesMarkdown(list, opts, 2)].join('\n').trimEnd() + '\n';
	const groups = new Map<string, Highlight[]>();
	for (const h of list) {
		const key = h.seriesId !== null ? `id:${h.seriesId}` : `title:${h.seriesTitle}`;
		groups.set(key, [...(groups.get(key) ?? []), h]);
	}
	const body = [...groups.values()]
		.sort((a, b) => a[0].seriesTitle.localeCompare(b[0].seriesTitle))
		.flatMap((g) => [`## ${g[0].seriesTitle}`, '', ...seriesMarkdown(g, opts, 3)]);
	return [...head, ...body].join('\n').trimEnd() + '\n';
}

// ---- a page kept from the image reader (H3, card c703) --------------------------------

/** A page kept, as the reader holds it (`pageHighlights` on the workstation). */
export type KeptPage = {
	id: number;
	/** 0-based; for a spread kept as BOTH, the first page in reading order. */
	page: number;
	/** BOTH: the spread's other page. */
	pageEnd: number | null;
	note: string;
	madeAt: number;
	bytes: number;
};

/** What the reader's HIGHLIGHT cell can be (Manga M1, M3, M7). */
export type CellState = 'idle' | 'kept' | 'keeping' | 'offline' | 'incognito';

/** The key one ask is known by while it is being made: the same page twice is one ask. */
export const keepKey = (entry: number, page: number, pageEnd: number | null) =>
	`${entry}:${page}:${pageEnd ?? ''}`;

/** The pages a kept highlight covers: one, or a spread's two. */
export const pagesOf = (k: Pick<KeptPage, 'page' | 'pageEnd'>) =>
	k.pageEnd === null ? [k.page] : [k.page, k.pageEnd];

/** What is kept on the screen's pages (a group is one page, or a spread's two). */
export function keptOn(kept: KeptPage[], group: number[]): KeptPage[] {
	return kept.filter((k) => pagesOf(k).some((p) => group.includes(p)));
}

/**
 * The scrubber's ticks (Manga M3): every page a highlight covers, once each,
 * in order, so a spread kept as BOTH ticks both of its pages.
 */
export function pageTicks(kept: KeptPage[]): number[] {
	return [...new Set(kept.flatMap(pagesOf))].sort((a, b) => a - b);
}

/**
 * The cell's state, in the order the handoff ranks them (Manga M7): incognito
 * makes none and says why; offline cannot reach the workstation that makes the
 * copy; a page being kept is dashed until it is; a kept page reads
 * ✓ HIGHLIGHTED; otherwise HIGHLIGHT.
 */
export function cellState(o: {
	kept: KeptPage[];
	group: number[];
	keeping: boolean;
	online: boolean;
	incognito: boolean;
}): CellState {
	if (o.incognito) return 'incognito';
	if (o.keeping) return 'keeping';
	if (keptOn(o.kept, o.group).length) return 'kept';
	if (!o.online) return 'offline';
	return 'idle';
}

/**
 * The cell's words. The strip names its page (Manga M4: HIGHLIGHT P. 23), so
 * a page half off the screen is never a guess; paged, the page is the one on
 * the screen.
 */
export function cellLabel(state: CellState, o: { strip: boolean; page: number }): string {
	if (state === 'incognito') return 'INCOGNITO';
	if (state === 'keeping') return 'KEEPING…';
	if (state === 'kept') return '✓ HIGHLIGHTED';
	if (state === 'offline') return '○ HIGHLIGHT';
	return o.strip ? `HIGHLIGHT P. ${o.page + 1}` : 'HIGHLIGHT';
}

export type SpreadChoice = {
	/** P. 14, or BOTH. */
	label: string;
	/** Where it is drawn: RIGHT, LEFT; AS ONE for BOTH. */
	where: string;
	page: number;
	pageEnd: number | null;
	/** Kept already: the row opens it rather than keeping it again. */
	keptId: number | null;
};

/**
 * A spread's HIGHLIGHT asks which (Manga M2): the two pages in reading order
 * (R→L: the right one first), then BOTH, kept as one image. `group` is the
 * spread's pages in reading order.
 */
export function spreadChoices(group: number[], rtl: boolean, kept: KeptPage[]): SpreadChoice[] {
	const [a, b] = [Math.min(...group), Math.max(...group)];
	const found = (page: number, pageEnd: number | null) =>
		kept.find((k) => k.page === page && k.pageEnd === pageEnd)?.id ?? null;
	return [
		{
			label: `P. ${a + 1}`,
			where: rtl ? 'RIGHT' : 'LEFT',
			page: a,
			pageEnd: null,
			keptId: found(a, null)
		},
		{
			label: `P. ${b + 1}`,
			where: rtl ? 'LEFT' : 'RIGHT',
			page: b,
			pageEnd: null,
			keptId: found(b, null)
		},
		{ label: 'BOTH', where: 'AS ONE', page: a, pageEnd: b, keptId: found(a, b) }
	];
}

/**
 * Which side of a page its gutter rule sits on (Manga M3): the outer side,
 * away from the spine. Alone, the right in R→L and the left in L→R; in a
 * spread, the side the page is drawn on.
 */
export function ruleSide(side: 'left' | 'right' | 'center', rtl: boolean): 'left' | 'right' {
	if (side !== 'center') return side;
	return rtl ? 'right' : 'left';
}

/** The page sheet's head (Manga M6): HIGHLIGHT · CH. 42 · P. 14, or P. 14–15 for BOTH. */
export function pageSheetHead(entryName: string, k: Pick<KeptPage, 'page' | 'pageEnd'>): string {
	const p =
		k.pageEnd === null
			? `P. ${k.page + 1}`
			: `P. ${Math.min(k.page, k.pageEnd) + 1}–${Math.max(k.page, k.pageEnd) + 1}`;
	return ['HIGHLIGHT', entryName.toUpperCase(), p].filter(Boolean).join(' · ');
}

/** The page sheet's line (Manga M6): MADE 4 NOV · A COPY ON THE WORKSTATION · 1 MB. */
export const pageSheetLine = (k: Pick<KeptPage, 'madeAt' | 'bytes'>, now: number) =>
	`MADE ${dayWord(k.madeAt, now)} · A COPY ON THE WORKSTATION · ${sizeWord(k.bytes)}`;

// ---- a passage kept from the text reader (H2, card c702) ------------------------------

/** How much of the chapter a quote keeps either side, for re-finding it (Main 05). */
export const QUOTE_CONTEXT = 32;

/** A run of a chapter's text: where it starts and where it ends (exclusive), block and offset. */
export type TextSpan = { block: number; offset: number; endBlock: number; endOffset: number };

/** A quote kept, as the text reader holds it (`quoteHighlights` on the workstation). */
export type KeptQuote = TextSpan & {
	id: number;
	quote: string;
	before: string;
	after: string;
	paragraph: string;
	context: string;
	colour: Colour;
	note: string;
	madeAt: number;
	state: 'ok' | 'detached';
};

/** What a chapter's opening found of a quote: a new place, or that its words are gone. */
export type AnchorChange =
	({ id: number; state: 'ok' } & TextSpan) | { id: number; state: 'detached' };

/** What is asked of the workstation for a quote. One row per [entry, span], as `quotes.ts` says. */
export type QuoteBody = TextSpan & {
	entry: number;
	quote: string;
	before: string;
	after: string;
	paragraph: string;
	context: string;
	colour: Colour;
	note: string;
};

/**
 * A chapter as the rules read it: each block's words with every run of white
 * space as one space and none at its ends, the blocks joined by a newline, and,
 * for each character of that, where in its block it came from. A block with no
 * words (an illustration, a rule) is not in it, so an illustration added or
 * taken away never moves a quote. Offsets are into the words the caller passed
 * (furigana already out: `src/lib/reader/text-marks.ts`).
 */
export type Flat = { text: string; blockAt: number[]; offsetAt: number[] };

const SPACE = /\s/;

export function flatten(blocks: readonly string[]): Flat {
	const chars: string[] = [];
	const blockAt: number[] = [];
	const offsetAt: number[] = [];
	blocks.forEach((words, b) => {
		const from = chars.length;
		let pending = -1;
		for (let i = 0; i < words.length; i++) {
			if (SPACE.test(words[i])) {
				if (pending < 0) pending = i;
				continue;
			}
			// One space where the run was, and none before the block's first word.
			if (pending >= 0 && chars.length > from) {
				chars.push(' ');
				blockAt.push(b);
				offsetAt.push(pending);
			}
			pending = -1;
			chars.push(words[i]);
			blockAt.push(b);
			offsetAt.push(i);
		}
		// The block's end, as the character that follows it.
		if (chars.length > from) {
			chars.push('\n');
			blockAt.push(b);
			offsetAt.push(words.length);
		}
	});
	// The last block's newline is only an end to stand on, and is left out of the text.
	if (chars.at(-1) === '\n') chars.pop();
	return { text: chars.join(''), blockAt, offsetAt };
}

/** Where (block, offset) falls in the flat text: the first character at or after it. */
export function flatIndex(flat: Flat, block: number, offset: number): number {
	let lo = 0;
	let hi = flat.blockAt.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		const before =
			flat.blockAt[mid] < block || (flat.blockAt[mid] === block && flat.offsetAt[mid] < offset);
		if (before) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** A character's first half and its second, which SQLite's UTF-8 could not keep apart. */
const high = (c: number) => c >= 0xd800 && c <= 0xdbff;
const low = (c: number) => c >= 0xdc00 && c <= 0xdfff;
/** An index that doesn't split a character: earlier, or later with `up`. */
function whole(text: string, i: number, up = false): number {
	if (i <= 0 || i >= text.length) return i;
	return high(text.charCodeAt(i - 1)) && low(text.charCodeAt(i)) ? i + (up ? 1 : -1) : i;
}

const posOf = (flat: Flat, i: number) => ({ block: flat.blockAt[i], offset: flat.offsetAt[i] });

/** The flat run [from, to) as a span: its end is just past its last character. */
function spanOf(flat: Flat, from: number, to: number): TextSpan {
	const start = posOf(flat, from);
	const last = posOf(flat, to - 1);
	return {
		block: start.block,
		offset: start.offset,
		endBlock: last.block,
		endOffset: last.offset + 1
	};
}

export type QuoteParts = {
	/** The span with white space at its ends taken off. */
	span: TextSpan;
	quote: string;
	before: string;
	after: string;
	/** The blocks the quote lies in, so the words can be found inside them. */
	paragraph: string;
	/** The block before. */
	context: string;
};

/**
 * The copy of a span (Main 05): the quote, QUOTE_CONTEXT characters either
 * side for re-finding it, its paragraph and the one before. Null when the span
 * holds no words. Pure white space at either end isn't part of a quote.
 */
export function quoteParts(flat: Flat, span: TextSpan): QuoteParts | null {
	let from = whole(flat.text, flatIndex(flat, span.block, span.offset));
	let to = whole(flat.text, flatIndex(flat, span.endBlock, span.endOffset), true);
	to = Math.min(to, flat.text.length);
	while (from < to && SPACE.test(flat.text[from])) from++;
	while (to > from && SPACE.test(flat.text[to - 1])) to--;
	if (from >= to) return null;
	const trimmed = spanOf(flat, from, to);
	// Blocks are lines of the flat text: a quote's are the lines it touches.
	const lineStart = flat.text.lastIndexOf('\n', from - 1) + 1;
	const next = flat.text.indexOf('\n', to);
	const lineEnd = next < 0 ? flat.text.length : next;
	const prevStart = lineStart > 0 ? flat.text.lastIndexOf('\n', lineStart - 2) + 1 : -1;
	return {
		span: trimmed,
		quote: flat.text.slice(from, to),
		before: flat.text.slice(whole(flat.text, Math.max(0, from - QUOTE_CONTEXT), true), from),
		after: flat.text.slice(to, whole(flat.text, Math.min(flat.text.length, to + QUOTE_CONTEXT))),
		paragraph: flat.text.slice(lineStart, lineEnd),
		context: prevStart < 0 ? '' : flat.text.slice(prevStart, lineStart - 1)
	};
}

export type Anchored = { state: 'ok'; span: TextSpan; moved: boolean } | { state: 'detached' };

type Findable = TextSpan & Pick<KeptQuote, 'quote' | 'before' | 'after'>;

/**
 * Where a kept quote is in the chapter as it stands now (Main 05, RE-FINDING A
 * QUOTE). Still at its place, words and both sides: nothing to do, and that is
 * asked first, since the same words with the same sides twice in a chapter are
 * only a problem once the place is lost. Otherwise the whole of it (its 32
 * characters either side, the quote) is searched for: one match re-anchors it,
 * none or two makes it DETACHED. Never fuzzy: every comparison is a character's.
 */
export function reanchor(flat: Flat, q: Findable): Anchored {
	const needle = q.before + q.quote + q.after;
	const at = flatIndex(flat, q.block, q.offset);
	const here = at - q.before.length;
	if (needle !== '' && here >= 0 && flat.text.startsWith(needle, here))
		return {
			state: 'ok',
			span: spanOf(flat, at, at + q.quote.length),
			moved: false
		};
	if (q.quote === '') return { state: 'detached' };
	const first = flat.text.indexOf(needle);
	if (first < 0 || flat.text.indexOf(needle, first + 1) >= 0) return { state: 'detached' };
	const from = first + q.before.length;
	return { state: 'ok', span: spanOf(flat, from, from + q.quote.length), moved: true };
}

/** Which of two spans' starts comes first, read in the chapter's order. */
export function compareAt(a: number, ao: number, b: number, bo: number): number {
	return a - b || ao - bo;
}

/** They share a character: touching end to start doesn't count. */
export function overlaps(a: TextSpan, b: TextSpan): boolean {
	return (
		compareAt(a.block, a.offset, b.endBlock, b.endOffset) < 0 &&
		compareAt(b.block, b.offset, a.endBlock, a.endOffset) < 0
	);
}

/** Inside `outer`, ends included. */
export function contains(outer: TextSpan, inner: TextSpan): boolean {
	return (
		compareAt(outer.block, outer.offset, inner.block, inner.offset) <= 0 &&
		compareAt(inner.endBlock, inner.endOffset, outer.endBlock, outer.endOffset) <= 0
	);
}

/** Both ways round: the span a start and an end make, whichever the reader dragged first. */
export function ordered(a: { block: number; offset: number }, b: typeof a): TextSpan {
	const [s, e] = compareAt(a.block, a.offset, b.block, b.offset) <= 0 ? [a, b] : [b, a];
	return { block: s.block, offset: s.offset, endBlock: e.block, endOffset: e.offset };
}

/**
 * A selection overlapping a highlight joins it (Main 02, THE BAR SITS OVER THE
 * SELECTION; c702): the one span covering them all, and the highlights it takes
 * in, the oldest first, so the older note is kept. A DETACHED quote is on no
 * words, so nothing overlaps it.
 */
export function joinSpans<T extends TextSpan & { state?: string; madeAt: number; id: number }>(
	selection: TextSpan,
	kept: readonly T[]
): { span: TextSpan; joined: T[] } {
	const joined: T[] = [];
	let span = selection;
	// Joining can reach a highlight the selection alone didn't.
	for (let grew = true; grew;) {
		grew = false;
		for (const k of kept) {
			if (k.state === 'detached' || joined.includes(k) || !overlaps(span, k)) continue;
			joined.push(k);
			grew = true;
			span = {
				...(compareAt(k.block, k.offset, span.block, span.offset) < 0
					? { block: k.block, offset: k.offset }
					: { block: span.block, offset: span.offset }),
				...(compareAt(k.endBlock, k.endOffset, span.endBlock, span.endOffset) > 0
					? { endBlock: k.endBlock, endOffset: k.endOffset }
					: { endBlock: span.endBlock, endOffset: span.endOffset })
			};
		}
	}
	joined.sort((a, b) => a.madeAt - b.madeAt || a.id - b.id);
	return { span, joined };
}

/** How long a note may be, here and at the door. */
export const NOTE_LIMIT = 4000;
const NOTE_BETWEEN = '\n\n';

/**
 * What a highlight's note is when a body arrives for a row that may have one
 * (c702): the queue's note written against a highlight it didn't know of, a
 * join's, a revive's. A reader's words are never dropped. Two different notes
 * are both kept, the row's first, a blank line between. A body that only
 * continues the row's note replaces it (typing went on), and a note the row
 * already holds is no change at all, so a resend writes nothing.
 */
export function mergeNotes(row: string, asked: string, limit = NOTE_LIMIT): string {
	const kept = row.trim();
	const more = asked.trim();
	if (
		more === '' ||
		`${NOTE_BETWEEN}${kept}${NOTE_BETWEEN}`.includes(`${NOTE_BETWEEN}${more}${NOTE_BETWEEN}`)
	)
		return row;
	if (kept === '' || more.startsWith(kept)) return more.slice(0, limit);
	return `${kept}${NOTE_BETWEEN}${more}`.slice(0, limit);
}

const WORD_FALLBACK = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

type Word = { start: number; end: number };

/**
 * A book's `dc:language` as a tag the platform takes. The field is whatever the
 * book's maker typed: `en_US` and `pt_BR` are common, and `Intl` throws on them.
 * None when it can't be read as a language at all.
 */
export function bookLocale(tag: string | null | undefined): string | undefined {
	const clean = (tag ?? '').trim().replaceAll('_', '-');
	if (clean === '') return undefined;
	try {
		return Intl.getCanonicalLocales(clean)[0];
	} catch {
		return undefined;
	}
}

function wordsOf(text: string, language: string | undefined): Word[] {
	const out: Word[] = [];
	if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
		const locale = bookLocale(language);
		const seg = new Intl.Segmenter(locale ? [locale, 'en'] : undefined, { granularity: 'word' });
		for (const s of seg.segment(text))
			if (s.isWordLike) out.push({ start: s.index, end: s.index + s.segment.length });
		return out;
	}
	for (const m of text.matchAll(WORD_FALLBACK))
		out.push({ start: m.index, end: m.index + m[0].length });
	return out;
}

/**
 * The word a long press selects (Novel N1): the one under `at`, or, on a space
 * or a mark, the nearest after it and then before it in that block. Null in a
 * block with no word.
 */
export function wordAround(text: string, at: number, locale?: string): Word | null {
	const words = wordsOf(text, locale);
	if (words.length === 0) return null;
	const pos = Math.max(0, Math.min(at, text.length - 1));
	const under = words.find((w) => pos >= w.start && pos < w.end);
	if (under) return under;
	return words.find((w) => w.start > pos) ?? words.at(-1) ?? null;
}

/** The sheet's and the panel's head (Novel N5): HIGHLIGHT · CH. 3 · ¶ 4. */
export const quoteSheetHead = (entryName: string, q: Pick<TextSpan, 'block'>) =>
	['HIGHLIGHT', entryName.toUpperCase(), `¶ ${q.block + 1}`].filter(Boolean).join(' · ');

/** The sheet's line (Novel D2): MADE 2 NOV · KEPT ON THE WORKSTATION. */
export const quoteSheetLine = (madeAt: number, now: number) =>
	`MADE ${dayWord(madeAt, now)} · KEPT ON THE WORKSTATION`;

/** How long the end handle waits at the page's end before the page turns (Main 02). */
export const HOLD_TURN_MS = 600;
/** The strip at the page's foot the end handle waits in (Novel N3). */
export const HOLD_STRIP = 64;
/** A pointer this near the window's edge has reached it (Novel D1). */
const EDGE = 24;

/**
 * The handle or the mouse is at the page's end: the bottom strip, or the edge
 * the next page lies past. Vertical Japanese reads down a column and on to the
 * next on the left, so its page ends at the bottom left.
 */
export function atPageEnd(
	p: { x: number; y: number },
	view: { w: number; h: number },
	o: { rtl: boolean; vertical: boolean }
): boolean {
	if (o.vertical) return p.x <= HOLD_STRIP || p.y >= view.h - EDGE;
	if (p.y >= view.h - HOLD_STRIP) return true;
	return o.rtl ? p.x <= EDGE : p.x >= view.w - EDGE;
}

/** How high the bar is, its gap over the first line, and the screen edge it keeps off (Novel N1). */
export const BAR_H = 48;
const BAR_GAP = 14;
const BAR_EDGE = 16;
/** The bar's top across a vertical book's top (Novel J3). */
const BAR_TOP_VERTICAL = 24;

/**
 * Where the bar goes (Main 02, THE BAR SITS OVER THE SELECTION): above the
 * first line selected, or below it where that would leave the screen; a
 * vertical book's across the top, over the first column selected. Pure, so a
 * bar is never off the screen for a selection at its edge.
 */
export function barPlace(
	first: { left: number; right: number; top: number; bottom: number },
	view: { w: number; h: number },
	barW: number,
	vertical: boolean
): { left: number; top: number } {
	const span = Math.max(0, view.w - barW - BAR_EDGE * 2);
	const want = vertical ? first.right - barW : first.left;
	const left = Math.round(BAR_EDGE + Math.max(0, Math.min(span, want - BAR_EDGE)));
	if (vertical) return { left, top: BAR_TOP_VERTICAL };
	const over = first.top - BAR_H - BAR_GAP;
	const top = over >= BAR_EDGE ? over : first.bottom + BAR_GAP;
	return { left, top: Math.round(Math.min(top, view.h - BAR_H - BAR_EDGE)) };
}
