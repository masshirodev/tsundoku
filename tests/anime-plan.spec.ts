import { describe, expect, it } from 'vitest';
import { numberOf, planAnime, seasonOf, titleOf } from '$lib/import/anime-plan';

// An Aniyomi anime as a series (doc/ANIME.md; card c154).
describe('an episode’s name', () => {
	it('gives its season where the engine named one, and nothing else is a season', () => {
		expect(seasonOf('Season 2 - Episode 3')).toEqual({ season: 2, rest: 'Episode 3' });
		expect(seasonOf('Frieren Season 2 - Episode 1 - Again')).toEqual({
			season: 2,
			rest: 'Episode 1 - Again'
		});
		expect(seasonOf('S3 : Ep 4')).toEqual({ season: 3, rest: 'Ep 4' });
		expect(seasonOf('Episode 5 - A Day Off')).toEqual({
			season: null,
			rest: 'Episode 5 - A Day Off'
		});
		expect(seasonOf('Part 2 - Episode 1')).toEqual({ season: null, rest: 'Part 2 - Episode 1' });
	});

	it('gives its number and its own title', () => {
		expect(numberOf('Episode 12')).toBe(12);
		expect(numberOf('Ep. 12.5 - Special')).toBe(12.5);
		expect(numberOf('7 - The Market')).toBe(7);
		expect(numberOf('Special')).toBeNull();
		expect(titleOf('Episode 2: The Ferry')).toBe('The Ferry');
		expect(titleOf('Episode 2')).toBe('');
		expect(titleOf('7 - The Market')).toBe('The Market');
		expect(titleOf('Special')).toBe('Special');
	});
});

describe('an anime’s plan', () => {
	const d = {
		sourceId: '7000',
		sourceName: 'KickAssAnime',
		url: '/a',
		title: ' A Show ',
		genres: ['Drama'],
		status: 2
	};

	it('is a flat list oldest first when the source has no seasons, a missing number placed by order', () => {
		const p = planAnime(
			d,
			[
				{ url: '/3', name: 'Episode 3' },
				{ url: '/x', name: 'Special' },
				{ url: '/2', name: 'Episode 2', episode_number: 2 },
				{ url: '/1', name: 'Episode 1', episode_number: 1 },
				{ url: '/1', name: 'Episode 1 again' }
			],
			5
		);
		expect(p).toMatchObject({
			originKey: 'aniyomi:7000:/a',
			kind: 'anime',
			title: 'A Show',
			status: 'completed'
		});
		expect(p.entries.map((e) => [e.position, e.sourceUrl, e.label, e.episode?.season])).toEqual([
			[1, '/1', 'Ep. 1', null],
			[2, '/2', 'Ep. 2', null],
			[3, '/x', 'Ep. 3', null],
			[4, '/3', 'Ep. 3', null]
		]);
		expect(p.tags).toEqual([
			{ namespace: 'genre', value: 'drama' },
			{ namespace: 'source', value: 'KickAssAnime' }
		]);
	});
});
