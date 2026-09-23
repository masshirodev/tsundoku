import { resolve } from '$app/paths';

/**
 * URLs for the library screen. The shelf, tag and sort are query parameters on
 * `/`, so every view has an address and the back button walks between them.
 * Every one goes through resolve(), so a base path would carry.
 */
export function shelfHref(current: URL, shelf: string): string {
	const params = new URLSearchParams();
	if (shelf !== 'all') params.set('shelf', shelf);
	const sort = current.searchParams.get('sort');
	if (sort) params.set('sort', sort);
	return library(params);
}

export function tagHref(tagKey: string): string {
	return library(new URLSearchParams({ tag: tagKey }));
}

export function withParam(current: URL, key: string, value: string | null): string {
	const params = new URLSearchParams(current.searchParams);
	if (value === null) params.delete(key);
	else params.set(key, value);
	return library(params);
}

export function searchHref(query: string): string {
	return query === '' ? resolve('/search') : `${resolve('/search')}?q=${encodeURIComponent(query)}`;
}

function library(params: URLSearchParams): string {
	const search = params.toString();
	return search === '' ? resolve('/') : `${resolve('/')}?${search}`;
}
