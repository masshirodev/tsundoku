import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { search } from '$lib/server/library';
import { isRevealed, runCommand } from '$lib/server/prefs';
import { startScan } from '$lib/server/import';
import { isGated } from '$lib/server/unlock';
import { parseSearch } from '$lib/library/search';
import { showRowFacts } from '$lib/server/season-facts';
import { configured, searchSources } from '$lib/server/downloads';
import { downloadsBackend } from '$lib/server/engine/run';
import { browseList } from '$lib/server/engine/browse';
import { kindOfSource } from '../downloads/search/kinds.server';
import { kindAsked, kindsServed, sourcesOfKind } from '../downloads/search/source-kinds';

export const load: PageServerLoad = async ({ url, cookies }) => {
	const q = url.searchParams.get('q') ?? '';
	const input = parseSearch(q);
	// A command is not searched for: `/reveal` must not list what it is about
	// to reveal before Enter is pressed.
	if (input.type !== 'query') {
		// The empty search offers BROWSE first (Index-Browse, phoneEntry): on the
		// phone the bar has no room for it.
		const list =
			input.type === 'empty' && downloadsBackend() === 'engine'
				? browseList(isRevealed(cookies))
				: null;
		const browse = list && {
			recent: list.recent.slice(0, 3),
			total: list.manga.length + list.anime.length + list.novels.length
		};
		return { q, result: null, sources: null, browse, now: Date.now() };
	}
	const reveal = isRevealed(cookies);
	// SEARCH THE SOURCES after the titles (Download States 1e): how many it would
	// ask. A library filtered to one kind (`?kind=`, carried from its search
	// cell) asks that kind's sources, when one serves it (c699).
	const asking = configured()
		? await searchSources(reveal).then(
				(all) => {
					const kinded = all.map((s) => ({ ...s, kind: kindOfSource(s.id) }));
					const kind = kindAsked(url.searchParams.get('kind'), kindsServed(kinded));
					return { n: sourcesOfKind(kinded, kind).length, kind };
				},
				() => null
			)
		: null;
	const result = search(input.text, reveal);
	// A GROUP row's show line (c283; `season-facts.ts`), for what the search drew.
	const ids = [
		...result.titles.map((t) => t.id),
		...result.works.flatMap((w) => w.parts.map((p) => p.seriesId))
	];
	return {
		q,
		result,
		groupFacts: showRowFacts(ids, reveal),
		sources: asking?.n ?? null,
		sourcesKind: asking?.kind ?? null,
		browse: null,
		now: Date.now()
	};
};

export const actions: Actions = {
	/**
	 * Enter in the search field. A command runs and returns to the library;
	 * anything else is a query and stays here.
	 */
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const input = parseSearch(String(form.get('q') ?? ''));
		if (input.type === 'command') {
			// /scan rescans the device copies; the library shows the job.
			if (input.command === 'words') redirect(303, '/words');
			if (input.command === 'scan') startScan();
			else runCommand(cookies, input.command, url, { gated: isGated() });
			redirect(303, '/');
		}
		if (input.type === 'page') redirect(303, input.href);
		// The kind the search came with stays with it (c699).
		const kind = url.searchParams.get('kind');
		const withKind = kind ? `kind=${encodeURIComponent(kind)}` : '';
		if (input.type === 'empty') redirect(303, withKind ? `/search?${withKind}` : '/search');
		redirect(303, `/search?q=${encodeURIComponent(input.text)}${withKind ? `&${withKind}` : ''}`);
	}
};
