import { getDb } from './db.ts';
import { getSetting } from './settings.ts';
import { dataPaths } from './data-dirs.ts';
import { readLogin, sessionFor } from './login.ts';

/**
 * Every secret this install knows, in one place, so whatever must keep them out
 * (SAVE A REPORT, report.ts; doc/LOGS.md) asks here, not a list of its own.
 * A list kept somewhere else falls behind: the report's own named two tokens
 * while the TMDB key and the trackers' app secrets went out in it.
 *
 * Three kinds: the environment's (doc/SECRETS.md, the table), what the app
 * keeps in its database and data folder, and what a running process makes up.
 * `tests/secrets.spec.ts` fails when the code reads a `*_TOKEN`, `*_SECRET`,
 * `*_KEY` or `*_PASSWORD` variable that `SECRET_ENV` doesn't name.
 */

/**
 * The environment's secrets. Client ids are not here: an OAuth client id is
 * public, sent in every sign-in link.
 */
export const SECRET_ENV = [
	'TSUNDOKU_TOKEN',
	'ENGINE_TOKEN',
	'KUMIKO_TOKEN',
	'ANILIST_CLIENT_SECRET',
	'MAL_CLIENT_SECRET',
	'TMDB_API_RC_TOKEN',
	'TMDB_API_KEY',
	'RANOBE_TOKEN',
	'RANOBE_SUGGEST_TOKEN'
] as const;

/** Secrets a running process made up, such as the loopback proxy's header. Gone with the process. */
const made = new Set<string>();

/** Tell the list about a secret this process made up, so a report keeps it out too. */
export function rememberSecret(value: string): void {
	if (value) made.add(value);
}

/** What the database keeps: the TMDB key typed in SETTINGS, and the trackers' OAuth tokens. */
function stored(): string[] {
	const db = getDb();
	const tokens = db.prepare(`SELECT access_token, refresh_token FROM tracker_accounts`).all() as {
		access_token: string;
		refresh_token: string | null;
	}[];
	return [
		getSetting('tmdb_key').trim(),
		...tokens.flatMap((t) => [t.access_token, t.refresh_token ?? ''])
	];
}

/**
 * A friend's install's sign-in: login.json's secret, and the session cookie
 * made from it. Read whenever the file is there, not through auth.ts: only a
 * friend's install has one, and auth.ts would pull SvelteKit's env into the
 * loopback proxy, which tells this list about its own secret.
 */
function login(): string[] {
	const l = readLogin(dataPaths().home);
	return l ? [l.secret, sessionFor(l)] : [];
}

/** Every secret value this install knows right now, empty ones left out. */
export function knownSecrets(): string[] {
	const values = [
		...SECRET_ENV.map((k) => (process.env[k] ?? '').trim()),
		...stored(),
		...login(),
		...made
	];
	return [...new Set(values.filter(Boolean))];
}
