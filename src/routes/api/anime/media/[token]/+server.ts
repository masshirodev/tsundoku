import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serveMedia, StreamError } from '$lib/server/anime/streams';

/**
 * A stream's playlist or segment by its token (doc/ANIME.md, "Streams"): only
 * addresses an episode's videos handed over have one, so this can't be aimed
 * anywhere else, and a site's fetch stays on the internet (net-guard.ts).
 */
export const GET: RequestHandler = async ({ params, request }) => {
	if (!/^[A-Za-z0-9_-]{32}$/.test(params.token)) error(404, 'not found');
	try {
		return await serveMedia(params.token, request.headers.get('range'));
	} catch (e) {
		if (e instanceof StreamError) error(e.status, e.message);
		throw e;
	}
};
