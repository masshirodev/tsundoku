import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { manifest } from '$lib/server/pages';

/** An entry's pages: how many, and each one's size, before any loads. */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const m = await manifest(Number(params.id), isRevealed(cookies));
	if (!m) error(404, 'not found');
	return json(m);
};
