import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Candidate } from '$lib/library/catalogue';

/**
 * The relation cache (c358; doc/LINKS.md, "The relation cache"; rung 73):
 * filled by the link pass from a stand-in AniList, read by the series screen
 * without asking anything, and every event that makes it stale -- a relink,
 * UNLINK, a season linked, the series deleted or MOVEd, a refresh that fails,
 * a graph grown old -- run through the app's own doors where it has them.
 */

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.TRASH_DIR = mkdtempSync(
	join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-relations-trash-')
);
delete process.env.TSUNDOKU_ANILIST;

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const cat = await import('$lib/server/catalogue');
const seasons = await import('$lib/server/season-links');
const rel = await import('$lib/server/relations');
const { deleteSeries } = await import('$lib/server/delete');

const NOW = Date.UTC(2026, 10, 7, 12);
const db = getDb();
seedSample(db, NOW);

// ---- the stand-in AniList -------------------------------------------------------------------

/**
 * What AniList answers, entry by entry, each with its edges both ways as the
 * real one gives them (`relations { edges { relationType node } }`). The
 * card's chain: a loop (S5 names S1 as its SEQUEL), a branch (S4's SPECIAL
 * prequel beside its ONA one), a MOVIE on the main chain, OVAs and an ONA as
 * side stories, an ONA season on the main chain, a NOT_YET_RELEASED sequel,
 * and the manga as an ADAPTATION. A second show with no sequel at all.
 */
type Entry = {
	id: number;
	type?: string;
	format: string;
	status?: string;
	episodes?: number | null;
	year?: number | null;
	title: string;
	edges: [string, number][];
};
const WORLD: Entry[] = [
	{
		id: 101,
		format: 'TV',
		title: 'Lantern Keeper',
		edges: [
			['SEQUEL', 102],
			['SIDE_STORY', 151],
			['ADAPTATION', 900],
			['PREQUEL', 105]
		]
	},
	{
		id: 102,
		format: 'TV',
		title: 'Lantern Keeper 2nd Season',
		edges: [
			['PREQUEL', 101],
			['SEQUEL', 160],
			['SIDE_STORY', 152]
		]
	},
	{
		id: 160,
		format: 'MOVIE',
		title: 'Lantern Keeper: The Long Night',
		episodes: 1,
		edges: [
			['PREQUEL', 102],
			['SEQUEL', 103]
		]
	},
	{
		id: 103,
		format: 'ONA',
		title: 'Lantern Keeper Season 3',
		episodes: 10,
		edges: [
			['PREQUEL', 160],
			['SEQUEL', 104],
			['SIDE_STORY', 153]
		]
	},
	{
		id: 104,
		format: 'TV',
		title: 'Lantern Keeper Season 4',
		edges: [
			['PREQUEL', 170],
			['PREQUEL', 103],
			['SEQUEL', 105]
		]
	},
	{
		id: 105,
		format: 'TV',
		title: 'Lantern Keeper Season 5',
		status: 'NOT_YET_RELEASED',
		episodes: null,
		year: 2027,
		edges: [
			['PREQUEL', 104],
			['SEQUEL', 101]
		]
	},
	{ id: 151, format: 'OVA', title: 'Lantern Keeper: Festival', episodes: 1, edges: [] },
	{ id: 152, format: 'ONA', title: 'Lantern Keeper Shorts', episodes: 8, edges: [] },
	{ id: 153, format: 'OVA', title: 'Lantern Keeper: Winter', episodes: 2, edges: [] },
	{ id: 170, format: 'SPECIAL', title: 'Lantern Keeper Recap', episodes: 1, edges: [] },
	{ id: 900, type: 'MANGA', format: 'MANGA', title: 'Lantern Keeper', edges: [] },
	{ id: 201, format: 'TV', title: 'Quiet Shore', edges: [['SEQUEL', 202]] },
	{ id: 202, format: 'TV', title: 'Quiet Shore 2nd Season', edges: [['PREQUEL', 201]] }
];
let world = new Map(WORLD.map((e) => [e.id, structuredClone(e)]));
/** Entries AniList answers a 500 for, as when it is down for them. */
const failing = new Set<number>();
/** Every entry asked about, in order: the screen's reads must add none. */
let asked: number[] = [];

