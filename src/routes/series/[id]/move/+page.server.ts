import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { hasScript, isRevealed } from '$lib/server/prefs';
import { seriesPage } from '$lib/server/series';
import { searchSource } from '$lib/server/downloads';
import { downloadsBackend } from '$lib/server/engine/run';
import { isAnimeSource, parseSourceMangaId, sourceMangaId } from '$lib/server/engine/backend';
import {
	applyMove,
	candidateOf,
	moveComparison,
	moveSources,
	moveState,
	MoveError
} from '$lib/server/move';
import { isDownloadsError } from '$lib/server/downloads';
import type { Settled } from '$lib/library/settled';
import type { SearchHit } from '$lib/server/download-types';

/**
 * MOVE TO ANOTHER SOURCE (doc/MOVE.md; Migrate Calls, boards 2–4): the
 * candidates live, the comparison beside them, and one tap to move. A page
 * of its own because the search is slow and live and the comparison is
 * something to read (Q1). Hidden means hidden: without reveal the series is
 * the same 404, and a hidden series is never searched by itself.
 */

function seriesId(raw: string): number {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(404, 'not found');
	return id;
}

/**
 * Each source's answer as a Settled (never rejecting), streamed with script;
 * without it the server waits for every source (as the download search does,
 * c146). A site behind a browser check takes 20–45 s on a first call.
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

/** A pasted address on a source's site, matched to the installed source of the series' kind that serves it. */
function pastedSourceId(url: string, kind: 'manga' | 'anime'): string | null {
	let host: string;
	try {
		host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return null;
	}
	const rows = getDb()
		.prepare(
			`SELECT s.id, s.base_url FROM engine_sources s JOIN engine_extensions e ON e.pkg = s.pkg
			WHERE e.failed = ''`
		)
		.all() as { id: string; base_url: string }[];
	const hit = rows.find((r) => {
		if (isAnimeSource(r.id) !== (kind === 'anime')) return false;
		try {
			const base = new URL(r.base_url).hostname.replace(/^www\./, '').toLowerCase();
			return host === base || host.endsWith(`.${base}`) || base.endsWith(`.${host}`);
		} catch {
			return false;
		}
	});
	return hit ? sourceMangaId(hit.id, url) : null;
}

export const load: PageServerLoad = async ({ params, cookies, url }) => {
	const reveal = isRevealed(cookies);
	const id = seriesId(params.id);
	// A hidden series is unreachable while reveal is off: the same 404 as the series.
	const series = seriesPage(id, reveal);
	if (!series) error(404, 'not found');
	const state = moveState(id);
	if (!state.eligible) error(404, 'not found');

	const qParam = url.searchParams.get('q');
	// A hidden series is never searched by itself (LINK's rule): the field is
	// filled and nothing is asked until the owner taps SEARCH.
	const q = qParam !== null ? qParam.trim() : series.hidden ? '' : series.title;

	// OTHER NAMES: the series' own alternative titles, and its catalogue's name.
	const linked = getDb()
		.prepare(`SELECT title FROM series_links WHERE series_id = ? AND title != ''`)
		.get(id) as { title: string } | undefined;
	const names = [...new Set([...series.altTitles, linked?.title ?? ''].filter(Boolean))];

	const offsetRaw = url.searchParams.get('offset');
	const offset = offsetRaw && /^\d+$/.test(offsetRaw) ? Number(offsetRaw) : null;
	let to = url.searchParams.get('to');
	const paste = (url.searchParams.get('paste') ?? '').trim();
	let pasteFailed = false;
	if (!to && paste) {
		to = pastedSourceId(paste, state.kind);
		pasteFailed = !to;
	}

	const sources = q
		? await moveSources(state.kind, reveal, state.formerSourceId).catch(() => [])
		: [];
	let comparison = null;
	let comparisonError: string | null = null;
	if (to) {
		try {
			comparison = await moveComparison(id, to, reveal, offset);
		} catch (e) {
			if (e instanceof MoveError || isDownloadsError(e)) comparisonError = (e as Error).message;
			else throw e;
		}
	}

	return {
		series: {
			id: series.id,
			title: series.title,
			kind: series.kind,
			status: series.status,
			hidden: series.hidden,
			altTitles: series.altTitles,
			entries: series.entries.length,
			cover: series.cover,
			hue: series.hue
		},
		state,
		q,
		names,
		to,
		paste,
		pasteFailed,
		comparison,
		comparisonError,
		groups: q ? await groups(sources, q, reveal, hasScript(cookies)) : [],
		all: sources.map((s) => ({ id: s.id, name: s.name })),
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
		const reveal = isRevealed(cookies);
		const id = seriesId(params.id);
		if (!seriesPage(id, reveal)) error(404, 'not found');
		const state = moveState(id);
		if (!state.eligible) error(404, 'not found');
		const form = await request.formData();
		const to = String(form.get('to') ?? '');
		const offsetRaw = String(form.get('offset') ?? '');
		const offset = /^\d+$/.test(offsetRaw) ? Number(offsetRaw) : null;
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
