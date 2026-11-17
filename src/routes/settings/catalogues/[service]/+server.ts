import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { configured, signInFinish, signInStart } from '$lib/server/tracking';
import { SERVICES, type Service } from '$lib/library/tracking';

const COOKIE = 'tsundoku_oauth';

/**
 * SIGN IN →, both halves (doc/TRACKING.md). Without a code: off to the
 * catalogue, with a state (and MAL's verifier) kept in a short cookie. With
 * one: the catalogue sending the user back here -- the redirect registered
 * with each app is exactly this address -- and back to SETTINGS, saying how
 * it went. Behind the session, like every route.
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const service = params.service as Service;
	if (!SERVICES.includes(service)) error(404, 'not found');
	// The address the catalogue knows: the tailnet's, not 127.0.0.1 behind tailscale serve.
	const origin = process.env.ORIGIN ?? url.origin;
	const code = url.searchParams.get('code');
	const back = (q: string) => redirect(303, `/settings?${q}`);

	if (!code) {
		if (url.searchParams.has('error')) back(`signin=refused&service=${service}`);
		if (!configured(service)) back(`signin=unconfigured&service=${service}`);
		const { url: to, keep } = signInStart(service, origin);
		cookies.set(COOKIE, keep, {
			path: '/settings/catalogues',
			httpOnly: true,
			secure: url.protocol === 'https:',
			// The way back is a top-level GET from the catalogue: lax lets the cookie ride along.
			sameSite: 'lax',
			maxAge: 600
		});
		redirect(302, to);
	}

	const kept = cookies.get(COOKIE) ?? '';
	cookies.delete(COOKIE, { path: '/settings/catalogues' });
	try {
		await signInFinish(service, origin, {
			code,
			state: url.searchParams.get('state') ?? '',
			kept
		});
	} catch (e) {
		console.error(`tsundoku: signing in to ${service} failed:`, (e as Error).message);
		back(`signin=failed&service=${service}`);
	}
	back(`signin=ok&service=${service}`);
	return new Response(null);
};
