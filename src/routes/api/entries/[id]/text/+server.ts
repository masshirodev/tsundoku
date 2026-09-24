import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { pageText } from '$lib/server/japanese/ocr';

/**
 * A chapter's OCR'd text (doc/JAPANESE.md): per page, its text blocks, or
 * null for a page not read yet. Hidden means hidden: a 404 while reveal is
 * off.
 */
export const GET: RequestHandler = ({ params, cookies }) => {
	const pages = pageText(Number(params.id), isRevealed(cookies));
	if (!pages) error(404, 'not found');
	return json({ pages }, { headers: { 'cache-control': 'private, no-cache' } });
};
