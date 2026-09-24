import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isIncognito, isRevealed } from '$lib/server/prefs';
import { logLookup, lookupCounts } from '$lib/server/japanese/mining';

/**
 * A lookup, logged for mining (doc/JAPANESE.md). Answers the panel's footer:
 * this word's Nth lookup, and today's count. Incognito logs nothing, and says
 * so (`logged: false`).
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!b || typeof b.lemma !== 'string' || typeof b.seriesId !== 'number') error(400, 'bad lookup');
	const str = (v: unknown) => (typeof v === 'string' ? v : '');
	if (isIncognito(cookies)) return json({ logged: false, nth: 0, session: 0 });
	const logged = logLookup(
		{
			seriesId: b.seriesId,
			entryId: typeof b.entryId === 'number' ? b.entryId : null,
			place: str(b.place),
			lemma: b.lemma,
			surface: str(b.surface) || b.lemma,
			reading: str(b.reading) || null,
			pos: str(b.pos),
			sentence: str(b.sentence)
		},
		isRevealed(cookies),
		typeof b.at === 'number' ? b.at : undefined
	);
	if (!logged) error(404, 'not found');
	return json({ logged: true, ...lookupCounts(b.lemma) });
};
