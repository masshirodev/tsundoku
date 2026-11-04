import { beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

/**
 * The relations page's walk and LINK N SEASONS (doc/LINKS.md, "The series
 * screen"; c351, c418), against a stand-in AniList that answers the way
 * AniList does: every edge an entry has, of every kind, both directions, a
 * chain that branches (a TV season and a movie both SEQUEL of one entry) and
 * one that loops back (an entry listing the show's first season as its
 * PREQUEL too). A fake that answered exactly the chain the code walks would
 * only prove that the code agrees with the fake.
 */
const { getDb } = await import('$lib/server/db');
const cat = await import('$lib/server/catalogue');
const seasons = await import('$lib/server/season-links');

const db = getDb();
const NOW = Date.UTC(2026, 10, 3);

type Node = {
	id: number;
	idMal: number | null;
	format: string;
	episodes: number | null;
	seasonYear: number | null;
	title: { english: string | null; romaji: string | null; native: string | null };
};
const node = (id: number, title: string, format: string, episodes: number | null, year: number) =>
	({
		id,
		idMal: id + 5000,
		format,
		episodes,
		seasonYear: year,
		title: { english: title, romaji: title, native: null }
	}) satisfies Node;

/** AniList's catalogue, as far as these cases reach it. */
const WORLD = new Map<number, Node>();
const EDGES = new Map<number, { type: string; to: number }[]>();
const add = (n: Node, edges: [string, number][] = []) => {
	WORLD.set(n.id, n);
	EDGES.set(
		n.id,
		edges.map(([type, to]) => ({ type, to }))
	);
};

// A show the source names four seasons of: 25, 24, 24 and 23 episodes.
add(node(101, 'Sword Art Online', 'TV', 25, 2012), [
	['SEQUEL', 102],
	['SIDE_STORY', 150],
	['SPIN_OFF', 160],
	['ADAPTATION', 900],
	['CHARACTER', 170],
	['ALTERNATIVE', 171]
]);
add(node(102, 'Sword Art Online II', 'TV', 24, 2014), [
	['PREQUEL', 101],
	// A branch: the movie and the next TV season are both its sequel.
	['SEQUEL', 103],
	['SEQUEL', 104],
	['SIDE_STORY', 151],
	['SUMMARY', 172]
]);
add(node(103, 'Sword Art Online the Movie: Ordinal Scale', 'MOVIE', 1, 2017), [
	['PREQUEL', 102],
	['SEQUEL', 104]
]);
add(node(104, 'Sword Art Online: Alicization', 'TV', 24, 2018), [
	['PREQUEL', 103],
	['PREQUEL', 102],
	// The loop: an entry that also lists the first season as its prequel.
	['PREQUEL', 101],
	['SEQUEL', 105]
]);
add(node(105, 'Sword Art Online: Alicization - War of Underworld', 'TV', 12, 2019), [
	['PREQUEL', 104],
	['SEQUEL', 106]
]);
add(node(106, 'Sword Art Online: Alicization - War of Underworld Part 2', 'TV', 11, 2020), [
	['PREQUEL', 105]
]);
add(node(150, 'Sword Art Online: Extra Edition', 'SPECIAL', 1, 2013), [['PARENT', 101]]);
add(node(151, 'Sword Art Offline II', 'SPECIAL', 9, 2014), [['PARENT', 102]]);
// A TV spin-off of 24 episodes: its count agrees with season 2's and 3's, and
// it still is no season. Its own sequel is the spin-off's, never this show's.
add(node(160, 'Sword Art Online Alternative: Gun Gale Online', 'TV', 24, 2018), [
	['SPIN_OFF', 101],
	['SEQUEL', 161]
]);
add(node(161, 'Gun Gale Online II', 'TV', 12, 2024), [['PREQUEL', 160]]);
add(node(900, 'Sword Art Online', 'NOVEL', null, 2009), [['ADAPTATION', 101]]);
add(node(170, 'Sword Art Online: Progressive', 'MOVIE', 1, 2021), [['CHARACTER', 101]]);
add(node(171, 'Sword Art Online Abridged', 'ONA', 24, 2013), [['ALTERNATIVE', 101]]);
add(node(172, 'Sword Art Online II: Debriefing', 'SPECIAL', 1, 2014), [['SUMMARY', 102]]);

// A one-season show AniList split in two, both parts listed as the first
// entry's SEQUEL (the part 1 entry is the longer one, and the earlier).
add(node(201, 'Split Show', 'TV', 12, 2020), [
	['SEQUEL', 202],
	['SEQUEL', 203]
]);
add(node(202, 'Split Show Season 2', 'TV', 12, 2021), [
	['PREQUEL', 201],
	['SEQUEL', 203]
]);
add(node(203, 'Split Show Season 2 Part 2', 'TV', 11, 2022), [
	['PREQUEL', 202],
	['PREQUEL', 201]
]);

/** Every kind of edge AniList has (its MediaRelation), each to a TV entry of 24 episodes. */
const RELATION_TYPES = [
	'ADAPTATION',
	'PREQUEL',
	'SEQUEL',
	'PARENT',
	'SIDE_STORY',
	'CHARACTER',
	'SUMMARY',
	'ALTERNATIVE',
	'SPIN_OFF',
	'OTHER',
	'SOURCE',
	'COMPILATION',
	'CONTAINS'
] as const;
add(
	node(300, 'Every Edge', 'TV', 24, 2020),
	RELATION_TYPES.map((t, i) => [t, 301 + i] as [string, number])
);
RELATION_TYPES.forEach((t, i) => add(node(301 + i, `Every Edge ${t}`, 'TV', 24, 2020)));

/** What the walk asked for, request by request. */
let requests: number[][] = [];
cat.setAnilistFetch(async (_url, init) => {
	const { query, variables } = JSON.parse(String(init?.body)) as {
		query: string;
		variables: Record<string, number>;
	};
	const data: Record<string, unknown> = {};
	const asked: number[] = [];
	for (const m of query.matchAll(/m(\d+):\s*Media\(id:\s*\$i(\d+)\)/g)) {
		const id = variables[`i${m[2]}`];
		asked.push(id);
		const self = WORLD.get(id);
		data[`m${m[1]}`] = self
			? {
					...self,
					relations: {
						edges: (EDGES.get(id) ?? []).map((e) => ({
							relationType: e.type,
							node: WORLD.get(e.to)
						}))
					}
				}
			: null;
	}
	requests.push(asked);
	return new Response(JSON.stringify({ data }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
});

const root = Number(
	db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Anime', '/nowhere', 0)`).run()
		.lastInsertRowid
);
let n = 0;
/** An anime whose seasons hold the given numbers of episodes, numbered 1 up. */
function show(counts: number[]): number {
	const id = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, source, in_library)
				VALUES (?, ?, 'anime', ?, ?, 'KickAssAnime', 1)`
			)
			.run(root, `Show ${++n}`, NOW, `aniyomi:1:/show-${n}`).lastInsertRowid
	);
	let position = 0;
	counts.forEach((count, i) => {
		for (let e = 1; e <= count; e++)
			db.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, season, episode_number)
				VALUES (?, ?, ?, ?, ?, ?)`
			).run(id, ++position, `Episode ${e}`, NOW, i + 1, e);
	});
	return id;
}

