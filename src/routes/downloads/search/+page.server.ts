import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { hasScript, isRevealed } from '$lib/server/prefs';
import type { Settled } from '$lib/library/settled';
import { downloadsBackend } from '$lib/server/engine/run';
import { configured, searchSource, searchSources, type SearchHit } from '$lib/server/downloads';
import { withLanguages } from '$lib/server/move';
import { kindOfSource } from './kinds.server';
import { kindAsked, kindsServed, sourcesOfKind } from './source-kinds';
import { planAsks } from '$lib/library/search-asks';
import type { Kind } from '$lib/library/kinds';
import { pinnedSources, setPinned } from '$lib/server/engine/source-flags';
import { browsedOrder, readFromSources } from '$lib/server/engine/browse';

/**
 * Searching the sources (Download States 1e, state 6; doc/DOWNLOADS.md).
 * Each source is asked at once and answers on its own time: its results are
 * a promise of their own, streamed into the page as it settles, so results
 * fill in source by source. `?source=` narrows to one, and lists all it found.
 * `?kind=` asks only the sources of that kind, so an anime search does
 * not wait on every manga extension; the band above the sources' tabs offers
 * each kind a source serves, ALL (every source, today's search) first.
 */
/**
 * Each source's answer as a Settled (never rejecting), streamed with script.
 * Without it a streamed promise never resolves (SvelteKit's streaming needs
 * script), so the page waits for every source instead (BROWSE does
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
		return {
			q,
			only,
			kind: null,
			kinds: [],
			down: true,
			all: [],
			kindOf: {} as Record<string, Kind | null>,
			asks: null,
			groups: [],
			restGroups: [],
			engine: false
		};
	}
	const kinded = sources.map((s) => ({ ...s, kind: kindOfSource(s.id) }));
	const kinds = kindsServed(kinded);
	const kind = kindAsked(url.searchParams.get('kind'), kinds);
	const ofKind = sourcesOfKind(kinded, kind);
	// A source named in the URL is asked even when it isn't one of the usual
	// ones -- unless reveal is off and it's one of the mostly hidden ones,
	// which searchSources() already left out. Under a kind it is asked too,
	// whatever its kind: the URL named it.
	// Which of them a search asks first (c1142; `planAsks`): the pinned of the
	// kind, else its last browsed, else every one; the rest only on ASK THEM
	// (`?all=1`, kept by back and reload, gone from the next search).
	const plan = planAsks(
		ofKind,
		pinnedSources(),
		browsedOrder(),
		readFromSources(reveal),
		url.searchParams.get('all') === '1'
	);
	const asking = only ? kinded.filter((s) => s.id === only) : plan.first;
	const restAsked = !only && plan.askRest ? plan.rest : [];
	const pick = (s: { id: string; name: string; lang: string }) => ({
		id: s.id,
		name: s.name,
		lang: s.lang
	});
	const script = hasScript(cookies);
	return {
		q,
		only,
		kind,
		/** The band's kinds, each with how many sources it asks. */
		kinds: kinds.map((k) => ({ kind: k, sources: sourcesOfKind(kinded, k).length })),
		down: false,
		/** The sources' tabs: the ones this search asked. */
		all: [...plan.first, ...restAsked].map((s) => ({ ...pick(s), kind: s.kind })),
		/** Every source's kind, so the band can count each kind's hits from the answers. */
		kindOf: Object.fromEntries(kinded.map((s) => [s.id, s.kind])),
		/** How the asked were chosen, and what the band says and offers (`AskPlan`). */
		asks: {
			mode: plan.mode,
			band: plan.band,
			askRest: plan.askRest,
			first: plan.first.length,
			rest: plan.rest.length,
			total: ofKind.length,
			offer: plan.offer,
			offered: plan.offered.map(pick)
		},
		// 01, what was asked first; 02, the rest once ASK THEM was pressed.
		groups: q ? await groups(asking.map(pick), q, reveal, script) : [],
		restGroups: q && restAsked.length ? await groups(restAsked.map(pick), q, reveal, script) : [],
		// Only the engine can say a site's browser check is being passed.
		engine: downloadsBackend() === 'engine'
	};
};

export const actions: Actions = {
	/**
	 * The band's PIN THE N …: pins those sources, and the search asks them from
	 * now on. Only sources a search may ask are pinned (a mostly hidden one only
	 * inside reveal).
	 */
	pin: async ({ request, cookies, url }) => {
		if (!configured()) error(404, 'not found');
		const reveal = isRevealed(cookies);
		const wanted = (await request.formData()).getAll('source').map(String);
		const known = new Set((await searchSources(reveal).catch(() => [])).map((s) => s.id));
		const ids = wanted.filter((id) => known.has(id));
		if (ids.length === 0) return fail(400, { pin: 'nothing to pin' });
		setPinned(ids, true);
		const back = new URLSearchParams(url.searchParams);
		back.delete('/pin');
		redirect(303, `${url.pathname}?${back}`);
	}
};
