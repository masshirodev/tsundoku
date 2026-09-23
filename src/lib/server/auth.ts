import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export const SESSION_COOKIE = 'tsundoku_session';

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

/**
 * The session value is derived from the token rather than stored, so there is
 * no session table to keep and rotating the token invalidates every cookie.
 * The salt makes the cookie useless as a way to recover the token itself.
 */
const SALT = 'tsundoku/v1';

export function sessionValueFor(token: string): string {
	return createHash('sha256').update(`${SALT}:${token}`).digest('hex');
}

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

export function authMode(): AuthMode {
	const token = expectedToken();
	if (token) return { configured: true };
	// Refusing is the only safe default. Silently serving the contents of the
	// library because a variable was forgotten is exactly how this becomes an
	// open endpoint on a box with no firewall running.
	return { configured: false, devBypass: env.NODE_ENV !== 'production' };
}

export function checkToken(supplied: string): boolean {
	const token = expectedToken();
	if (!token) return false;
	return constantTimeEquals(supplied, token);
}

export function isValidSession(cookieValue: string | undefined): boolean {
	const token = expectedToken();
	if (!token) return env.NODE_ENV !== 'production';
	if (!cookieValue) return false;
	return constantTimeEquals(cookieValue, sessionValueFor(token));
}

/** Generated once so a first run has something to copy into the environment. */
export function suggestToken(): string {
	return randomBytes(24).toString('base64url');
}
