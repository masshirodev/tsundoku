import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseSourceMangaId } from '$lib/server/engine/backend';
import { compared, movable, offsetOf } from '../access.server';

/**
 * The move page's comparison for one candidate (doc/MOVE.md, "The
 * move page"). Picking a candidate asks this and nothing else: the search
 * depends on `q` and the comparison on `to`, so a pick never asks every
 * source again. Answers a Settled, `{ ok: false, error }` when the source
 * wouldn't say, so the page can draw TRY AGAIN with MOVE off.
 */
export const GET: RequestHandler = async ({ params, url, cookies, request }) => {
	const { id, reveal } = movable(params.id, cookies);
	const to = url.searchParams.get('to') ?? '';
	if (!parseSourceMangaId(to)) error(400, 'not a candidate');
	// The request's signal: a pick the page dropped never asks the engine if it was still waiting.
	return json(
		await compared(id, to, reveal, offsetOf(url.searchParams.get('offset')), request.signal),
		{
			headers: { 'cache-control': 'no-store' }
		}
	);
};
