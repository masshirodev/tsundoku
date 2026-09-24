import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { cropsFor } from '$lib/server/pages/crops';

/**
 * A chapter's page borders, for CROP BORDERS (doc/READER.md, "Crop borders"):
 * one inset per page, measured on the workstation the first time. Hidden
 * means hidden: a 404 while reveal is off.
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const crops = await cropsFor(Number(params.id), isRevealed(cookies));
	if (!crops) error(404, 'not found');
	return json({ crops }, { headers: { 'cache-control': 'private, max-age=86400' } });
};
