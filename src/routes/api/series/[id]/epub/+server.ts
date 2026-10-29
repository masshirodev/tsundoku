import { error } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import type { RequestHandler } from './$types';
import { ONLINE_FILE } from '$lib/server/novels/online';
import { isRevealed } from '$lib/server/prefs';
import { readEpubFile } from '$lib/server/epub';

/**
 * A novel's EPUB, whole (doc/TEXT-READER.md). Asked for with `?v=<version>`,
 * which changes when the file does, so it's cached as immutable: the tablet
 * downloads a book once. `private`, as every page is.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	// `f`: one volume's file, in a novel grouped from several EPUBs.
	const book = await readEpubFile(
		Number(params.id),
		isRevealed(cookies),
		url.searchParams.get('f') ?? undefined
	);
	if (!book) error(404, 'not found');
	const body = Buffer.isBuffer(book.body)
		? new Uint8Array(book.body)
		: (Readable.toWeb(book.body) as ReadableStream<Uint8Array>);
	return new Response(body, {
		headers: {
			'content-type': 'application/epub+zip',
			'content-length': String(book.size),
			// A chapter read online is never kept (doc/BROWSING.md, "Novels online").
			'cache-control': ONLINE_FILE.test(url.searchParams.get('f') ?? '')
				? 'private, no-store'
				: url.searchParams.has('v')
					? 'private, max-age=31536000, immutable'
					: 'private, no-cache'
		}
	});
};
