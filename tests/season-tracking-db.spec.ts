import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ANILIST_CLIENT_ID = '42';
process.env.ANILIST_CLIENT_SECRET = 'al-secret';
process.env.MAL_CLIENT_ID = 'mal-id';
process.env.MAL_CLIENT_SECRET = 'mal-secret';

const Database = (await import('better-sqlite3')).default;
const { climb, getDb } = await import('$lib/server/db');
const tr = await import('$lib/server/tracking');
const cat = await import('$lib/server/catalogue');
const seasons = await import('$lib/server/season-links');

const db = getDb();
const NOW = Date.UTC(2026, 10, 3);
const ORIGIN = 'https://tsundoku.example:8443';

// ---- the catalogues, faked ---------------------------------------------------------------

type Sent = { url: string; body: unknown; auth: string | null };
let sent: Sent[] = [];
const json = (d: unknown, status = 200) =>
	new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });

const fake: typeof fetch = async (input, init) => {
	const url = String(input);
	const raw = init?.body ? String(init.body) : '';
	const body = raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
	sent.push({ url, body, auth: new Headers(init?.headers).get('authorization') });
	if (url === 'https://anilist.co/api/v2/oauth/token')
		return json({ access_token: 'al-token', expires_in: 31_536_000 });
	if (url === 'https://myanimelist.net/v1/oauth2/token')
		return json({ access_token: 'mal-token', refresh_token: 'mal-refresh', expires_in: 2_678_400 });
	if (url === 'https://graphql.anilist.co') {
		const q = (body as { query: string }).query;
		if (q.includes('Viewer')) return json({ data: { Viewer: { id: 7, name: 'masshiro' } } });
		if (q.includes('search:'))
			return json({
				data: {
					s0: {
						media: [
							animeMedia(
								9302,
								String((body as { variables: Record<string, unknown> }).variables.q0)
							)
						]
					}
				}
			});
		if (q.includes('MediaListCollection'))
			return json({ data: { MediaListCollection: { lists: [{ entries: [] }] } } });
		if (q.includes('SaveMediaListEntry')) return json({ data: { SaveMediaListEntry: { id: 1 } } });
		return json({ data: null });
	}
	if (url.startsWith('https://api.myanimelist.net/v2')) {
		if (url.endsWith('/users/@me')) return json({ id: 9, name: 'masshiro' });
		if (url.includes('/users/@me/mangalist')) return json({ data: [], paging: {} });
		if (url.includes('/users/@me/animelist')) return json({ data: [], paging: {} });
		if (url.includes('/my_list_status')) {
			// MAL keeps two lists with two sets of status words: a manga's is
			// reading/plan_to_read, an anime's is watching/plan_to_watch, and the
			// other list's word is a 400 that takes the progress with it (c240).
			const status = (body as Record<string, string>).status;
			const wrong = url.includes('/anime/')
				? status === 'reading' || status === 'plan_to_read'
				: url.includes('/manga/')
					? status === 'watching' || status === 'plan_to_watch'
					: false;
			if (wrong) return json({ error: 'invalid status' }, 400);
			return json({ status: status ?? 'watching' });
		}
	}
	return json({}, 404);
};

beforeEach(() => {
	vi.stubGlobal('fetch', fake);
	// AniList asked with no waiting between calls: the real limit is 30 a minute.
	cat.setAnilistFetch(fake);
	sent = [];
	for (const t of [
		'tracker_accounts',
		'tracker_state',
		'tracker_sends',
		'season_tracker_state',
		'season_tracker_sends',
		'series_season_links',
		'season_link_searches',
		'season_link_candidates',
		'season_link_decisions',
		'series_links'
	])
		db.prepare(`DELETE FROM ${t}`).run();
});
afterEach(() => vi.unstubAllGlobals());

async function signIn(service: 'anilist' | 'mal') {
	const { url, keep } = tr.signInStart(service, ORIGIN);
	const state = new URL(url).searchParams.get('state')!;
	const { listRead } = await tr.signInFinish(
		service,
		ORIGIN,
		{ code: 'the-code', state, kept: keep },
		NOW
	);
	await listRead;
}

// ---- the library -------------------------------------------------------------------------

const rootId = () =>
	(db.prepare(`SELECT id FROM roots WHERE hidden = 0 ORDER BY id LIMIT 1`).get() as {
		id: number;
	})
		? (
				db.prepare(`SELECT id FROM roots WHERE hidden = 0 ORDER BY id LIMIT 1`).get() as {
					id: number;
				}
			).id
		: Number(
				db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Anime', '/nowhere', 0)`).run()
					.lastInsertRowid
			);

/** An anime series whose episodes are the numbers given, each with its own season. */
function show(o: { seasons: number[][]; title?: string }): number {
	const id = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, source, in_library)
				VALUES (?, ?, 'anime', ?, ?, 'KickAssAnime', 1)`
			)
			.run(
				rootId(),
				o.title ?? `Show ${Math.random().toString(36).slice(2, 8)}`,
				NOW,
				`aniyomi:1:/x${Math.random()}`
			).lastInsertRowid
	);
	let position = 0;
	o.seasons.forEach((numbers, i) => {
		for (const n of numbers) {
			position += 1;
			db.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, season, episode_number, duration_s)
				VALUES (?, ?, ?, ?, ?, ?, 1440)`
			).run(id, position, `Episode ${n}`, NOW, i + 1, n);
		}
	});
	return id;
}

const entryId = (seriesId: number, season: number, number: number) =>
	(
		db
			.prepare(`SELECT id FROM entries WHERE series_id = ? AND season = ? AND episode_number = ?`)
			.get(seriesId, season, number) as { id: number }
	).id;

const markWatched = (id: number) =>
	db.prepare(`UPDATE entries SET read_at = ? WHERE id = ?`).run(NOW, id);

/** An anime entry as AniList sends it: what a search answers with. */
const animeMedia = (id: number, title: string) => ({
	id,
	idMal: null,
	format: 'TV',
	countryOfOrigin: 'JP',
	status: 'FINISHED',
	chapters: null,
	volumes: null,
	episodes: 24,
	season: 'FALL',
	seasonYear: 2018,
	synonyms: [],
	title: { romaji: title, english: title, native: null },
	startDate: { year: 2018 },
	coverImage: { extraLarge: null, large: null }
});

const animeEntry = (id: number, o: { mal?: number | null; episodes?: number } = {}) => ({
	anilistId: id,
	malId: o.mal ?? null,
	title: `Entry ${id}`,
	alts: [] as string[],
	format: 'TV',
	country: 'JP',
	year: 2018,
	chapters: null,
	volumes: null,
	episodes: o.episodes ?? 24,
	season: 'FALL',
	seasonYear: 2018,
	status: 'FINISHED',
	coverUrl: ''
});

/**
 * The owner's SEARCH AGAIN on each season, through the door the review uses
 * (`searchNow`): what puts an anime's season in the review queue, without
 * hand-seeding a search the code would never write.
 */
async function searchEvery(id: number) {
	for (const s of seasons.seriesSeasons(id)!.seasons)
		await cat.searchNow(id, s.searchTitle, NOW, { season: s.season });
}

// ---- rung 62 -----------------------------------------------------------------------------

