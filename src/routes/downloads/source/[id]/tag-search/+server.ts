import { error, json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolve } from '$app/paths';
import { isRevealed } from '$lib/server/prefs';
import { configured, isSourceMangaId, sourceOfMangaId } from '$lib/server/downloads';
import { browseSource, filterSchema } from '$lib/server/engine/browse';
import {
	TAG_SCHEMA_WAIT_MS,
	readTagRoute,
	settleWithin,
	tagSearchHref
} from '$lib/library/tag-search';

/**
 * A preview's author, artist or genre (doc/BROWSE.md, "Arriving
 * from a tag"): the preview's own source finding it. The preview's links name
 * the tag, so they are right from the first paint, with or without script;
 * this waits for the source's filters (kept per source, `keep`) and answers
 * 303 to the filter the genre names, or to a search for the value when the
 * filters do not name it, fail, or have not answered in `TAG_SCHEMA_WAIT_MS`.
 *
 * Access is the preview's own: the engine configured, a source manga id, and
 * a source BROWSE lists with this reveal (a mostly-hidden source is not found
 * with reveal off).
 */
export const GET: RequestHandler = async ({ params, url, cookies, request }) => {
	const asked = readTagRoute(url);
	const sourceId =
		asked && configured() && isSourceMangaId(params.id) ? sourceOfMangaId(params.id) : null;
	const source = sourceId ? browseSource(sourceId, isRevealed(cookies)) : null;
	if (!asked || !source) error(404, 'not found');
	const schema = await settleWithin(filterSchema(source.id), TAG_SCHEMA_WAIT_MS, []);
	const to = tagSearchHref(
		resolve('/browse/[source]', { source: source.id }),
		schema,
		asked.tag,
		asked.from || null
	);
	// While SELECT is on the preview asks for the address and goes
	// there itself, inside the app: a document load would end the selection,
	// which lives in the tab's memory, and a tag's arrival is part of the
	// browse world it lasts through. The answer is the same address.
	if (request.headers.get('accept')?.includes('application/json')) return json({ to });
	redirect(303, to);
};
