import { spawn } from 'node:child_process';
import { videoKindsSql } from '../../library/kinds.ts';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from '../fspath.ts';
import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { coverDir, loadSharp } from '../covers.ts';
import { engineMedia, engineMediaPath } from '../engine/client.ts';
import { publicFetch, readCapped } from '../net-guard.ts';
import { frameAt, isBlankFrame, PICTURE_H, PICTURE_W } from '../../library/episode-pictures.ts';
import { hlsReaderArgs } from './hls-reader.ts';
import { loopback } from './loopback.ts';
import { episodeFile, episodeStreams, probe, videoOnly } from './streams.ts';

/**
 * Episode pictures (doc/ANIME.md, "Episode pictures"). Neither
 * KickAssAnime nor AnimePahe gives one, so an episode's picture is, best
 * first: the source's own (`thumb_url`, through the engine's /image/ proxy,
 * for an extension that sets one), else a frame of the downloaded file, else
 * a frame of one segment of the stream at its lowest quality. Each is kept as
 * covers/episodes/<id>.webp, stamped `thumb_at`. One at a time, in the
 * background: a frame of a stream costs a source call and a segment.
 *
 * ffmpeg fetches nothing itself, as for downloads: a stream is read through
 * the loopback proxy (loopback.ts), behind the same guard as the player.
 */

const FFMPEG = () => process.env.FFMPEG ?? 'ffmpeg';

/** A picture that couldn't be made isn't tried again for this long (a source down, a stream gone). */
export const RETRY_MS = 6 * 60 * 60 * 1000;
/** Between two episodes' pictures: a series of 25 shouldn't be 25 source calls at once. */
const PAUSE_MS = 1500;
/** A source's picture larger than this isn't one. */
const MAX_PICTURE = 10 * 1024 * 1024;

export const picturePath = (entryId: number) => join(coverDir(), 'episodes', `${entryId}.webp`);

/** The route the screens draw an episode's picture from; the stamp makes a new one a new address. */
export const pictureRoute = (entryId: number, thumbAt: number | null) =>
	thumbAt ? `/api/anime/thumb/${entryId}?v=${thumbAt}` : '';

type Row = {
	id: number;
	thumb_url: string;
	thumb_at: number | null;
	duration_s: number | null;
};

const rowOf = (db: Database.Database, entryId: number) =>
	db
		.prepare(
			`SELECT e.id, e.thumb_url, e.thumb_at, e.duration_s FROM entries e
			JOIN series s ON s.id = e.series_id WHERE e.id = ? AND ${videoKindsSql('s')}`
		)
		.get(entryId) as Row | undefined;

// ---- making one -----------------------------------------------------------------------------------

/** Any picture, cut to the episode's 16:9 at the list's size. */
async function still(input: Buffer): Promise<Buffer> {
	const s = await loadSharp();
	return s(input, { failOn: 'none', animated: false })
		.rotate()
		.resize({ width: PICTURE_W, height: PICTURE_H, fit: 'cover' })
		.webp({ quality: 78 })
		.toBuffer();
}