/** An entry as the review keeps it, for a link written directly. */
const entryOf = (id: number) => {
	const w = WORLD.get(id)!;
	return {
		anilistId: id,
		malId: w.idMal,
		title: w.title.english!,
		alts: [] as string[],
		format: w.format,
		country: 'JP',
		year: w.seasonYear,
		chapters: null,
		volumes: null,
		episodes: w.episodes,
		season: null,
		seasonYear: w.seasonYear,
		status: 'FINISHED',
		coverUrl: ''
	};
};
const link = (id: number, season: number, entry: number, part = 1) =>
	expect(seasons.linkSeason(id, season, part, entryOf(entry), 'review', NOW)).toBe(true);

/** The offers as the page reads them, without the candidate each carries. */
const shape = (offers: Awaited<ReturnType<typeof seasons.seasonRelations>>) =>
	(offers ?? []).map((o) => ({
		season: o.outside ? null : o.season,
		part: o.outside ? null : o.part,
		id: o.anilistId,
		how: o.how,
		ticked: o.ticked,
		outside: o.outside,
		heldBy: o.heldBy
	}));

const candidateIds = (id: number) =>
	(
		db
			.prepare(
				`SELECT season, part, anilist_id FROM season_link_candidates WHERE series_id = ? ORDER BY season, part, anilist_id`
			)
			.all(id) as { season: number; part: number; anilist_id: number }[]
	).map((r) => [r.season, r.part, r.anilist_id]);

