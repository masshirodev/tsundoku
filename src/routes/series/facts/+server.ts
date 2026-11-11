import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { showRowFacts } from '$lib/server/season-facts';

/**
 * The facts a GROUP AS ONE SHOW row draws beyond the card (c283's meta line):
 * a season's source, its AniList year and how many episodes have a file. The
 * selection's by-id read asks this beside `/api/library` (c737), because no
 * card carries them; only the ids the viewer can see are answered, so a
 * hidden series outside reveal is never read for.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	let ids: number[] = [];
	try {
		const body = (await request.json()) as { ids?: unknown };
		if (Array.isArray(body.ids))
			ids = body.ids
				.map(Number)
				.filter((id) => Number.isInteger(id) && id > 0)
				.slice(0, 10_000);
	} catch {
		return json({}, { status: 400 });
	}
	return json(showRowFacts(ids, isRevealed(cookies)));
};
