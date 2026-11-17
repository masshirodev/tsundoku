import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromaprintSkip } from './helpers/chromaprint';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 'engine-secret';

// Fingerprints of streams (doc/ANIME.md, "Openings and endings"):
// the same two episodes, read through the loopback proxy at the lowest
// quality at most 480p, from a separate audio rendition, and only for the
// episodes a player is about to reach.
const work = mkdtempSync(join(tmpdir(), 'tsundoku-stream-fingerprint-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
// A box with no chromaprint at all skips the cases that fingerprint.
const noPrint = chromaprintSkip('anime-stream-fingerprint-db', FFMPEG) !== null;
const noise = (name: string, seconds: number, seed: number) => {
	const file = join(work, name);
	execFileSync(
		FFMPEG,
		[
			'-loglevel',
			'error',
			'-f',
			'lavfi',
			'-i',
			`anoisesrc=color=pink:duration=${seconds}:seed=${seed}`,
			'-c:a',
			'libopus',
			'-b:a',
			'32k',
			file
		],
		{ stdio: 'ignore' }
	);
	return file;
};
const concat = (name: string, parts: string[]) => {
	const file = join(work, name);
	execFileSync(
		FFMPEG,
		[
			'-loglevel',
			'error',
			...parts.flatMap((p) => ['-i', p]),
			'-filter_complex',
			`${parts.map((_, i) => `[${i}:a]`).join('')}concat=n=${parts.length}:v=0:a=1[out]`,
			'-map',
			'[out]',
			'-c:a',
			'libopus',
			'-b:a',
			'32k',
			file
		],
		{ stdio: 'ignore' }
	);
	return file;
};
const hlsDir = join(work, 'hls');
const hlsAudio = (name: string, input: string, bitrate: string) => {
	const dir = join(hlsDir, name);
	mkdirSync(dir, { recursive: true });
	execFileSync(
		FFMPEG,
		[
			'-loglevel',
			'error',
			'-i',
			input,
			'-vn',
			'-c:a',
			'aac',
			'-b:a',
			bitrate,
			'-f',
			'hls',
			'-hls_time',
			'2',
			'-hls_list_size',
			'0',
			join(dir, 'index.m3u8')
		],
		{ stdio: 'ignore' }
	);
};

const SOURCE = '7010';
let server: Server;
let self = '';
let seen: string[] = [];

// Encoding the fixtures took 130 s at a load of 40, past 120 s's limit.
beforeAll(async () => {
	const op = noise('op.mka', 20, 41);
	const ed = noise('ed.mka', 20, 43);
	const a = concat('ep-a.mka', [op, noise('mid-a.mka', 300, 100), ed]);
	const b = concat('ep-b.mka', [op, noise('mid-b.mka', 300, 200), ed]);
	hlsAudio('ep-a/low', a, '32k');
	hlsAudio('ep-b/low', b, '32k');
	hlsAudio('ep-a/high', a, '128k');
	// The same two episodes for a source that names no height, and one that
	// offers nothing at or below 480p.
	hlsAudio('n1', a, '32k');
	hlsAudio('n2', b, '32k');
	hlsAudio('k1', a, '32k');
	hlsAudio('k2', b, '32k');
	hlsAudio('h1', a, '32k');
	hlsAudio('h2', b, '32k');
	// Three servers: only the last has a 360p audio to read.
	hlsAudio('x1', a, '32k');
	hlsAudio('x2', b, '32k');
	server = createServer((req, res) => {
		seen.push(req.url ?? '');
		if (req.headers.authorization !== 'Bearer engine-secret') return res.writeHead(401).end();
		const file = /^\/video\/hls\/([a-z0-9/-]+\.(?:m3u8|ts))$/.exec(req.url ?? '');
		if (file) {
			const path = join(hlsDir, file[1]);
			if (!existsSync(path)) return res.writeHead(404).end('gone');
			return res
				.writeHead(200, {
					'content-type': file[1].endsWith('.m3u8')
						? 'application/vnd.apple.mpegurl'
						: 'video/mp2t',
					'content-length': String(statSync(path).size)
				})
				.end(readFileSync(path));
		}
		if (req.url === '/video/broken.webm') return res.writeHead(404).end('gone');
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const body = JSON.parse(raw || '{}') as {
				method: string;
				episodeData?: { url?: string };
			};
			if (body.method !== 'getVideoList') return res.writeHead(404).end('{}');
			const kind = /\/ep\/([a-z0-9]+)/.exec(body.episodeData?.url ?? '')?.[1] ?? 'a';
			const pair = kind === 'b' ? 'ep-b' : 'ep-a';
			const audio = (dir: string) => ({
				url: `${self}/video/hls/${dir}/index.m3u8`,
				lang: 'Japanese'
			});
			// KickAssAnime's live answer: one server, "VidStreaming",
			// three qualities, each with the source's own words and a height in
			// them, and a separate audio rendition per language.
			const kaaBody = (kind: string) =>
				[
					['1080p (1920x1080) - 3.52 Mbps', `${kind}/high`],
					['720p (1280x720) - 1.31 Mbps', `${kind}/mid`],
					['360p (640x360) - 506 kbps', kind]
				].map(([label, dir]) => ({
					quality: `VidStreaming - ${label}`,
					videoUrl: `${self}/video/broken.webm`,
					audioTracks: [audio(dir)]
				}));
			// A 1080p-only server first, one that names no height second, and
			// the 360p one last: the ranking, not the source's order, picks it
			//. The first two point at audio that is not there, so a read
			// of either shows in the request log.
			const ranked = (kind: string) =>
				[
					['Hd - 1080p', `${kind}/high`],
					['Mirror - Default', `${kind}/unknown`],
					['Low - 360p', kind]
				].map(([quality, dir]) => ({
					quality,
					videoUrl: `${self}/video/broken.webm`,
					audioTracks: [audio(dir)]
				}));
			const videos = kind.startsWith('k')
				? kaaBody(kind)
				: kind.startsWith('x')
					? ranked(kind)
					: kind === 'n1' || kind === 'n2'
						? [
								{
									quality: 'VidStreaming - Default',
									videoUrl: `${self}/video/broken.webm`,
									audioTracks: [audio(kind)]
								}
							]
						: kind === 'h1' || kind === 'h2'
							? [
									{
										quality: 'VidStreaming - 1080p (1920x1080) - 3.52 Mbps',
										videoUrl: `${self}/video/broken.webm`,
										audioTracks: [audio(kind)]
									},
									{
										quality: 'VidStreaming - 720p (1280x720) - 1.31 Mbps',
										videoUrl: `${self}/video/broken.webm`,
										audioTracks: [audio(kind)]
									}
								]
							: [
									{
										quality: 'High - 1080p',
										videoUrl: `${self}/video/broken.webm`,
										audioTracks: [audio('ep-a/high')]
									},
									{
										quality: 'Broken - 360p',
										videoUrl: `${self}/video/broken.webm`,
										audioTracks: [audio('missing')]
									},
									{
										quality: 'Kwik - 360p',
										videoUrl: `${self}/video/broken.webm`,
										audioTracks: [audio(`${pair}/low`)]
									}
								];
			res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(videos));
		});
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	self = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	process.env.ENGINE_URL = self;
}, 300_000);
afterAll(async () => {
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
});

const { getDb } = await import('$lib/server/db');
const { ensureRoot } = await import('$lib/server/import/write');
const marks = await import('$lib/server/anime/marks');
const { fingerprintSeason, streamTargets } = await import('$lib/server/anime/skip-marks');

const db = getDb();
db.prepare(
	`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
	VALUES ('e2e.stream', 'Kwik', 'anime', 1, '1.0', '16', ?, 0, 0, '')`
).run('e2e.stream'.padEnd(64, '0'));
db.prepare(
	`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, 'e2e.stream', 'Kwik', 'en', 'https://site.example')`
).run(SOURCE);
const root = ensureRoot(db, 'Anime', '/nowhere/Anime', false);
let n = 0;
const series = () =>
	Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, hidden)
				VALUES (?, ?, 'anime', 0, ?, 0)`
			)
			.run(root, `Stream Show ${++n}`, `aniyomi:${SOURCE}:/show/stream-${n}`).lastInsertRowid
	);
let position = 0;
const episode = (seriesId: number, name?: string) =>
	Number(
		db
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, source_url, season, episode_number,
					duration_s, available, file)
				VALUES (?, ?, 'Ep.', 0, ?, 1, ?, 340, 0, '')`
			)
			.run(
				seriesId,
				++position,
				`/ep/${name ?? (position % 2 === 1 ? 'a' : 'b')}`,
				(position % 2) + 1
			).lastInsertRowid
	);

