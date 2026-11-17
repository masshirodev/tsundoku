import { error } from '@sveltejs/kit';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { copyFile, getHighlight } from '$lib/server/highlights';
import { copyName } from '$lib/library/highlights';
import { extname } from '$lib/server/fspath';

/**
 * A highlight's copy (doc/HIGHLIGHTS.md, "The copies"): `copy` is the
 * page's image or the clip's MKV, `still` a clip's first frame. `?save=1` is
 * SAVE IMAGE and SAVE CLIP: the same bytes, named by series,
 * chapter and page. Only files inside the highlights folder are served, and
 * hidden means hidden: a hidden series' copy is the same 404 without reveal.
 * A copy's bytes never change, but who may see them does (a series hidden
 * later, reveal turned off), so it is sent `private, no-cache`: the browser
 * keeps it and asks again each time, and the 404 then holds.
 */

const TYPES: Record<string, string> = {
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.mkv': 'video/x-matroska',
	'.mp4': 'video/mp4'
};

export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404, 'not found');
	if (params.file !== 'copy' && params.file !== 'still') error(404, 'not found');
	const h = getHighlight(id, isRevealed(cookies));
	if (!h) error(404, 'not found');
	const path = copyFile(params.file === 'copy' ? h.copyPath : h.stillPath);
	if (!path || !existsSync(path)) error(404, 'no copy');
	const ext = extname(path).toLowerCase();
	const headers: Record<string, string> = {
		'content-type': TYPES[ext] ?? 'application/octet-stream',
		'content-length': String(statSync(path).size),
		// A copy never changes, but who may see it does: a highlight hidden
		// since must not keep showing from the browser's cache, so every use
		// asks again (and a 404 then says it is gone).
		'cache-control': 'private, no-cache'
	};
	if (url.searchParams.get('save') === '1')
		headers['content-disposition'] = `attachment; filename="${copyName(h, ext.slice(1))}"`;
	return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers });
};
