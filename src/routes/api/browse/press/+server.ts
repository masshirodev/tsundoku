import { error, json } from '@sveltejs/kit';
import { downloadsBackend } from '$lib/server/engine/run';
import { isRevealed } from '$lib/server/prefs';
import { pressOne } from '$lib/server/browse-press';
import type { Which } from '$lib/library/browse-press';
import type { RequestHandler } from './$types';

/**
 * One series of a SELECT press (doc/BROWSE.md, "The press"): `{ id,
 * which }`, `which` one of none, first or all. The page asks this once per
 * series, one at a time per source; the answer is the series' own
 * (`PressAnswer`): added, skipped (in the library or being added by then), or
 * not added and why in a word.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
	const body = (await request.json().catch(() => null)) as { id?: unknown; which?: unknown } | null;
	const id = typeof body?.id === 'string' ? body.id : '';
	const which: Which = body?.which === 'first' || body?.which === 'all' ? body.which : 'none';
	if (!id) error(400, 'no series');
	return json(await pressOne(id, which, isRevealed(cookies)));
};
