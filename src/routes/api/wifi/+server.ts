import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setWifi, wifiAnswer, wifiStatus } from '$lib/server/wifi';

/**
 * WI-FI (doc/WIFI.md): the panel's view, polled while it's open so the code
 * counts down and turns USED when a phone scans it (GET), and ON, OFF and NEW
 * CODE (POST). Only on the computer itself: a phone over Wi-Fi sees the row,
 * never switches it, and a code is no use on the screen that scans it.
 * The TV's six digits travel with it, and NEW CODE replaces both.
 *
 * The poll reads the codes as they are and never makes one: a burned
 * TV code stays burned until NEW CODE or the page is opened again, so five
 * wrong guesses on `/pair/tv` don't buy five more every 5 s.
 *
 * Every answer carries the firewall's line (`wifiAnswer`), so the poll
 * can draw NO PHONE HAS REACHED THIS COMPUTER YET and a press never drops it.
 * Over Wi-Fi, none of it: the phone is never shown the panel.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const view = await wifiAnswer();
	if (!view) error(404, 'no Wi-Fi here');
	return json(
		locals.via === 'lan'
			? { ...view, code: null, tv: null, firewall: null, noPhoneYet: false }
			: view
	);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!wifiStatus()) error(404, 'no Wi-Fi here');
	if (locals.via === 'lan') error(403, 'set on the computer only');
	const { action } = (await request.json().catch(() => ({}))) as { action?: string };
	if (action === 'on' || action === 'off') {
		await setWifi(action === 'on');
		return json(await wifiAnswer({ fresh: action === 'on' }));
	}
	if (action === 'code') return json(await wifiAnswer({ fresh: true }));
	error(400, 'action is on, off or code');
};
