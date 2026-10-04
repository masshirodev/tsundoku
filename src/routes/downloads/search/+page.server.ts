import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { configured } from '$lib/server/suwayomi';
import { searchSource, searchSources, type SearchHit } from '$lib/server/suwayomi-library';

/**
 * Searching the sources (Download States 1e, state 6; doc/DOWNLOADING.md).
 * Each source is asked at once and answers on its own time: its results are
 * a promise of their own, streamed into the page as it settles, so results
 * fill in source by source. `?source=` narrows to one, and lists all it found.
 */
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
		groups: q
			? asked.map((s) => {
					const hits: Promise<SearchHit[]> = searchSource(s.id, q, reveal);
					// Settled by the page; a rejection here must not crash the server first.
					hits.catch(() => {});
					return { id: s.id, name: s.name, hits };
				})
			: []
	};
};
