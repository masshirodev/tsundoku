import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Before anything imports db.ts or data-dirs.ts: both read these once.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 'engine-secret';
const covers = mkdtempSync(join(tmpdir(), 'tsundoku-pictures-'));
process.env.COVER_DIR = covers;

// Episode pictures (doc/ANIME.md, "Episode pictures"; card c225): the
// source's own through the engine's /image/ proxy, else a frame of the
// downloaded file, else a frame of the stream through the loopback proxy.
// A fake engine serves a picture, the fixture clip as a video, and the list.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'video');
const CLIP = join(FIXTURES, 'clip.webm');
const SOURCE = '7100';
const ENGINE_SELF = 'http://127.0.0.1:34567';
let picture: Buffer;
let videoAsks = 0;
let server: Server;

beforeAll(async () => {
	picture = await sharp({
		create: { width: 640, height: 360, channels: 3, background: { r: 200, g: 40, b: 90 } }
	})
		.composite([
			{
				input: await sharp({
					create: { width: 320, height: 180, channels: 3, background: { r: 20, g: 180, b: 220 } }
				})
					.png()
					.toBuffer(),
				left: 0,
				top: 0
			}
		])
		.png()
		.toBuffer();
	server = createServer((req, res) => {
		if (req.headers.authorization !== 'Bearer engine-secret') return res.writeHead(401).end();
		if (req.url === '/image/pic1')
			return res.writeHead(200, { 'content-type': 'image/png' }).end(picture);
		if (req.url === '/image/gone') return res.writeHead(404).end();
		if (req.url === '/video/clip.webm') {
			const size = statSync(CLIP).size;
			const m = /^bytes=(\d+)-(\d*)$/.exec((req.headers.range as string) ?? '');
			if (!m)
				return createReadStream(CLIP).pipe(
					res.writeHead(200, {
						'content-type': 'video/webm',
						'content-length': String(size),
						'accept-ranges': 'bytes'
					})
				);
			const start = Number(m[1]);
			const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
			return createReadStream(CLIP, { start, end }).pipe(
				res.writeHead(206, {
					'content-type': 'video/webm',
					'content-length': String(end - start + 1),
					'content-range': `bytes ${start}-${end}/${size}`,
					'accept-ranges': 'bytes'
				})
			);
		}
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as { method: string };
			if (b.method === 'getVideoList') {
				videoAsks++;
				return res.writeHead(200, { 'content-type': 'application/json' }).end(
					JSON.stringify([
						// Server 1 sends nothing; the frame comes from server 2.
						{ quality: 'Broken - 360p', videoUrl: `${ENGINE_SELF}/video/broken.webm` },
						{ quality: 'Kwik - 360p', videoUrl: `${ENGINE_SELF}/video/clip.webm` }
					])
				);
			}
			res.writeHead(404).end('{}');
		});
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	process.env.ENGINE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
	rmSync(covers, { recursive: true, force: true });
});

const { getDb } = await import('$lib/server/db');
const { ensureRoot } = await import('$lib/server/import/write');
const pictures = await import('$lib/server/anime/pictures');
const { GET } = await import('../src/routes/api/anime/thumb/[entry]/+server');

const db = getDb();
db.prepare(
	`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
	VALUES ('t.anime', 'Kwik', 'anime', 1, '1.0', '16', ?, 0, 0, '')`
).run('t.anime'.padEnd(64, '0'));
db.prepare(
	`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, 't.anime', 'Kwik', 'en', 'https://site.example')`
).run(SOURCE);
const root = ensureRoot(db, 'Anime', '/nowhere/Anime', false);
let n = 0;
const series = (opts: { hidden?: number; path?: string } = {}) =>
	Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, hidden, path) VALUES (?, 'Show', 'anime', 0, ?, ?, ?)`
			)
			.run(root, `aniyomi:${SOURCE}:/show/${++n}`, opts.hidden ?? 0, opts.path ?? '')
			.lastInsertRowid
	);
const episode = (seriesId: number, cols: { thumb_url?: string; file?: string } = {}) =>
	Number(
		db
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, source_url, thumb_url, file, available, duration_s)
				VALUES (?, 1, 'Ep. 1', 0, ?, ?, ?, ?, 8)`
			)
			.run(seriesId, `/ep/${++n}`, cols.thumb_url ?? '', cols.file ?? '', cols.file ? 1 : 0)
			.lastInsertRowid
	);
