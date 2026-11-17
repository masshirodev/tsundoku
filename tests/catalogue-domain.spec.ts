import { describe, expect, it } from 'vitest';
import {
	ANIME_FORMATS,
	anilistUrl,
	bracketed,
	cleanTitle,
	malUrl,
	searchTitles,
	candidateKind,
	candidateRows,
	formatLabel,
	idsLine,
	isCutShort,
	isExact,
	matchTitles,
	normaliseTitle,
	parsePasted,
	sameKind,
	scoreToRating,
	searchTitle,
	seriesYear,
	sharedWords,
	sureMatch,
	whyLine,
	wrongKind,
	yearIn,
	type Candidate
} from '$lib/library/catalogue';

const cand = (o: Partial<Candidate>): Candidate => ({
	anilistId: 1,
	malId: 2,
	title: 'The Genius Medicinal Mage',
	alts: ['Yakmeogneun Cheonjae Mabeopsa', '약 먹는 천재마법사'],
	format: 'MANGA',
	country: 'KR',
	year: 2021,
	chapters: 190,
	volumes: null,
	episodes: null,
	season: null,
	seasonYear: null,
	status: 'RELEASING',
	coverUrl: '',
	...o
});

describe('titles', () => {
	it('compares without case, accents, punctuation or curly quotes', () => {
		expect(normaliseTitle('The Northern Duke’s Only Apprentice!')).toBe(
			normaliseTitle("the northern duke's only apprentice")
		);
		expect(normaliseTitle('Pokémon: Adventures')).toBe('pokemon adventures');
		expect(normaliseTitle('약 먹는 천재마법사')).toBe('약 먹는 천재마법사');
	});

	it('searches without the stub Mihon cut a long title to', () => {
		expect(searchTitle('Returned as the Sword Saint’s Youngest Son and...')).toBe(
			"Returned as the Sword Saint's Youngest Son"
		);
		expect(searchTitle('The Regressed Son of a Duke is an Assass…')).toBe(
			'The Regressed Son of a Duke is an Assass'
		);
		expect(searchTitle('Player')).toBe('Player');
		expect(isCutShort('Something of the...')).toBe(true);
		expect(isCutShort('Something')).toBe(false);
	});
});

