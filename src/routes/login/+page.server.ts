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

/** Where to go once signed in: a path in this app, never another site (`?next=//evil.example`). */
const nextOf = (url: URL) => {
	const next = url.searchParams.get('next') ?? '';
	return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
};

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.authed) redirect(303, nextOf(url));
	// A friend's install signs in with their password (doc/SIGN-IN.md).
	if (friendLogin()) return { configured: true, password: true };
	return { configured: authMode().configured, password: false };
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
				return fail(401, { message: 'that password is not right' });
			}
			setSession(cookies, sessionFor(login), url);
			redirect(303, next);
		}

		const token = String(form.get('token') ?? '');
		if (!checkToken(token)) return fail(401, { message: 'that token is not right' });
		setSession(cookies, sessionValueFor(token), url);
		redirect(303, next);
	}
};
