import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasScript, isIncognito, isRevealed } from '$lib/server/prefs';
import { downloadsBackend } from '$lib/server/engine/run';
import { EngineError } from '$lib/server/engine/client';
import {
	browseSource,
	filterSchema,
	noteBrowsed,
	shelf,
	supportsLatest,
	type Mode,
	type Shelf
} from '$lib/server/engine/browse';
import { changedCount, readFilters, type FilterField } from '$lib/library/browse-filters';
import { backOrigin } from '$lib/library/tag-search';
import type { Settled } from '$lib/library/settled';

/**
 * A source's page in BROWSE (Index-Browse, states popular, filters, phoneGrid;
 * doc/BROWSE.md; card c141). What the source has to answer is streamed into
 * the page, so the bar and the tabs are there at once and a slow site (a
 * first visit through its browser check) fills in after.
 *
 * The URL is the page: `tab` (popular, latest, filtered), `pages` (how many
 * are loaded, what MORE and back return to), `q` (a search in this source,
 * answered as a filtered list), the panel's `f*` choices, `panel` /
 * `find` for the two things script would otherwise toggle, and `from`, the
 * preview or series a tag was tapped on, for the back cell (c313).
 */

type Answer = {
	schema: FilterField[];
	applied: FilterField[];
	changed: number;
	latest: boolean;
	results: Shelf;
};

/** Why the source didn't answer, in the band's words. */
function why(e: unknown): string {
	if (e instanceof EngineError)
		return e.failure === 'down' || e.failure === 'rate-limited' ? e.failure : e.message;
	return (e as Error).message ?? 'failed';
}

export const load: PageServerLoad = async ({ params, url, cookies }) => {
	if (downloadsBackend() !== 'engine') error(404, 'not found');
	const reveal = isRevealed(cookies);
	// Hidden means hidden: a mostly-hidden source isn't found with reveal off.
	const source = browseSource(params.source, reveal);
	if (!source) error(404, 'not found');

	// Incognito leaves nothing behind, RECENT included (doc/PRIVACY.md).
	if (!isIncognito(cookies)) noteBrowsed(source.id);

	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	const asked = url.searchParams.get('tab');
	const mode: Mode =
		q || asked === 'filtered' ? 'filtered' : asked === 'latest' ? 'latest' : 'popular';
	const pages = Math.max(1, Math.min(20, Number(url.searchParams.get('pages')) || 1));

	const ask = async (): Promise<Answer> => {
		if (source.failed) throw new Error(source.failed);
		const [schema, latest] = await Promise.all([
			filterSchema(source.id),
			supportsLatest(source.id)
		]);
		// The panel's choices count only on the filtered tab: elsewhere they're the source's own.
		const applied = mode === 'filtered' ? readFilters(schema, url.searchParams) : schema;
		const results = await shelf(source.id, mode, {
			pages,
			query: q,
			applied: mode === 'filtered' ? applied : undefined,
			reveal
		});
		return { schema, applied, changed: changedCount(schema, applied), latest, results };
	};
	const answer: Promise<Settled<Answer>> = ask().then(
		(value) => ({ ok: true, value }),
		(e) => ({ ok: false, error: why(e) })
	);

	return {
		source,
		mode,
		pages,
		q,
		panel: url.searchParams.get('panel') === '1',
		find: url.searchParams.get('find') === '1',
		// Arrived from a tag (c313): ← returns to where it was tapped, never anywhere else.
		back: backOrigin(url.searchParams.get('from')),
		// Without script a streamed promise never resolves, so the page waits for it instead.
		answer: hasScript(cookies) ? answer : await answer
	};
};
