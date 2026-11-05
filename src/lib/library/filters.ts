import { KINDS, kindFacts } from './kinds.ts';
import { DEFAULT_MIN, minLabel, RATING_MAX } from './rating.ts';

/**
 * The library's FILTER panel (Library Filters turn 3, card c68;
 * doc/FILTERS.md). Shelves are *where*, filters are *which*: every one
 * narrows whichever shelf is showing, and they combine. They live in the URL,
 * so each choice is a link and works without script:
 *
 *   ?min=8        rated 4+ (out of 10, written in five steps)
 *   ?rated=0      unrated
 *   ?fav=1|0      favourited, not favourited
 *   ?kind=manga   one kind of the registry's (KINDS): on the library the KIND
 *                 band writes it, on a person's page FILTER's KIND row (c436)
 *   ?form=series|oneoff   FORM: a series (anything but a single book), or a
 *                 single book; the SERIES and ONE-OFF shelves until c436
 *   ?lang=ja      a language, as its two-letter code
 *   ?added=2026-08-01   added on or after that day
 *   ?dl=1|0       a chapter on disk, or none
 *   ?followed=1   followed: new chapters download on their own (doc/DOWNLOADING.md)
 *   ?progress=unread|read   never opened (not a page), or every chapter read
 *   ?hidden=1     hidden only; exists only while reveal is on
 *
 * Pure: the workstation turns these into SQL (src/lib/server/library.ts), and
 * the device filters the CACHED shelf and a person's page with `matches`.
 */

export type Filters = {
	/** Rated at least this, 1-10. Never with `unrated`. */
	min: number | null;
	unrated: boolean;
	fav: 0 | 1 | null;
	/** One kind, inside whatever shelf or collection shows (TO READ's manga). */
	kind: FilterKind | null;
	/** FORM (c436): a series, or a single book (a one-off); what SERIES and ONE-OFF were as shelves. */
	form: Form | null;
	/** A two-letter code, lower case: `ja`. */
	lang: string | null;
	/** `YYYY-MM-DD`: added on or after the start of that day. */
	added: string | null;
	dl: 0 | 1 | null;
	followed: boolean;
	/** Never opened, or all read. Begun-but-unfinished is an order, not a filter (sort=progress). */
	progress: Progress | null;
	hidden: boolean;
};

export type Progress = 'unread' | 'read';
/** FORM's two answers: `oneoff` is a single book (`ONE_OFF_SQL`, server/library.ts), `series` the rest. */
export type Form = 'series' | 'oneoff';
const FORMS: readonly Form[] = ['series', 'oneoff'];
const FORM_LABEL: Record<Form, string> = { series: 'SERIES', oneoff: 'ONE-OFF' };
/**
 * The kinds the FILTER panel offers, in the panel's order -- the registry's
 * order (doc/KINDS.md; card c301), which is also the order `kindsAmong` and
 * the library's counts use.
 */
export const FILTER_KINDS = KINDS;
export type FilterKind = (typeof FILTER_KINDS)[number];
/** The panel's word for a kind; DOUJINS and NOVELS are the filter's own plural, not `kindLabel`. */
const KIND_LABEL: Record<FilterKind, string> = {
	manga: 'MANGA',
	manhwa: 'MANHWA',
	doujin: 'DOUJINS',
	novel: 'NOVELS',
	anime: 'ANIME'
};
const PROGRESSES: readonly Progress[] = ['unread', 'read'];

export const NO_FILTERS: Filters = {
	min: null,
	unrated: false,
	fav: null,
	kind: null,
	form: null,
	lang: null,
	added: null,
	dl: null,
	followed: false,
	progress: null,
	hidden: false
};

/** Every parameter a filter owns: CLEAR drops exactly these. */
export const FILTER_PARAMS = [
	'min',
	'rated',
	'fav',
	'kind',
	'form',
	'lang',
	'added',
	'dl',
	'followed',
	'progress',
	'hidden'
] as const;

