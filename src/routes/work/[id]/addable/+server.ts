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
	return json(addableSeries(id, reveal, { q, offset }), {
		headers: { 'cache-control': 'private, no-store' }
	});
};
