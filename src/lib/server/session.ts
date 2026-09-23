import { createHash } from 'node:crypto';

/**
 * The session cookie's value, derived from the token rather than stored
 * (src/lib/server/auth.ts), so there is no session table and rotating the
 * token invalidates every cookie. The salt makes the cookie useless as a way
 * to recover the token. Apart from auth.ts because the sync script
 * (scripts/sync-import.ts) signs in the same way, outside SvelteKit.
 */
const SALT = 'tsundoku/v1';

export function sessionValueFor(token: string): string {
	return createHash('sha256').update(`${SALT}:${token}`).digest('hex');
}