describe('fingerprinting streams', () => {
	it.skipIf(noPrint)(
		'takes the lowest quality at most 480p, a separate audio track, and falls past a failing server',
		async () => {
			const show = series();
			const a = episode(show);
			const b = episode(show);
			seen = [];
			const result = await fingerprintSeason(show, a, { allowStreams: true, pauseMs: 0 });
			expect(result).toEqual({ episodes: 2, found: 2 });
			for (const id of [a, b]) {
				const chosen = marks.chosenMarks(id);
				expect(chosen.introFrom).toBe('fingerprint');
				expect(chosen.endingFrom).toBe('fingerprint');
				expect(chosen.ending!.start).toBeGreaterThan(315);
				expect(chosen.ending!.start).toBeLessThan(325);
			}
			// The 1080p audio is never fetched: the 360p one is.
			expect(seen.some((u) => u.includes('/high/'))).toBe(false);
			// The first 360p server failed, and the next one answered.
			expect(seen.some((u) => u.includes('/missing/'))).toBe(true);
			expect(seen.some((u) => u.includes('/ep-a/low/index.m3u8'))).toBe(true);
			expect(seen.some((u) => u.includes('/ep-b/low/index.m3u8'))).toBe(true);
		},
		180_000
	);

	it('reads no stream while a download of the same source is running', async () => {
		const show = series();
		const a = episode(show);
		const b = episode(show);
		// A third episode downloading from the same source: the streams wait.
		db.prepare(
			`INSERT INTO download_queue (entry_id, series_id, position, state, queued_at)
			VALUES (?, ?, 1, 'downloading', 0)`
		).run(b, show);
		seen = [];
		try {
			expect(await fingerprintSeason(show, a, { allowStreams: true, pauseMs: 0 })).toEqual({
				episodes: 0,
				found: 0
			});
			expect(seen).toEqual([]);
			expect(marks.chosenMarks(a).intro).toBeNull();
		} finally {
			db.prepare(`DELETE FROM download_queue WHERE series_id = ?`).run(show);
		}
	}, 60_000);

	it('targets the playing episode, the next two, and one more to pair them', () => {
		expect(streamTargets([10, 11, 12, 13, 14], 11)).toEqual([11, 12, 13, 14]);
		expect(streamTargets([10, 11, 12, 13, 14], 10)).toEqual([10, 11, 12, 13]);
		expect(streamTargets([10, 11, 12, 13, 14], 14)).toEqual([14]);
		expect(streamTargets([10, 11], 99)).toEqual([]);
	});

	it.skipIf(noPrint)(
		'reads KickAssAnime’s own shape: one VidStreaming server, three heights, and the 360p audio (live)',
		async () => {
			// The engine's live answer was one server ("VidStreaming") whose qualities
			// read "1080p (1920x1080) - 3.52 Mbps", "720p (1280x720) - 1.31 Mbps" and
			// "360p (640x360) - 506 kbps", each with a separate audio rendition per
			// language. Only the 360p audio is fetched.
			const show = series();
			const a = episode(show, 'k1');
			episode(show, 'k2');
			seen = [];
			expect(await fingerprintSeason(show, a, { allowStreams: true, pauseMs: 0 })).toEqual({
				episodes: 2,
				found: 2
			});
			expect(seen.some((u) => u.includes('/hls/k1/index.m3u8'))).toBe(true);
			expect(seen.some((u) => u.includes('/hls/k2/index.m3u8'))).toBe(true);
			expect(seen.some((u) => u.includes('/hls/k1/high/'))).toBe(false);
			expect(marks.chosenMarks(a).introFrom).toBe('fingerprint');
		},
		180_000
	);

	it.skipIf(noPrint)(
		'reads a later server’s 360p before an earlier server’s 1080p or unknown height',
		async () => {
			// The ranking across servers (`qualitiesToRead`): a quality at or below
			// 480p first, then one that names no height, then one above, whatever
			// order the source lists its servers in.
			const show = series();
			const a = episode(show, 'x1');
			episode(show, 'x2');
			seen = [];
			const result = await fingerprintSeason(show, a, { allowStreams: true, pauseMs: 0 });
			// The first audio asked for, per episode, is the 360p one. Checked
			// before the result: a read that fails falls through to the next
			// server, so this holds however the read itself went.
			const audioAsked = (kind: string) =>
				seen.filter((u) => u.startsWith(`/video/hls/${kind}/`) && u.endsWith('.m3u8'));
			expect(audioAsked('x1')[0]).toBe('/video/hls/x1/index.m3u8');
			expect(audioAsked('x2')[0]).toBe('/video/hls/x2/index.m3u8');
			// The pair still finds its opening, and the 360p read was enough: the
			// other two servers were never asked.
			expect(result).toEqual({ episodes: 2, found: 2 });
			expect(marks.chosenMarks(a).introFrom).toBe('fingerprint');
			expect(seen.some((u) => /\/(high|unknown)\//.test(u))).toBe(false);
		},
		180_000
	);

	it.skipIf(noPrint)(
		'takes the lowest quality when the source names no height at all',
		async () => {
			const show = series();
			const a = episode(show, 'n1');
			episode(show, 'n2');
			expect(await fingerprintSeason(show, a, { allowStreams: true, pauseMs: 0 })).toEqual({
				episodes: 2,
				found: 2
			});
			expect(marks.chosenMarks(a).endingFrom).toBe('fingerprint');
		},
		180_000
	);

	it.skipIf(noPrint)(
		'takes the lowest quality there is when none is at most 480p',
		async () => {
			const show = series();
			const a = episode(show, 'h1');
			episode(show, 'h2');
			expect(await fingerprintSeason(show, a, { allowStreams: true, pauseMs: 0 })).toEqual({
				episodes: 2,
				found: 2
			});
			expect(marks.chosenMarks(a).introFrom).toBe('fingerprint');
		},
		180_000
	);
});
