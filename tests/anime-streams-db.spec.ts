import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 'engine-secret';

// An episode's streams through tsundoku (doc/ANIME.md, "Streams"; card c155):
// a fake engine whose videos are its own /video/ proxy (as AnimePahe's are)
// and a site's playlist with headers (as KickAssAnime's are), behind a fake web.
const SOURCE = '7000';
let engineSeen: { url: string; auth: string; range: string }[] = [];
let siteSeen: { url: string; referer: string }[] = [];
let videoAnswer: unknown[] = [];
let server: Server;
// What the engine itself hands out: its loopback address, inside its container.
const ENGINE_SELF = 'http://127.0.0.1:34567';

beforeAll(async () => {
	server = createServer((req, res) => {
		engineSeen.push({
			url: req.url ?? '',
			auth: req.headers.authorization ?? '',
			range: (req.headers.range as string) ?? ''
		});
		if (req.url === '/video/master.m3u8')
			return res
				.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' })
				.end(
					[
						'#EXTM3U',
						'#EXT-X-STREAM-INF:BANDWIDTH=2300000,RESOLUTION=1920x1080',
						`${ENGINE_SELF}/video/v1080.m3u8`
					].join('\n')
				);
		if (req.url === '/video/v1080.m3u8')
			return res
				.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' })
				.end(
					[
						'#EXTM3U',
						'#EXTINF:600,',
						`${ENGINE_SELF}/video/seg0`,
						'#EXTINF:840,',
						`${ENGINE_SELF}/video/seg1`,
						'#EXT-X-ENDLIST'
					].join('\n')
				);
		if (req.url === '/video/seg0') {
			const body = Buffer.from([0x47, 1, 2, 3, 4, 5, 6, 7]);
			if (req.headers.range === 'bytes=2-3')
				return res
					.writeHead(206, {
						'content-type': 'video/mp2t',
						'content-range': 'bytes 2-3/8',
						'content-length': '2'
					})
					.end(body.subarray(2, 4));
			return res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': '8' }).end(body);
		}
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as { method: string };
			if (b.method === 'getVideoList')
				return res
					.writeHead(200, { 'content-type': 'application/json' })
					.end(JSON.stringify(videoAnswer));
			res.writeHead(404).end('{}');
		});
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	process.env.ENGINE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
});

// The web: site.example is on the internet; inside.example is the workstation's own network.
vi.mock('node:dns/promises', () => ({
	lookup: async (host: string) => [
		{ address: host === 'inside.example' ? '10.0.0.5' : '93.184.215.14', family: 4 }
	]
}));
const realFetch = globalThis.fetch;
vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	if (!url.startsWith('https://site.example/')) return realFetch(input, init);
	siteSeen.push({ url, referer: new Headers(init?.headers).get('referer') ?? '' });
	if (url.endsWith('/master.m3u8'))
		return new Response(
			[
				'#EXTM3U',
				'#EXTINF:12,',
				'seg/0.jpg',
				'#EXTINF:12,',
				'http://inside.example/seg/1.jpg',
				'#EXT-X-ENDLIST'
			].join('\n'),
			{ headers: { 'content-type': 'application/x-mpegurl' } }
		);
	if (url.endsWith('/seg/0.jpg'))
		return new Response(new Uint8Array([0x47, 9]), { headers: { 'content-type': 'image/jpeg' } });
	if (url.endsWith('/en.srt')) return new Response('1\n00:00:01,000 --> 00:00:02,000\nHello\n');
	return new Response('no', { status: 404 });
});

const { getDb } = await import('$lib/server/db');
const { ensureRoot } = await import('$lib/server/import/write');
const streams = await import('$lib/server/anime/streams');

const db = getDb();
db.prepare(
	`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
	VALUES ('e2e.anime', 'AnimePahe', 'anime', 1, '1.0', '16', ?, 0, 0, '')`
).run('e2e.anime'.padEnd(64, '0'));
db.prepare(
	`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, 'e2e.anime', 'AnimePahe', 'en', 'https://site.example')`
).run(SOURCE);
const root = ensureRoot(db, 'Anime', '/nowhere/Anime', false);
const series = (hidden: number) =>
	Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, hidden) VALUES (?, 'Show', 'anime', 0, ?, ?)`
			)
			.run(root, `aniyomi:${SOURCE}:/show/${hidden}`, hidden).lastInsertRowid
	);
const episode = (seriesId: number) =>
	Number(
		db
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, source_url) VALUES (?, 1, 'Ep. 1', 0, '/ep/1')`
			)
			.run(seriesId).lastInsertRowid
	);
const shown = episode(series(0));
const hidden = episode(series(1));

const text = async (src: string, range: string | null = null) => {
	const token = src.split('/').pop()!;
	const r = await streams.serveMedia(token, range);
	return {
		status: r.status,
		type: r.headers.get('content-type'),
		body: Buffer.from(await r.arrayBuffer())
	};
};

