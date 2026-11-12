import { error, json } from '@sveltejs/kit';
import { downloadsBackend } from '$lib/server/engine/run';
import { readPressSeries, shelvePress } from '$lib/server/browse-press';
import type { RequestHandler } from './$types';

/**
 * PUT ON A SHELF on a SELECT press's band (card c868; `shelvePress`): `{ items,
 * collection, on }`, one chip's tap for every series the press added so far.
 * The band sends it again for each series added after a chip was chosen.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
	const body = (await request.json().catch(() => null)) as {
		collection?: unknown;
		on?: unknown;
	} | null;
	const items = readPressSeries(body);
	if (items.length === 0) error(400, 'nothing to shelve');
	const r = await shelvePress(items, Number(body?.collection), body?.on !== false);
	if ('status' in r) error(r.status, r.message);
	return json(r);
};