/** The source's own picture: through the engine when the engine named it, else from the site, internet only. */
async function sourcePicture(url: string): Promise<Buffer | null> {
	if (!/^https?:\/\//.test(url)) return null;
	const path = engineMediaPath(url);
	const res = path
		? await engineMedia(path, { timeoutMs: 30_000 })
		: await publicFetch(url, { signal: AbortSignal.timeout(30_000) });
	if (!res.ok) return null;
	if (!/^image\//i.test(res.headers.get('content-type') ?? 'image/')) return null;
	const body = await readCapped(res, MAX_PICTURE).catch(() => null);
	return body && body.length ? body : null;
}

/**
 * One frame as PNG: [input] a file or a loopback address, [at] seconds in.
 * [stream] is how to read a loopback address; a file needs neither.
 */
async function grab(
	input: string,
	at: number,
	stream?: { header: string; hls: boolean }
): Promise<Buffer> {
	const args = [
		'-hide_banner',
		'-loglevel',
		'error',
		...(stream ? ['-headers', `${stream.header}\r\n`] : []),
		// The proxy's segments have no extension (hls-reader.ts).
		...(stream?.hls ? await hlsReaderArgs(FFMPEG()) : []),
		// Before -i: ffmpeg seeks the input, so a stream fetches only the segment it lands in.
		'-ss',
		String(at),
		'-i',
		input,
		'-frames:v',
		'1',
		'-an',
		'-sn',
		'-f',
		'image2pipe',
		'-vcodec',
		'png',
		'pipe:1'
	];
	return new Promise((ok, no) => {
		const p = spawn(FFMPEG(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
		const out: Buffer[] = [];
		let err = '';
		p.stdout.on('data', (b: Buffer) => out.push(b));
		p.stderr.on('data', (b: Buffer) => (err += b.toString()));
		p.on('error', (e) => no(new Error(`ffmpeg didn't start: ${e.message}`)));
		p.on('close', (code) => {
			const png = Buffer.concat(out);
			if (code === 0 && png.length) ok(png);
			else no(new Error(err.trim().split('\n').pop() || 'ffmpeg took no frame'));
		});
	});
}

/** A frame that isn't a fade or a black card, trying further in; null when every try was blank. */
async function frame(
	input: string,
	durationS: number | null,
	stream?: { header: string; hls: boolean }
): Promise<Buffer | null> {
	const s = await loadSharp();
	for (let attempt = 0; ; attempt++) {
		const at = frameAt(durationS, attempt);
		if (at === null) return null;
		if (durationS && at >= durationS) continue;
		const png = await grab(input, at, stream).catch(() => null);
		if (!png) continue;
		const { channels } = await s(png).stats();
		if (!isBlankFrame(channels)) return png;
	}
}

/**
 * A frame of the stream: each server in the source's order, at its lowest
 * quality, through the loopback proxy, until one gives a frame (servers fail
 * all the time: doc/ANIME.md, "The player").
 */
async function streamFrame(entryId: number, durationS: number | null): Promise<Buffer | null> {
	// The server's own errand: reveal is the caller's to check, and was.
	const streams = await episodeStreams(entryId, true);
	const { port, secret } = await loopback();
	for (const server of streams?.servers ?? []) {
		const quality = server.qualities.at(-1);
		if (!quality) continue;
		const src = videoOnly(quality.src);
		const length = durationS ?? (await probe(src).catch(() => null))?.seconds ?? null;
		const png = await frame(`http://127.0.0.1:${port}${src}`, length, {
			header: `x-tsundoku: ${secret}`,
			hls: quality.kind === 'hls'
		});
		if (png) return png;
	}
	return null;
}

/**
 * Makes an episode's picture now, from the best place it can, and stamps it.
 * Returns where it came from, or null when nothing gave one.
 */
export async function makePicture(
	entryId: number,
	db: Database.Database = getDb(),
	now = Date.now()
): Promise<'source' | 'file' | 'stream' | null> {
	const row = rowOf(db, entryId);
	if (!row) return null;
	let made: { from: 'source' | 'file' | 'stream'; body: Buffer } | null = null;
	if (row.thumb_url) {
		const b = await sourcePicture(row.thumb_url).catch(() => null);
		const body = b ? await still(b).catch(() => null) : null;
		if (body) made = { from: 'source', body };
	}
	if (!made) {
		const file = episodeFile(entryId);
		const png = file ? await frame(file, row.duration_s) : null;
		if (png) made = { from: 'file', body: await still(png) };
	}
	if (!made) {
		const png = await streamFrame(entryId, row.duration_s).catch(() => null);
		if (png) made = { from: 'stream', body: await still(png) };
	}
	if (!made) return null;
	const path = picturePath(entryId);
	await mkdir(join(coverDir(), 'episodes'), { recursive: true });
	await writeFile(`${path}.partial`, made.body);
	await rename(`${path}.partial`, path);
	db.prepare(`UPDATE entries SET thumb_at = ? WHERE id = ?`).run(now, entryId);
	return made.from;
}

// ---- the queue --------------------------------------------------------------------------------------

const queue = new Set<number>();
const failedAt = new Map<number, number>();
let draining: Promise<void> | null = null;

/**
 * Asks for these episodes' pictures, in the background, one at a time: those
 * without one, and not tried and failed within RETRY_MS. The routes ask
 * (the series screen, the player, a download), never the functions they
 * call, so a test of those starts nothing in the background.
 */
export function wantPictures(entryIds: number[], db: Database.Database = getDb()): void {
	const now = Date.now();
	const missing = db.prepare(`SELECT thumb_at FROM entries WHERE id = ?`);
	for (const id of entryIds) {
		const at = failedAt.get(id);
		if (at !== undefined && now - at < RETRY_MS) continue;
		const r = missing.get(id) as { thumb_at: number | null } | undefined;
		if (r && r.thumb_at === null) queue.add(id);
	}
	if (queue.size && !draining)
		draining = drain(db).finally(() => {
			draining = null;
		});
}

async function drain(db: Database.Database): Promise<void> {
	while (queue.size) {
		const id = queue.values().next().value!;
		queue.delete(id);
		const r = db.prepare(`SELECT thumb_at FROM entries WHERE id = ?`).get(id) as
			{ thumb_at: number | null } | undefined;
		if (!r || r.thumb_at !== null) continue;
		const from = await makePicture(id, db).catch(() => null);
		if (from === null) failedAt.set(id, Date.now());
		else failedAt.delete(id);
		if (queue.size) await new Promise((ok) => setTimeout(ok, PAUSE_MS));
	}
}

/** Resolves when the queue is empty: tests wait on it. */
export const picturesIdle = () => draining ?? Promise.resolve();
