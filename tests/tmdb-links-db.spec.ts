import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { setTmdbFetch } = await import('$lib/server/tmdb');
const links = await import('$lib/server/tmdb-links');
const { linkCover, linkState, refreshLinks, setAnilistFetch } =
	await import('$lib/server/catalogue');

/**
 * TMDB links (doc/LINKS.md, "TMDB links"): the AniList link's rules
 * in TMDB's terms. No network: TMDB is a stub that answers by path, and
 * AniList refuses, as it does for every spec.
 */

const db = getDb();
const NOW = Date.UTC(2026, 10, 12);
db.prepare(
	`INSERT INTO roots (id, name, path, hidden) VALUES (901, 'Aniyomi', '/tmdb-links', 0)`
).run();

const add = (title: string, kind: 'movie' | 'show' | 'manga' = 'movie', hidden = 0) =>
	Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, hidden, in_library) VALUES (901, ?, ?, 1, ?, 1)`
			)
			.run(title, kind, hidden).lastInsertRowid
	);

type Hit = {
	id: number;
	title?: string;
	name?: string;
	release_date?: string;
	first_air_date?: string;
	runtime?: number;
	number_of_seasons?: number;
	belongs_to_collection?: { id: number; name: string } | null;
	poster_path?: string;
};

/** What the fake TMDB holds: searches by query, details by id. */
let searches: Record<string, Hit[]> = {};
let details: Record<number, Hit> = {};
const asked: URL[] = [];

beforeEach(() => {
	process.env.TMDB_API_KEY = 'k';
	delete process.env.TMDB_API_RC_TOKEN;
	searches = {};
	details = {};
	asked.length = 0;
	setAnilistFetch((async () => new Response('{}', { status: 503 })) as unknown as typeof fetch);
	setTmdbFetch((async (url: URL) => {
		asked.push(url);
		const m = /\/(movie|tv)\/(\d+)$/.exec(url.pathname);
		if (m) {
			const d = details[Number(m[2])];
			return new Response(JSON.stringify(d ?? {}), { status: d ? 200 : 404 });
		}
		const q = url.searchParams.get('query') ?? '';
		const year = url.searchParams.get('year') ?? url.searchParams.get('first_air_date_year');
		const hits = (searches[q] ?? []).filter(
			(h) => !year || (h.release_date ?? h.first_air_date ?? '').startsWith(year)
		);
		return new Response(JSON.stringify({ results: hits }), { status: 200 });
	}) as unknown as typeof fetch);
});

afterEach(() => {
	setTmdbFetch(null);
	setAnilistFetch(null);
	delete process.env.TMDB_API_KEY;
});

const film = (id: number, title: string, year: number, more: Partial<Hit> = {}): Hit => ({
	id,
	title,
	release_date: `${year}-05-01`,
	...more
});

describe('the pass', () => {
	it('links one equal title, read by id for its runtime and collection', async () => {
		const id = add('The Long Ferry [Hindi-English] 1080p WEB-DL');
		searches['The Long Ferry'] = [film(11, 'The Long Ferry', 2024)];
		details[11] = film(11, 'The Long Ferry', 2024, {
			runtime: 118,
			belongs_to_collection: { id: 5, name: 'Ferry Collection' }
		});
		const r = await links.tmdbPass({ now: NOW });
		expect(r.linked).toBeGreaterThanOrEqual(1);
		const s = links.tmdbLinkState(id)!;
		expect(s.linked).toMatchObject({
			tmdbId: 11,
			via: 'exact',
			runtime: 118,
			collection: { id: 5, name: 'Ferry Collection' }
		});
		expect(links.tmdbQueue(false).some((x) => x.seriesId === id)).toBe(false);
	});

	it('tells a remake from the original by the year the source named', async () => {
		const id = add('Solaris (2002)');
		searches['Solaris'] = [film(21, 'Solaris', 1972), film(22, 'Solaris', 2002)];
		details[22] = film(22, 'Solaris', 2002);
		await links.tmdbPass({ now: NOW });
		expect(links.tmdbLinkState(id)!.linked?.tmdbId).toBe(22);
	});

	it('offers two equal titles with no year, and links neither', async () => {
		const id = add('Nosferatu');
		searches['Nosferatu'] = [film(31, 'Nosferatu', 1922), film(32, 'Nosferatu', 2024)];
		await links.tmdbPass({ now: NOW });
		const s = links.tmdbLinkState(id)!;
		expect(s.linked).toBeNull();
		expect(s.candidates).toBe(2);
		const item = links.tmdbQueue(false).find((x) => x.seriesId === id)!;
		expect(item.candidates.map((c) => c.tmdbId)).toEqual([31, 32]);
		expect(item.candidates[0].rows.map((r) => r.label)).toEqual(['FORMAT', 'YEAR', 'RUNTIME']);
	});

	it('searches a show as TMDB tv, and links the whole show once', async () => {
		const id = add('Alchemy of Souls S2 720p ESub', 'show');
		searches['Alchemy of Souls'] = [
			{ id: 41, name: 'Alchemy of Souls', first_air_date: '2022-06-18' }
		];
		details[41] = {
			id: 41,
			name: 'Alchemy of Souls',
			first_air_date: '2022-06-18',
			number_of_seasons: 2
		};
		await links.tmdbPass({ now: NOW });
		expect(asked.some((u) => u.pathname.endsWith('/search/tv'))).toBe(true);
		expect(links.tmdbLinkState(id)!.linked).toMatchObject({ tmdbId: 41, media: 'tv', seasons: 2 });
	});

	it('never searches a hidden film, nor a comic', async () => {
		const hidden = add('Hidden Film', 'movie', 1);
		const comic = add('A Comic', 'manga');
		searches['Hidden Film'] = [film(51, 'Hidden Film', 2020)];
		await links.tmdbPass({ now: NOW });
		expect(asked.some((u) => u.searchParams.get('query') === 'Hidden Film')).toBe(false);
		expect(asked.some((u) => u.searchParams.get('query') === 'A Comic')).toBe(false);
		expect(links.tmdbLinkState(hidden)!.searched).toBe(false);
		expect(links.tmdbLinkState(comic)).toBeNull();
	});

	it('runs inside refreshLinks even when AniList is out of reach', async () => {
		const id = add('Paper Moons');
		searches['Paper Moons'] = [film(61, 'Paper Moons', 2019)];
		details[61] = film(61, 'Paper Moons', 2019);
		// AniList answers 503 here: its failure still reaches the caller, after TMDB ran.
		await expect(refreshLinks({ now: NOW })).rejects.toThrow(/AniList 503/);
		expect(links.tmdbLinkState(id)!.linked?.tmdbId).toBe(61);
	});
});

describe('no key', () => {
	it('is a state: nothing searched, nothing marked, and the key later backfills', async () => {
		delete process.env.TMDB_API_KEY;
		const id = add('Quiet Harbour');
		searches['Quiet Harbour'] = [film(71, 'Quiet Harbour', 2021)];
		details[71] = film(71, 'Quiet Harbour', 2021);
		expect(await links.tmdbPass({ now: NOW })).toEqual({ searched: 0, linked: 0, offered: 0 });
		expect(asked).toHaveLength(0);
		expect(links.tmdbLinkState(id)).toMatchObject({
			configured: false,
			searched: false,
			linked: null
		});
		expect(links.tmdbQueueCount(true)).toBe(0);
		process.env.TMDB_API_KEY = 'k';
		await links.tmdbPass({ now: NOW });
		expect(links.tmdbLinkState(id)!.linked?.tmdbId).toBe(71);
	});
});

describe('the owner’s decisions', () => {
	it('LINK from the review, then UNDO puts back what stood', async () => {
		const id = add('Twin Lakes');
		searches['Twin Lakes'] = [film(81, 'Twin Lakes', 1990), film(82, 'Twin Lakes', 2011)];
		details[82] = film(82, 'Twin Lakes', 2011);
		await links.tmdbPass({ now: NOW });
		const before = await links.tmdbLink(id, 82, 'review', NOW);
		expect(links.tmdbLinkState(id)!.linked).toMatchObject({ tmdbId: 82, via: 'review' });
		links.tmdbUndo(id, before);
		expect(links.tmdbLinkState(id)!.linked).toBeNull();
		expect(links.tmdbQueue(false).some((x) => x.seriesId === id)).toBe(true);
	});

	it('NONE OF THESE leaves the queue, and no pass asks again', async () => {
		const id = add('Glass Orchard');
		searches['Glass Orchard'] = [film(91, 'Glass Orchards', 2000)];
		await links.tmdbPass({ now: NOW });
		const before = links.tmdbNone(id, NOW);
		expect(links.tmdbLinkState(id)!.decision).toBe('none');
		expect(links.tmdbQueue(false).some((x) => x.seriesId === id)).toBe(false);
		asked.length = 0;
		await links.tmdbPass({ now: NOW });
		expect(asked.some((u) => u.searchParams.get('query') === 'Glass Orchard')).toBe(false);
		links.tmdbUndo(id, before);
		expect(links.tmdbLinkState(id)!.decision).toBeNull();
	});

	it('UNLINK takes the link and keeps every pass from making it again', async () => {
		const id = add('Salt Road');
		searches['Salt Road'] = [film(101, 'Salt Road', 2015)];
		details[101] = film(101, 'Salt Road', 2015);
		await links.tmdbPass({ now: NOW });
		const before = links.tmdbUnlink(id, NOW);
		expect(links.tmdbLinkState(id)).toMatchObject({ linked: null, decision: 'unlinked' });
		await links.tmdbPass({ now: NOW });
		expect(links.tmdbLinkState(id)!.linked).toBeNull();
		links.tmdbUndo(id, before);
		expect(links.tmdbLinkState(id)!.linked?.tmdbId).toBe(101);
	});

	it('SEARCH AGAIN with the owner’s words stores what it found, and never links by itself', async () => {
		const id = add('Untitled Rip 1080p');
		searches['Untitled Rip'] = [];
		await links.tmdbPass({ now: NOW });
		searches['The Real Name'] = [film(111, 'The Real Name', 2018)];
		expect(await links.tmdbSearchNow(id, 'The Real Name', NOW)).toBe(1);
		expect(links.tmdbLinkState(id)).toMatchObject({ linked: null, candidates: 1 });
	});

	it('a pasted id that TMDB lacks refuses, and writes nothing', async () => {
		const id = add('Nowhere Film');
		await expect(links.tmdbLink(id, 999999, 'pasted', NOW)).rejects.toThrow(/no such TMDB/);
		expect(links.tmdbLinkState(id)!.linked).toBeNull();
	});
});

describe('AniList’s line', () => {
	it('is never drawn for a film: linkState answers null, tmdbLinkState answers', () => {
		const id = add('Only TMDB');
		expect(linkState(id)).toBeNull();
		expect(links.tmdbLinkState(id)).not.toBeNull();
	});
});

describe('the review', () => {
	it('draws a film’s item in the page’s shape, its rows and searched line its own', async () => {
		const id = add('Tide Line (2021) 1080p');
		searches['Tide Line'] = [film(121, 'Tide Line', 2021), film(122, 'Tide Lines', 2021)];
		await links.tmdbPass({ now: NOW });
		const item = links.tmdbReviewItem(id)!;
		expect(item).toMatchObject({ service: 'tmdb', query: 'Tide Line', year: 2021, found: 2 });
		expect(item.rows.map((r) => r.label)).toEqual(['SOURCE', 'FILE', 'YEAR']);
		expect(item.searchedLine).toBe(
			'SEARCHED TMDB FOR “Tide Line” · 2021 · 2 FOUND · TAP ONE TO LINK'
		);
		expect(item.candidates.map((c) => [c.key, c.exact, c.href])).toEqual([
			['tmdb:121', true, 'https://www.themoviedb.org/movie/121'],
			['tmdb:122', false, 'https://www.themoviedb.org/movie/122']
		]);
	});

	it('remembers what a decision replaced, so UNDO alone takes it back', async () => {
		const id = add('Ember Coast');
		searches['Ember Coast'] = [film(131, 'Ember Coast', 1999), film(132, 'Ember Coast', 2019)];
		details[132] = film(132, 'Ember Coast', 2019);
		await links.tmdbPass({ now: NOW });
		expect(await links.tmdbLinkFromReview(id, 132, 'review')).toBe('Ember Coast');
		expect(links.tmdbUndoLast(id)).toBe(true);
		expect(links.tmdbLinkState(id)!.linked).toBeNull();
		expect(links.tmdbUndoLast(id)).toBe(false);
		searches['Ember'] = [];
		await links.tmdbSearchAgain(id, 'Ember');
		expect(links.tmdbLinkState(id)!.candidates).toBe(0);
		expect(links.tmdbUndoSearch(id)).toBe(true);
		expect(links.tmdbLinkState(id)!.candidates).toBe(2);
	});

	it('reads a pasted link by id, and refuses a show’s link on a film', async () => {
		const id = add('Paste Me');
		details[141] = film(141, 'Paste Me', 2010);
		expect((await links.tmdbPastedCandidate(id, { media: 'movie', id: 141 }))?.key).toBe(
			'tmdb:141'
		);
		await expect(links.tmdbPastedCandidate(id, { media: 'tv', id: 141 })).rejects.toThrow(
			/wrong kind/
		);
	});

	it('counts and lists the waiting ones only with a key', async () => {
		const id = add('Count Me');
		searches['Count Me'] = [film(151, 'Count Mee', 2001)];
		await links.tmdbPass({ now: NOW });
		expect(links.tmdbQueue(false).some((x) => x.seriesId === id)).toBe(true);
		const n = links.tmdbQueueCount(false);
		delete process.env.TMDB_API_KEY;
		expect(links.tmdbQueueCount(false)).toBe(0);
		expect(links.tmdbQueue(false)).toEqual([]);
		process.env.TMDB_API_KEY = 'k';
		expect(links.tmdbQueueCount(false)).toBe(n);
	});
});

describe('the poster as a cover', () => {
	it('is a linked film’s link cover, named for TMDB, and none without a poster', async () => {
		const id = add('Poster Film');
		searches['Poster Film'] = [film(161, 'Poster Film', 2012)];
		details[161] = { ...film(161, 'Poster Film', 2012), poster_path: '/p.jpg' } as Hit;
		expect(linkCover(id)).toBeNull();
		await links.tmdbPass({ now: NOW });
		expect(linkCover(id)).toEqual({
			provider: 'tmdb',
			id: 161,
			url: 'https://image.tmdb.org/t/p/w500/p.jpg'
		});
		const bare = add('Bare Film');
		searches['Bare Film'] = [film(171, 'Bare Film', 2013)];
		details[171] = film(171, 'Bare Film', 2013);
		await links.tmdbPass({ now: NOW });
		expect(links.tmdbLinkState(bare)!.linked?.tmdbId).toBe(171);
		expect(linkCover(bare)).toBeNull();
	});
});
