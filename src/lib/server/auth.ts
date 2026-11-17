import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { dataPaths } from './data-dirs.ts';
import { readLogin, sessionFor, type Login } from './login.ts';
import { SESSION_COOKIE } from './session.ts';

export { SESSION_COOKIE };

/**
 * Authentication is a single shared token, because there is exactly one user
 * and the app is reachable only over the tailnet.
 *
 * It is a COOKIE and not an Authorization header, and that is not a stylistic
 * choice: a <img src="..."> element cannot set request headers, so a bearer
 * scheme authenticates the API perfectly while making every page image
 * unloadable. Cookies are sent by the image element automatically.
 */
function expectedToken(): string | null {
	// $env/dynamic/private rather than process.env: SvelteKit loads .env through
	// this module, and reading process.env directly means the token is simply
	// absent in dev -- which silently drops the app into its unauthenticated
	// development bypass instead of failing loudly.
	const token = env.TSUNDOKU_TOKEN;
	return token && token.length > 0 ? token : null;
}

export { sessionValueFor } from './session.ts';
import { sessionValueFor } from './session.ts';

function constantTimeEquals(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	// timingSafeEqual throws on a length mismatch, which would itself leak the
	// length; hash both sides to a fixed width first.
	const lh = createHash('sha256').update(left).digest();
	const rh = createHash('sha256').update(right).digest();
	return timingSafeEqual(lh, rh);
}

export type AuthMode = { configured: true } | { configured: false; devBypass: boolean };

/**
 * Whether a missing token lets every request in: only under `vite dev`.
 *
 * `dev` is fixed when the app is compiled, so no built bundle has the bypass
 * whatever its environment says. Not NODE_ENV at run time: only
 * scripts/serve.ts sets it, so `node build` started any other way, with no
 * token, would serve the whole library to anyone who reached it.
 */
const devBypass = () => dev;

export function authMode(): AuthMode {
	const token = expectedToken();
	if (token) return { configured: true };
	// Refusing is the only safe default. Silently serving the contents of the
	// library because a variable was forgotten is exactly how this becomes an
	// open endpoint on a box with no firewall running.
	return { configured: false, devBypass: devBypass() };
}

export function checkToken(supplied: string): boolean {
	const token = expectedToken();
	if (!token) return false;
	return constantTimeEquals(supplied, token);
}

export function isValidSession(cookieValue: string | undefined): boolean {
	const token = expectedToken();
	if (!token) return devBypass();
	if (!cookieValue) return false;
	return constantTimeEquals(cookieValue, sessionValueFor(token));
}

/** Generated once so a first run has something to copy into the environment. */
export function suggestToken(): string {
	return randomBytes(24).toString('base64url');
}

// ---- A friend's install: a password of their own, or none (doc/SIGN-IN.md) ----

/**
 * A friend's install signs in with a password chosen on first open (login.ts),
 * never with the token: the launcher sets TSUNDOKU_LOGIN=password. The
 * workstation doesn't, and signs in with its token as above.
 */
export const friendLogin = () => env.TSUNDOKU_LOGIN === 'password';

/** Only this computer reaches it: the one mode where no password is allowed. */
export const localOnly = () => env.TSUNDOKU_SERVE === 'local';

/** The friend's login, or null before SET UP (or on the workstation). */
export function currentLogin(): Login | null {
	return friendLogin() ? readLogin(dataPaths().home) : null;
}

/**
 * Whether a request is signed in on a friend's install. No password means
 * signed in, but only while nothing else can reach it; serve.ts refuses to put
 * such an install on Tailscale at all, so this is the second lock.
 */
export function friendAuthed(
	login: Login | null,
	cookieValue: string | undefined,
	overWifi = false
): boolean {
	if (!login) return false;
	// No password is this computer's alone: over Wi-Fi, a pairing or a password (doc/WIFI.md).
	if (login.kind === 'none') return localOnly() && !overWifi;
	return !!cookieValue && constantTimeEquals(cookieValue, sessionFor(login));
}

/** Set the session cookie, for the token's or a login's value. */
export function setSession(cookies: Cookies, value: string, url: URL) {
	cookies.set(SESSION_COOKIE, value, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		// The tailnet serves this over plain http; forcing Secure here would make
		// the cookie silently undeliverable and the login loop forever.
		secure: url.protocol === 'https:',
		maxAge: 60 * 60 * 24 * 365
	});
}

/**
 * A wrong password costs the guesser time: a phone on the same Wi-Fi (c188)
 * could otherwise try thousands a minute. scrypt's own ~50 ms is most of it.
 */
export const slowDown = () => new Promise((ok) => setTimeout(ok, 400));
