import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 't';
const work = mkdtempSync(join(tmpdir(), 'tsundoku-anime-source-'));
process.env.LIBRARY_ROOT = join(work, 'library');
process.env.ENGINE_STORE = join(work, 'store');
process.env.COVER_DIR = join(work, 'covers');
afterAll(() => rmSync(work, { recursive: true, force: true }));

const { getDb } = await import('$lib/server/db');
const browse = await import('$lib/server/engine/browse');
const downloads = await import('$lib/server/downloads');
const animeFollow = await import('$lib/server/anime/follow');
const queue = await import('$lib/server/engine/queue');
const { forgetSourceUse } = await import('$lib/server/library-sources');

// An Aniyomi source on the engine (doc/ANIME.md; card c154): the same
// questions a Mihon source answers, under their anime names, and an anime
// added as a series of episodes by season.
const ANIME = '7000';
const MANGA = '100';
type Call = { method: string; sourceId: string; animeData?: { url: string }; mangaData?: unknown };
let calls: Call[] = [];
/** Episodes the source lists past the four ADD saw: FOLLOW's test adds to it. */
let later: { url: string; name: string; episode_number: number }[] = [];
let server: Server;
const show = (i: number) => ({
	url: `/anime/${i}`,
	title: `Show ${i}`,
	status: 1,
	// A site's own /image/ path (KickAssAnime's posters) is the site's, not the engine's.
	thumbnail_url:
		i === 0 ? 'http://127.0.0.1:8080/image/tok0' : `https://kaa.example/image/poster/${i}.webp`
});

beforeAll(async () => {
	server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as Call;
			calls.push(b);
			const json = (v: unknown) =>
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			switch (b.method) {
				case 'getPopularAnime':
					return json({ animes: [show(0), show(1)], hasNextPage: false });
				case 'getSearchAnime':
					return json({ animes: [show(2)], hasNextPage: false });
				case 'supportLatestAnime':
					return json(true);
				case 'filterSchemaAnime':
					return json([{ type: 'select', name: 'Season', state: 0, values: ['All', 'Fall'] }]);
				case 'getDetailsAnime':
					return json({
						url: b.animeData!.url,
						title: 'Tsukiakari no Ryokōsha',
						description: ' Travellers. ',
						genre: 'Adventure, Slice of Life',
						author: 'Studio Lantern',
						status: 1,
						thumbnail_url: 'https://cdn.example/cover.jpg'
					});
				case 'getEpisodeList':
					// Newest first, seasons flattened and named, as the engine does.
					return json([
						...later,
						{ url: '/e/s2-2', name: 'Season 2 - Episode 2 - Salt Road', episode_number: 2 },
						{ url: '/e/s2-1', name: 'Season 2 - Episode 1', episode_number: 1 },
						{ url: '/e/s1-2', name: 'Season 1 - Episode 2: The Ferry', episode_number: 2 },
						{ url: '/e/s1-1', name: 'Season 1 - Episode 1', episode_number: -1 }
					]);
			}
			res.writeHead(404).end('{"error":"no","code":404}');
		});
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	process.env.ENGINE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
});

const db = getDb();
for (const [pkg, kind, name] of [
	['e2e.anime', 'anime', 'AnimePahe'],
	['e2e.manga', 'manga', 'Open Source']
])
	db.prepare(
		`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
		VALUES (?, ?, ?, 1, '1.0', '16', ?, 0, 0, '')`
	).run(pkg, name, kind, pkg.padEnd(64, '0'));
for (const [pkg, id, name] of [
	['e2e.anime', ANIME, 'AnimePahe'],
	['e2e.manga', MANGA, 'Open Source']
])
	db.prepare(
		`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://example.org')`
	).run(id, pkg, name);

beforeEach(() => {
	calls = [];
	browse.forgetAll();
	forgetSourceUse();
});

