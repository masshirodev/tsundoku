import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { listSeries, listedIds } from '$lib/server/library';
import { parseSeed, parseSort } from '$lib/library/labels';
import { parseFilters } from '$lib/library/filters';
import { GRID_MAX, GRID_PAGE } from '$lib/library/paging';

/**
 * The library grid, a page at a time (doc/LIBRARY.md, "Pages"): the cards
 * after the ones already on screen. `?ids` answers every id on the shelf
 * instead, for SELECT ALL. Hidden means hidden here as on the screen.
 */
export const GET: RequestHandler = ({ url, cookies }) => {
	const opts = {
		reveal: isRevealed(cookies),
		shelf: url.searchParams.get('shelf') ?? 'all',
		tag: url.searchParams.get('tag'),
		filters: parseFilters(url.searchParams, isRevealed(cookies)),
		sort: parseSort(url.searchParams.get('sort'))
	};
	const headers = { 'cache-control': 'private, no-store' };
	if (url.searchParams.has('ids')) return json({ ids: listedIds(opts) }, { headers });
	const whole = (v: string | null, fallback: number) => {
		const n = Number(v);
		return Number.isInteger(n) && n >= 0 ? n : fallback;
	};
	const limit = Math.min(whole(url.searchParams.get('limit'), GRID_PAGE), GRID_MAX);
	const offset = whole(url.searchParams.get('offset'), 0);
	const seed = parseSeed(url.searchParams.get('seed'));
	return json({ series: listSeries({ ...opts, limit, offset, seed }) }, { headers });
};
