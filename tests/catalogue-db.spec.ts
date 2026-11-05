import { beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const cat = await import('$lib/server/catalogue');
const seasons = await import('$lib/server/season-links');

const db = getDb();
const NOW = Date.UTC(2026, 8, 24);
seedSample(db, NOW);

const idOf = (title: string) =>
	(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
const ratingOf = (id: number) =>
	(db.prepare(`SELECT rating FROM series WHERE id = ?`).get(id) as { rating: number }).rating;
/**
 * The row that holds a series' link, wherever its kind puts it: `series_links`
 * for a comic or a novel, `series_season_links` for an anime, whose link is
 * one season's (c240).
 */
const linkRow = (id: number) =>
	(db.prepare(`SELECT * FROM series_links WHERE series_id = ?`).get(id) ??
		db
			.prepare(
				`SELECT * FROM series_season_links WHERE series_id = ? ORDER BY season, part LIMIT 1`
			)
			.get(id)) as Record<string, unknown> | undefined;

/** An AniList entry as the API sends it. */
const media = (o: {
	id: number;
	idMal?: number | null;
	english?: string | null;
	romaji?: string;
	format?: string;
	country?: string;
	chapters?: number | null;
	episodes?: number | null;
	season?: string | null;
	seasonYear?: number | null;
	year?: number;
}) => ({
	id: o.id,
	idMal: o.idMal ?? null,
	format: o.format ?? 'MANGA',
	countryOfOrigin: o.country ?? 'KR',
	status: 'RELEASING',
	chapters: o.chapters ?? null,
	volumes: null,
	episodes: o.episodes ?? null,
	season: o.season ?? null,
	seasonYear: o.seasonYear ?? null,
	synonyms: [],
	title: { romaji: o.romaji ?? `Romaji ${o.id}`, english: o.english ?? null, native: null },
	startDate: { year: o.year ?? 2021 },
	coverImage: { extraLarge: `https://s4.anilist.co/cover/${o.id}.jpg`, large: null }
});

/** An anime entry: AniList's other catalogue. */
const anime = (o: {
	id: number;
	idMal?: number | null;
	english: string;
	year?: number;
	episodes?: number;
}) =>
	media({
		...o,
		format: 'TV',
		country: 'JP',
		chapters: null,
		episodes: o.episodes ?? 24,
		season: 'FALL',
		seasonYear: o.year ?? 2024,
		year: o.year ?? 2024
	});

/** What the fake AniList holds, by id, and what each search finds. */
let entries: ReturnType<typeof media>[] = [];
let searches: Record<string, ReturnType<typeof media>[]> = {};
const asked: string[] = [];
const formatsAsked: string[] = [];
const queriesAsked: string[] = [];
/** AniList should never send one kind's entries for another's search; a test can
 * make it leak, to prove the client's own kind rule as a second belt (c298). */
let leakFormats = false;

const fake: typeof fetch = async (_url, init) => {
	const { query, variables } = JSON.parse(String(init?.body)) as {
		query: string;
		variables: Record<string, unknown>;
	};
	asked.push(query.includes('search:') ? 'search' : 'ids');
	queriesAsked.push(query);
	const reply = (data: unknown) =>
		new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
	if (query.includes('idMal_in')) {
		const ids = variables.ids as number[];
		const type = /type: (ANIME|MANGA)/.exec(query)?.[1] ?? 'MANGA';
		return reply({
			Page: {
				media: entries.filter(
					(m) => ids.includes(m.idMal ?? -1) && (m.format === 'TV') === (type === 'ANIME')
				)
			}
		});
	}
	if (query.includes('id_in')) {
		const ids = variables.ids as number[];
		const type = /type: (ANIME|MANGA)/.exec(query)?.[1] ?? 'MANGA';
		return reply({
			Page: {
				media: entries.filter(
					(m) => ids.includes(m.id) && (m.format === 'TV') === (type === 'ANIME')
				)
			}
		});
	}
	const out: Record<string, unknown> = {};
	for (const [k, q] of Object.entries(variables)) {
		if (!k.startsWith('q')) continue;
		const formats = variables[k.replace('q', 'f')] as string[];
		formatsAsked.push(formats.join(','));
		out[k.replace('q', 's')] = {
			media: (searches[q as string] ?? []).filter((m) => leakFormats || formats.includes(m.format))
		};
	}
	return reply(out);
};

beforeEach(() => {
	cat.setAnilistFetch(fake);
	entries = [];
	searches = {};
	asked.length = 0;
	formatsAsked.length = 0;
	queriesAsked.length = 0;
	leakFormats = false;
	delete process.env.TSUNDOKU_ANILIST;
	for (const t of ['series_links', 'link_searches', 'link_candidates', 'link_decisions'])
		db.prepare(`DELETE FROM ${t}`).run();
});

/** An anime in the library, keyed as an Aniyomi ADD writes one; removed after its test. */
const animeSeries = (title: string) => {
	const root = (db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number })
		.id;
	const id = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, source, in_library)
				VALUES (?, ?, 'anime', ?, ?, 'KickAssAnime', 1)`
			)
			.run(root, title, NOW, `aniyomi:9000:/${title.replace(/\W+/g, '-').toLowerCase()}`)
			.lastInsertRowid
	);
	return id;
};
const forgetSerie = (id: number) => {
	db.prepare(`DELETE FROM series WHERE id = ?`).run(id);
};

describe('what the pass searches', () => {
	it('is manga, manhwa and novels in view: never a hidden series, a doujin or Hentoid’s', () => {
		const rows = cat.searchable(10_000);
		const kinds = new Set(rows.map((r) => r.kind));
		expect(kinds.has('doujin')).toBe(false);
		const hidden = db
			.prepare(
				`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id WHERE s.hidden = 1 OR (r.hidden = 1 AND s.public = 0)`
			)
			.all() as { id: number }[];
		const ids = new Set(rows.map((r) => r.id));
		for (const h of hidden) expect(ids.has(h.id)).toBe(false);
		expect(rows.length).toBeGreaterThan(3);
	});

	it('passes by what’s linked, settled, or searched already', () => {
		const tog = idOf('Tower of God');
		expect(cat.searchable(10_000).some((r) => r.id === tog)).toBe(true);
		cat.noneOfThese(tog, NOW);
		expect(cat.searchable(10_000).some((r) => r.id === tog)).toBe(false);
	});

	it('puts a SEARCH AGAIN first, with the owner’s title', () => {
		const frieren = idOf('Sousou no Frieren');
		cat.queueSearch(frieren, 'Frieren: Beyond Journey’s End');
		const [first] = cat.searchable(3);
		expect(first).toMatchObject({ id: frieren, query: 'Frieren: Beyond Journey’s End' });
	});
});

describe('searching', () => {
	it('links an exact title at once, and offers the rest to the review', async () => {
		const tog = idOf('Tower of God');
		const hua = idOf('Return of the Mount Hua Sect');
		searches['Tower of God'] = [media({ id: 85143, idMal: 122663, english: 'Tower of God' })];
		searches['Return of the Mount Hua Sect'] = [
			media({ id: 1, english: 'Mount Hua Returns', chapters: 20 }),
			media({ id: 2, english: 'The Hua Sect Chronicle' })
		];
		const rows = cat.searchable(10_000).filter((r) => r.id === tog || r.id === hua);
		const r = await cat.searchSeries(rows, NOW);
		expect(r).toEqual({ linked: 1, offered: 1 });
		expect(linkRow(tog)).toMatchObject({ anilist_id: 85143, mal_id: 122663, via: 'exact' });
		const queue = cat.linkQueue(false);
		expect(queue.map((q) => q.seriesId)).toEqual([hua]);
		expect(queue[0].candidates.map((c) => c.anilistId)).toEqual([1, 2]);
		expect(queue[0].candidates[1].why).toContain('SHARES HUA · SECT');
		expect(cat.linkQueueCount(false)).toBe(1);
		// Both titles went in one request.
		expect(asked).toEqual(['search']);
	});

	it('asks for a comic’s formats for a comic and a novel’s for a novel: TBATE is both', async () => {
		const tog = idOf('Tower of God');
		const novel = idOf('Mushoku Tensei');
		const both = [
			media({ id: 1, english: 'Tower of God', format: 'NOVEL' }),
			media({ id: 2, english: 'Tower of God' })
		];
		searches['Tower of God'] = both;
		searches['Mushoku Tensei'] = [
			media({ id: 3, english: 'Mushoku Tensei' }),
			media({ id: 4, english: 'Mushoku Tensei', format: 'NOVEL' })
		];
		await cat.searchSeries(
			cat.searchable(10_000).filter((r) => r.id === tog || r.id === novel),
			NOW
		);
		expect(formatsAsked.sort()).toEqual(['MANGA,ONE_SHOT', 'NOVEL']);
		expect(linkRow(tog)).toMatchObject({ anilist_id: 2 });
		expect(linkRow(novel)).toMatchObject({ anilist_id: 4 });
	});

	it('cleans a title before searching, and falls back to the part before a subtitle', async () => {
		const tog = idOf('Tower of God');
		db.prepare(`UPDATE series SET title = 'Tower of God: Season 3 (Official)' WHERE id = ?`).run(
			tog
		);
		searches['Tower of God'] = [media({ id: 9, english: 'Tower of God' })];
		await cat.searchSeries(
			cat.searchable(10_000).filter((r) => r.id === tog),
			NOW
		);
		// Cleaned, the title is equal: a sure link.
		expect(linkRow(tog)).toMatchObject({ anilist_id: 9, via: 'exact' });
		db.prepare(`UPDATE series SET title = 'Tower of God' WHERE id = ?`).run(tog);
	});

	it('keeps a search that found nothing in the review, for SEARCH AGAIN or a link', async () => {
		const frieren = idOf('Sousou no Frieren');
		await cat.searchSeries(
			cat.searchable(10_000).filter((r) => r.id === frieren),
			NOW
		);
		const [item] = cat.linkQueue(false);
		expect(item).toMatchObject({ seriesId: frieren, found: 0, candidates: [] });
	});

	it('is no error when AniList can’t be reached: the next pass tries', async () => {
		process.env.TSUNDOKU_ANILIST = 'off';
		const r = await cat.refreshLinks({ now: NOW });
		expect(r.unreachable).toBe(true);
		expect(r.searched).toBe(0);
	});
});

describe('an anime', () => {
	it('is in the pass, and is searched in AniList’s anime catalogue with its own formats', async () => {
		const id = animeSeries('Trigun Stampede');
		try {
			expect(cat.searchable(10_000).some((r) => r.id === id)).toBe(true);
			searches['Trigun Stampede'] = [anime({ id: 155783, english: 'Trigun Stampede' })];
			const r = await cat.searchSeries(
				cat.searchable(10_000).filter((x) => x.id === id),
				NOW
			);
			expect(r).toEqual({ linked: 1, offered: 0 });
			expect(linkRow(id)).toMatchObject({ anilist_id: 155783, via: 'exact', format: 'TV' });
			expect(formatsAsked).toEqual(['TV,TV_SHORT,MOVIE,OVA,ONA,SPECIAL']);
			expect(queriesAsked.some((q) => q.includes('type: ANIME'))).toBe(true);
			expect(queriesAsked.some((q) => q.includes('type: MANGA'))).toBe(false);
		} finally {
			forgetSerie(id);
		}
	});

	it('never takes a manga’s exact title, even when the manga matches better', async () => {
		const id = animeSeries('Ranma ½ (2024)');
		try {
			// AniList holds the manga (MANGA) and the 2024 anime under one title,
			// the manga first and exactly the series' own. Alone, it links nothing
			// at all; beside the anime, the anime is the one (c298).
			// The catalogue answers with the manga though it asked for anime: the
			// client's own rule is the second belt, and it is what this pins.
			leakFormats = true;
			searches['Ranma ½'] = [media({ id: 30023, idMal: 23, english: 'Ranma ½', year: 2024 })];
			db.prepare(`UPDATE series SET title = 'Ranma ½ (2024)' WHERE id = ?`).run(id);
			const row = {
				id,
				title: 'Ranma ½ (2024)',
				alt_titles: '[]',
				kind: 'anime' as const,
				query: null
			};
			await cat.searchSeries([row], NOW);
			expect(linkRow(id)).toBeUndefined();
			// The same year on both, so only the kind can decide.
			searches['Ranma ½'] = [
				media({ id: 30023, idMal: 23, english: 'Ranma ½', year: 2024 }),
				anime({ id: 30024, idMal: 23, english: 'Ranma ½', year: 2024 })
			];
			const r = await cat.searchSeries([row], NOW);
			expect(r).toEqual({ linked: 1, offered: 0 });
			expect(linkRow(id)).toMatchObject({ anilist_id: 30024, mal_id: 23, format: 'TV' });
		} finally {
			forgetSerie(id);
		}
	});

	it('a search the owner runs offers even one equal result, and links nothing until LINK', async () => {
		const id = animeSeries('Ranma ½ (2024)');
		try {
			searches['Ranma ½'] = [anime({ id: 30024, idMal: 23, english: 'Ranma ½' })];
			const r = await cat.searchNow(id, 'Ranma ½', NOW);
			expect(r).toEqual({ outcome: 'found', found: 1 });
			expect(linkRow(id)).toBeUndefined();
			const item = cat.reviewItem(id, false)!;
			expect(item.candidates.map((c) => c.anilistId)).toEqual([30024]);
			expect(item.candidates[0].rows.map((x) => x.label)).toEqual([
				'FORMAT',
				'SEASON',
				'EPISODES',
				'STATUS'
			]);
			// LINK is the owner's press; UNDO of it puts the series back as it was.
			cat.link(id, cat.offered(id, 30024)!, 'review', NOW);
			expect(linkRow(id)).toMatchObject({ anilist_id: 30024, via: 'review' });
			expect(cat.undoLink(id)).toBe(true);
			expect(cat.reviewItem(id, false)!.candidates).toHaveLength(1);
		} finally {
			forgetSerie(id);
		}
	});

	it('flags a link to the other kind as wrong, and never unlinks it by itself', () => {
		const id = animeSeries('Ranma ½ (2024)');
		try {
			// The link c298 found live: the manga 30023 on the anime series.
			cat.link(
				id,
				{
					anilistId: 30023,
					malId: 23,
					title: 'Ranma ½',
					alts: [],
					format: 'MANGA',
					country: 'JP',
					year: 1989,
					chapters: 407,
					volumes: null,
					episodes: null,
					season: null,
					seasonYear: null,
					status: 'FINISHED',
					coverUrl: ''
				},
				'exact',
				NOW
			);
			expect(linkRow(id)).toBeDefined();
			expect(cat.linkState(id)?.linked).toMatchObject({
				wrongKind: true,
				coverOnly: false,
				// OPEN and the sheet follow the entry's own kind, not the series':
				// this is the manga 30023, so it opens anilist.co/manga/30023.
				kind: 'manga'
			});
			// A link of its own kind is not flagged.
			cat.link(
				id,
				{
					anilistId: 30024,
					malId: 23,
					title: 'Ranma ½',
					alts: [],
					format: 'TV',
					country: 'JP',
					year: 2024,
					chapters: null,
					volumes: null,
					episodes: 24,
					season: 'FALL',
					seasonYear: 2024,
					status: 'RELEASING',
					coverUrl: ''
				},
				'review',
				NOW
			);
			expect(cat.linkState(id)?.linked).toMatchObject({ wrongKind: false, kind: 'anime' });
		} finally {
			forgetSerie(id);
		}
	});

	it('resolves a MAL tracker in its own catalogue: an anime id is not a manga’s', async () => {
		const id = animeSeries('Trigun Stampede');
		try {
			cat.linkFromTracker(db, id, { id: 52093, score: 0 }, NOW);
			entries = [anime({ id: 155783, idMal: 52093, english: 'Trigun Stampede' })];
			expect(await cat.resolveLinks(NOW)).toBe(1);
			expect(linkRow(id)).toMatchObject({ anilist_id: 155783, title: 'Trigun Stampede' });
			expect(queriesAsked.some((q) => q.includes('type: ANIME'))).toBe(true);
		} finally {
			forgetSerie(id);
		}
	});

	it('resolves the same MAL id in each catalogue, never across them', async () => {
		const manga = idOf('Tower of God');
		const show = animeSeries('Ranma ½ (2024)');
		try {
			cat.linkFromTracker(db, manga, { id: 23, score: 0 }, NOW);
			cat.linkFromTracker(db, show, { id: 23, score: 0 }, NOW);
			entries = [
				media({ id: 30023, idMal: 23, english: 'Ranma ½' }),
				anime({ id: 30024, idMal: 23, english: 'Ranma ½' })
			];
			expect(await cat.resolveLinks(NOW)).toBe(2);
			expect(linkRow(manga)).toMatchObject({ anilist_id: 30023, mal_id: 23 });
			expect(linkRow(show)).toMatchObject({ anilist_id: 30024, mal_id: 23 });
		} finally {
			forgetSerie(show);
			cat.unlink(manga, NOW);
			db.prepare(`DELETE FROM link_decisions WHERE series_id = ?`).run(manga);
		}
	});
});

describe('the review', () => {
	const offer = async () => {
		const hua = idOf('Return of the Mount Hua Sect');
		searches['Return of the Mount Hua Sect'] = [
			media({ id: 1, idMal: 11, english: 'Mount Hua Returns' }),
			media({ id: 2, english: 'Another' })
		];
		await cat.searchSeries(
			cat.searchable(10_000).filter((r) => r.id === hua),
			NOW
		);
		return hua;
	};

	it('LINK takes it out of the queue; UNDO puts it back as it was', async () => {
		const hua = await offer();
		const c = cat.offered(hua, 1)!;
		cat.link(hua, c, 'review', NOW);
		expect(linkRow(hua)).toMatchObject({ anilist_id: 1, mal_id: 11, via: 'review' });
		expect(cat.linkQueue(false)).toEqual([]);
		expect(cat.undoLink(hua)).toBe(true);
		expect(cat.linkQueue(false)[0].candidates).toHaveLength(2);
	});

	it('NONE OF THESE doesn’t come back; its UNDO does', async () => {
		const hua = await offer();
		cat.noneOfThese(hua, NOW);
		expect(cat.linkQueueCount(false)).toBe(0);
		expect(cat.undoNone(hua)).toBe(true);
		expect(cat.linkQueueCount(false)).toBe(1);
	});

	it('SKIP sends it to the back', async () => {
		const hua = await offer();
		const frieren = idOf('Sousou no Frieren');
		await cat.searchSeries(
			cat.searchable(10_000).filter((r) => r.id === frieren),
			NOW
		);
		cat.skip(hua, NOW);
		expect(cat.linkQueue(false).map((q) => q.seriesId)).toEqual([frieren, hua]);
	});

	it('SEARCH AGAIN leaves the review until the next pass; UNDO puts it back', async () => {
		const hua = await offer();
		const was = cat.queueSearch(hua, 'Hwasan Gwihwan');
		expect(cat.linkQueueCount(false)).toBe(0);
		expect(cat.linkState(hua)).toMatchObject({ linked: null, queued: true });
		cat.unqueueSearch(hua, was);
		expect(cat.linkQueue(false)[0]).toMatchObject({
			seriesId: hua,
			query: 'Return of the Mount Hua Sect'
		});
		expect(cat.linkQueue(false)[0].candidates).toHaveLength(2);
		// Run, the search replaces what it found before.
		cat.queueSearch(hua, 'Hwasan Gwihwan');
		searches['Hwasan Gwihwan'] = [media({ id: 7, english: 'Return of the Blossoming Blade' })];
		await cat.searchSeries(cat.searchable(1), NOW);
		expect(cat.linkQueue(false)[0].candidates.map((c) => c.anilistId)).toEqual([7]);
	});

	it('a FIND on a series never searched undoes to never searched', () => {
		const frieren = idOf('Sousou no Frieren');
		const was = cat.queueSearch(frieren, 'Frieren');
		expect(was).toBeNull();
		cat.unqueueSearch(frieren, was);
		expect(
			db.prepare(`SELECT 1 FROM link_searches WHERE series_id = ?`).get(frieren)
		).toBeUndefined();
	});

	it('reads a pasted link by its id alone', async () => {
		entries = [media({ id: 171204, idMal: 160388, english: 'I Became the Sword Saint’s Son' })];
		expect((await cat.readPasted({ service: 'mal', id: 160388 }, 'manga')).anilistId).toBe(171204);
		expect((await cat.readPasted({ service: 'anilist', id: 171204 }, 'manga')).malId).toBe(160388);
		await expect(cat.readPasted({ service: 'anilist', id: 5 }, 'manga')).rejects.toThrow();
		expect(asked).toEqual(['ids', 'ids', 'ids']);
	});

	it('reads an anime’s MAL id in AniList’s anime catalogue, never the manga’s', async () => {
		entries = [
			anime({ id: 30024, idMal: 23, english: 'Ranma ½' }),
			media({ id: 30023, idMal: 23, english: 'Ranma ½' })
		];
		const c = await cat.readPasted({ service: 'mal', id: 23 }, 'anime');
		expect(c).toMatchObject({ anilistId: 30024, format: 'TV', episodes: 24, season: 'FALL' });
		expect(queriesAsked[0]).toContain('type: ANIME');
	});
});

describe('Mihon’s MAL tracker', () => {
	const tracked = (title: string) => {
		const id = idOf(title);
		db.prepare(`UPDATE series SET rating = 0 WHERE id = ?`).run(id);
		return id;
	};

	it('links at once, and an unrated series takes the score (c67: out of 10, as the score is)', () => {
		const id = tracked('Tower of God');
		cat.linkFromTracker(db, id, { id: 122663, score: 9 }, NOW);
		expect(linkRow(id)).toMatchObject({ mal_id: 122663, via: 'mihon', filled_rating: 9 });
		expect(ratingOf(id)).toBe(9);
		// Found again on the next import: nothing changes.
		cat.linkFromTracker(db, id, { id: 122663, score: 9 }, NOW + 1);
		expect(linkRow(id)).toMatchObject({ linked_at: NOW, filled_rating: 9 });
	});

	it('leaves a rated series’ rating alone', () => {
		const id = idOf('Tower of God');
		db.prepare(`UPDATE series SET rating = 2 WHERE id = ?`).run(id);
		cat.linkFromTracker(db, id, { id: 122663, score: 10 }, NOW);
		expect(ratingOf(id)).toBe(2);
		expect(linkRow(id)).toMatchObject({ filled_rating: null });
	});

	it('never brings back a link the owner unlinked, nor replaces one they chose', () => {
		const id = tracked('Tower of God');
		cat.unlink(id, NOW);
		cat.linkFromTracker(db, id, { id: 122663, score: 9 }, NOW);
		expect(linkRow(id)).toBeUndefined();
		db.prepare(`DELETE FROM link_decisions`).run();
		cat.link(
			id,
			{
				anilistId: 9,
				malId: 99,
				title: 'Chosen',
				alts: [],
				format: 'MANGA',
				country: 'KR',
				year: null,
				chapters: null,
				volumes: null,
				episodes: null,
				season: null,
				seasonYear: null,
				status: '',
				coverUrl: ''
			},
			'pasted',
			NOW
		);
		cat.linkFromTracker(db, id, { id: 122663, score: 9 }, NOW);
		expect(linkRow(id)).toMatchObject({ mal_id: 99, via: 'pasted' });
	});

	it('learns the AniList entry and its cover, sending the MAL id only', async () => {
		const id = tracked('Tower of God');
		cat.linkFromTracker(db, id, { id: 122663, score: 0 }, NOW);
		entries = [media({ id: 85143, idMal: 122663, english: 'Tower of God' })];
		expect(await cat.resolveLinks(NOW)).toBe(1);
		expect(linkRow(id)).toMatchObject({
			anilist_id: 85143,
			title: 'Tower of God',
			cover_url: 'https://s4.anilist.co/cover/85143.jpg',
			resolved_at: NOW
		});
		expect(cat.linkCover(id)).toEqual({
			anilistId: 85143,
			url: 'https://s4.anilist.co/cover/85143.jpg'
		});
		expect(cat.linkState(id)?.linked).toMatchObject({
			ids: 'ANILIST 85143 · MAL 122663',
			via: 'mihon',
			resolving: false
		});
	});

	it('drops the old entry’s format when the tracker moves, so the resolve refills it (c298)', async () => {
		const id = idOf('Tower of God');
		// A link the tracker made whose resolve left the wrong kind's format:
		// this branch now trusts `format` for the send guard, the MAL list and
		// the wrong-kind flag, so a stale one must not outlive the move.
		db.prepare(
			`INSERT INTO series_links (series_id, mal_id, via, linked_at, resolved_at, format)
			VALUES (?, 1000, 'mihon', ?, ?, 'TV')`
		).run(id, NOW, NOW);
		cat.linkFromTracker(db, id, { id: 122663, score: 0 }, NOW);
		expect(linkRow(id)).toMatchObject({
			mal_id: 122663,
			anilist_id: null,
			format: null,
			resolved_at: null
		});
		entries = [media({ id: 85143, idMal: 122663, english: 'Tower of God' })];
		expect(await cat.resolveLinks(NOW)).toBe(1);
		expect(linkRow(id)).toMatchObject({ mal_id: 122663, anilist_id: 85143, format: 'MANGA' });
	});

	it('UNDO right after a link takes back the rating it gave', () => {
		const id = tracked('Tower of God');
		cat.linkFromTracker(db, id, { id: 122663, score: 8 }, NOW);
		expect(ratingOf(id)).toBe(8);
		cat.undoLink(id);
		expect(ratingOf(id)).toBe(0);
	});
});

describe('the series screen', () => {
	it('has no LINK row for a doujin', () => {
		const doujin = db.prepare(`SELECT id FROM series WHERE kind = 'doujin' LIMIT 1`).get() as {
			id: number;
		};
		expect(cat.linkState(doujin.id)).toBeNull();
	});

	it('says where the cover comes from', () => {
		const id = idOf('Tower of God');
		db.prepare(`UPDATE series SET cover_key = 'link:anilist:85143' WHERE id = ?`).run(id);
		expect(cat.linkState(id)?.cover.a).toBe('FROM THE ANILIST LINK');
	});
});

describe('a novel AniList lacks', () => {
	beforeEach(() => {
		cat.setAnilistFetch(fake);
		for (const t of ['series_links', 'link_searches', 'link_candidates', 'link_decisions'])
			db.prepare(`DELETE FROM ${t}`).run();
	});

	it('is offered its comic’s entry, never linked to it by itself, and says it’s cover only', async () => {
		const novel = idOf('Mushoku Tensei');
		searches['Mushoku Tensei'] = [media({ id: 21, english: 'Mushoku Tensei', format: 'MANGA' })];
		const r = await cat.searchSeries(
			cat.searchable(10_000).filter((x) => x.id === novel),
			NOW
		);
		// An equal title, but a comic: offered, not linked.
		expect(r).toEqual({ linked: 0, offered: 1 });
		expect(formatsAsked).toEqual(['NOVEL', 'MANGA,ONE_SHOT']);
		const [item] = cat.linkQueue(false).filter((q) => q.seriesId === novel);
		expect(item.candidates[0].why).toMatch(/^A COMIC · COVER ONLY, NEVER TRACKED/);
		cat.link(novel, cat.offered(novel, 21)!, 'review', NOW);
		expect(cat.linkState(novel)?.linked).toMatchObject({ coverOnly: true });
		expect(linkRow(novel)).toMatchObject({ format: 'MANGA' });
	});
});

describe('the season a field names (c240)', () => {
	it('reads absent or empty as no season, never season 0, which is a real one', async () => {
		const { seasonNamed } = await import('$lib/library/catalogue');
		// What `FormData.get` and `URLSearchParams.get` give for a missing field.
		expect(seasonNamed(null)).toBeUndefined();
		expect(seasonNamed('')).toBeUndefined();
		expect(seasonNamed(undefined)).toBeUndefined();
		expect(seasonNamed('0')).toBe(0);
		expect(seasonNamed('2')).toBe(2);
		expect(seasonNamed('1.5')).toBeUndefined();
		expect(seasonNamed('two')).toBeUndefined();
	});
});

describe('UNDO on UNLINK’s band (c520)', () => {
	const row = (id: number) =>
		db.prepare(`SELECT * FROM series_links WHERE series_id = ?`).get(id) as
			Record<string, unknown> | undefined;
	const decisionOf = (id: number) =>
		db.prepare(`SELECT decision, at FROM link_decisions WHERE series_id = ?`).get(id);
	const undo = (facts: unknown, id: number) => {
		// Through the band's own post: the facts as JSON, read back field by field.
		const parsed = cat.parseUnlinkFacts(JSON.stringify(facts), id);
		expect(parsed).not.toBeNull();
		return () => cat.undoUnlink(parsed!);
	};
	const candidate = (
		anilistId: number,
		o: { mal?: number; episodes?: number; title?: string } = {}
	) => ({
		anilistId,
		malId: o.mal ?? null,
		title: o.title ?? `Entry ${anilistId}`,
		alts: [] as string[],
		format: 'TV',
		country: 'JP',
		year: 2018,
		chapters: null,
		volumes: null,
		episodes: o.episodes ?? 12,
		season: 'FALL',
		seasonYear: 2018,
		status: 'FINISHED',
		coverUrl: ''
	});

	it('puts a comic’s link back with every column, and its decision goes with it', () => {
		const id = idOf('Tower of God');
		db.prepare(`UPDATE series SET rating = 0 WHERE id = ?`).run(id);
		cat.linkFromTracker(db, id, { id: 122663, score: 9 }, NOW);
		db.prepare(
			`UPDATE series_links SET anilist_id = 85143, title = 'Tower of God', cover_url = 'https://x/1.jpg', resolved_at = ?, format = 'MANHWA' WHERE series_id = ?`
		).run(NOW + 5, id);
		const before = row(id);
		const facts = cat.unlink(id, NOW + 10);
		expect(row(id)).toBeUndefined();
		expect(decisionOf(id)).toEqual({ decision: 'unlinked', at: NOW + 10 });
		expect(facts).toMatchObject({ seriesId: id, title: 'Tower of God', season: null });
		expect(undo(facts, id)()).toBe('undone');
		expect(row(id)).toEqual(before);
		// No 'unlinked' decision left: the series is linked again, for the pass too.
		expect(decisionOf(id)).toBeUndefined();
		expect(cat.linkState(id)?.linked).toMatchObject({ anilistId: 85143 });
		// The second UNDO of the same facts finds the row back, and says so.
		expect(undo(facts, id)).toThrow('ALREADY UNDONE');
		expect(row(id)).toEqual(before);
	});

	it('puts back the decision the UNLINK replaced, never one of its own', () => {
		const id = idOf('Tower of God');
		cat.linkFromTracker(db, id, { id: 122663, score: 0 }, NOW);
		// A stale NONE OF THESE from before the link, which a link from Mihon leaves.
		db.prepare(`INSERT INTO link_decisions (series_id, decision, at) VALUES (?, 'none', ?)`).run(
			id,
			NOW - 1
		);
		const facts = cat.unlink(id, NOW + 10);
		undo(facts, id)();
		expect(decisionOf(id)).toEqual({ decision: 'none', at: NOW - 1 });
	});

	it('refuses after something else linked the series, or decided it, and changes nothing', () => {
		const id = idOf('Tower of God');
		cat.linkFromTracker(db, id, { id: 122663, score: 0 }, NOW);
		const facts = cat.unlink(id, NOW + 10);
		// Linked again meanwhile, by FIND: the newer link stays.
		cat.link(
			id,
			{ ...candidate(9), format: 'MANHWA', country: 'KR', episodes: null },
			'review',
			NOW + 20
		);
		const newer = row(id);
		expect(undo(facts, id)).toThrow('LINKED OR DECIDED AGAIN SINCE');
		expect(row(id)).toEqual(newer);
		// Decided meanwhile: UNLINK, then NONE OF THESE, and the UNDO of the first.
		db.prepare(`DELETE FROM series_links WHERE series_id = ?`).run(id);
		cat.linkFromTracker(db, id, { id: 122663, score: 0 }, NOW);
		const again = cat.unlink(id, NOW + 30);
		cat.noneOfThese(id, NOW + 40);
		expect(undo(again, id)).toThrow('LINKED OR DECIDED AGAIN SINCE');
		expect(row(id)).toBeUndefined();
		expect(decisionOf(id)).toEqual({ decision: 'none', at: NOW + 40 });
	});

	it('reads a posted band only as this series’ UNLINK could have written it', () => {
		const id = idOf('Tower of God');
		cat.linkFromTracker(db, id, { id: 122663, score: 0 }, NOW);
		const facts = cat.unlink(id, NOW + 10);
		const raw = JSON.stringify(facts);
		// Its own output reads back unchanged.
		expect(cat.parseUnlinkFacts(raw, id)).toEqual(facts);
		expect(cat.parseUnlinkFacts(JSON.stringify(cat.parseUnlinkFacts(raw, id)), id)).toEqual(facts);
		// Another series' band, junk, a word the table refuses, a part 3.
		expect(cat.parseUnlinkFacts(raw, idOf('Lookism'))).toBeNull();
		expect(cat.parseUnlinkFacts('{', id)).toBeNull();
		expect(
			cat.parseUnlinkFacts(JSON.stringify({ ...facts, link: { ...facts.link, via: 'x' } }), id)
		).toBeNull();
		expect(
			cat.parseUnlinkFacts(
				JSON.stringify({ ...facts, parts: [{ season: 1, part: 3, link: null, decision: null }] }),
				id
			)
		).toBeNull();
		expect(row(id)).toBeUndefined();
	});

	it('an anime: a season’s two parts come back, the mirror with its own score, and the other season stays', () => {
		const id = animeSeries('Undo Two Parts');
		const ep = db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, season, episode_number) VALUES (?, ?, ?, ?, ?, ?)`
		);
		let position = 0;
		for (let n = 1; n <= 23; n++) ep.run(id, ++position, `Episode ${n}`, NOW, 1, n);
		for (let n = 1; n <= 3; n++) ep.run(id, ++position, `Episode ${n}`, NOW, 2, n);
		const parts = () =>
			db
				.prepare(`SELECT * FROM series_season_links WHERE series_id = ? ORDER BY season, part`)
				.all(id);
		try {
			expect(
				seasons.linkSeason(id, 1, 1, candidate(201, { mal: 601, episodes: 12 }), 'review', NOW)
			).toBe(true);
			expect(
				seasons.linkSeason(id, 1, 2, candidate(202, { mal: 602, episodes: 11 }), 'relations', NOW)
			).toBe(true);
			expect(seasons.linkSeason(id, 2, 1, candidate(203, { episodes: 3 }), 'pasted', NOW)).toBe(
				true
			);
			// The mirror's own score, which syncSeriesLink never writes.
			db.prepare(`UPDATE series_links SET score = 8, filled_rating = 8 WHERE series_id = ?`).run(
				id
			);
			db.prepare(
				`UPDATE series_season_links SET score = 7 WHERE series_id = ? AND season = 1 AND part = 2`
			).run(id);
			const before = { parts: parts(), mirror: row(id) };
			expect(before.mirror).toMatchObject({ anilist_id: 201, score: 8, filled_rating: 8 });
			const facts = cat.unlink(id, NOW + 10, 1);
			expect(facts.season).toBe(1);
			expect(facts.parts.map((p) => [p.season, p.part])).toEqual([
				[1, 1],
				[1, 2]
			]);
			// Season 2 is left alone; season 1 went with both its parts, and the mirror with it.
			expect((parts() as { season: number }[]).map((p) => p.season)).toEqual([2]);
			expect(row(id)).toBeUndefined();
			expect(undo(facts, id)()).toBe('undone');
			expect({ parts: parts(), mirror: row(id) }).toEqual(before);
			expect(
				db.prepare(`SELECT COUNT(*) AS n FROM season_link_decisions WHERE series_id = ?`).get(id)
			).toEqual({ n: 0 });
			expect(undo(facts, id)).toThrow('ALREADY UNDONE');

			// The sibling season: UNLINK season 2 alone, and UNDO it; season 1 never moves.
			const two = cat.unlink(id, NOW + 20, 2);
			expect(two.parts.map((p) => [p.season, p.part])).toEqual([[2, 1]]);
			undo(two, id)();
			expect({ parts: parts(), mirror: row(id) }).toEqual(before);

			// A part linked again meanwhile refuses the whole UNDO: part 1 stays gone too.
			const three = cat.unlink(id, NOW + 30, 1);
			expect(
				seasons.linkSeason(id, 1, 2, candidate(209, { episodes: 11 }), 'pasted', NOW + 40)
			).toBe(true);
			expect(undo(three, id)).toThrow('LINKED OR DECIDED AGAIN SINCE');
			expect(
				(parts() as { season: number; part: number; anilist_id: number }[]).map((p) => [
					p.season,
					p.part,
					p.anilist_id
				])
			).toEqual([
				[1, 2, 209],
				[2, 1, 203]
			]);
		} finally {
			for (const t of ['series_season_links', 'season_link_decisions', 'entries'])
				db.prepare(`DELETE FROM ${t} WHERE series_id = ?`).run(id);
			forgetSerie(id);
		}
	});

	it('an anime: a part the UNLINK found with no link, linked since, refuses the whole UNDO', () => {
		// The review's own UNLINK names no season: every season goes, a part
		// with only NONE OF THESE included. Linking that part afterwards is a
		// newer act the UNDO must not lay a stale decision over.
		const id = animeSeries('Undo Unlinked Part');
		const ep = db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, season, episode_number) VALUES (?, ?, ?, ?, ?, ?)`
		);
		let position = 0;
		for (let n = 1; n <= 12; n++) ep.run(id, ++position, `Episode ${n}`, NOW, 1, n);
		for (let n = 1; n <= 3; n++) ep.run(id, ++position, `Episode ${n}`, NOW, 2, n);
		const partsOf = () =>
			db
				.prepare(
					`SELECT season, part, anilist_id FROM series_season_links WHERE series_id = ? ORDER BY season, part`
				)
				.all(id);
		const decisionsOf = () =>
			db
				.prepare(
					`SELECT season, part, decision, at FROM season_link_decisions WHERE series_id = ? ORDER BY season, part`
				)
				.all(id);
		try {
			expect(seasons.linkSeason(id, 1, 1, candidate(301, { episodes: 12 }), 'review', NOW)).toBe(
				true
			);
			seasons.noneOfSeason(id, 2, 1, NOW + 1);
			const facts = cat.unlink(id, NOW + 10);
			expect(facts.parts.map((p) => [p.season, p.part, !!p.link])).toEqual([
				[1, 1, true],
				[2, 1, false]
			]);
			expect(
				seasons.linkSeason(id, 2, 1, candidate(302, { episodes: 3 }), 'pasted', NOW + 20)
			).toBe(true);
			const linked = partsOf();
			const decided = decisionsOf();
			expect(linked).toEqual([{ season: 2, part: 1, anilist_id: 302 }]);
			expect(undo(facts, id)).toThrow('LINKED OR DECIDED AGAIN SINCE');
			// Nothing changed: S2 keeps its new link and no NONE OF THESE beside
			// it, and S1 stays unlinked.
			expect(partsOf()).toEqual(linked);
			expect(decisionsOf()).toEqual(decided);
			expect(decisionsOf()).not.toContainEqual(
				expect.objectContaining({ season: 2, decision: 'none' })
			);
		} finally {
			for (const t of ['series_season_links', 'season_link_decisions', 'entries'])
				db.prepare(`DELETE FROM ${t} WHERE series_id = ?`).run(id);
			db.prepare(`DELETE FROM series_links WHERE series_id = ?`).run(id);
			forgetSerie(id);
		}
	});
});

describe('a comic’s link keeps its country and start year (c520, rung 70)', () => {
	const cols = (id: number) =>
		db.prepare(`SELECT country, year FROM series_links WHERE series_id = ?`).get(id);

	it('is written where a link is made: FIND, the review, a paste', () => {
		const id = idOf('Tower of God');
		cat.link(
			id,
			cat.toCandidate(media({ id: 85143, idMal: 122663, english: 'Tower of God', year: 2010 })),
			'review',
			NOW
		);
		expect(cols(id)).toEqual({ country: 'KR', year: 2010 });
		expect(cat.linkState(id)?.linked).toMatchObject({ country: 'KR', year: 2010 });
		// CHANGE to another entry takes the other entry's.
		cat.link(
			id,
			cat.toCandidate(media({ id: 9, english: 'Other', country: 'CN', year: 2019 })),
			'pasted',
			NOW
		);
		expect(cols(id)).toEqual({ country: 'CN', year: 2019 });
	});

	it('is asked on the next pass for a link made before the rung, once, and never for an anime’s mirror', async () => {
		const id = idOf('Tower of God');
		const lost = idOf('Lookism');
		// Two links as rung 70 found them: resolved, their format known, no country.
		const before = db.prepare(
			`INSERT INTO series_links (series_id, anilist_id, mal_id, via, title, linked_at, resolved_at, format)
			VALUES (?, ?, NULL, 'review', ?, ?, ?, 'MANGA')`
		);
		before.run(id, 85143, 'Tower of God', NOW, NOW);
		before.run(lost, 404404, 'Gone from AniList', NOW, NOW);
		expect(cat.linkState(id)?.linked).toMatchObject({ country: null, year: null });
		asked.length = 0;
		// AniList's title and cover have moved on since: a backfill takes neither.
		entries = [media({ id: 85143, english: 'Tower of God (Renamed)', year: 2010 })];
		expect(await cat.resolveLinks(NOW + 1)).toBe(1);
		expect(cols(id)).toEqual({ country: 'KR', year: 2010 });
		expect(linkRow(id)).toMatchObject({
			title: 'Tower of God',
			cover_url: '',
			resolved_at: NOW,
			format: 'MANGA'
		});
		// An entry AniList no longer has is asked once: '' says it was.
		expect(cols(lost)).toEqual({ country: '', year: null });
		expect(asked.length).toBeGreaterThan(0);
		asked.length = 0;
		expect(await cat.resolveLinks(NOW + 2)).toBe(0);
		expect(asked).toEqual([]);

		// An anime's mirror of its first season is not a comic's link: never asked.
		const show = animeSeries('Mirror Only');
		try {
			expect(
				seasons.linkSeason(
					show,
					1,
					1,
					cat.toCandidate(anime({ id: 5114, english: 'Mirror Only' })),
					'review',
					NOW
				)
			).toBe(true);
			expect(cols(show)).toEqual({ country: null, year: null });
			asked.length = 0;
			expect(await cat.resolveLinks(NOW + 3)).toBe(0);
			expect(asked).toEqual([]);
		} finally {
			db.prepare(`DELETE FROM series_season_links WHERE series_id = ?`).run(show);
			forgetSerie(show);
		}
	});

	it('goes when Mihon’s tracker moves to another entry, and the resolve asks the new one', async () => {
		const id = idOf('Tower of God');
		db.prepare(
			`INSERT INTO series_links (series_id, mal_id, via, linked_at, resolved_at, format, country, year)
			VALUES (?, 1000, 'mihon', ?, ?, 'MANGA', 'JP', 1999)`
		).run(id, NOW, NOW);
		cat.linkFromTracker(db, id, { id: 122663, score: 0 }, NOW);
		expect(cols(id)).toEqual({ country: null, year: null });
		entries = [media({ id: 85143, idMal: 122663, english: 'Tower of God', year: 2010 })];
		expect(await cat.resolveLinks(NOW)).toBe(1);
		expect(cols(id)).toEqual({ country: 'KR', year: 2010 });
	});

	it('comes back with UNLINK’s UNDO', () => {
		const id = idOf('Tower of God');
		cat.link(
			id,
			cat.toCandidate(media({ id: 85143, english: 'Tower of God', year: 2010 })),
			'review',
			NOW
		);
		const facts = cat.unlink(id, NOW + 1);
		cat.undoUnlink(cat.parseUnlinkFacts(JSON.stringify(facts), id)!);
		expect(cols(id)).toEqual({ country: 'KR', year: 2010 });
	});
});