const linked = (id: number) => seasons.seasonLinks(id).map((l) => [l.season, l.part, l.anilistId]);

beforeEach(() => {
	requests = [];
});

describe('the relation walk (c351)', () => {
	it('lists side stories and spin-offs dimmed beside the chain, never ticked and never a season', async () => {
		const id = show([25, 24, 24, 23]);
		link(id, 2, 102);
		const offers = await seasons.seasonRelations(id, 2);
		expect(shape(offers)).toEqual([
			{ season: 1, part: 1, id: 101, how: 'PREQUEL', ticked: true, outside: false, heldBy: null },
			{ season: 3, part: 1, id: 104, how: 'SEQUEL', ticked: true, outside: false, heldBy: null },
			// Two steps out, 12 episodes against 23: offered, and left unticked.
			{
				season: 4,
				part: 1,
				id: 105,
				how: 'SEQUEL’S SEQUEL',
				ticked: false,
				outside: false,
				heldBy: null
			},
			// Outside the numbering, after the seasons: the movie on the chain, then
			// the side stories (of its prequel, then of the linked entry, by year), and the spin-off.
			{
				season: null,
				part: null,
				id: 103,
				how: 'SEQUEL',
				ticked: false,
				outside: true,
				heldBy: null
			},
			{
				season: null,
				part: null,
				id: 150,
				how: 'SIDE STORY',
				ticked: false,
				outside: true,
				heldBy: null
			},
			{
				season: null,
				part: null,
				id: 151,
				how: 'SIDE STORY',
				ticked: false,
				outside: true,
				heldBy: null
			},
			{
				season: null,
				part: null,
				id: 160,
				how: 'SPIN-OFF, NOT A SEQUEL',
				ticked: false,
				outside: true,
				heldBy: null
			}
		]);
		// Nothing outside the numbering is kept as a season's candidate: LINK N
		// SEASONS reads its picks back from these rows, so a dimmed entry cannot
		// reach a season through it.
		expect(candidateIds(id)).toEqual([
			[1, 1, 101],
			[3, 1, 104],
			[4, 1, 105]
		]);
		// Two requests: the linked entry, then its chain neighbours together. The
		// side entries' own relations are never asked (Gun Gale Online II is not
		// this show's).
		expect(requests).toEqual([[102], [101, 103, 104]]);
		expect(shape(offers).some((o) => o.id === 161)).toBe(false);
	});

	it('of every kind of edge AniList has, a season comes only from PREQUEL and SEQUEL, and SIDE_STORY and SPIN_OFF are listed beside', async () => {
		// One season of 24 episodes either side of the linked one: every entry
		// here has 24, so a kind that leaked into the numbering would be ticked.
		const id = show([24, 24, 24]);
		link(id, 2, 300);
		const offers = (await seasons.seasonRelations(id, 2))!;
		const by = new Map(offers.map((o) => [o.anilistId, o]));
		for (const [i, type] of RELATION_TYPES.entries()) {
			const o = by.get(301 + i);
			if (type === 'PREQUEL') expect(o).toMatchObject({ season: 1, ticked: true, outside: false });
			else if (type === 'SEQUEL')
				expect(o).toMatchObject({ season: 3, ticked: true, outside: false });
			else if (type === 'SIDE_STORY')
				expect(o).toMatchObject({ how: 'SIDE STORY', ticked: false, outside: true });
			else if (type === 'SPIN_OFF')
				expect(o).toMatchObject({ how: 'SPIN-OFF, NOT A SEQUEL', ticked: false, outside: true });
			else expect(o, type).toBeUndefined();
		}
		expect(offers).toHaveLength(4);
		// A crafted pick of the TV spin-off for a season is not linked: it was
		// never an offer of that season.
		const spinOff = 301 + RELATION_TYPES.indexOf('SPIN_OFF');
		const r = seasons.linkPicks(id, 'anime', [{ season: 3, part: 1, anilistId: spinOff }], NOW);
		expect(r).toEqual({
			linked: [],
			refused: [
				{ season: 3, part: 1, heldBy: null, why: 'SEASON 3 NOT LINKED · NO LONGER OFFERED' }
			]
		});
		expect(linked(id)).toEqual([[2, 1, 300]]);
	});

	it('walks a chain that loops and branches once, each entry at the first place it is reached', async () => {
		// Linked at season 3: 104 lists the movie, season 2 and (wrongly) season 1
		// all as its PREQUEL, so all three stand one step back, and season 1's
		// entry is placed there, never again two steps back.
		const id = show([25, 24, 24, 23]);
		link(id, 3, 104);
		const offers = shape(await seasons.seasonRelations(id, 3));
		expect(offers.filter((o) => o.id === 101)).toHaveLength(1);
		expect(offers.filter((o) => !o.outside)).toEqual([
			// Season 2 holds two entries at one step, in the order they aired: 25
			// doesn't agree, 24 does.
			{ season: 2, part: 1, id: 101, how: 'PREQUEL', ticked: false, outside: false, heldBy: null },
			{ season: 2, part: 1, id: 102, how: 'PREQUEL', ticked: true, outside: false, heldBy: null },
			{ season: 4, part: 1, id: 105, how: 'SEQUEL', ticked: false, outside: false, heldBy: null }
		]);
		expect(offers.filter((o) => o.outside).map((o) => o.id)).toEqual([103, 150, 151, 160]);
	});

	it('puts a split season’s parts in their order, and LINK N SEASONS writes both (c418)', async () => {
		const id = show([12, 23]);
		link(id, 1, 201);
		const offers = (await seasons.seasonRelations(id, 1))!;
		// Part 1 is the entry that comes first, though it has more episodes.
		expect(offers.map((o) => [o.season, o.part, o.anilistId, o.ticked])).toEqual([
			[2, 1, 202, true],
			[2, 2, 203, true]
		]);
		expect(offers[0].why).toBe('12 + 11 = 23: ONE SEASON HERE, TWO ENTRIES THERE');
		// The page's picks, as it posts them: each at its own part.
		const r = seasons.linkPicks(
			id,
			'anime',
			offers.map((o) => ({ season: o.season, part: o.part, anilistId: o.anilistId })),
			NOW
		);
		expect(r).toEqual({
			linked: [
				{ season: 2, part: 1 },
				{ season: 2, part: 2 }
			],
			refused: []
		});
		expect(linked(id)).toEqual([
			[1, 1, 201],
			[2, 1, 202],
			[2, 2, 203]
		]);
	});
});