describe('a sure match', () => {
	it('is a title equal to one of the series’, on any of the candidate’s titles', () => {
		expect(isExact(['Murim Login'], cand({ title: 'Log-in Murim', alts: ['Murim Login'] }))).toBe(
			true
		);
		expect(isExact(['Drug-Eating Genius Mage'], cand({}))).toBe(false);
	});

	it('never comes from a title Mihon cut short', () => {
		expect(isExact(['Player...'], cand({ title: 'Player', alts: [] }))).toBe(false);
	});

	it('is the one exact candidate, unless it’s a novel for a comic', () => {
		const comic = cand({ anilistId: 10, title: 'Player', alts: [] });
		const novel = cand({ anilistId: 11, title: 'Player', alts: [], format: 'NOVEL' });
		const other = cand({ anilistId: 12, title: 'Players Club', alts: [] });
		expect(sureMatch(['Player'], 'manhwa', [other, comic])?.anilistId).toBe(10);
		expect(sureMatch(['Player'], 'manhwa', [novel])).toBeNull();
		// Two exact: the one of the same kind.
		expect(sureMatch(['Player'], 'manhwa', [novel, comic])?.anilistId).toBe(10);
		expect(sureMatch(['Player'], 'novel', [novel, comic])?.anilistId).toBe(11);
		// Mihon's manga/manhwa guess can be wrong: still sure.
		expect(sureMatch(['Player'], 'manga', [comic])?.anilistId).toBe(10);
		// Two of the same kind: no sure link.
		expect(sureMatch(['Player'], 'manhwa', [comic, { ...comic, anilistId: 13 }])).toBeNull();
		expect(sureMatch(['Player'], 'manhwa', [])).toBeNull();
	});

	it('reads the kind from the format and the country', () => {
		expect(candidateKind({ format: 'MANGA', country: 'KR' })).toBe('manhwa');
		expect(candidateKind({ format: 'MANGA', country: 'JP' })).toBe('manga');
		expect(candidateKind({ format: 'ONE_SHOT', country: 'JP' })).toBe('manga');
		expect(candidateKind({ format: 'NOVEL', country: 'KR' })).toBe('novel');
		expect(candidateKind({ format: 'MUSIC', country: 'JP' })).toBeNull();
		// An anime, whatever its country.
		for (const format of ANIME_FORMATS)
			expect(candidateKind({ format, country: 'JP' })).toBe('anime');
	});

	it('never crosses an anime with a comic or a novel, nor either with an anime', () => {
		expect(sameKind('manga', 'manhwa')).toBe(true);
		expect(sameKind('novel', 'novel')).toBe(true);
		expect(sameKind('novel', 'manga')).toBe(false);
		expect(sameKind('anime', 'anime')).toBe(true);
		for (const k of ['manga', 'manhwa', 'novel'] as const) {
			expect(sameKind(k, 'anime')).toBe(false);
			expect(sameKind('anime', k)).toBe(false);
		}
		expect(sameKind('manga', null)).toBe(false);
		// A doujin is a comic, not a novel.
		expect(sameKind('doujin', 'novel')).toBe(false);
		expect(sameKind('doujin', 'manga')).toBe(true);
		expect(sameKind('doujin', 'doujin')).toBe(true);
	});

	it('marks the same titles exact in the review’s chip as the pass matches them', () => {
		const anime = cand({ anilistId: 40, title: 'Ranma ½', alts: [], format: 'TV' });
		// The raw title names 2024; the chip must read it as the pass does.
		expect(isExact(['Ranma ½ (2024)'], anime)).toBe(false);
		expect(isExact(matchTitles(['Ranma ½ (2024)']), anime)).toBe(true);
		// The title the user types is one of the series' too, as it is for the
		// pass: opening "Sousou no Frieren" and searching "Frieren" is exact.
		const frieren = cand({ anilistId: 41, title: 'Frieren', alts: [], format: 'TV' });
		expect(isExact(matchTitles(['Sousou no Frieren']), frieren)).toBe(false);
		expect(isExact(matchTitles(['Sousou no Frieren'], 'Frieren'), frieren)).toBe(true);
		expect(matchTitles(['Sousou no Frieren'], null)).toEqual(matchTitles(['Sousou no Frieren']));
	});

	it('is never an anime for a manga’s exact title, however well it matches', () => {
		const manga = cand({ anilistId: 20, title: 'Ranma ½', alts: [] });
		const anime = cand({
			anilistId: 21,
			title: 'Ranma ½',
			alts: [],
			format: 'TV',
			chapters: null,
			episodes: 24,
			season: 'FALL',
			seasonYear: 2024
		});
		// A manga series takes the manga; an anime series never takes it.
		expect(sureMatch(['Ranma ½'], 'manga', [manga])?.anilistId).toBe(20);
		expect(sureMatch(['Ranma ½'], 'anime', [manga])).toBeNull();
		expect(sureMatch(['Ranma ½'], 'anime', [manga, anime])?.anilistId).toBe(21);
		expect(sureMatch(['Ranma ½'], 'manga', [anime])).toBeNull();
	});

	it('settles two same-kind candidates by the year the series’ own title names', () => {
		const old = cand({
			anilistId: 31,
			title: 'Ranma ½',
			alts: [],
			format: 'TV',
			chapters: null,
			episodes: 18,
			season: 'SPRING',
			seasonYear: 1989,
			year: 1989
		});
		const recent = cand({
			anilistId: 32,
			title: 'Ranma ½',
			alts: [],
			format: 'TV',
			chapters: null,
			episodes: 24,
			season: 'FALL',
			seasonYear: 2024,
			year: 2024
		});
		// A search is given the series' titles cleaned too (`matchTitles`), so
		// "Ranma ½ (2024)" offers "Ranma ½" as well as itself.
		const titles = ['Ranma ½ (2024)', 'Ranma ½', '2024'];
		expect(sureMatch(titles, 'anime', [old, recent])?.anilistId).toBe(32);
		expect(sureMatch(['Ranma ½'], 'anime', [old, recent])).toBeNull();
		// The bracket is also one of the series' own titles, so an entry titled
		// "2024" alone would be exact; what matters is which one is chosen.
		expect(yearIn('Ranma ½ (2024)')).toBe(2024);
		expect(yearIn('Kaiju No. 8')).toBeNull();
		expect(seriesYear(['Some Show', 'Ranma ½ (2024)'])).toBe(2024);
		expect(seriesYear(['Kaiju No. 8'])).toBeNull();
	});
});

