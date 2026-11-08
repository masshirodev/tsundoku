import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasScript, isRevealed } from '$lib/server/prefs';
import type { Settled } from '$lib/library/settled';
import { downloadsBackend } from '$lib/server/engine/run';
import { configured, searchSource, searchSources, type SearchHit } from '$lib/server/downloads';
import { withLanguages } from '$lib/server/move';
import { kindOfSource } from './kinds.server';
import { kindAsked, kindsServed, sourcesOfKind } from './source-kinds';

/**
 * Searching the sources (Download States 1e, state 6; doc/DOWNLOADING.md).
 * Each source is asked at once and answers on its own time: its results are
 * a promise of their own, streamed into the page as it settles, so results
 * fill in source by source. `?source=` narrows to one, and lists all it found.
 * `?kind=` (c699) asks only the sources of that kind, so an anime search does
 * not wait on every manga extension; the band above the sources' tabs offers
 * each kind a source serves, ALL (every source, today's search) first.
 */
/**
 * Each source's answer as a Settled (never rejecting), streamed with script.
 * Without it a streamed promise never resolves (SvelteKit's streaming needs
 * script), so the page waits for every source instead (c146; BROWSE does
 * the same, doc/BROWSE.md, "Waiting, and without script").
 */
async function groups(
	asked: { id: string; name: string; lang: string }[],
	q: string,
	reveal: boolean,
	script: boolean
) {
	const all = asked.map((s) => ({
		...s,
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
	let sources: { id: string; name: string; lang: string }[];
	try {
		sources = withLanguages(await searchSources(reveal));
	} catch {
		return { q, only, kind: null, kinds: [], down: true, groups: [], engine: false };
	}
	const kinded = sources.map((s) => ({ ...s, kind: kindOfSource(s.id) }));
	const kinds = kindsServed(kinded);
	const kind = kindAsked(url.searchParams.get('kind'), kinds);
	const ofKind = sourcesOfKind(kinded, kind);
	// A source named in the URL is asked even when it isn't one of the usual
	// ones -- unless reveal is off and it's one of the mostly hidden ones,
	// which searchSources() already left out. Under a kind it is asked too,
	// whatever its kind: the URL named it.
	const asked = only ? kinded.filter((s) => s.id === only) : ofKind;
	return {
		q,
		only,
		kind,
		/** The band's kinds, each with how many sources it asks. */
		kinds: kinds.map((k) => ({ kind: k, sources: sourcesOfKind(kinded, k).length })),
		down: false,
		/** The sources' tabs: the kind's sources, every one under ALL. */
		all: ofKind.map((s) => ({ id: s.id, name: s.name, lang: s.lang, kind: s.kind })),
		/** Every source's kind, so the band can count each kind's hits from the answers. */
		kindOf: Object.fromEntries(kinded.map((s) => [s.id, s.kind])),
		groups: q
			? await groups(
					asked.map((s) => ({ id: s.id, name: s.name, lang: s.lang })),
					q,
					reveal,
					hasScript(cookies)
				)
			: [],
		// Only the engine can say a site's browser check is being passed (c143).
		engine: downloadsBackend() === 'engine'
	};
};
