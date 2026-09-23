import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startScan } from '$lib/server/import';

/**
 * START SCAN, for a script: the sync timer asks the running app to import
 * (doc/SYNC.md), so there is only ever one import at a time -- a second
 * process importing beside the app's own scan would race it. Behind the
 * session like every route. Answers at once; the scan runs on.
 */
export const POST: RequestHandler = () => {
	const r = startScan();
	return json(r, { status: r.started ? 202 : 200 });
};
