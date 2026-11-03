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
		if (q.includes('MediaListCollection'))
			return json({ data: { MediaListCollection: { lists: [{ entries: [] }] } } });
		if (q.includes('SaveMediaListEntry')) return json({ data: { SaveMediaListEntry: { id: 1 } } });
		return json({ data: null });
	}
	if (url.startsWith('https://api.myanimelist.net/v2')) {
		if (url.endsWith('/users/@me')) return json({ id: 9, name: 'masshiro' });
		if (url.includes('/users/@me/mangalist')) return json({ data: [], paging: {} });
		if (url.includes('/users/@me/animelist')) return json({ data: [], paging: {} });
		if (url.includes('/my_list_status')) return json({ status: 'watching' });
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
		expect((save.body as { variables: Record<string, unknown> }).variables).toMatchObject({
			mediaId: 102,
			progress: 5
		});
		const patch = sent.find((s) => s.url.includes('/my_list_status'))!;
		expect(patch.url).toBe('https://api.myanimelist.net/v2/anime/502/my_list_status');
		expect(patch.body).toMatchObject({ num_watched_episodes: '5' });
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
		expect(t.seasons?.[0].facts.find((f) => f.service === 'anilist')).toMatchObject({
			state: { status: 'reading', progress: 4 }
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
