import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

// Before anything imports db.ts or data-dirs.ts: both read these once.
process.env.DATABASE_PATH = ':memory:';
const work = mkdtempSync(join(tmpdir(), 'tsundoku-sprites-'));
const covers = join(work, 'covers');
const shows = join(work, 'shows');
process.env.COVER_DIR = covers;
afterAll(() => rmSync(work, { recursive: true, force: true }));

// A downloaded episode's seek preview (doc/ANIME.md, "The player"; card
// c385): the real ffmpeg cuts one frame every 10 s from the file into one
// sheet, beside the episode's picture, and a sheet of a file that changed is
// never served. The episodes are synthesised here: ffmpeg's test picture with
// its hue turning, so the tiles of different moments can be told apart.
function encode(path: string, seconds: number, colour?: string): void {
	execFileSync('ffmpeg', [
		'-loglevel',
		'error',
		'-y',
		'-f',
		'lavfi',
		'-i',
		colour
			? `color=c=${colour}:size=320x180:rate=12:duration=${seconds}`
			: // The hue turns 90 degrees every 10 s, so each tile is another colour.
				`testsrc2=size=320x180:rate=12:duration=${seconds},hue=h=t*9`,
		'-c:v',
		'libvpx-vp9',
		'-g',
		'24',
		'-deadline',
		'realtime',
		'-cpu-used',
		'8',
		path
	]);
}

const { getDb } = await import('$lib/server/db');
const sprites = await import('$lib/server/anime/sprites');
const streams = await import('$lib/server/anime/streams');
const route = await import('../src/routes/api/anime/sprite/[entry]/+server');
const videos = await import('../src/routes/api/anime/episode/[entry]/videos/+server');
const { INCOGNITO_COOKIE, REVEAL_COOKIE, revealValue } = await import('$lib/server/prefs');

const db = getDb();
const root = Number(
	db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Anime', ?, 0)`).run(shows)
		.lastInsertRowid
);
let n = 0;
const series = (hidden = 0) => {
	const dir = join(shows, `show-${++n}`);
	execFileSync('mkdir', ['-p', dir]);
	const id = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, hidden, path) VALUES (?, ?, 'anime', 0, ?, ?, ?)`
			)
			.run(root, `Show ${n}`, `aniyomi:7200:/show/${n}`, hidden, dir).lastInsertRowid
	);
	return { id, dir };
};
const episode = (s: { id: number; dir: string }, file: string) =>
	Number(
		db
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, source_url, file, available)
				VALUES (?, 1, 'Ep. 1', 0, '/ep/1', ?, ?)`
			)
			.run(s.id, file, file ? 1 : 0).lastInsertRowid
	);

/** The route's answer, as the player's browser would get it; reveal on or off. */
async function served(id: number, reveal = false): Promise<number> {
	const cookies = {
		get: (k: string) => (reveal && k === REVEAL_COOKIE ? revealValue(undefined) : undefined)
	};
	try {
		const res = await route.GET({ params: { entry: String(id) }, cookies } as never);
		return res.status;
	} catch (e) {
		return (e as { status?: number }).status ?? 500;
	}
}

/** The mean colour of one tile of a sheet. */
async function tile(path: string, i: number, w = 160, h = 90, cols = 10) {
	// stats() reads the input, not the pipeline: the tile is cut out first.
	const cut = await sharp(path)
		.extract({ left: (i % cols) * w, top: Math.floor(i / cols) * h, width: w, height: h })
		.toBuffer();
	const { channels } = await sharp(cut).stats();
	return channels.slice(0, 3).map((c) => Math.round(c.mean));
}

let shown: { id: number; dir: string };
let ep: number;
beforeAll(() => {
	shown = series();
	encode(join(shown.dir, 'ep1.webm'), 35);
	ep = episode(shown, 'ep1.webm');
});

