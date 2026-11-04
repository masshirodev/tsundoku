import { INCLUDE, writeFilters, type FilterField } from './browse-filters';
import { isPersonNamespace } from './books';
import { people } from '../import/mihon-plan';

/**
 * A tag, searched for in a source (doc/BROWSE.md, "Arriving from a tag"; card
 * c313). The owner taps an author, an artist, a genre or a tag on a series or
 * a source's preview, and lands on that source's page finding it.
 *
 * A source's page takes everything from its URL: `q` searches the source,
 * and on `tab=filtered` the URL is the whole filter form (browse-filters.ts).
 * So a genre the source's own filters name is that filter included, every
 * other choice at the source's default. A person (an author, an artist, a
 * circle) is the source's own text filter named for them, filled in, where
 * the source has one (mangahere's Author and Artist, Weeb Central's "Author
 * (Case-sensitive)"; card c456), because most sources' plain search reads
 * titles only. Anything else is a search for the value.
 *
 * "No schema" is an empty one or a fetch that failed, never a kind: an
 * Aniyomi source answers filterSchemaAnime and an LNReader plugin its
 * filters, so every family is asked the same question (doc/KINDS.md).
 */

export type TagQuery = { namespace: string; value: string };

/** Case and spacing do not tell two names apart: "Slice of Life" is "slice  of life". */
const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** What can stand for a genre: a tri-state (included) or a checkbox (ticked). */
const pickable = (f: FilterField) => f.type === 'tristate' || f.type === 'checkbox';

/**
 * The filter path a value names in a schema, or null: the first tri-state or
 * checkbox whose name is the value's, at the top level or inside a group, in
 * the schema's own order. A tri-state wins over a checkbox of the same name,
 * because a tri-state is the source's genre list and a checkbox can be a
 * setting that happens to share the word.
 */
export function matchFilter(schema: FilterField[], value: string): number[] | null {
	const want = fold(value);
	if (want === '') return null;
	const hits: { path: number[]; tri: boolean }[] = [];
	schema.forEach((f, i) => {
		if (f.type === 'group')
			f.children?.forEach((c, j) => {
				if (pickable(c) && fold(c.name) === want)
					hits.push({ path: [i, j], tri: c.type === 'tristate' });
			});
		else if (pickable(f) && fold(f.name) === want)
			hits.push({ path: [i], tri: f.type === 'tristate' });
	});
	return (hits.find((h) => h.tri) ?? hits[0])?.path ?? null;
}

/** The schema with one choice made: the tri-state included, or the checkbox ticked. */
function choose(schema: FilterField[], path: number[]): FilterField[] {
	const on = (f: FilterField): FilterField => ({
		...f,
		state: f.type === 'tristate' ? INCLUDE : true
	});
	return schema.map((f, i) => {
		if (i !== path[0]) return f;
		if (path.length === 1) return on(f);
		return { ...f, children: f.children!.map((c, j) => (j === path[1] ? on(c) : c)) };
	});
}

/**
 * The text filter a person's namespace names, or null (card c456): the first
 * top-level text field whose name, with a trailing note in brackets aside, is
 * the namespace, folded as `matchFilter` folds ("Author (Case-sensitive)" is
 * an author's, "AUTHOR" too). A text inside a group is never drawn or sent
 * (browse-filters.ts), so it is never one. Only a person's namespace has one:
 * a genre is never a text.
 */
export function matchPersonFilter(schema: FilterField[], namespace: string): number | null {
	if (!isPersonNamespace(namespace)) return null;
	const want = fold(namespace);
	const i = schema.findIndex(
		(f) => f.type === 'text' && fold(f.name.replace(/\s*\([^)]*\)\s*$/, '')) === want
	);
	return i < 0 ? null : i;
}

/**
 * The source page's parameters that find a tag: `tab=filtered` and the whole
 * form with the matching filter chosen (a genre's tri-state or checkbox, a
 * person's text filled with the name), or `q=<value>` for a person the
 * filters have no field for, a value they do not name, or a source with no
 * schema.
 */
export function tagSearchParams(schema: FilterField[], tag: TagQuery): [string, string][] {
	const value = tag.value.trim();
	if (isPersonNamespace(tag.namespace)) {
		const at = value === '' ? null : matchPersonFilter(schema, tag.namespace);
		if (at === null) return [['q', value]];
		const filled = schema.map((f, i) => (i === at ? { ...f, state: value } : f));
		return [['tab', 'filtered'], ...writeFilters(filled)];
	}
	const path = matchFilter(schema, value);
	if (!path) return [['q', value]];
	return [['tab', 'filtered'], ...writeFilters(choose(schema, path))];
}

/** Two people are one when only case and spacing tell them apart: the preview's lines compare by this. */
export const personKey = (name: string) => fold(name);

/** A name's own tail, never a name of its own: "Tanaka, Jr." is one person. */
const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

/**
 * A source's author or artist string as the people in it (card c456): "A, B"
 * is two links, each searched on its own. The split is the importer's own
 * (`people`, import/mihon-plan.ts: commas, `/`, `;` and ` & `, and no `_` or
 * "unknown"), so a preview's names are the tags its series carries once
 * added, and the person pages they open. On top of it, a name met twice is
 * kept once (case and spacing aside), and a part that is only a generational
 * suffix ("Jr.", "Sr.", "II", "III", "IV") stays with the name before it, so
 * "Tanaka, Jr." is one person (the importer splits that one in two:
 * doc/handoff-notes/browse.md, wave 20, Gaps). A name written surname-first
 * ("Oda, Eiichiro") cannot be told from two people, and is two.
 */
