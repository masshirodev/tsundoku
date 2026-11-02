import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ANILIST_CLIENT_ID = '42';
process.env.ANILIST_CLIENT_SECRET = 'al-secret';
process.env.MAL_CLIENT_ID = 'mal-id';
process.env.MAL_CLIENT_SECRET = 'mal-secret';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const cat = await import('$lib/server/catalogue');
const tr = await import('$lib/server/tracking');

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
	it('sends the owner to the catalogue with the registered address and a state', () => {
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
			// cleans to it: only the anime's may link (c298).
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
			expect(
				db.prepare(`SELECT via, anilist_id, format FROM series_links WHERE series_id = ?`).get(show)
			).toEqual({ via: 'list', anilist_id: 30024, format: 'TV' });
			expect(state(show, 'anilist')).toMatchObject({ status: 'reading', progress: 5, score: 8 });
			// The manga entry matched nothing: the manga series it names has its
			// own title, and it may not take the anime.
			expect(
				db.prepare(`SELECT COUNT(*) AS n FROM series_links WHERE via = 'list'`).get() as {
					n: number;
				}
			).toEqual({ n: 1 });
		} finally {
			db.prepare(`DELETE FROM series WHERE id = ?`).run(show);
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
			malAnime = [
				{
					node: { id: 52093 },
					list_status: { status: 'completed', score: 9, num_episodes_watched: 12 }
				}
			];
			await signIn('mal');
			await tr.readList('mal', NOW);
			expect(state(show, 'mal')).toMatchObject({ status: 'completed', progress: 12, score: 9 });
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
