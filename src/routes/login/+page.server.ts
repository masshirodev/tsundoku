import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { SESSION_COOKIE, authMode, checkToken, sessionValueFor } from '$lib/server/auth';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.authed) redirect(303, url.searchParams.get('next') || '/');
	return { configured: authMode().configured };
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const token = String(form.get('token') ?? '');

		if (!checkToken(token)) return fail(401, { message: 'that token is not right' });

		cookies.set(SESSION_COOKIE, sessionValueFor(token), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			// The tailnet serves this over plain http; forcing Secure here would make
			// the cookie silently undeliverable and the login loop forever.
			secure: url.protocol === 'https:',
			maxAge: 60 * 60 * 24 * 365
		});

		redirect(303, url.searchParams.get('next') || '/');
	}
};
