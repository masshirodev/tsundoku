import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setWifi, wifiView } from '$lib/server/wifi';

/**
 * WI-FI (doc/WIFI.md): the panel's view, polled while it's open so the code
 * counts down and turns USED when a phone scans it (GET), and ON, OFF and NEW
 * CODE (POST). Only on the computer itself: a phone over Wi-Fi sees the row,
 * never switches it (3E), and a code is no use on the screen that scans it.
 * The TV's six digits (c236) travel with it, and NEW CODE replaces both.
 */
export const GET: RequestHandler = ({ locals }) => {
	const view = wifiView();
	if (!view) error(404, 'no Wi-Fi here');
	return json(locals.via === 'lan' ? { ...view, code: null, tv: null } : view);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!wifiView()) error(404, 'no Wi-Fi here');
	if (locals.via === 'lan') error(403, 'set on the computer only');
	const { action } = (await request.json().catch(() => ({}))) as { action?: string };
	if (action === 'on' || action === 'off') {
		await setWifi(action === 'on');
		return json(wifiView({ fresh: action === 'on' }));
	}
	if (action === 'code') return json(wifiView({ fresh: true }));
	error(400, 'action is on, off or code');
};
