import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { currentLogin, friendLogin, localOnly, setSession } from '$lib/server/auth';
import { dataPaths } from '$lib/server/data-dirs';
import { MIN_PASSWORD, makeLogin, sessionFor, writeLogin } from '$lib/server/login';

/**
 * SET UP (doc/SIGN-IN.md; card c189): a friend's first open, choosing a
 * password or none. Only before one is chosen, only on a friend's install,
 * and only while it answers this computer alone: whoever reaches it first
 * would otherwise claim it. serve.ts won't put an install with no login on
 * Tailscale, so off localhost this page has nothing to set up.
 */
function settable() {
	if (!friendLogin()) error(404, 'not found');
	if (currentLogin()) redirect(303, '/');
	if (!localOnly()) error(403, 'set tsundoku up on the computer it runs on');
}

export const load: PageServerLoad = () => {
	settable();
	return { min: MIN_PASSWORD };
};

export const actions: Actions = {
	password: async ({ request, cookies, url }) => {
		settable();
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		if (password.length < MIN_PASSWORD)
			return fail(400, { message: `at least ${MIN_PASSWORD} characters` });
		if (password !== String(form.get('again') ?? ''))
			return fail(400, { message: 'the two passwords are different' });
		const login = makeLogin(password);
		writeLogin(dataPaths().home, login);
		setSession(cookies, sessionFor(login), url);
		redirect(303, '/');
	},
	/** None, once the page has asked whether they're sure (the owner, 2026-10-30). */
	none: async ({ request }) => {
		settable();
		if ((await request.formData()).get('sure') !== 'yes')
			return fail(400, { message: 'confirm it first' });
		writeLogin(dataPaths().home, makeLogin(null));
		redirect(303, '/');
	}
};
