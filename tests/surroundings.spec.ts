import { describe, expect, it } from 'vitest';
import {
	collectionView,
	dayWords,
	partName,
	showView,
	titleSeason,
	type CollectionItem,
	type HeldFilm
} from '$lib/library/surroundings';
import type { TmdbCollection, TmdbShowFacts } from '$lib/library/tmdb';

/**
 * What surrounds a film or a show: each case is one of the design's states,
 * in its words.
 */

const NOW = Date.UTC(2026, 10, 12);

const ferry: TmdbCollection = {
	id: 1,
	name: 'The Long Ferry Collection',
	parts: [
		{ id: 11, title: 'The Long Ferry', year: 2024, date: '2024-03-01' },
		{ id: 12, title: 'The Long Ferry: Wake', year: 2025, date: '2025-04-01' },
		{ id: 13, title: 'The Long Ferry: Ash', year: 2026, date: '2026-06-01' }
	]
};

const held = (o: Record<number, Partial<HeldFilm>>) =>
	new Map(
		Object.entries(o).map(([id, h]) => [
			Number(id),
			{ seriesId: Number(id) * 10, watched: false, runtime: null, workId: null, ...h }
		])
	);

const rows = (items: CollectionItem[]) =>
	items.map((i) =>
		i.type === 'row' ? [i.row.tag, i.row.meta, i.row.cell?.label ?? ''] : [i.words]
	);

describe('a film’s collection', () => {
	it('part 1 of 3, in no Work: every part, this one inverted, GROUP → at the foot', () => {
		const v = collectionView({
			collection: ferry,
			thisId: 11,
			held: held({ 11: {}, 12: { runtime: 112 } }),
			workId: null
		});
		expect(v?.mode).toBe('parts');
		if (v?.mode !== 'parts') return;
		expect([v.name, v.at]).toEqual(['THE LONG FERRY COLLECTION', 'PART 1 OF 3']);
		expect(rows(v.items)).toEqual([
			['PART 1', 'THIS FILM · 2024', ''],
			['PART 2', '2025 · 1 H 52 · NOT WATCHED', 'IN LIBRARY →'],
			['PART 3', '2026 · NOT IN THE LIBRARY', 'FIND']
		]);
		expect(v.items[0].type === 'row' && v.items[0].row.on).toBe(true);
		expect(v.foot).toEqual({ words: '2 OF 3 IN THE LIBRARY · NOT A WORK', group: true });
	});

	it('the prequel is the row above, and one part here offers nothing', () => {
		const v = collectionView({
			collection: ferry,
			thisId: 12,
			held: held({ 12: {} }),
			workId: null
		});
		if (v?.mode !== 'parts') throw new Error('parts');
		expect(v.at).toBe('PART 2 OF 3');
		expect(rows(v.items)[0]).toEqual(['PART 1', '2024 · NOT IN THE LIBRARY', 'FIND']);
		expect(v.foot).toEqual({ words: '1 OF 3 IN THE LIBRARY', group: false });
	});

	it('past six, it folds round this one, saying what each fold hides', () => {
		const harbour: TmdbCollection = {
			id: 2,
			name: 'The Harbour Cases Collection',
			parts: Array.from({ length: 8 }, (_, i) => ({
				id: 100 + i,
				title: `Part ${i + 1}`,
				year: 2010 + i,
				date: `${2010 + i}-01-01`
			}))
		};
		const v = collectionView({
			collection: harbour,
			thisId: 105,
			held: held({ 100: {}, 101: {}, 103: {}, 104: { watched: true }, 105: {}, 106: {} }),
			workId: null
		});
		if (v?.mode !== 'parts') throw new Error('parts');
		expect(v.at).toBe('PART 6 OF 8');
		expect(rows(v.items)).toEqual([
			['↑ PARTS 1 – 4 · 3 IN LIBRARY · 1 NOT'],
			['PART 5', '2014 · WATCHED', 'IN LIBRARY →'],
			['PART 6', 'THIS FILM · 2015', ''],
			['PART 7', '2016 · NOT WATCHED', 'IN LIBRARY →'],
			['PART 8', '2017 · NOT IN THE LIBRARY', 'FIND']
		]);
		expect(v.foot.words).toBe('6 OF 8 IN THE LIBRARY · NOT A WORK');
	});

	it('all of it in the Work folds to one line, and unfolded says IN THE WORK', () => {
		const v = collectionView({
			collection: ferry,
			thisId: 12,
			held: held({ 11: { workId: 7, watched: true }, 12: { workId: 7 }, 13: { workId: 7 } }),
			workId: 7
		});
		if (v?.mode !== 'work') throw new Error('work');
		expect(v.line).toBe('THE LONG FERRY COLLECTION · ALL 3 IN THE WORK');
		expect(v.facts).toEqual([]);
		expect(v.rows.map((r) => [r.tag, r.meta, r.cell?.label ?? ''])).toEqual([
			['TMDB 1', '2024 · WATCHED', 'IN THE WORK'],
			['TMDB 2', 'THIS FILM · 2025', ''],
			['TMDB 3', '2026 · NOT WATCHED', 'IN THE WORK']
		]);
	});

	it('a part outside the Work is one fact, with its own cell', () => {
		const v = collectionView({
			collection: ferry,
			thisId: 12,
			held: held({ 11: { workId: 7 }, 12: { workId: 7 } }),
			workId: 7
		});
		if (v?.mode !== 'work') throw new Error('work');
		expect(v.line).toBe('THE LONG FERRY COLLECTION · 2 IN THE WORK');
		expect(v.facts.map((f) => [f.title, f.meta, f.cell?.label])).toEqual([
			['PART 3 · ASH', 'NOT IN THE LIBRARY', 'FIND']
		]);
	});

	it('offers no GROUP → when a part is already in a Work, and nothing for a film outside its collection', () => {
		const v = collectionView({
			collection: ferry,
			thisId: 11,
			held: held({ 11: {}, 12: { workId: 3 } }),
			workId: null
		});
		if (v?.mode !== 'parts') throw new Error('parts');
		expect(v.foot).toEqual({ words: '2 OF 3 IN THE LIBRARY', group: false });
		expect(
			collectionView({ collection: ferry, thisId: 99, held: held({}), workId: null })
		).toBeNull();
	});

	it('names a part by what follows the collection’s own name', () => {
		expect(partName('The Long Ferry: Ash', 'The Long Ferry Collection')).toBe('ASH');
		expect(partName('Another Film', 'The Long Ferry Collection')).toBe('ANOTHER FILM');
	});
});

