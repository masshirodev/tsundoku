import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { browseSource, checkingSince } from '$lib/server/engine/browse';

/**
 * Whether this source's site's browser check is being passed right now
 * (doc/BROWSE.md, "A site's check"): the engine says for
 * an extension, and the app itself for an LNReader plugin, whose solve it
 * does. Asked every second by a page waiting on the source, so it can say why
 * it's slow at once rather than after ten seconds. Hidden means hidden: a
 * source the viewer may not see is not found.
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
	if (!browseSource(params.source, isRevealed(cookies))) error(404, 'not found');
	return json(
		{ since: await checkingSince(params.source) },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
