import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	PAIRED_COOKIE_OPTIONS,
	addPaired,
	pairedCookie,
	pairedLabel,
	pairing
} from '$lib/server/pairing';

/**
 * What a pairing code opens (doc/WIFI.md): the phone's camera reads
 * the code on the computer's SETTINGS and opens this. Once, within its 10
 * minutes, it signs the phone in as a device of its own and shows the
 * welcome screen; a used or expired code goes to the sign-in page, which
 * says which. A phone that's already in goes straight to the library.
 * Only over Wi-Fi: on the computer itself there's nothing to pair.
 */
export const GET: RequestHandler = ({ params, request, cookies, locals, url }) => {
	if (locals.via !== 'lan' || locals.paired) redirect(303, '/');
	const ua = request.headers.get('user-agent') ?? '';
	const result = pairing.redeem(params.code, Date.now(), pairedLabel(ua));
	if (result !== 'ok')
		// A code replaced by a newer one reads as expired: it's the same remedy.
		redirect(303, `/login?pair=${result === 'used' ? 'used' : 'expired'}`);
	const token = addPaired({ label: pairedLabel(ua), address: url.host });
	// This origin's name: another tsundoku on the computer keeps its own.
	cookies.set(pairedCookie(url), token, PAIRED_COOKIE_OPTIONS);
	redirect(303, '/welcome');
};
