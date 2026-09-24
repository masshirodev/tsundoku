import { error, json } from '@sveltejs/kit';
import type { TextBlock } from '$lib/japanese/ocr';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { dropBlock, pageText, restoreBlock } from '$lib/server/japanese/ocr';
import { lookedUpIn } from '$lib/server/japanese/mining';

/**
 * A chapter's OCR'd text (doc/JAPANESE.md): per page, its text blocks, or
 * null for a page not read yet. Hidden means hidden: a 404 while reveal is
 * off. `lookedUp` is the end page's WORDS row: distinct words looked up in
 * the chapter.
 */
export const GET: RequestHandler = ({ params, cookies }) => {
	const pages = pageText(Number(params.id), isRevealed(cookies));
	if (!pages) error(404, 'not found');
	return json(
		{ pages, lookedUp: lookedUpIn(Number(params.id)) },
		{ headers: { 'cache-control': 'private, no-cache' } }
	);
};

/**
 * NOT TEXT and its UNDO: `{ drop: { page, index } }` takes a block out and
 * answers it; `{ restore: { page, index, block } }` puts it back.
 */
export const POST: RequestHandler = async ({ params, cookies, request }) => {
	const id = Number(params.id);
	if (!pageText(id, isRevealed(cookies))) error(404, 'not found');
	const b = (await request.json().catch(() => null)) as {
		drop?: { page: number; index: number };
		restore?: { page: number; index: number; block: TextBlock };
	} | null;
	if (b?.drop) {
		const block = dropBlock(id, b.drop.page, b.drop.index);
		if (!block) error(404, 'no such block');
		return json({ block });
	}
	if (b?.restore && restoreBlock(id, b.restore.page, b.restore.index, b.restore.block))
		return json({ ok: true });
	error(400, 'drop or restore');
};
