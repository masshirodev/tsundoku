import { describe, expect, it } from 'vitest';
import { numberOf, planAnime, seasonOf, seasonOfTitle, titleOf } from '$lib/import/anime-plan';

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

// A source that makes each season its own entry (KickAssAnime, AnimePahe) says
// the season in the entry, never in its flat episode names (c219).
describe('a series’ own season', () => {
	it('is read from the title, in the forms sources use', () => {
		expect(seasonOfTitle('Kaminaki Sekai no Kamisama Katsudou')).toBeNull();
		expect(
			seasonOfTitle(
				'Honzuki no Gekokujou: Shisho ni Naru Tame ni wa Shudan wo Erandeiraremasen 3rd Season'
			)
		).toBe(3);
		expect(seasonOfTitle('Kono Subarashii Sekai ni Shukufuku wo! Season 2')).toBe(2);
		expect(seasonOfTitle('"Oshi no Ko" (Season 2)')).toBe(2);
		expect(seasonOfTitle('A Show Season 12')).toBe(12);
		expect(seasonOfTitle('A Show 1st Season')).toBe(1);
	});

	it('is read from the slug when the title does not say it', () => {
		expect(seasonOfTitle('A Show', '/ascendance-of-a-bookworm-season-3-d2a9')).toBe(3);
		expect(seasonOfTitle('A Show', '/a-show-season-2')).toBe(2);
		expect(seasonOfTitle('A Show', '/a-show-3rd-season-9c1f')).toBe(3);
		expect(seasonOfTitle('A Show', '/a-show-f8e7')).toBeNull();
		expect(seasonOfTitle('A Show Season 2', '/a-show-season-3')).toBe(2);
	});

	it('reaches its episodes that name no season, and loses to one that does', () => {
		const p = planAnime(
			{
				sourceId: '7000',
				sourceName: 'KickAssAnime',
				url: '/ascendance-of-a-bookworm-season-3-d2a9',
				title: 'Honzuki no Gekokujou 3rd Season',
				status: 2
			},
			[
				{ url: '/ep-2', name: 'Episode 2', episode_number: 2 },
				{ url: '/ep-1', name: 'Episode 1', episode_number: 1 }
			],
			5
		);
		expect(p.entries.map((e) => [e.label, e.episode?.season, e.episode?.number])).toEqual([
			['Ep. 1', 3, 1],
			['Ep. 2', 3, 2]
		]);
		// A list that names seasons per episode keeps its own, even under a
		// series title that says another.
		const flat = planAnime(
			{
				sourceId: '7000',
				sourceName: 'KickAssAnime',
				url: '/a-show-season-3',
				title: 'A Show Season 3'
			},
			[{ url: '/e1', name: 'Season 1 - Episode 1', episode_number: 1 }],
			5
		);
		expect(flat.entries[0].episode?.season).toBe(1);
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

// One split for people (c508): Aniyomi's author and artist are tagged as
// Mihon's are, and as the preview links them. It split on commas alone.
describe('an anime’s people', () => {
	// c508: the same strings, and the same answers, as tests/tag-search.spec.ts'
	// preview (`splitPeople`) and tests/{mihon,anime}-plan.spec.ts' importers.
	const PEOPLE: [string, string[]][] = [
		['Aoi Hanamura, Ren Kisaragi', ['Aoi Hanamura', 'Ren Kisaragi']],
		['A / B; C & D', ['A', 'B', 'C', 'D']],
		['Unknown, _, Aoi', ['Aoi']],
		['Tanaka, Jr.', ['Tanaka, Jr.']],
		['Tanaka, Jr., Sato', ['Tanaka, Jr.', 'Sato']],
		['John Smith, III, Jane Doe, sr', ['John Smith, III', 'Jane Doe, sr']],
		['Kim / Lee II', ['Kim', 'Lee II']],
		['Ito & Sr', ['Ito, Sr']],
		['Jr., Sato', ['Jr.', 'Sato']],
		['Oda, Eiichiro', ['Oda', 'Eiichiro']]
	];
	it('are tagged as every importer and the preview split them', () => {
		for (const [raw, want] of PEOPLE) {
			const p = planAnime(
				{
					sourceId: '7000',
					sourceName: 'KickAssAnime',
					url: '/p',
					title: 'P',
					author: raw,
					artist: raw
				},
				[],
				5
			);
			const tagged = (ns: string) => p.tags.filter((t) => t.namespace === ns).map((t) => t.value);
			expect(tagged('author'), raw).toEqual(want);
			expect(tagged('artist'), raw).toEqual(want);
		}
	});
});

// Episode pictures (doc/ANIME.md, "Episode pictures"; card c225).
describe('an episode’s picture at the source', () => {
	it('is kept where the extension gives one, through the engine, and is nothing otherwise', () => {
		const p = planAnime(
			{ sourceId: '7000', sourceName: 'AnimePahe', url: '/show', title: 'A Show', status: 2 },
			[
				{ url: '/ep-1', name: 'Episode 1', preview_url: 'http://127.0.0.1:4590/image/abc' },
				{ url: '/ep-2', name: 'Episode 2', preview_url: null },
				{ url: '/ep-3', name: 'Episode 3' }
			],
			5
		);
		expect(p.entries.map((e) => e.episode?.thumbUrl)).toEqual([
			'http://127.0.0.1:4590/image/abc',
			'',
			''
		]);
	});
});