describe('a pasted link', () => {
	it('is read for its id, with or without the scheme and the slug', () => {
		expect(parsePasted('https://anilist.co/manga/171204')).toEqual({
			service: 'anilist',
			id: 171204
		});
		expect(parsePasted('anilist.co/manga/171204/Geomseong/')).toEqual({
			service: 'anilist',
			id: 171204
		});
		expect(parsePasted(' https://myanimelist.net/manga/160388/Some_Title ')).toEqual({
			service: 'mal',
			id: 160388
		});
		expect(parsePasted('https://www.myanimelist.net/manga/5?q=1')).toEqual({
			service: 'mal',
			id: 5
		});
	});

	it('is nothing when it isn’t a manga entry', () => {
		expect(parsePasted('https://anilist.co/anime/1')).toBeNull();
		expect(parsePasted('https://example.com/manga/1')).toBeNull();
		expect(parsePasted('The Genius Medicinal Mage')).toBeNull();
		expect(parsePasted('anilist.co/manga/0')).toBeNull();
	});

	it('reads the anime path for an anime series, and only its own kind’s', () => {
		expect(parsePasted('https://anilist.co/anime/30023', 'anime')).toEqual({
			service: 'anilist',
			id: 30023
		});
		expect(parsePasted('https://myanimelist.net/anime/23/Ranma', 'anime')).toEqual({
			service: 'mal',
			id: 23
		});
		// A manga link on an anime is another work, and the other way round.
		expect(parsePasted('https://anilist.co/manga/30023', 'anime')).toBeNull();
		expect(parsePasted('https://anilist.co/anime/30023', 'manga')).toBeNull();
		expect(parsePasted('https://anilist.co/anime/30023', 'novel')).toBeNull();
	});
});

describe('an entry’s own page', () => {
	it('is on the path of the series’ kind, on every site', () => {
		expect(anilistUrl(30024, 'anime')).toBe('https://anilist.co/anime/30024');
		expect(malUrl(23, 'anime')).toBe('https://myanimelist.net/anime/23');
		// The default stays the manga path, which is what a comic and a novel read.
		expect(anilistUrl(30024)).toBe('https://anilist.co/manga/30024');
		expect(malUrl(23, 'manga')).toBe('https://myanimelist.net/manga/23');
	});
});

describe('score to rating (Catalogue Links 1w)', () => {
	it('keeps a score out of 10 as it is, rounded', () => {
		expect(scoreToRating(9)).toBe(9);
		expect(scoreToRating(10)).toBe(10);
		expect(scoreToRating(8)).toBe(8);
		expect(scoreToRating(7.5)).toBe(8);
		expect(scoreToRating(7.4)).toBe(7);
	});

	it('gives any score at least 1, and none 0', () => {
		expect(scoreToRating(1)).toBe(1);
		expect(scoreToRating(0)).toBe(0);
		expect(scoreToRating(Number.NaN)).toBe(0);
	});

	it('reads another scale as out of 10', () => {
		expect(scoreToRating(90, 100)).toBe(9);
		expect(scoreToRating(5, 5)).toBe(10);
		expect(scoreToRating(3, 5)).toBe(6);
	});
});

