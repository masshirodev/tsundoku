import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { setTmdbFetch, tmdbCollection, tmdbShowFacts } = await import('$lib/server/tmdb');
const sur = await import('$lib/server/tmdb-surround');

/**
 * What surrounds a film or a show, the workstation's half (card c990): the
 * cache is filled by id alone, read without waiting on TMDB, and the library
 * is read as the viewer may see it. TMDB is a stub answering by path.
 */

const db = getDb();
const NOW = Date.UTC(2026, 10, 12);
db.prepare(
	`INSERT INTO roots (id, name, path, hidden) VALUES (902, 'Aniyomi', '/tmdb-surround', 0)`
).run();

const add = (title: string, kind: 'movie' | 'show', hidden = 0) =>
	Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, hidden, in_library) VALUES (902, ?, ?, 1, ?, 1)`
			)
			.run(title, kind, hidden).lastInsertRowid
	);

const link = (
	seriesId: number,
	tmdbId: number,
	media: 'movie' | 'tv',
	collection: number | null = null
) =>
	db
		.prepare(
			`INSERT INTO series_tmdb_links (series_id, tmdb_id, media, via, title, collection_id, collection_name, linked_at)
			VALUES (?, ?, ?, 'exact', ?, ?, ?, 1)`
		)
		.run(
			seriesId,
			tmdbId,
			media,
			media === 'tv' ? 'Harbour Lights' : `Film ${tmdbId}`,
			collection,
			collection ? 'C' : ''
		);

const answers: Record<string, unknown> = {};
const asked: string[] = [];

beforeEach(() => {
	process.env.TMDB_API_KEY = 'k';
	asked.length = 0;
	setTmdbFetch((async (url: URL) => {
		asked.push(url.pathname);
		const body = answers[url.pathname];
		return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
	}) as unknown as typeof fetch);
});
afterEach(() => {
	setTmdbFetch(null);
	delete process.env.TMDB_API_KEY;
});

answers['/3/collection/500'] = {
	id: 500,
	name: 'The Long Ferry Collection',
	parts: [
		{ id: 13, title: 'The Long Ferry: Ash', release_date: '2026-06-01' },
		{ id: 11, title: 'The Long Ferry', release_date: '2024-03-01' },
		{ id: 12, title: 'The Long Ferry: Wake', release_date: '2025-04-01' }
	]
};
answers['/3/tv/77'] = {
	id: 77,
	in_production: true,
	seasons: [
		{ season_number: 0, episode_count: 2, air_date: '2021-12-01', name: 'Specials' },
		{ season_number: 1, episode_count: 10, air_date: '2022-01-01', name: 'Season 1' },
		{ season_number: 2, episode_count: 8, air_date: '2023-01-01', name: 'Season 2' },
		{ season_number: 3, episode_count: 8, air_date: '2026-11-03', name: 'Season 3' }
	],
	next_episode_to_air: { season_number: 3, episode_number: 2, air_date: '2026-11-17' }
};

describe('the client', () => {
	it('reads a collection in release order, and a show without its specials', async () => {
		process.env.TMDB_API_URL = 'https://api.themoviedb.org/3';
		const c = await tmdbCollection(500);
		expect(c?.parts.map((p) => p.id)).toEqual([11, 12, 13]);
		const s = await tmdbShowFacts(77);
		expect(s?.seasons.map((x) => x.season)).toEqual([1, 2, 3]);
		expect(s?.next).toEqual({ season: 3, episode: 2, airDate: '2026-11-17' });
		delete process.env.TMDB_API_URL;
	});
});

describe('the cache', () => {
	it('fills by id only, and asks again only when stale', async () => {
		const a = add('The Long Ferry', 'movie');
		link(a, 11, 'movie', 500);
		const b = add('Harbour Lights Season 2', 'show');
		link(b, 77, 'tv');
		expect(await sur.refreshSurroundings({ now: NOW })).toBe(2);
		expect(asked.every((u) => !u.includes('/search/'))).toBe(true);
		expect(asked.sort()).toEqual(['/3/collection/500', '/3/tv/77']);
		asked.length = 0;
		expect(await sur.refreshSurroundings({ now: NOW + 60_000 })).toBe(0);
		// The show is still airing: a day on, it is asked again; the collection is not.
		expect(await sur.refreshSurroundings({ now: NOW + sur.AIRING_MS })).toBe(1);
		expect(asked).toEqual(['/3/tv/77']);
	});

	it('asks nothing without a key', async () => {
		delete process.env.TMDB_API_KEY;
		expect(await sur.refreshSurroundings({ now: NOW + sur.SETTLED_MS * 2 })).toBe(0);
		expect(asked).toHaveLength(0);
	});
});

describe('what a series sees', () => {
	it('a film’s collection, with a hidden part not in the library while reveal is off', async () => {
		const wake = add('The Long Ferry: Wake', 'movie', 1);
		link(wake, 12, 'movie', 500);
		const ferry = (
			db.prepare(`SELECT series_id FROM series_tmdb_links WHERE tmdb_id = 11`).get() as {
				series_id: number;
			}
		).series_id;
		const off = sur.surroundingsOf(ferry, false, NOW);
		expect(off?.kind).toBe('collection');
		if (off?.kind !== 'collection' || off.view.mode !== 'parts') throw new Error('parts');
		expect(off.view.foot.words).toBe('1 OF 3 IN THE LIBRARY');
		const on = sur.surroundingsOf(ferry, true, NOW);
		if (on?.kind !== 'collection' || on.view.mode !== 'parts') throw new Error('parts');
		expect(on.view.foot).toEqual({ words: '2 OF 3 IN THE LIBRARY · NOT A WORK', group: true });
	});

	it('a show’s seasons from the other series linked to it, and NOT THIS stays said', async () => {
		const s1 = add('Harbour Lights', 'show');
		link(s1, 77, 'tv');
		const s2 = (
			db
				.prepare(`SELECT series_id FROM series_tmdb_links WHERE tmdb_id = 77 AND series_id != ?`)
				.get(s1) as { series_id: number }
		).series_id;
		const v = sur.surroundingsOf(s2, false, NOW);
		if (v?.kind !== 'show') throw new Error('show');
		expect(v.view.heads.map((h) => [h.season, h.state])).toEqual([
			[1, 'library'],
			[2, 'this'],
			[3, 'missing']
		]);
		expect(v.view.band?.season).toBe(3);
		sur.declineOffer(s2, 'season:3', NOW);
		const after = sur.surroundingsOf(s2, false, NOW);
		expect(after?.kind === 'show' && after.view.band).toBeNull();
		expect(sur.undoDecline(s2, 'season:3')).toBe(true);
	});

	it('draws nothing for an entry not cached yet, and nothing for a film outside a collection', () => {
		const solo = add('Solo Film', 'movie');
		link(solo, 900, 'movie');
		expect(sur.surroundingsOf(solo, false, NOW)).toBeNull();
		const unasked = add('Unasked Show', 'show');
		link(unasked, 901, 'tv');
		expect(sur.surroundingsOf(unasked, false, NOW)).toBeNull();
	});
});
