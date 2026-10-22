import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { configured } from '$lib/server/suwayomi';
import { suwayomiAuth } from '$lib/server/suwayomi-auth';

/**
 * A search result's cover, from Suwayomi on localhost (Download States 1e):
 * the browser would need Suwayomi's login, so tsundoku passes it on. Only results
 * the viewer was shown link here.
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!configured() || !Number.isInteger(id) || id <= 0) error(404, 'not found');
	let res: Response;
	try {
		const url = `${process.env.SUWAYOMI_URL}/api/v1/manga/${id}/thumbnail`;
		res = await fetch(url, {
			headers: suwayomiAuth(url),
			signal: AbortSignal.timeout(15_000)
		});
	} catch {
		error(504, 'Suwayomi is not answering');
	}
	if (!res.ok || !res.body) error(404, 'no cover');
	return new Response(res.body, {
		headers: {
			'content-type': res.headers.get('content-type') ?? 'image/jpeg',
			'cache-control': 'private, max-age=86400'
		}
	});
};
