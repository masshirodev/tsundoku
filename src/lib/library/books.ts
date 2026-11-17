/**
 * Books: the pure rules behind series of books, grouping and suggestions
 * (doc/BOOKS.md). Tested in tests/books-domain.spec.ts.
 */

import type { Kind, Rating } from './types.ts';
import { kindFacts } from './kinds.ts';

/** Namespaces that name a person, and so get a person page with a FAV. */
export const PERSON_NAMESPACES = ['artist', 'circle', 'author'] as const;
export type PersonNamespace = (typeof PERSON_NAMESPACES)[number];

export const isPersonNamespace = (ns: string): ns is PersonNamespace =>
	(PERSON_NAMESPACES as readonly string[]).includes(ns);

/** Words of a title, lowercased, punctuation dropped: the unit stems compare. */
export function titleWords(title: string): string[] {
	return title
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]+/gu, ' ')
		.split(/\s+/)
		.filter(Boolean);
}

/**
 * The words every title starts with, in the first title's own spelling and
 * case: the default series name ("Kaori Mama"). Falls back to the
 * first title when they share nothing. A trailing joining word ("on", "no",
 * "the") is dropped, since "Kaori Mama on" is not a name.
 */
const TRAILING_JOINERS = new Set([
	'on',
	'of',
	'the',
	'a',
	'an',
	'and',
	'no',
	'to',
	'wa',
	'ga',
	'de',
	'ni'
]);

export function sharedStart(titles: string[]): string {
	if (titles.length === 0) return '';
	const words = titles.map(titleWords);
	let n = 0;
	while (words.every((w) => n < w.length && w[n] === words[0][n])) n++;
	while (n > 0 && TRAILING_JOINERS.has(words[0][n - 1])) n--;
	if (n === 0) return titles[0];
	// Take the first n words from the first title as written.
	const raw = titles[0].normalize('NFKC').split(/\s+/).filter(Boolean);
	let taken = 0;
	const out: string[] = [];
	for (const token of raw) {
		if (taken >= n) break;
		out.push(token);
		if (titleWords(token).length > 0) taken += titleWords(token).length;
	}
	return out.join(' ').replace(/[\s:–—-]+$/u, '');
}

/**
 * The key two titles must share to be suggested together: their first two
 * words, and at least six letters of them, so "The Greatest" does not pair
 * every title that starts with an article and "Ai no" is too short to mean
 * anything. Null when a title is too short to suggest from.
 */
export function stemKey(title: string): string | null {
	const w = titleWords(title);
	if (w.length < 3) return null;
	const key = `${w[0]} ${w[1]}`;
	return key.replace(/\s/g, '').length >= 6 ? key : null;
}

export type Candidate = { seriesId: number; title: string };

/** A suggestion as the screen shows it: its set's key, and its books. */
export type Suggestion = {
	key: string;
	books: (Candidate & { hue: number; addedAt: number; cover: number | null })[];
};

/** Sorted, comma-joined ids: how a set of series is stored and compared. */
export const setKey = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b).join(',');

const parseSet = (key: string) => new Set(key.split(',').map(Number));

/**
 * Suggested series: singletons sharing a stem, two or more to a set, minus
 * any set that sits entirely inside one already dismissed. A later import
 * can still raise a new suggestion, but only one that includes itself.
 */
export function suggestionSets(candidates: Candidate[], dismissed: string[]): Candidate[][] {
	const by = new Map<string, Candidate[]>();
	for (const c of candidates) {
		const key = stemKey(c.title);
		if (!key) continue;
		by.set(key, [...(by.get(key) ?? []), c]);
	}
	const dismissedSets = dismissed.map(parseSet);
	const out: Candidate[][] = [];
	for (const group of by.values()) {
		if (group.length < 2) continue;
		const ids = group.map((c) => c.seriesId);
		const insideDismissed = dismissedSets.some((d) => ids.every((id) => d.has(id)));
		if (!insideDismissed) out.push([...group].sort((a, b) => a.seriesId - b.seriesId));
	}
	return out;
}

/** "Kaori Mama …": how a suggestion names itself. */
export function suggestionLabel(set: Candidate[]): string {
	const start = sharedStart(set.map((c) => c.title));
	return `"${start.toUpperCase()} …"`;
}

export type OrderMode = 'date' | 'title' | 'hand';

/**
 * What GROUP can make of a selection:
 * one series of books, one series of volumes, one show of a season's series,
 * or a Work. Only the answers the selection allows are offered, and a Work is
 * always one of them.
 *
 * The library passes what it already holds -- a selected item's kind and how
 * many books it has -- so no route writes the rule a second time.
 */
