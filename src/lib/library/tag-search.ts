import { INCLUDE, writeFilters, type FilterField } from './browse-filters';
import { isPersonNamespace } from './books';

/**
 * A tag, searched for in a source (doc/BROWSE.md, "Arriving from a tag"; card
 * c313). The owner taps an author, an artist, a genre or a tag on a series or
 * a source's preview, and lands on that source's page finding it.
 *
 * A source's page takes everything from its URL: `q` searches the source,
 * and on `tab=filtered` the URL is the whole filter form (browse-filters.ts).
 * So a genre the source's own filters name is that filter included, every
 * other choice at the source's default; anything else, and every person
 * (most sources search title text only), is a search for the value.
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
 * The source page's parameters that find a tag: `tab=filtered` and the whole
 * form with the matching filter chosen, or `q=<value>` for a person, a value
 * the filters do not name, or a source with no schema.
 */
export function tagSearchParams(schema: FilterField[], tag: TagQuery): [string, string][] {
	const value = tag.value.trim();
	const path = isPersonNamespace(tag.namespace) ? null : matchFilter(schema, value);
	if (!path) return [['q', value]];
	return [['tab', 'filtered'], ...writeFilters(choose(schema, path))];
}

/**
 * `/browse/<source>` finding a tag, with `from` when the page it was tapped
 * on should be where the source page's back cell returns (the preview's own
 * address; `previewOrigin` checks it on arrival). `base` is the source page's
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
 * a source's preview, `/downloads/source/<id>` with its own query, which is
 * how the preview's own back still goes where it went before. Anything else
 * (an absolute URL, `//host`, a climb with `..`, another screen) is refused,
 * or ← would be an open redirect, as `sourceOrigin` refuses the same
 * (library/origin.ts).
 */
export function previewOrigin(raw: string | null | undefined): string {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '';
	let u: URL;
	try {
		u = new URL(raw, BASE);
	} catch {
		return '';
	}
	if (u.origin !== BASE) return '';
	if (!/^\/downloads\/source\/[^/]+$/.test(u.pathname)) return '';
	return u.pathname + u.search;
}

/**
 * The library's own key for a tag (`/?tag=`, server/library.ts `tagClause`):
 * `namespace:value`, or the bare value for a tag with no namespace, which the
 * series screen groups under `tag` (`tagGroups`).
 */
export const libraryTagKey = (tag: TagQuery) =>
	tag.namespace ? `${tag.namespace}:${tag.value}` : tag.value;
