import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { listTiles, tileIds } from '$lib/server/library';
import { parseDir, parseSeed, parseSort } from '$lib/library/labels';
import { parseFilters } from '$lib/library/filters';
import { GRID_MAX, GRID_PAGE } from '$lib/library/paging';
import { FACTS_MAX } from '$lib/library/selection';

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

/**
 * The facts of series a selection holds by id alone (c737; doc/LIBRARY.md,
 * "A selection outlives the shelf"): SELECT ALL ticks a shelf's pages never
 * loaded, and SHOW and GROUP need their cards to list them. A POST, since
 * SELECT ALL can hold thousands of ids, past what a URL carries. Answered in
 * the grid's own card shape, read through the grid's own query over the
 * whole library, so hidden means hidden here exactly as on the screen: an id
 * ticked under reveal and asked after reveal is off answers nothing, nor
 * does one deleted since. Only the cards that hold a wanted id come back.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const headers = { 'cache-control': 'private, no-store' };
	const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
	if (!body || !Array.isArray(body.ids)) return json({ error: 'ids' }, { status: 400, headers });
	const want = new Set(
		body.ids
			.filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
			.slice(0, FACTS_MAX)
	);
	if (want.size === 0) return json({ series: [] }, { headers });
	const all = listTiles({ reveal: isRevealed(cookies), shelf: 'all', limit: GRID_MAX, offset: 0 });
	const series = all.filter((c) =>
		c.tile ? c.tile.parts.some((p) => want.has(p.seriesId)) : want.has(c.id)
	);
	return json({ series }, { headers });
};