export function splitPeople(raw: string | null | undefined): string[] {
	const out: string[] = [];
	for (const name of people(raw ?? '')) {
		if (SUFFIX.test(name) && out.length > 0) out[out.length - 1] += `, ${name}`;
		else out.push(name);
	}
	const seen = new Set<string>();
	return out.filter((n) => {
		const k = fold(n);
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

/**
 * `/browse/<source>` finding a tag, with `from` when the page it was tapped
 * on should be where the source page's back cell returns (the preview's own
 * address; `backOrigin` checks it on arrival). `base` is the source page's
 * resolved path.
 */
export function tagSearchHref(
	base: string,
	schema: FilterField[],
	tag: TagQuery,
	from: string | null = null
): string {
	const params = new URLSearchParams(tagSearchParams(schema, tag));
	if (from) params.set('from', from);
	return `${base}?${params}`;
}

const BASE = 'http://in.app';

/**
 * The address a source page's back cell may return to, or '' (card c313):
 * the screen a tag was tapped on, with its own query, so that screen's own
 * back still goes where it went before. That is a source's preview
 * (`/downloads/source/<id>`) or a series (`/series/<id>`). Anything else (an
 * absolute URL, `//host`, a climb with `..`, another screen) is refused, or ←
 * would be an open redirect, as `sourceOrigin` refuses the same
 * (library/origin.ts).
 */
export function backOrigin(raw: string | null | undefined): string {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '';
	let u: URL;
	try {
		u = new URL(raw, BASE);
	} catch {
		return '';
	}
	if (u.origin !== BASE) return '';
	if (!/^\/downloads\/source\/[^/]+$/.test(u.pathname) && !/^\/series\/\d+$/.test(u.pathname))
		return '';
	return u.pathname + u.search;
}

/**
 * `href` with `from=<origin>` added, for every way off a source page that
 * lands on the same source (its tabs, its search, FILTER's APPLY and RESET,
 * SETTINGS and back): each keeps the tag's origin, so ← still returns to it
 * (card c453). An empty origin (none, or one `backOrigin` refused) adds
 * nothing. `href` must not carry `from` already.
 */
export function keepOrigin(href: string, origin: string): string {
	if (!origin) return href;
	const hash = href.indexOf('#');
	const [path, frag] = hash < 0 ? [href, ''] : [href.slice(0, hash), href.slice(hash)];
	return `${path}${path.includes('?') ? '&' : '?'}from=${encodeURIComponent(origin)}${frag}`;
}

/** What ← says it returns to, for an origin `backOrigin` accepted. */
export const backOriginLabel = (origin: string): string =>
	origin.startsWith('/series/') ? 'Back to the series' : 'Back to the preview';

/**
 * The library's own key for a tag (`/?tag=`, server/library.ts `tagClause`):
 * `namespace:value`, or the bare value for a tag with no namespace, which the
 * series screen groups under `tag` (`tagGroups`).
 */
export const libraryTagKey = (tag: TagQuery) =>
	tag.namespace ? `${tag.namespace}:${tag.value}` : tag.value;

/**
 * How long a tag's link waits for the source's filters before it settles for a
 * search (`settleWithin`; the `tag-search` routes). The filters are a source
 * call that can take a site's browser check (`SLOW_MS`, engine/browse.ts), and
 * the owner is waiting on a tap: past this, a search for the value is the
 * better answer than nothing. A late answer is still kept (`keep`), so the
 * next tap on that source finds its filter.
 */
export const TAG_SCHEMA_WAIT_MS = 20_000;

/** A promise's answer, or `fallback` if it fails or has not answered within `ms`. */
export function settleWithin<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<T>((ok) => {
		timer = setTimeout(() => ok(fallback), ms);
	});
	return Promise.race([p.catch(() => fallback), late]).finally(() => clearTimeout(timer));
}

/**
 * A `tag-search` route's address for a tag (card c313, round 2): the server
 * waits for the source's filters there and answers 303 to `tagSearchHref`, so
 * the link is right from the first paint and never guesses before the schema
 * has settled. `base` is the route's resolved path; `from` is the screen the
 * tag was tapped on, which the route checks with `backOrigin`.
 */
export function tagRouteHref(base: string, tag: TagQuery, from: string): string {
	const params = new URLSearchParams({ ns: tag.namespace, value: tag.value });
	if (from) params.set('from', from);
	return `${base}?${params}`;
}

/** The tag a `tag-search` route was asked for, or null when it has no value. */
export function readTagRoute(url: URL): { tag: TagQuery; from: string } | null {
	const value = (url.searchParams.get('value') ?? '').trim();
	if (value === '') return null;
	return {
		tag: { namespace: (url.searchParams.get('ns') ?? '').trim().toLowerCase(), value },
		from: backOrigin(url.searchParams.get('from'))
	};
}

/** Each value once, in its first place, by exact string: "Action" and "action" both stay. */
export const distinct = (values: readonly string[]): string[] => [...new Set(values)];

/**
 * A preview's author and artist lines (card c456): each string split into its
 * people (`splitPeople`), the artist line only for names that are not authors
 * already (an author who draws is one link, not two), and no line with nobody
 * in it.
 */
export function previewPeople(
	author: string | null | undefined,
	artist: string | null | undefined
): { ns: 'author' | 'artist'; names: string[] }[] {
	const authors = splitPeople(author);
	const known = new Set(authors.map(personKey));
	const artists = splitPeople(artist).filter((n) => !known.has(personKey(n)));
	const lines: { ns: 'author' | 'artist'; names: string[] }[] = [
		{ ns: 'author', names: authors },
		{ ns: 'artist', names: artists }
	];
	return lines.filter((l) => l.names.length > 0);
}
