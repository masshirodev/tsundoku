import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	authMode,
	checkToken,
	currentLogin,
	friendLogin,
	sessionValueFor,
	setSession,
	slowDown
} from '$lib/server/auth';
import { sessionFor, verifyPassword } from '$lib/server/login';
import { m } from '$lib/paraglide/messages';

/** Where to go once signed in: a path in this app, never another site (`?next=//evil.example`). */
const nextOf = (url: URL) => {
	const next = url.searchParams.get('next') ?? '';
	return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
};

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.authed) redirect(303, nextOf(url));
	// A pairing code that no longer works, sent here by /pair (doc/WIFI.md, 3B and 3C).
	const pair =
		(['expired', 'used'] as const).find((p) => p === url.searchParams.get('pair')) ?? null;
	const lan = locals.via === 'lan';
	// A friend's install signs in with their password (doc/SIGN-IN.md); over
	// Wi-Fi with none set, only a code signs in.
	if (friendLogin())
		return {
			configured: true,
			password: true,
			lan,
			pair,
			field: !(lan && currentLogin()?.kind === 'none')
		};
	return { configured: authMode().configured, password: false, lan, pair, field: true };
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const next = nextOf(url);

		if (friendLogin()) {
			const login = currentLogin();
			if (!login) redirect(303, '/setup');
			const password = String(form.get('token') ?? '');
			if (login.kind !== 'password' || !verifyPassword(password, login.hash)) {
				await slowDown();
				return fail(401, { message: m.login_error_password() });
			}
			setSession(cookies, sessionFor(login), url);
			redirect(303, next);
		}

		const token = String(form.get('token') ?? '');
		if (!checkToken(token)) return fail(401, { message: m.login_error_token() });
		setSession(cookies, sessionValueFor(token), url);
		redirect(303, next);
	}
};
