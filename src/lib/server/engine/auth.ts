/**
 * The engine's bearer token for a request to `url`, or none: the twin of
 * suwayomiAuth (suwayomi-auth.ts). Only the engine's own origin gets it, since
 * a cover URL can point anywhere and the token must never go with it. Plain
 * relative imports only, so the scripts can load it.
 */
type Env = Record<string, string | undefined>;

export function engineAuth(url: string | URL, env: Env = process.env): Record<string, string> {
	if (!env.ENGINE_TOKEN || !env.ENGINE_URL) return {};
	try {
		if (new URL(url).origin !== new URL(env.ENGINE_URL).origin) return {};
	} catch {
		return {};
	}
	return { authorization: `Bearer ${env.ENGINE_TOKEN}` };
}
