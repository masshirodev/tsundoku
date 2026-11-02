import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isIncognito, isRevealed } from '$lib/server/prefs';
import { wantPictures } from '$lib/server/anime/pictures';
import { episodeStreams } from '$lib/server/anime/streams';
import { EngineError } from '$lib/server/engine/client';
import { recordNoVideo } from '$lib/server/move';

/**
 * An episode's servers and qualities, every address one of tsundoku's own
 * (doc/ANIME.md, "Streams"). `?fresh=1` asks the source again: TRY AGAIN,
 * and a stream that stopped working. A hidden series' episode is a 404 with
 * reveal off, as it is everywhere.
 *
 * A source that answers with no video is recorded against the episode
 * (doc/MOVE.md, "The NO VIDEO band"), which is what the series' band and the
 * player's "not just this episode" line are counted from. The engine being
 * down is not the source's failure, and incognito leaves nothing behind.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const id = Number(params.entry);
	if (!Number.isInteger(id) || id <= 0) error(404, 'not found');
	const incognito = isIncognito(cookies);
	try {
		// The source's own timestamps, then AniSkip for what it left empty
		// (c239). Incognito asks neither, and a hidden series is never looked
		// up; both are enforced before any request leaves the app.
		const s = await episodeStreams(
			id,
			isRevealed(cookies),
			url.searchParams.get('fresh') === '1',
			Date.now(),
			!incognito
		);
		if (!s) error(404, 'not found');
		if (s.servers.length === 0 && !incognito) recordNoVideo(id);
		// While its streams are fresh, an episode without a picture gets one
		// (doc/ANIME.md, "Episode pictures"). Incognito leaves nothing behind.
		if (!incognito) wantPictures([id]);
		return json(s, { headers: { 'cache-control': 'private, no-store' } });
	} catch (e) {
		// The source service not answering is said without naming the engine (Player Waiting 3b).
		if (e instanceof EngineError) {
			if (e.failure !== 'down' && !incognito) recordNoVideo(id);
			return json(
				{ failed: e.failure === 'down' ? 'down' : 'source', message: e.message },
				{ status: 503, headers: { 'cache-control': 'private, no-store' } }
			);
		}
		throw e;
	}
};
