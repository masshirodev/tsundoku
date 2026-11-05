import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tvBlockHere, tvCodeNow } from '$lib/server/wifi';

/**
 * The DEVICES row's TV code as it is now (c265; doc/WIFI.md, "Where they
 * show"). The row asks every 5 s while it shows anything but a burned code
 * (expired since c246, used and no code at all since its round 2: the TV's
 * /pair/tv makes a new one in place of those) and once more whenever the
 * window comes back, so a code a TV used or burned while SETTINGS stayed open
 * stops showing as live without a NEW CODE press, and one a TV made shows
 * up: the whole page load is too heavy to repeat every few seconds.
 *
 * Read only (`tvCodeNow`): it answers live, used, expired or burned and never
 * makes a code. A refresh that replaced a burned code would undo the burn
 * within one poll, and five wrong tries would lock no one out (round 2). On
 * the computer, NEW CODE and a real visit to SETTINGS (c531) are the only
 * ways a new code is made; the TV's own /pair/tv makes one only in place of
 * none, an expired one or one used over 2 minutes ago (c246, `renewForTv`).
 *
 * The same door as the load and `?/tvCode` (`tvBlockHere`): where the block is
 * not drawn this answers `null`, so no screen learns a code it cannot use (c264).
 */
export const GET: RequestHandler = ({ locals }) =>
	json(
		{ tv: tvBlockHere(locals) ? tvCodeNow() : null },
		{ headers: { 'cache-control': 'no-store' } }
	);
