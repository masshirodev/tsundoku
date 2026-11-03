import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { seriesPage } from '$lib/server/series';
import { tagFiltersOf } from '../tag-source.server';

/**
 * The series' source's filters, for its TAGS sheet (card c313): asked when a
 * tag is first tapped, never by the screen's load (`tagFiltersOf`). Hidden
 * means hidden: a series reveal does not show is not found here either.
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const id = Number(params.id);
	const reveal = isRevealed(cookies);
	if (!Number.isInteger(id) || id <= 0 || !seriesPage(id, reveal)) error(404, 'not found');
	return json({ filters: await tagFiltersOf(id, reveal) });
};