describe('an anime source in BROWSE', () => {
	it('lists under ANIME, and is asked its anime names for the same questions', async () => {
		expect(browse.browseList(false).anime.map((r) => r.id)).toEqual([ANIME]);
		const got = await browse.shelf(ANIME, 'popular', { pages: 1, reveal: false });
		expect(got.hits.map((h) => h.title)).toEqual(['Show 0', 'Show 1']);
		// The engine's proxy as for a manga; a site's picture through the server.
		expect(got.hits[0].cover).toBe('/api/downloads/engine-image/tok0');
		expect(got.hits[1].cover).toMatch(/^\/api\/browse\/novel-cover\//);
		expect(await browse.supportsLatest(ANIME)).toBe(true);
		expect((await browse.filterSchema(ANIME)).map((f) => f.name)).toEqual(['Season']);
		expect(calls.map((c) => c.method)).toEqual([
			'getPopularAnime',
			'supportLatestAnime',
			'filterSchemaAnime'
		]);
	});
});

describe('SAME TITLE (2026-10-29)', () => {
	it('is never a manga of the same name: an adaptation isn’t a copy from elsewhere', async () => {
		const { ensureNamedRoot } = await import('$lib/server/import/write');
		const root = ensureNamedRoot(db, 'Mihon', join(work, 'mihon'), false);
		const manga = db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key) VALUES (?, 'Show 0', 'manga', 0, ?)`
			)
			.run(root, `mihon:${MANGA}:/manga/show-0`).lastInsertRowid;
		forgetSourceUse();
		try {
			const got = await browse.shelf(ANIME, 'popular', { pages: 1, reveal: true });
			expect(got.hits.find((h) => h.title === 'Show 0')?.match).toEqual({ kind: 'new' });
		} finally {
			db.prepare(`DELETE FROM series WHERE id = ?`).run(manga);
			forgetSourceUse();
		}
	});
});

describe('an anime, previewed and added', () => {
	const id = `${ANIME}~${Buffer.from('/anime/1').toString('base64url')}`;

	it('previews its episodes, newest first, by season, saying EPISODES', async () => {
		const m = (await downloads.sourceManga(id))!;
		expect(m.kind).toBe('anime');
		expect(m.title).toBe('Tsukiakari no Ryokōsha');
		expect(m.chapters.map((c) => c.name)).toEqual([
			'S2 · Ep. 2 · Salt Road',
			'S2 · Ep. 1',
			'S1 · Ep. 2 · The Ferry',
			'S1 · Ep. 1'
		]);
		expect(calls.find((c) => c.method === 'getEpisodeList')?.animeData?.url).toBe('/anime/1');
		expect(await downloads.mangaKey(id)).toBe(`aniyomi:${ANIME}:/anime/1`);
	});

	it('adds an anime series, every episode NOT DOWNLOADED, numbered within its season', async () => {
		const seriesId = await downloads.addToLibrary(id);
		const s = db
			.prepare(`SELECT kind, source, origin_key, root_id FROM series WHERE id = ?`)
			.get(seriesId);
		expect(s).toMatchObject({
			kind: 'anime',
			source: 'AnimePahe',
			origin_key: `aniyomi:${ANIME}:/anime/1`
		});
		const root = db
			.prepare(`SELECT name, path FROM roots WHERE id = ?`)
			.get((s as { root_id: number }).root_id);
		expect(root).toEqual({ name: 'Anime', path: join(work, 'library', 'Anime') });
		expect(
			db
				.prepare(
					`SELECT position, label, title, source_url, season, episode_number, available FROM entries
					WHERE series_id = ? ORDER BY position`
				)
				.all(seriesId)
		).toEqual([
			{
				position: 1,
				label: 'Ep. 1',
				title: '',
				source_url: '/e/s1-1',
				season: 1,
				episode_number: 1,
				available: 0
			},
			{
				position: 2,
				label: 'Ep. 2',
				title: 'The Ferry',
				source_url: '/e/s1-2',
				season: 1,
				episode_number: 2,
				available: 0
			},
			{
				position: 3,
				label: 'Ep. 1',
				title: '',
				source_url: '/e/s2-1',
				season: 2,
				episode_number: 1,
				available: 0
			},
			{
				position: 4,
				label: 'Ep. 2',
				title: 'Salt Road',
				source_url: '/e/s2-2',
				season: 2,
				episode_number: 2,
				available: 0
			}
		]);
		// Added again: the same series, not a second.
		expect(await downloads.addToLibrary(id)).toBe(seriesId);
		// Now IN LIBRARY when its source lists it.
		forgetSourceUse();
		browse.forgetAll();
		const again = await browse.shelf(ANIME, 'popular', { pages: 1, reveal: false });
		expect(again.hits[1].match).toMatchObject({ kind: 'in-library', seriesId });
	});

	it('is searched with the library’s other sources', async () => {
		const sources = await downloads.searchSources(false);
		expect(sources.map((s) => s.id)).toContain(ANIME);
		const hits = await downloads.searchSource(ANIME, 'show', false);
		expect(hits.map((h) => h.title)).toEqual(['Show 2']);
		expect(calls.at(-1)?.method).toBe('getSearchAnime');
	});

	it('is followed: its source asked at once and every six hours, new episodes made and queued (c158)', async () => {
		const seriesId = await downloads.addToLibrary(id);
		await downloads.setFollowed(seriesId, true);
		await expect.poll(() => animeFollow.animeCheckedAt(seriesId)).not.toBeNull();
		const d = await downloads.seriesDownloads(seriesId, []);
		expect(d.kind === 'ok' && d.follow.on).toBe(true);
		later = [{ url: '/e/s2-3', name: 'Season 2 - Episode 3 - A Letter', episode_number: 3 }];
		const at = animeFollow.animeCheckedAt(seriesId)!;
		// Not due for six hours.
		expect(await animeFollow.followAnime(at + 60_000)).toEqual({ series: 0, queued: 0 });
		expect(await animeFollow.followAnime(at + 7 * 3600_000)).toEqual({ series: 1, queued: 1 });
		const e = db
			.prepare(
				`SELECT id, position, label, title, season, episode_number FROM entries WHERE source_url = '/e/s2-3'`
			)
			.get() as { id: number; position: number };
		expect(e).toMatchObject({
			position: 5,
			label: 'Ep. 3',
			title: 'A Letter',
			season: 2,
			episode_number: 3
		});
		expect(queue.queueRows(db).map((r) => [r.entryId, r.kind])).toEqual([[e.id, 'anime']]);
		db.exec('DELETE FROM download_queue');
		await downloads.setFollowed(seriesId, false);
		expect(await animeFollow.followAnime(at + 14 * 3600_000)).toEqual({ series: 0, queued: 0 });
	});

	it('is refreshed without following: new episodes become entries, and nothing is queued (c220)', async () => {
		const seriesId = await downloads.addToLibrary(id);
		db.exec('DELETE FROM download_queue');
		later = [
			{ url: '/e/s2-4', name: 'Season 2 - Episode 4 - A Letter', episode_number: 4 },
			{ url: '/e/s2-3', name: 'Season 2 - Episode 3 - A Letter', episode_number: 3 }
		];
		const { refreshSeries } = await import('$lib/server/refresh');
		expect(await refreshSeries(seriesId)).toEqual({ kind: 'anime', added: 1 });
		const e = db
			.prepare(
				`SELECT id, position, label, title, season FROM entries WHERE source_url = '/e/s2-4'`
			)
			.get() as { id: number; position: number };
		expect(e).toMatchObject({ position: 6, label: 'Ep. 4', title: 'A Letter', season: 2 });
		// A look, not a fetch: FOLLOW stays the only thing that queues.
		expect(queue.queueRows(db)).toEqual([]);
		const d = await downloads.seriesDownloads(seriesId, []);
		expect(d.kind === 'ok' && d.refreshable).toBe(true);
		expect(d.kind === 'ok' && d.follow.on).toBe(false);
		expect(await refreshSeries(seriesId)).toEqual({ kind: 'anime', added: 0 });
		later = [];
	});
});
