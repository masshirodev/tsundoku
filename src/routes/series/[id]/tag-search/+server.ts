import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolve } from '$app/paths';
import { isRevealed } from '$lib/server/prefs';
import { filterSchema } from '$lib/server/engine/browse';
import {
	TAG_SCHEMA_WAIT_MS,
	readTagRoute,
	settleWithin,
	tagSearchHref
} from '$lib/library/tag-search';
import { tagSourceOf } from '../tag-source.server';

/**
 * A series' TAGS sheet, IN <SOURCE> (card c313; doc/SERIES.md, the TAGS row):
 * the source's page finding the tag. The link names the tag, not the answer,
 * so it is the same from the first paint and works without script; this
 * waits for the source's filters (kept per source, `keep`) and only then
 * says where to go: the filter the genre names, or a search for the value
 * when the filters do not name it, fail, or have not answered in
 * `TAG_SCHEMA_WAIT_MS`. It never guesses before they have settled.
 *
 * Access is the sheet's own (`tagSourceOf`): a series that is hidden with
 * reveal off, or has no source BROWSE can open, is not found.
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const id = Number(params.id);
	const asked = readTagRoute(url);
	const source =
		Number.isInteger(id) && id > 0 && asked ? tagSourceOf(id, isRevealed(cookies)) : null;
	if (!asked || !source) error(404, 'not found');
	const schema = await settleWithin(filterSchema(source.id), TAG_SCHEMA_WAIT_MS, []);
	redirect(
		303,
		tagSearchHref(
			resolve('/browse/[source]', { source: source.id }),
			schema,
			asked.tag,
			asked.from || null
		)
	);
};
