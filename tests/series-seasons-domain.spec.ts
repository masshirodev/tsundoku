import { describe, expect, it } from 'vitest';
import {
	HOPS,
	relFacts,
	seasonsAround,
	titleStem,
	walkSeasons,
	type RelGraph,
	type RelNode
} from '$lib/library/seasons-around';

/**
 * The seasons around an anime (c358; doc/SERIES.md, "The seasons around
 * it"): the walk over a cached relation graph, the heads drawn from it, and
 * FIND's title stem. Pure, so the graph is built here; the walk's fetching
 * and the cache are tests/series-seasons-db.spec.ts'.
 */

type Edge = [type: string, id: number];
const node = (
	id: number,
	format: string,
	title: string,
	edges: Edge[] | null,
	o: Partial<RelNode> = {}
): RelNode => ({
	id,
	type: 'ANIME',
	format,
	status: 'FINISHED',
	episodes: 12,
	year: 2020,
	title: { english: title, romaji: null, native: null },
	edges: edges && edges.map(([type, to]) => ({ type, id: to })),
	...o
});
const graphOf = (...nodes: RelNode[]): RelGraph => ({
	nodes: Object.fromEntries(nodes.map((n) => [String(n.id), n]))
});

/**
 * The card's chain ('What counts'): it loops (the announced fifth season names
 * the first as its SEQUEL, and the first names it as its PREQUEL), it branches
 * (season 4 has a SPECIAL beside its ONA prequel), a MOVIE stands on the main
 * chain between seasons 2 and 3, OVAs and an ONA hang off it as side stories,
 * season 3 is an ONA on the main chain, the sequel is NOT_YET_RELEASED, and
 * the first season's manga is an ADAPTATION, which is no anime of the chain.
 */
const LANTERN = graphOf(
	node(101, 'TV', 'Lantern Keeper', [
		['SEQUEL', 102],
		['SIDE_STORY', 151],
		['ADAPTATION', 900],
		['PREQUEL', 105]
	]),
	node(102, 'TV', 'Lantern Keeper 2nd Season', [
		['PREQUEL', 101],
		['SEQUEL', 160],
		['SIDE_STORY', 152]
	]),
	node(
		160,
		'MOVIE',
		'Lantern Keeper: The Long Night',
		[
			['PREQUEL', 102],
			['SEQUEL', 103]
		],
		{ episodes: 1 }
	),
	node(
		103,
		'ONA',
		'Lantern Keeper Season 3',
		[
			['PREQUEL', 160],
			['SEQUEL', 104],
			['SIDE_STORY', 153]
		],
		{ episodes: 10 }
	),
	node(104, 'TV', 'Lantern Keeper Season 4', [
		['PREQUEL', 170],
		['PREQUEL', 103],
		['SEQUEL', 105]
	]),
	node(105, 'TV', 'Lantern Keeper Season 5', null, {
		status: 'NOT_YET_RELEASED',
		episodes: null,
		year: 2027
	}),
	node(151, 'OVA', 'Lantern Keeper: Festival', null, { episodes: 1 }),
	node(152, 'ONA', 'Lantern Keeper Shorts', null, { episodes: 8 }),
	node(153, 'OVA', 'Lantern Keeper: Winter', null, { episodes: 2 }),
	node(170, 'SPECIAL', 'Lantern Keeper Recap', null, { episodes: 1 }),
	node(900, 'MANGA', 'Lantern Keeper', null, { type: 'MANGA' })
);
const S4 = { first: 104, last: 104, heldBefore: 0, heldAfter: 0 };

