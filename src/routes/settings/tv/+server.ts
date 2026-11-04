import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tvBlockHere, tvPanel } from '$lib/server/wifi';

/**
 * The DEVICES row's TV code, as the SETTINGS load would give it now (c265;
 * doc/WIFI.md, "Where they show"). The row asks while it shows a live code and
 * once more whenever the window comes back, so a code a TV used or burned
 * while SETTINGS stayed open stops showing as live without a NEW CODE press:
 * the whole page load is too heavy to repeat every few seconds.
 *
 * The same door as the load and `?/tvCode` (`tvBlockHere`): where the block is
 * not drawn this answers `null` and makes nothing, since `tvPanel` replaces a
 * spent code, and no door may make a code nothing on its screen can use (c264).
 */
export const GET: RequestHandler = ({ locals }) =>
	json(
		{ tv: tvBlockHere(locals) ? tvPanel() : null },
		{ headers: { 'cache-control': 'no-store' } }
	);
