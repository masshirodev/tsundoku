import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { askOne, asksSource, movable } from '../access.server';

/**
 * One source asked the move page's query again (card c490): TRY AGAIN and
 * TRY ALL AGAIN re-ask only the sources that did not answer, never every
 * source. Only a source MOVE asks for this series answers; another is 404.
 * Answers the list's own Settled.
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const { reveal, state } = movable(params.id, cookies);
	const q = (url.searchParams.get('q') ?? '').trim();
	const source = url.searchParams.get('source') ?? '';
	if (!q || !(await asksSource(state, reveal, source))) error(404, 'not found');
	return json(await askOne(source, q, reveal), { headers: { 'cache-control': 'no-store' } });
};
