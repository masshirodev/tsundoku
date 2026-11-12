import { afterEach, describe, expect, it } from 'vitest';
import {
	catalogueHolds,
	catalogueName,
	catalogueOf,
	catalogueType,
	catalogueUrl
} from '$lib/library/catalogues';
import { anilistType, anilistTypeOf, KINDS } from '$lib/library/kinds';
import { parsePasted } from '$lib/library/catalogue';
import {
	catalogueConfigured,
	catalogueFor,
	catalogueMissing,
	tmdbKey
} from '$lib/server/catalogues';

/**
 * Which catalogue a kind is linked to, and whether this install can ask it
 * (card c988; doc/LINKS.md, "Which catalogue"). The TMDB kinds themselves are
 * c987's, so today every kind is AniList's; the provider half is what this
 * holds now.
 */

const saved = {
	key: process.env.TMDB_API_KEY,
	token: process.env.TMDB_API_RC_TOKEN
};

afterEach(() => {
	if (saved.key === undefined) delete process.env.TMDB_API_KEY;
	else process.env.TMDB_API_KEY = saved.key;
	if (saved.token === undefined) delete process.env.TMDB_API_RC_TOKEN;
	else process.env.TMDB_API_RC_TOKEN = saved.token;
});

describe('the catalogue a kind is linked to', () => {
	it('is AniList for every kind there is today', () => {
		for (const kind of KINDS) expect(catalogueOf(kind), kind).toBe('anilist');
	});

	it('names the provider and its word for the kind', () => {
		expect(catalogueName('anilist')).toBe('AniList');
		expect(catalogueName('tmdb')).toBe('TMDB');
		expect(catalogueType('anime')).toBe('ANIME');
		expect(catalogueType('manga')).toBe('MANGA');
		expect(catalogueHolds('anilist', 'anime')).toBe(true);
		expect(catalogueHolds('tmdb', 'anime')).toBe(false);
	});

	it('opens the entry on the right page', () => {
		expect(catalogueUrl('anime', 21)).toBe('https://anilist.co/anime/21');
		expect(catalogueUrl('manhwa', 7)).toBe('https://anilist.co/manga/7');
	});

	it('answers the narrow question without throwing, and the loud one still refuses', () => {
		expect(anilistTypeOf('anime')).toBe('ANIME');
		expect(anilistTypeOf('novel')).toBe('MANGA');
		expect(anilistType('anime')).toBe('ANIME');
	});

	it('reads a pasted AniList link only for its own kind', () => {
		expect(parsePasted('https://anilist.co/anime/21', 'anime')).toEqual({
			service: 'anilist',
			id: 21
		});
		expect(parsePasted('https://anilist.co/manga/21', 'anime')).toBeNull();
	});
});

describe('whether a catalogue can answer here', () => {
	it('AniList always can, and needs no key', () => {
		delete process.env.TMDB_API_KEY;
		delete process.env.TMDB_API_RC_TOKEN;
		expect(catalogueConfigured('anilist')).toBe(true);
		expect(catalogueMissing('anime')).toBeNull();
		expect(catalogueFor('anime')).toMatchObject({ provider: 'anilist', configured: true });
	});

	it('TMDB cannot until the install has a key', () => {
		delete process.env.TMDB_API_KEY;
		delete process.env.TMDB_API_RC_TOKEN;
		expect(tmdbKey()).toBe('');
		expect(catalogueConfigured('tmdb')).toBe(false);

		process.env.TMDB_API_KEY = 'v3-key';
		expect(tmdbKey()).toBe('v3-key');
		expect(catalogueConfigured('tmdb')).toBe(true);
	});

	it('prefers the v4 read token to the v3 key', () => {
		process.env.TMDB_API_KEY = 'v3-key';
		process.env.TMDB_API_RC_TOKEN = 'v4-token';
		expect(tmdbKey()).toBe('v4-token');
	});

	it('reads the key at call time, so one added later counts', () => {
		delete process.env.TMDB_API_KEY;
		delete process.env.TMDB_API_RC_TOKEN;
		expect(catalogueConfigured('tmdb')).toBe(false);
		process.env.TMDB_API_RC_TOKEN = 'later';
		expect(catalogueConfigured('tmdb')).toBe(true);
	});
});
