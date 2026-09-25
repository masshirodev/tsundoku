import { describe, expect, it } from 'vitest';
import {
	bracketed,
	cleanTitle,
	searchTitles,
	candidateKind,
	candidateRows,
	idsLine,
	isCutShort,
	isExact,
	normaliseTitle,
	parsePasted,
	scoreToRating,
	searchTitle,
	sharedWords,
	sureMatch,
	whyLine,
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
			'Returned as the Sword Saint’s Youngest Son'
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
});

describe('score to rating (Catalogue Links 1w)', () => {
	it('halves a score out of 10 and rounds down', () => {
		expect(scoreToRating(9)).toBe(4);
		expect(scoreToRating(10)).toBe(5);
		expect(scoreToRating(8)).toBe(4);
		expect(scoreToRating(7.5)).toBe(3);
	});

	it('gives any score at least 1, and none 0', () => {
		expect(scoreToRating(1)).toBe(1);
		expect(scoreToRating(0)).toBe(0);
		expect(scoreToRating(Number.NaN)).toBe(0);
	});

	it('reads another scale as out of 10', () => {
		expect(scoreToRating(90, 100)).toBe(4);
		expect(scoreToRating(5, 5)).toBe(5);
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
