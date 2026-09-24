import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { readPageThumb } from '$lib/server/covers';

/**
 * A page's thumbnail, for a book's page grid (doc/COVERS.md, "Page
 * thumbnails"). Asked for with `?v=`, which changes when the book's file
 * does, so it's kept as immutable. Hidden means hidden: a 404 while reveal is
 * off.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const thumb = await readPageThumb(Number(params.id), Number(params.n), isRevealed(cookies));
	if (!thumb) error(404, 'not found');
	return new Response(new Uint8Array(thumb), {
		headers: {
			'content-type': 'image/webp',
			'content-length': String(thumb.length),
			'cache-control': url.searchParams.has('v')
				? 'private, max-age=31536000, immutable'
				: 'private, no-cache'
		}
	});
};
