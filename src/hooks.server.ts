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
import { PAIRED_COOKIE, pairedBy } from '$lib/server/pairing';
import { lanHosts, viaLan } from '$lib/server/wifi';
import { isRevealed, themeOf } from '$lib/server/prefs';

const PUBLIC_PATHS = new Set(['/login', '/setup']);
/** A phone's camera opens /pair/<code> before it's signed in (doc/WIFI.md). */
const isPublic = (path: string) => PUBLIC_PATHS.has(path) || path.startsWith('/pair/');

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
	// Over Wi-Fi only through serve.ts's listeners (doc/WIFI.md), which say so.
	const lan = viaLan(event.request.headers);
	event.locals.via = lan ? 'lan' : 'local';
	const localOrigin = process.env.TSUNDOKU_ORIGIN ?? process.env.ORIGIN;
	if (process.env.TSUNDOKU_SERVE === 'local' && localOrigin) {
		const host = event.request.headers.get('host');
		if (lan) {
			// The address the phone was given, and nothing else (DNS rebinding).
			if (!host || !lanHosts().includes(host)) error(403, 'not this app');
		} else {
			const to = loopbackRedirect(host, localOrigin);
			if (to) redirect(308, `http://${to}${event.url.pathname}${event.url.search}`);
			// Another site's name pointed at this computer (bind.ts, foreignHost).
			if (foreignHost(host, localOrigin)) error(403, 'not this app');
		}
	}

	const path = event.url.pathname;
	let authed: boolean;
	event.locals.paired = null;
	if (friendLogin()) {
		// A friend's install (doc/SIGN-IN.md): SET UP until a password, or none, is chosen.
		const login = currentLogin();
		// A phone paired over Wi-Fi signs in with its own cookie (doc/WIFI.md).
		const paired = lan ? pairedBy(event.cookies.get(PAIRED_COOKIE)) : null;
		event.locals.paired = paired;
		authed = !!paired || friendAuthed(login, event.cookies.get(SESSION_COOKIE), lan);
		if (!login) {
			// Set up on the computer itself; Wi-Fi can't be on before that anyway.
			if (lan) error(403, 'tsundoku is not set up yet');
			if (path !== '/setup') {
				if (path.startsWith('/api/')) error(401, 'not set up');
				redirect(303, '/setup');
			}
		}
	} else {
		const mode = authMode();
		if (!mode.configured && !mode.devBypass) {
			error(503, 'TSUNDOKU_TOKEN is not configured');
		}
		authed = mode.configured ? isValidSession(event.cookies.get(SESSION_COOKIE)) : mode.devBypass;
	}

	event.locals.authed = authed;

	if (!authed && !isPublic(path)) {
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
