import { seriesPage } from '$lib/server/series';
import {
	isDownloadsError,
	isSourceMangaId,
	mangaKey,
	sourceOfMangaId,
	undoAdd
} from '$lib/server/downloads';
import { browseSource } from '$lib/server/engine/browse';
import { addedHere } from '$lib/server/engine/source-flags';
import { seriesWithOrigin, sourceOrigin } from '$lib/library/origin';
import { kindFacts } from '$lib/library/kinds';

/**
 * The ADDED band (cards c435, c505; doc/BROWSE.md, "Added hidden"): what a
 * preview's ADD outside reveal says when the source's ADDED HIDDEN switch hid
 * the series it added, since the series page it would land on is not found.
 * The band is its URL (`ADDED_PARAMS`), so it survives a reload, and it is
 * drawn in one of two places:
 *
 * - the source's own page, `/browse/<source>`, while the source is still
 *   found outside reveal;
 * - BROWSE, `/browse`, once it is not: the ADD itself can make the source
 *   mostly hidden (`mostlyHidden`, more than half its series hidden), which
 *   is what the first ADD from a source with ADDED HIDDEN on and nothing else
 *   here does. There the band names no source outside reveal, as CONCEAL's
 *   does (c523): hidden means not named. Inside reveal it is here, so the band
 *   names it and drops the REVEAL tail (c605).
 *
 * UNDO is the same on both, and asks only the band's own facts (the series'
 * id and key, through `addedHere`, and the preview it was added from), never
 * whether the source is found, so a band that was drawn can always be undone.
 */

/** The band's own URL parameters: replaced by a later ADD, never part of another link. */
export const ADDED_PARAMS = ['added', 'series', 'preview', 'queued'] as const;

export type Added = { seriesId: number; hidByThisAdd: boolean };

/**
 * Where ADD lands (c435, c505). Normally the new series. With reveal off a
 * series this ADD hid is not found, so it lands on the source's page (the
 * BROWSE page the preview came from, its place kept), or on BROWSE when the
 * ADD left the source mostly hidden, with the band's parameters. A series
 * ADD only answered with (already here, hidden for its own reasons: a stale
 * preview) gets no band, since the band would claim this ADD hid it and
 * offer UNDO on a series the ADD did not make; the page is just the
 * source's again (or BROWSE, if the source is not found).
 */
export function addedLanding(
	added: Added,
	mangaId: string,
	origin: string,
	reveal: boolean,
	params: Record<string, string>
): string {
	if (reveal || seriesPage(added.seriesId, false))
		return seriesWithOrigin(added.seriesId, origin, params);
	const source = sourceOfMangaId(mangaId);
	// Asked after the ADD: `addToLibrary` forgets BROWSE's counts, so this is fresh.
	const found = !!source && !!browseSource(source, false);
	const safe = sourceOrigin(origin);
	const page = !found ? '/browse' : safe.startsWith('/browse/') ? safe : `/browse/${source}`;
	// A band from an earlier ADD on the same page is replaced, not added to.
	const [path, search = ''] = page.split('?');
	const kept = new URLSearchParams(found ? search : '');
	for (const k of ADDED_PARAMS) kept.delete(k);
	if (added.hidByThisAdd) {
		kept.set('added', 'hidden');
		kept.set('series', String(added.seriesId));
		kept.set('preview', mangaId);
		if (params.queued) kept.set('queued', params.queued);
	}
	const q = kept.toString();
	return q ? `${path}?${q}` : path;
}

/**
 * The band's series, when its URL still names one: the one added from that
 * preview (`addedHere` checks its id and its key both), still in the library,
 * and, where the page is a source's (`sourceId`), from that source. Null when
 * it isn't (UNDO ran, or the URL is stale): then nothing is said.
 */
async function bandSeries(
	sourceId: string | null,
	seriesParam: string | null,
	preview: string | null
) {
	const seriesId = Number(seriesParam);
	if (!Number.isInteger(seriesId) || seriesId <= 0 || !preview || !isSourceMangaId(preview))
		return null;
	const source = sourceOfMangaId(preview);
	if (!source || (sourceId !== null && source !== sourceId)) return null;
	const key = await mangaKey(preview).catch(() => null);
	const here = key ? addedHere(seriesId, key) : null;
	return here && { seriesId, preview, source, ...here };
}

export type AddedBand = {
	seriesId: number;
	preview: string;
	entries: number;
	video: boolean;
	queued: string | null;
	/** UNDO's own refusal: something of it is downloaded or read. */
	touched: boolean;
	/** Whether the source is not found outside reveal now (BROWSE's band says so). */
	sourceHidden: boolean;
	/** The source's name, as this viewer may see it: null outside reveal when it is not found (c605). */
	sourceName: string | null;
};

/**
 * The band, from its URL: on a source's page `sourceId` is that source, and
 * on BROWSE it is null (any source's band, named by none).
 */
export async function addedBand(
	p: URLSearchParams,
	sourceId: string | null,
	reveal: boolean
): Promise<AddedBand | null> {
	if (p.get('added') !== 'hidden') return null;
	const s = await bandSeries(sourceId, p.get('series'), p.get('preview'));
	if (!s) return null;
	const queued = /^(\d+|down)$/.test(p.get('queued') ?? '') ? p.get('queued') : null;
	// Outside reveal the band is a hidden source's, and hidden means not named;
	// inside it the source is here, so the band says which one it is (c605).
	const outside = browseSource(s.source, false);
	const shown = reveal ? browseSource(s.source, true) : outside;
	return {
		seriesId: s.seriesId,
		preview: s.preview,
		entries: s.entries,
		video: kindFacts(s.kind).medium === 'video',
		queued,
		touched: s.touched,
		sourceHidden: !outside,
		sourceName: shown?.name ?? null
	};
}

/**
 * Where UNDO lands: the preview the series was added from, while its source
 * is found; BROWSE when it is not (the source is mostly hidden for other
 * series, so the preview would not be found either).
 */
export function afterUndo(preview: string, reveal: boolean): string {
	const source = isSourceMangaId(preview) ? sourceOfMangaId(preview) : null;
	return source && browseSource(source, reveal) ? `/downloads/source/${preview}` : '/browse';
}

/** The refusal words the band shows, and the e2e reads. */
export const UNDO_REFUSED = 'something of it is downloaded or read now';

/**
 * UNDO on the band: the series added hidden leaves the library again, as the
 * series page's UNDO does (`undoAdd`), while nothing of it is downloaded or
 * read, and the preview opens again. A band whose series is gone (UNDO twice,
 * a reload after UNDO, a stale URL) undoes nothing and lands the same: the id
 * alone is never trusted, since a later series may have been given it.
 */
export async function undoAdded(
	form: FormData,
	sourceId: string | null,
	reveal: boolean
): Promise<{ to: string } | { status: 409 | 503; message: string }> {
	const preview = String(form.get('preview') ?? '');
	const s = await bandSeries(sourceId, String(form.get('series') ?? ''), preview);
	if (s) {
		let undone: boolean;
		try {
			undone = await undoAdd(s.seriesId);
		} catch (e) {
			if (isDownloadsError(e)) return { status: 503, message: (e as Error).message };
			throw e;
		}
		if (!undone) return { status: 409, message: UNDO_REFUSED };
	}
	if (isSourceMangaId(preview)) return { to: afterUndo(preview, reveal) };
	return { to: sourceId ? `/browse/${sourceId}` : '/browse' };
}
