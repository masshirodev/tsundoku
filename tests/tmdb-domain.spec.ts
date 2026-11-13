import { describe, expect, it } from 'vitest';
import { tmdbQuery } from '$lib/library/tmdb';

/**
 * The query TMDB is asked (card c989): the source's title with the release
 * group's words and the season number taken off, and the year read before
 * `cleanTitle` removes the bracket that held it.
 */
describe('tmdbQuery', () => {
	it('takes the release group’s words off a film title', () => {
		expect(tmdbQuery('Lupin [Hindi-English] 1080p WEB-DL x264')).toEqual({
			query: 'Lupin',
			year: null
		});
		expect(tmdbQuery('Parasite 2160p DUAL HDR')).toEqual({ query: 'Parasite', year: null });
		expect(tmdbQuery('[Group] The Long Ferry - 720p ESub')).toEqual({
			query: 'The Long Ferry',
			year: null
		});
	});

	it('reads the year before the bracket is removed', () => {
		expect(tmdbQuery('The Long Ferry (2024) 2160p DUAL')).toEqual({
			query: 'The Long Ferry',
			year: 2024
		});
	});

	it('takes a season number off a show', () => {
		expect(tmdbQuery('Alchemy of Souls S2 720p ESub')).toEqual({
			query: 'Alchemy of Souls',
			year: null
		});
		expect(tmdbQuery('Alchemy of Souls Season 2')).toEqual({
			query: 'Alchemy of Souls',
			year: null
		});
	});

	it('leaves a plain title alone, and never answers empty', () => {
		expect(tmdbQuery('Parasite')).toEqual({ query: 'Parasite', year: null });
		expect(tmdbQuery('1080p')).toEqual({ query: '1080p', year: null });
	});

	it('keeps a title’s own words that are not the release’s', () => {
		expect(tmdbQuery('Kimetsu no Yaiba: Mugen Train (2020)')).toEqual({
			query: 'Kimetsu no Yaiba: Mugen Train',
			year: 2020
		});
	});
});
