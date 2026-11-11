import { seriesPage } from '$lib/server/series';
import { isSourceMangaId, mangaKey, sourceOfMangaId, undoAdd } from '$lib/server/downloads';
import { browseSource } from '$lib/server/engine/browse';
import { addedHere } from '$lib/server/engine/source-flags';
import { seriesWithOrigin, sourceOrigin } from '$lib/library/origin';
import { kindFacts } from '$lib/library/kinds';
import { keepOrigin } from '$lib/library/tag-search';
import {
	collectionExists,
	createCollection,
	seriesDetail,
	setInCollection
} from '$lib/server/library';

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
export const ADDED_PARAMS = ['added', 'series', 'preview', 'queued', 'catalog'] as const;

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
		// The catalog the entry was found in, for the band's UNDO to hand back to
		// the preview (wave 46): recorded here, where the ADD still knows it, and
		// only when there was one — a shared link's preview has no catalog behind
		// it, and an invented `from=` would make ← point at a place the entry was
		// never found. The page itself is a source's, so the preview answers it.
		if (found && safe.startsWith('/browse/')) kept.set('catalog', safe);
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
 * The shelves (collection ids) a drawn band's series is on now, for its chips
 * (card c724): the SHELVES row's own read (`seriesDetail`), whatever reveal
 * says, since the band was drawn for this viewer already. Beside the band, not
 * in it, so the band's own facts stay what they were (c505's specs pin them).
 */
export const bandShelves = (band: AddedBand | null): number[] =>
	band ? (seriesDetail(band.seriesId, true)?.collections ?? []) : [];

/** A chip tapped on a band whose series has gone (UNDO, another tab): the words the band shows. */
export const SHELVE_GONE = 'the series is not in the library now';

/**
 * PUT ON A SHELF from the ADDED band (card c724; doc/BROWSE.md, "Shelves in
 * the ADD band"): one chip's tap, on (`on=1`) or off (`on=0`), through the
 * SHELVES sheet's own write (`setInCollection`). It asks the band's own facts
 * (`bandSeries`: the series' id and key, from that preview), as UNDO does, so
 * a chip tapped after UNDO, or on a band whose URL is stale, shelves nothing:
 * the id alone is never trusted, since a later series may have been given it.
 * A second tap of the same chip is the same write again (`INSERT OR IGNORE`,
 * or a delete of nothing).
 */
export async function shelveAdded(
	form: FormData,
	sourceId: string | null
): Promise<{ collection: number; on: boolean } | { status: 400 | 409; message: string }> {
	const s = await bandSeries(
		sourceId,
		String(form.get('series') ?? ''),
		String(form.get('preview') ?? '')
	);
	if (!s) return { status: 409, message: SHELVE_GONE };
	const collection = Number(form.get('collection'));
	if (!Number.isInteger(collection) || !collectionExists(collection))
		return { status: 400, message: 'no such shelf' };
	const on = form.get('on') !== '0';
	setInCollection([s.seriesId], collection, on);
	return { collection, on };
}

/**
 * + NEW SHELF from the ADDED band: `NewShelfSheet` as it is, whose form posts
 * only `name` to `?/newShelf`. The band is its page's URL, and a form's
 * relative `?/newShelf` drops that query, so the band is read from where the
 * post came from (`Referer`, sent in full to the same origin under the
 * browsers' default policy), and only when that is this page (`path`) on this
 * origin. The shelf is made and the series put on it only while the band's own
 * facts hold, as for a chip; it lands back on the band, the sheet closed.
 */
export async function newShelfAdded(
	form: FormData,
	referer: string | null,
	here: URL,
	sourceId: string | null
): Promise<{ to: string; collection: number } | { status: 400 | 409; message: string }> {
	const name = String(form.get('name') ?? '').trim();
	if (name === '') return { status: 400, message: 'a shelf needs a name' };
	let from: URL;
	try {
		from = new URL(referer ?? '');
	} catch {
		return { status: 409, message: SHELVE_GONE };
	}
	if (from.origin !== here.origin || from.pathname !== here.pathname)
		return { status: 409, message: SHELVE_GONE };
	const p = from.searchParams;
	const s =
		p.get('added') === 'hidden'
			? await bandSeries(sourceId, p.get('series'), p.get('preview'))
			: null;
	if (!s) return { status: 409, message: SHELVE_GONE };
	const collection = createCollection(name);
	setInCollection([s.seriesId], collection, true);
	p.delete('new');
	const q = p.toString();
	return { to: `${from.pathname}${q ? `?${q}` : ''}`, collection };
}

