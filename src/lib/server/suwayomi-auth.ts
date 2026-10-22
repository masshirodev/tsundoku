/**
 * Suwayomi's basic-auth login (doc/DOWNLOADING.md, "On the tailnet"). It was
 * opened to the tailnet on 2026-10-22, so it asks for a login now, and every
 * request tsundoku makes to it carries one: the app's, the watcher's, the
 * import timer's and the cover fetches. Plain relative imports only, as
 * scripts/suwayomi-import.ts runs this outside Vite.
 */

type Env = Record<string, string | undefined>;

/**
 * The Authorization header for a request to `url`, or none. Only Suwayomi's
 * own origin gets it: a cover URL can point anywhere, and the password must
 * never go with it.
 */
export function suwayomiAuth(url: string | URL, env: Env = process.env): Record<string, string> {
	const user = env.SUWAYOMI_USERNAME;
	const password = env.SUWAYOMI_PASSWORD;
	if (!user || !password || !env.SUWAYOMI_URL) return {};
	try {
		if (new URL(url).origin !== new URL(env.SUWAYOMI_URL).origin) return {};
	} catch {
		return {};
	}
	return { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` };
}
