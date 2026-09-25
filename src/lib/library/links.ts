import { bookCoverVersion } from './cover';
import { resolve } from '$app/paths';

/**
 * URLs for the library screen. The shelf, tag and sort are query parameters on
 * `/`, so every view has an address and the back button walks between them.
 * Every one goes through resolve(), so a base path would carry.
 */
export function shelfHref(current: URL, shelf: string): string {
	const params = new URLSearchParams();
	// Always named, ALL included: with an import band up, a library with no
	// shelf in its URL opens on NEW, so ALL has to say it's ALL.
	params.set('shelf', shelf);
	const sort = current.searchParams.get('sort');
	if (sort) params.set('sort', sort);
	// The same shuffle on another shelf.
	const seed = current.searchParams.get('seed');
	if (sort === 'random' && seed) params.set('seed', seed);
	// RATED's threshold, kept only while staying on RATED.
	const min = current.searchParams.get('min');
	if (shelf === 'rated4' && min) params.set('min', min);
	return library(params);
}

/** RATED at another threshold (c67, turn 2): a link, so it works without script. */
export function minHref(current: URL, min: number): string {
	const params = new URLSearchParams(current.searchParams);
	params.set('shelf', 'rated4');
	params.set('min', String(min));
	return library(params);
}

export function tagHref(tagKey: string): string {
	return library(new URLSearchParams({ tag: tagKey }));
}

/**
 * The screen showing, with one parameter set or removed. The screen's own
 * path, whichever it is: the series screen opens a book with `?book=` this
 * way, and building it on the library's path sent that tap home.
 */
export function withParam(current: URL, key: string, value: string | null): string {
	const params = new URLSearchParams(current.searchParams);
	if (value === null) params.delete(key);
	else params.set(key, value);
	const query = params.toString();
	return query ? `${current.pathname}?${query}` : current.pathname;
}

/**
 * A series, remembering where it was opened from so its back cell can say so:
 * a shelf key, `continue`, or nothing for the whole library.
 */
export function seriesHref(
	id: number,
	from: string | null = null,
	extra: Record<string, string> = {}
): string {
	const params = new URLSearchParams(extra);
	if (from && from !== 'all') params.set('from', from);
	const base = resolve('/series/[id]', { id: String(id) });
	const search = params.toString();
	return search === '' ? base : `${base}?${search}`;
}

/**
 * The reader on an entry: at a page (1-based) when given, otherwise where
 * the entry was left (doc/READER.md).
 */
export function readHref(entryId: number, page?: number): string {
	const base = resolve('/read/[entry]', { entry: String(entryId) });
	return page ? `${base}?p=${page}` : base;
}

export function searchHref(query: string): string {
	return query === '' ? resolve('/search') : `${resolve('/search')}?q=${encodeURIComponent(query)}`;
}

function library(params: URLSearchParams): string {
	const search = params.toString();
	return search === '' ? resolve('/') : `${resolve('/')}?${search}`;
}

/**
 * A series' cover thumbnail, versioned so it's cached for good, or null for
 * none yet: the tile keeps its stripes (doc/COVERS.md).
 */
/** A book's own cover, in a series of books; `v` follows the page chosen as its cover. */
export const bookCoverSrc = (entryId: number, coverPage: number | null) =>
	`${resolve('/api/entries/[id]/cover', { id: String(entryId) })}?v=${bookCoverVersion(coverPage)}`;

/**
 * A page's thumbnail in a book's page grid (0-based page). `v` follows the
 * book's size and page count: it changes when the file does.
 */
export const pageThumbSrc = (e: { id: number; bytes: number; pageCount: number }, page: number) =>
	`${resolve('/api/entries/[id]/pages/[n]/thumb', { id: String(e.id), n: String(page) })}?v=${e.bytes}-${e.pageCount}`;

export const coverSrc = (seriesId: number, cover: number | null | undefined) =>
	cover ? `${resolve('/api/series/[id]/cover', { id: String(seriesId) })}?v=${cover}` : null;
