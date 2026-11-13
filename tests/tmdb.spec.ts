import { afterEach, describe, expect, it } from 'vitest';
import { catalogueConfigured } from '$lib/server/catalogues';
import { NoTmdbKey, setTmdbFetch, tmdbById, tmdbSearch } from '$lib/server/tmdb';

/**
 * The TMDB client (card c989): the install's own key, the v4 token before the
 * v3 key, and a film and a show as tsundoku needs them. No network: the fetch
 * is a stub, as the AniList specs do it.
 */

const saved = {
	key: process.env.TMDB_API_KEY,
	token: process.env.TMDB_API_RC_TOKEN,
	url: process.env.TMDB_API_URL
};

afterEach(() => {
	for (const [name, value] of [
		['TMDB_API_KEY', saved.key],
		['TMDB_API_RC_TOKEN', saved.token],
		['TMDB_API_URL', saved.url]
	] as const) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	setTmdbFetch(null);
});

const stub = (body: unknown, status = 200) => {
	const seen: { url: URL; init?: RequestInit }[] = [];
	setTmdbFetch((async (url: URL, init?: RequestInit) => {
		seen.push({ url, init });
		return new Response(JSON.stringify(body), { status });
	}) as unknown as typeof fetch);
	return seen;
};

const noKey = () => {
	delete process.env.TMDB_API_KEY;
	delete process.env.TMDB_API_RC_TOKEN;
};

describe('the key', () => {
	it('refuses every call without one, as a state and not a failure', async () => {
		noKey();
		expect(catalogueConfigured('tmdb')).toBe(false);
		await expect(tmdbSearch('movie', 'The Long Ferry')).rejects.toBeInstanceOf(NoTmdbKey);
		await expect(tmdbById('show', 1)).rejects.toBeInstanceOf(NoTmdbKey);
	});

	it('sends the v4 read token as a bearer, with no api_key in the URL', async () => {
		noKey();
		process.env.TMDB_API_RC_TOKEN = 'v4-token';
		const seen = stub({ results: [] });
		await tmdbSearch('movie', 'x');
		expect(seen[0].url.searchParams.get('api_key')).toBeNull();
		expect((seen[0].init?.headers as Record<string, string>).authorization).toBe('Bearer v4-token');
	});

	it('sends the v3 key in the URL when that is all there is', async () => {
		noKey();
		process.env.TMDB_API_KEY = 'v3-key';
		const seen = stub({ results: [] });
		await tmdbSearch('movie', 'x');
		expect(seen[0].url.searchParams.get('api_key')).toBe('v3-key');
		expect((seen[0].init?.headers as Record<string, string>).authorization).toBeUndefined();
	});
});

describe('a search', () => {
	it('asks the film or the show endpoint, with the year when one is known', async () => {
		noKey();
		process.env.TMDB_API_KEY = 'k';
		const seen = stub({ results: [] });
		await tmdbSearch('movie', 'The Long Ferry', 2024);
		expect(seen[0].url.pathname).toBe('/3/search/movie');
		expect(seen[0].url.searchParams.get('year')).toBe('2024');

		await tmdbSearch('show', 'Alchemy of Souls');
		expect(seen[1].url.pathname).toBe('/3/search/tv');
		expect(seen[1].url.searchParams.get('query')).toBe('Alchemy of Souls');
		expect(seen[1].url.searchParams.get('first_air_date_year')).toBeNull();
	});

	it('maps a film as a poster, a year and a title, and no seasons', async () => {
		noKey();
		process.env.TMDB_API_KEY = 'k';
		stub({
			results: [
				{
					id: 603,
					title: 'The Long Ferry',
					original_title: 'A Balsa Longa',
					release_date: '2024-11-02',
					overview: ' A crossing. ',
					poster_path: '/ferry.jpg'
				}
			]
		});
		const [film] = await tmdbSearch('movie', 'The Long Ferry');
		expect(film).toEqual({
			id: 603,
			media: 'movie',
			title: 'The Long Ferry',
			originalTitle: 'A Balsa Longa',
			year: 2024,
			overview: 'A crossing.',
			poster: 'https://image.tmdb.org/t/p/w500/ferry.jpg',
			runtime: null,
			seasons: null,
			collection: null
		});
	});

	it('caps the list at ten and keeps a missing date or poster null', async () => {
		noKey();
		process.env.TMDB_API_KEY = 'k';
		stub({ results: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, title: `T${i}` })) });
		const rows = await tmdbSearch('movie', 'T');
		expect(rows).toHaveLength(10);
		expect(rows[0].year).toBeNull();
		expect(rows[0].poster).toBeNull();
	});
});

describe('one entry', () => {
	it('carries a film’s runtime and its collection', async () => {
		noKey();
		process.env.TMDB_API_KEY = 'k';
		const seen = stub({
			id: 603,
			title: 'The Long Ferry',
			release_date: '2024-11-02',
			runtime: 118,
			belongs_to_collection: { id: 9, name: 'The Long Ferry Collection' }
		});
		const film = await tmdbById('movie', 603);
		expect(seen[0].url.pathname).toBe('/3/movie/603');
		expect(film?.runtime).toBe(118);
		expect(film?.collection).toEqual({ id: 9, name: 'The Long Ferry Collection' });
	});

	it('carries a show’s season count', async () => {
		noKey();
		process.env.TMDB_API_KEY = 'k';
		stub({ id: 1, name: 'Alchemy of Souls', first_air_date: '2022-06-18', number_of_seasons: 2 });
		const show = await tmdbById('show', 1);
		expect(show?.media).toBe('tv');
		expect(show?.seasons).toBe(2);
		expect(show?.year).toBe(2022);
	});

	it('answers null for an id TMDB does not have, and throws on a failure', async () => {
		noKey();
		process.env.TMDB_API_KEY = 'k';
		stub({}, 404);
		expect(await tmdbById('movie', 1)).toBeNull();
		stub({}, 500);
		await expect(tmdbById('movie', 1)).rejects.toThrow('TMDB answered 500');
	});
});
