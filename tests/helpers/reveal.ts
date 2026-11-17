import type { BrowserContext } from '@playwright/test';

/**
 * Turn reveal on for a browser context the way the app does: the `/reveal`
 * command, answered by the server with a signed cookie (src/lib/server/prefs.ts).
 * A spec cannot write the cookie itself, because the value is an HMAC made
 * with the server's own key and bound to the session it sits beside; a
 * hand-set `tsundoku_reveal=1` is exactly what the server must refuse.
 *
 * `context.request` shares the context's cookies both ways, so the session
 * goes up with the command and the cookie it sets lands in the context. With
 * no `base` the context's own `baseURL` is asked; a spec on a server of its
 * own passes that server's origin, since each server signs with its own key.
 *
 * Off is still `context.clearCookies({ name: 'tsundoku_reveal' })`, or the
 * `/hide` command. Behind the fingerprint gate the command does not reveal,
 * so this throws there rather than let a spec run with reveal silently off.
 */
export async function revealOn(context: BrowserContext, base?: string): Promise<void> {
	const url = base ? new URL('/api/command', base).href : '/api/command';
	const res = await context.request.post(url, { data: { command: 'reveal' } });
	const body = (await res.json().catch(() => null)) as { ok?: boolean; href?: string } | null;
	if (!res.ok() || !body?.ok || body.href)
		throw new Error(`/reveal was not taken at ${url}: ${res.status()} ${JSON.stringify(body)}`);
}
