import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { minutesLeft, tvPairing } from '$lib/server/pairing';

/**
 * The computer's own view of the TV's six digits (doc/TV.md,
 * "Pairing"). SETTINGS shows them beside the phone's QR through `wifiView`;
 * this is the same code without a Wi-Fi panel in the way, and the one place
 * a test can read it.
 *
 * It answers only at the computer itself (localhost, 127.0.0.1): over Wi-Fi a
 * stranger must never be able to read the code that lets them in, and the
 * route exists on every install, WI-FI or not, so the guard is the host rather
 * than `locals.via` (the workstation's tailnet requests are `local` too).
 */
const onComputer = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

const view = (now: number) => {
	const c = tvPairing.current();
	return {
		code: c?.code ?? null,
		state: tvPairing.state(now),
		minutes: c ? minutesLeft(c, now) : 0,
		left: tvPairing.triesLeft()
	};
};

export const GET: RequestHandler = ({ url }) => {
	if (!onComputer(url)) error(403, 'the computer only');
	return json(view(Date.now()));
};

export const POST: RequestHandler = async ({ request, url }) => {
	if (!onComputer(url)) error(403, 'the computer only');
	const { action } = (await request.json().catch(() => ({}))) as { action?: string };
	if (action !== 'code') error(400, 'action is code');
	tvPairing.fresh(Date.now());
	return json(view(Date.now()));
};
