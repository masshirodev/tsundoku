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
