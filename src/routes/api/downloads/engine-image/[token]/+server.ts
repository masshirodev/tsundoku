import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { engineConfigured, fetchProxied, EngineError } from '$lib/server/engine/client';
import { imageType } from '$lib/server/engine/protocol';
import { thumbnail } from '$lib/server/covers';

/**
 * A search result's or a preview's cover, through the engine's /image/ proxy
 * (doc/DOWNLOADER.md): the browser can reach neither the engine nor its
 * token, so tsundoku passes it on, as /api/downloads/thumb does for
 * Suwayomi's once did. Only covers the viewer was shown link here; while reveal is on
 * hooks.server.ts sends every response no-store, these included.
 *
 * Sent as the library's 400px WebP thumbnail: a source's cover can be the
 * original scan (MangaDex's default sends up to 2.8 MB each, measured
 * 2026-10-28), and BROWSE asks for twenty at a time on a tablet.
 */
export const GET: RequestHandler = async ({ params }) => {
	if (!engineConfigured() || !/^[A-Za-z0-9_-]{8,128}$/.test(params.token)) error(404, 'not found');
	let got: { bytes: Uint8Array; type: string };
	try {
		got = await fetchProxied(`${process.env.ENGINE_URL}/image/${params.token}`, 20_000);
	} catch (e) {
		// A token the engine forgot (a restart) is no cover, not an error.
		error(e instanceof EngineError && e.failure === 'down' ? 504 : 404, 'no cover');
	}
	if (!imageType(got.bytes)) error(404, 'no cover');
	let webp: Buffer;
	try {
		webp = await thumbnail(Buffer.from(got.bytes));
	} catch {
		error(404, 'no cover');
	}
	return new Response(new Uint8Array(webp), {
		headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=86400' }
	});
};
