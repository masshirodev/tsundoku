import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serveSubtitle, StreamError } from '$lib/server/anime/streams';

/** A subtitle track by its token, as WebVTT whatever it was (doc/ANIME.md, "Streams"). */
export const GET: RequestHandler = async ({ params }) => {
	if (!/^[A-Za-z0-9_-]{32}$/.test(params.token)) error(404, 'not found');
	try {
		return await serveSubtitle(params.token);
	} catch (e) {
		if (e instanceof StreamError) error(e.status, e.message);
		throw e;
	}
};
