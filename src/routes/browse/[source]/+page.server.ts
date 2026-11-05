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
import { addedHere } from '$lib/server/engine/source-flags';
import {
	isDownloadsError,
	isSourceMangaId,
	mangaKey,
	sourceOfMangaId,
	undoAdd
} from '$lib/server/downloads';
import { kindFacts } from '$lib/library/kinds';

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

/**
 * The ADDED band's series (c505), when the band's URL still names one: the
 * series is the one added from that preview of this source (`addedHere`
 * checks its id and its key both), and it is still in the library. Null
 * when it isn't (UNDO ran, or the URL is stale): then nothing is said.
 */
async function bandSeries(sourceId: string, seriesParam: string | null, preview: string | null) {
	const seriesId = Number(seriesParam);
	if (!Number.isInteger(seriesId) || seriesId <= 0 || !preview || !isSourceMangaId(preview))
		return null;
	if (sourceOfMangaId(preview) !== sourceId) return null;
	const key = await mangaKey(preview).catch(() => null);
	const here = key ? addedHere(seriesId, key) : null;
	return here && { seriesId, preview, ...here };
}

/** The ADDED band (c505): its series' chapters, what was queued, and whether UNDO still can. */
async function addedBand(sourceId: string, p: URLSearchParams) {
	if (p.get('added') !== 'hidden') return null;
	const s = await bandSeries(sourceId, p.get('series'), p.get('preview'));
	if (!s) return null;
	const queued = /^(\d+|down)$/.test(p.get('queued') ?? '') ? p.get('queued') : null;
	return {
		seriesId: s.seriesId,
		preview: s.preview,
		entries: s.entries,
		video: kindFacts(s.kind).medium === 'video',
		queued,
		touched: s.touched
	};
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

	return {
		source,
		mode,
		pages,
		q,
		panel: url.searchParams.get('panel') === '1',
		find: url.searchParams.get('find') === '1',
		// ADD from a source that adds hidden, with reveal off (card c435): the
		// preview lands here, since the hidden series isn't found, and says so,
		// with what ADD AND DOWNLOAD queued and UNDO (c505).
		addedHidden: await addedBand(source.id, url.searchParams),
		// Arrived from a tag (c313): ← returns to where it was tapped, never anywhere else.
		back: backOrigin(url.searchParams.get('from')),
		// Without script a streamed promise never resolves, so the page waits for it instead.
		answer: hasScript(cookies) ? answer : await answer
	};
};

export const actions: Actions = {
	/**
	 * UNDO on the ADDED band (c505): the series added hidden from this
	 * source's preview leaves the library again, as the series page's UNDO
	 * does (`undoAdd`), while nothing of it is downloaded or read, and the
	 * preview it was added from opens again. A band whose series is gone (UNDO
	 * twice, a reload after UNDO, a stale URL) undoes nothing and opens the
	 * preview too: the id alone is never trusted, since a later series may
	 * have been given it.
	 */
	undoAdd: async ({ params, request, cookies }) => {
		const source = browseSource(params.source, isRevealed(cookies));
		if (!source) error(404, 'not found');
		const form = await request.formData();
		const preview = String(form.get('preview') ?? '');
		const s = await bandSeries(source.id, String(form.get('series') ?? ''), preview);
		const back = isSourceMangaId(preview) ? `/downloads/source/${preview}` : `/browse/${source.id}`;
		if (!s) redirect(303, back);
		let undone: boolean;
		try {
			undone = await undoAdd(s.seriesId);
		} catch (e) {
			if (isDownloadsError(e)) return fail(503, { message: (e as Error).message });
			throw e;
		}
		if (!undone) return fail(409, { message: 'something of it is downloaded or read now' });
		redirect(303, back);
	}
};