const stamp = (id: number) =>
	(db.prepare(`SELECT thumb_at FROM entries WHERE id = ?`).get(id) as { thumb_at: number | null })
		.thumb_at;
const size = async (id: number) => {
	const m = await sharp(pictures.picturePath(id)).metadata();
	return [m.format, m.width, m.height];
};
const cookies = (reveal: boolean) =>
	({ get: (k: string) => (k === 'tsundoku_reveal' && reveal ? '1' : undefined) }) as never;
// A refusal is SvelteKit's error(), thrown: read as its status.
const ask = async (id: number, reveal = false): Promise<Response | { status: number }> => {
	try {
		return await GET({ params: { entry: String(id) }, cookies: cookies(reveal) } as never);
	} catch (e) {
		return { status: (e as { status: number }).status };
	}
};

describe('an episode’s picture', () => {
	it('is the source’s own, through the engine, cut to 16:9 at the list’s size', async () => {
		const id = episode(series(), { thumb_url: `${ENGINE_SELF}/image/pic1` });
		const asked = videoAsks;
		expect(await pictures.makePicture(id, db, 1234)).toBe('source');
		expect(stamp(id)).toBe(1234);
		expect(await size(id)).toEqual(['webp', 320, 180]);
		// The source gave one: nothing of the stream was asked for.
		expect(videoAsks).toBe(asked);
	});

	it('is a frame of the downloaded file when the source gives none', async () => {
		const id = episode(series({ path: FIXTURES }), { file: 'clip.webm' });
		const asked = videoAsks;
		expect(await pictures.makePicture(id, db)).toBe('file');
		expect(await size(id)).toEqual(['webp', 320, 180]);
		expect(videoAsks).toBe(asked);
	});

	it('is a frame of the stream, the next server where one sends nothing, when there is no file', async () => {
		const id = episode(series());
		const asked = videoAsks;
		expect(await pictures.makePicture(id, db)).toBe('stream');
		expect(await size(id)).toEqual(['webp', 320, 180]);
		expect(videoAsks).toBe(asked + 1);
	});

	it('falls through a source picture that no longer answers to a frame', async () => {
		const id = episode(series({ path: FIXTURES }), {
			thumb_url: `${ENGINE_SELF}/image/gone`,
			file: 'clip.webm'
		});
		expect(await pictures.makePicture(id, db)).toBe('file');
	});

	it('is never fetched from the workstation’s own network for a site', async () => {
		const id = episode(series({ path: FIXTURES }), {
			thumb_url: 'http://10.0.0.5/pic.png',
			file: 'clip.webm'
		});
		// The site's address is refused by the guard; the file's frame stands in.
		expect(await pictures.makePicture(id, db)).toBe('file');
	});

	it('is asked for in the background only where there is none yet', async () => {
		const has = episode(series(), { thumb_url: `${ENGINE_SELF}/image/pic1` });
		await pictures.makePicture(has, db, 99);
		const none = episode(series(), { thumb_url: `${ENGINE_SELF}/image/pic1` });
		pictures.wantPictures([has, none], db);
		await pictures.picturesIdle();
		expect(stamp(has)).toBe(99);
		expect(stamp(none)).not.toBeNull();
	});

	it('is served under a version, and a hidden series’ is a 404 with reveal off', async () => {
		const shown = episode(series(), { thumb_url: `${ENGINE_SELF}/image/pic1` });
		await pictures.makePicture(shown, db, 5);
		expect(pictures.pictureRoute(shown, 5)).toBe(`/api/anime/thumb/${shown}?v=5`);
		expect(pictures.pictureRoute(shown, null)).toBe('');
		const r = (await ask(shown)) as Response;
		expect(r.status).toBe(200);
		expect(r.headers.get('content-type')).toBe('image/webp');
		expect(r.headers.get('cache-control')).toContain('immutable');

		const hidden = episode(series({ hidden: 1 }), { thumb_url: `${ENGINE_SELF}/image/pic1` });
		await pictures.makePicture(hidden, db);
		expect((await ask(hidden)).status).toBe(404);
		expect((await ask(hidden, true)).status).toBe(200);

		// A file without a stamp (an id that came round again) is never shown.
		const stale = episode(series());
		expect(existsSync(pictures.picturePath(stale))).toBe(false);
		expect((await ask(stale)).status).toBe(404);
	});
});
