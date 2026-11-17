import { error, json } from '@sveltejs/kit';
import { downloadsBackend } from '$lib/server/engine/run';
import { readPressSeries, undoPress } from '$lib/server/browse-press';
import type { RequestHandler } from './$types';

/**
 * UNDO for a whole SELECT press (`undoPress`): `{ items: [{ series,
 * preview }] }`, every series the press added. Those with nothing downloaded
 * or read leave the library with their queued chapters; the answer counts
 * what went, what stayed and what was gone already.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
	const items = readPressSeries(await request.json().catch(() => null));
	if (items.length === 0) error(400, 'nothing to undo');
	return json(await undoPress(items));
};
