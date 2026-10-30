import type { RequestHandler } from './$types';
import { buildReport } from '$lib/server/report';

/**
 * SAVE A REPORT (doc/LOGS.md; card c193): the scrubbed report as a file to
 * save and send. Signed in only (the hook), and never cached.
 */
export const GET: RequestHandler = async () => {
	const now = new Date();
	return new Response(await buildReport(now), {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'content-disposition': `attachment; filename="tsundoku-report-${now.toISOString().slice(0, 10)}.txt"`,
			'cache-control': 'no-store'
		}
	});
};