const harbourLights: TmdbShowFacts = {
	id: 5,
	inProduction: true,
	next: null,
	seasons: [
		{ season: 1, episodes: 10, airDate: '2022-01-01', name: 'Season 1' },
		{ season: 2, episodes: 8, airDate: '2023-01-01', name: 'Season 2' },
		{ season: 3, episodes: 8, airDate: '2024-01-01', name: 'Season 3' },
		{ season: 4, episodes: 8, airDate: '2026-11-03', name: 'Season 4' }
	]
};

describe('a show’s seasons', () => {
	it('reads the season a source title names, never an episode code', () => {
		expect(titleSeason('Harbour Lights Season 3')).toBe(3);
		expect(titleSeason('Alchemy of Souls S2 720p')).toBe(2);
		expect(titleSeason('Show 2nd Season')).toBe(2);
		expect(titleSeason('Harbour Lights')).toBeNull();
		expect(titleSeason('Show S02E05')).toBeNull();
	});

	it('the heads, the SEASONS row and SEASON 4 IS OUT', () => {
		const v = showView({
			facts: harbourLights,
			showName: 'Harbour Lights',
			seriesId: 3,
			seriesTitle: 'Harbour Lights Season 3',
			held: [
				{ seriesId: 1, title: 'Harbour Lights' },
				{ seriesId: 2, title: 'Harbour Lights Season 2' }
			],
			declined: new Set(),
			now: NOW
		})!;
		expect([v.season, v.of]).toEqual([3, 4]);
		expect(v.heads.map((h) => [h.head, h.title, h.state, h.seriesId])).toEqual([
			['SEASON 1 · 10 EP', 'Harbour Lights', 'library', 1],
			['SEASON 2 · 8 EP', 'Harbour Lights Season 2', 'library', 2],
			['SEASON 3 · 8 EP · THIS SERIES', 'Harbour Lights Season 3', 'this', null],
			['SEASON 4 · 8 EP · TMDB · FROM 3 NOV', 'Harbour Lights', 'missing', null]
		]);
		expect(v.row).toEqual({
			title: '3 of 4 in the library',
			meta: 'TMDB LISTS 4 · S4 NOT IN THE LIBRARY',
			findRest: true
		});
		expect(v.band).toEqual({
			season: 4,
			title: 'SEASON 4 IS OUT · NOT IN YOUR LIBRARY',
			meta: 'TMDB · 8 EP · FROM 3 NOV · NO SERIES HOLDS IT'
		});
	});

	it('never offers a season not yet aired, nor one the user said NOT THIS to', () => {
		const base = {
			showName: 'Harbour Lights',
			seriesId: 3,
			seriesTitle: 'Harbour Lights Season 3',
			held: [],
			now: NOW
		};
		const later: TmdbShowFacts = {
			...harbourLights,
			seasons: harbourLights.seasons.map((s) =>
				s.season === 4 ? { ...s, airDate: '2027-02-01' } : s
			)
		};
		expect(showView({ ...base, facts: later, declined: new Set() })!.band).toBeNull();
		expect(
			showView({ ...base, facts: harbourLights, declined: new Set(['season:4']) })!.band
		).toBeNull();
	});

	it('says the day as the screens do', () => {
		expect(dayWords('2026-11-03', NOW)).toBe('3 NOV');
		expect(dayWords('2025-02-14', NOW)).toBe('14 FEB 2025');
		expect(dayWords(null, NOW)).toBe('');
	});
});
