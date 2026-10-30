import { error, redirect, type Handle } from '@sveltejs/kit';
import {
	SESSION_COOKIE,
	authMode,
	currentLogin,
	friendAuthed,
	friendLogin,
	isValidSession
} from '$lib/server/auth';
import { foreignHost, loopbackRedirect } from '$lib/server/bind';
import { isRevealed, themeOf } from '$lib/server/prefs';

const PUBLIC_PATHS = new Set(['/login', '/setup']);

/**
 * Every route is behind the shared token except the login form itself; on a
 * friend's install, behind their password, or none (doc/SIGN-IN.md), and
 * SET UP until they've chosen.
 *
 * Binding to the tailnet address is done by scripts/serve.ts; this is the
 * second lock. Ported from kirisute, whose README explains both.
 */
export const handle: Handle = async ({ event, resolve }) => {
	// A friend's install answers on localhost only (scripts/serve.ts, local mode).
	if (process.env.TSUNDOKU_SERVE === 'local' && process.env.ORIGIN) {
		const host = event.request.headers.get('host');
		const to = loopbackRedirect(host, process.env.ORIGIN);
		if (to) redirect(308, `http://${to}${event.url.pathname}${event.url.search}`);
		// Another site's name pointed at this computer (bind.ts, foreignHost).
		if (foreignHost(host, process.env.ORIGIN)) error(403, 'not this app');
	}

	const path = event.url.pathname;
	let authed: boolean;
	if (friendLogin()) {
		// A friend's install (doc/SIGN-IN.md): SET UP until a password, or none, is chosen.
		const login = currentLogin();
		authed = friendAuthed(login, event.cookies.get(SESSION_COOKIE));
		if (!login && path !== '/setup') {
			if (path.startsWith('/api/')) error(401, 'not set up');
			redirect(303, '/setup');
		}
	} else {
		const mode = authMode();
		if (!mode.configured && !mode.devBypass) {
			error(503, 'TSUNDOKU_TOKEN is not configured');
		}
		authed = mode.configured ? isValidSession(event.cookies.get(SESSION_COOKIE)) : mode.devBypass;
	}

	event.locals.authed = authed;

	if (!authed && !PUBLIC_PATHS.has(path)) {
		if (path.startsWith('/api/')) error(401, 'unauthorized');
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}

	// The theme is on <html> in the first byte, so light mode never flashes dark.
	const theme = themeOf(event.cookies);
	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace('<html lang="en">', `<html lang="en" data-theme="${theme}">`)
	});
	// Anything rendered while reveal is on may show hidden titles: no copy of
	// it is kept anywhere, the service worker's offline screens included
	// (doc/OFFLINE.md).
	if (isRevealed(event.cookies)) {
		try {
			response.headers.set('cache-control', 'no-store');
		} catch {
			// An immutable response (a fetch passed through): nothing of ours to store.
		}
	}
	return response;
};