describe('the walk (c358)', () => {
	it('walks the card’s chain: every season before, the one after, the extras met', () => {
		const w = walkSeasons(LANTERN, S4);
		expect(w.needs).toEqual([]);
		expect(w.truncated).toBe(false);
		// The ONA on the main chain is a season; the MOVIE between is passed through.
		expect(w.before).toEqual([101, 102, 103]);
		expect(w.firstAt).toBe(3);
		// The loop: 105 is the season after, never a season before the first.
		expect(w.next).toBe(105);
		// The SPECIAL beside the ONA prequel, the chain's MOVIE, and the side
		// stories of the entries the walk stood on; never the manga.
		expect(w.extras.sort()).toEqual([151, 152, 153, 160, 170]);
	});

	it('draws the heads: numbered along the chain, NEXT SEASON never numbered, extras counted', () => {
		const around = seasonsAround(LANTERN, walkSeasons(LANTERN, S4), {
			title: 'Lantern Keeper Season 4',
			inLibrary: new Map([[102, 7]])
		});
		expect(around.before.map((h) => [h.label, h.facts, h.seriesId])).toEqual([
			['SEASON 1', ['12 EP'], null],
			['SEASON 2', ['12 EP'], 7],
			['SEASON 3', ['10 EP'], null]
		]);
		expect(around.before.map((h) => h.query)).toEqual([
			'Lantern Keeper',
			'Lantern Keeper 2nd Season',
			'Lantern Keeper Season 3'
		]);
		expect(around.next).toMatchObject({
			key: 105,
			label: 'NEXT SEASON',
			facts: ['ANNOUNCED', '2027'],
			title: 'Lantern Keeper Season 5',
			seriesId: null,
			query: 'Lantern Keeper Season 5'
		});
		expect(around.extras).toHaveLength(5);
		expect(around.extrasLine.split(' · ')[0]).toBe('+ 5 EXTRAS');
		expect(new Set(around.extrasLine.split(' · ').slice(1))).toEqual(
			new Set(['2 OVA', '1 MOVIE', '1 ONA', '1 SPECIAL'])
		);
	});

	it('says NEXT SEASON · FIND for the series’ own title stem when AniList knows no sequel', () => {
		const g = graphOf(
			node(201, 'TV', 'Quiet Shore', [['SEQUEL', 202]]),
			node(202, 'TV', 'Quiet Shore 2nd Season', [['PREQUEL', 201]])
		);
		const w = walkSeasons(g, { first: 202, last: 202, heldBefore: 0, heldAfter: 0 });
		expect(w).toMatchObject({ before: [201], next: null, extras: [], needs: [] });
		const around = seasonsAround(g, w, { title: 'Quiet Shore Season 2', inLibrary: new Map() });
		expect(around.next).toEqual({
			key: 0,
			label: 'NEXT SEASON',
			facts: [],
			title: '',
			seriesId: null,
			query: 'Quiet Shore'
		});
		expect(around.extrasLine).toBe('');
	});

	it('names the entries it still needs, and stops there', () => {
		const partial = graphOf(
			node(104, 'TV', 'Lantern Keeper Season 4', [
				['PREQUEL', 103],
				['SEQUEL', 105]
			]),
			node(103, 'ONA', 'Lantern Keeper Season 3', null),
			node(105, 'TV', 'Lantern Keeper Season 5', null)
		);
		const w = walkSeasons(partial, S4);
		// Forward ends at 105 without asking it; back needs 103's own edges.
		expect(w.next).toBe(105);
		expect(w.needs).toEqual([103]);
		// A start the graph has never asked about: both directions need it, named once.
		expect(walkSeasons(partial, { ...S4, first: 999, last: 999 }).needs).toEqual([999]);
	});

	it('steps over the seasons the series holds unlinked, both ways', () => {
		// The series holds seasons 3 and 4 by the source's numbers, and only
		// season 4 is linked: season 3 is its own, not a head; and it holds a
		// fifth past it, so the season after is none AniList lists.
		const w = walkSeasons(LANTERN, { first: 104, last: 104, heldBefore: 1, heldAfter: 1 });
		expect(w.before).toEqual([101, 102]);
		expect(w.next).toBeNull();
	});

	it('takes a season before a movie where a chain branches, and keeps the other as an extra', () => {
		const g = graphOf(
			node(301, 'TV', 'Fork', [
				['SEQUEL', 390],
				['SEQUEL', 302]
			]),
			node(390, 'MOVIE', 'Fork: The Movie', null),
			node(302, 'TV', 'Fork II', null)
		);
		const w = walkSeasons(g, { first: 301, last: 301, heldBefore: 0, heldAfter: 0 });
		expect(w.next).toBe(302);
		expect(w.extras).toEqual([390]);
	});

	it('stops at HOPS steps back, and draws those seasons unnumbered', () => {
		const n = HOPS + 5;
		const nodes = Array.from({ length: n }, (_, i) =>
			node(1000 + i, 'TV', `Long ${i + 1}`, [
				...(i > 0 ? ([['PREQUEL', 1000 + i - 1]] as Edge[]) : []),
				...(i < n - 1 ? ([['SEQUEL', 1000 + i + 1]] as Edge[]) : [])
			])
		);
		const g = graphOf(...nodes);
		const last = 1000 + n - 1;
		const w = walkSeasons(g, { first: last, last, heldBefore: 0, heldAfter: 0 });
		expect(w.truncated).toBe(true);
		expect(w.before).toHaveLength(HOPS);
		const around = seasonsAround(g, w, { title: 'Long', inLibrary: new Map() });
		expect(new Set(around.before.map((h) => h.label))).toEqual(new Set(['SEASON']));
		// Exactly HOPS seasons back is the whole chain: numbered.
		const at = 1000 + HOPS;
		const whole = walkSeasons(g, { first: at, last: at, heldBefore: 0, heldAfter: 0 });
		expect(whole.truncated).toBe(false);
		expect(whole.before).toHaveLength(HOPS);
	});

	it('cuts the loop where it goes back in time, from wherever the walk starts', () => {
		// Seasons 2 and 3 held: forward stops at season 4, never meeting 5, so
		// only the years tell 105 from a season before the first.
		const w23 = walkSeasons(LANTERN, { first: 102, last: 103, heldBefore: 0, heldAfter: 0 });
		expect(w23).toMatchObject({ before: [101], next: 104 });
		// Season 5 held: its SEQUEL is season 1, which is no season after.
		const w5 = walkSeasons(
			{
				nodes: {
					...LANTERN.nodes,
					105: {
						...LANTERN.nodes[105],
						edges: [
							{ type: 'PREQUEL', id: 104 },
							{ type: 'SEQUEL', id: 101 }
						]
					}
				}
			},
			{ first: 105, last: 105, heldBefore: 0, heldAfter: 0 }
		);
		expect(w5).toMatchObject({ before: [101, 102, 103, 104], next: null });
	});

	it('walks a chain that loops back on itself without end', () => {
		const g = graphOf(
			node(401, 'TV', 'Ring', [
				['PREQUEL', 402],
				['SEQUEL', 402]
			]),
			node(402, 'TV', 'Ring 2', [
				['PREQUEL', 401],
				['SEQUEL', 401]
			])
		);
		const w = walkSeasons(g, { first: 401, last: 401, heldBefore: 0, heldAfter: 0 });
		expect(w).toMatchObject({ next: 402, before: [], needs: [], truncated: false });
	});
});

