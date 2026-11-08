import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { getDb } from '$lib/server/db';
import { listTiles, tileIds } from '$lib/server/library';
import { libraryWhere } from '$lib/server/visibility';
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
 * Which of `want` the library no longer shows (c737): deleted since, or hidden
 * under this request's reveal, by the one rule every library read uses
 * (`libraryWhere`, as `listTiles`' own). Asked by id, so a series the card
 * list below leaves out for its size is never mistaken for one that is gone.
 */
function missingOf(want: readonly number[], reveal: boolean): number[] {
	const shown = new Set(
		(
			getDb()
				.prepare(
					`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
					WHERE s.id IN (SELECT value FROM json_each(?)) AND ${libraryWhere(reveal)}`
				)
				.all(JSON.stringify(want)) as { id: number }[]
		).map((r) => r.id)
	);
	return want.filter((id) => !shown.has(id));
}

/**
 * The facts of series a selection holds by id alone (c737; doc/LIBRARY.md,
 * "A selection outlives the shelf"): SELECT ALL ticks a shelf's pages never
 * loaded, and SHOW and GROUP need their cards to list them. A POST, since
 * SELECT ALL can hold thousands of ids, past what a URL carries; at most
 * `FACTS_MAX` of them are read, and the client sends no more than that at
 * once. The cards come in the grid's own shape, read through the grid's own
 * query over the whole library (its first `GRID_MAX` tiles), so hidden means
 * hidden here exactly as on the screen. `missing` names the wanted ids the
 * library itself no longer shows, deleted or hidden, from a by-id check: an
 * id in neither list was simply not answered, and the client leaves it
 * selected.
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
	if (want.size === 0) return json({ series: [], missing: [] }, { headers });
	const reveal = isRevealed(cookies);
	const missing = missingOf([...want], reveal);
	const all = listTiles({ reveal, shelf: 'all', limit: GRID_MAX, offset: 0 });
	const series = all.filter((c) =>
		c.tile ? c.tile.parts.some((p) => want.has(p.seriesId)) : want.has(c.id)
	);
	return json({ series, missing }, { headers });
};