describe('LINK N SEASONS counts seasons, not parts (c418, round 2)', () => {
	const part = (season: number, p = 1) => ({ season, part: p });
	it.each([
		['nothing', [], [], { linked: 0, of: 0 }],
		['a pair linked whole is one season', [part(2), part(2, 2)], [], { linked: 1, of: 1 }],
		['a pair and a season', [part(2), part(2, 2), part(3)], [], { linked: 2, of: 2 }],
		['a pair beside a refused season', [part(2), part(2, 2)], [part(3)], { linked: 1, of: 2 }],
		// Half a pair written is not the season linked: its refused part is named.
		[
			'a pair with a part refused is that season refused',
			[part(2)],
			[part(2, 2)],
			{ linked: 0, of: 1 }
		],
		['everything refused', [], [part(1), part(3)], { linked: 0, of: 2 }]
	])('%s', (_, linked, refused, want) => {
		expect(seasons.seasonsLinked(linked, refused)).toEqual(want);
	});
	it('holds on linkPicks’ own answer for a split season', async () => {
		const id = show([12, 23]);
		link(id, 1, 201);
		const offers = (await seasons.seasonRelations(id, 1))!;
		const r = seasons.linkPicks(
			id,
			'anime',
			offers.map((o) => ({ season: o.season, part: o.part, anilistId: o.anilistId })),
			NOW
		);
		expect(seasons.seasonsLinked(r.linked, r.refused)).toEqual({ linked: 1, of: 1 });
	});
});

