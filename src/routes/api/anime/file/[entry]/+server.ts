import { error } from '@sveltejs/kit';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { episodeFile, episodeRow } from '$lib/server/anime/streams';

/**
 * A downloaded episode's file (doc/ANIME.md, "Downloading": a downloaded copy
 * always wins), with Range so the player seeks. A hidden series' episode is a
 * 404 with reveal off, as everywhere.
 */
export const GET: RequestHandler = async ({ params, cookies, request }) => {
	const id = Number(params.entry);
	if (!Number.isInteger(id) || !episodeRow(id, isRevealed(cookies))) error(404, 'not found');
	const path = episodeFile(id);
	if (!path) error(404, 'not found');
	const size = statSync(path).size;
	const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
	const headers: Record<string, string> = {
		'content-type': 'video/x-matroska',
		'accept-ranges': 'bytes',
		'cache-control': 'private, max-age=3600'
	};
	if (!m || (m[1] === '' && m[2] === '')) {
		headers['content-length'] = String(size);
		return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers });
	}
	const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
	const end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
	if (start >= size || start > end)
		return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
	headers['content-length'] = String(end - start + 1);
	headers['content-range'] = `bytes ${start}-${end}/${size}`;
	return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, {
		status: 206,
		headers
	});
};