const bit = (raw: string | null): 0 | 1 | null => (raw === '1' ? 1 : raw === '0' ? 0 : null);

/** A real calendar day, or null: `2026-02-30` is refused, not rolled over. */
export function parseDay(raw: string | null): string | null {
	if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
	const [y, m, d] = raw.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
		? raw
		: null;
}

/**
 * The filters in a URL. Anything malformed is simply not a filter. HIDDEN
 * without reveal is dropped here, so no query ever asks for hidden series the
 * viewer may not see. UNRATED wins over a threshold: the two can't both hold.
 */
export function parseFilters(params: URLSearchParams, reveal: boolean): Filters {
	const unrated = params.get('rated') === '0';
	const n = Number(params.get('min'));
	const min = !unrated && Number.isInteger(n) && n >= 1 && n <= RATING_MAX ? n : null;
	const lang = params.get('lang')?.toLowerCase() ?? null;
	return {
		min,
		unrated,
		fav: bit(params.get('fav')),
		kind: FILTER_KINDS.find((k) => k === params.get('kind')) ?? null,
		form: FORMS.find((x) => x === params.get('form')) ?? null,
		lang: lang && /^[a-z]{2}$/.test(lang) ? lang : null,
		added: parseDay(params.get('added')),
		dl: bit(params.get('dl')),
		followed: params.get('followed') === '1',
		progress: PROGRESSES.find((p) => p === params.get('progress')) ?? null,
		hidden: reveal && params.get('hidden') === '1'
	};
}

/**
 * How many are on: the number in the FILTER cell, and what makes a tab say
 * "44 OF 188". `countKind` false is the library's FILTER badge (c436): the
 * KIND band says the kind itself, so the badge counts only what FILTER holds.
 */
export function activeCount(f: Filters, countKind = true): number {
	return (
		Number(f.min !== null || f.unrated) +
		Number(f.fav !== null) +
		Number(countKind && f.kind !== null) +
		Number(f.form !== null) +
		Number(f.lang !== null) +
		Number(f.added !== null) +
		Number(f.dl !== null) +
		Number(f.followed) +
		Number(f.progress !== null) +
		Number(f.hidden)
	);
}

/** Written into URL parameters, in a fixed order so the same filters are the same URL. */
export function filterParams(f: Filters): [string, string][] {
	const out: [string, string][] = [];
	if (f.unrated) out.push(['rated', '0']);
	else if (f.min !== null) out.push(['min', String(f.min)]);
	if (f.fav !== null) out.push(['fav', String(f.fav)]);
	if (f.kind) out.push(['kind', f.kind]);
	if (f.form) out.push(['form', f.form]);
	if (f.lang) out.push(['lang', f.lang]);
	if (f.added) out.push(['added', f.added]);
	if (f.dl !== null) out.push(['dl', String(f.dl)]);
	if (f.followed) out.push(['followed', '1']);
	if (f.progress) out.push(['progress', f.progress]);
	if (f.hidden) out.push(['hidden', '1']);
	return out;
}

/**
 * `params` with its filters replaced by `f`, everything else (shelf, sort,
 * seed, tag) kept. What every option in the panel links to.
 */
export function withFilters(params: URLSearchParams, f: Filters): URLSearchParams {
	const next = new URLSearchParams(params);
	for (const k of FILTER_PARAMS) next.delete(k);
	for (const [k, v] of filterParams(f)) next.set(k, v);
	return next;
}

