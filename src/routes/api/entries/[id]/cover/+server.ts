import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { readBookCover } from '$lib/server/covers';

/**
 * A book's cover thumbnail, for its tile in a series of books (doc/COVERS.md,
 * "Books"). Asked for with `?v=`, which changes when the owner picks another
 * page, so it's cached as immutable. Hidden means hidden: a 404 while reveal
 * is off.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const cover = await readBookCover(Number(params.id), isRevealed(cookies));
	if (!cover) error(404, 'not found');
	return new Response(new Uint8Array(cover.body), {
		headers: {
			'content-type': 'image/webp',
			'content-length': String(cover.body.length),
			'cache-control':
				url.searchParams.get('v') === cover.version
					? 'private, max-age=31536000, immutable'
					: 'private, no-cache'
		}
	});
};
