import { hostname } from 'node:os';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	PAIRED_COOKIE_OPTIONS,
	addPaired,
	pairedBy,
	pairedCookie,
	pairedLabel,
	readPaired,
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
 * A TV that opened this page with nothing it can type gets a code made here:
 * none yet, or one that has merely run out (c246; the owner's (b),
 * 2026-11-04). A burned code is not replaced -- five wrong tries need the
 * computer, 9D's reason -- and neither is a used one while the computer still
 * shows it ✓ USED (`TvPairing.renewForTv` has every state). The computer's
 * WI-FI panel and DEVICES row read the new digits on their next refresh.
 */
const ensureCode = (now: number) => tvPairing.renewForTv(now);

/**
 * The state the page draws. A burned code is burned for good, so one past its
 * 10 minutes still says NO TRIES LEFT rather than THIS CODE EXPIRED, whose
 * remedy (a new code) this page would otherwise seem to owe it.
 */
const shown = (now: number) =>
	tvPairing.triesLeft() === 0 && tvPairing.state(now) === 'expired'
		? ('burned' as const)
		: tvPairing.state(now);

export const load: PageServerLoad = ({ cookies, url }) => {
	const now = Date.now();
	const paired = readPaired(cookies, url, (t) => pairedBy(t));
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
		state: shown(now),
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
			// This origin's name (c530): another tsundoku on the computer keeps its own.
			cookies.set(pairedCookie(url), token, PAIRED_COOKIE_OPTIONS);
			redirect(303, '/pair/tv');
		}
		if (result === 'wrong') redirect(303, `/pair/tv?r=wrong&left=${tvPairing.triesLeft()}`);
		redirect(303, `/pair/tv?r=${result}`);
	}
};
