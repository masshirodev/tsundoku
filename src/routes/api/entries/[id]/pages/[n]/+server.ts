import { error } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { readPage } from '$lib/server/pages';
import { isOnlineVersion } from '$lib/server/pages/online';

/**
 * One page image. The reader asks with `?v=<manifest version>`, which
 * changes when the files do, so a versioned page is cached as immutable and
 * a turn back is instant. `private`: nothing between the workstation and the
 * tablet may keep a page, hidden or not.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	let page;
	try {
		page = await readPage(Number(params.id), Number(params.n), isRevealed(cookies));
	} catch {
		// Read online, and the source didn't send it: the page's RETRY asks again.
		error(502, 'the source did not send this page');
	}
	if (!page) error(404, 'not found');
	const body = Buffer.isBuffer(page.body)
		? new Uint8Array(page.body)
		: (Readable.toWeb(page.body) as ReadableStream<Uint8Array>);
	return new Response(body, {
		headers: {
			'content-type': page.type,
			'content-length': String(page.size),
			// A page read online is never kept, by the browser or the device (the
			// owner's answer to question 4, doc/BROWSING.md): only downloads are.
			'cache-control': isOnlineVersion(url.searchParams.get('v'))
				? 'private, no-store'
				: url.searchParams.has('v')
					? 'private, max-age=31536000, immutable'
					: 'private, no-cache'
		}
	});
};
