import { describe, expect, it } from 'vitest';
import {
	runtimeWords,
	tmdbQuery,
	tmdbRows,
	tmdbSure,
	tmdbWhy,
	type TmdbTitle
} from '$lib/library/tmdb';

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

const t = (o: Partial<TmdbTitle> & { id: number; title: string }): TmdbTitle => ({
	media: 'movie',
	originalTitle: '',
	year: null,
	overview: '',
	poster: null,
	runtime: null,
	seasons: null,
	collection: null,
	...o
});

describe('tmdbSure', () => {
	it('links one equal title, through the release tail', () => {
		const one = t({ id: 1, title: 'Lupin', year: 2021 });
		expect(
			tmdbSure(['Lupin [Hindi-English] 1080p WEB-DL'], null, [
				one,
				t({ id: 2, title: 'Lupin III' })
			])
		).toBe(one);
	});

	it('takes the original title as one of the entry’s', () => {
		const one = t({ id: 3, title: 'The Handmaiden', originalTitle: '아가씨', year: 2016 });
		expect(tmdbSure(['아가씨'], null, [one])).toBe(one);
	});

	it('lets the year choose between a remake and its original, one either way', () => {
		const old = t({ id: 4, title: 'Solaris', year: 1972 });
		const remake = t({ id: 5, title: 'Solaris', year: 2002 });
		expect(tmdbSure(['Solaris'], 2003, [old, remake])).toBe(remake);
		expect(tmdbSure(['Solaris'], null, [old, remake])).toBeNull();
		expect(tmdbSure(['Solaris'], 1990, [old, remake])).toBeNull();
	});

	it('never calls a title that only shares words sure', () => {
		expect(tmdbSure(['Paper Moons'], null, [t({ id: 6, title: 'Paper Moon' })])).toBeNull();
	});
});

describe('the review’s words', () => {
	it('says a runtime the screen’s way', () => {
		expect(runtimeWords(118)).toBe('1 H 58');
		expect(runtimeWords(120)).toBe('2 H');
		expect(runtimeWords(45)).toBe('45 MIN');
		expect(runtimeWords(65)).toBe('1 H 05');
		expect(runtimeWords(null)).toBe('');
	});

	it('draws a film’s rows and a show’s', () => {
		const f = t({ id: 7, title: 'X', year: 2024, runtime: 118 });
		expect(tmdbRows({ year: 2024 }, f)).toEqual([
			{ label: 'FORMAT', value: 'FILM · SAME', agree: true },
			{ label: 'YEAR', value: '2024 · SAME', agree: true },
			{ label: 'RUNTIME', value: '1 H 58', agree: false }
		]);
		const s = t({ id: 8, title: 'Y', media: 'tv', seasons: 4 });
		expect(tmdbRows({ year: null }, s).map((r) => r.value)).toEqual(['SHOW · SAME', '—', '4']);
	});

	it('says why a candidate might be the one', () => {
		expect(
			tmdbWhy(
				{ titles: ['The Long Ferry'], year: 2024 },
				t({ id: 9, title: 'Long Ferry', year: 2024 })
			)
		).toBe('SHARES LONG · FERRY · SAME YEAR');
		expect(tmdbWhy({ titles: ['Abc'], year: null }, t({ id: 10, title: 'Xyz' }))).toBe(
			'ANOTHER ENGLISH TITLE'
		);
	});
});
