import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { configured, searchSource, searchSources, type SearchHit } from '$lib/server/downloads';
import type { Settled } from '$lib/library/settled';
import { kindOfSource } from '../kinds.server';

/**
 * One source asked the search page's query again: TRY ALL AGAIN
 * re-asks only the sources that did not answer. Only a source the page asks
 * (`searchSources`, so a mostly hidden one only inside reveal) answers, and
 * under `?kind=` only a source of that kind: a page searching ANIME
 * re-asks its anime sources, never a manga one.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!configured()) error(404, 'not found');
	const reveal = isRevealed(cookies);
	const q = (url.searchParams.get('q') ?? '').trim();
	const source = url.searchParams.get('source') ?? '';
	const sources = await searchSources(reveal).catch(() => []);
	if (!q || !sources.some((s) => s.id === source)) error(404, 'not found');
	const kind = url.searchParams.get('kind');
	if (kind && kindOfSource(source) !== kind) error(404, 'not found');
	const answer = await searchSource(source, q, reveal).then(
		(value): Settled<SearchHit[]> => ({ ok: true, value }),
		(e): Settled<SearchHit[]> => ({ ok: false, error: (e as Error).message })
	);
	return json(answer, { headers: { 'cache-control': 'no-store' } });
};