describe('a downloaded episode’s sprite', () => {
	it('is one sheet of a frame every 10 s, 160 x 90, ten to a row', async () => {
		const made = await sprites.makeSprite(ep, 1_800_000_000_000);
		expect(made).toEqual({
			src: `/api/anime/sprite/${ep}?v=1800000000000`,
			everyS: 10,
			w: 160,
			h: 90,
			cols: 10,
			count: 4
		});
		const meta = await sharp(sprites.spritePath(ep)).metadata();
		expect(meta.format).toBe('jpeg');
		expect([meta.width, meta.height]).toEqual([1600, 90]);
		// Four different moments of the episode, not one frame four times; the
		// tiles past the count are the tile filter's black.
		const tiles = await Promise.all([0, 1, 2, 3, 4].map((i) => tile(sprites.spritePath(ep), i)));
		expect(new Set(tiles.slice(0, 4).map(String)).size).toBe(4);
		// Each of the four is a picture, the last mark's included (ffmpeg's fps
		// filter drops the last one at the end of the input unless told not to).
		for (const t of tiles.slice(0, 4)) expect(Math.max(...t)).toBeGreaterThan(30);
		expect(tiles[4]).toEqual([0, 0, 0]);
	});

	it('is kept beside the episode’s picture, and named to the player with the file’s quality', async () => {
		expect(sprites.spritePath(ep)).toBe(join(covers, 'episodes', `${ep}.sprite.jpg`));
		const s = await streams.episodeStreams(ep, false);
		expect(s?.servers[0].name).toBe('DOWNLOADED');
		expect(s?.servers[0].qualities[0].sprite).toMatchObject({ count: 4, everyS: 10 });
		expect(await served(ep)).toBe(200);
	});

	it('is not made again while the file is the same', async () => {
		const again = await sprites.makeSprite(ep, 1_900_000_000_000);
		expect(again?.src).toBe(`/api/anime/sprite/${ep}?v=1800000000000`);
	});

	it('is forgotten when the file changes under it, and made again from the new one', async () => {
		// A re-download: the same name, another cut of the episode.
		encode(join(shown.dir, 'ep1.webm'), 22, 'red');
		utimesSync(join(shown.dir, 'ep1.webm'), new Date(), new Date(Date.now() + 5000));
		expect(await sprites.currentSprite(ep)).toBeNull();
		expect(existsSync(sprites.spritePath(ep))).toBe(false);
		expect(await served(ep)).toBe(404);
		expect((await streams.episodeStreams(ep, false))?.servers[0].qualities[0].sprite).toBeNull();
		const made = await sprites.makeSprite(ep, 1_800_000_100_000);
		expect(made?.count).toBe(3);
		// Red at every mark, the 20 s one too: 22 s is where ffmpeg's fps filter
		// would drop the last frame at the end of the input.
		for (const i of [0, 1, 2]) {
			const [r, g, b] = await tile(sprites.spritePath(ep), i);
			expect(r, `tile ${i}`).toBeGreaterThan(200);
			expect(g).toBeLessThan(40);
			expect(b).toBeLessThan(40);
		}
	});

	it('is forgotten when the download is deleted', async () => {
		const s = series();
		encode(join(s.dir, 'gone.webm'), 12);
		const id = episode(s, 'gone.webm');
		expect(await sprites.makeSprite(id)).not.toBeNull();
		db.prepare(`UPDATE entries SET available = 0, file = '' WHERE id = ?`).run(id);
		expect(await sprites.currentSprite(id)).toBeNull();
		expect(existsSync(sprites.spritePath(id))).toBe(false);
	});

	it('is asked for by the player’s resolve, and never in incognito', async () => {
		const resolve = (id: number, incognito: boolean) =>
			videos.GET({
				params: { entry: String(id) },
				cookies: { get: (k: string) => (incognito && k === INCOGNITO_COOKIE ? '1' : undefined) },
				url: new URL(`http://x/api/anime/episode/${id}/videos`)
			} as never);
		const s = series();
		encode(join(s.dir, 'a.webm'), 12);
		const quiet = episode(s, 'a.webm');
		expect((await resolve(quiet, true)).status).toBe(200);
		await sprites.spritesIdle();
		expect(existsSync(sprites.spritePath(quiet))).toBe(false);
		// The first play: the answer has no sprite yet (the time alone), and
		// the background makes it; the next resolve names it.
		const first = (await (await resolve(quiet, false)).json()) as {
			servers: { qualities: { sprite?: unknown }[] }[];
		};
		expect(first.servers[0].qualities[0].sprite).toBeNull();
		await sprites.spritesIdle();
		expect(existsSync(sprites.spritePath(quiet))).toBe(true);
		const next = (await (await resolve(quiet, false)).json()) as typeof first;
		expect(next.servers[0].qualities[0].sprite).toMatchObject({ count: 2 });
	});

	it('is never made for a streamed episode, from the background either', async () => {
		const id = episode(series(), '');
		expect(await sprites.makeSprite(id)).toBeNull();
		sprites.wantSprite(id);
		await sprites.spritesIdle();
		expect(existsSync(sprites.spritePath(id))).toBe(false);
	});

	it('is made in the background for a hidden series too, and served only with reveal on', async () => {
		const secret = series(1);
		encode(join(secret.dir, 'quiet.webm'), 15);
		const id = episode(secret, 'quiet.webm');
		sprites.wantSprite(id);
		await sprites.spritesIdle();
		expect(existsSync(sprites.spritePath(id))).toBe(true);
		expect((await sprites.currentSprite(id))?.count).toBe(2);
		expect(await served(id, false)).toBe(404);
		expect(await served(id, true)).toBe(200);
	});
});
