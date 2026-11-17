import { describe, expect, it } from 'vitest';
import { defaultShowName, seasonMark, stripSeason } from '$lib/library/season-name';

/**
 * The name rule (doc/WORKS.md, "Per-season sources"). Migration
 * 55's frozen SQL stamps `entries.season` from the same shapes, so every
 * marker it knows is here, and the near misses say what is a name and what
 * only looks like one.
 */

describe('seasonMark', () => {
	const marked: [string, number, string][] = [
		["Frieren: Beyond Journey's End Season 2", 2, 'Season 2'],
		["Frieren: Beyond Journey's End season 2", 2, 'season 2'],
		['Kono Subarashii Sekai ni Shukufuku wo! Season 12', 12, 'Season 12'],
		['A Show 2nd Season', 2, '2nd Season'],
		['A Show 1st season', 1, '1st season'],
		['A Show 3rd Season', 3, '3rd Season'],
		['A Show 4th Season', 4, '4th Season'],
		['Oshi no Ko S2', 2, 'S2'],
		['Oshi no Ko s3', 3, 's3'],
		['Attack on Titan Part 2', 2, 'Part 2'],
		['Attack on Titan part 3', 3, 'part 3'],
		['Made in Abyss II', 2, 'II'],
		// A numeral after Season or Part is part of that word's marker:
		// the name is what is left without the whole suffix.
		['Made in Abyss Season III', 3, 'Season III'],
		['Made in Abyss Part II', 2, 'Part II'],
		// A Part after a Season is the same marker, not a name left half stripped.
		['A Show Season 3 Part 2', 3, 'Season 3 Part 2'],
		['A Show Season III Part II', 3, 'Season III Part II'],
		['  A Show Season 2  ', 2, 'Season 2']
	];
	for (const [title, season, marker] of marked)
		it(`reads ${JSON.stringify(title)} as season ${season}`, () => {
			expect(seasonMark(title)).toEqual({ season, marker });
		});

	const plain = [
		'Kaminaki Sekai no Kamisama Katsudou',
		'Season 2 of the Witch',
		'The 100',
		'A Show Part',
		'A Show Season',
		'A Show I',
		'A Show Part 2 Again',
		// Only a bare II is a season marker; a longer numeral is a title's own
		// ("Final Fantasy VII").
		'Made in Abyss III',
		'A Show XIV',
		'Final Fantasy VII',
		'Season 2',
		'',
		'   '
	];
	for (const title of plain)
		it(`leaves ${JSON.stringify(title)} alone`, () => {
			expect(seasonMark(title)).toBeNull();
		});
});

describe('stripSeason', () => {
	it('takes the trailing marker and the separator with it', () => {
		expect(stripSeason("Frieren: Beyond Journey's End Season 2")).toEqual({
			name: "Frieren: Beyond Journey's End",
			mark: { season: 2, marker: 'Season 2' }
		});
		expect(stripSeason('A Show - Part 2')).toEqual({
			name: 'A Show',
			mark: { season: 2, marker: 'Part 2' }
		});
		expect(stripSeason('A Show: S2')).toEqual({
			name: 'A Show',
			mark: { season: 2, marker: 'S2' }
		});
		expect(stripSeason('A Show Season 3 Part 2')).toEqual({
			name: 'A Show',
			mark: { season: 3, marker: 'Season 3 Part 2' }
		});
		expect(stripSeason('Final Fantasy VII')).toEqual({ name: 'Final Fantasy VII', mark: null });
	});

	it('keeps a title that is only a marker', () => {
		expect(stripSeason('Season 2')).toEqual({ name: 'Season 2', mark: null });
	});

	it('holds on its own output: stripping a name changes nothing', () => {
		for (const title of [
			'A Show Season 2',
			'A Show 2nd Season',
			'A Show S2',
			'A Show Part 2',
			'A Show II',
			'Kaminaki Sekai no Kamisama Katsudou'
		]) {
			const once = stripSeason(title).name;
			expect(stripSeason(once)).toEqual({ name: once, mark: null });
		}
	});
});

describe('defaultShowName', () => {
	it('keeps the shortest title, without its marker, and words the label', () => {
		expect(
			defaultShowName(["Frieren: Beyond Journey's End Season 2", "Frieren: Beyond Journey's End"])
		).toEqual({
			name: "Frieren: Beyond Journey's End",
			without: 'SEASON 2'
		});
		expect(defaultShowName(['Made in Abyss II', 'Made in Abyss: The Golden City'])).toEqual({
			name: 'Made in Abyss',
			without: 'II'
		});
	});

	it('says which marker it removed', () => {
		expect(defaultShowName(['A Show Season 2', 'A Show Season 2 Extra'])).toEqual({
			name: 'A Show',
			without: 'SEASON 2'
		});
	});

	it('keeps the first of equal lengths, and answers empty for no titles', () => {
		expect(defaultShowName(['A Show S2', 'A Show S3'])).toEqual({
			name: 'A Show',
			without: 'S2'
		});
		expect(defaultShowName([])).toEqual({ name: '', without: null });
		expect(defaultShowName(['  '])).toEqual({ name: '', without: null });
	});
});
