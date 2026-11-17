import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const tr = await import('$lib/server/tracking');
const { POST } = await import('../src/routes/api/links/+server');
const { load } = await import('../src/routes/links/+page.server');

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

// AniList's usual shape for a split season: part 2 is the SEQUEL of
// part 1, not of the season before, and the next season the SEQUEL of part 2.
// Part 2 also lists part 1 as its PREQUEL and (a loop) as its SEQUEL, and
// part 1 has a movie for a second SEQUEL (a branch).
add(node(401, 'Chain Show', 'TV', 12, 2019), [['SEQUEL', 402]]);
add(node(402, 'Chain Show Season 2', 'TV', 12, 2020), [
	['PREQUEL', 401],
	['SEQUEL', 403],
	['SEQUEL', 405]
]);
add(node(403, 'Chain Show Season 2 Part 2', 'TV', 11, 2021), [
	['PREQUEL', 402],
	['SEQUEL', 402],
	['SEQUEL', 404]
]);
add(node(404, 'Chain Show Season 3', 'TV', 12, 2022), [
	['PREQUEL', 403],
	['SEQUEL', 406]
]);
add(node(406, 'Chain Show Season 4', 'TV', 12, 2023), [['PREQUEL', 404]]);
add(node(405, 'Chain Show the Movie', 'MOVIE', 1, 2021), [['PREQUEL', 402]]);
// A catalogue that numbers its seasons as parts (JoJo's): `Part 2` is the
// SEQUEL of a whole season here, so it is the next season, not half of one.
add(node(411, 'Parts Show', 'TV', 12, 2012), [['SEQUEL', 412]]);
add(node(412, 'Parts Show Part 2', 'TV', 12, 2014), [['PREQUEL', 411]]);