export type GroupAnswer = 'books' | 'volumes' | 'show' | 'work';

/** What `groupAnswers` reads off a selection: its kind and its books. */
export type AnswerItem = { kind: Kind; entryCount: number };

export function groupAnswers(items: AnswerItem[]): GroupAnswer[] {
	const out: GroupAnswer[] = [];
	// What GROUP binds a kind into is the registry's `grouping` (doc/KINDS.md):
	// one series of books is single books of a kind grouped into books, one
	// series of volumes is series of a kind grouped into volumes. Both refuse a
	// mixed selection, as grouping itself does.
	const binds = (i: AnswerItem) => kindFacts(i.kind).grouping;
	if (items.length > 0 && items.every((i) => binds(i) === 'books' && i.entryCount === 1))
		out.push('books');
	if (items.length > 0 && items.every((i) => binds(i) === 'volumes')) out.push('volumes');
	out.push('work');
	return out;
}

/** What ONE SHOW's own check reads beside the kind: the facts `Picked` holds. */
export type SeasonItem = AnswerItem & {
	/** The effective hidden flag the library drew. */
	hidden?: boolean;
	/** The Work the series is part of: its id, or its name when the page knows only that. */
	work?: number | string | null;
};

/**
 * Whether a selection can become one show: two or more series, every
 * one of them video, all hidden or all visible (`alike` refuses a mixed set),
 * and in at most one Work (a show is one series, so it can join only one). The
 * sheet's pages prepend `show` themselves -- the library's and `/search`'s,
 * from the facts they already hold -- so this stays a question about the
 * selection, not a fourth thing `groupAnswers` must learn about kinds it
 * cannot bind.
 */
export function isSeasonSet(items: SeasonItem[]): boolean {
	if (items.length < 2) return false;
	if (!items.every((i) => kindFacts(i.kind).medium === 'video')) return false;
	if (new Set(items.map((i) => i.hidden === true)).size > 1) return false;
	const works = new Set(items.map((i) => i.work).filter((w) => w !== null && w !== undefined));
	return works.size <= 1;
}

/** A book's place in the grouping sheet and the ORDER screen. */
export type Orderable = { id: number; title: string; addedAt: number };

export function orderBooks<T extends Orderable>(books: T[], mode: OrderMode): T[] {
	if (mode === 'hand') return books;
	const copy = [...books];
	if (mode === 'date') copy.sort((a, b) => a.addedAt - b.addedAt || a.id - b.id);
	else
		copy.sort((a, b) =>
			a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' })
		);
	return copy;
}

/** Move one item from one index to another, returning a new array. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
	const copy = [...items];
	if (from < 0 || from >= copy.length) return copy;
	const [item] = copy.splice(from, 1);
	copy.splice(Math.max(0, Math.min(copy.length, to)), 0, item);
	return copy;
}

/** Two-digit reading position on a book tile: 01, 02, …, 10, 11. */
export const bookNumber = (index: number) => String(index + 1).padStart(2, '0');

// ---- person and tag pages -------------------------------------------------------

export type TagItem = {
	key: string;
	seriesId: number;
	/** The series' cover version (doc/COVERS.md); null for a book in a series of books, which has its own (`coverPage`). */
	cover: number | null;
	/** A book in a series of books: the page chosen as its cover, for its own thumbnail. */
	coverPage: number | null;
	/** Set when this is a book inside a series of books. */
	entryId: number | null;
	title: string;
	kind: Kind;
	rating: Rating;
	favourite: boolean;
	hidden: boolean;
	/** Pages or entries, and how far: drives the meta line. */
	pages: number;
	read: boolean;
	progress: number | null;
	/** For a book in a series: the series and the book's place in it. */
	seriesTitle: string | null;
	position: number | null;
	total: number | null;
	/** A doujin singleton: something GROUP can take. */
	groupable: boolean;
	addedAt: number;
	entries: number;
	/** Its languages as codes (EN, JA): what the FILTER panel's LANGUAGE reads. */
	languages: string[];
	/** A chapter or the book on disk. */
	downloaded: boolean;
};

export type TagPage = {
	namespace: string;
	value: string;
	person: boolean;
	favourite: boolean;
	items: TagItem[];
	/** Series of books carrying the tag (the 02 — SERIES strip). */
	series: {
		id: number;
		title: string;
		books: number;
		read: number;
		favourite: boolean;
		cover: number | null;
	}[];
	/** For a circle: the artists on its books, most books first. */
	members: { value: string; count: number }[];
	counts: { books: number; series: number; single: number; read: number; favourite: number };
};