describe('relFacts', () => {
	// AniList's MediaStatus, all of it.
	it.each([
		['FINISHED', 12, 2020, ['12 EP']],
		['RELEASING', 24, 2026, ['AIRING', '24 EP']],
		['NOT_YET_RELEASED', null, 2027, ['ANNOUNCED', '2027']],
		['NOT_YET_RELEASED', null, null, ['ANNOUNCED']],
		['CANCELLED', null, 2019, ['CANCELLED']],
		['HIATUS', 10, 2018, ['ON HIATUS', '10 EP']],
		[null, null, null, []]
	])('%s, %s EP, %s', (status, episodes, year, want) => {
		expect(relFacts(node(1, 'TV', 'X', null, { status, episodes, year }))).toEqual(want);
	});
});

describe('titleStem (FIND’s search when AniList lists no sequel)', () => {
	it.each([
		['Ascendance of a Bookworm 3rd Season', 'Ascendance of a Bookworm'],
		['Ascendance of a Bookworm Season 3', 'Ascendance of a Bookworm'],
		['Ascendance of a Bookworm S3', 'Ascendance of a Bookworm'],
		['Ascendance of a Bookworm Part 2', 'Ascendance of a Bookworm'],
		['Ascendance of a Bookworm: Season 3 Part 2', 'Ascendance of a Bookworm'],
		['Ascendance of a Bookworm (Season 3)', 'Ascendance of a Bookworm'],
		['Ascendance of a Bookworm - 2nd Cour', 'Ascendance of a Bookworm'],
		['本好きの下剋上 第3期', '本好きの下剋上'],
		['Ascendance of a Bookworm', 'Ascendance of a Bookworm'],
		// A word that ends in an s and a digit is not a suffix: only a whole `S3`.
		['Class3', 'Class3'],
		['Mob Psycho 100', 'Mob Psycho 100'],
		// Nothing but a suffix is kept as it is: a stem is never empty.
		['Season 2', 'Season 2']
	])('%s → %s', (title, stem) => {
		expect(titleStem(title)).toBe(stem);
		// A normaliser holds on its own output.
		expect(titleStem(stem)).toBe(stem);
		expect(titleStem(titleStem(title))).toBe(titleStem(title));
	});
});
