import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { linkedNames } from '$lib/server/catalogue';
import { hasScript } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { parseSourceMangaId } from '$lib/server/engine/backend';
import { pastedSourceId } from './paste.server';
import { askOne, compared, movable, offsetOf } from './access.server';
import { applyMove, candidateOf, moveSources, MoveError, withLanguages } from '$lib/server/move';
import { isDownloadsError } from '$lib/server/downloads';

/**
 * MOVE TO ANOTHER SOURCE (doc/MOVE.md; Migrate Calls, boards 2–4): the
 * candidates live, the comparison beside them, and one tap to move. A page
 * of its own because the search is slow and live and the comparison is
 * something to read (Q1). Hidden means hidden: without reveal the series is
 * the same 404, and a hidden series is never searched by itself.
 */

/**
 * Each source's answer as a Settled (never rejecting), streamed with script;
 * without it the server waits for every source (as the download search does,
 * c146). A site behind a browser check takes 20–45 s on a first call.
 */
async function groups(
	asked: { id: string; name: string; lang: string }[],
	q: string,
	reveal: boolean,
	script: boolean
) {
	const all = asked.map((s) => ({ ...s, hits: askOne(s.id, q, reveal) }));
	if (script) return all;
	return Promise.all(all.map(async (g) => ({ ...g, hits: await g.hits })));
}

export const load: PageServerLoad = async ({ params, cookies, url, untrack }) => {
	// A hidden series is unreachable while reveal is off: the same 404 as the series.
	const { id, reveal, state, series } = movable(params.id, cookies);
	const script = hasScript(cookies);

	const qParam = url.searchParams.get('q');
	// A hidden series is never searched by itself (LINK's rule): the field is
	// filled and nothing is asked until the owner taps SEARCH.
	const q = qParam !== null ? qParam.trim() : series.hidden ? '' : series.title;

	// OTHER NAMES: the series' own alternative titles, and its catalogue's names.
	const names = [...new Set([...series.altTitles, ...linkedNames(id)].filter(Boolean))];

	// The search depends on `q`, the comparison on `to` (card c491). `to` and
	// `offset` are read untracked, so picking a candidate (or setting the
	// offset) is a navigation that never runs this load again, and so never
	// asks every source again: the page asks `./compare` for the one pick. A
	// reload, or a page without script, still lands here with `to` and gets
	// its comparison from this load, once.
	const offset = untrack(() => offsetOf(url.searchParams.get('offset')));
	let to = untrack(() => url.searchParams.get('to'));
	const paste = (url.searchParams.get('paste') ?? '').trim();
	let pasteFailed = false;
	if (!to && paste) {
		to = pastedSourceId(paste, state.kind);
		pasteFailed = !to;
	}

	const sources = q
		? withLanguages(await moveSources(state.kind, reveal, state.formerSourceId).catch(() => []))
		: [];
	// Streamed with script, so the list paints at once and the comparison
	// follows; waited for without it.
	const comparison = to ? compared(id, to, reveal, offset) : null;

	return {
		series: {
			id: series.id,
			title: series.title,
			kind: series.kind,
			status: series.status,
			hidden: series.hidden,
			altTitles: series.altTitles,
			entries: series.entries.length,
			hue: series.hue
		},
		state,
		q,
		names,
		to,
		offset,
		paste,
		pasteFailed,
		comparison: script || !comparison ? comparison : await comparison,
		groups: q ? await groups(sources, q, reveal, script) : [],
		all: sources.map((s) => ({ id: s.id, name: s.name, lang: s.lang })),
		// Only the engine can say a site's browser check is being passed (c143).
		engine: downloadsBackend() === 'engine'
	};
};

export const actions: Actions = {
	/**
	 * MOVE, the one tap: the candidate's chapters are asked afresh, the map is
	 * built again (never trusting the page's), and the series is moved in one
	 * transaction. Nothing downloads.
	 */
	move: async ({ request, params, cookies }) => {
		const { id, state } = movable(params.id, cookies);
		const form = await request.formData();
		const to = String(form.get('to') ?? '');
		const offset = offsetOf(String(form.get('offset') ?? ''));
		if (!parseSourceMangaId(to)) return fail(400, { message: 'choose a candidate first' });
		try {
			const candidate = await candidateOf(state.kind, to);
			const result = applyMove(
				id,
				{
					key: candidate.key,
					source: candidate.source,
					sourceId: candidate.sourceId,
					url: candidate.url
				},
				candidate.chapters,
				{ offset: offset ?? 1 }
			);
			redirect(303, `/series/${id}?moved=1&added=${result.added}&kept=${result.kept}`);
		} catch (e) {
			if (e instanceof MoveError || isDownloadsError(e)) return fail(503, { message: e.message });
			throw e;
		}
	}
};
