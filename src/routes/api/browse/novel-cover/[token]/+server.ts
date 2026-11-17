import { error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { coverAddress } from '$lib/server/novels/source';
import { publicFetch, readCapped } from '$lib/server/net-guard';
import { imageType } from '$lib/server/engine/protocol';
import { thumbnail } from '$lib/server/covers';

/**
 * A novel's cover in BROWSE, search or the preview (doc/NOVELS.md): fetched
 * by the server from the address its plugin gave, so the viewer's browser
 * never asks a novel site, and sent as the library's 400px WebP thumbnail,
 * as an engine cover is (/api/downloads/engine-image). Only an address a
 * plugin handed over has a token (novels/source.ts), and the fetch stays on
 * the internet, every redirect included (net-guard.ts): a plugin can't aim
 * the server at the workstation.
 */
const MAX_BYTES = 10 * 1024 * 1024;

export const GET: RequestHandler = async ({ params }) => {
	const url = /^[A-Za-z0-9_-]{32}$/.test(params.token) ? coverAddress(params.token) : null;
	// A token from before a restart is no cover, not an error.
	if (!url) error(404, 'no cover');
	let bytes: Buffer;
	try {
		const res = await publicFetch(url, {
			headers: {
				'user-agent':
					'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36',
				// Sites that guard their images against hotlinking accept their own origin.
				referer: `${new URL(url).origin}/`,
				accept: 'image/avif,image/webp,image/*,*/*;q=0.8'
			},
			signal: AbortSignal.timeout(20_000)
		});
		if (!res.ok) error(404, 'no cover');
		bytes = await readCapped(res, MAX_BYTES);
	} catch (e) {
		if (isHttpError(e)) throw e;
		error(404, 'no cover');
	}
	if (!imageType(new Uint8Array(bytes))) error(404, 'no cover');
	let webp: Buffer;
	try {
		webp = await thumbnail(bytes);
	} catch {
		error(404, 'no cover');
	}
	return new Response(new Uint8Array(webp), {
		headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=86400' }
	});
};
