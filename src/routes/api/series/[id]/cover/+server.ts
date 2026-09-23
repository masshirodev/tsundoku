import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { readCover } from '$lib/server/covers';

/**
 * A series' cover thumbnail (doc/COVERS.md). Asked for with `?v=<cover_at>`,
 * which changes when the cover does, so it's cached as immutable; `private`,
 * as every page is. Hidden means hidden: a hidden series' cover is a 404
 * while reveal is off.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const cover = await readCover(Number(params.id), isRevealed(cookies));
	if (!cover) error(404, 'not found');
	return new Response(new Uint8Array(cover.body), {
		headers: {
			'content-type': 'image/webp',
			'content-length': String(cover.body.length),
			'cache-control':
				url.searchParams.get('v') === String(cover.at)
					? 'private, max-age=31536000, immutable'
					: 'private, no-cache'
		}
	});
};
