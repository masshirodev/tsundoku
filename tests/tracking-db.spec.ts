import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ANILIST_CLIENT_ID = '42';
process.env.ANILIST_CLIENT_SECRET = 'al-secret';
process.env.MAL_CLIENT_ID = 'mal-id';
process.env.MAL_CLIENT_SECRET = 'mal-secret';
// Ranobe's own fakes below: the two calls NEVER TRACKED must hold back.
process.env.RANOBE_TOKEN = 'rb_test';
process.env.RANOBE_URL = 'https://ranobe.test/api/v1';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const cat = await import('$lib/server/catalogue');
const tr = await import('$lib/server/tracking');
const seasonLinks = await import('$lib/server/season-links');
const { setSourceFlag } = await import('$lib/server/engine/source-flags');
const rb = await import('$lib/server/ranobe');

const db = getDb();
const NOW = Date.UTC(2026, 8, 25);
seedSample(db, NOW);
const ORIGIN = 'https://tsundoku.example:8443';

const idOf = (title: string) =>
	(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
const state = (id: number, service: string) =>
	db.prepare(`SELECT * FROM tracker_state WHERE series_id = ? AND service = ?`).get(id, service) as
		Record<string, unknown> | undefined;
const waiting = (id: number, service: string) =>
	db.prepare(`SELECT * FROM tracker_sends WHERE series_id = ? AND service = ?`).get(id, service) as
		Record<string, unknown> | undefined;

// ---- the catalogues, faked ---------------------------------------------------------------

type Sent = { url: string; body: unknown; auth: string | null };
let sent: Sent[] = [];
let alList: { mediaId: number; status: string; progress: number; score: number; media: unknown }[] =
	[];
let alAnime: typeof alList = [];
let malList: { node: { id: number }; list_status: Record<string, unknown> }[] = [];
let malAnime: typeof malList = [];
let malDown = false;

const media = (id: number, english: string, idMal: number | null = null) => ({
	id,
	idMal,
	format: 'MANGA',
	countryOfOrigin: 'KR',
	status: 'RELEASING',
	chapters: null,
	volumes: null,
	episodes: null,
	season: null,
	seasonYear: null,
	synonyms: [],
	title: { romaji: `Romaji ${id}`, english, native: null },
	startDate: { year: 2020 },
	coverImage: { extraLarge: `https://s4.anilist.co/${id}.jpg`, large: null }
});

/** An anime's entry, in AniList's other catalogue. */
const animeMedia = (id: number, english: string, idMal: number | null = null) => ({
	...media(id, english, idMal),
	format: 'TV',
	countryOfOrigin: 'JP',
	episodes: 24,
	season: 'FALL',
	seasonYear: 2024
});

const json = (d: unknown, status = 200) =>
	new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });

const fake: typeof fetch = async (input, init) => {
	const url = String(input);
	const raw = init?.body ? String(init.body) : '';
	const body = raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
	const auth = new Headers(init?.headers).get('authorization');
	sent.push({ url, body, auth });
	if (url === 'https://anilist.co/api/v2/oauth/token')
		return json({ access_token: 'al-token', expires_in: 31_536_000 });
	if (url === 'https://myanimelist.net/v1/oauth2/token')
		return json({ access_token: 'mal-token', refresh_token: 'mal-refresh', expires_in: 2_678_400 });
	if (url === 'https://graphql.anilist.co') {
		const q = (body as { query: string }).query;
		if (q.includes('Viewer')) return json({ data: { Viewer: { id: 7, name: 'masshiro' } } });
		if (q.includes('MediaListCollection'))
			return json({
				data: {
					MediaListCollection: {
						lists: [{ entries: q.includes('type: ANIME') ? alAnime : alList }]
					}
				}
			});
		if (q.includes('SaveMediaListEntry')) return json({ data: { SaveMediaListEntry: { id: 1 } } });
		return json({ data: null });
	}
	if (url.startsWith('https://api.myanimelist.net/v2')) {
		if (malDown) throw new TypeError('fetch failed');
		if (url.endsWith('/users/@me')) return json({ id: 9, name: 'masshiro' });
		if (url.includes('/users/@me/mangalist')) return json({ data: malList, paging: {} });
		// AniList's reader asks both lists; MAL's anime one is its own.
		if (url.includes('/users/@me/animelist')) return json({ data: malAnime, paging: {} });
		if (url.includes('/my_list_status')) return json({ status: 'reading' });
	}
	return json({}, 404);
};

