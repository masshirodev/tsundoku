import { error, redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, authMode, isValidSession } from '$lib/server/auth';
import { isRevealed, themeOf } from '$lib/server/prefs';

const PUBLIC_PATHS = new Set(['/login']);

/**
 * Every route is behind the shared token except the login form itself.
 *
 * Binding to the tailnet address is done by scripts/serve.ts; this is the
 * second lock. Ported from kirisute, whose README explains both.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const mode = authMode();

	if (!mode.configured && !mode.devBypass) {
		error(503, 'TSUNDOKU_TOKEN is not configured');
	}

	const authed = mode.configured
		? isValidSession(event.cookies.get(SESSION_COOKIE))
		: mode.devBypass;

	event.locals.authed = authed;

	if (!authed && !PUBLIC_PATHS.has(event.url.pathname)) {
		if (event.url.pathname.startsWith('/api/')) error(401, 'unauthorized');
		redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
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