const media = (e: Entry) => ({
	id: e.id,
	type: e.type ?? 'ANIME',
	format: e.format,
	status: e.status ?? 'FINISHED',
	episodes: e.episodes === undefined ? 12 : e.episodes,
	startDate: { year: e.year ?? 2020 },
	title: { english: e.title, romaji: null, native: null }
});

/** The GraphQL the app sends, answered as AniList would: aliases, then `Page` for anything else. */
function answer(query: string, variables: Record<string, unknown>) {
	const data: Record<string, unknown> = { Page: { media: [] } };
	for (const m of query.matchAll(/m(\d+):\s*Media\(id:\s*\$i(\d+),\s*type:\s*ANIME\)/g)) {
		const id = Number(variables[`i${m[2]}`]);
		asked.push(id);
		if (failing.has(id)) throw Object.assign(new Error('500'), { status: 500 });
		const e = world.get(id);
		data[`m${m[1]}`] = e
			? {
					...media(e),
					relations: {
						edges: e.edges.map(([relationType, to]) => ({
							relationType,
							node: media(world.get(to)!)
						}))
					}
				}
			: null;
	}
	return data;
}
const ask: Parameters<typeof rel.refreshRelations>[0] = async (q, v) => answer(q, v);

/** AniList over fetch, for the pass's own door (`refreshLinks`). */
const fakeFetch = (async (_url: string, init: RequestInit) => {
	const { query, variables } = JSON.parse(String(init.body)) as {
		query: string;
		variables: Record<string, unknown>;
	};
	try {
		return new Response(JSON.stringify({ data: answer(query, variables ?? {}) }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	} catch {
		return new Response(
			JSON.stringify({ errors: [{ message: 'Internal Server Error', status: 500 }] }),
			{
				status: 500,
				headers: { 'content-type': 'application/json' }
			}
		);
	}
}) as unknown as typeof fetch;

// ---- the library -----------------------------------------------------------------------------

const root = (db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number })
	.id;
const made: number[] = [];
function series(title: string, kind = 'anime', seasonsHeld: number[] = []): number {
	const id = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, source, in_library)
				VALUES (?, ?, ?, ?, ?, 'KickAssAnime', 1)`
			)
			.run(root, title, kind, NOW, `aniyomi:9000:/${title.replace(/\W+/g, '-').toLowerCase()}`)
			.lastInsertRowid
	);
	const put = db.prepare(
		`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url)
		VALUES (?, ?, ?, ?, ?, ?, '', 0, 0, 0, ?)`
	);
	seasonsHeld.forEach((season, i) =>
		put.run(id, i + 1, `Episode 1`, season, 1, NOW, `/${id}/${season}/1`)
	);
	made.push(id);
	return id;
}
const candidate = (anilistId: number): Candidate => {
	const e = world.get(anilistId)!;
	return {
		anilistId,
		malId: null,
		title: e.title,
		alts: [],
		format: e.format,
		country: 'JP',
		year: 2020,
		chapters: null,
		volumes: null,
		episodes: 12,
		season: null,
		seasonYear: null,
		status: 'FINISHED',
		coverUrl: ''
	};
};
/** LINK on a season, through the one door every link comes through. */
const link = (id: number, season: number, anilistId: number) =>
	expect(seasons.linkSeason(id, season, 1, candidate(anilistId), 'review', NOW)).toBe(true);
const row = (id: number) =>
	db
		.prepare(`SELECT graph, fetched_at, tried_at FROM series_relations WHERE series_id = ?`)
		.get(id) as { graph: string | null; fetched_at: number | null; tried_at: number } | undefined;

beforeEach(() => {
	world = new Map(WORLD.map((e) => [e.id, structuredClone(e)]));
	failing.clear();
	asked = [];
});
afterEach(() => {
	for (const id of made.splice(0)) db.prepare(`DELETE FROM series WHERE id = ?`).run(id);
	db.prepare(`DELETE FROM series_relations`).run();
	cat.setAnilistFetch(null);
});

describe('the pass fills the cache, and the screen reads it without asking (c358)', () => {
	it('is the link pass’s last step, from the seasons’ own links, and the screen asks nothing', async () => {
		const s4 = series('Lantern Keeper Season 4', 'anime', [4]);
		link(s4, 4, 104);
		// The series_links mirror names another show: the walk never reads it (c467).
		db.prepare(`UPDATE series_links SET anilist_id = 201 WHERE series_id = ?`).run(s4);
		expect(rel.seasonsAroundOf(s4, false)).toBeNull();
		cat.setAnilistFetch(fakeFetch, 0);
		const pass = await cat.refreshLinks({ limit: 0, now: NOW });
		expect(pass.unreachable).toBe(false);
		expect(pass.relations).toBe(1);
		expect(row(s4)).toMatchObject({ fetched_at: NOW, tried_at: NOW });
		expect(asked).not.toContain(201);
		asked = [];
		const around = rel.seasonsAroundOf(s4, false)!;
		// Nothing asked by the screen's read: it renders from the cache alone.
		expect(asked).toEqual([]);
		expect(around.before.map((h) => [h.key, h.label])).toEqual([
			[101, 'SEASON 1'],
			[102, 'SEASON 2'],
			[103, 'SEASON 3']
		]);
		expect(around.next).toMatchObject({ key: 105, facts: ['ANNOUNCED', '2027'] });
		expect(around.extras.map((x) => x.key).sort()).toEqual([151, 152, 153, 160, 170]);
		// Fresh, so the next pass leaves it alone.
		expect(rel.relationsStale(s4, NOW + 1000)).toBe(false);
		asked = [];
		await rel.refreshRelations(ask, { now: NOW + 1000 });
		expect(asked).toEqual([]);
	});

	it('is in the library by another series’ own season link, never by title, and hidden stays hidden', async () => {
		const s4 = series('Lantern Keeper Season 4', 'anime', [4]);
		link(s4, 4, 104);
		// Titled as season 1 is, and linked to nothing: not season 1.
		series('Lantern Keeper');
		const s2 = series('Lantern Keeper II', 'anime', [1]);
		link(s2, 1, 102);
		const s3 = series('Lantern Keeper Web', 'anime', [1]);
		link(s3, 1, 103);
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(s3);
		await rel.refreshRelations(ask, { now: NOW });
		const shown = rel.seasonsAroundOf(s4, false)!;
		expect(shown.before.map((h) => h.seriesId)).toEqual([null, s2, null]);
		const revealed = rel.seasonsAroundOf(s4, true)!;
		expect(revealed.before.map((h) => h.seriesId)).toEqual([null, s2, s3]);
	});

	it('draws nothing for an unlinked anime, a manga or a novel, and asks nothing for them', async () => {
		const anime = series('Lantern Keeper Season 4', 'anime', [4]);
		const manga = series('Lantern Keeper (manga)', 'manga');
		const novel = series('Lantern Keeper (novel)', 'novel');
		// A comic's link is series_links': its series has no season links to walk.
		db.prepare(
			`INSERT INTO series_links (series_id, anilist_id, via, linked_at) VALUES (?, 900, 'review', ?)`
		).run(manga, NOW);
		await rel.refreshRelations(ask, { now: NOW });
		expect(asked).toEqual([]);
		for (const id of [anime, manga, novel]) {
			expect(rel.seasonsAroundOf(id, true)).toBeNull();
			expect(rel.relationsStale(id, NOW)).toBe(false);
			expect(row(id)).toBeUndefined();
		}
	});

	it('names which entries it starts from when a series holds several seasons', async () => {
		// Seasons 2 and 3 here, both linked: back from season 2's entry, forward from season 3's.
		const s23 = series('Lantern Keeper 2 + 3', 'anime', [2, 3]);
		link(s23, 2, 102);
		link(s23, 3, 103);
		expect(rel.walkFrom(s23)).toEqual({ first: 102, last: 103, heldBefore: 0, heldAfter: 0 });
		await rel.refreshRelations(ask, { now: NOW });
		const around = rel.seasonsAroundOf(s23, false)!;
		expect(around.before.map((h) => [h.key, h.label])).toEqual([[101, 'SEASON 1']]);
		expect(around.next.key).toBe(104);
		// Seasons 3 and 4 held, only 4 linked: season 3 is the series' own.
		const s34 = series('Lantern Keeper 3 + 4', 'anime', [3, 4]);
		link(s34, 4, 104);
		expect(rel.walkFrom(s34)).toEqual({ first: 104, last: 104, heldBefore: 1, heldAfter: 0 });
		await rel.refreshRelations(ask, { now: NOW });
		expect(rel.seasonsAroundOf(s34, false)!.before.map((h) => h.key)).toEqual([101, 102]);
	});
});

describe('what makes the cache stale (c358)', () => {
	async function cachedS4() {
		const s4 = series('Lantern Keeper Season 4', 'anime', [4]);
		link(s4, 4, 104);
		await rel.refreshRelations(ask, { now: NOW });
		expect(rel.seasonsAroundOf(s4, false)).not.toBeNull();
		asked = [];
		return s4;
	}

	it('a relink to another show: nothing drawn until the next pass walks the new one', async () => {
		const s4 = await cachedS4();
		link(s4, 4, 202);
		// The graph can't answer for 202: the screen draws nothing rather than Lantern Keeper's.
		expect(rel.seasonsAroundOf(s4, false)).toBeNull();
		expect(rel.relationsStale(s4, NOW)).toBe(true);
		await rel.refreshRelations(ask, { now: NOW + 1 });
		const around = rel.seasonsAroundOf(s4, false)!;
		expect(around.before.map((h) => h.key)).toEqual([201]);
		expect(around.next).toMatchObject({ key: 0, query: 'Lantern Keeper' });
	});

	it('UNLINK: nothing drawn at once, and the next pass drops the graph', async () => {
		const s4 = await cachedS4();
		seasons.unlinkSeason(s4, 4, 1, NOW);
		expect(rel.seasonsAroundOf(s4, false)).toBeNull();
		const pass = await rel.refreshRelations(ask, { now: NOW + 1 });
		expect(pass.dropped).toBe(1);
		expect(row(s4)).toBeUndefined();
		expect(asked).toEqual([]);
	});

	it('a season linked on the same chain draws at once; one off the graph waits for the pass', async () => {
		const s4 = await cachedS4();
		// Season 3 held and linked now: the graph already holds 103's edges.
		db.prepare(
			`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url)
			VALUES (?, 9, 'Episode 1', 3, 1, ?, '', 0, 0, 0, '/s3/1')`
		).run(s4, NOW);
		link(s4, 3, 103);
		const around = rel.seasonsAroundOf(s4, false)!;
		expect(around.before.map((h) => h.key)).toEqual([101, 102]);
		expect(rel.relationsStale(s4, NOW)).toBe(false);
		// Season 5 linked to the announced entry, whose edges were never asked.
		db.prepare(
			`INSERT INTO entries (series_id, position, label, season, episode_number, added_at, file, bytes, page_count, available, source_url)
			VALUES (?, 10, 'Episode 1', 5, 1, ?, '', 0, 0, 0, '/s5/1')`
		).run(s4, NOW);
		link(s4, 5, 105);
		expect(rel.seasonsAroundOf(s4, false)).toBeNull();
		expect(rel.relationsStale(s4, NOW)).toBe(true);
		await rel.refreshRelations(ask, { now: NOW + 1 });
		// The loop: S5's SEQUEL is S1, which the walk has met; no season after.
		expect(rel.seasonsAroundOf(s4, false)!.next).toMatchObject({ key: 0 });
	});

	it('the series deleted: its graph goes with it', async () => {
		const s4 = await cachedS4();
		await deleteSeries([s4], true, NOW);
		made.splice(made.indexOf(s4), 1);
		expect(row(s4)).toBeUndefined();
	});

	it('a MOVE keeps the series, its links and its graph: nothing stale', async () => {
		const s4 = await cachedS4();
		const before = rel.seasonsAroundOf(s4, false);
		// What MOVE writes (doc/MOVE.md, "The move"): a new key and source, the
		// same series row, its links untouched. FIND reads the source at load.
		db.prepare(
			`UPDATE series SET origin_key = 'aniyomi:9001:/lantern', source = 'AnimePahe' WHERE id = ?`
		).run(s4);
		expect(rel.seasonsAroundOf(s4, false)).toEqual(before);
		expect(rel.relationsStale(s4, NOW)).toBe(false);
	});

	it('a refresh that fails keeps the old graph, and moves only when it was tried', async () => {
		const s4 = await cachedS4();
		const was = row(s4)!;
		const before = rel.seasonsAroundOf(s4, false);
		failing.add(103);
		const later = NOW + rel.RELATIONS_STALE_MS;
		expect(rel.relationsStale(s4, later)).toBe(true);
		const pass = await rel.refreshRelations(ask, { now: later });
		expect(pass).toMatchObject({ refreshed: 0, failed: 1 });
		expect(row(s4)).toEqual({ graph: was.graph, fetched_at: NOW, tried_at: later });
		expect(rel.seasonsAroundOf(s4, false)).toEqual(before);
		// AniList unreachable: the pass stops, and the graph stays as it was.
		process.env.TSUNDOKU_ANILIST = 'off';
		try {
			const r = await cat.refreshLinks({ limit: 0, now: later + 1 });
			expect(r.unreachable).toBe(true);
		} finally {
			delete process.env.TSUNDOKU_ANILIST;
		}
		expect(row(s4)!.graph).toBe(was.graph);
	});

	it('an entry AniList answers nothing for is no graph either: the old one stays', async () => {
		const s4 = await cachedS4();
		const was = row(s4)!.graph;
		world.delete(102);
		const pass = await rel.refreshRelations(ask, { now: NOW + rel.RELATIONS_STALE_MS });
		expect(pass.failed).toBe(1);
		expect(row(s4)!.graph).toBe(was);
	});

	it('grown old, it is walked again, and AniList’s news shows', async () => {
		const s4 = await cachedS4();
		world.get(105)!.status = 'RELEASING';
		world.get(105)!.episodes = 13;
		const later = NOW + rel.RELATIONS_STALE_MS;
		expect(rel.relationsStale(s4, later - 1)).toBe(false);
		expect(rel.relationsStale(s4, later)).toBe(true);
		await rel.refreshRelations(ask, { now: later });
		expect(rel.seasonsAroundOf(s4, false)!.next.facts).toEqual(['AIRING', '13 EP']);
	});

	it('links moved while AniList answered: the graph is not stored for links it can’t answer for', async () => {
		const s4 = series('Lantern Keeper Season 4', 'anime', [4]);
		link(s4, 4, 104);
		let once = false;
		const relinking: typeof ask = async (q, v) => {
			if (!once) {
				once = true;
				link(s4, 4, 202);
			}
			return answer(q, v);
		};
		const pass = await rel.refreshRelations(relinking, { now: NOW });
		expect(pass).toMatchObject({ refreshed: 0, failed: 1 });
		expect(row(s4)).toEqual({ graph: null, fetched_at: null, tried_at: NOW });
		expect(rel.seasonsAroundOf(s4, false)).toBeNull();
	});

	it('asks for the never-tried first, up to the limit, then the longest since tried', async () => {
		const a = series('Lantern A', 'anime', [4]);
		link(a, 4, 104);
		const b = series('Shore B', 'anime', [2]);
		link(b, 2, 202);
		failing.add(104);
		await rel.refreshRelations(ask, { now: NOW, limit: 1 });
		// One series asked, the lower id: it failed, so it was tried.
		expect(row(a)).toMatchObject({ graph: null, tried_at: NOW });
		expect(row(b)).toBeUndefined();
		failing.clear();
		await rel.refreshRelations(ask, { now: NOW + 1, limit: 1 });
		// The never-tried goes before the one that failed.
		expect(row(b)).toMatchObject({ fetched_at: NOW + 1 });
		expect(row(a)).toMatchObject({ graph: null });
	});
});
