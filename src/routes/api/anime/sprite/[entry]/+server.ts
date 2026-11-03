import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { episodeRow } from '$lib/server/anime/streams';
import { currentSprite, spritePath } from '$lib/server/anime/sprites';

/**
 * A downloaded episode's seek preview (doc/ANIME.md, "The player"; c385): the
 * sheet the workstation cut from the file it has now. A sprite of another
 * file is not one (`currentSprite` judges it, and deletes it), so this is a
 * 404 until the new one is made. The address carries `?v=<made at>`, so a new
 * sheet is a new address and this one can be kept for good. A hidden series'
 * episode is a 404 with reveal off, as everywhere.
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const id = Number(params.entry);
	if (!Number.isInteger(id) || id <= 0 || !episodeRow(id, isRevealed(cookies)))
		error(404, 'not found');
	if (!(await currentSprite(id))) error(404, 'not found');
	const body = await readFile(spritePath(id)).catch(() => null);
	if (!body) error(404, 'not found');
	return new Response(new Uint8Array(body), {
		headers: {
			'content-type': 'image/jpeg',
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
