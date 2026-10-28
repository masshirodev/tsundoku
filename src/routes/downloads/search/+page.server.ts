import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasScript, isRevealed } from '$lib/server/prefs';
import type { Settled } from '$lib/library/settled';
import { configured, searchSource, searchSources, type SearchHit } from '$lib/server/downloads';

/**
 * Searching the sources (Download States 1e, state 6; doc/DOWNLOADING.md).
 * Each source is asked at once and answers on its own time: its results are
 * a promise of their own, streamed into the page as it settles, so results
 * fill in source by source. `?source=` narrows to one, and lists all it found.
 */
/**
 * Each source's answer as a Settled (never rejecting), streamed with script.
 * Without it a streamed promise never resolves (SvelteKit's streaming needs
 * script), so the page waits for every source instead (c146; BROWSE does
 * the same, doc/BROWSE.md, "Waiting, and without script").
 */
async function groups(
	asked: { id: string; name: string }[],
	q: string,
	reveal: boolean,
	script: boolean
) {
	const all = asked.map((s) => ({
		id: s.id,
		name: s.name,
		hits: searchSource(s.id, q, reveal).then(
			(value): Settled<SearchHit[]> => ({ ok: true, value }),
			(e): Settled<SearchHit[]> => ({ ok: false, error: (e as Error).message })
		)
	}));
	if (script) return all;
	return Promise.all(all.map(async (g) => ({ ...g, hits: await g.hits })));
}

export const load: PageServerLoad = async ({ url, cookies }) => {
	if (!configured()) error(404, 'not found');
	const reveal = isRevealed(cookies);
	const q = (url.searchParams.get('q') ?? '').trim();
	const only = url.searchParams.get('source');
	let sources: { id: string; name: string }[];
	try {
		sources = await searchSources(reveal);
	} catch {
		return { q, only, down: true, groups: [] };
	}
	// A source named in the URL is asked even when it isn't one of the usual
	// ones -- unless reveal is off and it's one of the mostly hidden ones,
	// which searchSources() already left out.
	const asked = only ? sources.filter((s) => s.id === only) : sources;
	return {
		q,
		only,
		down: false,
		all: sources.map((s) => ({ id: s.id, name: s.name })),
		groups: q ? await groups(asked, q, reveal, hasScript(cookies)) : []
	};
};
