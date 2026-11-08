import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
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
import { forgetSiteCheck } from '$lib/server/novels/source';
import type { Settled } from '$lib/library/settled';
import {
	addedBand,
	bandShelves,
	newShelfAdded,
	refusedLanding,
	shelveAdded,
	undoAdded
} from '../added.server';

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
 * preview or series a tag was tapped on, for the back cell (c313). `again`
 * is TRY AGAIN on a site's check (c294), and is never kept.
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

	// TRY AGAIN on a site's check that could not be passed (c294): the
	// ten-minute memos forget this site, then the page is its own URL again,
	// so a reload or a later link doesn't forget them a second time.
	if (url.searchParams.has('again')) {
		await forgetSiteCheck(source.id);
		const clean = new URL(url);
		clean.searchParams.delete('again');
		redirect(303, `${clean.pathname}${clean.search}`);
	}

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

	const addedHidden = await addedBand(url.searchParams, source.id, reveal);
	return {
		source,
		reveal,
		mode,
		pages,
		q,
		panel: url.searchParams.get('panel') === '1',
		find: url.searchParams.get('find') === '1',
		// ADD from a source that adds hidden, with reveal off (card c435): the
		// preview lands here, since the hidden series isn't found, and says so,
		// with what ADD AND DOWNLOAD queued and UNDO (c505).
		addedHidden,
		// The shelves its series is on, for the band's chips (card c724).
		addedShelves: bandShelves(addedHidden),
		// Arrived from a tag (c313): ← returns to where it was tapped, never anywhere else.
		back: backOrigin(url.searchParams.get('from')),
		// Without script a streamed promise never resolves, so the page waits for it instead.
		answer: hasScript(cookies) ? answer : await answer
	};
};

export const actions: Actions = {
	/**
	 * UNDO on the ADDED band (c505; `undoAdded`, shared with BROWSE's band):
	 * the series added hidden from this source's preview leaves the library
	 * again while nothing of it is downloaded or read, and the preview opens
	 * again. It asks the band's own facts, never whether the source is found
	 * outside reveal: a band this page drew is undone even if the source has
	 * become mostly hidden since (another ADD, another tab), and UNDO then
	 * lands on BROWSE, since the preview would not be found either.
	 */
	undoAdd: async ({ params, request, cookies, url }) => {
		if (downloadsBackend() !== 'engine') error(404, 'not found');
		const reveal = isRevealed(cookies);
		const form = await request.formData();
		const r = await undoAdded(form, params.source, reveal);
		if ('to' in r) redirect(303, r.to);
		// A refusal is drawn in the band it belongs to, and this page cannot draw
		// one any more once the source is mostly hidden: its load 404s. Without
		// script the answer would be "not found" instead of NO UNDO, so it lands
		// on BROWSE, which draws every band, carrying the band and the code (c605).
		if (!browseSource(params.source, reveal))
			redirect(303, refusedLanding(form, url.searchParams.get('queued'), r.status));
		return fail(r.status, { message: r.message });
	},
	/**
	 * PUT ON A SHELF on the ADDED band (card c724; `shelveAdded`, shared with
	 * BROWSE's band): one chip, on or off, for the band's own series only.
	 */
	shelve: async ({ params, request }) => {
		if (downloadsBackend() !== 'engine') error(404, 'not found');
		const r = await shelveAdded(await request.formData(), params.source);
		if ('status' in r) return fail(r.status, { shelf: r.message });
		return { shelved: r };
	},
	/** + NEW SHELF on the ADDED band: `NewShelfSheet`'s post, the shelf made and the series put on it. */
	newShelf: async ({ params, request, url }) => {
		if (downloadsBackend() !== 'engine') error(404, 'not found');
		const r = await newShelfAdded(
			await request.formData(),
			request.headers.get('referer'),
			url,
			params.source
		);
		if ('status' in r) return fail(r.status, { shelf: r.message });
		redirect(303, r.to);
	}
};
