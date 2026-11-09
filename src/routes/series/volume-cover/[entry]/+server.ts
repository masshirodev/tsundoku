import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { readVolumeCover } from '$lib/server/covers';

/**
 * A volume's own cover, for its head in a grouped novel's contents (c835;
 * doc/COVERS.md, "Volumes"). The id is any entry of the volume: a volume is
 * its EPUB file, and every chapter in it shares the one cover, made on first
 * ask and kept by the file. Hidden means hidden: 404 while reveal is off.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const cover = await readVolumeCover(Number(params.entry), isRevealed(cookies));
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
