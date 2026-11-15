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

	// A pack of seasons in one entry (c998): Movies Mod's Lupin names them so.
	it('gives its season with no separator, when the episode follows the season', () => {
		expect(seasonOf('Season 4  Ep 8')).toEqual({ season: 4, rest: 'Ep 8' });
		expect(seasonOf('Season 2 Episode 3 - The Heist')).toEqual({
			season: 2,
			rest: 'Episode 3 - The Heist'
		});
		expect(seasonOf('S3 Ep. 1')).toEqual({ season: 3, rest: 'Ep. 1' });
		expect(seasonOf('Lupin Season 1 Ep 2')).toEqual({ season: 1, rest: 'Ep 2' });
		// No episode after it: not a season and an episode.
		expect(seasonOf('Season 2 Recap')).toEqual({ season: null, rest: 'Season 2 Recap' });
		expect(seasonOf('Seasons Ep 3')).toEqual({ season: null, rest: 'Seasons Ep 3' });
		const { rest } = seasonOf('Season 4  Ep 8');
		expect([numberOf(rest), titleOf(rest)]).toEqual([8, '']);
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

	// A pack is no one season (c998): read as its first, it stamped season 1 on
	// every episode of four seasons. None is stamped, so the episodes' own
	// names give their seasons, and a pack whose episodes name none stays flat.
	it('is nothing for a pack of seasons', () => {
		expect(
			seasonOfTitle(
				'Lupin (Season 1-4) Multi Audio {Hindi-English-French} WeB-DL 480p [170MB] || 720p [290MB] || 1080p [1GB]'
			)
		).toBeNull();
		expect(seasonOfTitle('A Show Seasons 1 to 3')).toBeNull();
		expect(seasonOfTitle('A Show S1-S4')).toBeNull();
		expect(seasonOfTitle('A Show Season 2 - 2nd Cour')).toBe(2);
		expect(seasonOfTitle('A Show (Season 3-1)')).toBe(3);
	});

	it('is read from the slug when the title does not say it', () => {
		expect(seasonOfTitle('A Show', '/ascendance-of-a-bookworm-season-3-d2a9')).toBe(3);
		expect(seasonOfTitle('A Show', '/a-show-season-2')).toBe(2);
		expect(seasonOfTitle('A Show', '/a-show-3rd-season-9c1f')).toBe(3);
		expect(seasonOfTitle('A Show', '/a-show-f8e7')).toBeNull();
		expect(seasonOfTitle('A Show', '/a-show-season-1-4-hindi')).toBeNull();
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

	// The owner's Lupin (c998, series 7378): four seasons of eight in one entry,
	// listed newest first, each episode numbered within its season.
	it('reads a pack of seasons into its seasons, oldest first', () => {
		const listed = [];
		for (let season = 4; season >= 1; season--)
			for (let n = 8; n >= 1; n--)
				listed.push({
					url: `/s${season}e${n}`,
					name: `Season ${season}  Ep ${n}`,
					episode_number: n
				});
		const p = planAnime(
			{ ...d, title: 'Lupin (Season 1-4) Multi Audio {Hindi-English-French} WeB-DL 480p [170MB]' },
			listed,
			5
		);
		const order = p.entries.map((e) => `S${e.episode?.season}E${e.episode?.number}`);
		expect(order.slice(0, 9)).toEqual([
			'S1E1',
			'S1E2',
			'S1E3',
			'S1E4',
			'S1E5',
			'S1E6',
			'S1E7',
			'S1E8',
			'S2E1'
		]);
		expect(order.slice(-8)).toEqual([
			'S4E1',
			'S4E2',
			'S4E3',
			'S4E4',
			'S4E5',
			'S4E6',
			'S4E7',
			'S4E8'
		]);
		expect(p.entries.find((e) => e.sourceUrl === '/s4e8')).toMatchObject({
			label: 'Ep. 8',
			title: ''
		});
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
