import { execFileSync } from 'node:child_process';
import { createCipheriv } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The clip lane (c704; doc/HIGHLIGHTS.md, "Clips"), with real ffmpeg on real
 * bytes. Only the two seams an engine stands behind are replaced: what a stream
 * resolves to, and the loopback proxy, which here is a stand-in HLS server wrong
 * the way a real one is (a segment that 404s halfway, a slow answer, a playlist
 * that changed), serving the same URL shape and asking for the same secret.
 */
const work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'clips-db-'));
process.env.DATABASE_PATH = ':memory:';
process.env.HIGHLIGHTS_DIR = join(work, 'highlights');

const stand = vi.hoisted(() => ({
	port: 0,
	file: null as string | null,
	streams: null as unknown,
	fresh: [] as boolean[],
	engine: null as Error | null
}));
vi.mock('$lib/server/anime/loopback', () => ({
	loopback: async () => ({ port: stand.port, secret: 'secret' })
}));
vi.mock('$lib/server/anime/streams', async (orig) => ({
	...(await orig<typeof import('$lib/server/anime/streams')>()),
	episodeFile: () => stand.file,
	episodeStreams: async (_e: number, _r: boolean, fresh?: boolean) => {
		stand.fresh.push(!!fresh);
		if (stand.engine) throw stand.engine;
		return stand.streams;
	}
}));

const { getDb } = await import('$lib/server/db');
const clips = await import('$lib/server/highlights/clips');
const { EngineError } = await import('$lib/server/engine/client');
const { rewritePlaylist } = await import('$lib/library/streams');
const { POST } = await import('../src/routes/api/highlights/clips/+server');

const db = () => getDb();
const area = join(work, 'highlights');
/** The fixture's clock: a second of testsrc per second of episode. */
const LENGTH_S = 20;
const SEG_S = 2;
const src = join(work, 'src');
let server: Server;
const asked: string[] = [];
let sick: (seg: string) => 'ok' | '404' | 'slow' = () => 'ok';
/** Bytes a plain GET of the big file was sent, for the case that says it isn't read whole. */
let bigSent = 0;
const BIG_BYTES = 40 * 1024 * 1024;
/** What the proxy holds beside the plain HLS above: a token's playlist or bytes. */
const extra = new Map<string, string | Buffer>();
const token = (name: string) => name.padEnd(32, 'x');
const media = (name: string) => `/api/anime/media/${token(name)}`;
/** The FFMPEG the run was started with: the release's LGPL build, when it is the one under test. */
const BINARIES = { ffmpeg: process.env.FFMPEG, ffprobe: process.env.FFPROBE };
let playlist = 'playlist.m3u8';
let entry = 0;

const ffmpeg = (args: string[]) =>
	execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });
const probe = (path: string, what: string) =>
	JSON.parse(
		execFileSync('ffprobe', ['-v', 'error', '-show_entries', what, '-of', 'json', path], {
			stdio: ['ignore', 'pipe', 'ignore']
		}).toString()
	);
const seconds = (path: string) => Number(probe(path, 'format=duration').format.duration);

/** One decoded frame as raw RGB, so "exact to the frame" is a pixel comparison. */
function frameAt(path: string, t: number, seek = true): Buffer {
	return execFileSync(
		'ffmpeg',
		[
			'-v',
			'error',
			...(seek ? ['-ss', String(t)] : []),
			'-i',
			path,
			'-frames:v',
			'1',
			'-f',
			'rawvideo',
			'-pix_fmt',
			'rgb24',
			'-'
		],
		{ stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }
	);
}
const difference = (a: Buffer, b: Buffer) => {
	let n = 0;
	for (let i = 0; i < a.length; i += 7) n += Math.abs(a[i] - b[i]);
	return n / (a.length / 7);
};

/**
 * The clip's first frame is the source's at `t`, not one 0.4 s off to either side:
 * how far apart two frames are depends on which they are and on the encoder.
 */
function expectFrameNearest(file: string, t: number) {
	const source = join(src, 'plain.mkv');
	const first = frameAt(file, 0, false);
	const at = difference(first, frameAt(source, t));
	expect(at).toBeLessThan(difference(first, frameAt(source, t - 0.4)));
	expect(at).toBeLessThan(difference(first, frameAt(source, t + 0.4)));
}

const subs = (lang: string) => {
	const path = join(src, `${lang}.srt`);
	const line = (i: number) => {
		const t = String(i).padStart(2, '0');
		const next = String(i + 1).padStart(2, '0');
		return `${i + 1}\n00:00:${t},000 --> 00:00:${next},000\n${lang} line ${i}\n`;
	};
	writeFileSync(path, Array.from({ length: LENGTH_S }, (_, i) => line(i)).join('\n'));
	return path;
};
const subtitle = (lang: string, at: number) =>
	`/api/anime/subtitle/${lang}${at}`.padEnd(`/api/anime/subtitle/`.length + 32, 'x');

/**
 * A playlist as the proxy serves it: run through the real `rewritePlaylist`, so a
 * segment, a key and an init segment are all root-relative `/api/anime/media/<token>`.
 */
function asProxied(file: string): string {
	return rewritePlaylist(readFileSync(join(src, file), 'utf8'), 'http://hoster.test/x/', (abs) =>
		media(abs.split('/').pop()!.split('.')[0])
	);
}
/** Every file an HLS muxed under `prefix` wrote, as the proxy's bytes. */
function hold(prefix: string) {
	for (const f of readdirSync(src))
		if (new RegExp(`^${prefix}\\d*(init)?\\.(ts|m4s|mp4)$`).test(f))
			extra.set(token(f.split('.')[0]), readFileSync(join(src, f)));
	extra.set(token(prefix), asProxied(`${prefix}.m3u8`));
}
const hlsArgs = (prefix: string, seconds: number, more: string[] = []) => [
	'-f',
	'hls',
	'-hls_time',
	String(seconds),
	'-hls_playlist_type',
	'vod',
	...more,
	'-hls_segment_filename',
	join(src, `${prefix}%d.${more.includes('fmp4') ? 'm4s' : 'ts'}`),
	join(src, `${prefix}.m3u8`)
];
/** Silence, then a tone from `AUDIO_TONE_AT`: where the tone lands says if the track is in step. */
const AUDIO_TONE_AT = 14;
const AUDIO_SEG_S = 3;
const AES_KEY = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
/**
 * Not 0, so the IV is a sequence number and not a segment's index. And 250 on
 * purpose: a wrong IV flips only the last bytes of a segment's first block, by
 * how far the numbers differ, which a small sequence confines to the PES stream
 * id (harmless, measured: a wrong number gave identical pixels). Across 256 it
 * reaches the start code, so the segment's first picture is lost if it's wrong.
 */
