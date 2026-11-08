import { error, json } from '@sveltejs/kit';
import { seasonNamed } from '$lib/library/catalogue';
import { seriesAccess } from '$lib/server/catalogue';
import { isRevealed } from '$lib/server/prefs';
import { seriesSeasons } from '$lib/server/season-links';
import { seasonReview } from '../review-state.server';
import type { RequestHandler } from './$types';

/**
 * The one season `/links?series=N` is on, as it stands now (c644): after LINK
 * N SEASONS' UNDO the page redraws it from here, since what the post answered
 * (c465) is what that UNDO just took back. The page's own load would do, but
 * it also walks AniList for the relations, seconds of paced requests. The same
 * reader as that load, the same 404 for a series the visitor cannot see.
 */
export const GET: RequestHandler = ({ url, cookies }) => {
	const id = Number(url.searchParams.get('series'));
	const access = Number.isInteger(id) ? seriesAccess(id, isRevealed(cookies)) : null;
	if (!access) error(404, 'not found');
	const view = seriesSeasons(id);
	const no = seasonNamed(url.searchParams.get('season'));
	const at = view?.seasons.find((s) => s.season === no) ?? null;
	const review = at ? seasonReview(id, at, view!.seasons.length, access.hidden) : null;
	if (!review) error(404, 'not found');
	return json(review);
};
