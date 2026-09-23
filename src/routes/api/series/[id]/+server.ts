import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { seriesDetail } from '$lib/server/library';
import { isRevealed } from '$lib/server/prefs';

/**
 * What the long-press sheet shows about one series. A hidden series answers
 * 404 while reveal is off -- the same answer as a series that does not exist,
 * so the endpoint cannot be used to learn that one does.
 */
export const GET: RequestHandler = ({ params, cookies }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'not found');
	const detail = seriesDetail(id, isRevealed(cookies));
	if (!detail) error(404, 'not found');
	return json(detail);
};