const AES_FIRST_SEQUENCE = 250;

/**
 * `serveMaster`'s text, copied from `src/lib/server/anime/streams.ts:191-197`: the
 * shape every quality with `audio.length` is served in. It isn't exported, and a
 * stand-in that invented its own would miss what the real one leaves out.
 */
function serveMasterText(video: string, audio: { lang: string; token: string }[]): string {
	const quote = (s: string) => s.replace(/"/g, '');
	const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
	audio.forEach((a, i) =>
		lines.push(
			`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="${quote(a.lang) || `AUDIO ${i + 1}`}",LANGUAGE="${quote(a.lang.toLowerCase())}",DEFAULT=${i === 0 ? 'YES' : 'NO'},AUTOSELECT=YES,URI="${media(a.token)}"`
		)
	);
	lines.push('#EXT-X-STREAM-INF:BANDWIDTH=2000000,AUDIO="aud"', media(video));
	return lines.join('\n');
}

/**
 * A segment that starts on its first picture. A wrong IV garbles a segment's
 * first 16 bytes and nothing else, and the muxer's segments start with an SDT, a
 * PAT and a PMT it repeats, so without this a wrong sequence number loses nothing
 * the pixels could show. A hoster's segments cut by bytes do start on media.
 */
function withoutLeadingTables(ts: Buffer): Buffer {
	const PACKET = 188;
	const pid = (i: number) => ((ts[i + 1] & 0x1f) << 8) | ts[i + 2];
	let at = 0;
	while (at + PACKET <= ts.length && [0, 0x11, 0x1000].includes(pid(at))) at += PACKET;
	return ts.subarray(at);
}

function buildSeparateStreams(video: string) {
	ffmpeg(['-i', video, '-an', '-c:v', 'copy', ...hlsArgs('vid', SEG_S)]);
	hold('vid');
	ffmpeg([
		'-f',
		'lavfi',
		'-i',
		`aevalsrc='if(gte(t,${AUDIO_TONE_AT}),0.8*sin(2*PI*440*t),0)':d=${LENGTH_S}:s=48000`,
		'-c:a',
		'aac',
		...hlsArgs('aen', AUDIO_SEG_S)
	]);
	hold('aen');
	ffmpeg([
		'-f',
		'lavfi',
		'-i',
		`sine=frequency=880:duration=${LENGTH_S}`,
		'-c:a',
		'aac',
		...hlsArgs('aja', AUDIO_SEG_S)
	]);
	hold('aja');
	const tracks = [
		{ lang: 'EN', token: token('aen') },
		{ lang: 'JA', token: token('aja') }
	];
	extra.set(token('master'), serveMasterText('vid', tracks));
	// The video is a file a hoster links to: serveMaster wraps it all the same.
	const plain = join(src, 'plainvideo.mkv');
	ffmpeg(['-i', video, '-an', '-c:v', 'copy', plain]);
	extra.set(token('plainvideo'), readFileSync(plain));
	extra.set(token('masterfile'), serveMasterText('plainvideo', tracks));
	// An audio playlist that stops long before the video does.
	extra.set(
		token('ashort'),
		// The header's five lines and three segments: it reaches the fetch's window, and stops at 9 s.
		asProxied('aen.m3u8').split('\n').slice(0, 11).join('\n') + '\n#EXT-X-ENDLIST\n'
	);
	extra.set(token('mastershort'), serveMasterText('vid', [{ lang: 'EN', token: token('ashort') }]));
	// An fMP4 stream, its init segment named by #EXT-X-MAP.
	ffmpeg([
		'-i',
		video,
		'-c',
		'copy',
		...hlsArgs('fmp', SEG_S, [
			'-hls_segment_type',
			'fmp4',
			'-hls_fmp4_init_filename',
			'fmpinit.mp4'
		])
	]);
	hold('fmp');
	// AES-128, a root-relative key and no IV: each segment's IV is its sequence number.
	const plainSegs = readdirSync(src).filter((f) => /^seg\d+\.ts$/.test(f));
	const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:3'];
	lines.push(`#EXT-X-MEDIA-SEQUENCE:${AES_FIRST_SEQUENCE}`, '#EXT-X-PLAYLIST-TYPE:VOD');
	lines.push(`#EXT-X-KEY:METHOD=AES-128,URI="key.bin"`);
	const durations = [
		...readFileSync(join(src, 'playlist.m3u8'), 'utf8').matchAll(/#EXTINF:([\d.]+)/g)
	];
	plainSegs
		.sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)))
		.forEach((f, i) => {
			const iv = Buffer.alloc(16);
			iv.writeUInt32BE(AES_FIRST_SEQUENCE + i, 12);
			const c = createCipheriv('aes-128-cbc', AES_KEY, iv);
			const clear = withoutLeadingTables(readFileSync(join(src, f)));
			const out = Buffer.concat([c.update(clear), c.final()]);
			writeFileSync(join(src, `enc${i}.ts`), out);
			lines.push(`#EXTINF:${durations[i][1]},`, `enc${i}.ts`);
		});
	lines.push('#EXT-X-ENDLIST', '');
	writeFileSync(join(src, 'enc.m3u8'), lines.join('\n'));
	hold('enc');
	extra.set(token('key'), AES_KEY);
	// Two variants, as a hoster's auto quality is.
	const variant = (h: number, w: number, name: string) =>
		`#EXT-X-STREAM-INF:BANDWIDTH=${h * 1000},RESOLUTION=${w}x${h}\n${media(name)}`;
	extra.set(token('hi'), asProxied('playlist.m3u8'));
	extra.set(token('lo'), asProxied('playlist.m3u8'));
	extra.set(
		token('twovariants'),
		`#EXTM3U\n${variant(1080, 1920, 'hi')}\n${variant(360, 640, 'lo')}\n`
	);
}

