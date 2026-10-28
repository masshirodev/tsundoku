import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { engineConfigured, fetchProxied, EngineError } from '$lib/server/engine/client';
import { imageType } from '$lib/server/engine/protocol';

/**
 * A search result's or a preview's cover, through the engine's /image/ proxy
 * (doc/DOWNLOADER.md): the browser can reach neither the engine nor its
 * token, so tsundoku passes it on, as /api/downloads/thumb does for
 * Suwayomi's. Only covers the viewer was shown link here; while reveal is on
 * hooks.server.ts sends every response no-store, these included.
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
	const type = imageType(got.bytes);
	if (!type) error(404, 'no cover');
	return new Response(Buffer.from(got.bytes), {
		headers: {
			'content-type': type === 'jpg' ? 'image/jpeg' : `image/${type}`,
			'cache-control': 'private, max-age=86400'
		}
	});
};
