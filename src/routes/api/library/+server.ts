import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { listTiles, tileIds } from '$lib/server/library';
import { parseDir, parseSeed, parseSort } from '$lib/library/labels';
import { parseFilters } from '$lib/library/filters';
import { GRID_MAX, GRID_PAGE } from '$lib/library/paging';

/**
 * The library grid, a page at a time (doc/LIBRARY.md, "Pages"): the tiles
 * after the ones already on screen -- the same units the first page carries,
 * a Work once, and the offset counted in tiles. `?ids` answers every series id
 * the shelf's tiles hold instead, for SELECT ALL: a Work's every part, not
 * only the one that is on the shelf. Hidden means hidden here as on the
 * screen.
 */
export const GET: RequestHandler = ({ url, cookies }) => {
	const sort = parseSort(url.searchParams.get('sort'));
	const opts = {
		reveal: isRevealed(cookies),
		shelf: url.searchParams.get('shelf') ?? 'all',
		tag: url.searchParams.get('tag'),
		filters: parseFilters(url.searchParams, isRevealed(cookies)),
		sort,
		dir: parseDir(url.searchParams.get('dir'), sort)
	};
	const headers = { 'cache-control': 'private, no-store' };
	if (url.searchParams.has('ids')) return json({ ids: tileIds(opts) }, { headers });
	const whole = (v: string | null, fallback: number) => {
		const n = Number(v);
		return Number.isInteger(n) && n >= 0 ? n : fallback;
	};
	const limit = Math.min(whole(url.searchParams.get('limit'), GRID_PAGE), GRID_MAX);
	const offset = whole(url.searchParams.get('offset'), 0);
	const seed = parseSeed(url.searchParams.get('seed'));
	return json({ series: listTiles({ ...opts, limit, offset, seed }) }, { headers });
};
