import { error, redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { closeDeadJobs } from '$lib/server/import/write';
import { sequence } from '@sveltejs/kit/hooks';
import { defineCustomServerStrategy } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { localeFromCookieHeader } from '$lib/i18n/locale';
import {
	SESSION_COOKIE,
	authMode,
	currentLogin,
	friendAuthed,
	friendLogin,
	isValidSession
} from '$lib/server/auth';
import { foreignHost, loopbackRedirect } from '$lib/server/bind';
import { friendPaired, pairedBy, readPaired, tailnetDoor } from '$lib/server/pairing';
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
const guard: Handle = async ({ event, resolve }) => {
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
		// A phone paired over Wi-Fi signs in with its own cookie (doc/WIFI.md),
		// named for this origin (c530; readPaired moves one paired before it).
		const paired = readPaired(event.cookies, event.url, (t) => friendPaired(lan, t));
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
		// A TV that paired on the tailnet signs in with its own cookie (c245;
		// doc/SIGN-IN.md). Only a request that names the instance's own public
		// host gets that door: in https mode the app is on 127.0.0.1 behind
		// tailscale serve, so every request -- tailnet ones included -- comes
		// from loopback and the address cannot tell them apart. No origin
		// known, no door: the cookie signs nothing in (tailnetDoor). The cookie
		// is this origin's (c530), and readPaired moves one paired before it.
		const paired = tailnetDoor(process.env.ORIGIN, event.request.headers.get('host'))
			? readPaired(event.cookies, event.url, (t) => pairedBy(t))
			: null;
		event.locals.paired = paired;
		authed =
			!!paired ||
			(mode.configured ? isValidSession(event.cookies.get(SESSION_COOKIE)) : mode.devBypass);
	}

	event.locals.authed = authed;

	if (!authed && !isPublic(path)) {
		if (path.startsWith('/api/')) error(401, 'unauthorized');
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}

	// The theme is on <html> in the first byte, so light mode never flashes dark.
	const theme = themeOf(event.cookies);
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('<html ', `<html data-theme="${theme}" `)
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

// The device's own choice of language, then the browser's (doc/I18N.md).
defineCustomServerStrategy('custom-choice', {
	getLocale: (request) => localeFromCookieHeader(request?.headers.get('cookie') ?? null)
});

/**
 * The language first, so a refusal or a redirect above is in it too. The
 * client reads <html lang> rather than deciding again (hooks.client.ts).
 */
const language: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;
		return resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%lang%', locale)
		});
	});

export const handle = sequence(language, guard);

/**
 * An import runs inside the served app (startScan), so a job still open when
 * the app starts belongs to a process that is gone (doc/IMPORT-MIHON.md).
 */
export const init: ServerInit = () => {
	const closed = closeDeadJobs(getDb());
	if (closed > 0) console.log(`[import] closed ${closed} import left unfinished by the last run`);
};
