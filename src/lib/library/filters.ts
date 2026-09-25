import { DEFAULT_MIN, minLabel, RATING_MAX } from './rating';

/**
 * The library's FILTER panel (Library Filters turn 3, card c68;
 * doc/FILTERS.md). Shelves are *where*, filters are *which*: every one
 * narrows whichever shelf is showing, and they combine. They live in the URL,
 * so each choice is a link and works without script:
 *
 *   ?min=8        rated 4+ (out of 10, written in five steps)
 *   ?rated=0      unrated
 *   ?fav=1|0      favourited, not favourited
 *   ?lang=ja      a language, as its two-letter code
 *   ?added=2026-08-01   added on or after that day
 *   ?dl=1|0       a chapter on disk, or none
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
	/** A two-letter code, lower case: `ja`. */
	lang: string | null;
	/** `YYYY-MM-DD`: added on or after the start of that day. */
	added: string | null;
	dl: 0 | 1 | null;
	hidden: boolean;
};

export const NO_FILTERS: Filters = {
	min: null,
	unrated: false,
	fav: null,
	lang: null,
	added: null,
	dl: null,
	hidden: false
};

/** Every parameter a filter owns: CLEAR drops exactly these. */
export const FILTER_PARAMS = ['min', 'rated', 'fav', 'lang', 'added', 'dl', 'hidden'] as const;

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
		lang: lang && /^[a-z]{2}$/.test(lang) ? lang : null,
		added: parseDay(params.get('added')),
		dl: bit(params.get('dl')),
		hidden: reveal && params.get('hidden') === '1'
	};
}

/** How many are on: the number in the FILTER cell. */
export function activeCount(f: Filters): number {
	return (
		Number(f.min !== null || f.unrated) +
		Number(f.fav !== null) +
		Number(f.lang !== null) +
		Number(f.added !== null) +
		Number(f.dl !== null) +
		Number(f.hidden)
	);
}

/** Written into URL parameters, in a fixed order so the same filters are the same URL. */
export function filterParams(f: Filters): [string, string][] {
	const out: [string, string][] = [];
	if (f.unrated) out.push(['rated', '0']);
	else if (f.min !== null) out.push(['min', String(f.min)]);
	if (f.fav !== null) out.push(['fav', String(f.fav)]);
	if (f.lang) out.push(['lang', f.lang]);
	if (f.added) out.push(['added', f.added]);
	if (f.dl !== null) out.push(['dl', String(f.dl)]);
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

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * The filters in words, for the section label ("02 — MANHWA · RATED 4+ ·
 * NOT FAV"), in the panel's order.
 */
export function filterWords(f: Filters): string[] {
	const words: string[] = [];
	if (f.min !== null) words.push(`RATED ${minLabel(f.min)}`);
	if (f.unrated) words.push('UNRATED');
	if (f.fav !== null) words.push(f.fav ? 'FAV' : 'NOT FAV');
	if (f.lang) words.push(f.lang.toUpperCase());
	if (f.added)
		words.push(`SINCE ${Number(f.added.slice(8))} ${MONTHS[Number(f.added.slice(5, 7)) - 1]}`);
	if (f.dl !== null) words.push(f.dl ? 'DOWNLOADED' : 'NOT DOWNLOADED');
	if (f.hidden) words.push('HIDDEN');
	return words;
}

/** The start of a day, local to where it's asked, in ms: what `?added=` compares with. */
export function dayStart(day: string): number {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(y, m - 1, d).getTime();
}

/**
 * The shelves turn 3 took off the tabs, as the filters that replace them, so
 * an old link or bookmark still lands on the same books.
 */
export function legacyShelf(shelf: string, params: URLSearchParams): URLSearchParams | null {
	const change: Record<string, [string, string]> = {
		favourites: ['fav', '1'],
		rated4: ['min', params.get('min') ?? '8'],
		downloaded: ['dl', '1']
	};
	const to = change[shelf];
	if (!to) return null;
	const next = new URLSearchParams(params);
	next.set('shelf', 'all');
	next.delete('min');
	next.set(to[0], to[1]);
	return next;
}

/** What a card has to say for the device to filter it (CACHED, a person's page). */
export type Filterable = {
	rating: number;
	favourite: boolean;
	hidden: boolean;
	addedAt: number;
	downloaded?: boolean;
	/** Two-letter codes, upper or lower case. */
	languages?: string[];
};

export function matches(item: Filterable, f: Filters): boolean {
	if (f.min !== null && item.rating < f.min) return false;
	if (f.unrated && item.rating !== 0) return false;
	if (f.fav !== null && item.favourite !== (f.fav === 1)) return false;
	if (f.lang && !(item.languages ?? []).some((l) => l.toLowerCase() === f.lang)) return false;
	if (f.added && item.addedAt < dayStart(f.added)) return false;
	if (f.dl !== null && !!item.downloaded !== (f.dl === 1)) return false;
	if (f.hidden && !item.hidden) return false;
	return true;
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

export function filterRows(f: Filters, languages: string[], reveal: boolean): Row[] {
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