/**
 * Where UNDO lands: the preview the series was added from, while its source
 * is found; BROWSE when it is not (the source is mostly hidden for other
 * series, so the preview would not be found either). Two values put the way
 * back on the preview's URL, and the first that is real wins:
 *
 * - `catalog`, the BROWSE page the ADD was made from, as `addedLanding`
 *   recorded it (wave 46): the preview's ← says BROWSE and one swipe back is
 *   that list at its place. Its own query rides along, so a tag origin the
 *   source's page carried is still there.
 * - `origin`, the tag origin the source's page was opened with, already
 *   through `backOrigin` (c690). A preview's ← takes only a source's page or
 *   the search (`sourceOrigin`), never that origin itself, so it goes where
 *   the tile's did before the ADD: to the source's page, whose own ← is the
 *   tag's screen.
 *
 * With neither — a preview opened by a shared link, which has nothing in the
 * app behind it — no `from=` is written at all: ← says SOURCES, and one swipe
 * back leaves the app.
 */
export function afterUndo(
	preview: string,
	reveal: boolean,
	origin = '',
	/** The catalog the entry was found in, as the ADD recorded it, or ''. */
	catalog = ''
): string {
	const source = isSourceMangaId(preview) ? sourceOfMangaId(preview) : null;
	if (!source || !browseSource(source, reveal)) return '/browse';
	const home = sourceOrigin(catalog);
	const back = home.startsWith('/browse/')
		? home
		: origin
			? keepOrigin(`/browse/${source}`, origin)
			: '';
	return keepOrigin(`/downloads/source/${preview}`, back);
}

/** The refusal words the band shows, and the e2e reads. */
export const UNDO_REFUSED = 'something of it is downloaded or read now';

/**
 * Where a refused UNDO lands when the page that drew the band can no longer
 * answer for it (c605): BROWSE, which draws any band, with the band's own
 * parameters and the refusal's **code**, which BROWSE's load turns back into
 * the words (`refusedWords`). UNDO has one refusal: `undoAdd` is a local
 * DELETE, which never asks the engine (c690).
 */
export function refusedLanding(form: FormData, queued: string | null): string {
	const p = new URLSearchParams({
		added: 'hidden',
		series: String(form.get('series') ?? ''),
		preview: String(form.get('preview') ?? ''),
		refused: '409'
	});
	if (queued && /^(\d+|down)$/.test(queued)) p.set('queued', queued);
	return `/browse?${p}`;
}

/** A `refused` code in BROWSE's URL as the band's words, or null when there is none. */
export function refusedWords(code: string | null): string | null {
	return code === '409' ? UNDO_REFUSED : null;
}

/**
 * The refusal a `refused=` code still stands for, or null once it no longer
 * does (c664). A reload used to keep "NO UNDO" and draw no UNDO after the
 * cause had gone, although UNDO would have succeeded. So the load asks again:
 * a 409 is "something of it is downloaded or read now", which the band's own
 * `touched` is (the same query `undoAdd` refuses on). With no band drawn there
 * is no place for the words, and the code is the URL's alone.
 */
export function standingRefusal(code: string | null, band: AddedBand | null): string | null {
	const words = refusedWords(code);
	return words && band?.touched ? words : null;
}

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
	reveal: boolean,
	origin = ''
): Promise<{ to: string } | { status: 409; message: string }> {
	const preview = String(form.get('preview') ?? '');
	const s = await bandSeries(sourceId, String(form.get('series') ?? ''), preview);
	if (s && !(await undoAdd(s.seriesId))) return { status: 409, message: UNDO_REFUSED };
	if (isSourceMangaId(preview))
		return { to: afterUndo(preview, reveal, origin, String(form.get('catalog') ?? '')) };
	return { to: sourceId ? `/browse/${sourceId}` : '/browse' };
}
