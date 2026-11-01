import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { isRevealed } from '$lib/server/prefs';
import { episodeRow } from '$lib/server/anime/streams';
import { picturePath } from '$lib/server/anime/pictures';

/**
 * An episode's picture (doc/ANIME.md, "Episode pictures"), as the workstation
 * made it. The address carries `?v=<thumb_at>`, so a new picture is a new
 * address and this one can be kept for good. A hidden series' episode is a
 * 404 with reveal off, as everywhere.
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const id = Number(params.entry);
	if (!Number.isInteger(id) || id <= 0 || !episodeRow(id, isRevealed(cookies)))
		error(404, 'not found');
	const r = getDb().prepare(`SELECT thumb_at FROM entries WHERE id = ?`).get(id) as
		{ thumb_at: number | null } | undefined;
	if (!r?.thumb_at) error(404, 'not found');
	const body = await readFile(picturePath(id)).catch(() => null);
	if (!body) error(404, 'not found');
	return new Response(new Uint8Array(body), {
		headers: {
			'content-type': 'image/webp',
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
