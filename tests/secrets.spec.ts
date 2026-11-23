import {
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// The report reads SvelteKit's private env, which only a Kit build provides;
// a built bundle's is process.env, so that is what stands in.
vi.mock('$env/dynamic/private', () => ({ env: process.env }));

// One value per secret, each long and unlike the others so a match is that one.
const ENV_VALUES: Record<string, string> = {
	TSUNDOKU_TOKEN: 'plant-tsundoku-token-1111',
	ENGINE_TOKEN: 'plant-engine-token-2222',
	KUMIKO_TOKEN: 'plant-kumiko-token-3333',
	ANILIST_CLIENT_SECRET: 'plant-anilist-secret-4444',
	MAL_CLIENT_SECRET: 'plant-mal-secret-5555',
	TMDB_API_RC_TOKEN: 'plant-tmdb-rc-token-6666',
	TMDB_API_KEY: 'plant-tmdb-v3-key-7777',
	RANOBE_TOKEN: 'plant-ranobe-token-8888',
	RANOBE_SUGGEST_TOKEN: 'plant-ranobe-suggest-9999'
};

const home = mkdtempSync(join(tmpdir(), 'tsundoku-secrets-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

// Before anything imports db.ts: getDb() reads these once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.TSUNDOKU_HOME = home;
process.env.TSUNDOKU_LOGIN = 'password';
Object.assign(process.env, ENV_VALUES);

const { getDb } = await import('$lib/server/db');
const { setSetting } = await import('$lib/server/settings');
const { makeLogin, sessionFor, loginPath } = await import('$lib/server/login');
const { SECRET_ENV, knownSecrets, rememberSecret } = await import('$lib/server/secrets');
const { buildReport } = await import('$lib/server/report');

const login = makeLogin('a password');
writeFileSync(loginPath(home), JSON.stringify(login));

const STORED = {
	tmdbSaved: 'plant-tmdb-saved-key-aaaa',
	anilistAccess: 'plant-anilist-access-bbbb',
	malAccess: 'plant-mal-access-cccc',
	malRefresh: 'plant-mal-refresh-dddd',
	made: 'plant-loopback-header-eeee'
};
setSetting('tmdb_key', STORED.tmdbSaved);
const account = getDb().prepare(
	`INSERT INTO tracker_accounts (service, user_id, user_name, access_token, refresh_token, signed_in_at)
	 VALUES (?, '1', 'reader', ?, ?, 0)`
);
account.run('anilist', STORED.anilistAccess, null);
account.run('mal', STORED.malAccess, STORED.malRefresh);
rememberSecret(STORED.made);

const every = [
	...Object.values(ENV_VALUES),
	...Object.values(STORED),
	login.secret,
	sessionFor(login)
];

describe('every secret the install knows stays out of a saved report', () => {
	it('knows each of them', () => {
		expect(new Set(knownSecrets())).toEqual(new Set(every));
	});

	it('names every planted environment secret in SECRET_ENV', () => {
		expect([...SECRET_ENV].sort()).toEqual(Object.keys(ENV_VALUES).sort());
	});

	it('takes each one out of a log a friend saves as a report', async () => {
		mkdirSync(join(home, 'logs'), { recursive: true });
		// Each secret on a line of its own, as a careless log line would print it.
		writeFileSync(
			join(home, 'logs', 'app.log'),
			every.map((v, i) => `line ${i}: value=${v} end`).join('\n')
		);
		const report = await buildReport(new Date(0));
		for (const v of every) expect(report).not.toContain(v);
		expect(report.match(/\[secret\]/g)?.length).toBeGreaterThanOrEqual(every.length);
	});
});

/** Every file under a folder, for the scan below. */
function filesUnder(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const p = join(dir, name);
		return statSync(p).isDirectory() ? filesUnder(p) : [p];
	});
}

describe('SECRET_ENV keeps up with the code', () => {
	it('names every secret-like variable the source reads', () => {
		const read = new Set<string>();
		const reads =
			/(?:process\.env|\benv)(?:\.([A-Z][A-Z0-9_]+)|\[\s*'([A-Z][A-Z0-9_]+)'\s*\]|\(\s*'([A-Z][A-Z0-9_]+)'\s*\))/g;
		for (const f of filesUnder('src').filter((p) => /\.(ts|js|svelte)$/.test(p)))
			for (const m of readFileSync(f, 'utf8').matchAll(reads)) read.add(m[1] ?? m[2] ?? m[3]);
		const secretLike = [...read].filter((k) => /(TOKEN|SECRET|_KEY|PASSWORD)$/.test(k));
		// The scan must see the ones it is there for, or it proves nothing.
		expect(secretLike).toEqual(expect.arrayContaining(['TSUNDOKU_TOKEN', 'MAL_CLIENT_SECRET']));
		expect(secretLike.filter((k) => !(SECRET_ENV as readonly string[]).includes(k))).toEqual([]);
	});
});
