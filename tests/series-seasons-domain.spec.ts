import { describe, expect, it } from 'vitest';
import {
	HOPS,
	startsBy,
	when,
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
	node(
		101,
		'TV',
		'Lantern Keeper',
		[
			['SEQUEL', 102],
			['SIDE_STORY', 151],
			['ADAPTATION', 900],
			['PREQUEL', 105]
		],
		{ year: 2019 }
	),
	node(
		102,
		'TV',
		'Lantern Keeper 2nd Season',
		[
			['PREQUEL', 101],
			['SEQUEL', 160],
			['SIDE_STORY', 152]
		],
		{ year: 2021 }
	),
	node(
		160,
		'MOVIE',
		'Lantern Keeper: The Long Night',
		[
			['PREQUEL', 102],
			['SEQUEL', 103]
		],
		{ episodes: 1, year: 2022 }
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
		{ episodes: 10, year: 2023 }
	),
	node(
		104,
		'TV',
		'Lantern Keeper Season 4',
		[
			['PREQUEL', 170],
			['PREQUEL', 103],
			['SEQUEL', 105]
		],
		{ year: 2025 }
	),
	// Announced, so undated: AniList leaves a TBA sequel's start empty.
	node(
		105,
		'TV',
		'Lantern Keeper Season 5',
		[
			['PREQUEL', 104],
			['SEQUEL', 101]
		],
		{ status: 'NOT_YET_RELEASED', episodes: null, year: null }
	),
	node(151, 'OVA', 'Lantern Keeper: Festival', null, { episodes: 1, year: 2019 }),
	node(152, 'ONA', 'Lantern Keeper Shorts', null, { episodes: 8, year: 2021 }),
	node(153, 'OVA', 'Lantern Keeper: Winter', null, { episodes: 2, year: 2023 }),
	node(170, 'SPECIAL', 'Lantern Keeper Recap', null, { episodes: 1, year: 2024 }),
	node(900, 'MANGA', 'Lantern Keeper', null, { type: 'MANGA', year: 2018 })
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
			facts: ['ANNOUNCED'],
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
		const w5 = walkSeasons(LANTERN, { first: 105, last: 105, heldBefore: 0, heldAfter: 0 });
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

/**
 * The loop walked from every season (review round 1): AniList leaves the
 * announced fifth season undated, so only its status says it starts after the
 * first, and season 1's PREQUEL into it is the loop's closing edge, never a
 * season before season 1.
 */
describe('the loop through an undated announced sequel (c358)', () => {
	const T = (id: number) => LANTERN.nodes[String(id)].title.english;
	it.each([
		{ held: 101, before: [], next: 102, extras: [151], line: '+ 1 EXTRA · 1 OVA' },
		{
			held: 102,
			before: [101],
			next: 103,
			extras: [152, 160, 151],
			line: '+ 3 EXTRAS · 1 ONA · 1 MOVIE · 1 OVA'
		},
		{
			held: 103,
			before: [101, 102],
			next: 104,
			extras: [153, 160, 152, 151],
			line: '+ 4 EXTRAS · 2 OVA · 1 MOVIE · 1 ONA'
		},
		{
			held: 104,
			before: [101, 102, 103],
			next: 105,
			extras: [170, 153, 160, 152, 151],
			line: '+ 5 EXTRAS · 1 SPECIAL · 2 OVA · 1 MOVIE · 1 ONA'
		}
	])('held $held: the seasons before, NEXT SEASON and the extras', (c) => {
		const w = walkSeasons(LANTERN, { first: c.held, last: c.held, heldBefore: 0, heldAfter: 0 });
		expect(w).toMatchObject({ needs: [], truncated: false, firstAt: c.before.length });
		const around = seasonsAround(LANTERN, w, { title: T(c.held)!, inLibrary: new Map() });
		expect(around.before.map((h) => [h.key, h.label, h.title])).toEqual(
			c.before.map((id, i) => [id, `SEASON ${i + 1}`, T(id)])
		);
		expect(around.next).toMatchObject({ key: c.next, label: 'NEXT SEASON', title: T(c.next) });
		expect(around.extras.map((x) => x.key)).toEqual(c.extras);
		expect(around.extrasLine).toBe(c.line);
	});

	it('draws AniList’s real shape the same from season 2: dated releases, an undated TBA', () => {
		const tv = (id: number, year: number | null, edges: Edge[], o: Partial<RelNode> = {}) =>
			node(id, 'TV', `Show S${id - 500}`, edges, { year, ...o });
		const g = graphOf(
			tv(501, 2019, [
				['PREQUEL', 505],
				['SEQUEL', 502]
			]),
			tv(502, 2021, [
				['PREQUEL', 501],
				['SEQUEL', 503]
			]),
			tv(503, 2023, [
				['PREQUEL', 502],
				['SEQUEL', 504]
			]),
			tv(504, 2025, [
				['PREQUEL', 503],
				['SEQUEL', 505]
			]),
			tv(
				505,
				null,
				[
					['PREQUEL', 504],
					['SEQUEL', 501]
				],
				{ status: 'NOT_YET_RELEASED', episodes: null }
			)
		);
		const around = seasonsAround(
			g,
			walkSeasons(g, { first: 502, last: 502, heldBefore: 0, heldAfter: 0 }),
			{ title: 'Show S2', inLibrary: new Map() }
		);
		expect(around.before.map((h) => [h.label, h.title])).toEqual([['SEASON 1', 'Show S1']]);
		expect(around.next).toMatchObject({ key: 503, title: 'Show S3' });
		expect(around.extras).toEqual([]);
		// An announced sequel AniList has dated is still after them all.
		const dated = { ...g.nodes['505'], year: 2018 };
		const w1 = walkSeasons(
			{ nodes: { ...g.nodes, 505: dated } },
			{ first: 501, last: 501, heldBefore: 0, heldAfter: 0 }
		);
		expect(w1).toMatchObject({ before: [], next: 502, extras: [] });
	});

	it('ranks an announced entry after every year, an aired one by its year, and an undated aired one not at all', () => {
		expect(when({ status: 'FINISHED', year: 2019 })).toBe(2019);
		expect(when({ status: 'RELEASING', year: 2025 })).toBe(2025);
		expect(when({ status: 'NOT_YET_RELEASED', year: 2027 })).toBe(Infinity);
		expect(when({ status: 'NOT_YET_RELEASED', year: null })).toBe(Infinity);
		// Round 3: an aired entry AniList leaves undated has no rank, never Infinity.
		for (const status of ['FINISHED', 'RELEASING', 'CANCELLED', 'HIATUS', null])
			expect(when({ status, year: null }), String(status)).toBeNull();
	});
});

/**
 * Round 3 (r2's medium): an aired entry AniList leaves undated (mostly
 * specials, OVAs and ONAs, sometimes a season) is on the chain as AniList
 * gives it, never cut as a loop's closer; and the edges next to that rule:
 * each status with no year, an announced entry with a year, two undated in a
 * row, an undated aired entry on a loop. The expected heads were written in
 * doc/handoff-notes/series.md (wave 34) before these ran.
 */
describe('an aired entry with no year (c358, round 3)', () => {
	const tv = (id: number, year: number | null, edges: Edge[], o: Partial<RelNode> = {}) =>
		node(id, 'TV', `S${id % 100}`, edges, { year, ...o });
	const held = (g: RelGraph, id: number) => {
		const w = walkSeasons(g, { first: id, last: id, heldBefore: 0, heldAfter: 0 });
		const around = seasonsAround(g, w, {
			title: g.nodes[String(id)].title.english!,
			inLibrary: new Map()
		});
		return {
			w,
			before: around.before.map((h) => `${h.label}=${h.title}`),
			next: around.next.title || 'FIND',
			facts: around.next.facts,
			extras: around.extrasLine
		};
	};

	// r2's A: S1 (2019) -SEQUEL-> MOVIE (FINISHED, undated) -SEQUEL-> S2 (2021).
	const MOVIE_BETWEEN = graphOf(
		tv(601, 2019, [['SEQUEL', 650]]),
		node(
			650,
			'MOVIE',
			'The Movie',
			[
				['PREQUEL', 601],
				['SEQUEL', 602]
			],
			{ year: null, episodes: 1 }
		),
		tv(602, 2021, [['PREQUEL', 650]])
	);
	it('an undated movie between two seasons: held S2 draws S1 and the movie as an extra', () => {
		expect(held(MOVIE_BETWEEN, 602)).toMatchObject({
			before: ['SEASON 1=S1'],
			next: 'FIND',
			extras: '+ 1 EXTRA · 1 MOVIE'
		});
	});
	it('an undated movie between two seasons: held S1 draws NEXT SEASON = S2, AniList’s sequel', () => {
		expect(held(MOVIE_BETWEEN, 601)).toMatchObject({
			before: [],
			next: 'S2',
			extras: '+ 1 EXTRA · 1 MOVIE'
		});
	});
	it('an undated FINISHED first season: held S2 draws SEASON 1 = S1', () => {
		const g = graphOf(tv(701, null, [['SEQUEL', 702]]), tv(702, 2021, [['PREQUEL', 701]]));
		expect(held(g, 702)).toMatchObject({ before: ['SEASON 1=S1'], next: 'FIND', extras: '' });
		expect(held(g, 701)).toMatchObject({ before: [], next: 'S2' });
	});

	it.each([
		['RELEASING', 'AIRING'],
		['CANCELLED', 'CANCELLED'],
		['HIATUS', 'ON HIATUS']
	])('%s with no year is on the chain both ways', (status, fact) => {
		const g = graphOf(
			tv(801, 2019, [['SEQUEL', 802]]),
			tv(802, null, [['PREQUEL', 801]], { status, episodes: null })
		);
		expect(held(g, 802)).toMatchObject({ before: ['SEASON 1=S1'], next: 'FIND' });
		expect(held(g, 801)).toMatchObject({ before: [], next: 'S2' });
		expect(held(g, 801).facts[0]).toBe(fact);
	});
	// Round 2's low: between two dated seasons, the shape ranking it as announced cut.
	it.each([
		['RELEASING', 'AIRING'],
		['CANCELLED', 'CANCELLED'],
		['HIATUS', 'ON HIATUS']
	])('%s with no year between two dated seasons is a season of the chain', (status, fact) => {
		const g = graphOf(
			tv(1401, 2019, [['SEQUEL', 1402]]),
			tv(
				1402,
				null,
				[
					['PREQUEL', 1401],
					['SEQUEL', 1403]
				],
				{ status, episodes: null }
			),
			tv(1403, 2023, [['PREQUEL', 1402]])
		);
		expect(held(g, 1403)).toMatchObject({ before: ['SEASON 1=S1', 'SEASON 2=S2'], next: 'FIND' });
		expect(held(g, 1401)).toMatchObject({ before: [], next: 'S2', facts: [fact] });
	});

	// The loop: S1..S4 dated, S5 announced; S1 names S5 its PREQUEL, S5 names S1 its SEQUEL.
	const loop = (s1: number | null, s5: number | null) =>
		graphOf(
			tv(901, s1, [
				['PREQUEL', 905],
				['SEQUEL', 902]
			]),
			tv(902, 2021, [
				['PREQUEL', 901],
				['SEQUEL', 903]
			]),
			tv(903, 2023, [
				['PREQUEL', 902],
				['SEQUEL', 904]
			]),
			tv(904, 2025, [
				['PREQUEL', 903],
				['SEQUEL', 905]
			]),
			tv(
				905,
				s5,
				[
					['PREQUEL', 904],
					['SEQUEL', 901]
				],
				{ status: 'NOT_YET_RELEASED', episodes: null }
			)
		);
	it('an announced entry with a year is still after every aired one, whatever its year', () => {
		const g = loop(2019, 2018);
		expect(held(g, 901)).toMatchObject({ before: [], next: 'S2' });
		expect(held(g, 905)).toMatchObject({
			before: ['SEASON 1=S1', 'SEASON 2=S2', 'SEASON 3=S3', 'SEASON 4=S4'],
			next: 'FIND'
		});
	});
	it('an undated aired first season on the loop: the announced sequel is never a season before it', () => {
		const g = loop(null, null);
		expect(held(g, 902)).toMatchObject({ before: ['SEASON 1=S1'], next: 'S3', extras: '' });
		expect(held(g, 901)).toMatchObject({ before: [], next: 'S2' });
		expect(held(g, 904)).toMatchObject({
			before: ['SEASON 1=S1', 'SEASON 2=S2', 'SEASON 3=S3'],
			next: 'S5',
			facts: ['ANNOUNCED']
		});
		expect(held(g, 905)).toMatchObject({
			before: ['SEASON 1=S1', 'SEASON 2=S2', 'SEASON 3=S3', 'SEASON 4=S4'],
			next: 'FIND'
		});
	});

	// Round 2's medium: the loop's closer is an aired entry AniList leaves undated.
	const closedBy = (closer: RelNode) =>
		graphOf(
			tv(1101, 2019, [
				['PREQUEL', closer.id],
				['SEQUEL', 1102]
			]),
			tv(1102, 2021, [
				['PREQUEL', 1101],
				['SEQUEL', 1103]
			]),
			tv(1103, 2023, [
				['PREQUEL', 1102],
				['SEQUEL', closer.id]
			]),
			closer
		);
	it('an undated FINISHED last season closing the loop: no season wraps, from any of them', () => {
		const g = closedBy(
			tv(1104, null, [
				['PREQUEL', 1103],
				['SEQUEL', 1101]
			])
		);
		expect(held(g, 1101)).toMatchObject({ before: [], next: 'S2', extras: '' });
		expect(held(g, 1102)).toMatchObject({ before: ['SEASON 1=S1'], next: 'S3', extras: '' });
		expect(held(g, 1103)).toMatchObject({
			before: ['SEASON 1=S1', 'SEASON 2=S2'],
			next: 'S4',
			extras: ''
		});
		expect(held(g, 1104)).toMatchObject({
			before: ['SEASON 1=S1', 'SEASON 2=S2', 'SEASON 3=S3'],
			next: 'FIND',
			extras: ''
		});
	});
	it('an undated FINISHED OVA closing the loop: held S2 draws SEASON 1 = S1 only', () => {
		const g = closedBy(
			node(
				1150,
				'OVA',
				'The OVA',
				[
					['PREQUEL', 1103],
					['SEQUEL', 1101]
				],
				{ year: null, episodes: 1 }
			)
		);
		expect(held(g, 1102)).toMatchObject({ before: ['SEASON 1=S1'], next: 'S3', extras: '' });
		expect(held(g, 1103)).toMatchObject({
			before: ['SEASON 1=S1', 'SEASON 2=S2'],
			next: 'FIND',
			extras: '+ 1 EXTRA · 1 OVA'
		});
	});
	it('two undated aired seasons closing the loop: the second is bounded through the first', () => {
		const g = graphOf(
			tv(1201, 2019, [
				['PREQUEL', 1204],
				['SEQUEL', 1202]
			]),
			tv(1202, 2021, [
				['PREQUEL', 1201],
				['SEQUEL', 1203]
			]),
			tv(1203, null, [
				['PREQUEL', 1202],
				['SEQUEL', 1204]
			]),
			tv(1204, null, [
				['PREQUEL', 1203],
				['SEQUEL', 1201]
			])
		);
		expect(held(g, 1202)).toMatchObject({ before: ['SEASON 1=S1'], next: 'S3' });
		expect(held(g, 1201)).toMatchObject({ before: [], next: 'S2' });
		expect(held(g, 1204)).toMatchObject({
			before: ['SEASON 1=S1', 'SEASON 2=S2', 'SEASON 3=S3'],
			next: 'FIND'
		});
	});
	it('bounds an undated aired entry by the aired seasons it follows, and nothing else', () => {
		const g = graphOf(
			tv(1301, 2019, [['SEQUEL', 1303]]),
			tv(1302, 2022, [['SEQUEL', 1303]]),
			tv(1303, null, [
				['PREQUEL', 1301],
				['PREQUEL', 1302],
				['PREQUEL', 1305],
				['SEQUEL', 1304]
			]),
			tv(1304, 2030, [['PREQUEL', 1303]]),
			tv(1305, 2040, [['SEQUEL', 1303]], { status: 'NOT_YET_RELEASED' }),
			tv(1306, null, [['SEQUEL', 1307]]),
			tv(1307, null, [['PREQUEL', 1306]]),
			tv(1308, null, null)
		);
		const rank = startsBy(g);
		const at = (id: number) => rank(g.nodes[String(id)]);
		// The latest aired prequel; a SEQUEL's year and an announced prequel's are not read.
		expect(at(1303)).toBe(2022);
		expect(at(1301)).toBe(2019);
		expect(at(1305)).toBe(Infinity);
		// No dated entry before it, or no edges yet: no bound.
		expect(at(1307)).toBeNull();
		expect(at(1308)).toBeNull();
	});

	it('two undated aired seasons in a row stay on the chain', () => {
		const g = graphOf(
			tv(1001, 2019, [['SEQUEL', 1002]]),
			tv(1002, null, [
				['PREQUEL', 1001],
				['SEQUEL', 1003]
			]),
			tv(1003, null, [
				['PREQUEL', 1002],
				['SEQUEL', 1004]
			]),
			tv(1004, 2025, [['PREQUEL', 1003]])
		);
		expect(held(g, 1004)).toMatchObject({
			before: ['SEASON 1=S1', 'SEASON 2=S2', 'SEASON 3=S3'],
			next: 'FIND'
		});
		expect(held(g, 1003)).toMatchObject({ before: ['SEASON 1=S1', 'SEASON 2=S2'], next: 'S4' });
		expect(held(g, 1001)).toMatchObject({ before: [], next: 'S2' });
		for (const id of [1001, 1002, 1003, 1004]) expect(held(g, id).w.needs).toEqual([]);
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