describe('the review’s words', () => {
	const series = { titles: ['Drug-Eating Genius Mage'], kind: 'manhwa' as const, chapters: 188 };

	it('names the words a candidate shares with the series', () => {
		expect(sharedWords(series.titles, cand({ title: 'The Genius Archmage Returns' }))).toEqual([
			'genius'
		]);
		expect(whyLine(series, cand({ title: 'Genius Mage of the Drug Guild', chapters: 20 }))).toBe(
			'SHARES DRUG · GENIUS · MAGE'
		);
	});

	it('says another English title when none are shared, and what agrees', () => {
		expect(whyLine(series, cand({ title: 'The Medicinal Wizard', alts: [] }))).toBe(
			'ANOTHER ENGLISH TITLE · SAME KIND, CHAPTERS CLOSE'
		);
		expect(
			whyLine(series, cand({ title: 'Swordmaster', alts: [], malId: null, chapters: 5 }))
		).toBe('ANOTHER ENGLISH TITLE · SAME KIND · NOT ON MAL');
	});

	it('marks the rows that agree with the series', () => {
		const rows = candidateRows(series, cand({}));
		expect(rows.map((r) => [r.label, r.value, r.agree])).toEqual([
			['FORMAT', 'MANHWA · SAME', true],
			['YEAR', '2021', false],
			['CHAPTERS', '190 · THIS HAS 188', true],
			['STATUS', 'RELEASING', false]
		]);
		const novel = candidateRows(series, cand({ format: 'NOVEL', chapters: null, volumes: 6 }));
		expect(novel[0]).toEqual({ label: 'FORMAT', value: 'NOVEL', agree: false });
		expect(novel[2].value).toBe('6 VOL.');
	});

	it('names both ids, or the one there is', () => {
		expect(idsLine(132215, 128830)).toBe('ANILIST 132215 · MAL 128830');
		expect(idsLine(118400, null)).toBe('ANILIST 118400');
		expect(idsLine(null, 128830)).toBe('MAL 128830');
	});

	it('names an anime’s format, season and episodes, where a comic names chapters', () => {
		const anime = cand({
			format: 'TV',
			chapters: null,
			episodes: 24,
			season: 'FALL',
			seasonYear: 2024,
			year: 2024
		});
		expect(formatLabel(anime)).toBe('TV');
		expect(formatLabel(cand({ format: 'TV_SHORT' }))).toBe('TV SHORT');
		const series = { kind: 'anime' as const, chapters: 24, titles: ['Ranma ½ (2024)'] };
		expect(candidateRows(series, anime).map((r) => [r.label, r.value, r.agree])).toEqual([
			['FORMAT', 'TV · SAME', true],
			['SEASON', 'FALL 2024', true],
			['EPISODES', '24 · THIS HAS 24', true],
			['STATUS', 'RELEASING', false]
		]);
		// A manga keeps its own four rows.
		expect(candidateRows({ kind: 'manhwa', chapters: 188 }, cand({})).map((r) => r.label)).toEqual([
			'FORMAT',
			'YEAR',
			'CHAPTERS',
			'STATUS'
		]);
	});

	it('reads a candidate stored before episodes and season existed as having neither', () => {
		// A row kept in link_candidates before `Candidate` grew the three keys
		// parses with no key at all, and `!== null` would build a row from
		// `undefined` (the live Trigun Stampede candidates).
		const legacy = cand({ format: 'TV', chapters: null }) as unknown as Record<string, unknown>;
		delete legacy.episodes;
		delete legacy.season;
		delete legacy.seasonYear;
		const rows = candidateRows(
			{ kind: 'anime', chapters: 12, titles: ['Trigun Stampede'] },
			legacy as unknown as Candidate
		);
		expect(rows.map((r) => [r.label, r.value])).toEqual([
			['FORMAT', 'TV · SAME'],
			['SEASON', '2021'],
			['EPISODES', '—'],
			['STATUS', 'RELEASING']
		]);
	});

	it('calls a link whose entry is the other kind wrong, but not a novel’s comic', () => {
		expect(wrongKind('anime', 'MANGA')).toBe(true);
		expect(wrongKind('anime', 'NOVEL')).toBe(true);
		expect(wrongKind('anime', 'TV')).toBe(false);
		expect(wrongKind('manga', 'TV')).toBe(true);
		expect(wrongKind('manga', 'MANGA')).toBe(false);
		// The deliberate cover-only crossing is not this.
		expect(wrongKind('novel', 'MANGA')).toBe(false);
		expect(wrongKind('manga', 'NOVEL')).toBe(false);
		// Nothing known yet: nothing to flag.
		expect(wrongKind('anime', '')).toBe(false);
	});
});

