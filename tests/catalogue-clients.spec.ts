import { afterEach, describe, expect, it } from 'vitest';
import { catalogueClient, entryOf } from '$lib/server/catalogue-clients';
import { setAnilistFetch } from '$lib/server/catalogue';
import { setTmdbFetch } from '$lib/server/tmdb';

/**
 * The one contract both catalogues answer (card c989; doc/LINKS.md, "The
 * contract"): search a kind by title, read one entry by id, and the entry
 * every screen can draw. No network: both fetches are stubs.
 */

afterEach(() => {
	setAnilistFetch(null);
	setTmdbFetch(null);
	delete process.env.TMDB_API_KEY;
});

const anilistMedia = {
	id: 7,
	idMal: 70,
	format: 'MANGA',
	countryOfOrigin: 'KR',
	status: 'RELEASING',
	chapters: 100,
	volumes: null,
	episodes: null,
	season: null,
	seasonYear: null,
	synonyms: [],
	title: { romaji: 'Romaji', english: 'English', native: null },
	startDate: { year: 2020 },
	coverImage: { extraLarge: 'https://s4.anilist.co/cover/7.jpg', large: null }
};

describe('AniList through the contract', () => {
	it('searches one title and reads one id', async () => {
		const bodies: string[] = [];
		setAnilistFetch((async (_u: string, init?: RequestInit) => {
			bodies.push(String(init?.body));
			const q = String(init?.body);
			const data = q.includes('id_in')
				? { Page: { media: [anilistMedia] } }
				: { s0: { media: [anilistMedia] } };
			return new Response(JSON.stringify({ data }), { status: 200 });
		}) as unknown as typeof fetch);
		const c = catalogueClient('anilist');
		expect((await c.search('manhwa', 'English')).map((x) => x.anilistId)).toEqual([7]);
		expect((await c.byId('manhwa', 7))?.anilistId).toBe(7);
		expect(await c.byId('manhwa', 8)).toBeNull();
	});
});

describe('TMDB through the contract', () => {
	it('answers a film, and refuses a kind TMDB does not hold', async () => {
		process.env.TMDB_API_KEY = 'k';
		setTmdbFetch(
			(async () =>
				new Response(
					JSON.stringify({ results: [{ id: 3, title: 'Film', release_date: '2001-01-01' }] }),
					{
						status: 200
					}
				)) as unknown as typeof fetch
		);
		const c = catalogueClient('tmdb');
		expect((await c.search('movie', 'Film', 2001)).map((x) => x.id)).toEqual([3]);
		await expect(c.search('manga', 'Film')).rejects.toThrow(/does not hold a manga/);
	});
});

describe('entryOf', () => {
	it('draws either catalogue’s entry the same way', () => {
		expect(
			entryOf({
				id: 3,
				media: 'movie',
				title: 'The Handmaiden',
				originalTitle: '아가씨',
				year: 2016,
				overview: '',
				poster: 'https://image.tmdb.org/t/p/w500/x.jpg',
				runtime: null,
				seasons: null,
				collection: null
			})
		).toEqual({
			provider: 'tmdb',
			id: 3,
			title: 'The Handmaiden',
			alts: ['아가씨'],
			year: 2016,
			poster: 'https://image.tmdb.org/t/p/w500/x.jpg'
		});
		expect(
			entryOf({
				anilistId: 7,
				malId: null,
				title: 'English',
				alts: ['Romaji'],
				format: 'MANGA',
				country: 'KR',
				year: 2020,
				chapters: null,
				volumes: null,
				episodes: null,
				season: null,
				seasonYear: null,
				status: '',
				coverUrl: ''
			})
		).toMatchObject({ provider: 'anilist', id: 7, poster: null });
	});
});