beforeEach(() => {
	vi.stubGlobal('fetch', fake);
	cat.setAnilistFetch(fake);
	sent = [];
	alList = [];
	alAnime = [];
	malList = [];
	malAnime = [];
	malDown = false;
	for (const t of ['tracker_accounts', 'tracker_state', 'tracker_sends', 'series_links'])
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
	// The list is read in the background; here it's waited for, so it can't land mid-test.
	await listRead;
}

describe('signing in', () => {
	it('sends the user to the catalogue with the registered address and a state', () => {
		const al = new URL(tr.signInStart('anilist', ORIGIN).url);
		expect(al.origin + al.pathname).toBe('https://anilist.co/api/v2/oauth/authorize');
		expect(al.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/settings/catalogues/anilist`);
		const m = tr.signInStart('mal', ORIGIN);
		const u = new URL(m.url);
		// MAL's plain PKCE: the challenge is the verifier kept in the cookie.
		expect(u.searchParams.get('code_challenge_method')).toBe('plain');
		expect(m.keep.split('.')[1]).toBe(u.searchParams.get('code_challenge'));
	});

	it('refuses a way back that isn’t for the request it sent', async () => {
		const { keep } = tr.signInStart('anilist', ORIGIN);
		await expect(
			tr.signInFinish('anilist', ORIGIN, { code: 'c', state: 'someone-else', kept: keep })
		).rejects.toThrow();
		expect(tr.account('anilist')).toBeNull();
	});

	it('trades the code for a token, and keeps who signed in', async () => {
		await signIn('mal');
		expect(tr.account('mal')).toMatchObject({
			user_name: 'masshiro',
			refresh_token: 'mal-refresh'
		});
		const token = sent.find((s) => s.url.includes('myanimelist.net/v1/oauth2/token'))!;
		expect(token.body).toMatchObject({
			grant_type: 'authorization_code',
			code_verifier: expect.any(String)
		});
		tr.signOut('mal');
		expect(tr.account('mal')).toBeNull();
	});
});

describe('reading the lists', () => {
	it('links an AniList entry to its one series by title, with its score as the rating (1w)', async () => {
		const tog = idOf('Tower of God');
		db.prepare(`UPDATE series SET rating = 0 WHERE id = ?`).run(tog);
		alList = [
			{
				mediaId: 85143,
				status: 'CURRENT',
				progress: 590,
				score: 8,
				media: media(85143, 'Tower of God', 122663)
			}
		];
		await signIn('anilist');
		await tr.readList('anilist', NOW);
		expect(
			db.prepare(`SELECT via, anilist_id, mal_id FROM series_links WHERE series_id = ?`).get(tog)
		).toEqual({
			via: 'list',
			anilist_id: 85143,
			mal_id: 122663
		});
		expect(
			(db.prepare(`SELECT rating FROM series WHERE id = ?`).get(tog) as { rating: number }).rating
		).toBe(8);
		expect(state(tog, 'anilist')).toMatchObject({ status: 'reading', progress: 590, score: 8 });
	});

	it('keeps what MAL says of a linked series', async () => {
		const tog = idOf('Tower of God');
		cat.linkFromTracker(db, tog, { id: 122663, score: 0 }, NOW);
		malList = [
			{ node: { id: 122663 }, list_status: { status: 'on_hold', score: 7, num_chapters_read: 52 } }
		];
		await signIn('mal');
		await tr.readList('mal', NOW);
		expect(state(tog, 'mal')).toMatchObject({ status: 'on_hold', progress: 52, score: 7 });
	});

	it('reads an anime list too, and links an anime entry only to an anime series', async () => {
		const root = (
			db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number }
		).id;
		const show = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, origin_key, in_library)
					VALUES (?, 'Ranma ½ (2024)', 'anime', ?, 'aniyomi:9001:/ranma', 1)`
				)
				.run(root, NOW).lastInsertRowid
		);
		try {
			// Both lists carry an entry called Ranma ½, and the series' own title
			// cleans to it: only the anime's may link.
			alList = [
				{
					mediaId: 30023,
					status: 'CURRENT',
					progress: 407,
					score: 8,
					media: media(30023, 'Ranma ½', 23)
				}
			];
			alAnime = [
				{
					mediaId: 30024,
					status: 'CURRENT',
					progress: 5,
					score: 8,
					media: animeMedia(30024, 'Ranma ½', 23)
				}
			];
			await signIn('anilist');
			await tr.readList('anilist', NOW);
			// An anime's link is one season's: the entry already names the
			// season, so the row is the season table's, not the series' one.
			expect(
				db
					.prepare(
						`SELECT via, anilist_id, format, season FROM series_season_links WHERE series_id = ?`
					)
					.get(show)
			).toEqual({ via: 'list', anilist_id: 30024, format: 'TV', season: 0 });
			// And nothing at series level.
			expect(
				db.prepare(`SELECT via, anilist_id, mal_id FROM series_links WHERE series_id = ?`).get(show)
			).toBeUndefined();
			// What the list says of it is the season's row, as for manga.
			expect(
				db
					.prepare(
						`SELECT status, progress, score FROM season_tracker_state
						WHERE series_id = ? AND season = 0 AND part = 1 AND service = 'anilist'`
					)
					.get(show)
			).toMatchObject({ status: 'reading', progress: 5, score: 8 });
			// The manga entry matched nothing: the manga series it names has its
			// own title, and it may not take the anime. One link in all.
			expect(
				db.prepare(`SELECT COUNT(*) AS n FROM series_links WHERE via = 'list'`).get() as {
					n: number;
				}
			).toEqual({ n: 0 });
			expect(
				db.prepare(`SELECT COUNT(*) AS n FROM series_season_links WHERE via = 'list'`).get() as {
					n: number;
				}
			).toEqual({ n: 1 });
		} finally {
			db.prepare(`DELETE FROM series WHERE id = ?`).run(show);
		}
	});

	it('keeps MAL’s manga and anime state apart when both lists use id 23', async () => {
		const root = (
			db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number }
		).id;
		const add = (title: string, kind: string, key: string) =>
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, added_at, origin_key, in_library)
						VALUES (?, ?, ?, ?, ?, 1)`
					)
					.run(root, title, kind, NOW, key).lastInsertRowid
			);
		const manga = add('Ranma ½', 'manga', 'mihon:23:/ranma');
		const anime = add('Ranma ½ (1989)', 'anime', 'aniyomi:23:/ranma-1989');
		try {
			for (const id of [manga, anime])
				db.prepare(
					`INSERT INTO series_links (series_id, mal_id, via, linked_at, resolved_at, format)
					VALUES (?, 23, 'review', ?, ?, ?)`
				).run(id, NOW, NOW, id === anime ? 'TV' : 'MANGA');
			// MAL's manga and anime ids are separate sequences: both may be 23.
			malList = [
				{
					node: { id: 23 },
					list_status: { status: 'reading', score: 7, num_chapters_read: 40 }
				}
			];
			malAnime = [
				{
					node: { id: 23 },
					list_status: { status: 'completed', score: 9, num_episodes_watched: 5 }
				}
			];
			await signIn('mal');
			const read = await tr.readList('mal', NOW);
			expect(state(manga, 'mal')).toMatchObject({
				status: 'reading',
				progress: 40,
				score: 7
			});
			expect(state(anime, 'mal')).toMatchObject({
				status: 'completed',
				progress: 5,
				score: 9
			});
			// The rows read, not the map's size: a collision would hide one.
			expect(read.entries).toBe(2);
		} finally {
			db.prepare(`DELETE FROM series WHERE id IN (?, ?)`).run(manga, anime);
		}
	});

	it('files a wrong-kind link’s state under the entry’s own list', async () => {
		const root = (
			db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number }
		).id;
		// A manga the user linked to the anime's MAL entry: the id is on MAL's
		// anime list, so that is the row the sheet must show (never the manga's).
		const comic = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, origin_key, in_library)
					VALUES (?, 'Ranma ½ (2024)', 'manga', ?, 'mihon:23:/ranma-2024', 1)`
				)
				.run(root, NOW).lastInsertRowid
		);
		try {
			db.prepare(
				`INSERT INTO series_links (series_id, mal_id, via, linked_at, resolved_at, format)
				VALUES (?, 23, 'review', ?, ?, 'TV')`
			).run(comic, NOW, NOW);
			malList = [
				{
					node: { id: 23 },
					list_status: { status: 'reading', score: 7, num_chapters_read: 40 }
				}
			];
			malAnime = [
				{
					node: { id: 23 },
					list_status: { status: 'completed', score: 9, num_episodes_watched: 5 }
				}
			];
			await signIn('mal');
			await tr.readList('mal', NOW);
			expect(state(comic, 'mal')).toMatchObject({
				status: 'completed',
				progress: 5,
				score: 9
			});
			// The same link sends nothing: the entry on MAL is the anime's, and
			// an anime's id is a different sequence from the manga's, so a send
			// would write this series' chapters onto whatever manga holds it.
			expect(tr.editTracking(comic, { status: 'on_hold' }, NOW)).toBe(0);
			expect(
				db.prepare(`SELECT COUNT(*) AS n FROM tracker_sends WHERE series_id = ?`).get(comic)
			).toEqual({ n: 0 });
		} finally {
			db.prepare(`DELETE FROM series WHERE id = ?`).run(comic);
		}
	});

	it('reads MAL’s anime list, with the episode count as its progress', async () => {
		const root = (
			db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number }
		).id;
		const show = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, origin_key, in_library)
					VALUES (?, 'Trigun Stampede', 'anime', ?, 'aniyomi:9002:/trigun', 1)`
				)
				.run(root, NOW).lastInsertRowid
		);
		try {
			db.prepare(
				`INSERT INTO series_links (series_id, mal_id, via, linked_at, resolved_at, format)
				VALUES (?, 52093, 'review', ?, ?, 'TV')`
			).run(show, NOW, NOW);
			// MAL's anime list has its own words: `watching` is the one the user is
			// in almost every time, and the manga list never uses it.
			malAnime = [
				{
					node: { id: 52093 },
					list_status: { status: 'watching', score: 9, num_episodes_watched: 12 }
				}
			];
			await signIn('mal');
			await tr.readList('mal', NOW);
			expect(state(show, 'mal')).toMatchObject({ status: 'reading', progress: 12, score: 9 });
		} finally {
			db.prepare(`DELETE FROM series WHERE id = ?`).run(show);
		}
	});
});

describe('sending', () => {
	const linkTog = () => {
		const tog = idOf('Tower of God');
		db.prepare(
			`INSERT INTO series_links (series_id, anilist_id, mal_id, via, linked_at, resolved_at, format)
			VALUES (?, 85143, 122663, 'review', ?, ?, 'MANGA')`
		).run(tog, NOW, NOW);
		return tog;
	};

	it('sends the furthest chapter read, to both, and only forward', async () => {
		const tog = linkTog();
		await signIn('anilist');
		await signIn('mal');
		db.prepare(
			`INSERT INTO tracker_state (series_id, service, status, progress, read_at) VALUES (?, 'mal', 'reading', 999, ?)`
		).run(tog, NOW);
		sent = [];
		expect(tr.queueProgress(tog, NOW)).toBe(1); // MAL is ahead: AniList only
		expect(waiting(tog, 'mal')).toBeUndefined();
		await tr.sendPending({ now: NOW });
		const save = sent.find((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))!;
		expect(save.auth).toBe('Bearer al-token');
		expect((save.body as { variables: Record<string, unknown> }).variables).toMatchObject({
			mediaId: 85143,
			progress: 593,
			status: 'CURRENT'
		});
		expect(state(tog, 'anilist')).toMatchObject({ progress: 593, status: 'reading', sent_at: NOW });
		expect(waiting(tog, 'anilist')).toBeUndefined();
		// Nothing more read: nothing more to send.
		expect(tr.queueProgress(tog, NOW)).toBe(0);
	});

	it('keeps a send that failed, with why, for TRY AGAIN', async () => {
		const tog = linkTog();
		await signIn('mal');
		malDown = true;
		tr.queueProgress(tog, NOW);
		expect(await tr.sendPending({ now: NOW })).toEqual({ sent: 0, failed: 1 });
		expect(waiting(tog, 'mal')).toMatchObject({
			progress: 593,
			error: 'MAL DID NOT ANSWER',
			failed_at: NOW
		});
		malDown = false;
		expect(await tr.retry('mal')).toEqual({ sent: 1, failed: 0 });
		const patch = sent.findLast((s) => s.url.includes('/my_list_status'))!;
		expect(patch.body).toMatchObject({ num_chapters_read: '593', status: 'reading' });
	});

	it('sends status and score from the sheet, the score as AniList’s 100', async () => {
		const tog = linkTog();
		await signIn('anilist');
		tr.editTracking(tog, { status: 'on_hold', score: 9 }, NOW);
		await tr.sendPending({ now: NOW });
		const save = sent.findLast((s) => JSON.stringify(s.body).includes('SaveMediaListEntry'))!;
		expect((save.body as { variables: Record<string, unknown> }).variables).toMatchObject({
			status: 'PAUSED',
			scoreRaw: 90
		});
		expect(state(tog, 'anilist')).toMatchObject({ status: 'on_hold', score: 9 });
	});

	it('sends nothing for a hidden series, a cover-only link, or a novel', async () => {
		const tog = linkTog();
		await signIn('anilist');
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(tog);
		expect(tr.queueProgress(tog, NOW)).toBe(0);
		db.prepare(`UPDATE series SET hidden = 0 WHERE id = ?`).run(tog);
		db.prepare(`UPDATE series_links SET format = 'NOVEL' WHERE series_id = ?`).run(tog);
		expect(tr.queueProgress(tog, NOW)).toBe(0);
		const novel = idOf('Mushoku Tensei');
		db.prepare(
			`INSERT INTO series_links (series_id, anilist_id, via, linked_at, resolved_at, format)
			VALUES (?, 1, 'review', ?, ?, 'NOVEL')`
		).run(novel, NOW, NOW);
		expect(tr.queueProgress(novel, NOW)).toBe(0);
	});

	it('sends nothing for a series from a NEVER TRACKED source, and drops what waited', async () => {
		const tog = linkTog();
		await signIn('anilist');
		// The series' own source, as an engine key names it; the seed writes none.
		db.prepare(`UPDATE series SET origin_key = 'mihon:100:/manga/tog' WHERE id = ?`).run(tog);
		try {
			// A send queued before the switch went on: it is what must not go out.
			expect(tr.queueProgress(tog, NOW)).toBe(1);
			expect(waiting(tog, 'anilist')).toMatchObject({ progress: 593 });
			setSourceFlag('100', 'neverTracked', true);
			sent = [];
			// The drain checks the flag again, and drops the row rather than keep it.
			expect(await tr.sendPending({ seriesId: tog, now: NOW })).toEqual({
				sent: 0,
				failed: 0
			});
			expect(sent).toEqual([]);
			expect(waiting(tog, 'anilist')).toBeUndefined();
			// And it is not queued again: progress, status and score all find no target.
			expect(tr.queueProgress(tog, NOW)).toBe(0);
			expect(tr.editTracking(tog, { status: 'on_hold', score: 9 }, NOW)).toBe(0);
			expect(waiting(tog, 'anilist')).toBeUndefined();
			expect(tr.trackingOf(tog)).toMatchObject({ neverTracked: true });
		} finally {
			setSourceFlag('100', 'neverTracked', false);
			db.prepare(`UPDATE series SET origin_key = NULL WHERE id = ?`).run(tog);
		}
		// Switched off again: nothing is sent retroactively, since the drain dropped
		// the row (a new read queues again and is sent, as any read is).
		sent = [];
		expect(await tr.sendPending({ seriesId: tog, now: NOW })).toEqual({ sent: 0, failed: 0 });
		expect(sent).toEqual([]);
		expect(tr.trackingOf(tog)).toMatchObject({ neverTracked: false });
	});

	it('shows what it knows on the TRACKING row', async () => {
		const tog = linkTog();
		await signIn('anilist');
		tr.queueProgress(tog, NOW);
		await tr.sendPending({ now: NOW });
		const t = tr.trackingOf(tog)!;
		expect(t.facts.find((f) => f.service === 'anilist')).toMatchObject({
			signedIn: true,
			state: { progress: 593 },
			sentAt: NOW
		});
		expect(t.facts.find((f) => f.service === 'mal')).toMatchObject({ signedIn: false });
		expect(tr.accounts().find((a) => a.service === 'mal')).toMatchObject({
			userName: null,
			linked: 1
		});
	});
});

describe('a season’s other part speaks for the list signed in', () => {
	/** A season entry as a search answers it: part 1 and part 2 are AniList's two entries. */
	const part = (id: number, mal: number, episodes: number) => ({
		anilistId: id,
		malId: mal,
		title: `Entry ${id}`,
		alts: [] as string[],
		format: 'TV',
		country: 'JP',
		year: 2024,
		chapters: null,
		volumes: null,
		episodes,
		season: 'FALL',
		seasonYear: 2024,
		status: 'FINISHED',
		coverUrl: ''
	});

	it('shows MAL’s word for the other part with AniList signed out, and AniList’s once it is back', async () => {
		const root = (
			db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number }
		).id;
		const show = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, origin_key, in_library)
					VALUES (?, 'Two Part Lantern', 'anime', ?, 'aniyomi:9003:/two-part', 1)`
				)
				.run(root, NOW).lastInsertRowid
		);
		const ep = db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, season, episode_number, duration_s)
			VALUES (?, ?, ?, ?, 1, ?, 1440)`
		);
		for (let n = 1; n <= 23; n++) ep.run(show, n, `Episode ${n}`, NOW, n);
		try {
			// One season of 23 at the source, 12 + 11 on the catalogues.
			expect(seasonLinks.linkSeason(show, 1, 1, part(301, 701, 12), 'review', NOW)).toBe(true);
			expect(seasonLinks.linkSeason(show, 1, 2, part(302, 702, 11), 'review', NOW)).toBe(true);
			// Both lists read through their own APIs: AniList says part 2 is
			// planned, MAL that it is watched to EP. 4.
			alAnime = [
				{ mediaId: 301, status: 'CURRENT', progress: 3, score: 0, media: animeMedia(301, 'P1') },
				{ mediaId: 302, status: 'PLANNING', progress: 0, score: 0, media: animeMedia(302, 'P2') }
			];
			malAnime = [
				{
					node: { id: 701 },
					list_status: { status: 'watching', score: 0, num_episodes_watched: 3 }
				},
				{
					node: { id: 702 },
					list_status: { status: 'watching', score: 0, num_episodes_watched: 4 }
				}
			];
			await signIn('anilist');
			await signIn('mal');
			db.prepare(`UPDATE entries SET read_at = ? WHERE series_id = ? AND episode_number <= 3`).run(
				NOW,
				show
			);
			const other = () => tr.trackingOf(show)!.seasons![0].other;
			const main = () => tr.trackingOf(show)!.seasons![0];
			// Both signed in: AniList is the main list, for both parts.
			expect(main().part).toBe(1);
			expect(other()).toMatchObject({ part: 2, state: 'planning', progress: 0 });
			// AniList signed out keeps what it said (signOut), and MAL now leads.
			tr.signOut('anilist');
			expect(
				db
					.prepare(
						`SELECT status FROM season_tracker_state WHERE series_id = ? AND part = 2 AND service = 'anilist'`
					)
					.get(show)
			).toEqual({ status: 'planning' });
			expect(other()).toMatchObject({ part: 2, state: 'reading', progress: 4 });
			// Signed back in: AniList's word again, and no stale MAL word on the right.
			await signIn('anilist');
			expect(other()).toMatchObject({ part: 2, state: 'planning', progress: 0 });
			// Neither signed in: the rule falls back to AniList, as the line does.
			tr.signOut('anilist');
			tr.signOut('mal');
			expect(other()).toMatchObject({ part: 2, state: 'planning', progress: 0 });
		} finally {
			for (const t of ['season_tracker_state', 'season_tracker_sends', 'series_season_links'])
				db.prepare(`DELETE FROM ${t} WHERE series_id = ?`).run(show);
			db.prepare(`DELETE FROM entries WHERE series_id = ?`).run(show);
			db.prepare(`DELETE FROM series WHERE id = ?`).run(show);
		}
	});
});

// ---- Ranobe, faked: NEVER TRACKED's two calls ------------------------------

type RanobeCall = { method: string; path: string; body: unknown };
let ranobeCalls: RanobeCall[] = [];
/** The works these cases link: no edition in English, so an offer would be made. */
const RANOBE_WORKS: Record<string, { ref: string; title: string; editions: unknown[] }> = {
	wNT: {
		ref: 'wNT',
		title: 'Never Tracked',
		editions: [{ ref: 'eNT-ja', lang: 'ja', origin: 'original', format: 'bunkobon', units: {} }]
	},
	wNT2: { ref: 'wNT2', title: 'Shared Unit', editions: [] }
};
const ranobeFake: typeof fetch = async (input, init) => {
	const url = new URL(String(input));
	const path = url.pathname.replace('/api/v1', '');
	const method = init?.method ?? 'GET';
	const body = init?.body ? JSON.parse(String(init.body)) : undefined;
	ranobeCalls.push({ method, path, body });
	const work = path.match(/^\/works\/([\w-]+)$/);
	if (work)
		return RANOBE_WORKS[work[1]]
			? json(RANOBE_WORKS[work[1]])
			: json({ error: { code: 'not_found', message: 'not_found', details: {} } }, 404);
	if (path === '/bundles' && method === 'POST')
		return json(
			{ bundle: 91, status: 'pending', items: [{ key: 'edition', ref: null, status: 'pending' }] },
			201
		);
	if (path === '/bundles/91')
		return json({
			bundle: 91,
			status: 'pending',
			items: [{ key: 'edition', ref: null, status: 'pending' }]
		});
	if (path === '/me/reads' && method === 'POST')
		return json({ recorded: (body.reads as unknown[]).length, duplicates: 0, entries: [] });
	if (path.startsWith('/me/reads/') && method === 'DELETE')
		return json({ removed: 1, progress: null });
	return json({});
};
rb.setRanobeFetch(ranobeFake);

describe('Ranobe: a NEVER TRACKED source sends nothing', () => {
	const MUSHOKU = idOf('Mushoku Tensei');
	const KEN = idOf('Tensei Shitara Ken Deshita');

	const linkRanobe = (seriesId: number, work: string, volume: string | null) =>
		db
			.prepare(
				`INSERT INTO ranobe_links (series_id, work, edition, lang, volume, via, title, linked_at)
				VALUES (?, ?, NULL, 'en', ?, 'lookup', '', ?)`
			)
			.run(seriesId, work, volume, NOW);
	const clear = (work: string, ...seriesIds: number[]) => {
		db.prepare(`DELETE FROM ranobe_links WHERE work = ?`).run(work);
		db.prepare(`DELETE FROM ranobe_suggestions WHERE work = ?`).run(work);
		db.prepare(`DELETE FROM ranobe_units WHERE work = ?`).run(work);
		for (const id of seriesIds) {
			db.prepare(`UPDATE series SET origin_key = NULL WHERE id = ?`).run(id);
			db.prepare(`UPDATE entries SET ranobe_unit = NULL WHERE series_id = ?`).run(id);
		}
	};
	const posts = () => ranobeCalls.filter((c) => c.method === 'POST');
	const postsTo = (path: string) => posts().filter((c) => c.path === path);

	beforeEach(() => {
		ranobeCalls = [];
	});

	it('offers no edition for a work only its never-tracked series links, and lists its volumes for no one', async () => {
		setSourceFlag('301', 'neverTracked', true);
		db.prepare(`UPDATE series SET origin_key = 'mihon:301:/novel/mushoku' WHERE id = ?`).run(
			MUSHOKU
		);
		linkRanobe(MUSHOKU, 'wNT', '5');
		try {
			// Only the never-tracked series wants it: the step does not even ask.
			const out = await rb.resolveEditions(NOW);
			expect(out).toEqual({ found: 0, suggested: 0, waiting: 0 });
			expect(ranobeCalls).toEqual([]);

			// A visible series of the same work, same language, wants it too: the
			// lookup and the offer happen, but never for the flagged series' volume.
			linkRanobe(KEN, 'wNT', '2');
			const shared = await rb.resolveEditions(NOW);
			expect(shared.suggested).toBe(1);
			expect(postsTo('/bundles')).toHaveLength(1);
			const reason = (postsTo('/bundles')[0].body as { reason: string }).reason;
			expect(reason).toContain('volumes 2');
			expect(reason).not.toContain('5');
		} finally {
			setSourceFlag('301', 'neverTracked', false);
			clear('wNT', MUSHOKU, KEN);
		}
	});

	it('does not read a unit through another series that shares it', async () => {
		setSourceFlag('302', 'neverTracked', true);
		db.prepare(`UPDATE series SET origin_key = 'mihon:302:/novel/mushoku' WHERE id = ?`).run(
			MUSHOKU
		);
		linkRanobe(MUSHOKU, 'wNT2', null);
		linkRanobe(KEN, 'wNT2', null);
		const entry = (seriesId: number, position: number) =>
			(
				db
					.prepare(`SELECT id FROM entries WHERE series_id = ? AND position = ?`)
					.get(seriesId, position) as { id: number }
			).id;
		// Two copies of one volume, mapped onto the same unit; only one is read.
		const mine = entry(MUSHOKU, 20);
		const theirs = entry(KEN, 1);
		db.prepare(`UPDATE entries SET ranobe_unit = 'wNT2:volume:5' WHERE id IN (?, ?)`).run(
			mine,
			theirs
		);
		db.prepare(`UPDATE entries SET read_at = ? WHERE id = ?`).run(NOW, mine);
		try {
			rb.refreshUnits('wNT2');
			expect(
				db.prepare(`SELECT read_at FROM ranobe_units WHERE unit = 'wNT2:volume:5'`).get()
			).toEqual({ read_at: null });
			const out = await rb.flush({ now: NOW });
			expect(out.read).toBe(0);
			// The other copy keeps the unit live, but nothing was read there.
			expect(postsTo('/me/reads')).toEqual([]);
		} finally {
			db.prepare(`UPDATE entries SET read_at = NULL WHERE id IN (?, ?)`).run(mine, theirs);
			setSourceFlag('302', 'neverTracked', false);
			clear('wNT2', MUSHOKU, KEN);
		}
	});

	it('takes back a read already sent, once only, when the other copy leaves it unread', async () => {
		// The decision written in doc/RANOBE.md: a unit sent before the switch is
		// withdrawn (a DELETE), because leaving it would keep the never-tracked
		// read on Ranobe; sent_at is cleared, so it is not withdrawn twice.
		setSourceFlag('303', 'neverTracked', true);
		db.prepare(`UPDATE series SET origin_key = 'mihon:303:/novel/mushoku' WHERE id = ?`).run(
			MUSHOKU
		);
		linkRanobe(MUSHOKU, 'wNT2', null);
		linkRanobe(KEN, 'wNT2', null);
		const entry = (seriesId: number, position: number) =>
			(
				db
					.prepare(`SELECT id FROM entries WHERE series_id = ? AND position = ?`)
					.get(seriesId, position) as { id: number }
			).id;
		const mine = entry(MUSHOKU, 20);
		const theirs = entry(KEN, 1);
		db.prepare(`UPDATE entries SET ranobe_unit = 'wNT2:volume:6' WHERE id IN (?, ?)`).run(
			mine,
			theirs
		);
		db.prepare(`UPDATE entries SET read_at = ? WHERE id = ?`).run(NOW, mine);
		db.prepare(
			`INSERT INTO ranobe_units (unit, work, read_at, sent_at) VALUES ('wNT2:volume:6', 'wNT2', ?, ?)`
		).run(NOW - 1000, NOW - 2000);
		try {
			rb.refreshUnits('wNT2');
			await rb.flush({ now: NOW });
			expect(ranobeCalls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
				'/me/reads/wNT2%3Avolume%3A6'
			]);
			expect(postsTo('/me/reads')).toEqual([]);
			expect(
				db.prepare(`SELECT read_at, sent_at FROM ranobe_units WHERE unit = 'wNT2:volume:6'`).get()
			).toEqual({ read_at: null, sent_at: null });
			// The next pass has nothing left to withdraw.
			ranobeCalls = [];
			rb.refreshUnits('wNT2');
			await rb.flush({ now: NOW });
			expect(ranobeCalls).toEqual([]);
		} finally {
			db.prepare(`UPDATE entries SET read_at = NULL WHERE id IN (?, ?)`).run(mine, theirs);
			setSourceFlag('303', 'neverTracked', false);
			clear('wNT2', MUSHOKU, KEN);
		}
	});
});
