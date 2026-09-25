import { beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const cat = await import('$lib/server/catalogue');

const db = getDb();
const NOW = Date.UTC(2026, 8, 24);
seedSample(db, NOW);

const idOf = (title: string) =>
	(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
const ratingOf = (id: number) =>
	(db.prepare(`SELECT rating FROM series WHERE id = ?`).get(id) as { rating: number }).rating;
const linkRow = (id: number) =>
	db.prepare(`SELECT * FROM series_links WHERE series_id = ?`).get(id) as
		Record<string, unknown> | undefined;

/** An AniList entry as the API sends it. */
const media = (o: {
	id: number;
	idMal?: number | null;
	english?: string | null;
	romaji?: string;
	format?: string;
	country?: string;
	chapters?: number | null;
}) => ({
	id: o.id,
	idMal: o.idMal ?? null,
	format: o.format ?? 'MANGA',
	countryOfOrigin: o.country ?? 'KR',
	status: 'RELEASING',
	chapters: o.chapters ?? null,
	volumes: null,
	synonyms: [],
	title: { romaji: o.romaji ?? `Romaji ${o.id}`, english: o.english ?? null, native: null },
	startDate: { year: 2021 },
	coverImage: { extraLarge: `https://s4.anilist.co/cover/${o.id}.jpg`, large: null }
});

/** What the fake AniList holds, by id, and what each search finds. */
let entries: ReturnType<typeof media>[] = [];
let searches: Record<string, ReturnType<typeof media>[]> = {};
const asked: string[] = [];
const formatsAsked: string[] = [];

const fake: typeof fetch = async (_url, init) => {
	const { query, variables } = JSON.parse(String(init?.body)) as {
		query: string;
		variables: Record<string, unknown>;
	};
	asked.push(query.includes('search:') ? 'search' : 'ids');
	const reply = (data: unknown) =>
		new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
	if (query.includes('idMal_in')) {
		const ids = variables.ids as number[];
		return reply({ Page: { media: entries.filter((m) => ids.includes(m.idMal ?? -1)) } });
	}
	if (query.includes('id_in')) {
		const ids = variables.ids as number[];
		return reply({ Page: { media: entries.filter((m) => ids.includes(m.id)) } });
	}
	const out: Record<string, unknown> = {};
	for (const [k, q] of Object.entries(variables)) {
		if (!k.startsWith('q')) continue;
		const formats = variables[k.replace('q', 'f')] as string[];
		formatsAsked.push(formats.join(','));
		out[k.replace('q', 's')] = {
			media: (searches[q as string] ?? []).filter((m) => formats.includes(m.format))
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
	delete process.env.TSUNDOKU_ANILIST;
	for (const t of ['series_links', 'link_searches', 'link_candidates', 'link_decisions'])
		db.prepare(`DELETE FROM ${t}`).run();
});

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
		expect((await cat.readPasted({ service: 'mal', id: 160388 })).anilistId).toBe(171204);
		expect((await cat.readPasted({ service: 'anilist', id: 171204 })).malId).toBe(160388);
		await expect(cat.readPasted({ service: 'anilist', id: 5 })).rejects.toThrow();
		expect(asked).toEqual(['ids', 'ids', 'ids']);
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