const PROGRESS_LABEL: Record<Progress, string> = { unread: 'UNREAD', read: 'READ' };

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * The filters in words, for the section label ("02 — ALL · MANHWA · RATED 4+ ·
 * NOT FAV"): the kind first, then the rest in the panel's order.
 */
export function filterWords(f: Filters): string[] {
	const words: string[] = [];
	// The kind first, as the shelf it replaced read (Kinds Calls: "02 — TO READ · ANIME · RATED 4+").
	if (f.kind) words.push(KIND_LABEL[f.kind]);
	if (f.min !== null) words.push(`RATED ${minLabel(f.min)}`);
	if (f.unrated) words.push('UNRATED');
	if (f.fav !== null) words.push(f.fav ? 'FAV' : 'NOT FAV');
	if (f.form) words.push(FORM_LABEL[f.form]);
	if (f.lang) words.push(f.lang.toUpperCase());
	if (f.added)
		words.push(`SINCE ${Number(f.added.slice(8))} ${MONTHS[Number(f.added.slice(5, 7)) - 1]}`);
	if (f.dl !== null) words.push(f.dl ? 'DOWNLOADED' : 'NOT DOWNLOADED');
	if (f.followed) words.push('FOLLOWED');
	if (f.progress) words.push(PROGRESS_LABEL[f.progress]);
	if (f.hidden) words.push('HIDDEN');
	return words;
}

/** The start of a day, local to where it's asked, in ms: what `?added=` compares with. */
export function dayStart(day: string): number {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(y, m - 1, d).getTime();
}

/**
 * The shelves that became filters, as the filters that replace them, so an
 * old link or bookmark still lands on the same books: FAVOURITES, RATED and
 * DOWNLOADED (turn 3), and since c436 SERIES and ONE-OFF (FORM) and each
 * kind's shelf, `k:<kind>` (the KIND band's `?kind=`). A kind is any the
 * registry names (KINDS), never a list of four; `k:doujin`, never a shelf,
 * lands on doujins too. Every other parameter is kept, a filter the link
 * already carried included, unless the shelf's own filter replaces it.
 */
export function legacyShelf(shelf: string, params: URLSearchParams): URLSearchParams | null {
	const change: Record<string, [string, string]> = {
		favourites: ['fav', '1'],
		rated4: ['min', params.get('min') ?? '8'],
		downloaded: ['dl', '1'],
		series: ['form', 'series'],
		oneoff: ['form', 'oneoff']
	};
	const kind = shelf.startsWith('k:') ? FILTER_KINDS.find((k) => `k:${k}` === shelf) : undefined;
	const to = kind ? (['kind', kind] as [string, string]) : change[shelf];
	if (!to) return null;
	const next = new URLSearchParams(params);
	next.set('shelf', 'all');
	next.set(to[0], to[1]);
	return next;
}

/**
 * One cell of the library's KIND band (c436; doc/LIBRARY.md, "The KIND
 * band"): ALL (`kind` null) or one kind, with what it counts on this shelf.
 */
export type KindCell = { kind: FilterKind | null; n: number; on: boolean; zero: boolean };

/**
 * The KIND band's cells: ALL, then each kind in the registry's order that is
 * on this shelf (`counts`, every filter but KIND applied). A kind with none
 * here is gone, except the chosen one, which stays, drawn at 0 and dimmed,
 * so moving to a shelf without it says so rather than losing the choice.
 * With one kind or none to tell apart, ALL alone: nothing to choose between.
 */
export function kindCells(
	counts: Partial<Record<FilterKind, number>>,
	all: number,
	chosen: FilterKind | null
): KindCell[] {
	const present = FILTER_KINDS.filter((k) => (counts[k] ?? 0) > 0);
	const cells: KindCell[] = [{ kind: null, n: all, on: chosen === null, zero: false }];
	for (const k of FILTER_KINDS) {
		const n = counts[k] ?? 0;
		const shown = k === chosen || (present.length > 1 && n > 0);
		if (shown) cells.push({ kind: k, n, on: k === chosen, zero: n === 0 });
	}
	return cells;
}

/** What a card has to say for the device to filter it (CACHED, a person's page). */
export type Filterable = {
	rating: number;
	favourite: boolean;
	hidden: boolean;
	addedAt: number;
	downloaded?: boolean;
	followed?: boolean;
	/** KIND needs it; a card without one isn't asked. */
	kind?: string;
	/** Two-letter codes, upper or lower case. */
	languages?: string[];
	/** READING needs these; a card without them (a person's page) isn't asked. */
	entryCount?: number;
	readCount?: number;
	/** An entry has been opened, read to the end or not. */
	opened?: boolean;
};

/**
 * Where a card's reading stands. UNREAD (`?progress=unread`) is never opened
 * and nothing read; one page opened is begun. Begun and not all read is
 * `reading`, so a finished series that gained a chapter is reading again;
 * begun and all read is READ (`?progress=read`). The same rule as
 * PROGRESS_SQL and the PROGRESS sort's tiers in src/lib/server/library.ts.
 */
export type ReadingState = 'unread' | 'reading' | 'finished';

export function progressOf(item: {
	entryCount: number;
	readCount: number;
	opened?: boolean;
}): ReadingState {
	if (!item.opened && item.readCount === 0) return 'unread';
	return item.readCount < item.entryCount ? 'reading' : 'finished';
}

/**
 * A single book, ONE-OFF's rule (`ONE_OFF_SQL`, server/library.ts) on the
 * device: a kind GROUP binds into a series of books (doc/KINDS.md,
 * `grouping`), holding one entry or none. Undefined where the card can't say.
 */
export function isOneOff(item: { kind?: string; entryCount?: number }): boolean | undefined {
	const kind = FILTER_KINDS.find((k) => k === item.kind);
	if (!kind || item.entryCount === undefined) return undefined;
	return kindFacts(kind).grouping === 'books' && item.entryCount <= 1;
}

export function matches(item: Filterable, f: Filters): boolean {
	if (f.min !== null && item.rating < f.min) return false;
	if (f.unrated && item.rating !== 0) return false;
	if (f.fav !== null && item.favourite !== (f.fav === 1)) return false;
	if (f.kind && item.kind !== undefined && item.kind !== f.kind) return false;
	if (f.form) {
		const one = isOneOff(item);
		if (one !== undefined && one !== (f.form === 'oneoff')) return false;
	}
	if (f.lang && !(item.languages ?? []).some((l) => l.toLowerCase() === f.lang)) return false;
	if (f.added && item.addedAt < dayStart(f.added)) return false;
	if (f.dl !== null && !!item.downloaded !== (f.dl === 1)) return false;
	if (f.followed && !item.followed) return false;
	if (
		f.progress &&
		item.readCount !== undefined &&
		item.entryCount !== undefined &&
		progressOf({ entryCount: item.entryCount, readCount: item.readCount, opened: item.opened }) !==
			(f.progress === 'read' ? 'finished' : f.progress)
	)
		return false;
	if (f.hidden && !item.hidden) return false;
	return true;
}

/** The kinds among `items`, in KIND's order: what KIND offers on the device. */
export function kindsAmong(items: Filterable[]): FilterKind[] {
	const seen = new Set(items.map((i) => i.kind));
	return FILTER_KINDS.filter((k) => seen.has(k));
}

/** The languages among `items`, as codes, in a stable order: what LANGUAGE offers. */
export function languagesAmong(items: Filterable[]): string[] {
	const seen = new Set<string>();
	for (const i of items) for (const l of i.languages ?? []) seen.add(l.toLowerCase());
	return [...seen].sort();
}

/**
 * The panel's choices, each as its filters: the rows the FILTER panel draws.
 * LANGUAGE only when `languages` has any, HIDDEN only while reveal is on.
 */
export type Choice = { label: string; on: boolean; to: Filters };
export type Row = { key: string; label: string; choices: Choice[] };

export function filterRows(
	f: Filters,
	languages: string[],
	reveal: boolean,
	/** Something is followed: FOLLOWED is offered, as LANGUAGE is when there are languages. */
	following = false,
	/** READING is offered: off where cards don't know their progress (a person's page). */
	reading = true,
	/** The kinds on the shelf: KIND is offered only where it can tell two apart. */
	kinds: readonly FilterKind[] = [],
	/**
	 * Which rows a screen has (c436): the library draws KIND as its band, so
	 * its panel has no KIND row and has FORM; a person's page keeps KIND and
	 * has no FORM, as before.
	 */
	rowsOn: { kind?: boolean; form?: boolean } = {}
): Row[] {
	const { kind: kindRow = true, form: formRow = false } = rowsOn;
	const set = (patch: Partial<Filters>): Filters => ({ ...f, ...patch });
	const rows: Row[] = [
		{
			key: 'rating',
			label: 'RATING',
			choices: [
				{
					label: 'ANY',
					on: f.min === null && !f.unrated,
					to: set({ min: null, unrated: false })
				},
				{ label: 'UNRATED', on: f.unrated, to: set({ min: null, unrated: true }) },
				{
					label: 'AT LEAST',
					on: f.min !== null,
					to: set({ min: f.min ?? DEFAULT_MIN, unrated: false })
				}
			]
		},
		{
			key: 'fav',
			label: 'FAV',
			choices: [
				{ label: 'ANY', on: f.fav === null, to: set({ fav: null }) },
				{ label: 'FAV', on: f.fav === 1, to: set({ fav: 1 }) },
				{ label: 'NOT FAV', on: f.fav === 0, to: set({ fav: 0 }) }
			]
		}
	];
	if (formRow)
		rows.push({
			key: 'form',
			label: 'FORM',
			choices: [
				{ label: 'ANY', on: f.form === null, to: set({ form: null }) },
				...FORMS.map((x) => ({ label: FORM_LABEL[x], on: f.form === x, to: set({ form: x }) }))
			]
		});
	if (kindRow && (kinds.length > 1 || f.kind))
		rows.push({
			key: 'kind',
			label: 'KIND',
			choices: [
				{ label: 'ANY', on: f.kind === null, to: set({ kind: null }) },
				...kinds.map((k) => ({ label: KIND_LABEL[k], on: f.kind === k, to: set({ kind: k }) }))
			]
		});
	if (languages.length)
		rows.push({
			key: 'lang',
			label: 'LANGUAGE',
			choices: [
				{ label: 'ANY', on: f.lang === null, to: set({ lang: null }) },
				...languages.map((l) => ({
					label: l.toUpperCase(),
					on: f.lang === l,
					to: set({ lang: l })
				}))
			]
		});
	rows.push({
		key: 'added',
		label: 'DATE ADDED',
		choices: [{ label: 'ANY', on: f.added === null, to: set({ added: null }) }]
	});
	rows.push({
		key: 'dl',
		label: 'DOWNLOADED',
		choices: [
			{ label: 'ANY', on: f.dl === null, to: set({ dl: null }) },
			{ label: 'YES', on: f.dl === 1, to: set({ dl: 1 }) },
			{ label: 'NO', on: f.dl === 0, to: set({ dl: 0 }) }
		]
	});
	// FOLLOW is a filter option, not a badge: the cover's four corners are taken (Download States 1d).
	if (following || f.followed)
		rows.push({
			key: 'followed',
			label: 'FOLLOWED',
			choices: [
				{ label: 'ANY', on: !f.followed, to: set({ followed: false }) },
				{ label: 'ONLY', on: f.followed, to: set({ followed: true }) }
			]
		});
	if (reading || f.progress)
		rows.push({
			key: 'progress',
			label: 'READING',
			choices: [
				{ label: 'ANY', on: f.progress === null, to: set({ progress: null }) },
				{ label: 'UNREAD', on: f.progress === 'unread', to: set({ progress: 'unread' }) },
				{ label: 'READ', on: f.progress === 'read', to: set({ progress: 'read' }) }
			]
		});
	if (reveal)
		rows.push({
			key: 'hidden',
			label: '● HIDDEN',
			choices: [
				{ label: 'ANY', on: !f.hidden, to: set({ hidden: false }) },
				{ label: 'ONLY', on: f.hidden, to: set({ hidden: true }) }
			]
		});
	return rows;
}