beforeAll(async () => {
	mkdirSync(src, { recursive: true });
	const video = join(src, 'plain.mkv');
	ffmpeg([
		'-f',
		'lavfi',
		'-i',
		`testsrc=size=160x90:rate=25:duration=${LENGTH_S}`,
		'-f',
		'lavfi',
		'-i',
		`sine=frequency=440:duration=${LENGTH_S}`,
		'-c:v',
		'libx264',
		'-preset',
		'ultrafast',
		'-g',
		'25',
		'-c:a',
		'aac',
		'-shortest',
		video
	]);
	ffmpeg([
		'-i',
		video,
		'-i',
		subs('eng'),
		'-i',
		subs('jpn'),
		'-map',
		'0',
		'-map',
		'1:s',
		'-map',
		'2:s',
		'-c:v',
		'copy',
		'-c:a',
		'copy',
		'-c:s',
		'srt',
		'-metadata:s:s:0',
		'language=eng',
		'-metadata:s:s:1',
		'language=jpn',
		join(src, 'episode.mkv')
	]);
	ffmpeg([
		'-i',
		video,
		'-c',
		'copy',
		'-f',
		'hls',
		'-hls_time',
		String(SEG_S),
		'-hls_playlist_type',
		'vod',
		'-hls_segment_filename',
		join(src, 'seg%d.ts'),
		join(src, 'playlist.m3u8')
	]);
	writeFileSync(
		join(src, 'stale.m3u8'),
		readFileSync(join(src, 'playlist.m3u8'), 'utf8').replace(/seg/g, 'gone')
	);

	buildSeparateStreams(video);

	server = createServer(async (req, res) => {
		const url = req.url ?? '';
		if (req.headers['x-tsundoku'] !== 'secret') return res.writeHead(403).end();
		asked.push(url);
		const sub = /^\/api\/anime\/subtitle\/([a-z]+)(\d+)/.exec(url);
		if (sub) {
			const cues = readFileSync(join(src, `${sub[1]}.srt`), 'utf8').replace(/,/g, '.');
			return res.writeHead(200, { 'content-type': 'text/vtt' }).end(`WEBVTT\n\n${cues}`);
		}
		const held = /^\/api\/anime\/media\/([^/?]+)$/.exec(url)?.[1];
		const body = held ? extra.get(held) : undefined;
		if (held && body !== undefined) {
			const kind = sick(held.replace(/x+$/, ''));
			if (kind === '404') return res.writeHead(404).end();
			if (kind === 'slow') await new Promise((ok) => setTimeout(ok, 900));
			if (typeof body === 'string')
				return res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }).end(body);
			if (held === token('plainvideo') && !req.headers.range) {
				// Only the player's own first look asks without a Range: an episode-sized answer.
				const chunk = Buffer.alloc(64 * 1024, 0x20);
				bigSent = 0;
				res.writeHead(200, { 'content-type': 'application/octet-stream' });
				res.write(body);
				while (bigSent < BIG_BYTES && !res.destroyed) {
					bigSent += chunk.length;
					if (!res.write(chunk))
						await new Promise<void>((ok) => {
							res.once('drain', ok);
							res.once('close', ok);
						});
				}
				return res.end();
			}
			// As the proxy passes a hoster's file through: Range and all.
			const from = Number(/^bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0);
			return res
				.writeHead(req.headers.range ? 206 : 200, {
					'content-type': 'application/octet-stream',
					'accept-ranges': 'bytes',
					'content-length': String(body.length - from),
					...(req.headers.range
						? { 'content-range': `bytes ${from}-${body.length - 1}/${body.length}` }
						: {})
				})
				.end(body.subarray(from));
		}
		const name = url.split('/').pop()!.split('?')[0];
		const m = /\/api\/anime\/media\/(playlist|seg\d+|gone\d+)x*$/.exec(url);
		if (!m) return res.writeHead(404).end();
		if (m[1] === 'playlist') {
			const text = readFileSync(join(src, playlist), 'utf8').replace(
				/^(seg|gone)(\d+)\.ts$/gm,
				(_m, a, n) => `/api/anime/media/${(a + n).padEnd(32, 'x')}`
			);
			return res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }).end(text);
		}
		void name;
		const kind = sick(m[1]);
		if (kind === '404' || m[1].startsWith('gone')) return res.writeHead(404).end();
		if (kind === 'slow') await new Promise((ok) => setTimeout(ok, 900));
		res.writeHead(200, { 'content-type': 'video/mp2t' }).end(readFileSync(join(src, `${m[1]}.ts`)));
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	stand.port = (server.address() as AddressInfo).port;

	const d = db();
	d.prepare(`INSERT INTO roots (id, name, path) VALUES (1, 'Anime', '/a')`).run();
	d.prepare(
		`INSERT INTO series (id, root_id, title, kind, added_at, path, origin_key)
		VALUES (1, 1, 'Toudai no Mukou', 'anime', 1, '/a/t', 'aniyomi:1:/show/t')`
	).run();
	entry = Number(
		d
			.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, available, file, source_url, episode_number, season)
				VALUES (1, 7, 'Ep. 7', 'Lamp', 1, 1, 'e.mkv', '/ep/7', 7, 1)`
			)
			.run().lastInsertRowid
	);
}, 90_000);

afterAll(async () => {
	await new Promise((ok) => server.close(ok));
	rmSync(work, { recursive: true, force: true });
});

/** One quality of an hls `src`, the shape `episodeStreams` answers. */
const oneQuality = (
	src: string,
	audio: { lang: string; src: string }[] = [],
	height: number | null = 90
) => ({
	entryId: entry,
	intro: null,
	ending: null,
	resolvedAt: 0,
	servers: [
		{
			n: 1,
			name: 'S1',
			qualities: [{ label: 'q', height, kind: 'hls', src, audio, subtitles: [] }]
		}
	]
});
const SEPARATE_AUDIO = [
	{ lang: 'EN', name: 'English', src: media('aen') },
	{ lang: 'JA', name: 'Japanese', src: media('aja') }
];
/** The mean loudness of one audio stream between two seconds of a file. */
function loudness(path: string, stream: number, from: number, to: number): number {
	const pcm = execFileSync(
		'ffmpeg',
		[
			'-v',
			'error',
			'-ss',
			String(from),
			'-t',
			String(to - from),
			'-i',
			path,
			'-map',
			`0:a:${stream}`,
			'-ac',
			'1',
			'-ar',
			'8000',
			'-f',
			's16le',
			'-'
		],
		{ stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }
	);
	let sum = 0;
	for (let i = 0; i + 1 < pcm.length; i += 2) sum += Math.abs(pcm.readInt16LE(i));
	return sum / Math.max(1, pcm.length / 2);
}
/** The tone starts at second 14 and the clip at 12; a track off by its segment's start is a second out. */
function expectToneAtTwoSeconds(file: string) {
	expect(loudness(file, 0, 0.1, 1.8)).toBeLessThan(100);
	expect(loudness(file, 0, 2.2, 2.9)).toBeGreaterThan(5000);
}
const audioStreams = (path: string) =>
	(
		probe(
			path,
			'stream=codec_type,duration:stream_disposition=default:stream_tags=language,DURATION'
		).streams as {
			codec_type: string;
			disposition: { default: number };
			tags?: { language?: string; DURATION?: string };
		}[]
	).filter((s) => s.codec_type === 'audio');
/** Which numbered segments of a playlist `prefix` were asked of the proxy. */
const askedOf = (prefix: string) =>
	asked.flatMap((u) => {
		const m = new RegExp(`/${prefix}(\\d+)x*$`).exec(u);
		return m ? [Number(m[1])] : [];
	});
const streams = (tracks = ['EN', 'JA']) => ({
	entryId: entry,
	intro: null,
	ending: null,
	resolvedAt: 0,
	servers: [
		{
			n: 1,
			name: 'S1',
			qualities: [
				{
					label: '90p',
					height: 90,
					kind: 'hls',
					src: `/api/anime/media/${'playlist'.padEnd(32, 'x')}`,
					audio: [],
					subtitles: tracks.map((lang) => ({
						lang,
						label: lang,
						src: subtitle(lang === 'JA' ? 'jpn' : 'eng', 1)
					}))
				}
			]
		}
	]
});

beforeEach(() => {
	stand.file = null;
	stand.streams = streams();
	stand.fresh = [];
	stand.engine = null;
	asked.length = 0;
	sick = () => 'ok';
	playlist = 'playlist.m3u8';
	restoreBinaries();
});
afterEach(() => {
	clips.forgetClips();
	db().exec(`DELETE FROM highlights`);
	rmSync(area, { recursive: true, force: true });
	db().prepare(`UPDATE series SET hidden = 0`).run();
	restoreBinaries();
});
function restoreBinaries() {
	for (const [name, value] of [
		['FFMPEG', BINARIES.ffmpeg],
		['FFPROBE', BINARIES.ffprobe]
	] as const)
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
}

const ask = (from: number, to: number, o: Partial<Parameters<typeof clips.keepClip>[0]> = {}) =>
	clips.keepClip({ entryId: entry, from, to, subtitle: 'EN', ...o }, true);
const job = (id: string) => clips.clipJobs(true).find((j) => j.id === id)!;
/** Every step a job goes through, in order, waiting until it ends. */
async function finished(id: string) {
	const steps: string[] = [];
	await vi.waitFor(
		() => {
			const j = job(id);
			if (steps.at(-1) !== j.step) steps.push(j.step);
			expect(['made', 'failed']).toContain(j.step);
		},
		{ timeout: 60_000, interval: 10 }
	);
	return { job: job(id), steps };
}
const row = (id: number) =>
	db().prepare(`SELECT * FROM highlights WHERE id = ?`).get(id) as Record<string, unknown>;
const partsLeft = () =>
	['clips', 'stills'].flatMap((d) => {
		try {
			return readdirSync(join(area, d)).filter((f) => f.endsWith('.part'));
		} catch {
			return [];
		}
	});
const rowCount = () => (db().prepare(`SELECT COUNT(*) n FROM highlights`).get() as { n: number }).n;

describe('a downloaded episode', () => {
	beforeEach(() => {
		stand.file = join(src, 'episode.mkv');
	});

	it('is cut in one step, exact to the frame, with every track shifted to zero and the showing one the default', async () => {
		const { job: j, steps } = await finished(ask(5, 9).id);
		expect(steps).not.toContain('fetching');
		expect(steps).toContain('made');
		expect(j).toMatchObject({ step: 'made', percent: 100, streamed: false, why: null });
		const r = row(j.highlightId!);
		expect(r).toMatchObject({
			kind: 'clip',
			clip_in: 5,
			clip_out: 9,
			entry_label: 'Ep. 7',
			hidden: 0,
			season: 1
		});
		const file = join(area, String(r.copy_path));
		expect(r.copy_path).toBe(`clips/${r.id}.mkv`);
		expect(existsSync(join(area, String(r.still_path)))).toBe(true);
		expect(seconds(file)).toBeCloseTo(4, 0);

		// Exact: the clip's first frame is the source's frame at the in point, not
		// the one a second on or the nearest keyframe's.
		const source = join(src, 'plain.mkv');
		const first = frameAt(file, 0, false);
		expect(difference(first, frameAt(source, 5))).toBeLessThan(6);
		expect(difference(first, frameAt(source, 5.4))).toBeGreaterThan(6);

		const streamsOf = probe(
			file,
			'stream=codec_type:stream_disposition=default:stream_tags=language'
		).streams as {
			codec_type: string;
			disposition: { default: number };
			tags?: { language?: string };
		}[];
		const tracks = streamsOf.filter((s) => s.codec_type === 'subtitle');
		expect(tracks.map((t) => t.tags?.language)).toEqual(['eng', 'jpn']);
		expect(tracks.map((t) => t.disposition.default)).toEqual([1, 0]);
		const srt = execFileSync(
			'ffmpeg',
			['-v', 'error', '-i', file, '-map', '0:s:1', '-f', 'srt', '-'],
			{
				stdio: ['ignore', 'pipe', 'ignore']
			}
		).toString();
		expect(srt).toContain('jpn line 5');
		expect(srt).toMatch(/00:00:00,0\d\d --> /);
		expect(srt).not.toContain('jpn line 4');
		expect(partsLeft()).toEqual([]);
	}, 60_000);

	it('no track was showing: none is the default', async () => {
		const { job: j } = await finished(ask(2, 3, { subtitle: null }).id);
		const file = join(area, String(row(j.highlightId!).copy_path));
		const s = probe(file, 'stream=codec_type:stream_disposition=default').streams as {
			codec_type: string;
			disposition: { default: number };
		}[];
		expect(s.filter((x) => x.codec_type === 'subtitle').map((x) => x.disposition.default)).toEqual([
			0, 0
		]);
	}, 60_000);
});

describe('a streamed episode', () => {
	it('is fetched, then cut, asking only for the segments covering the range', async () => {
		const { job: j, steps } = await finished(ask(14, 16).id);
		expect(steps).toEqual(expect.arrayContaining(['fetching', 'cutting', 'made']));
		expect(steps.indexOf('fetching')).toBeLessThan(steps.indexOf('cutting'));
		expect(j.streamed).toBe(true);
		const segs = asked.flatMap((u) => /(seg\d+)x/.exec(u)?.[1] ?? []);
		const numbers = segs.map((s) => Number(s.slice(3)));
		// The pad is 8 s, so nothing before second 6, which is segment 2 at 2 s each.
		expect(Math.min(...numbers)).toBeGreaterThanOrEqual(2);
		expect(segs.length).toBeLessThan(LENGTH_S / SEG_S);
		const r = row(j.highlightId!);
		const file = join(area, String(r.copy_path));
		expect(seconds(file)).toBeCloseTo(2, 0);
		const first = frameAt(file, 0, false);
		const source = join(src, 'plain.mkv');
		expect(difference(first, frameAt(source, 14))).toBeLessThan(6);
		expect(difference(first, frameAt(source, 14.4))).toBeGreaterThan(6);
		const tracks = (
			probe(file, 'stream=codec_type:stream_disposition=default:stream_tags=language').streams as {
				codec_type: string;
				disposition: { default: number };
				tags?: { language?: string };
			}[]
		).filter((x) => x.codec_type === 'subtitle');
		expect(tracks.map((t) => t.tags?.language)).toEqual(['eng', 'jpn']);
		expect(tracks.map((t) => t.disposition.default)).toEqual([1, 0]);
		expect(partsLeft()).toEqual([]);
	}, 60_000);

	it('with no subtitle tracks makes a clip with none', async () => {
		stand.streams = streams([]);
		const { job: j } = await finished(ask(2, 4).id);
		expect(j.step).toBe('made');
		const s = probe(join(area, String(row(j.highlightId!).copy_path)), 'stream=codec_type')
			.streams as { codec_type: string }[];
		expect(s.some((x) => x.codec_type === 'subtitle')).toBe(false);
	}, 60_000);

	it('with several tracks keeps them all', async () => {
		stand.streams = streams(['EN', 'JA', 'EN-2']);
		const { job: j } = await finished(ask(2, 4).id);
		const s = probe(join(area, String(row(j.highlightId!).copy_path)), 'stream=codec_type')
			.streams as { codec_type: string }[];
		expect(s.filter((x) => x.codec_type === 'subtitle')).toHaveLength(3);
	}, 60_000);

	it('a segment that 404s halfway fails with where, leaves nothing, and TRY AGAIN asks the stream afresh', async () => {
		sick = (seg) => (seg === 'seg6' ? '404' : 'ok');
		const first = ask(8, 16);
		const { job: failed } = await finished(first.id);
		expect(failed).toMatchObject({ step: 'failed', why: 'stream' });
		expect(failed.stoppedAt).toBeGreaterThan(0);
		expect(rowCount()).toBe(0);
		expect(partsLeft()).toEqual([]);
		expect(stand.fresh).toEqual([false]);

		sick = () => 'ok';
		const again = ask(8, 16, { fresh: true });
		expect(again.id).not.toBe(first.id);
		const { job: made } = await finished(again.id);
		expect(made.step).toBe('made');
		expect(stand.fresh).toEqual([false, true]);
		expect(rowCount()).toBe(1);
	}, 90_000);

	it('a slow answer is waited for', async () => {
		sick = (seg) => (seg === 'seg8' ? 'slow' : 'ok');
		const { job: j } = await finished(ask(16, 18).id);
		expect(j.step).toBe('made');
	}, 60_000);

	it('a playlist that changed under it fails the first time and is right the second, as a stale link is', async () => {
		playlist = 'stale.m3u8';
		const { job: first } = await finished(ask(4, 6).id);
		expect(first).toMatchObject({ step: 'failed', why: 'stream' });
		playlist = 'playlist.m3u8';
		const { job: again } = await finished(ask(4, 6, { fresh: true }).id);
		expect(again.step).toBe('made');
	}, 60_000);

	it('a range ending past the last segment is the clip that exists, and says where it ended', async () => {
		const { job: j } = await finished(ask(17, 40).id);
		expect(j.step).toBe('made');
		const r = row(j.highlightId!);
		expect(Number(r.clip_out)).toBeLessThan(21);
		expect(Number(r.clip_out)).toBeGreaterThan(19);
		expect(seconds(join(area, String(r.copy_path)))).toBeLessThan(4);
	}, 60_000);

	it('a range wholly past the stream makes nothing', async () => {
		const { job: j } = await finished(ask(30, 40).id);
		expect(j).toMatchObject({ step: 'failed', why: 'stream' });
		expect(rowCount()).toBe(0);
	}, 60_000);
});

describe('a stream with separate audio (serveMaster’s shape)', () => {
	beforeEach(() => {
		stand.streams = oneQuality(media('master'), SEPARATE_AUDIO);
	});

	it('keeps every track, the one heard the default, from only the segments covering the range', async () => {
		const { job: j } = await finished(ask(14, 16, { subtitle: null, audio: 'JA' }).id);
		expect(j).toMatchObject({ step: 'made', why: null });
		const file = join(area, String(row(j.highlightId!).copy_path));
		const tracks = audioStreams(file);
		expect(tracks.map((t) => t.tags?.language)).toEqual(['eng', 'jpn']);
		expect(tracks.map((t) => t.disposition.default)).toEqual([0, 1]);
		for (const t of tracks) {
			const [, min, sec] = /^\d+:(\d+):([\d.]+)/.exec(t.tags!.DURATION!)!;
			expect(Number(min) * 60 + Number(sec)).toBeCloseTo(2, 0);
		}
		expect(seconds(file)).toBeCloseTo(2, 0);
		// The 8 s pad: exactly the segments reaching past second 6 and starting before 16,
		// by the playlist's own durations (an AAC segment runs a few ms past its 3 s).
		for (const name of ['aen', 'aja']) {
			let at = 0;
			const covering = [
				...readFileSync(join(src, `${name}.m3u8`), 'utf8').matchAll(/#EXTINF:([\d.]+)/g)
			].flatMap((m, i) => {
				const from = at;
				at += Number(m[1]);
				return at > 6 && from < 16 ? [i] : [];
			});
			expect(covering.length).toBeLessThan(7);
			expect([...new Set(askedOf(name))].sort((a, b) => a - b)).toEqual(covering);
		}
		expect(partsLeft()).toEqual([]);
	}, 60_000);

	it('keeps the audio in step with the picture when their segments start at different seconds', async () => {
		// From 4 s the video's 2 s segments start at 4, the audio's 3 s ones at 3.
		const { job: j } = await finished(ask(12, 16, { subtitle: null }).id);
		expect(j.step).toBe('made');
		const file = join(area, String(row(j.highlightId!).copy_path));
		expectToneAtTwoSeconds(file);
		expectFrameNearest(file, 12);
	}, 60_000);

	it('an audio segment that 404s fails the clip rather than making it quiet', async () => {
		sick = (seg) => (seg === 'aja4' ? '404' : 'ok');
		const { job: j } = await finished(ask(12, 16).id);
		expect(j).toMatchObject({ step: 'failed', why: 'stream' });
		expect(j.stoppedAt).toBeGreaterThan(0);
		expect(rowCount()).toBe(0);
		expect(partsLeft()).toEqual([]);
	}, 60_000);

	it('an audio track whose playlist does not answer fails the clip', async () => {
		sick = (seg) => (seg === 'aen' ? '404' : 'ok');
		const { job: j } = await finished(ask(12, 16).id);
		expect(j).toMatchObject({ step: 'failed', why: 'stream' });
		expect(rowCount()).toBe(0);
		expect(partsLeft()).toEqual([]);
	}, 60_000);

	it('an audio track that ends before the range does fails the clip', async () => {
		stand.streams = oneQuality(media('mastershort'), [{ lang: 'EN', src: media('ashort') }]);
		const { job: j } = await finished(ask(14, 18, { subtitle: null }).id);
		expect(j).toMatchObject({ step: 'failed', why: 'stream' });
		expect(rowCount()).toBe(0);
	}, 60_000);

	it('✕ while the audio is on its way leaves nothing', async () => {
		sick = (seg) => (seg.startsWith('aen') ? 'slow' : 'ok');
		const a = ask(14, 18, { subtitle: null });
		await vi.waitFor(() => expect(askedOf('aen').length).toBeGreaterThan(0), {
			timeout: 20_000,
			interval: 10
		});
		expect(clips.dropClip(a.id, true)).toBe(true);
		await vi.waitFor(
			() => {
				expect(partsLeft()).toEqual([]);
				expect(rowCount()).toBe(0);
			},
			{ timeout: 10_000 }
		);
	}, 40_000);

	it('a video that is a plain file behind the master is seeked as a file, its audio beside it', async () => {
		stand.streams = oneQuality(media('masterfile'), SEPARATE_AUDIO);
		const { job: j } = await finished(ask(12, 16, { subtitle: null }).id);
		expect(j).toMatchObject({ step: 'made', why: null });
		const file = join(area, String(row(j.highlightId!).copy_path));
		// Looked at, not read: it is a whole episode as far as this request knows.
		expect(bigSent).toBeLessThan(BIG_BYTES / 4);
		expect(audioStreams(file)).toHaveLength(2);
		expect(seconds(file)).toBeCloseTo(4, 0);
		expectToneAtTwoSeconds(file);
		expectFrameNearest(file, 12);
	}, 60_000);
});

describe('a stream whose tags name more files', () => {
	it('an fMP4 stream is cut exact to the frame, past segment 0, its init segment asked of the proxy', async () => {
		stand.streams = oneQuality(media('fmp'));
		const { job: j } = await finished(ask(14, 16, { subtitle: null }).id);
		expect(j).toMatchObject({ step: 'made', why: null });
		expect(asked.some((u) => u.includes(token('fmpinit')))).toBe(true);
		expect(Math.min(...askedOf('fmp'))).toBeGreaterThanOrEqual(3);
		const file = join(area, String(row(j.highlightId!).copy_path));
		expect(audioStreams(file)).toHaveLength(1);
		const source = join(src, 'plain.mkv');
		const first = frameAt(file, 0, false);
		expect(difference(first, frameAt(source, 14))).toBeLessThan(6);
		expect(difference(first, frameAt(source, 14.4))).toBeGreaterThan(6);
	}, 60_000);

	it('an AES-128 stream with no IV decrypts past segment 0, compared by pixels', async () => {
		stand.streams = oneQuality(media('enc'));
		const { job: j } = await finished(ask(14, 16, { subtitle: null }).id);
		expect(j).toMatchObject({ step: 'made', why: null });
		expect(asked.some((u) => u.includes(token('key')))).toBe(true);
		expect(Math.min(...askedOf('enc'))).toBeGreaterThanOrEqual(3);
		const file = join(area, String(row(j.highlightId!).copy_path));
		const source = join(src, 'plain.mkv');
		const first = frameAt(file, 0, false);
		expect(difference(first, frameAt(source, 14))).toBeLessThan(6);
		expect(difference(first, frameAt(source, 14.4))).toBeGreaterThan(6);
	}, 60_000);

	it('trimPlaylist makes every URI= absolute and numbers the list from its first kept segment', () => {
		const text = [
			'#EXTM3U',
			'#EXT-X-MEDIA-SEQUENCE:40',
			'#EXT-X-MAP:URI="/api/anime/media/init"',
			'#EXT-X-KEY:METHOD=AES-128,URI="/api/anime/media/key1"',
			'#EXTINF:10,',
			'/api/anime/media/s0',
			'#EXTINF:10,',
			'/api/anime/media/s1',
			'#EXT-X-KEY:METHOD=AES-128,URI="/api/anime/media/key2"',
			'#EXTINF:10,',
			'/api/anime/media/s2',
			'#EXT-X-ENDLIST'
		].join('\n');
		const kept = clips.trimPlaylist(text, 'http://127.0.0.1:9/api/anime/media/list', 12, 28, 0)!;
		expect(kept.text).toContain('#EXT-X-MEDIA-SEQUENCE:41');
		expect(kept.text).not.toContain('#EXT-X-MEDIA-SEQUENCE:40');
		expect(kept.text).toContain('URI="http://127.0.0.1:9/api/anime/media/init"');
		expect(kept.text).toContain('URI="http://127.0.0.1:9/api/anime/media/key1"');
		expect(kept.text).toContain('URI="http://127.0.0.1:9/api/anime/media/key2"');
		expect(kept.text).not.toContain('URI="/api');
		// A list that names no sequence starts at 0, so the first kept is its index.
		const plain = text.replace('#EXT-X-MEDIA-SEQUENCE:40\n', '');
		expect(clips.trimPlaylist(plain, 'http://h/l', 22, 28, 0)!.text).toContain(
			'#EXT-X-MEDIA-SEQUENCE:2'
		);
	});
});

describe('POST /api/highlights/clips', () => {
	const post = async (body: Record<string, unknown>) =>
		(await POST({
			request: new Request('http://t/api/highlights/clips', {
				method: 'POST',
				body: JSON.stringify(body)
			}),
			cookies: { get: () => undefined }
		} as never)) as Response;

	for (const height of [null, 0, -480, '360', true])
		it(`a height of ${JSON.stringify(height)} is no height: the highest variant is fetched`, async () => {
			stand.streams = oneQuality(media('twovariants'), [], null);
			const r = await post({ entry, from: 2, to: 3, height });
			expect(r.status).toBe(202);
			const { job: j } = await finished(((await r.json()) as { id: string }).id);
			expect(j.step).toBe('made');
			expect(asked.some((u) => u.includes(token('hi')))).toBe(true);
			expect(asked.some((u) => u.includes(token('lo')))).toBe(false);
		}, 40_000);

	it('a real height asks the variant nearest it', async () => {
		stand.streams = oneQuality(media('twovariants'), [], null);
		const r = await post({ entry, from: 2, to: 3, height: 360 });
		const { job: j } = await finished(((await r.json()) as { id: string }).id);
		expect(j.step).toBe('made');
		expect(asked.some((u) => u.includes(token('lo')))).toBe(true);
		expect(asked.some((u) => u.includes(token('hi')))).toBe(false);
	}, 40_000);

	it('no height picks the best server’s quality, not its worst', async () => {
		const q = (height: number, name: string) => ({
			label: `${height}p`,
			height,
			kind: 'hls',
			src: media(name),
			audio: [],
			subtitles: []
		});
		stand.streams = {
			...oneQuality(media('hi')),
			servers: [{ n: 1, name: 'S1', qualities: [q(1080, 'hi'), q(360, 'lo')] }]
		};
		const r = await post({ entry, from: 2, to: 3, height: null });
		await finished(((await r.json()) as { id: string }).id);
		expect(asked.some((u) => u.includes(token('hi')))).toBe(true);
		expect(asked.some((u) => u.includes(token('lo')))).toBe(false);
	}, 40_000);
});

describe('TRY AGAIN, on the lane', () => {
	const failedOnce = async (from: number, to: number) => {
		sick = (seg) => (seg.startsWith('seg') ? '404' : 'ok');
		const { job } = await finished(ask(from, to).id);
		expect(job.step).toBe('failed');
		sick = () => 'ok';
		return job;
	};

	it('a retry replaces the failed job, so clipJobs stops listing it', async () => {
		const failed = await failedOnce(2, 4);
		const again = ask(2, 4, { fresh: true });
		expect(clips.clipJobs(true).map((j) => j.id)).toEqual([again.id]);
		expect(failed.id).not.toBe(again.id);
		await finished(again.id);
		expect(clips.clipJobs(true).map((j) => j.id)).toEqual([again.id]);
		expect(rowCount()).toBe(1);
	}, 60_000);

	it('a retry of another range leaves the other failed job alone', async () => {
		const other = await failedOnce(6, 8);
		const failed = await failedOnce(2, 4);
		const again = ask(2, 4, { fresh: true });
		const ids = clips.clipJobs(true).map((j) => j.id);
		expect(ids).toContain(other.id);
		expect(ids).toContain(again.id);
		expect(ids).not.toContain(failed.id);
		await finished(again.id);
	}, 60_000);

	it('a plain KEEP again, no retry, leaves the failure listed before the new job', async () => {
		const failed = await failedOnce(2, 4);
		const again = ask(2, 4);
		expect(clips.clipJobs(true).map((j) => j.id)).toEqual([failed.id, again.id]);
		await finished(again.id);
	}, 60_000);

	it('a second retry while the first runs is the job already going', async () => {
		await failedOnce(2, 4);
		const a = ask(2, 4, { fresh: true });
		expect(ask(2, 4, { fresh: true }).id).toBe(a.id);
		await finished(a.id);
		expect(rowCount()).toBe(1);
	}, 60_000);

	it('a series deleted during the cut leaves no finished clip behind', async () => {
		stand.file = join(src, 'episode.mkv');
		const d = db();
		d.prepare(
			`INSERT INTO series (id, root_id, title, kind, added_at, path, origin_key)
			VALUES (2, 1, 'Gone', 'anime', 1, '/a/g', 'aniyomi:1:/show/g')`
		).run();
		const doomed = Number(
			d
				.prepare(
					`INSERT INTO entries (series_id, position, label, title, added_at, available, file, source_url, episode_number, season)
					VALUES (2, 1, 'Ep. 1', 'Gone', 1, 1, 'g.mkv', '/ep/g', 1, 1)`
				)
				.run().lastInsertRowid
		);
		clips.keepClip({ entryId: doomed, from: 1, to: 2, subtitle: null }, true);
		// Behind it in the one lane, so this one finishing says that one has.
		const after = ask(5, 6);
		d.prepare(`DELETE FROM entries WHERE id = ?`).run(doomed);
		d.prepare(`DELETE FROM series WHERE id = 2`).run();
		const { job: j } = await finished(after.id);
		expect(j.step).toBe('made');
		expect(rowCount()).toBe(1);
		expect(partsLeft()).toEqual([]);
	}, 60_000);
});

describe('the lane', () => {
	beforeEach(() => {
		stand.file = join(src, 'episode.mkv');
	});

	it('a second KEEP of the same range is the job already going, and of another waits its turn', async () => {
		const a = ask(1, 3);
		expect(ask(1, 3).id).toBe(a.id);
		const b = ask(5, 7);
		expect(b.id).not.toBe(a.id);
		const [one, two] = await Promise.all([finished(a.id), finished(b.id)]);
		expect(one.job.step).toBe('made');
		expect(two.job.step).toBe('made');
		expect(rowCount()).toBe(2);
		// The same range again, kept already: the clip that exists, nothing made.
		const third = ask(1, 3);
		expect(third).toMatchObject({ step: 'made', highlightId: one.job.highlightId });
		expect(rowCount()).toBe(2);
	}, 90_000);

	it('takes a range past three minutes as three minutes, and an out before the in in order', () => {
		expect(ask(0, 200)).toMatchObject({ from: 0, to: 180 });
		expect(ask(9, 3)).toMatchObject({ from: 3, to: 9 });
		expect(() => ask(4, 4)).toThrow(clips.ClipError);
	});

	it('a series hidden while its clip is cut is hidden in the row, and off the poll with reveal off', async () => {
		const a = ask(1, 2);
		db().prepare(`UPDATE series SET hidden = 1`).run();
		expect(clips.clipJobs(false, entry)).toEqual([]);
		const { job: j } = await finished(a.id);
		expect(j.step).toBe('made');
		expect(row(j.highlightId!).hidden).toBe(1);
	}, 60_000);

	it('a hidden series with reveal off cannot start one', () => {
		db().prepare(`UPDATE series SET hidden = 1`).run();
		expect(() => clips.keepClip({ entryId: entry, from: 1, to: 2 }, false)).toThrow(
			clips.ClipError
		);
	});

	it('✕ stops it and leaves nothing', async () => {
		stand.file = null;
		sick = () => 'slow';
		const a = ask(14, 18);
		await vi.waitFor(() => expect(job(a.id).step).toBe('fetching'), {
			timeout: 10_000,
			interval: 10
		});
		expect(clips.dropClip(a.id, true)).toBe(true);
		await vi.waitFor(() => expect(partsLeft()).toEqual([]), { timeout: 10_000 });
		expect(rowCount()).toBe(0);
		expect(clips.clipJobs(true)).toEqual([]);
	}, 30_000);

	it('says NO ROOM when the disk is full', async () => {
		const fake = join(work, 'ffmpeg-full');
		writeFileSync(
			fake,
			'#!/bin/sh\necho "av_interleaved_write_frame(): No space left on device" >&2\nexit 1\n'
		);
		chmodSync(fake, 0o755);
		process.env.FFMPEG = fake;
		const { job: j } = await finished(ask(1, 2).id);
		expect(j).toMatchObject({ step: 'failed', why: 'disk' });
		expect(rowCount()).toBe(0);
	}, 30_000);

	it('says the workstation isn’t answering when the engine is down', async () => {
		stand.file = null;
		stand.engine = new EngineError('down', 'down');
		const { job: j } = await finished(ask(1, 2).id);
		expect(j).toMatchObject({ step: 'failed', why: 'down' });
	}, 30_000);

	it('at start, sweeps a part left mid-cut and a file no row points at, and keeps a row’s', async () => {
		const { job: j } = await finished(ask(1, 2).id);
		const r = row(j.highlightId!);
		writeFileSync(join(area, 'clips', 'abc.mkv.part'), 'x');
		writeFileSync(join(area, 'stills', 'abc.webp.part'), 'x');
		writeFileSync(join(area, 'clips', '9999.mkv'), 'x');
		clips.sweepClips();
		expect(readdirSync(join(area, 'clips'))).toEqual([String(r.copy_path).split('/')[1]]);
		expect(readdirSync(join(area, 'stills'))).toEqual([String(r.still_path).split('/')[1]]);
	}, 60_000);
});
