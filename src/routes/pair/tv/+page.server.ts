import { hostname } from 'node:os';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	PAIRED_COOKIE,
	PAIRED_COOKIE_OPTIONS,
	addPaired,
	pairedBy,
	pairedLabel,
	tvPairing
} from '$lib/server/pairing';

/**
 * A TV pairing itself with a typed code (c236; doc/TV.md, "Pairing";
 * TV-Pair.dc.html 9C and 9E). The app reaches this page once it has found the
 * computer; the computer's SETTINGS shows six digits beside the phone's QR.
 *
 * 9C and 9E are the computer's own route rather than the app's asset pages,
 * because the code is posted same-origin and the cookie that pairs the TV is
 * set here, exactly as `/pair/<code>` sets it for a phone: no CORS, no second
 * way to be signed in. That is also why this route is public (`hooks.server.ts`)
 * and why it never shows a code: the digits live on the computer's screen.
 */

const SIX = /^\d{6}$/;

const computerName = () => (hostname() || 'computer').toUpperCase();

/**
 * A TV that opened this page before anyone opened SETTINGS has nothing to
 * type, so one is made here. An expired or burned code is not silently
 * replaced: the computer's SETTINGS is where a new one comes from (9D's
 * reason, and the card's rule), and the band says so.
 */
function ensureCode(now: number) {
	if (tvPairing.state(now) === 'none') tvPairing.fresh(now);
}

export const load: PageServerLoad = ({ cookies, url }) => {
	const now = Date.now();
	const paired = pairedBy(cookies.get(PAIRED_COOKIE));
	if (paired)
		return { step: 'paired' as const, host: url.host, name: computerName(), state: null, left: 0 };

	ensureCode(now);
	// What the last try said (the redirect below): a band over the digits.
	const r = url.searchParams.get('r');
	const result =
		(['wrong', 'expired', 'used', 'burned', 'short'] as const).find((x) => x === r) ?? null;
	const left = Math.max(0, Math.min(5, Number(url.searchParams.get('left')) || 0));
	return {
		step: 'code' as const,
		host: url.host,
		name: computerName(),
		state: tvPairing.state(now),
		left,
		result
	};
};

export const actions: Actions = {
	/** PAIR →: the sixth digit submits it, and a wrong one spends a try. */
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const typed = String(form.get('code') ?? '').replace(/\D/g, '');
		if (!SIX.test(typed)) redirect(303, '/pair/tv?r=short');
		const ua = request.headers.get('user-agent') ?? '';
		const result = tvPairing.redeem(typed, Date.now(), pairedLabel(ua));
		if (result === 'ok') {
			const token = addPaired({ label: pairedLabel(ua), address: url.host });
			cookies.set(PAIRED_COOKIE, token, PAIRED_COOKIE_OPTIONS);
			redirect(303, '/pair/tv');
		}
		if (result === 'wrong') redirect(303, `/pair/tv?r=wrong&left=${tvPairing.triesLeft()}`);
		redirect(303, `/pair/tv?r=${result}`);
	}
};