describe('rung 62: a link per season (c240)', () => {
	it('adds the season tables over a v61 database and moves no row', () => {
		const conn = new Database(':memory:');
		climb(conn, 61);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Library', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES
				(1, 1, 'One Piece', 'manga', 100),
				(2, 1, 'Sword Art Online', 'anime', 200);
			INSERT INTO entries (series_id, position, label, added_at, season, episode_number) VALUES
				(2, 1, 'Episode 1', 200, 1, 1);
			INSERT INTO series_links (series_id, mal_id, via, linked_at) VALUES (2, 6, 'mihon', 200);
		`);
		const before = {
			links: conn.prepare(`SELECT * FROM series_links ORDER BY series_id`).all(),
			entries: conn.prepare(`SELECT * FROM entries ORDER BY id`).all(),
			series: conn.prepare(`SELECT * FROM series ORDER BY id`).all()
		};
		climb(conn, 62);
		expect(conn.pragma('user_version', { simple: true })).toBe(62);
		const columns = (name: string) =>
			(conn.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
		expect(columns('series_season_links')).toEqual([
			'series_id',
			'season',
			'part',
			'anilist_id',
			'mal_id',
			'via',
			'title',
			'cover_url',
			'linked_at',
			'resolved_at',
			'filled_rating',
			'score',
			'format',
			'episodes',
			'year'
		]);
		expect(columns('season_tracker_state')).toEqual([
			'series_id',
			'season',
			'part',
			'service',
			'status',
			'score',
			'progress',
			'read_at',
			'sent_at'
		]);
		expect(columns('season_tracker_sends')).toEqual([
			'series_id',
			'season',
			'part',
			'service',
			'progress',
			'status',
			'score',
			'wanted_at',
			'failed_at',
			'error'
		]);
		// Nothing migrated: the link of a v61 database is still the series' own,
		// and no season row was invented from it.
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM series_season_links`).get()).toEqual({ n: 0 });
		expect(conn.prepare(`SELECT * FROM series_links ORDER BY series_id`).all()).toEqual(
			before.links
		);
		expect(conn.prepare(`SELECT * FROM entries ORDER BY id`).all()).toEqual(before.entries);
	});

	it('holds one live link per series, season, part and catalogue', () => {
		const conn = new Database(':memory:');
		climb(conn);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Library', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES (1, 1, 'SAO', 'anime', 100);
		`);
		// The primary key is what makes a season have one link; a second write
		// replaces it, as `series_links` does for a comic.
		conn
			.prepare(
				`INSERT INTO series_season_links (series_id, season, part, anilist_id, via, linked_at)
				VALUES (1, 3, 1, 100, 'review', 1)`
			)
			.run();
		expect(() =>
			conn
				.prepare(
					`INSERT INTO series_season_links (series_id, season, part, anilist_id, via, linked_at)
					VALUES (1, 3, 1, 200, 'review', 2)`
				)
				.run()
		).toThrow(/PRIMARY KEY|UNIQUE/);
		// A season may have a part 2, and a season's two parts are two rows.
		conn
			.prepare(
				`INSERT INTO series_season_links (series_id, season, part, anilist_id, via, linked_at)
				VALUES (1, 3, 2, 201, 'relations', 3)`
			)
			.run();
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM series_season_links`).get()).toEqual({ n: 2 });
		// A part is 1 or 2, and never a third: the design's "never more than two".
		expect(() =>
			conn
				.prepare(
					`INSERT INTO series_season_links (series_id, season, part, anilist_id, via, linked_at)
					VALUES (1, 3, 3, 300, 'review', 3)`
				)
				.run()
		).toThrow(/CHECK/);
		// Two tsundoku series may name one entry: a duplicate series is not an error.
		conn.exec(
			`INSERT INTO series (id, root_id, title, kind, added_at) VALUES (2, 1, 'SAO again', 'anime', 100)`
		);
		conn
			.prepare(
				`INSERT INTO series_season_links (series_id, season, part, anilist_id, via, linked_at)
				VALUES (2, 1, 1, 100, 'review', 4)`
			)
			.run();
		// The season rows go with the series.
		conn.prepare(`DELETE FROM series WHERE id = 1`).run();
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM series_season_links`).get()).toEqual({ n: 1 });
	});

	it('reads a link from before rung 62 as the series’ one season', () => {
		const id = show({ seasons: [[1, 2, 3]] });
		db.prepare(
			`INSERT INTO series_links (series_id, anilist_id, mal_id, via, linked_at, resolved_at, format)
			VALUES (?, 9001, 7001, 'mihon', ?, ?, 'TV')`
		).run(id, NOW, NOW);
		const view = seasons.seriesSeasons(id)!;
		expect(view.seasons).toHaveLength(1);
		expect(view.seasons[0].link).toMatchObject({ anilistId: 9001, malId: 7001, season: 1 });
	});

	it('is one table a season, keyed by the series’ own episode list', () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2, 3]
			]
		});
		const view = seasons.seriesSeasons(id)!;
		expect(view.seasons.map((s) => [s.season, s.from, s.to, s.aired])).toEqual([
			[1, 1, 2, 2],
			[2, 1, 3, 3]
		]);
		expect(view.open).toBe(1);
		// Watched in order, as the owner does: season 1 through, then season 2.
		for (const n of [1, 2]) markWatched(entryId(id, 1, n));
		markWatched(entryId(id, 2, 2));
		expect(seasons.seriesSeasons(id)!.open).toBe(2);
	});
});

// ---- sending ------------------------------------------------------------------------------

describe('sending a season', () => {
	it('sends the season’s own highest episode to AniList and MAL’s anime endpoints', async () => {
		const id = show({
			seasons: [
				[1, 2, 3],
				[1, 2, 3, 4, 5]
			]
		});
		seasons.linkSeason(id, 1, 1, animeEntry(101, { mal: 501 }), 'review', NOW);
		seasons.linkSeason(id, 2, 1, animeEntry(102, { mal: 502 }), 'review', NOW);
		await signIn('anilist');
		await signIn('mal');
		// Season 2's fifth episode watched, nothing of season 1.
		markWatched(entryId(id, 2, 5));
		expect(tr.queueProgress(id, NOW)).toBe(2);
		await tr.sendPending({ now: NOW });
		const save = sent.find((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))!;
		// AniList's own word for watching; the entry starts there (c240).
		expect((save.body as { variables: Record<string, unknown> }).variables).toEqual({
			mediaId: 102,
			progress: 5,
			status: 'CURRENT'
		});
		const patch = sent.find((s) => s.url.includes('/my_list_status'))!;
		expect(patch.url).toBe('https://api.myanimelist.net/v2/anime/502/my_list_status');
		// MAL's anime list says `watching`, never the manga list's `reading`: the
		// stand-in refuses that word with a 400, as MAL does.
		expect(patch.body).toEqual({ num_watched_episodes: '5', status: 'watching' });
		// Season 1 has nothing watched: it sent nothing and waits for nothing.
		expect(
			db
				.prepare(
					`SELECT COUNT(*) AS n FROM season_tracker_sends WHERE series_id = ? AND season = 1`
				)
				.get(id)
		).toEqual({ n: 0 });
	});

	it('counts within the season, and only forward', async () => {
		const id = show({
			seasons: [
				[1, 2, 3],
				[1, 2, 3]
			]
		});
		seasons.linkSeason(id, 1, 1, animeEntry(101, { mal: 501 }), 'review', NOW);
		seasons.linkSeason(id, 2, 1, animeEntry(102, { mal: 502 }), 'review', NOW);
		await signIn('anilist');
		markWatched(entryId(id, 1, 3));
		markWatched(entryId(id, 2, 1));
		tr.queueProgress(id, NOW);
		await tr.sendPending({ now: NOW });
		expect(
			db
				.prepare(
					`SELECT season, progress FROM season_tracker_state WHERE series_id = ? AND service = 'anilist' ORDER BY season`
				)
				.all(id)
		).toEqual([
			{ season: 1, progress: 3 },
			{ season: 2, progress: 1 }
		]);
		// What the list already has is never lowered: season 1 at 3, watching 2 again.
		db.prepare(
			`UPDATE entries SET read_at = NULL WHERE series_id = ? AND season = 1 AND episode_number = 3`
		).run(id);
		sent = [];
		expect(tr.queueProgress(id, NOW)).toBe(0);
		await tr.sendPending({ now: NOW });
		expect(sent.filter((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))).toHaveLength(
			0
		);
	});

	it('never sends a recap or a half number', async () => {
		const id = show({ seasons: [[1, 2, 13, 14, 15, 16]] });
		// The design's SAO S3: 14.5 Recollection is a recap, never sent.
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, season, episode_number, episode_note, duration_s)
			VALUES (?, 6, 'Recollection', ?, 1, 14.5, 'recap', 1420)`
		).run(id, NOW);
		seasons.linkSeason(id, 1, 1, animeEntry(101, { episodes: 24 }), 'review', NOW);
		await signIn('anilist');
		markWatched(
			(
				db
					.prepare(`SELECT id FROM entries WHERE series_id = ? AND episode_number = 14.5`)
					.get(id) as { id: number }
			).id
		);
		expect(tr.queueProgress(id, NOW)).toBe(0);
		markWatched(entryId(id, 1, 15));
		// A recap with a whole number of its own counts for nothing either.
		db.prepare(
			`UPDATE entries SET episode_note = 'recap' WHERE series_id = ? AND episode_number = 16`
		).run(id);
		markWatched(entryId(id, 1, 16));
		tr.queueProgress(id, NOW);
		await tr.sendPending({ now: NOW });
		const save = sent.find((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))!;
		expect((save.body as { variables: Record<string, unknown> }).variables).toMatchObject({
			progress: 15
		});
	});

	it('sends part 2 as its own episode, and part 1 its own', async () => {
		// The design's SAO S4: 23 episodes at the source, 12 + 11 on AniList.
		const id = show({ seasons: [Array.from({ length: 23 }, (_, i) => i + 1)] });
		seasons.linkSeason(id, 1, 1, animeEntry(201, { mal: 601, episodes: 12 }), 'relations', NOW);
		seasons.linkSeason(id, 1, 2, animeEntry(202, { mal: 602, episodes: 11 }), 'relations', NOW);
		await signIn('anilist');
		markWatched(entryId(id, 1, 15));
		expect(tr.queueProgress(id, NOW)).toBe(2);
		await tr.sendPending({ now: NOW });
		const saves = sent
			.filter((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))
			.map((s) => (s.body as { variables: Record<string, unknown> }).variables);
		// Part 1 completed itself at 12; part 2 got EP. 3 (15 - 12).
		expect(saves).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ mediaId: 201, progress: 12 }),
				expect.objectContaining({ mediaId: 202, progress: 3 })
			])
		);
	});

	it('waits when an episode is past the entry’s count and there is no part 2', async () => {
		// The design's "EP. 13 WAITS · ANILIST LISTS 12": a source with 13
		// episodes, a catalogue entry with 12, and no second part to take it.
		const id = show({ seasons: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]] });
		seasons.linkSeason(id, 1, 1, animeEntry(101, { episodes: 12 }), 'review', NOW);
		await signIn('anilist');
		markWatched(entryId(id, 1, 13));
		expect(tr.queueProgress(id, NOW)).toBe(0);
		const t = tr.trackingOf(id)!;
		expect(t.seasons?.[0].waits).toMatchObject({ episode: 13, of: 12, service: 'anilist' });
		// EP. 12 still sends: it is within the entry.
		markWatched(entryId(id, 1, 12));
		expect(tr.queueProgress(id, NOW)).toBe(1);
	});

	it('sends nothing for a hidden series, or a season linked to the other kind', async () => {
		const id = show({ seasons: [[1, 2, 3]] });
		seasons.linkSeason(id, 1, 1, animeEntry(101), 'review', NOW);
		await signIn('anilist');
		markWatched(entryId(id, 1, 3));
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(id);
		expect(tr.queueProgress(id, NOW)).toBe(0);
		db.prepare(`UPDATE series SET hidden = 0 WHERE id = ?`).run(id);
		// A manga's entry on an anime season: OPEN follows the entry, and a send
		// would write this season's episodes onto whatever manga holds that id.
		seasons.linkSeason(
			id,
			1,
			1,
			{ ...animeEntry(30023), format: 'MANGA', episodes: null },
			'review',
			NOW
		);
		expect(tr.queueProgress(id, NOW)).toBe(0);
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM season_tracker_sends WHERE series_id = ?`).get(id)
		).toEqual({ n: 0 });
	});

	it('keeps MAL’s manga and anime sequences apart, and never sends a comic an episode', async () => {
		const id = show({ seasons: [[1, 2]] });
		seasons.linkSeason(id, 1, 1, animeEntry(101, { mal: 23 }), 'review', NOW);
		await signIn('mal');
		markWatched(entryId(id, 1, 2));
		tr.queueProgress(id, NOW);
		await tr.sendPending({ now: NOW });
		expect(sent.findLast((s) => s.url.includes('/my_list_status'))!.url).toBe(
			'https://api.myanimelist.net/v2/anime/23/my_list_status'
		);
		// A manga with the same MAL id 23 is a different row, on /manga/.
		const manga = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, in_library) VALUES (?, 'Comic', 'manga', ?, 1)`
				)
				.run(rootId(), NOW).lastInsertRowid
		);
		db.prepare(
			`INSERT INTO series_links (series_id, mal_id, via, linked_at, resolved_at, format)
			VALUES (?, 23, 'review', ?, ?, 'MANGA')`
		).run(manga, NOW, NOW);
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, read_at) VALUES (?, 40, 'Ch. 40', ?, ?)`
		).run(manga, NOW, NOW);
		tr.queueProgress(manga, NOW);
		await tr.sendPending({ now: NOW });
		const last = sent.findLast((s) => s.url.includes('/my_list_status'))!;
		expect(last.url).toBe('https://api.myanimelist.net/v2/manga/23/my_list_status');
		expect(last.body).toMatchObject({ num_chapters_read: '40' });
	});

	it('sends MAL its own list’s words for an anime, in the sheet as on the first episode', async () => {
		const id = show({ seasons: [[1, 2, 3]] });
		seasons.linkSeason(id, 1, 1, animeEntry(101, { mal: 501, episodes: 3 }), 'review', NOW);
		await signIn('anilist');
		await signIn('mal');
		// The TRACKING sheet's PLANNING, on a season with nothing watched: MAL's
		// anime list spells it `plan_to_watch`, and AniList's PLANNING.
		tr.editTracking(id, { status: 'planning' }, NOW, { season: 1, part: 1 });
		await tr.sendPending({ now: NOW });
		const patch = sent.findLast((s) => s.url.includes('/my_list_status'))!;
		expect(patch.url).toBe('https://api.myanimelist.net/v2/anime/501/my_list_status');
		expect(patch.body).toEqual({ status: 'plan_to_watch' });
		const save = sent.findLast((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))!;
		expect((save.body as { variables: Record<string, unknown> }).variables).toEqual({
			mediaId: 101,
			status: 'PLANNING'
		});
	});

	it('sends COMPLETED with the part’s last counted episode, and never again', async () => {
		const id = show({ seasons: [[1, 2, 3]] });
		seasons.linkSeason(id, 1, 1, animeEntry(101, { mal: 501, episodes: 3 }), 'review', NOW);
		await signIn('anilist');
		await signIn('mal');
		markWatched(entryId(id, 1, 3));
		expect(tr.queueProgress(id, NOW)).toBe(2);
		await tr.sendPending({ now: NOW });
		const save = sent.find((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))!;
		expect((save.body as { variables: Record<string, unknown> }).variables).toEqual({
			mediaId: 101,
			progress: 3,
			status: 'COMPLETED'
		});
		const patch = sent.findLast((s) => s.url.includes('/my_list_status'))!;
		expect(patch.body).toEqual({ num_watched_episodes: '3', status: 'completed' });
		// The list says completed now: another pass queues and sends nothing.
		sent = [];
		expect(tr.queueProgress(id, NOW)).toBe(0);
		await tr.sendPending({ now: NOW });
		expect(sent.filter((s) => s.url.includes('/my_list_status'))).toHaveLength(0);
		expect(sent.filter((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))).toHaveLength(
			0
		);
	});

	it('sends only COMPLETED when the list was already at the part’s last episode', async () => {
		const id = show({ seasons: [[1, 2, 3]] });
		seasons.linkSeason(id, 1, 1, animeEntry(101, { mal: 501, episodes: 3 }), 'review', NOW);
		await signIn('anilist');
		await signIn('mal');
		db.prepare(
			`INSERT INTO season_tracker_state (series_id, season, part, service, status, progress, sent_at)
			VALUES (?, 1, 1, 'anilist', 'reading', 3, ?)`
		).run(id, NOW);
		markWatched(entryId(id, 1, 3));
		expect(tr.queueProgress(id, NOW)).toBe(2);
		await tr.sendPending({ now: NOW });
		// No progress: a lower one is never sent. The status alone finishes it.
		const save = sent.find((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))!;
		expect((save.body as { variables: Record<string, unknown> }).variables).toEqual({
			mediaId: 101,
			status: 'COMPLETED'
		});
	});

	it('never sends COMPLETED over the owner’s ON HOLD or DROPPED, only the episode (wave 15)', async () => {
		const id = show({ seasons: [[1, 2, 3]] });
		seasons.linkSeason(id, 1, 1, animeEntry(101, { mal: 501, episodes: 3 }), 'review', NOW);
		await signIn('anilist');
		await signIn('mal');
		// The owner put it on hold on AniList and dropped it on MAL at EP. 1.
		const state = db.prepare(
			`INSERT INTO season_tracker_state (series_id, season, part, service, status, progress, sent_at)
			VALUES (?, 1, 1, ?, ?, 1, ?)`
		);
		state.run(id, 'anilist', 'on_hold', NOW);
		state.run(id, 'mal', 'dropped', NOW);
		markWatched(entryId(id, 1, 3));
		expect(tr.queueProgress(id, NOW)).toBe(2);
		await tr.sendPending({ now: NOW });
		const save = sent.find((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))!;
		expect((save.body as { variables: Record<string, unknown> }).variables).toEqual({
			mediaId: 101,
			progress: 3
		});
		const patch = sent.findLast((s) => s.url.includes('/my_list_status'))!;
		expect(patch.body).toEqual({ num_watched_episodes: '3' });
	});

	it('places a rating by the open season’s own watching, not an earlier season’s', async () => {
		// Season 1 has 15 episodes and is watched through, so season 2 opens. Its
		// two entries are 12 + 11: the season's EP. 13 is part 2's EP. 1. Season 1's
		// last episode is 15, which read across the whole series would land in
		// part 2 (c240). It must be part 1: season 2 has nothing watched.
		const id = show({
			seasons: [
				Array.from({ length: 15 }, (_, i) => i + 1),
				Array.from({ length: 23 }, (_, i) => i + 1)
			]
		});
		seasons.linkSeason(id, 2, 1, animeEntry(201, { mal: 601, episodes: 12 }), 'relations', NOW);
		seasons.linkSeason(id, 2, 2, animeEntry(202, { mal: 602, episodes: 11 }), 'relations', NOW);
		await signIn('anilist');
		for (let n = 1; n <= 15; n++) markWatched(entryId(id, 1, n));
		expect(seasons.seriesSeasons(id)!.open).toBe(2);
		expect(tr.ratingPart(id)).toEqual({ season: 2, part: 1 });
		await tr.afterRating([id], 8);
		const saves = sent
			.filter((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))
			.map((s) => (s.body as { variables: Record<string, unknown> }).variables);
		expect(saves).toHaveLength(1);
		expect(saves[0]).toMatchObject({ mediaId: 201, scoreRaw: 80 });
	});

	it('shows each season on the TRACKING row, its parts folded in', async () => {
		const id = show({
			seasons: [
				[1, 2, 3, 4],
				[1, 2, 3]
			]
		});
		seasons.linkSeason(id, 1, 1, animeEntry(101, { mal: 501, episodes: 4 }), 'review', NOW);
		await signIn('anilist');
		markWatched(entryId(id, 1, 4));
		markWatched(entryId(id, 2, 2));
		tr.queueProgress(id, NOW);
		await tr.sendPending({ now: NOW });
		const t = tr.trackingOf(id)!;
		expect(t.seasons?.map((s) => s.season)).toEqual([1, 2]);
		// Every episode of season 1 watched: the entry is complete (c240).
		expect(t.seasons?.[0].facts.find((f) => f.service === 'anilist')).toMatchObject({
			state: { status: 'completed', progress: 4 }
		});
		// Season 2 is not linked: its line says so, and sends nothing.
		expect(t.seasons?.[1].link).toBeNull();
		expect(t.seasons?.[1].facts.every((f) => !f.linked)).toBe(true);
	});

	it('queues the season being watched when a rating is set, and no other', async () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		seasons.linkSeason(id, 1, 1, animeEntry(101), 'review', NOW);
		seasons.linkSeason(id, 2, 1, animeEntry(102), 'review', NOW);
		await signIn('anilist');
		for (const n of [1, 2]) markWatched(entryId(id, 1, n));
		markWatched(entryId(id, 2, 1));
		await tr.afterRating([id], 8);
		const saves = sent
			.filter((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))
			.map((s) => (s.body as { variables: Record<string, unknown> }).variables);
		expect(saves).toHaveLength(1);
		expect(saves[0]).toMatchObject({ mediaId: 102, scoreRaw: 80 });
	});
});

// ---- the doors an anime's link comes through ----------------------------------------------

describe('every door writes the season’s row', () => {
	it('LINK, from the review or FIND, writes the season table and no series row', async () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		// The review's LINK goes through `link`, which must know an anime is a season.
		cat.link(id, animeEntry(101, { mal: 501 }), 'review', NOW);
		expect(
			db
				.prepare(
					`SELECT season, part, anilist_id, mal_id, via FROM series_season_links WHERE series_id = ?`
				)
				.all(id)
		).toEqual([{ season: 1, part: 1, anilist_id: 101, mal_id: 501, via: 'review' }]);
		expect(
			db.prepare(`SELECT anilist_id, mal_id, via FROM series_links WHERE series_id = ?`).get(id)
		).toBeUndefined();
		// OPEN and the sheet follow the entry's own kind.
		expect(cat.linkState(id)?.linked).toMatchObject({
			anilistId: 101,
			wrongKind: false,
			kind: 'anime'
		});
		// UNDO takes the season's row.
		expect(cat.undoLink(id)).toBe(true);
		expect(db.prepare(`SELECT COUNT(*) AS n FROM series_season_links`).get()).toEqual({ n: 0 });
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM series_links WHERE series_id = ?`).get(id)
		).toEqual({
			n: 0
		});
	});

	it('UNLINK takes one season, and leaves its sibling alone', () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		seasons.linkSeason(id, 1, 1, animeEntry(101), 'review', NOW);
		seasons.linkSeason(id, 2, 1, animeEntry(102), 'review', NOW);
		cat.unlink(id, NOW, 1);
		expect(seasons.seasonLinks(id).map((l) => l.season)).toEqual([2]);
		// Nothing at series level for AniSkip to ask under another season's entry.
		expect(db.prepare(`SELECT anilist_id FROM series_links WHERE series_id = ?`).get(id)).toBe(
			undefined
		);
		expect(
			db.prepare(`SELECT season FROM season_link_decisions WHERE series_id = ?`).all(id)
		).toEqual([{ season: 1 }]);
		// The line says UNLINKED, not NONE OF THESE: it carries the decision's word.
		expect(seasons.seriesSeasons(id)!.seasons.map((s) => s.decision)).toEqual(['unlinked', null]);
	});

	it('UNLINK takes a season’s second part with its first', () => {
		const id = show({ seasons: [Array.from({ length: 23 }, (_, i) => i + 1)] });
		seasons.linkSeason(id, 1, 1, animeEntry(201, { episodes: 12 }), 'relations', NOW);
		seasons.linkSeason(id, 1, 2, animeEntry(202, { episodes: 11 }), 'relations', NOW);
		// The season's line stands for the season: UNLINK leaves no part behind.
		cat.unlink(id, NOW, 1);
		expect(seasons.seasonLinks(id)).toEqual([]);
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM series_links WHERE series_id = ?`).get(id)
		).toEqual({ n: 0 });
	});

	it('NONE OF THESE settles one season, and the series stays in the pass for the others', () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		expect(cat.searchable(10_000).some((r) => r.id === id)).toBe(true);
		cat.noneOfThese(id, NOW, 1);
		expect(seasons.seasonSettled(id, 1)).toBe(true);
		expect(seasons.seasonSettled(id, 2)).toBe(false);
		expect(cat.undoNone(id)).toBe(true);
		expect(seasons.seasonSettled(id, 1)).toBe(false);
	});

	it('leaves the review queue only when every season is settled, and comes back on undo', async () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		const passable = () => cat.searchable(10_000).some((r) => r.id === id);
		// The cover pass asks while any season is unsettled.
		expect(passable()).toBe(true);
		cat.noneOfThese(id, NOW, 1);
		expect(passable()).toBe(true);
		cat.noneOfThese(id, NOW, 2);
		expect(passable()).toBe(false);
		expect(cat.undoNone(id, 2)).toBe(true);
		expect(passable()).toBe(true);
		// The review queue, made of each season's search waiting for LINK: the same rule.
		await searchEvery(id);
		const queued = () => cat.linkQueue(false).some((i) => i.seriesId === id);
		expect(queued()).toBe(true);
		// Season 1 settled: season 2 still wants a look.
		cat.noneOfThese(id, NOW, 1);
		expect(queued()).toBe(true);
		expect(seasons.seriesSeasons(id)!.seasons[0].decision).toBe('none');
		// Season 2 settled too: the series is done.
		cat.noneOfThese(id, NOW, 2);
		expect(queued()).toBe(false);
		// UNDO one season's decision and the series is back in both.
		expect(cat.undoNone(id, 1)).toBe(true);
		expect(queued()).toBe(true);
		expect(cat.undoNone(id, 2)).toBe(true);
	});

	it('stays in the queue and the pass while a season is unlinked, though the first is linked (wave 15)', async () => {
		// Settling by LINK is the ordinary way: season 1's link must not end the
		// look while season 2 has neither a link nor a decision.
		const pass = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		const queue = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		await searchEvery(queue);
		const state = () => ({
			pass: cat.searchable(10_000).some((r) => r.id === pass),
			queue: cat.linkQueue(false).some((i) => i.seriesId === queue),
			// The count is the queue's own query, so it moves with it.
			counted: cat.linkQueueCount(false) - cat.linkQueue(false).length,
			byTitle: [...cat.linkableByTitle().values()].flat().some((s) => s.id === pass)
		});
		expect(state()).toEqual({ pass: true, queue: true, counted: 0, byTitle: true });

		for (const id of [pass, queue])
			seasons.linkSeason(id, 1, 1, animeEntry(id * 10 + 1), 'review', NOW);
		expect(state()).toEqual({ pass: true, queue: true, counted: 0, byTitle: true });

		for (const id of [pass, queue])
			seasons.linkSeason(id, 2, 1, animeEntry(id * 10 + 2), 'review', NOW);
		expect(state()).toEqual({ pass: false, queue: false, counted: 0, byTitle: false });

		// UNDO one season's LINK leaves that season open again: back in.
		for (const id of [pass, queue]) expect(cat.undoLink(id, 2)).toBe(true);
		expect(seasons.seasonLinks(pass).map((l) => l.season)).toEqual([1]);
		expect(state()).toEqual({ pass: true, queue: true, counted: 0, byTitle: true });
		// UNLINK is a decision, as it is for a comic ("UNLINKED · NO PASS ASKS
		// AGAIN"): the season is settled without a link, and the series stays out.
		for (const id of [pass, queue]) {
			seasons.linkSeason(id, 2, 1, animeEntry(id * 10 + 2), 'review', NOW);
			cat.unlink(id, NOW, 2);
		}
		expect(seasons.seasonLinks(pass).map((l) => l.season)).toEqual([1]);
		expect(state()).toEqual({ pass: false, queue: false, counted: 0, byTitle: false });
	});

	it('requeues an open season the pass searched, and never a settled one or the owner’s own title', async () => {
		const id = show({
			title: 'Requeued Show',
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		// The pass's own searches, one a season ("Requeued Show", "… Season 2").
		await searchEvery(id);
		const rows = () =>
			(
				db
					.prepare(`SELECT season FROM season_link_searches WHERE series_id = ? ORDER BY season`)
					.all(id) as { season: number }[]
			).map((r) => r.season);
		expect(rows()).toEqual([1, 2]);
		seasons.linkSeason(id, 1, 1, animeEntry(701), 'review', NOW);
		cat.requeueSearched();
		// Season 2 is open and searched again; season 1 is linked and left alone.
		expect(rows()).toEqual([1]);
		expect(cat.searchable(10_000).filter((r) => r.id === id)).toMatchObject([
			{ season: 2, query: null }
		]);
		// A title the owner typed is theirs: never requeued.
		await cat.searchNow(id, 'Something Else Entirely', NOW, { season: 2 });
		cat.requeueSearched();
		expect(rows()).toEqual([1, 2]);
		// A settled season is never requeued either.
		await cat.searchNow(id, 'Requeued Show Season 2', NOW, { season: 2 });
		cat.noneOfThese(id, NOW, 2);
		cat.requeueSearched();
		expect(rows()).toEqual([1, 2]);
	});

	it('keeps an anime with a series-level link and no season rows out, as before rung 62', async () => {
		// No episodes, a link from before rung 62, and nothing in the season tables:
		// the legacy link still counts. With episodes too: still the series' one link.
		for (const seasonsOf of [[], [[1, 2]]]) {
			const id = show({ seasons: seasonsOf });
			// The owner's search, on the season that wants a look (season 0 with no episodes).
			await cat.searchNow(id, 'Show', NOW);
			const state = () => ({
				queue: cat.linkQueue(false).some((i) => i.seriesId === id),
				byTitle: [...cat.linkableByTitle().values()].flat().some((s) => s.id === id)
			});
			expect(state()).toEqual({ queue: true, byTitle: true });
			db.prepare(
				`INSERT INTO series_links (series_id, anilist_id, mal_id, via, title, cover_url, linked_at) VALUES (?, 801, 901, 'review', 'Old', '', ?)`
			).run(id, NOW);
			expect(state()).toEqual({ queue: false, byTitle: false });
			// And a NONE OF THESE from before rung 62 is a settled series too.
			db.prepare(`DELETE FROM series_links WHERE series_id = ?`).run(id);
			db.prepare(
				`INSERT OR REPLACE INTO link_decisions (series_id, decision, at) VALUES (?, 'none', ?)`
			).run(id, NOW);
			expect(state()).toEqual({ queue: false, byTitle: false });
			db.prepare(`DELETE FROM link_decisions WHERE series_id = ?`).run(id);
		}
	});

	it('a list entry never replaces a season already linked or settled', () => {
		const id = show({
			title: 'Listed Show',
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		seasons.linkSeason(id, 1, 1, animeEntry(601), 'review', NOW);
		// Season 2 is open, so the series is offered by its title; an entry that
		// only shares that title names season 1, which is the owner's.
		const sameTitle = { ...animeEntry(602), title: 'Listed Show', format: 'MOVIE' };
		expect(tr.linkSeasonFromList(id, sameTitle, null, NOW)).toBe(false);
		expect(seasons.seasonLinks(id).map((l) => [l.season, l.anilistId])).toEqual([[1, 601]]);
		// NONE OF THESE on season 1 is the owner's too.
		cat.unlink(id, NOW, 1);
		expect(tr.linkSeasonFromList(id, sameTitle, null, NOW)).toBe(false);
		expect(seasons.seasonLinks(id)).toEqual([]);
		// An open season takes it.
		db.prepare(`DELETE FROM season_link_decisions WHERE series_id = ?`).run(id);
		expect(tr.linkSeasonFromList(id, sameTitle, null, NOW)).toBe(true);
		expect(seasons.seasonLinks(id).map((l) => [l.season, l.anilistId])).toEqual([[1, 602]]);
	});

	it('shows a season the link of that season, never the open season’s', () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		seasons.linkSeason(id, 1, 1, animeEntry(101), 'review', NOW);
		// The open season is 1; its own page keeps its entry.
		expect(cat.linkState(id)?.linked).toMatchObject({ anilistId: 101, title: 'Entry 101' });
		// Season 2 has no row.
		expect(cat.linkState(id, 2)?.linked).toBeNull();
		expect(cat.linkState(id, 1)?.linked).toMatchObject({ anilistId: 101 });
	});

	it('UNDO takes back the season it acted on, not the open one', () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		seasons.linkSeason(id, 1, 1, animeEntry(101), 'review', NOW);
		seasons.linkSeason(id, 2, 1, animeEntry(102), 'review', NOW);
		// The open season is 1: UNDO after linking season 2 must take season 2's.
		expect(seasons.seriesSeasons(id)!.open).toBe(1);
		expect(cat.undoLink(id, 2)).toBe(true);
		expect(seasons.seasonLinks(id).map((l) => l.season)).toEqual([1]);
	});

	it('UNDO of NONE OF THESE takes back that season’s decision, and no other', () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		cat.noneOfThese(id, NOW, 1);
		cat.noneOfThese(id, NOW, 2);
		expect(cat.undoNone(id, 2)).toBe(true);
		expect(seasons.seasonSettled(id, 1)).toBe(true);
		expect(seasons.seasonSettled(id, 2)).toBe(false);
	});

	it('asks AniSkip a season under that season’s own row alone, and writes no series row', async () => {
		const { lookupAniSkip } = await import('$lib/server/anime/aniskip');
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		// Only season 2 linked: season 1's episode asks nothing.
		seasons.linkSeason(id, 2, 1, animeEntry(102, { mal: 502 }), 'review', NOW);
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM series_links WHERE series_id = ?`).get(id)
		).toEqual({ n: 0 });
		sent = [];
		await lookupAniSkip(entryId(id, 1, 1), { now: NOW });
		expect(sent.filter((s) => s.url.includes('/skip-times/'))).toHaveLength(0);
		// Season 1 linked: its episode is asked, and still no series row.
		seasons.linkSeason(id, 1, 1, animeEntry(101, { mal: 501 }), 'review', NOW);
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM series_links WHERE series_id = ?`).get(id)
		).toEqual({ n: 0 });
		sent = [];
		await lookupAniSkip(entryId(id, 1, 1), { now: NOW });
		expect(sent.filter((s) => s.url.includes('/skip-times/501/1'))).toHaveLength(1);
	});

	it('a season’s own search is kept against that season, not the open one', async () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		const r = await cat.searchNow(id, 'Show Season 2', NOW, { season: 2 });
		expect(r).toEqual({ outcome: 'found', found: 1 });
		expect(seasons.seasonSearch(id, 2)?.query).toBe('Show Season 2');
		expect(seasons.seasonSearch(id, 1)).toBeNull();
		expect(seasons.seasonCandidates(id, 2).map((c) => c.anilistId)).toEqual([9302]);
	});
});

// ---- what was the mirror's (c467) --------------------------------------------------------

describe('an anime’s links without a mirror of its first season (c467)', () => {
	const covered = (id: number, url = `https://img/${id}.jpg`) => ({
		...animeEntry(id),
		coverUrl: url
	});
	const legacy = (id: number, anilist: number) =>
		db
			.prepare(
				`INSERT INTO series_links (series_id, anilist_id, via, title, cover_url, linked_at)
				VALUES (?, ?, 'mihon', 'Old Title', 'https://img/old.jpg', ?)`
			)
			.run(id, anilist, NOW);
	const seriesRow = (id: number) =>
		db.prepare(`SELECT anilist_id FROM series_links WHERE series_id = ?`).get(id);
	/** Season 1 watched through, so CONTINUE (the open season) is season 2. */
	const openOnTwo = (title: string) => {
		const id = show({
			title,
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		for (const n of [1, 2]) markWatched(entryId(id, 1, n));
		expect(seasons.openSeasonOf(id)).toBe(2);
		return id;
	};

	it('the cover is the open season’s, else the first season’s, as the mirror gave', () => {
		const id = openOnTwo('Cover Chain');
		seasons.linkSeason(id, 1, 1, covered(611), 'review', NOW);
		expect(cat.linkCover(id)).toEqual({ anilistId: 611, url: 'https://img/611.jpg' });
		seasons.linkSeason(id, 2, 1, covered(612), 'review', NOW);
		expect(cat.linkCover(id)).toEqual({ anilistId: 612, url: 'https://img/612.jpg' });
	});

	it('offers no cover from a later season when the open one and the first have none', () => {
		const id = show({
			title: 'Cover Later',
			seasons: [
				[1, 2],
				[1, 2],
				[1, 2]
			]
		});
		seasons.linkSeason(id, 3, 1, covered(613), 'review', NOW);
		expect(seasons.openSeasonOf(id)).toBe(1);
		expect(cat.linkCover(id)).toBeNull();
	});

	it('the review’s cover line answers as the cover pass does (link_cover, c467)', async () => {
		const id = openOnTwo('Cover Line');
		seasons.linkSeason(id, 1, 1, covered(614), 'review', NOW);
		db.prepare(`UPDATE series SET cover_key = 'url:x' WHERE id = ?`).run(id);
		await searchEvery(id);
		const line = () => cat.linkQueue(false).find((i) => i.seriesId === id)?.cover.b;
		// Season 2 is open and unlinked; season 1's art is what the chain offers.
		expect(line()).toBe('COMES BEFORE THE LINK’S');
		cat.unlink(id, NOW, 1);
		await searchEvery(id);
		expect(line()).toBe('');
	});

	it('OTHER NAMES lists a season’s entry with only season 2 linked', () => {
		const id = show({
			title: 'Names',
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		expect(cat.linkedNames(id)).toEqual([]);
		seasons.linkSeason(id, 2, 1, animeEntry(621), 'review', NOW);
		expect(cat.linkedNames(id)).toEqual(['Entry 621']);
		seasons.linkSeason(id, 1, 1, animeEntry(622), 'review', NOW);
		expect(cat.linkedNames(id)).toEqual(['Entry 622', 'Entry 621']);
	});

	it('a link from before rung 62 is still read while it is the only one, and goes at a LINK', () => {
		const id = show({ title: 'Fallback', seasons: [[1, 2]] });
		legacy(id, 631);
		expect(cat.linkCover(id)).toEqual({ anilistId: 631, url: 'https://img/old.jpg' });
		expect(cat.linkedNames(id)).toEqual(['Old Title']);
		seasons.linkSeason(id, 1, 1, animeEntry(632), 'review', NOW);
		expect(seriesRow(id)).toBeUndefined();
		expect(cat.linkedNames(id)).toEqual(['Entry 632']);
	});

	it('a later season’s LINK ends a link from before rung 62 too', () => {
		const id = show({
			title: 'Fallback Later',
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		legacy(id, 641);
		seasons.linkSeason(id, 2, 1, animeEntry(642), 'review', NOW);
		expect(seriesRow(id)).toBeUndefined();
	});

	it('UNLINK ends a link from before rung 62, and it does not come back', () => {
		const id = show({ title: 'Fallback Unlink', seasons: [[1, 2]] });
		legacy(id, 651);
		cat.unlink(id, NOW);
		expect(seriesRow(id)).toBeUndefined();
		expect(cat.linkCover(id)).toBeNull();
	});

	it('a Mihon tracker writes no row beside a season’s, and still links one with none', () => {
		const id = show({ title: 'Tracker', seasons: [[1, 2]] });
		seasons.linkSeason(id, 1, 1, animeEntry(661, { mal: 761 }), 'review', NOW);
		cat.linkFromTracker(db, id, { id: 999, score: 7 }, NOW);
		expect(seriesRow(id)).toBeUndefined();
		const fresh = show({ title: 'Tracker Fresh', seasons: [[1, 2]] });
		cat.linkFromTracker(db, fresh, { id: 998, score: 0 }, NOW);
		expect(db.prepare(`SELECT mal_id FROM series_links WHERE series_id = ?`).get(fresh)).toEqual({
			mal_id: 998
		});
	});
});

// ---- the season that wants a look (wave 15, round 2) -----------------------------------

describe('a door that names no season acts on the season that wants a look', () => {
	/** Season 1 linked by the owner, scored and watched into; season 2 open. */
	function probe(title = 'Probe Show'): number {
		const id = show({
			title,
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		seasons.linkSeason(id, 1, 1, animeEntry(555, { mal: 777 }), 'review', NOW);
		db.prepare(`UPDATE series_season_links SET score = 8 WHERE series_id = ?`).run(id);
		markWatched(entryId(id, 1, 1));
		return id;
	}
	const seasonOne = (id: number) =>
		db
			.prepare(
				`SELECT anilist_id AS anilist, mal_id AS mal, via, score FROM series_season_links
				WHERE series_id = ? AND season = 1`
			)
			.all(id);
	const OWNERS = [{ anilist: 555, mal: 777, via: 'review', score: 8 }];
	const searches = (id: number) =>
		db
			.prepare(
				`SELECT season, part, query FROM season_link_searches WHERE series_id = ? ORDER BY season`
			)
			.all(id);

	afterEach(() => {
		db.prepare(`DELETE FROM link_searches`).run();
		db.prepare(`DELETE FROM link_candidates`).run();
		db.prepare(`DELETE FROM link_decisions`).run();
	});

	it('is the open season while it is open, then the first open one, then none', () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2],
				[1, 2]
			]
		});
		// Nothing watched: the open season is the first.
		expect(seasons.seasonToLook(id)).toBe(1);
		markWatched(entryId(id, 1, 1));
		markWatched(entryId(id, 1, 2));
		markWatched(entryId(id, 2, 1));
		expect(seasons.openSeasonOf(id)).toBe(2);
		expect(seasons.seasonToLook(id)).toBe(2);
		seasons.linkSeason(id, 2, 1, animeEntry(2), 'review', NOW);
		expect(seasons.seasonToLook(id)).toBe(1);
		seasons.noneOfSeason(id, 1, 1, NOW);
		expect(seasons.seasonToLook(id)).toBe(3);
		seasons.unlinkSeason(id, 3, 1, NOW);
		expect(seasons.seasonToLook(id)).toBeUndefined();
		// The twin of NEEDS_LOOK: no season to look at is no place in the pass.
		expect(cat.searchable(10_000).some((r) => r.id === id)).toBe(false);
	});

	it('the pass searches season 2 and leaves the owner’s season 1 alone', async () => {
		const id = probe();
		const rows = cat.searchable(10_000).filter((r) => r.id === id);
		expect(rows).toHaveLength(1);
		await cat.searchSeries(rows, NOW);
		expect(seasonOne(id)).toEqual(OWNERS);
		expect(searches(id)).toEqual([{ season: 2, part: 1, query: 'Probe Show Season 2' }]);
	});

	it('a sure match links season 2, never season 1', async () => {
		const id = probe('Sure Show');
		// AniList answers with season 2's own title: a sure match for season 2.
		// (The series' plain title is season 1's, and is no sure match for a
		// season past the first: wave 17, round 2, in the wave-17 cases below.)
		const sure: typeof fetch = async (input, init) => {
			const raw = init?.body ? String(init.body) : '';
			if (String(input) === 'https://graphql.anilist.co' && raw.includes('search:'))
				return json({ data: { s0: { media: [animeMedia(9302, 'Sure Show Season 2')] } } });
			return fake(input, init);
		};
		cat.setAnilistFetch(sure);
		const r = await cat.searchSeries(
			cat.searchable(10_000).filter((x) => x.id === id),
			NOW
		);
		expect(r).toEqual({ linked: 1, offered: 0 });
		expect(seasonOne(id)).toEqual(OWNERS);
		expect(
			seasons
				.seasonLinks(id)
				.filter((l) => l.season === 2)
				.map((l) => [l.anilistId, l.via])
		).toEqual([[9302, 'exact']]);
		// Every season linked: nothing left for the pass.
		expect(cat.searchable(10_000).some((x) => x.id === id)).toBe(false);
	});

	it('a sure match never replaces a season the owner linked while the search was out', async () => {
		const id = probe('Raced Show');
		const sure: typeof fetch = async (input, init) => {
			const raw = init?.body ? String(init.body) : '';
			if (String(input) === 'https://graphql.anilist.co' && raw.includes('search:')) {
				// The owner links season 2 on the series screen meanwhile.
				seasons.linkSeason(id, 2, 1, animeEntry(8800), 'review', NOW);
				return json({ data: { s0: { media: [animeMedia(9302, 'Raced Show')] } } });
			}
			return fake(input, init);
		};
		cat.setAnilistFetch(sure);
		const r = await cat.searchSeries(
			cat.searchable(10_000).filter((x) => x.id === id),
			NOW
		);
		expect(r).toEqual({ linked: 0, offered: 1 });
		expect(seasonOne(id)).toEqual(OWNERS);
		expect(seasons.seasonLinks(id).map((l) => [l.season, l.anilistId])).toEqual([
			[1, 555],
			[2, 8800]
		]);
	});

	it('NONE OF THESE with no season settles season 2, and the series leaves the queue', async () => {
		const id = probe();
		// With no season named, the search is the season that wants a look's.
		await cat.searchNow(id, 'Probe Show Season 2', NOW);
		expect(seasons.seasonSearch(id, 2)?.query).toBe('Probe Show Season 2');
		const queued = () => cat.linkQueue(false).find((i) => i.seriesId === id);
		// The queue's item carries the season it is for.
		expect(queued()).toMatchObject({ season: 2, part: 1 });
		cat.noneOfThese(id, NOW);
		expect(
			db.prepare(`SELECT season, decision FROM season_link_decisions WHERE series_id = ?`).all(id)
		).toEqual([{ season: 2, decision: 'none' }]);
		expect(seasonOne(id)).toEqual(OWNERS);
		expect(queued()).toBeUndefined();
	});

	it('LINK with no season links season 2 and leaves season 1 alone', () => {
		const id = probe();
		cat.link(id, animeEntry(9400, { mal: 9401 }), 'review', NOW);
		expect(seasonOne(id)).toEqual(OWNERS);
		expect(
			seasons
				.seasonLinks(id)
				.filter((l) => l.season === 2)
				.map((l) => l.anilistId)
		).toEqual([9400]);
	});

	it('Ranobe’s review says the AniList review holds an anime only while a season’s own search waits there', async () => {
		const rv = await import('$lib/server/ranobe-review');
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		const line = () => rv.ranobeItem(id)?.rows.find((r) => r.label === 'ANILIST')?.value;
		const queued = () => cat.linkQueue(false).some((i) => i.seriesId === id);
		// Never searched: in no review.
		expect(line()).toBe('NOT LINKED');
		// Season 1 searched: its own item in the queue, and the line says so.
		await cat.searchNow(id, 'Show', NOW, { season: 1 });
		expect(line()).toBe('NOT LINKED · ITS OWN REVIEW');
		expect(queued()).toBe(true);
		// Season 1 settled, season 2 open but never searched: out of the review.
		cat.noneOfThese(id, NOW, 1);
		expect(queued()).toBe(false);
		expect(line()).toBe('NOT LINKED');
		// Season 2 searched: back in, as season 2.
		await cat.searchNow(id, 'Show Season 2', NOW, { season: 2 });
		expect(line()).toBe('NOT LINKED · ITS OWN REVIEW');
		// Season 2 linked (no mirror: it is not the first season): the row names
		// its entry, the lowest season linked (wave 17), not NOT LINKED.
		seasons.linkSeason(id, 2, 1, animeEntry(9600), 'review', NOW);
		expect(db.prepare(`SELECT 1 FROM series_links WHERE series_id = ?`).get(id)).toBeUndefined();
		expect(line()).toBe('ANILIST 9600');
		expect(queued()).toBe(false);
	});

	it('the queue’s LINK accepts only the season’s own candidates, never the series’ (wave 17)', async () => {
		const id = probe();
		// What a search before rung 62 left behind (the owner's database has such
		// rows): the series' pair, which belongs to no season.
		db.prepare(
			`INSERT INTO link_searches (series_id, query, searched_at, found) VALUES (?, 'Probe Show', ?, 1)`
		).run(id, NOW);
		db.prepare(
			`INSERT INTO link_candidates (series_id, anilist_id, rank, data) VALUES (?, 9500, 0, ?)`
		).run(id, JSON.stringify(animeEntry(9500)));
		expect(cat.offered(id, 9500)).toBeNull();
		expect(cat.offered(id, 9500, 2)).toBeNull();
		// Nor is it a queue item: season 2 has no search of its own yet.
		expect(cat.linkQueue(false).some((i) => i.seriesId === id)).toBe(false);
		expect(cat.linkQueueCount(false)).toBe(cat.linkQueue(false).length);
		// Its own search is what LINK accepts.
		await cat.searchNow(id, 'Probe Show Season 2', NOW, { season: 2 });
		expect(cat.offered(id, 9302, 2)?.anilistId).toBe(9302);
		expect(cat.offered(id, 9302)?.anilistId).toBe(9302);
		expect(
			cat
				.linkQueue(false)
				.filter((i) => i.seriesId === id)
				.map((i) => [i.season, i.candidates.map((c) => c.anilistId)])
		).toEqual([[2, [9302]]]);
	});
});

// ---- a season's own search, from a fresh show (wave 17) -----------------------------------

describe('the pass and the queue ask each season’s own search, never the series’ (wave 17)', () => {
	type Hit = [number, string];
	/**
	 * AniList answering each query with a list, in its order. One hit is
	 * written as a pair; AniList's real answer for "Show Season 2" usually
	 * lists "Show" (season 1's entry) after the season's own, and the round-2
	 * cases give it exactly that (wave 17, round 2).
	 */
	function byQuery(answers: Record<string, Hit | Hit[]>): typeof fetch {
		return async (input, init) => {
			const raw = init?.body ? String(init.body) : '';
			if (String(input) === 'https://graphql.anilist.co' && raw.includes('search:')) {
				// The pass asks several titles in one request, aliased s0, s1, ...
				const vars = (JSON.parse(raw) as { variables: Record<string, unknown> }).variables;
				const data: Record<string, { media: unknown[] }> = {};
				for (const [k, v] of Object.entries(vars))
					if (/^q\d+$/.test(k)) {
						const a = answers[String(v)];
						const hits: Hit[] = !a ? [] : Array.isArray(a[0]) ? (a as Hit[]) : [a as Hit];
						data[`s${k.slice(1)}`] = { media: hits.map(([n, t]) => animeMedia(n, t)) };
					}
				return json({ data });
			}
			return fake(input, init);
		};
	}
	/** One pass of the cover pass over this series, limited as the pass limits it. */
	const pass = async (id: number, limit = 10_000) =>
		cat.searchSeries(
			cat
				.searchable(10_000)
				.filter((r) => r.id === id)
				.slice(0, limit),
			NOW
		);
	const item = (id: number, season: number) =>
		cat.linkQueue(false).find((i) => i.seriesId === id && i.season === season);
	const cands = (id: number, season: number) =>
		item(id, season)?.candidates.map((c) => c.anilistId);
	/** LINK from the queue, as the API does it: the item's season, the candidate it offered. */
	const linkFromQueue = (id: number, season: number, anilistId: number) => {
		const it = item(id, season)!;
		const c = cat.offered(id, anilistId, it.season, it.part);
		if (!c) return false;
		seasons.linkSeason(id, it.season!, it.part!, c, 'review', NOW);
		return true;
	};

	afterEach(() => cat.setAnilistFetch(fake));

	it('the review’s repro: after season 1 is linked from the queue, season 2 is searched as its own and never offered season 1’s entry', async () => {
		const id = show({
			title: 'Fresh Show',
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		cat.setAnilistFetch(
			byQuery({
				'Fresh Show': [7001, 'Fresh Show Something'],
				// AniList lists season 1's entry under season 2's title too.
				'Fresh Show Season 2': [
					[7002, 'Fresh Show Second Something'],
					[7001, 'Fresh Show Something']
				]
			})
		);
		// The order of events the review reproduced: one pass reaches season 1 only.
		expect(await pass(id, 1)).toEqual({ linked: 0, offered: 1 });
		expect(seasons.seasonSearch(id, 1)?.query).toBe('Fresh Show');
		expect(item(id, 1)).toMatchObject({ season: 1, part: 1, query: 'Fresh Show', found: 1 });
		expect(cands(id, 1)).toEqual([7001]);
		// Season 2 has no search yet: no item of its own, and nobody else's.
		expect(item(id, 2)).toBeUndefined();
		expect(cat.offered(id, 7001, 2, 1)).toBeNull();

		expect(linkFromQueue(id, 1, 7001)).toBe(true);
		// The pass now wants season 2, by its own title.
		expect(cat.searchable(10_000).filter((r) => r.id === id)).toMatchObject([
			{ season: 2, query: null }
		]);
		expect(await pass(id)).toEqual({ linked: 0, offered: 1 });
		expect(seasons.seasonSearch(id, 2)).toMatchObject({ query: 'Fresh Show Season 2', found: 1 });
		// The queue's season-2 item is season 2's search, and never offers 7001.
		expect(item(id, 1)).toBeUndefined();
		expect(item(id, 2)).toMatchObject({ query: 'Fresh Show Season 2', found: 1 });
		expect(cands(id, 2)).toEqual([7002]);
		expect(cat.offered(id, 7001, 2, 1)).toBeNull();
		expect(linkFromQueue(id, 2, 7001)).toBe(false);
		expect(linkFromQueue(id, 2, 7002)).toBe(true);
		expect(seasons.seasonLinks(id).map((l) => [l.season, l.anilistId])).toEqual([
			[1, 7001],
			[2, 7002]
		]);
		// Every season settled: out of the pass and the queue.
		expect(cat.searchable(10_000).some((r) => r.id === id)).toBe(false);
		expect(cat.linkQueue(false).some((i) => i.seriesId === id)).toBe(false);
		// An anime's search is stored once, against its season (c355).
		expect(db.prepare(`SELECT 1 FROM link_searches WHERE series_id = ?`).get(id)).toBeUndefined();
		expect(db.prepare(`SELECT 1 FROM link_candidates WHERE series_id = ?`).get(id)).toBeUndefined();
	});

	it('a sure match links season 1, and the next pass searches season 2 by its own title', async () => {
		const id = show({
			title: 'Auto Show',
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		cat.setAnilistFetch(
			byQuery({
				'Auto Show': [7101, 'Auto Show'],
				// Season 1's entry is the one hit equal to the series' plain title.
				'Auto Show Season 2': [
					[7102, 'Auto Show 2nd Season'],
					[7101, 'Auto Show']
				]
			})
		);
		expect(await pass(id, 1)).toEqual({ linked: 1, offered: 0 });
		expect(seasons.seasonLinks(id).map((l) => [l.season, l.anilistId, l.via])).toEqual([
			[1, 7101, 'exact']
		]);
		// Nothing waits on a search season 2 never had.
		expect(cat.linkQueue(false).some((i) => i.seriesId === id)).toBe(false);
		expect(cat.searchable(10_000).filter((r) => r.id === id)).toMatchObject([{ season: 2 }]);
		expect(await pass(id)).toEqual({ linked: 0, offered: 1 });
		expect(seasons.seasonSearch(id, 2)?.query).toBe('Auto Show Season 2');
		// Season 2 is not linked to season 1's entry: offered, by its own entry only.
		expect(seasons.seasonLinks(id).map((l) => [l.season, l.anilistId, l.via])).toEqual([
			[1, 7101, 'exact']
		]);
		expect(cands(id, 2)).toEqual([7102]);
		expect(cat.offered(id, 7101, 2, 1)).toBeNull();
	});

	it('one pass over both seasons links each to its own entry, never both to season 1’s', async () => {
		const id = show({
			title: 'Twin Show',
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		cat.setAnilistFetch(
			byQuery({
				'Twin Show': [7601, 'Twin Show'],
				'Twin Show Season 2': [
					[7602, 'Twin Show Season 2'],
					[7601, 'Twin Show']
				]
			})
		);
		expect(await pass(id)).toEqual({ linked: 2, offered: 0 });
		expect(seasons.seasonLinks(id).map((l) => [l.season, l.anilistId, l.via])).toEqual([
			[1, 7601, 'exact'],
			[2, 7602, 'exact']
		]);
	});

	it('season 2 searched before season 1 is linked: its item drops season 1’s entry once it is held', async () => {
		const id = show({
			title: 'Late Show',
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		cat.setAnilistFetch(
			byQuery({
				'Late Show': [7801, 'Late Show Something'],
				'Late Show Season 2': [
					[7802, 'Late Show Second Something'],
					[7801, 'Late Show Something']
				]
			})
		);
		// Both seasons searched in one pass, while neither is linked: season 2
		// lists both entries, as it should, since nobody holds 7801 yet.
		expect(await pass(id)).toEqual({ linked: 0, offered: 2 });
		expect(cands(id, 2)).toEqual([7802, 7801]);
		expect(linkFromQueue(id, 1, 7801)).toBe(true);
		// Now season 1 holds it: season 2's item never offers it, and LINK refuses it.
		expect(cands(id, 2)).toEqual([7802]);
		expect(cat.offered(id, 7801, 2, 1)).toBeNull();
		expect(linkFromQueue(id, 2, 7801)).toBe(false);
		expect(seasons.seasonLinks(id).map((l) => [l.season, l.anilistId])).toEqual([[1, 7801]]);
	});

	it('the pass never links an entry another season holds, even on the owner’s own title', async () => {
		const id = show({
			title: 'Typed Show',
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		cat.setAnilistFetch(byQuery({ 'Typed Show': [7701, 'Typed Show'] }));
		expect(await pass(id, 1)).toEqual({ linked: 1, offered: 0 });
		// The owner's SEARCH AGAIN on season 2, typed as season 1's title: the
		// typed query counts as the season's own title, so 7701 is a sure match,
		// and only the "taken by another season" rule keeps it off season 2.
		cat.queueSearch(id, 'Typed Show', { season: 2 });
		expect(await pass(id)).toEqual({ linked: 0, offered: 1 });
		expect(seasons.seasonLinks(id).map((l) => [l.season, l.anilistId])).toEqual([[1, 7701]]);
		expect(seasons.seasonSearch(id, 2)).toMatchObject({ query: 'Typed Show', found: 0 });
	});

	it('no door links an entry another season or part holds: pasted, review, list and the relations', () => {
		const id = show({
			title: 'Door Show',
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		expect(seasons.linkSeason(id, 1, 1, animeEntry(7901, { mal: 8901 }), 'review', NOW)).toBe(true);
		// The same AniList entry, or another AniList id with the same MAL entry.
		for (const via of ['pasted', 'review', 'exact', 'list', 'relations'] as const) {
			expect(seasons.linkSeason(id, 2, 1, animeEntry(7901), via, NOW)).toBe(false);
			expect(seasons.linkSeason(id, 1, 2, animeEntry(7999, { mal: 8901 }), via, NOW)).toBe(false);
		}
		// LINK N SEASONS, even with the entry kept as season 2's candidate: refused,
		// and named (c418).
		db.prepare(
			`INSERT INTO season_link_candidates (series_id, season, part, anilist_id, rank, data) VALUES (?, 2, 1, 7901, 0, ?)`
		).run(id, JSON.stringify(animeEntry(7901)));
		expect(
			seasons.linkPicks(id, 'anime', [{ season: 2, part: 1, anilistId: 7901 }], NOW)
		).toMatchObject({
			linked: [],
			refused: [
				{
					season: 2,
					part: 1,
					heldBy: { season: 1, part: 1 },
					why: 'SEASON 2 NOT LINKED · SEASON 1 HOLDS ITS ENTRY'
				}
			]
		});
		// The owner's list: an entry whose title names season 2, but is season 1's.
		const listed = { ...animeEntry(7901), title: 'Door Show Season 2' };
		expect(tr.linkSeasonFromList(id, listed, 80, NOW)).toBe(false);
		expect(seasons.seasonLinks(id).map((l) => [l.season, l.part, l.anilistId])).toEqual([
			[1, 1, 7901]
		]);
		// The season's own entry may be linked again (a CHANGE to itself).
		expect(seasons.linkSeason(id, 1, 1, animeEntry(7901, { mal: 8901 }), 'review', NOW)).toBe(true);
	});

	it('one item a season: every open season searched is in the queue, each with its own search, and the count agrees (c352)', async () => {
		const id = show({
			title: 'Many Show',
			seasons: [
				[1, 2],
				[1, 2],
				[1, 2]
			]
		});
		cat.setAnilistFetch(
			byQuery({
				'Many Show': [7201, 'Many Show Something'],
				'Many Show Season 2': [7202, 'Many Show Second'],
				'Many Show Season 3': [7203, 'Many Show Third']
			})
		);
		const before = cat.linkQueueCount(false);
		// One pass, every season: each searched by its own title.
		expect(await pass(id)).toEqual({ linked: 0, offered: 3 });
		expect(
			cat
				.linkQueue(false)
				.filter((i) => i.seriesId === id)
				.map((i) => [i.season, i.query, i.candidates.map((c) => c.anilistId)])
		).toEqual([
			[1, 'Many Show', [7201]],
			[2, 'Many Show Season 2', [7202]],
			[3, 'Many Show Season 3', [7203]]
		]);
		expect(cat.linkQueueCount(false)).toBe(before + 3);
		// SKIP sends that season's item to the back, not the series'.
		cat.skip(id, NOW, 2);
		const order = cat
			.linkQueue(false)
			.filter((i) => i.seriesId === id)
			.map((i) => i.season);
		expect(order).toEqual([1, 3, 2]);
		// NONE OF THESE on season 3 takes that item only.
		cat.noneOfThese(id, NOW, 3);
		expect(
			cat
				.linkQueue(false)
				.filter((i) => i.seriesId === id)
				.map((i) => i.season)
		).toEqual([1, 2]);
		expect(cat.linkQueueCount(false)).toBe(before + 2);
		// FIND on season 2 shows the same search the queue holds (c355).
		expect(cat.reviewItem(id, false, 2)).toMatchObject({
			season: 2,
			query: 'Many Show Season 2',
			found: 1
		});
		expect(seasons.seriesSeasons(id)!.seasons.map((s) => s.searched)).toEqual([true, true, true]);
	});

	it('SEARCH AGAIN on a season replaces that season’s search only, and UNDO puts it back', async () => {
		const id = show({
			title: 'Undo Show',
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		cat.setAnilistFetch(
			byQuery({
				'Undo Show': [7301, 'Undo Show Something'],
				'Undo Show Season 2': [7302, 'Undo Show Second'],
				'Undo Show Part Two': [7303, 'Undo Show Part Two']
			})
		);
		await pass(id);
		await cat.searchNow(id, 'Undo Show Part Two', NOW, { season: 2 });
		expect(cands(id, 2)).toEqual([7303]);
		expect(cands(id, 1)).toEqual([7301]);
		cat.undoSearch(id, undefined, { season: 2 });
		expect(cands(id, 2)).toEqual([7302]);
		expect(item(id, 2)?.query).toBe('Undo Show Season 2');
		expect(cands(id, 1)).toEqual([7301]);
	});

	it('a SEARCH AGAIN that waits for the pass is the season’s, and the pass runs it on that season', async () => {
		const id = show({
			title: 'Queued Show',
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		const was = cat.queueSearch(id, 'Queued Show Typed', { season: 2 });
		expect(was).toBeNull();
		expect(seasons.seriesSeasons(id)!.seasons.map((s) => s.queued)).toEqual([false, true]);
		// The waiting search goes first, under the owner's title, on season 2.
		const rows = cat.searchable(10_000).filter((r) => r.id === id);
		expect(rows).toMatchObject([
			{ season: 2, query: 'Queued Show Typed' },
			{ season: 1, query: null }
		]);
		cat.unqueueSearch(id, was, { season: 2 });
		expect(seasons.seasonSearch(id, 2)).toBeNull();
		cat.queueSearch(id, 'Queued Show Typed', { season: 2 });
		cat.setAnilistFetch(byQuery({ 'Queued Show Typed': [7401, 'Queued Show Typed'] }));
		await pass(id, 1);
		expect(seasons.seasonSearch(id, 2)).toMatchObject({ query: 'Queued Show Typed', found: 1 });
		expect(seasons.seasonSearch(id, 1)).toBeNull();
	});
});

// ---- the series-level state and sends are a comic's (wave 17) ----------------------------

describe('an anime’s list state and sends are its seasons’, at every door', () => {
	afterEach(() => vi.stubGlobal('fetch', fake));

	it('reading the list files season 1’s entry on the season, never as the series’', async () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		seasons.linkSeason(id, 1, 1, animeEntry(101, { mal: 501 }), 'review', NOW);
		const listed: typeof fetch = async (input, init) => {
			if (String(input).includes('/users/@me/animelist'))
				return json({
					data: [
						{
							node: { id: 501 },
							list_status: { status: 'watching', score: 7, num_episodes_watched: 2 }
						}
					],
					paging: {}
				});
			return fake(input, init);
		};
		vi.stubGlobal('fetch', listed);
		await signIn('mal');
		expect(
			db.prepare(`SELECT season, progress FROM season_tracker_state WHERE series_id = ?`).all(id)
		).toEqual([{ season: 1, progress: 2 }]);
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM tracker_state WHERE series_id = ?`).get(id)
		).toEqual({ n: 0 });
	});

	it('SETTINGS counts an anime linked once, by any season', () => {
		const before = cat.linkCount();
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		// Season 2 alone: still a linked series.
		seasons.linkSeason(id, 2, 1, animeEntry(102), 'review', NOW);
		expect(cat.linkCount()).toBe(before + 1);
		// Season 1 too: still one series.
		seasons.linkSeason(id, 1, 1, animeEntry(101), 'review', NOW);
		expect(cat.linkCount()).toBe(before + 1);
	});

	it('SETTINGS counts a season’s failed send, and SIGN OUT takes a season’s waiting send with it', async () => {
		const id = show({ seasons: [[1, 2]] });
		seasons.linkSeason(id, 1, 1, animeEntry(101, { mal: 501 }), 'review', NOW);
		await signIn('mal');
		const failing: typeof fetch = async (input, init) =>
			String(input).includes('/my_list_status') ? json({ error: 'down' }, 500) : fake(input, init);
		vi.stubGlobal('fetch', failing);
		markWatched(entryId(id, 1, 1));
		tr.queueProgress(id, NOW);
		await tr.sendPending({ now: NOW });
		const mal = () => tr.accounts().find((a) => a.service === 'mal')!;
		expect(mal().failed.count).toBe(1);
		expect(mal().waiting).toBe(0);
		tr.signOut('mal');
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM season_tracker_sends WHERE series_id = ?`).get(id)
		).toEqual({ n: 0 });
	});
});

// ---- Ranobe ------------------------------------------------------------------------------

describe('Ranobe on an anime', () => {
	const rbFetch = () => {
		const calls: { method: string; path: string; body: unknown }[] = [];
		const f: typeof fetch = async (input, init) => {
			const url = String(input);
			const path = url.replace('https://ranobe.test/api/v1', '');
			const raw = init?.body ? String(init.body) : '';
			calls.push({ method: init?.method ?? 'GET', path, body: raw ? JSON.parse(raw) : null });
			const body = (d: unknown) => json(d);
			if (path.startsWith('/works/w900'))
				return body({ title: 'Show', units: { type: 'episode', count: 5, extra: [] } });
			if (path === '/me/reads') return body({ recorded: 2, duplicates: 0, entries: [] });
			if (path.startsWith('/me/library/')) return body({ rev: 1 });
			return body({});
		};
		return { f, calls };
	};

	it('is looked up on Ranobe by its lowest linked season (wave 17)', async () => {
		process.env.RANOBE_TOKEN = 'rb_test';
		process.env.RANOBE_URL = 'https://ranobe.test/api/v1';
		const rb = await import('$lib/server/ranobe');
		const asked: string[][] = [];
		rb.setRanobeFetch(async (input, init) => {
			const path = String(input).replace('https://ranobe.test/api/v1', '');
			if (path === '/lookup') {
				const keys = (JSON.parse(String(init?.body)) as { keys: string[] }).keys;
				asked.push(keys);
				return json({
					results: Object.fromEntries(
						keys.map((k) => [k, k === 'mal_anime:502' ? { ref: 'w901' } : null])
					)
				});
			}
			return json({});
		});
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		// Only season 2 linked: still asked about.
		seasons.linkSeason(id, 2, 1, animeEntry(102, { mal: 502 }), 'review', NOW);
		expect(db.prepare(`SELECT 1 FROM series_links WHERE series_id = ?`).get(id)).toBeUndefined();
		await rb.matchByLookup(NOW);
		expect(asked.flat()).toEqual(expect.arrayContaining(['anilist:102', 'mal_anime:502']));
		expect(db.prepare(`SELECT work FROM ranobe_links WHERE series_id = ?`).get(id)).toEqual({
			work: 'w901'
		});
		db.prepare(`DELETE FROM ranobe_links WHERE series_id = ?`).run(id);
	});

	it('maps every episode straight through the seasons, and sends them as work units', async () => {
		process.env.RANOBE_TOKEN = 'rb_test';
		process.env.RANOBE_URL = 'https://ranobe.test/api/v1';
		const rb = await import('$lib/server/ranobe');
		const { f, calls } = rbFetch();
		rb.setRanobeFetch(f);
		const id = show({
			seasons: [
				[1, 2, 3],
				[1, 2]
			]
		});
		// The work counts 5 episodes: the show runs straight through (Ranobe c134).
		rb.linkWork(id, 'w900', 'pasted', NOW);
		// What the work counts, then the episodes mapped onto those units.
		await rb.readWorkUnits(NOW, ['w900']);
		await rb.mapSeries({ seriesId: id, now: NOW });
		expect(
			db
				.prepare(`SELECT label, ranobe_unit FROM entries WHERE series_id = ? ORDER BY position`)
				.all(id)
		).toEqual([
			{ label: 'Episode 1', ranobe_unit: 'w900:episode:1' },
			{ label: 'Episode 2', ranobe_unit: 'w900:episode:2' },
			{ label: 'Episode 3', ranobe_unit: 'w900:episode:3' },
			// Season 2's EP. 1 is the work's EP. 4, not EP. 1 again.
			{ label: 'Episode 1', ranobe_unit: 'w900:episode:4' },
			{ label: 'Episode 2', ranobe_unit: 'w900:episode:5' }
		]);
		for (const n of [1, 2, 3]) markWatched(entryId(id, 1, n));
		markWatched(entryId(id, 2, 1));
		rb.refreshUnits('w900');
		const done = await rb.flush({ now: NOW });
		expect(done.read).toBe(4);
		const post = calls.find((c) => c.path === '/me/reads')!;
		expect((post.body as { reads: { unit: string }[] }).reads.map((r) => r.unit)).toEqual([
			'w900:episode:1',
			'w900:episode:2',
			'w900:episode:3',
			'w900:episode:4'
		]);
		expect((post.body as { backfill: boolean }).backfill).toBe(false);
	});
});

// ---- TRY AGAIN on one season's line (c424) ------------------------------------------------

describe('TRY AGAIN on a season’s line sends that season’s alone (c424)', () => {
	it('sends the season it names, and leaves another season’s wait for its own line', async () => {
		const id = show({
			seasons: [
				[1, 2],
				[1, 2]
			]
		});
		seasons.linkSeason(id, 1, 1, animeEntry(101), 'review', NOW);
		seasons.linkSeason(id, 2, 1, animeEntry(102), 'review', NOW);
		await signIn('anilist');
		markWatched(entryId(id, 1, 1));
		markWatched(entryId(id, 2, 1));
		tr.queueProgress(id, NOW);
		const waiting = () =>
			(
				db
					.prepare(`SELECT season FROM season_tracker_sends WHERE series_id = ? ORDER BY season`)
					.all(id) as { season: number }[]
			).map((r) => r.season);
		expect(waiting()).toEqual([1, 2]);
		sent = [];
		await tr.sendPending({ seriesId: id, season: 2, now: NOW });
		const saved = sent
			.filter((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))
			.map((s) => (s.body as { variables: { mediaId: number } }).variables.mediaId);
		expect(saved).toEqual([102]);
		expect(waiting()).toEqual([1]);
		// With no season named (a comic's line, SETTINGS), every wait goes.
		await tr.sendPending({ seriesId: id, now: NOW });
		expect(waiting()).toEqual([]);
	});
});
