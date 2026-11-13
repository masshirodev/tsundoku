import { error, json } from '@sveltejs/kit';
import { videoKindsSql } from '$lib/library/kinds';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { isIncognito, isRevealed } from '$lib/server/prefs';
import { VISIBLE_SQL } from '$lib/server/visibility';
import { WHATS, choose, cleanChoice, type What } from '$lib/server/anime/choices';

/**
 * A choice made in the player's sheet (doc/ANIME.md, "The player"; card
 * c171): the series' audio, subtitles or their size, kept on the workstation
 * so SETTINGS can list the series that differ. Incognito keeps nothing.
 */
export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const id = Number(params.id);
	const reveal = isRevealed(cookies);
	const s = getDb()
		.prepare(
			`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.id = ? AND ${videoKindsSql('s')} AND (? OR ${VISIBLE_SQL})`
		)
		.get(id, reveal ? 1 : 0);
	if (!s) error(404, 'not found');
	const body = (await request.json().catch(() => null)) as { what?: unknown; v?: unknown } | null;
	const what = body?.what as What;
	if (!WHATS.includes(what)) error(400, 'which choice');
	const v = cleanChoice(what, body?.v);
	if (v === undefined) error(400, 'not a choice');
	if (isIncognito(cookies)) return json({ kept: false });
	choose(id, what, v);
	return json({ kept: true });
};