videoAnswer = [
	{
		quality: 'Kwik - 1080p',
		videoUrl: `${ENGINE_SELF}/video/master.m3u8`,
		timestamps: [
			{ start: 85, end: 175, name: 'Opening', type: 'Opening' },
			{ start: 1290, end: 1380, name: 'Ending', type: 'Ending' }
		]
	},
	{
		quality: 'Vidstream - 720p',
		videoUrl: 'https://site.example/hls/master.m3u8',
		headers: { namesAndValues$okhttp: ['Referer', 'https://site.example/watch'] },
		subtitleTracks: [{ url: 'https://site.example/subs/en.srt', lang: 'English' }]
	}
];

describe('an episode’s streams', () => {
	it('are servers whose every address is tsundoku’s, its opening and ending kept', async () => {
		const s = (await streams.episodeStreams(shown, false))!;
		expect(s.servers.map((x) => [x.n, x.name, x.qualities.map((q) => q.label)])).toEqual([
			[1, 'Kwik', ['1080p']],
			[2, 'Vidstream', ['720p']]
		]);
		expect(s.intro).toEqual({ start: 85, end: 175 });
		expect(s.ending).toEqual({ start: 1290, end: 1380 });
		expect(db.prepare(`SELECT ending_at FROM entries WHERE id = ?`).get(shown)).toEqual({
			ending_at: 1290
		});
		const json = JSON.stringify(s);
		expect(json).not.toMatch(/127\.0\.0\.1|site\.example|engine-secret/);
		expect(s.servers[1].qualities[0].subtitles).toEqual([
			{ lang: 'EN', src: expect.stringMatching(/^\/api\/anime\/subtitle\/[A-Za-z0-9_-]{32}$/) }
		]);
	});

	it('are a 404 for a hidden series with reveal off', async () => {
		expect(await streams.episodeStreams(hidden, false)).toBeNull();
		expect(await streams.episodeStreams(hidden, true)).not.toBeNull();
	});

	it('come through the engine’s proxy with its token, playlists rewritten and segments streamed, Range and all', async () => {
		const s = (await streams.episodeStreams(shown, false))!;
		engineSeen = [];
		const master = await text(s.servers[0].qualities[0].src);
		expect(master.type).toBe('application/vnd.apple.mpegurl');
		const variant = master.body
			.toString()
			.split('\n')
			.find((l) => l.startsWith('/api/'))!;
		expect(master.body.toString()).not.toContain('127.0.0.1');
		const media = await text(variant);
		const seg = media.body
			.toString()
			.split('\n')
			.filter((l) => l.startsWith('/api/'));
		expect(seg).toHaveLength(2);
		const whole = await text(seg[0]);
		expect([...whole.body]).toEqual([0x47, 1, 2, 3, 4, 5, 6, 7]);
		const part = await text(seg[0], 'bytes=2-3');
		expect(part.status).toBe(206);
		expect([...part.body]).toEqual([2, 3]);
		expect(engineSeen.map((c) => c.url)).toEqual([
			'/video/master.m3u8',
			'/video/v1080.m3u8',
			'/video/seg0',
			'/video/seg0'
		]);
		expect(engineSeen.every((c) => c.auth === 'Bearer engine-secret')).toBe(true);
		expect(engineSeen[3].range).toBe('bytes=2-3');
	});

	it('come from the site with the source’s headers, never into the workstation, subtitles as WebVTT', async () => {
		const s = (await streams.episodeStreams(shown, false))!;
		siteSeen = [];
		const master = await text(s.servers[1].qualities[0].src);
		const [ok, inside] = master.body
			.toString()
			.split('\n')
			.filter((l) => l.startsWith('/api/'));
		expect((await text(ok)).body.length).toBe(2);
		await expect(text(inside)).rejects.toMatchObject({ status: 502 });
		expect(siteSeen.map((r) => [r.url, r.referer])).toEqual([
			['https://site.example/hls/master.m3u8', 'https://site.example/watch'],
			['https://site.example/hls/seg/0.jpg', 'https://site.example/watch']
		]);
		const vtt = await streams.serveSubtitle(
			s.servers[1].qualities[0].subtitles[0].src.split('/').pop()!
		);
		expect(vtt.headers.get('content-type')).toMatch(/^text\/vtt/);
		expect(await vtt.text()).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHello\n');
	});

	it('never take a site’s loopback address for the engine’s', async () => {
		videoAnswer = [{ quality: '1080p', videoUrl: 'https://site.example/evil/master.m3u8' }];
		const s = (await streams.episodeStreams(shown, false, true))!;
		const token = streams.register({
			url: `${ENGINE_SELF}/video/master.m3u8`,
			headers: {},
			engine: false
		});
		engineSeen = [];
		await expect(streams.serveMedia(token, null)).rejects.toMatchObject({ status: 502 });
		expect(engineSeen).toEqual([]);
		expect(s.servers).toHaveLength(1);
	});

	it('say how long and how heavy a stream is, from its playlists', async () => {
		videoAnswer = [{ quality: 'Kwik - 1080p', videoUrl: `${ENGINE_SELF}/video/master.m3u8` }];
		const s = (await streams.episodeStreams(shown, false, true))!;
		expect(await streams.probe(s.servers[0].qualities[0].src)).toEqual({
			seconds: 1440,
			bandwidth: 2300000
		});
	});
});
