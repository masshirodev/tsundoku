import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { addableSeries, workPage } from '$lib/server/works';

/**
 * The + ADD A SERIES picker's own read (doc/WORKS.md). The Work screen's load
 * never carries the library: this answers one page, filtered in SQL, when the
 * sheet opens and again as the reader types. A Work hidden with reveal off is
 * the same 404 as one that does not exist.
 */
export const GET: RequestHandler = ({ params, url, cookies }) => {
	const id = Number(params.id);
	const reveal = isRevealed(cookies);
	if (!Number.isInteger(id) || id <= 0 || !workPage(id, { reveal })) error(404, 'not found');
	const q = url.searchParams.get('q') ?? '';
	const offset = Number(url.searchParams.get('offset') ?? '0');
	// The sheet sends the page size it wants; `addableSeries` clamps it to
	// GRID_PAGE, and falls back to that same page when nothing is sent.
	const sendLimit = url.searchParams.get('limit');
	const limit = sendLimit === null ? undefined : Number(sendLimit);
	return json(addableSeries(id, reveal, { q, offset, limit }), {
		headers: { 'cache-control': 'private, no-store' }
	});
};