describe('an entry another season holds (c418)', () => {
	it('is offered unticked, saying which season holds it, and is no candidate', async () => {
		// Shifted links: season 3 holds season 2's entry. Season 1 is linked, and
		// the relations offer season 2's entry for season 2, where its count agrees.
		const id = show([25, 24, 24, 23]);
		link(id, 3, 102);
		link(id, 1, 101);
		const offers = (await seasons.seasonRelations(id, 1))!;
		const s2 = offers.find((o) => o.season === 2 && !o.outside)!;
		expect(s2).toMatchObject({
			anilistId: 102,
			ticked: false,
			heldBy: { season: 3, part: 1 },
			why: 'SEASON 3 HOLDS THIS ENTRY · NEVER TICKED',
			replaces: null
		});
		// Season 3's own offer replaces what it holds, and is not ticked either.
		expect(offers.find((o) => o.season === 3 && !o.outside)).toMatchObject({
			anilistId: 104,
			ticked: false,
			heldBy: null,
			replaces: 'Sword Art Online II'
		});
		expect(candidateIds(id).filter(([season]) => season === 2)).toEqual([]);
	});

	it('LINK N SEASONS says what it linked and names what it refused, in order', () => {
		const id = show([25, 24, 24, 23]);
		link(id, 3, 102);
		link(id, 1, 101);
		// The page posts only ticked picks; a crafted post (or a second tab that
		// linked season 3 meanwhile) is what reaches this.
		db.prepare(
			`INSERT INTO season_link_candidates (series_id, season, part, anilist_id, rank, data) VALUES (?, 4, 1, 105, 0, ?)`
		).run(id, JSON.stringify(entryOf(105)));
		const r = seasons.linkPicks(
			id,
			'anime',
			[
				{ season: 2, part: 1, anilistId: 102 },
				{ season: 4, part: 1, anilistId: 105 }
			],
			NOW
		);
		expect(r).toEqual({
			linked: [{ season: 4, part: 1 }],
			refused: [
				{
					season: 2,
					part: 1,
					heldBy: { season: 3, part: 1 },
					why: 'SEASON 2 NOT LINKED · SEASON 3 HOLDS ITS ENTRY'
				}
			]
		});
		expect(linked(id)).toEqual([
			[1, 1, 101],
			[3, 1, 102],
			[4, 1, 105]
		]);
	});

	it('a held part unticks its pair, which says so', async () => {
		const id = show([12, 23]);
		link(id, 1, 201);
		// Something else holds the second part's entry: here, season 1's part 2.
		link(id, 1, 203, 2);
		const offers = (await seasons.seasonRelations(id, 1))!;
		const two = offers.filter((o) => o.season === 2 && !o.outside);
		expect(two.map((o) => [o.part, o.anilistId, o.ticked, o.heldBy])).toEqual([
			[1, 202, false, null],
			[2, 203, false, { season: 1, part: 2 }]
		]);
		expect(two[0].why).toBe(
			'12 + 11 = 23: ONE SEASON HERE, TWO ENTRIES THERE · ITS OTHER PART IS HELD'
		);
	});

	it('the season’s own entry offered back to it says so, and replaces nothing', async () => {
		const id = show([25, 24]);
		link(id, 1, 101);
		link(id, 2, 102);
		const offers = (await seasons.seasonRelations(id, 2))!;
		expect(offers.find((o) => o.season === 1 && !o.outside)).toMatchObject({
			anilistId: 101,
			ticked: false,
			why: 'ALREADY ITS LINK',
			replaces: null,
			heldBy: null
		});
	});
});
