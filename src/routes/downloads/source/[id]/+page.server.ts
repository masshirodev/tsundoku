import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import {
	addToLibrary,
	configured,
	isAddError,
	isSourceMangaId,
	mangaKey,
	seriesForKey,
	sourceManga,
	sourceOfMangaId
} from '$lib/server/downloads';
import { browseSource } from '$lib/server/engine/browse';

/**
 * A search result's preview (Download States 1e, state 7): the series
 * screen's layout with what the source gave, and + ADD TO LIBRARY in
 * CONTINUE's place. Nothing downloads from here. A result tsundoku already
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
	const mine = seriesForKey(key);
	if (mine) {
		if (mine.hidden && !isRevealed(cookies)) error(404, 'not found');
		redirect(303, `/series/${mine.id}`);
	}
	// Hidden means hidden: a mostly-hidden source's series isn't previewed with reveal off.
	const sourceId = sourceOfMangaId(id);
	if (!sourceId || !browseSource(sourceId, isRevealed(cookies))) error(404, 'not found');
	const manga = sourceManga(id);
	manga.catch(() => {});
	// Back to where it was found: a source's BROWSE page, or the search.
	const from = url.searchParams.get('from') ?? '';
	return {
		id,
		q: url.searchParams.get('q') ?? '',
		from: from.startsWith('/browse/') && !from.startsWith('//') ? from : '',
		manga
	};
};

export const actions: Actions = {
	/** + ADD TO LIBRARY: into both libraries, then the new series, with a band to UNDO. */
	add: async ({ params }) => {
		const id = mangaId(params.id);
		let seriesId: number;
		try {
			seriesId = await addToLibrary(id);
		} catch (e) {
			if (isAddError(e)) return fail(409, { message: (e as Error).message });
			throw e;
		}
		redirect(303, `/series/${seriesId}?added=${id}`);
	}
};
