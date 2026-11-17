import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { downloadsBackend } from '$lib/server/engine/run';
import { webviewView } from '$lib/server/engine/webview';

/**
 * How the engine's WebView is now (doc/EXTENSION-ENGINE.md, "Cloudflare and
 * WebView extensions"): asked every couple of seconds by a page waiting on a
 * WebView extension (its first-use line, and RETRY once it's ready), and by
 * SETTINGS' WEBVIEW row while it changes. Names no source, so it says
 * nothing reveal hides.
 */
export const GET: RequestHandler = async () => {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
	return json(await webviewView(), { headers: { 'cache-control': 'no-store' } });
};
