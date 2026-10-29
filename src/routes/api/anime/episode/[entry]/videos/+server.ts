import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { episodeStreams } from '$lib/server/anime/streams';
import { EngineError } from '$lib/server/engine/client';

/**
 * An episode's servers and qualities, every address one of tsundoku's own
 * (doc/ANIME.md, "Streams"). `?fresh=1` asks the source again: TRY AGAIN,
 * and a stream that stopped working. A hidden series' episode is a 404 with
 * reveal off, as it is everywhere.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const id = Number(params.entry);
	if (!Number.isInteger(id) || id <= 0) error(404, 'not found');
	try {
		const s = await episodeStreams(id, isRevealed(cookies), url.searchParams.get('fresh') === '1');
		if (!s) error(404, 'not found');
		return json(s, { headers: { 'cache-control': 'private, no-store' } });
	} catch (e) {
		// The source service not answering is said without naming the engine (Player Waiting 3b).
		if (e instanceof EngineError)
			return json(
				{ failed: e.failure === 'down' ? 'down' : 'source', message: e.message },
				{ status: 503, headers: { 'cache-control': 'private, no-store' } }
			);
		throw e;
	}
};
