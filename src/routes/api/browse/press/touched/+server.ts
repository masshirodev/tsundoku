import { error, json } from '@sveltejs/kit';
import { downloadsBackend } from '$lib/server/engine/run';
import { readPressSeries, touchedOf } from '$lib/server/browse-press';
import type { RequestHandler } from './$types';

/**
 * Which of a SELECT press's series have something downloaded or read now
 * (card c868; `touchedOf`): UNDO leaves those, and the band says so before it
 * is pressed (`UNDO 12 · 2 HAVE A CHAPTER DOWNLOADED NOW`). A read of local
 * rows only; nothing is asked of a source.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
	const items = readPressSeries(await request.json().catch(() => null));
	return json({ touched: items.length ? await touchedOf(items) : [] });
};
