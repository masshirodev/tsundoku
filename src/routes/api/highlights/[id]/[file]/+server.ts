import { error } from '@sveltejs/kit';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { copyFile, getHighlight } from '$lib/server/highlights';
import { copyName } from '$lib/library/highlights';
import { extname } from '$lib/server/fspath';

/**
 * A highlight's copy (c701; doc/HIGHLIGHTS.md, "The copies"): `copy` is the
 * page's image or the clip's MKV, `still` a clip's first frame. `?save=1` is
 * SAVE IMAGE and SAVE CLIP (Out X2, X3): the same bytes, named by series,
 * chapter and page. Only files inside the highlights folder are served, and
 * hidden means hidden: a hidden series' copy is the same 404 without reveal.
 * A copy never changes, so it may be cached for good.
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
		'cache-control': 'private, max-age=31536000, immutable'
	};
	if (url.searchParams.get('save') === '1')
		headers['content-disposition'] = `attachment; filename="${copyName(h, ext.slice(1))}"`;
	return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers });
};
