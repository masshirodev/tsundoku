import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { dropClip } from '$lib/server/highlights/clips';

/** ✕ on the band: stops the job and drops it (Anime A6). */
export const DELETE: RequestHandler = ({ params, cookies }) => {
	if (!dropClip(params.job, isRevealed(cookies))) error(404, 'no such job');
	return new Response(null, { status: 204 });
};
