import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { seriesPage } from '$lib/server/series';
import {
	addToLibrary,
	configured,
	isAddError,
	isDownloadsError,
	isSourceMangaId,
	mangaKey,
	openFromSource,
	queueSeries,
	seriesForKey,
	sourceManga,
	sourceOfMangaId,
	entryKey
} from '$lib/server/downloads';
import { forgetRecord, recordView } from '$lib/server/browsing';
import { browseSource, filterSchema } from '$lib/server/engine/browse';
import type { FilterField } from '$lib/library/browse-filters';
import { searchOrigin, seriesWithOrigin, sourceOrigin } from '$lib/library/origin';

/**
 * A search result's preview (Download States 1e, state 7): the series
 * screen's layout with what the source gave, and + ADD TO LIBRARY in
 * CONTINUE's place. Downloading from here adds it first, after asking (ADD
 * AND DOWNLOAD, card c205). A result tsundoku already
 * has opens its series instead; a hidden one, with reveal off, is not found.
 */
function mangaId(raw: string): string {
	if (!configured() || !isSourceMangaId(raw)) error(404, 'not found');
	return raw;
}

export const load: PageServerLoad = async ({ params, cookies, url }) => {
	const id = mangaId(params.id);
	let key: string | null;
	try {
		key = await mangaKey(id);
	} catch {
		error(503, 'Downloading is not answering');
	}
	if (!key) error(404, 'not found');
	// Back to where it was found: a source's BROWSE page, or the search. The
	// series keeps it when it's added, or when it already was (card c262).
	const q = url.searchParams.get('q') ?? '';
	const from = sourceOrigin(url.searchParams.get('from'));
	const browsed = from.startsWith('/browse/') ? from : '';
	const origin = browsed || searchOrigin(q);
	const mine = seriesForKey(key);
	if (mine) {
		if (mine.hidden && !isRevealed(cookies)) error(404, 'not found');
		redirect(303, seriesWithOrigin(mine.id, origin));
	}
	// Hidden means hidden: a mostly-hidden source's series isn't previewed with reveal off.
	const sourceId = sourceOfMangaId(id);
	if (!sourceId || !browseSource(sourceId, isRevealed(cookies))) error(404, 'not found');
	// A browsing record of it (doc/BROWSING.md): what was watched, where it
	// stopped, and when it goes. Rows are matched by their address at the source.
	const record = recordView(key);
	const manga = sourceManga(id).then((m) =>
		m && record
			? {
					...m,
					states: Object.fromEntries(
						m.chapters.map((c) => [c.id, record.entries[entryKey(c.url)] ?? null])
					)
				}
			: m
	);
	manga.catch(() => {});
	// The source's filters, for author, artist and genre to search it (c313):
	// streamed, so a slow or absent engine never holds the preview, and a
	// failure is no schema (a search for the value). Asked only once the manga
	// has settled: calls into one extension run one at a time (`inLane`,
	// engine/client.ts), and asked beside it a slow schema held the details.
	// Kept by the source's own cache (`keep`), which the source page answers from.
	const schema: Promise<FilterField[]> = manga
		.then(
			() => undefined,
			() => undefined
		)
		.then(() => filterSchema(sourceId))
		.catch(() => []);
	return {
		id,
		sourceId,
		schema,
		q,
		from: browsed,
		origin,
		record: record && { ...record, entries: undefined },
		manga
	};
};

export const actions: Actions = {
	/**
	 * An episode, played without ADD (doc/BROWSING.md; card c161): the series
	 * becomes a browsing record on the first open, on no shelf, its progress and
	 * HISTORY kept for ADD later.
	 */
	/** FORGET: the record's place and marks go now; HISTORY keeps its reading, dimmed. */
	forget: async ({ params }) => {
		const key = await mangaKey(mangaId(params.id)).catch(() => null);
		const record = key ? recordView(key) : null;
		if (record) forgetRecord(record.seriesId);
		return { forgotten: true };
	},
	open: async ({ params, request }) => {
		const id = mangaId(params.id);
		const ep = String((await request.formData()).get('ep') ?? '');
		if (!ep) return fail(400, { message: 'no episode' });
		let entryId: number | null;
		try {
			entryId = await openFromSource(id, ep);
		} catch (e) {
			if (isAddError(e)) return fail(409, { message: (e as Error).message });
			throw e;
		}
		if (entryId === null) return fail(409, { message: 'that can’t open without adding yet' });
		redirect(303, `/read/${entryId}`);
	},
	/** + ADD TO LIBRARY: into both libraries, then the new series, with a band to UNDO. */
	add: async ({ params, request }) => {
		const id = mangaId(params.id);
		const origin = String((await request.formData()).get('from') ?? '');
		let seriesId: number;
		try {
			seriesId = await addToLibrary(id);
		} catch (e) {
			if (isAddError(e)) return fail(409, { message: (e as Error).message });
			throw e;
		}
		redirect(303, seriesWithOrigin(seriesId, origin, { added: id }));
	},
	/**
	 * DOWNLOAD's FIRST 10 or ALL N, confirmed (card c205): a download lives in
	 * the library, so it's ADD, then the queue, then the new series. The add
	 * stands if the queue doesn't answer: the series' own DOWNLOAD row says
	 * so, and the band says how many were queued.
	 */
	addDownload: async ({ params, request, cookies }) => {
		const id = mangaId(params.id);
		const form = await request.formData();
		const which = form.get('which') === 'all' ? 'all' : 'next';
		const origin = String(form.get('from') ?? '');
		let seriesId: number;
		try {
			seriesId = await addToLibrary(id);
		} catch (e) {
			if (isAddError(e)) return fail(409, { message: (e as Error).message });
			throw e;
		}
		const s = seriesPage(seriesId, isRevealed(cookies));
		let queued = 'none';
		try {
			const r = s ? await queueSeries(seriesId, s.entries, which) : null;
			if (r) queued = String(r.queued);
		} catch (e) {
			if (!isDownloadsError(e)) throw e;
			queued = 'down';
		}
		redirect(303, seriesWithOrigin(seriesId, origin, { added: id, queued }));
	}
};
