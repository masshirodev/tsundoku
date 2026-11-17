import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ONLINE_FILE } from '$lib/server/novels/online';
import { isRevealed } from '$lib/server/prefs';
import { BrokenBook, epubFiles } from '$lib/server/epub';

/**
 * The files in a novel's EPUB, with their sizes unpacked (doc/TEXT-READER.md,
 * "A chapter at a time"): what the reader opens a book with, instead of
 * downloading it. `f` names one volume of a novel grouped from several.
 * Versioned (`v`), so immutable; a version that has moved on is a 409, and
 * the reader opens the book again.
 */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	let book: Awaited<ReturnType<typeof epubFiles>>;
	try {
		book = await epubFiles(
			Number(params.id),
			isRevealed(cookies),
			url.searchParams.get('f') ?? undefined
		);
	} catch (e) {
		// There, but not a zip: the reader says BROKEN EPUB, not missing.
		if (e instanceof BrokenBook) error(422, e.message);
		throw e;
	}
	if (!book) error(404, 'not found');
	const v = url.searchParams.get('v');
	if (v && v !== book.version) error(409, 'the book changed');
	return json(
		{ files: book.files },
		{
			headers: {
				// A chapter read online is never kept (doc/READING-ONLINE.md, "Novels online").
				'cache-control': ONLINE_FILE.test(url.searchParams.get('f') ?? '')
					? 'private, no-store'
					: v
						? 'private, max-age=31536000, immutable'
						: 'private, no-cache'
			}
		}
	);
};