describe('cleaning a title before it’s searched', () => {
	it('drops what the files and sources add', () => {
		expect(cleanTitle('One Piece (Official Colored)')).toBe('One Piece');
		expect(cleanTitle('Hero Killer (Beolkkul)')).toBe('Hero Killer');
		expect(cleanTitle('The Apothecary Diaries: Volume 4')).toBe('The Apothecary Diaries');
		expect(cleanTitle('Alya Sometimes Hides Her Feelings in Russian, Vol. 1')).toBe(
			'Alya Sometimes Hides Her Feelings in Russian'
		);
		expect(cleanTitle('Kino no Tabi - Volume 1')).toBe('Kino no Tabi');
		expect(cleanTitle('The Beginning After the End: Book 10: Retribution')).toBe(
			'The Beginning After the End'
		);
		expect(cleanTitle('The Beginning After The End 08')).toBe('The Beginning After The End');
		expect(cleanTitle('Lord of the Mysteries: 1-1429')).toBe('Lord of the Mysteries');
		expect(cleanTitle('Pick Me Up! c1-591')).toBe('Pick Me Up!');
		expect(cleanTitle('Swordmaster’s Youngest Son')).toBe("Swordmaster's Youngest Son");
		expect(cleanTitle('SSS-Class Suicide Hunter Novel')).toBe('SSS-Class Suicide Hunter');
		expect(cleanTitle('Second Life Ranker Novel (Ranker Who Lives Twice Novel)')).toBe(
			'Second Life Ranker'
		);
	});

	it('leaves a plain title, and a number that is the title’s own, as they are', () => {
		expect(cleanTitle('Tower of God')).toBe('Tower of God');
		expect(cleanTitle('Kaiju No. 8')).toBe('Kaiju No. 8');
		expect(cleanTitle('Mob Psycho 100')).toBe('Mob Psycho 100');
		expect(cleanTitle('86')).toBe('86');
	});

	it('falls back to the part before a subtitle', () => {
		expect(
			searchTitles('Clevatess - The King of Devil Beasts, The Baby and the Brave of Undead')
		).toEqual([
			'Clevatess - The King of Devil Beasts, The Baby and the Brave of Undead',
			'Clevatess'
		]);
		expect(searchTitles('Mushoku Tensei: Jobless Reincarnation Vol. 2')).toEqual([
			'Mushoku Tensei: Jobless Reincarnation',
			'Mushoku Tensei'
		]);
		expect(searchTitles('Player')).toEqual(['Player']);
	});

	it('reads what’s in brackets as another title', () => {
		expect(bracketed('Hero Killer (Beolkkul)')).toEqual(['Beolkkul']);
		expect(bracketed('Player')).toEqual([]);
	});
});

describe('isAnime asks the kind registry', async () => {
	const { isAnime } = await import('$lib/library/catalogue');
	const { KINDS } = await import('$lib/library/kinds');
	it('is true for exactly the kinds AniList lists as ANIME, over every kind', () => {
		expect(Object.fromEntries(KINDS.map((k) => [k, isAnime(k)]))).toEqual({
			manga: false,
			manhwa: false,
			doujin: false,
			novel: false,
			anime: true,
			movie: false,
			show: false
		});
		expect(isAnime(null)).toBe(false);
		expect(isAnime(undefined)).toBe(false);
	});
});