// A season a catalogue splits at an episode its relations do not show:
// two entries, 12 and 11, with no edge between them, the second titled with
// no part (so no walk could place it). Only a search finds part 2, which is
// what `+ A SECOND PART` asks.
add(node(501, 'Hand Show Season 2', 'TV', 12, 2020));
add(node(502, 'Hand Show Final Chapter', 'TV', 11, 2021));
// An entry whose own count is close to the season's listed 23, so the check a
// part's candidates are made against shows in the EPISODES row (c592's round 2).
add(node(503, 'Hand Show Final Chapter II', 'TV', 21, 2022));
/** What a title search answers (any title): the walk's fake answers no search. */
let SEARCH: number[] = [];

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
	// A title search (`sN: Page`), and a pasted link's read by id (`id_in`).
	const media = (id: number) => {
		const w = WORLD.get(id)!;
		return {
			...w,
			countryOfOrigin: 'JP',
			status: 'FINISHED',
			chapters: null,
			volumes: null,
			season: null,
			synonyms: [],
			startDate: { year: w.seasonYear },
			coverImage: { extraLarge: null, large: null }
		};
	};
	for (const m of query.matchAll(/s(\d+):\s*Page\(/g))
		data[`s${m[1]}`] = { media: SEARCH.map(media) };
	if (/media\(id_in:/.test(query))
		data.Page = {
			media: (variables.ids as unknown as number[]).filter((id) => WORLD.has(id)).map(media)
		};
	if (asked.length) requests.push(asked);
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

describe('the relation walk', () => {
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
		expect(r).toMatchObject({
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
			// War of Underworld and its Part 2, AniList's usual shape (part 2 the
			// SEQUEL of part 1): one season here, 12 + 11 = 23.
			{ season: 4, part: 1, id: 105, how: 'SEQUEL', ticked: true, outside: false, heldBy: null },
			{ season: 4, part: 2, id: 106, how: 'SEQUEL', ticked: true, outside: false, heldBy: null }
		]);
		expect(offers.filter((o) => o.outside).map((o) => o.id)).toEqual([103, 150, 151, 160]);
	});

	it('puts a split season’s parts in their order, and LINK N SEASONS writes both', async () => {
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
		expect(r).toMatchObject({
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

describe('a split season chained part 1 → part 2, AniList’s usual shape', () => {
	it('offers both parts as one season, and the season after them', async () => {
		const id = show([12, 23, 12]);
		link(id, 1, 401);
		const offers = shape(await seasons.seasonRelations(id, 1));
		expect(offers.filter((o) => !o.outside)).toEqual([
			{ season: 2, part: 1, id: 402, how: 'SEQUEL', ticked: true, outside: false, heldBy: null },
			{ season: 2, part: 2, id: 403, how: 'SEQUEL', ticked: true, outside: false, heldBy: null },
			{
				season: 3,
				part: 1,
				id: 404,
				how: 'SEQUEL’S SEQUEL',
				ticked: true,
				outside: false,
				heldBy: null
			}
		]);
		expect(offers.filter((o) => o.outside).map((o) => o.id)).toEqual([405]);
		// Part 2 took no step, so the season after it is asked one ring further,
		// for that part alone.
		expect(requests).toEqual([[401], [402], [403]]);
		const r = seasons.linkPicks(
			id,
			'anime',
			offers
				.filter((o) => o.ticked)
				.map((o) => ({ season: o.season!, part: o.part!, anilistId: o.id })),
			NOW
		);
		expect(seasons.seasonsLinked(r.linked, r.refused)).toEqual({ linked: 2, of: 2 });
		expect(linked(id)).toEqual([
			[1, 1, 401],
			[2, 1, 402],
			[2, 2, 403],
			[3, 1, 404]
		]);
	});

	it('offers part 2 for the season part 1 was linked to, and the seasons either side', async () => {
		const id = show([12, 23, 12]);
		link(id, 2, 402);
		const offers = shape(await seasons.seasonRelations(id, 2));
		expect(offers.filter((o) => !o.outside)).toEqual([
			{ season: 1, part: 1, id: 401, how: 'PREQUEL', ticked: true, outside: false, heldBy: null },
			{ season: 2, part: 2, id: 403, how: 'SEQUEL', ticked: true, outside: false, heldBy: null },
			{ season: 3, part: 1, id: 404, how: 'SEQUEL', ticked: true, outside: false, heldBy: null }
		]);
		// Part 2 stood in the first ring and took no step, so what it reached
		// (season 3) is asked one ring further, as from a whole season 2.
		expect(requests).toEqual([[402], [401, 403, 405], [404]]);
	});

	it('reaches two seasons out from a part, as from a whole season', async () => {
		const id = show([12, 23, 12, 12]);
		link(id, 2, 402);
		const offers = shape(await seasons.seasonRelations(id, 2));
		expect(offers.filter((o) => !o.outside).map((o) => [o.season, o.part, o.id, o.how])).toEqual([
			[1, 1, 401, 'PREQUEL'],
			[2, 2, 403, 'SEQUEL'],
			[3, 1, 404, 'SEQUEL'],
			[4, 1, 406, 'SEQUEL’S SEQUEL']
		]);
	});

	// Round 2: the other part follows the edge that reached it. A PREQUEL part
	// is the earlier half, a SEQUEL part the later; offered at the slot the link
	// leaves free when that slot is the wrong one, it is never ticked, so LINK
	// never writes the season's halves in reverse.
	const ticks = (id: number, offers: ReturnType<typeof shape>) => {
		seasons.linkPicks(
			id,
			'anime',
			offers
				.filter((o) => o.ticked)
				.map((o) => ({ season: o.season!, part: o.part!, anilistId: o.id })),
			NOW
		);
		return linked(id).filter(([season]) => season === 2);
	};

	it('never ticks part 1 at part 2 when Part 2 was linked on part 1’s line', async () => {
		const id = show([12, 23, 12]);
		link(id, 2, 403);
		const offers = shape(await seasons.seasonRelations(id, 2));
		expect(offers.find((o) => o.id === 402)).toEqual({
			season: 2,
			part: 2,
			id: 402,
			how: 'THE EARLIER HALF',
			ticked: false,
			outside: false,
			heldBy: null
		});
		const why = (await seasons.seasonRelations(id, 2))!.find((o) => o.anilistId === 402)!.why;
		expect(why).toBe('THE LINK HOLDS THE LATER HALF AT PART 1 · NEVER TICKED');
		expect(ticks(id, offers)).toEqual([[2, 1, 403]]);
	});

	it('never ticks part 2 at part 1 when part 1 was linked on part 2’s line', async () => {
		const id = show([12, 23, 12]);
		link(id, 2, 402, 2);
		const offers = shape(await seasons.seasonRelations(id, 2));
		expect(offers.find((o) => o.id === 403)).toEqual({
			season: 2,
			part: 1,
			id: 403,
			how: 'THE LATER HALF',
			ticked: false,
			outside: false,
			heldBy: null
		});
		const why = (await seasons.seasonRelations(id, 2))!.find((o) => o.anilistId === 403)!.why;
		expect(why).toBe('THE LINK HOLDS THE EARLIER HALF AT PART 2 · NEVER TICKED');
		expect(ticks(id, offers)).toEqual([[2, 2, 402]]);
	});

	// c541: both halves stored, reversed (by the round-1 walker or by hand).
	// The other part is "already its link", but in the wrong half, and the
	// closing pass keeps the disagreeing why instead of drawing it settled.
	const whyOf = async (id: number, entry: number) =>
		(await seasons.seasonRelations(id, 2))!.find((o) => o.anilistId === entry && !o.outside)!;

	it('says a season whose halves are stored reversed is reversed, not settled', async () => {
		const id = show([12, 23, 12]);
		link(id, 2, 403);
		link(id, 2, 402, 2);
		expect(await whyOf(id, 402)).toMatchObject({
			season: 2,
			part: 2,
			how: 'THE EARLIER HALF',
			ticked: false,
			why: 'ALREADY ITS LINK · THE HALVES ARE REVERSED'
		});
		// Nothing ticked, so a LINK from this page leaves the rows as they are.
		expect(ticks(id, shape(await seasons.seasonRelations(id, 2)))).toEqual([
			[2, 1, 403],
			[2, 2, 402]
		]);
	});

	it('halves stored the right way round still read ALREADY ITS LINK (c541’s mirror)', async () => {
		const id = show([12, 23, 12]);
		link(id, 2, 402);
		link(id, 2, 403, 2);
		expect(await whyOf(id, 403)).toMatchObject({
			season: 2,
			part: 2,
			how: 'SEQUEL',
			ticked: false,
			why: 'ALREADY ITS LINK'
		});
	});

	it('one half stored on the wrong line keeps its NEVER TICKED why', async () => {
		const id = show([12, 23, 12]);
		link(id, 2, 403);
		expect((await whyOf(id, 402)).why).toBe(
			'THE LINK HOLDS THE LATER HALF AT PART 1 · NEVER TICKED'
		);
	});

	it('still ticks part 1 at part 1 when Part 2 was linked at part 2', async () => {
		const id = show([12, 23, 12]);
		link(id, 2, 403, 2);
		const offers = shape(await seasons.seasonRelations(id, 2));
		expect(offers.find((o) => o.id === 402)).toEqual({
			season: 2,
			part: 1,
			id: 402,
			how: 'PREQUEL',
			ticked: true,
			outside: false,
			heldBy: null
		});
		expect(ticks(id, offers)).toEqual([
			[2, 1, 402],
			[2, 2, 403]
		]);
	});

	it('keeps a part apart when the counts say the season here is part 1 alone', async () => {
		// Season 2 here holds 12: part 1 is all of it, so its `Part 2` sequel is
		// a season of its own, one step out.
		const id = show([12, 12, 11]);
		link(id, 1, 401);
		const offers = shape(await seasons.seasonRelations(id, 1));
		expect(offers.filter((o) => !o.outside).map((o) => [o.season, o.part, o.id, o.ticked])).toEqual(
			[
				[2, 1, 402, true],
				[3, 1, 403, true]
			]
		);
	});

	it('never swallows a sequel that is a whole season here, whatever its title', async () => {
		const id = show([12, 12]);
		link(id, 1, 411);
		const offers = shape(await seasons.seasonRelations(id, 1));
		expect(offers.filter((o) => !o.outside).map((o) => [o.season, o.part, o.id, o.ticked])).toEqual(
			[[2, 1, 412, true]]
		);
	});

	it('reads a part from the title alone, and from no title the specs use but the parts', () => {
		const t = (title: string) => seasons.partNumber({ english: title, romaji: null, native: null });
		// Every title the walk's two fakes hold (this file's WORLD, and
		// links-flow.e2e.ts's stand-in catalogue), as listed there.
		const e2e = [
			'Ranma ½',
			'Ranma ½ (2024)',
			'Frieren',
			'Sword Art Online',
			'Sword Art Online II',
			'Sword Art Online: Extra Edition',
			'Sword Art Online Alternative: Gun Gale Online',
			'Flat List Show',
			'Flat List Show Season 2',
			'Flat List Show Season 3',
			'Split Show',
			'Split Show 2nd Season',
			'Split Show 2nd Season Part 2',
			'Split Show 3rd Season',
			'Chain Split Show',
			'Chain Split Show 2nd Season',
			'Chain Split Show 2nd Season Part 2',
			'Chain Split Show 3rd Season',
			'Lone Show',
			'Lone Show Again'
		];
		const parts = Object.fromEntries(
			[...[...WORLD.values()].map((n) => n.title.english!), ...e2e]
				.map((title) => [title, t(title)])
				.filter(([, n]) => n !== null)
		);
		expect(parts).toEqual({
			'Sword Art Online: Alicization - War of Underworld Part 2': 2,
			'Split Show Season 2 Part 2': 2,
			'Chain Show Season 2 Part 2': 2,
			'Parts Show Part 2': 2,
			'Split Show 2nd Season Part 2': 2,
			'Chain Split Show 2nd Season Part 2': 2
		});
		// The other ways a catalogue writes a part, and what is no part.
		expect(
			[
				'Show 2nd Cour',
				'Show Cour 2',
				'Show Part II',
				'Show Second Part',
				'Show 第2クール',
				'Show 第２クール',
				'Show Part 1',
				'Show 2nd Season',
				'Show II',
				'Party Show 2',
				'Show: Departure 2'
			].map(t)
		).toEqual([2, 2, 2, 2, 2, 2, null, null, null, null, null]);
	});
});

describe('LINK N SEASONS counts seasons, not parts', () => {
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

describe('the readers of a season’s link take the caller’s database', () => {
	it('episodeEntry and showEntry read the handle they are given, not getDb()’s', () => {
		const id = show([12, 12]);
		link(id, 1, 101);
		link(id, 2, 102);
		// A copy (as an import against a copy, or a test, would hold), whose
		// season 2 is linked elsewhere and whose season 1 is not linked at all.
		const copy = new Database(db.serialize());
		try {
			copy
				.prepare(
					`UPDATE series_season_links SET anilist_id = 777, mal_id = 7777 WHERE series_id = ? AND season = 2`
				)
				.run(id);
			copy.prepare(`DELETE FROM series_season_links WHERE series_id = ? AND season = 1`).run(id);
			expect(seasons.episodeEntry(id, 2, 3, copy)).toMatchObject({
				anilistId: 777,
				malId: 7777,
				number: 3
			});
			expect(seasons.episodeEntry(id, 1, 3, copy)).toBe(null);
			expect(seasons.showEntry(id, () => true, copy)).toEqual({ anilistId: 777, malId: 7777 });
			// And getDb()'s own rows are what a caller with no handle reads.
			expect(seasons.episodeEntry(id, 2, 3)).toMatchObject({ anilistId: 102 });
			expect(seasons.showEntry(id, () => true)).toMatchObject({ anilistId: 101 });
		} finally {
			copy.close();
		}
	});
});

describe('an entry another season holds', () => {
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
		expect(r).toMatchObject({
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

describe('a split season is linked whole or not at all (c466, the owner’s (b))', () => {
	/**
	 * Chain Show from season 1: the relations offer season 2 as a pair (402 +
	 * 403 = 23) and season 3 (404), all ticked. What the page would post is
	 * read from the walk's own answer, not written here.
	 */
	const offered = async (counts: number[]) => {
		const id = show(counts);
		link(id, 1, 401);
		const offers = (await seasons.seasonRelations(id, 1))!;
		const picks = offers
			.filter((o) => o.ticked)
			.map((o) => ({ season: o.season, part: o.part, anilistId: o.anilistId }));
		expect(picks).toEqual([
			{ season: 2, part: 1, anilistId: 402 },
			{ season: 2, part: 2, anilistId: 403 },
			{ season: 3, part: 1, anilistId: 404 }
		]);
		return { id, picks };
	};
	const WHY = 'SEASON 2 NOT LINKED · SEASON 4 HOLDS PART 2’S ENTRY';

	it('refuses both parts when part 2 is held, writes neither, and still links the other season', async () => {
		const { id, picks } = await offered([12, 23, 12, 11]);
		// Meanwhile (a second tab) season 4 is given part 2's entry.
		link(id, 4, 403);
		const r = seasons.linkPicks(id, 'anime', picks, NOW);
		expect(r).toMatchObject({
			linked: [{ season: 3, part: 1 }],
			refused: [
				{ season: 2, part: 1, heldBy: null, why: WHY },
				{ season: 2, part: 2, heldBy: { season: 4, part: 1 }, why: WHY }
			]
		});
		// Not "LINKED 0 OF 1" over a half-written season: nothing of it is written.
		expect(linked(id)).toEqual([
			[1, 1, 401],
			[3, 1, 404],
			[4, 1, 403]
		]);
		expect(seasons.seasonsLinked(r.linked, r.refused)).toEqual({ linked: 1, of: 2 });
	});

	it('refuses both parts when part 1 is held, naming part 1', async () => {
		const { id, picks } = await offered([12, 23, 12, 12]);
		link(id, 4, 402);
		const r = seasons.linkPicks(id, 'anime', picks.slice(0, 2), NOW);
		expect(r.linked).toEqual([]);
		expect(r.refused.map((p) => [p.part, p.heldBy, p.why])).toEqual([
			[1, { season: 4, part: 1 }, 'SEASON 2 NOT LINKED · SEASON 4 HOLDS PART 1’S ENTRY'],
			[2, null, 'SEASON 2 NOT LINKED · SEASON 4 HOLDS PART 1’S ENTRY']
		]);
		expect(linked(id).filter(([season]) => season === 2)).toEqual([]);
		expect(seasons.seasonsLinked(r.linked, r.refused)).toEqual({ linked: 0, of: 1 });
	});

	it('links the pair on a second try once the holder lets go', async () => {
		const { id, picks } = await offered([12, 23, 12, 11]);
		link(id, 4, 403);
		expect(seasons.linkPicks(id, 'anime', picks.slice(0, 2), NOW).linked).toEqual([]);
		seasons.unlinkSeason(id, 4, 1, NOW);
		// The held offer was never kept as a candidate, so the page walks again
		// (its own door: the relations), and ticks the pair once more.
		const again = (await seasons.seasonRelations(id, 1))!
			.filter((o) => o.ticked && o.season === 2)
			.map((o) => ({ season: o.season, part: o.part, anilistId: o.anilistId }));
		expect(again).toEqual(picks.slice(0, 2));
		const r = seasons.linkPicks(id, 'anime', again, NOW);
		expect(r).toMatchObject({
			linked: [
				{ season: 2, part: 1 },
				{ season: 2, part: 2 }
			],
			refused: []
		});
		expect(linked(id).filter(([season]) => season === 2)).toEqual([
			[2, 1, 402],
			[2, 2, 403]
		]);
	});

	it('takes the same pair picked twice in one post as one pick', async () => {
		const { id, picks } = await offered([12, 23, 12]);
		const r = seasons.linkPicks(id, 'anime', [...picks, ...picks], NOW);
		expect(r).toMatchObject({
			linked: [
				{ season: 2, part: 1 },
				{ season: 2, part: 2 },
				{ season: 3, part: 1 }
			],
			refused: []
		});
		expect(seasons.seasonsLinked(r.linked, r.refused)).toEqual({ linked: 2, of: 2 });
		// And a second post of the same pair, once linked: the season's own entries
		// again, written over themselves, not refused as held by each other.
		expect(seasons.linkPicks(id, 'anime', picks.slice(0, 2), NOW).refused).toEqual([]);
		expect(linked(id).filter(([season]) => season === 2)).toEqual([
			[2, 1, 402],
			[2, 2, 403]
		]);
	});

	it('refuses a pair given one entry for both parts, or two entries for one part', async () => {
		const { id } = await offered([12, 23, 12]);
		// A crafted post: part 2's own offer is 403, but 402 is asked at both.
		db.prepare(
			`INSERT INTO season_link_candidates (series_id, season, part, anilist_id, rank, data) VALUES (?, 2, 2, 402, 0, ?)`
		).run(id, JSON.stringify(entryOf(402)));
		const same = seasons.linkPicks(
			id,
			'anime',
			[
				{ season: 2, part: 1, anilistId: 402 },
				{ season: 2, part: 2, anilistId: 402 }
			],
			NOW
		);
		expect(same.linked).toEqual([]);
		expect(same.refused.map((p) => p.why)).toEqual([
			'SEASON 2 NOT LINKED · BOTH PARTS PICKED ONE ENTRY',
			'SEASON 2 NOT LINKED · BOTH PARTS PICKED ONE ENTRY'
		]);
		const twice = seasons.linkPicks(
			id,
			'anime',
			[
				{ season: 2, part: 1, anilistId: 402 },
				{ season: 2, part: 2, anilistId: 403 },
				{ season: 2, part: 2, anilistId: 402 }
			],
			NOW
		);
		expect(twice.linked).toEqual([]);
		expect(twice.refused[0].why).toBe('SEASON 2 NOT LINKED · TWO ENTRIES PICKED FOR PART 2');
		expect(linked(id).filter(([season]) => season === 2)).toEqual([]);
	});

	it('takes part 1 back when part 2’s write throws', async () => {
		const { id, picks } = await offered([12, 23, 12]);
		db.exec(`CREATE TEMP TRIGGER part2_fails BEFORE INSERT ON series_season_links
			WHEN NEW.part = 2 BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
		try {
			expect(() => seasons.linkPicks(id, 'anime', picks.slice(0, 2), NOW)).toThrow('disk full');
		} finally {
			db.exec(`DROP TRIGGER part2_fails`);
		}
		expect(linked(id)).toEqual([[1, 1, 401]]);
		// No transaction is left open behind the throw: the next write is its own.
		expect(seasons.linkPicks(id, 'anime', picks.slice(0, 2), NOW).refused).toEqual([]);
	});

	it('a season picked at one part alone keeps its own words', async () => {
		const { id } = await offered([12, 23, 12, 11]);
		link(id, 4, 404);
		expect(
			seasons.linkPicks(id, 'anime', [{ season: 3, part: 1, anilistId: 404 }], NOW)
		).toMatchObject({
			linked: [],
			refused: [
				{
					season: 3,
					part: 1,
					heldBy: { season: 4, part: 1 },
					why: 'SEASON 3 NOT LINKED · SEASON 4 HOLDS ITS ENTRY'
				}
			]
		});
	});
});

describe('a season’s second part by hand: + A SECOND PART, FROM EP. n', () => {
	const cookies = { get: () => undefined } as never;
	/** The API as the page posts to it: its status, and what it answered. */
	const api = async (body: object): Promise<{ status: number; body: Record<string, unknown> }> => {
		try {
			const r = await POST({
				request: new Request('http://x/api/links', {
					method: 'POST',
					body: JSON.stringify(body)
				}),
				cookies
			} as never);
			return { status: r.status, body: (await r.json()) as Record<string, unknown> };
		} catch (e) {
			const x = e as { status: number; body: { message: string } };
			if (typeof x?.status !== 'number') throw e;
			return { status: x.status, body: { message: x.body.message } };
		}
	};
	/** The page's load on a season, `&part=2` or not. */
	const page = async (id: number, season: number, part?: number) =>
		(await load({
			url: new URL(`http://x/links?series=${id}&season=${season}${part ? `&part=${part}` : ''}`),
			cookies
		} as never)) as {
			items: { part?: number; candidates: { anilistId: number; why: string }[] }[];
			single: { linked: string | null };
			season: {
				part: number;
				second: { from: number; after: number; part1: string; linked: boolean } | null;
			};
			relations: unknown;
		};
	const sends = (id: number) =>
		db
			.prepare(
				`SELECT season, part, progress, status FROM season_tracker_sends WHERE series_id = ? ORDER BY season, part`
			)
			.all(id);
	const watch = (id: number, season: number, episode: number) =>
		db
			.prepare(
				`UPDATE entries SET read_at = ? WHERE series_id = ? AND season = ? AND episode_number = ?`
			)
			.run(NOW, id, season, episode);

	beforeEach(() => {
		SEARCH = [501, 502];
		// The covers' refresh after a LINK runs in the background: nothing it
		// asks the network for is part of this.
		vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
		db.prepare(`DELETE FROM tracker_accounts`).run();
		db.prepare(
			`INSERT INTO tracker_accounts (service, user_id, user_name, access_token, signed_in_at)
			VALUES ('anilist', '7', 'masshiro', 'al-token', ?)`
		).run(NOW);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		db.prepare(`DELETE FROM tracker_accounts`).run();
	});

	it('links part 2 by hand from EP. 13; part 1’s last episode completes it, the season’s EP. 13 is part 2’s EP. 1', async () => {
		// The design's SAO S4 in small: season 2 is 23 episodes here, its AniList
		// entry 12, and no relation says where the other 11 are.
		const id = show([12, 23]);
		link(id, 2, 501);
		// The season's page offers + A SECOND PART, filled from part 1's count.
		const one = await page(id, 2);
		expect(one.season.part).toBe(1);
		expect(one.season.second).toEqual({
			from: 13,
			after: 12,
			part1: 'Hand Show Season 2',
			linked: false
		});
		// `&part=2`: the same search, part 2's own, with nothing found yet.
		const two = await page(id, 2, 2);
		expect(two.season.part).toBe(2);
		expect(two.single.linked).toBe(null);
		expect(two.items[0].part).toBe(2);
		expect(two.relations).toBe(null);
		const found = await api({ series: id, search: 'Hand Show Season 2', season: 2, part: 2 });
		expect(found.status).toBe(200);
		// Part 1's own entry is held by part 1, so it is no candidate of part 2;
		// the other is checked against part 2's 11 episodes, not the season's 23.
		const item = found.body.item as { part: number; candidates: { anilistId: number }[] };
		expect(item.part).toBe(2);
		expect(item.candidates.map((c) => c.anilistId)).toEqual([502]);
		expect((await page(id, 2, 2)).items[0].candidates.map((c) => c.anilistId)).toEqual([502]);
		expect(linked(id)).toEqual([[2, 1, 501]]);
		// A start the schema cannot keep is refused, and says where it starts.
		const wrong = await api({ series: id, link: 502, season: 2, part: 2, from: 14 });
		expect(wrong).toEqual({
			status: 409,
			body: { message: 'PART 2 STARTS WHERE PART 1’S 12 EPISODES END · FROM EP. 13, NOT 14' }
		});
		expect(linked(id)).toEqual([[2, 1, 501]]);
		const ok = await api({ series: id, link: 502, season: 2, part: 2, from: 13 });
		expect(ok.status).toBe(200);
		expect(ok.body.relations).toBe(null);
		expect(linked(id)).toEqual([
			[2, 1, 501],
			[2, 2, 502]
		]);
		expect(seasons.seriesSeasons(id)!.seasons[1].parts).toMatchObject([
			{ part: 1, from: 1, to: 12 },
			{ part: 2, from: 13, to: 23 }
		]);
		// Linked: no second + A SECOND PART on the season's page.
		expect((await page(id, 2)).season.second!.linked).toBe(true);
		// Part 1's last episode completes part 1, and nothing goes to part 2.
		watch(id, 2, 12);
		expect(tr.queueProgress(id, NOW)).toBe(1);
		expect(sends(id)).toEqual([{ season: 2, part: 1, progress: 12, status: 'completed' }]);
		// The season's EP. 13 is part 2's EP. 1.
		watch(id, 2, 13);
		expect(tr.queueProgress(id, NOW)).toBe(1);
		expect(sends(id)).toEqual([
			{ season: 2, part: 1, progress: 12, status: 'completed' },
			{ season: 2, part: 2, progress: 1, status: 'reading' }
		]);
	});

	it('refuses a part 2 whose entry another season holds, and writes nothing', async () => {
		const id = show([12, 23, 11]);
		link(id, 2, 501);
		link(id, 3, 502);
		// Searched, it is no candidate of part 2 (held); pasted, LINK refuses it.
		await api({ series: id, search: 'Hand Show Season 2', season: 2, part: 2 });
		expect(await api({ series: id, link: 502, season: 2, part: 2, from: 13 })).toEqual({
			status: 409,
			body: { message: 'not a candidate' }
		});
		expect(
			await api({ series: id, link: 502, pasted: true, season: 2, part: 2, from: 13 })
		).toEqual({ status: 409, body: { message: 'another season holds that entry' } });
		expect(linked(id)).toEqual([
			[2, 1, 501],
			[3, 1, 502]
		]);
	});

	it('never a third part, and no second part where part 1 leaves no episode or has no count', async () => {
		const id = show([12, 23]);
		link(id, 2, 501);
		expect((await api({ series: id, link: 502, season: 2, part: 3, from: 13 })).status).toBe(400);
		// Part 1 is all of season 1 here (12 of 12): nothing left for a part 2.
		link(id, 1, 401);
		expect(seasons.secondPart(id, 1)).toEqual({
			refused: 'PART 1 LISTS 12 EPISODES, ALL 12 HERE · NO EPISODE IS LEFT FOR A SECOND PART'
		});
		const flat = await page(id, 1, 2);
		expect([flat.season.part, flat.season.second]).toEqual([1, null]);
		// Pasted, so "not a candidate" cannot answer for it: the refusal is the
		// second part's own.
		expect(
			await api({ series: id, link: 502, pasted: true, season: 1, part: 2, from: 13 })
		).toEqual({
			status: 409,
			body: {
				message: 'PART 1 LISTS 12 EPISODES, ALL 12 HERE · NO EPISODE IS LEFT FOR A SECOND PART'
			}
		});
		expect(linked(id)).toEqual([
			[1, 1, 401],
			[2, 1, 501]
		]);
		// Part 1's entry lists no count: part 2 has nowhere to start.
		const unknown = show([12, 23]);
		expect(
			seasons.linkSeason(unknown, 2, 1, { ...entryOf(501), episodes: null }, 'review', NOW)
		).toBe(true);
		expect(seasons.secondPart(unknown, 2)).toEqual({
			refused: 'PART 1’S ENTRY LISTS NO EPISODE COUNT · A SECOND PART HAS NOWHERE TO START'
		});
		// No part 1 at all.
		expect(seasons.secondPart(show([12, 23]), 2)).toEqual({
			refused: 'PART 1 IS NOT LINKED · LINK IT FIRST'
		});
	});

	it('a season whose only row is part 2 searches and pastes against part 2’s own item', async () => {
		// A library may already hold the state: a CHANGE of part 1 followed
		// by the band's UNDO left it, before UNDO refused that. Part 2's row alone.
		const id = show([12, 23]);
		link(id, 2, 502, 2);
		expect(linked(id)).toEqual([[2, 2, 502]]);
		// The page stands on part 2 (its one row), with no second part to offer.
		const at = await page(id, 2);
		expect(at.season.part).toBe(2);
		expect(at.season.second).toBe(null);
		// So it posts part: 2, and the answer is part 2's own item: the search it
		// just wrote, with its candidates -- never part 1's empty one.
		SEARCH = [501, 502, 503];
		const found = await api({ series: id, search: 'Hand Show Season 2', season: 2, part: 2 });
		expect(found.status).toBe(200);
		const item = found.body.item as {
			part: number;
			found: number;
			candidates: { anilistId: number; rows?: { label: string; value: string }[] }[];
		};
		expect(item.part).toBe(2);
		expect(item.found).toBe(3);
		expect(item.candidates.map((c) => c.anilistId)).toEqual([501, 502, 503]);
		// Checked against the season's own listed count (23), not part 2's
		// guessed 11: part 1's count is what would place part 2, and it is gone
		// (c592's round 2). 501 and 502 are far from 23; 503 is close, and its
		// row is the one that says what the check was against.
		expect(item.candidates.map((c) => c.rows?.find((r) => r.label === 'EPISODES')?.value)).toEqual([
			'12',
			'11',
			'21 · THIS HAS 23'
		]);
		// The page reloaded at the season stands on the same item and draws them.
		const drawn = await page(id, 2);
		expect(drawn.items[0].part).toBe(2);
		expect(drawn.items[0].candidates.map((c) => c.anilistId)).toEqual([501, 502, 503]);
		// A paste reads against part 2's item too.
		const pasted = await api({
			series: id,
			paste: 'https://anilist.co/anime/502',
			season: 2,
			part: 2
		});
		expect(pasted.status).toBe(200);
		expect((pasted.body.candidate as { anilistId: number }).anilistId).toBe(502);
	});

	it('an orphaned part 2 has no start: nothing is sent from EP. 1 or anywhere', () => {
		// The state a library may hold: part 2's row, no part 1 beside it.
		const id = show([12, 23]);
		link(id, 2, 502, 2);
		// Part 1's count is what places part 2, and it is not recorded: the
		// season's 23 listed episodes could all be part 1's, for all this knows.
		expect(seasons.seriesSeasons(id)!.seasons[1].parts).toMatchObject([
			{ part: 2, from: 24, to: 23 }
		]);
		// EP. 1-12 are part 1's, and part 1 is not linked: nothing goes to part 2.
		watch(id, 2, 1);
		expect(tr.queueProgress(id, NOW)).toBe(0);
		watch(id, 2, 12);
		expect(tr.queueProgress(id, NOW)).toBe(0);
		// Nor does an episode part 2's entry does list get sent anywhere: without
		// part 1's count there is no way to know it is part 2's EP. 1, let alone
		// its EP. 13.
		watch(id, 2, 13);
		expect(tr.queueProgress(id, NOW)).toBe(0);
		watch(id, 2, 23);
		expect(tr.queueProgress(id, NOW)).toBe(0);
		expect(sends(id)).toEqual([]);
	});

	it('an orphaned part 2 on a list shorter than the season sends nothing', () => {
		// 18 of a 23-episode season listed: part 2 is still airing, which is
		// exactly when it gets linked alone. Counting back from the list's 18 by
		// part 2's 11 would begin at EP. 8, inside part 1, and send EP. 8-12 as
		// part 2's progress -- the fault the card is about (c592's round 2).
		const id = show([12, 18]);
		link(id, 2, 502, 2);
		expect(seasons.seriesSeasons(id)!.seasons[1].parts).toMatchObject([
			{ part: 2, from: 19, to: 18 }
		]);
		watch(id, 2, 8);
		expect(tr.queueProgress(id, NOW)).toBe(0);
		watch(id, 2, 18);
		expect(tr.queueProgress(id, NOW)).toBe(0);
		expect(sends(id)).toEqual([]);
	});

	it('an orphaned part 2 numbers no episode at all, so AniSkip is asked nothing', () => {
		// The state a library may hold: part 2's row, no part 1 beside it, and
		// `partsOf` gives it the empty span. AniSkip is keyed by what
		// `episodeEntry` answers, and before c642 a season with one part skipped
		// `partOf` and numbered every episode from EP. 1 within it: the season's
		// EP. 3 asked part 2's entry for its EP. 3, an episode of the part that
		// may be nowhere near the season's own. The span now answers null.
		const id = show([12, 23]);
		link(id, 2, 502, 2);
		expect(seasons.seriesSeasons(id)!.seasons[1].parts).toMatchObject([
			{ part: 2, from: 24, to: 23 }
		]);
		expect(seasons.episodeEntry(id, 2, 1)).toBe(null);
		expect(seasons.episodeEntry(id, 2, 3)).toBe(null);
		expect(seasons.episodeEntry(id, 2, 13)).toBe(null);
		expect(seasons.episodeEntry(id, 2, 23)).toBe(null);
	});

	it('an ordinary one-part season still numbers its own episodes', () => {
		// The other side of the widened condition: one part, part 1, is the whole
		// season, and EP. 3 is that entry's EP. 3, whatever the season's count.
		const id = show([12, 23]);
		link(id, 1, 401);
		expect(seasons.seriesSeasons(id)!.seasons[0].parts).toMatchObject([
			{ part: 1, from: 1, to: 12 }
		]);
		expect(seasons.episodeEntry(id, 1, 3)).toMatchObject({
			anilistId: 401,
			malId: 5401,
			number: 3
		});
		expect(seasons.episodeEntry(id, 1, 12)).toMatchObject({ anilistId: 401, number: 12 });
	});

	it('UNDO of part 1 is refused while part 2 stands, so the orphan is never made', () => {
		const id = show([12, 23]);
		link(id, 2, 501);
		link(id, 2, 502, 2);
		expect(() => seasons.undoSeasonLink(id, 2, 1)).toThrow('PART 2 IS LINKED');
		expect(linked(id)).toEqual([
			[2, 1, 501],
			[2, 2, 502]
		]);
		// Part 2's own UNLINK is not the refusal, and then part 1's UNDO is its own.
		expect(seasons.undoSeasonLink(id, 2, 2)).toBe(true);
		expect(seasons.undoSeasonLink(id, 2, 1)).toBe(true);
		expect(linked(id)).toEqual([]);
	});

	it('a part 2 search never stands for the season’s own search on the series screen', async () => {
		// Every + A SECOND PART visit writes part 2's search row; once the season
		// is unlinked, that row must not read as the season's candidates.
		const id = show([12, 23]);
		link(id, 2, 501);
		await api({ series: id, search: 'Hand Show Season 2', season: 2, part: 2 });
		expect((await api({ series: id, unlink: true, season: 2 })).status).toBe(200);
		expect(linked(id)).toEqual([]);
		const two = seasons.seriesSeasons(id)!.seasons[1];
		expect([two.searched, two.candidates, two.queued]).toEqual([false, 0, false]);
		// The season's own search is what it counts.
		await api({ series: id, search: 'Hand Show Season 2', season: 2 });
		const after = seasons.seriesSeasons(id)!.seasons[1];
		expect([after.searched, after.candidates]).toEqual([true, 2]);
	});

	it('UNLINK on part 2 takes part 2 alone, settles nothing, and the door opens again', async () => {
		const id = show([12, 23]);
		link(id, 2, 501);
		await api({ series: id, search: 'Hand Show Season 2', season: 2, part: 2 });
		expect((await api({ series: id, link: 502, season: 2, part: 2, from: 13 })).status).toBe(200);
		// Again, the same LINK: part 2's own entry, written over itself.
		expect((await api({ series: id, link: 502, season: 2, part: 2, from: 13 })).status).toBe(200);
		// Linked, `&part=2` is part 2's page: its own entry among its candidates,
		// so the page's tool row (SEARCH AGAIN, PASTE A LINK, UNLINK) is drawn,
		// UNLINK there because part 2 is linked.
		const two = await page(id, 2, 2);
		expect([two.season.part, two.season.second?.linked]).toEqual([2, true]);
		expect(two.single.linked).not.toBe(null);
		expect(two.items[0].candidates.map((c) => c.anilistId)).toContain(502);
		expect((await api({ series: id, unlink: true, season: 2, part: 2 })).status).toBe(200);
		expect(linked(id)).toEqual([[2, 1, 501]]);
		expect(seasons.seasonDecision(id, 2)).toBe(null);
		expect((await page(id, 2)).season.second).toMatchObject({ from: 13, linked: false });
	});
});

describe('LINK N SEASONS’ UNDO', () => {
	const cookies = { get: () => undefined } as never;
	const api = async (body: object): Promise<{ status: number; body: Record<string, unknown> }> => {
		try {
			const r = await POST({
				request: new Request('http://x/api/links', {
					method: 'POST',
					body: JSON.stringify(body)
				}),
				cookies
			} as never);
			return { status: r.status, body: (await r.json()) as Record<string, unknown> };
		} catch (e) {
			const x = e as { status: number; body: { message: string } };
			if (typeof x?.status !== 'number') throw e;
			return { status: x.status, body: { message: x.body.message } };
		}
	};
	/** A season's search and its one candidate, as the pass leaves them. */
	const seed = (id: number, season: number, entry: number, part = 1) =>
		expect(
			seasons.saveSeasonSearch(id, season, part, `Show Season ${season}`, [entryOf(entry)], NOW)
		).toBe(1);
	const post = (id: number, picks: { season: number; part: number; anilistId: number }[]) =>
		api({ series: id, seasons: picks });
	const undo = (id: number, facts: unknown) => api({ series: id, undo: 'seasons', facts });

	beforeEach(() => {
		// The covers' refresh after a LINK runs in the background: nothing it
		// asks the network for is part of this.
		vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
	});
	afterEach(() => vi.unstubAllGlobals());

	it('takes back every season the post wrote, and only those', async () => {
		const id = show([12, 23, 12]);
		seed(id, 1, 501);
		seed(id, 2, 502);
		// Linked before the post: its band's UNDO is not this one's business.
		link(id, 3, 404);
		const r = await post(id, [
			{ season: 1, part: 1, anilistId: 501 },
			{ season: 2, part: 1, anilistId: 502 }
		]);
		expect([r.status, r.body.linked, r.body.of]).toEqual([200, 2, 2]);
		expect(linked(id)).toEqual([
			[1, 1, 501],
			[2, 1, 502],
			[3, 1, 404]
		]);
		const undone = await undo(id, r.body.facts);
		expect(undone.status).toBe(200);
		// Every season the post wrote is gone; season 3, which it did not, stays.
		expect(linked(id)).toEqual([[3, 1, 404]]);
	});

	it('takes back both parts of a split season the post wrote', async () => {
		const id = show([23]);
		seed(id, 1, 501, 1);
		seed(id, 1, 502, 2);
		const r = await post(id, [
			{ season: 1, part: 1, anilistId: 501 },
			{ season: 1, part: 2, anilistId: 502 }
		]);
		expect([r.status, r.body.linked, r.body.of]).toEqual([200, 1, 1]);
		expect(linked(id)).toEqual([
			[1, 1, 501],
			[1, 2, 502]
		]);
		expect((await undo(id, r.body.facts)).status).toBe(200);
		expect(linked(id)).toEqual([]);
	});

	it('refuses whole when a season was linked again since, and changes nothing', async () => {
		const id = show([12, 23, 12]);
		seed(id, 1, 501);
		seed(id, 2, 502);
		const r = await post(id, [
			{ season: 1, part: 1, anilistId: 501 },
			{ season: 2, part: 1, anilistId: 502 }
		]);
		// The series screen (or a second tab): season 2 is given another entry.
		link(id, 2, 404);
		const undone = await undo(id, r.body.facts);
		expect(undone).toEqual({ status: 409, body: { message: 'LINKED OR DECIDED AGAIN SINCE' } });
		// Not half undone: season 1's row is the post's, and it stays too.
		expect(linked(id)).toEqual([
			[1, 1, 501],
			[2, 1, 404]
		]);
	});

	it('refuses a restore the entry another season took since, and changes nothing', async () => {
		const id = show([12, 23, 12]);
		// Season 2 holds 501 before the post; the post moves it to 502, and its
		// facts carry the row it replaced.
		link(id, 2, 501);
		seed(id, 2, 502);
		const r = await post(id, [{ season: 2, part: 1, anilistId: 502 }]);
		expect([r.status, r.body.linked]).toEqual([200, 1]);
		expect(linked(id)).toEqual([[2, 1, 502]]);
		// 501 is free now, and a season outside the post's facts takes it: the
		// state every link door refuses is one no door here can see.
		link(id, 3, 501);
		// UNDO would put 501 back on season 2, with season 3 still holding it.
		const undone = await undo(id, r.body.facts);
		expect(undone).toEqual({
			status: 409,
			body: { message: 'SEASON 3 HOLDS ITS ENTRY NOW' }
		});
		// Nothing changed: not half undone, and never two seasons on one entry.
		expect(linked(id)).toEqual([
			[2, 1, 502],
			[3, 1, 501]
		]);
	});

	it('refuses whole when a season was decided again since', async () => {
		const id = show([12, 23]);
		seed(id, 1, 501);
		seed(id, 2, 502);
		const r = await post(id, [
			{ season: 1, part: 1, anilistId: 501 },
			{ season: 2, part: 1, anilistId: 502 }
		]);
		cat.noneOfThese(id, NOW + 1, 1);
		const undone = await undo(id, r.body.facts);
		expect(undone.status).toBe(409);
		expect(linked(id)).toEqual([
			[1, 1, 501],
			[2, 1, 502]
		]);
	});

	it('a second UNDO of the same facts says so and changes nothing', async () => {
		const id = show([12, 23]);
		seed(id, 1, 501);
		seed(id, 2, 502);
		const r = await post(id, [
			{ season: 1, part: 1, anilistId: 501 },
			{ season: 2, part: 1, anilistId: 502 }
		]);
		expect((await undo(id, r.body.facts)).status).toBe(200);
		expect(await undo(id, r.body.facts)).toEqual({
			status: 409,
			body: { message: 'ALREADY UNDONE' }
		});
		expect(linked(id)).toEqual([]);
	});

	it('two posts’ bands each take back their own seasons', async () => {
		const id = show([12, 23, 12]);
		seed(id, 1, 501);
		seed(id, 2, 502);
		seed(id, 3, 404);
		const first = await post(id, [
			{ season: 1, part: 1, anilistId: 501 },
			{ season: 2, part: 1, anilistId: 502 }
		]);
		const second = await post(id, [{ season: 3, part: 1, anilistId: 404 }]);
		expect((await undo(id, second.body.facts)).status).toBe(200);
		// The second band's UNDO takes season 3 only; the first post's stay.
		expect(linked(id)).toEqual([
			[1, 1, 501],
			[2, 1, 502]
		]);
		expect((await undo(id, first.body.facts)).status).toBe(200);
		expect(linked(id)).toEqual([]);
	});

	it('refuses facts another series posted, and writes nothing', async () => {
		const id = show([12, 23]);
		const other = show([12]);
		seed(id, 1, 501);
		const r = await post(id, [{ season: 1, part: 1, anilistId: 501 }]);
		const undone = await undo(other, r.body.facts);
		expect(undone.status).toBe(400);
		expect(linked(id)).toEqual([[1, 1, 501]]);
	});
});
