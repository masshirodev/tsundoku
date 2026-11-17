import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { setTmdbFetch, tmdbSearch } = await import('$lib/server/tmdb');
const key = await import('$lib/server/tmdb-key');
const { catalogueConfigured } = await import('$lib/server/catalogues');

/**
 * The TMDB key typed in SETTINGS: checked before it is kept, never shown
 * again but for four characters, and never above the environment's. TMDB is
 * a stub that takes one key.
 */

getDb();
const asked: { url: URL; auth: string | null }[] = [];
const GOOD = 'good-v3-key-a41f';
const V4 = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.sig-b52c';

beforeEach(() => {
	asked.length = 0;
	delete process.env.TMDB_API_KEY;
	delete process.env.TMDB_API_RC_TOKEN;
	key.removeTmdbKey();
	setTmdbFetch((async (url: URL, init?: RequestInit) => {
		const auth = (init?.headers as Record<string, string>)?.authorization ?? null;
		asked.push({ url, auth });
		const given = url.searchParams.get('api_key') ?? auth?.replace('Bearer ', '');
		const ok = given === GOOD || given === V4;
		return new Response(JSON.stringify(ok ? { results: [] } : { status_code: 7 }), {
			status: ok ? 200 : 401
		});
	}) as unknown as typeof fetch);
});
afterEach(() => setTmdbFetch(null));

describe('saving a key', () => {
	it('keeps a key TMDB takes, and shows only its last four', async () => {
		expect(await key.saveTmdbKey(`  ${GOOD} `, 1000)).toBe('ok');
		expect(asked[0].url.pathname).toMatch(/\/configuration$/);
		expect(key.tmdbKeyRow()).toEqual({
			source: 'saved',
			endsIn: 'a41f',
			checkedAt: 1000,
			refusedAt: null
		});
		expect(catalogueConfigured('tmdb')).toBe(true);
	});

	it('writes nothing for a key TMDB refuses, and keeps the one in use', async () => {
		await key.saveTmdbKey(GOOD);
		expect(await key.saveTmdbKey('wrong-key')).toBe('refused');
		expect(key.tmdbKeyRow().endsIn).toBe('a41f');
	});

	it('throws offline, so a good key is never called wrong', async () => {
		setTmdbFetch((async () => {
			throw new TypeError('fetch failed');
		}) as unknown as typeof fetch);
		await expect(key.saveTmdbKey(GOOD)).rejects.toThrow();
		expect(key.tmdbKeyRow().source).toBeNull();
	});

	it('sends a v4 token pasted here as a bearer, and a v3 key in the URL', async () => {
		await key.saveTmdbKey(V4);
		await tmdbSearch('movie', 'x');
		const last = asked.at(-1)!;
		expect(last.auth).toBe(`Bearer ${V4}`);
		expect(last.url.searchParams.get('api_key')).toBeNull();
		await key.saveTmdbKey(GOOD);
		await tmdbSearch('movie', 'x');
		expect(asked.at(-1)!.url.searchParams.get('api_key')).toBe(GOOD);
	});
});

describe('the row', () => {
	it('says the environment’s key wins, and never offers to remove it', async () => {
		await key.saveTmdbKey(GOOD);
		process.env.TMDB_API_KEY = 'env-key-zz99';
		expect(key.tmdbKeyRow()).toMatchObject({ source: 'env', endsIn: 'zz99' });
	});

	it('says when TMDB refused the key in use (Keys-Key 3G)', async () => {
		await key.saveTmdbKey(GOOD);
		setTmdbFetch((async () => new Response('{}', { status: 401 })) as unknown as typeof fetch);
		await expect(tmdbSearch('movie', 'x')).rejects.toThrow(/401/);
		expect(key.tmdbKeyRow().refusedAt).not.toBeNull();
	});

	it('REMOVE takes the key alone', async () => {
		await key.saveTmdbKey(GOOD);
		key.removeTmdbKey();
		expect(key.tmdbKeyRow()).toEqual({
			source: null,
			endsIn: '',
			checkedAt: null,
			refusedAt: null
		});
		expect(catalogueConfigured('tmdb')).toBe(false);
	});

	it('counts what a new key would look up', () => {
		const db = getDb();
		db.prepare(`INSERT INTO roots (id, name, path, hidden) VALUES (903, 'A', '/k', 0)`).run();
		for (const [t, k] of [
			['F1', 'movie'],
			['F2', 'movie'],
			['S1', 'show']
		])
			db.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, in_library) VALUES (903, ?, ?, 1, 1)`
			).run(t, k);
		expect(key.waitingForAKey()).toEqual({ films: 2, shows: 1 });
	});
});
