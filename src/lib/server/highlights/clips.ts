import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { join } from '../fspath.ts';
import { getDb } from '../db.ts';
import { highlightsArea } from '../data-dirs.ts';
import { loopback } from '../anime/loopback.ts';
import { streamsToTry } from '../anime/download.ts';
import { episodeFile, episodeRow, episodeStreams } from '../anime/streams.ts';
import { EngineError } from '../engine/client.ts';
import { iso3, progressSeconds } from '../../library/anime-files.ts';
import { parseVtt } from '../../library/player.ts';
import { clipAsk, cutCues, toVtt } from '../../library/highlights.ts';
import { snapshot } from './pages.ts';

/**
 * The clip job (card c704; doc/HIGHLIGHTS.md, "Clips"; Main 05, "The clip's job"):
 * one lane of its own beside the anime lane, in memory, so a clip never waits
 * behind a 400 MB episode and a restart forgets a clip half-made (no rung: the
 * row is written once the clip exists). ffmpeg fetches nothing itself, as for
 * downloads: a stream is read through the loopback proxy. Exact to the frame, so
 * the video is encoded: a stream copy can only start on a keyframe.
 *
 * Partial files are `.part`, swept at the lane's first use, so a restart mid-cut
 * leaves neither a row nor a file.
 */

const FFMPEG = () => process.env.FFMPEG ?? 'ffmpeg';
const FFPROBE = () => process.env.FFPROBE ?? 'ffprobe';
/** How far before the in point a stream's fetch starts, for the encoder's preroll. */
const FETCH_PAD_S = 8;
/** A stalled read gives up rather than holding the lane for good. */
const STALL_US = '60000000';
/** Made and failed jobs stay this long for the player to read. */
const KEEP_FINISHED_MS = 10 * 60_000;

export type ClipFailure = 'stream' | 'down' | 'disk' | 'file' | 'gone';
export type ClipStep = 'waiting' | 'fetching' | 'cutting' | 'made' | 'failed';

export type ClipJob = {
	id: string;
	entryId: number;
	seriesId: number;
	seriesTitle: string;
	entryLabel: string;
	from: number;
	to: number;
	/** Downloaded (one step) or streamed (fetch, then cut). */
	streamed: boolean;
	step: ClipStep;
	percent: number;
	why: ClipFailure | null;
	/** The second the stream stopped answering at, when it did. */
	stoppedAt: number | null;
	highlightId: number | null;
	finishedAt: number | null;
};

type Job = ClipJob & {
	subtitle: string | null;
	height: number | null;
	fresh: boolean;
	child: ChildProcess | null;
	dropped: boolean;
};

const jobs = new Map<string, Job>();
const queue: Job[] = [];
let busy = false;
let swept = false;

export class ClipError extends Error {
	constructor(
		message: string,
		readonly why: 'not_found' | 'bad_range'
	) {
		super(message);
	}
}

const publicJob = (j: Job): ClipJob => ({
	id: j.id,
	entryId: j.entryId,
	seriesId: j.seriesId,
	seriesTitle: j.seriesTitle,
	entryLabel: j.entryLabel,
	from: j.from,
	to: j.to,
	streamed: j.streamed,
	step: j.step,
	percent: j.percent,
	why: j.why,
	stoppedAt: j.stoppedAt,
	highlightId: j.highlightId,
	finishedAt: j.finishedAt
});

/** A file ffmpeg was part-way through, or one no row points at (a crash at the last step). */
export function sweepClips(db: Database.Database = getDb()): void {
	const area = highlightsArea();
	const kept = new Set(
		(
			db.prepare(`SELECT copy_path, still_path FROM highlights WHERE kind = 'clip'`).all() as {
				copy_path: string;
				still_path: string;
			}[]
		).flatMap((r) => [r.copy_path, r.still_path])
	);
	for (const [dir, name] of [
		[area.clips, 'clips'],
		[area.stills, 'stills']
	] as const) {
		let files: string[];
		try {
			files = readdirSync(dir);
		} catch {
			continue;
		}
		for (const f of files)
			if (f.endsWith('.part') || !kept.has(`${name}/${f}`)) rmSync(join(dir, f), { force: true });
	}
}

function ranFfmpeg(
	args: string[],
	job: Job,
	progress: (seconds: number) => void
): Promise<{ stderr: string }> {
	return new Promise((ok, no) => {
		const p = spawn(FFMPEG(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
		job.child = p;
		let out = '';
		let err = '';
		p.stdout?.on('data', (d) => {
			out += String(d);
			const blocks = out.split('progress=');
			out = blocks.pop() ?? '';
			for (const b of blocks) {
				const at = progressSeconds(b);
				if (at !== null) progress(at);
			}
		});
		p.stderr?.on('data', (d) => (err += String(d)));
		p.on('error', (e) => no(new Error(`ffmpeg didn't start: ${e.message}`)));
		p.on('close', (code) => {
			job.child = null;
			if (code === 0) ok({ stderr: err });
			else
				no(
					Object.assign(new Error(err.trim().split('\n').pop() || 'ffmpeg failed'), { stderr: err })
				);
		});
	});
}

function probeJson(path: string): Promise<Record<string, unknown>> {
	return new Promise((ok, no) => {
		const p = spawn(FFPROBE(), [
			'-v',
			'error',
			'-show_entries',
			'format=start_time,duration:stream=index,codec_type,width,height:stream_tags=language',
			'-of',
			'json',
			path
		]);
		let out = '';
		p.stdout.on('data', (d) => (out += String(d)));
		p.on('error', no);
		p.on('close', () => {
			try {
				ok(JSON.parse(out) as Record<string, unknown>);
			} catch (e) {
				no(e as Error);
			}
		});
	});
}

type Probed = {
	start: number;
	seconds: number | null;
	width: number | null;
	height: number | null;
	subtitles: string[];
};
async function facts(path: string): Promise<Probed> {
	const j = (await probeJson(path)) as {
		format?: { start_time?: string; duration?: string };
		streams?: {
			codec_type: string;
			width?: number;
			height?: number;
			tags?: { language?: string };
		}[];
	};
	const video = j.streams?.find((s) => s.codec_type === 'video');
	return {
		start: Number(j.format?.start_time ?? 0) || 0,
		seconds: Number(j.format?.duration) || null,
		width: video?.width ?? null,
		height: video?.height ?? null,
		subtitles: (j.streams ?? [])
			.filter((s) => s.codec_type === 'subtitle')
			.map((s) => (s.tags?.language ?? '').toLowerCase())
	};
}

/**
 * The video encoder this ffmpeg has. The release bundles an LGPL build
 * (`ops/release/versions.json`), which has no libx264; it has libopenh264, so that
 * is what a real install cuts with. A distro's ffmpeg usually has x264, which is
 * the better encoder at the same size. Asked once per binary.
 */
const encoders = new Map<string, Promise<string[]>>();
const AUDIO_ARGS = ['-c:a', 'aac', '-b:a', '192k'];
function encodeArgs(): Promise<string[]> {
	const bin = FFMPEG();
	let known = encoders.get(bin);
	if (!known) {
		known = new Promise<string[]>((ok) => {
			const p = spawn(bin, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] });
			let out = '';
			p.stdout.on('data', (d) => (out += String(d)));
			const has = (name: string) => new RegExp(`\\s${name}\\s`).test(out);
			p.on('error', () =>
				ok([
					'-c:v',
					'libx264',
					'-preset',
					'veryfast',
					'-crf',
					'18',
					'-pix_fmt',
					'yuv420p',
					...AUDIO_ARGS
				])
			);
			p.on('close', () => {
				if (has('libx264'))
					ok([
						'-c:v',
						'libx264',
						'-preset',
						'veryfast',
						'-crf',
						'18',
						'-pix_fmt',
						'yuv420p',
						...AUDIO_ARGS
					]);
				else if (has('libopenh264'))
					ok(['-c:v', 'libopenh264', '-b:v', '8M', '-pix_fmt', 'yuv420p', ...AUDIO_ARGS]);
				else
					ok([
						'-c:v',
						'libvpx-vp9',
						'-crf',
						'24',
						'-b:v',
						'0',
						'-pix_fmt',
						'yuv420p',
						...AUDIO_ARGS
					]);
			});
		});
		encoders.set(bin, known);
	}
	return known;
}
/** A language as the player names a track (EN, PT-BR) against a file's tag (eng, por). */
const sameLang = (track: string, tag: string) =>
	track.toLowerCase() === tag.toLowerCase() || iso3(track.split('-')[0]) === tag.toLowerCase();
/** `-disposition` so that the track showing at KEEP is the clip's default, and only that one. */
function dispositions(langs: string[], showing: string | null): string[] {
	const at = showing ? langs.findIndex((l) => sameLang(showing, l)) : -1;
	return langs.flatMap((_, i) => [`-disposition:s:${i}`, i === at ? 'default' : '0']);
}

class Failed extends Error {
	constructor(
		readonly why: ClipFailure,
		readonly stoppedAt: number | null = null
	) {
		super(why);
	}
}

function classify(e: unknown, fallback: ClipFailure): Failed {
	if (e instanceof Failed) return e;
	if (e instanceof EngineError && e.failure === 'down') return new Failed('down');
	const text = `${(e as Error)?.message ?? ''} ${(e as { stderr?: string })?.stderr ?? ''}`;
	if ((e as NodeJS.ErrnoException)?.code === 'ENOSPC' || /No space left on device/i.test(text))
		return new Failed('disk');
	return new Failed(fallback);
}

/** What ffmpeg logs when an HLS segment did not arrive; it logs it and carries on, exit 0. */
const SEGMENT_LOST =
	/Failed to open segment|Server returned|HTTP error|Connection (refused|reset)/i;

/**
 * Keeps only the segments that cover the range, and their tags, so ffmpeg asks
 * for those and nothing else: given the whole list it opens the first segment to
 * probe the stream, whatever `-ss` says. A segment's URI is resolved against the
 * playlist it came from and left pointing at the proxy. Null when no segment
 * reaches the range. `start` is the episode second the first kept segment begins.
 */
export function trimPlaylist(
	text: string,
	base: string,
	from: number,
	to: number,
	pad = FETCH_PAD_S
): { text: string; start: number; end: number; total: number; segments: number } | null {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const head: string[] = [];
	const segs: { tags: string[]; uri: string; at: number; d: number }[] = [];
	let pending: string[] = [];
	let d = 0;
	let at = 0;
	for (const raw of lines) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith('#EXTINF:')) {
			d = Number(line.slice(8).split(',')[0]) || 0;
			pending.push(line);
		} else if (line.startsWith('#EXT-X-ENDLIST')) {
			continue;
		} else if (line.startsWith('#')) {
			if (segs.length === 0 && d === 0 && !/^#EXT-X-(KEY|MAP|DISCONTINUITY)/.test(line))
				head.push(line);
			else pending.push(line);
		} else {
			segs.push({ tags: pending, uri: new URL(line, base).href, at, d });
			at += d;
			pending = [];
			d = 0;
		}
	}
	const total = at;
	const kept = segs.filter((s) => s.at + s.d > Math.max(0, from - pad) && s.at < to);
	if (!kept.length) return null;
	// An encrypted stream's key tag sits on the first segment it applies to,
	// which may be before the range: carried onto the first kept one.
	const firstKept = segs.indexOf(kept[0]);
	const carried = segs
		.slice(0, firstKept + 1)
		.flatMap((s) => s.tags.filter((t) => /^#EXT-X-(KEY|MAP)/.test(t)));
	const body = kept.flatMap((s, i) =>
		i === 0
			? [...new Set(carried), ...s.tags.filter((t) => !/^#EXT-X-(KEY|MAP)/.test(t)), s.uri]
			: [...s.tags, s.uri]
	);
	const end = kept.at(-1)!.at + kept.at(-1)!.d;
	return {
		text: [...head, ...body, '#EXT-X-ENDLIST', ''].join('\n'),
		start: kept[0].at,
		end,
		total,
		segments: kept.length
	};
}

/** The variant of a master playlist nearest a height, or null for a media playlist. */
export function variantOf(text: string, base: string, height: number | null): string | null {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const found: { uri: string; h: number }[] = [];
	lines.forEach((line, i) => {
		if (!line.startsWith('#EXT-X-STREAM-INF')) return;
		const uri = lines[i + 1]?.trim();
		if (uri) found.push({ uri, h: Number(/RESOLUTION=\d+x(\d+)/.exec(line)?.[1] ?? 0) });
	});
	if (!found.length) return null;
	const want = height ?? 1080;
	const best = [...found].sort((a, b) => Math.abs(a.h - want) - Math.abs(b.h - want))[0];
	return new URL(best.uri, base).href;
}

async function playlistText(url: string, secret: string): Promise<string> {
	const r = await fetch(url, { headers: { 'x-tsundoku': secret } });
	if (!r.ok) throw new Failed('stream');
	return r.text();
}

/**
 * A trimmed playlist, served for the length of one fetch. Over http and not from a
 * file, because ffmpeg's HLS reader carries the secret header to a segment only
 * from a playlist it opened over http: from a file every segment answers 403.
 */
function servedOnce(text: string): Promise<{ url: string; close: () => void }> {
	const path = `/${randomBytes(12).toString('hex')}.m3u8`;
	const server = createServer((req, res) => {
		if (req.url !== path) return res.writeHead(404).end();
		res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' }).end(text);
	});
	return new Promise((ok) =>
		server.listen(0, '127.0.0.1', () =>
			ok({
				url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`,
				close: () => server.close()
			})
		)
	);
}

/** Fetches what the range needs into `part`. `start` is the episode second `part` begins at. */
async function fetchPart(
	job: Job,
	part: string
): Promise<{ start: number; end: number; subtitles: { lang: string; src: string }[] }> {
	const { port, secret } = await loopback();
	let streams;
	try {
		streams = await episodeStreams(job.entryId, true, job.fresh);
	} catch (e) {
		throw classify(e, 'stream');
	}
	const tries = streams ? streamsToTry(streams.servers, job.height ?? 1080) : [];
	if (!tries.length) throw new Failed('stream', job.from);
	let last: Failed = new Failed('stream', job.from);
	for (const pick of tries) {
		const url = `http://127.0.0.1:${port}${pick.quality.src}`;
		let server: { url: string; close: () => void } | null = null;
		try {
			const hls = pick.quality.kind === 'hls';
			let input: string[];
			let start: number;
			let end: number;
			if (hls) {
				let text = await playlistText(url, secret);
				let base = url;
				const variant = variantOf(text, url, job.height);
				if (variant) {
					base = variant;
					text = await playlistText(variant, secret);
				}
				const kept = trimPlaylist(text, base, job.from, job.to);
				if (!kept) throw new Failed('stream', job.from);
				start = kept.start;
				end = kept.end;
				server = await servedOnce(kept.text);
				input = ['-extension_picky', '0', '-f', 'hls', '-i', server.url];
			} else {
				// A file a hoster links to has no segments: ffmpeg seeks it by range.
				start = Math.max(0, job.from - FETCH_PAD_S);
				end = job.to + FETCH_PAD_S;
				input = [
					'-copyts',
					'-start_at_zero',
					'-ss',
					String(start),
					'-i',
					url,
					'-t',
					String(end - start)
				];
			}
			const { stderr } = await ranFfmpeg(
				[
					'-nostdin',
					'-y',
					'-loglevel',
					'warning',
					'-progress',
					'pipe:1',
					'-rw_timeout',
					STALL_US,
					'-headers',
					`x-tsundoku: ${secret}\r\n`,
					...input,
					'-map',
					'0:v:0',
					'-map',
					'0:a?',
					'-c',
					'copy',
					'-f',
					'matroska',
					part
				],
				job,
				(s) => {
					job.percent = Math.min(99, Math.round((s / Math.max(1, end - start)) * 100));
				}
			);
			if (job.dropped) throw new Failed('stream');
			const f = await facts(part);
			const got = (hls ? 0 : f.start) + (f.seconds ?? 0);
			const stopped = (hls ? start : 0) + got;
			if (SEGMENT_LOST.test(stderr) || f.seconds === null || f.seconds <= 0)
				throw new Failed('stream', stopped);
			// ffmpeg's HLS reader skips a segment it could not get and exits 0, so a
			// file shorter than its segments add up to is a hole, not a short stream.
			if (hls && got < end - start - 1) throw new Failed('stream', stopped);
			const fileStart = hls ? start : f.start;
			return {
				start: fileStart,
				end: fileStart + (f.seconds ?? 0),
				subtitles: pick.quality.subtitles
			};
		} catch (e) {
			if (job.dropped) throw e;
			rmSync(part, { force: true });
			last = classify(e, 'stream');
			if (last.why === 'disk' || last.why === 'down') throw last;
			if (last.stoppedAt === null) last = new Failed('stream', job.from);
		} finally {
			server?.close();
		}
	}
	throw last;
}

/** Each subtitle track fetched, cut and shifted to zero, in the order the player lists them. */
async function subtitleParts(
	job: Job,
	tracks: { lang: string; src: string }[],
	stem: string
): Promise<{ path: string; lang: string }[]> {
	const { port, secret } = await loopback();
	const out: { path: string; lang: string }[] = [];
	for (const [i, t] of tracks.entries()) {
		try {
			const r = await fetch(`http://127.0.0.1:${port}${t.src}`, {
				headers: { 'x-tsundoku': secret }
			});
			if (!r.ok) continue;
			const path = `${stem}.${i}.vtt.part`;
			writeFileSync(path, toVtt(cutCues(parseVtt(await r.text()), job.from, job.to)));
			out.push({ path, lang: t.lang });
		} catch {
			// A track that wouldn't come is left out; the clip still is.
		}
	}
	return out;
}

async function cut(
	job: Job,
	area: ReturnType<typeof highlightsArea>
): Promise<{ clip: string; still: string; facts: Probed }> {
	const tag = randomBytes(6).toString('hex');
	const clip = join(area.clips, `${tag}.mkv.part`);
	const still = join(area.stills, `${tag}.webp.part`);
	const fetched = join(area.clips, `${tag}.fetch.part`);
	const length = job.to - job.from;
	let subs: { path: string; lang: string }[] = [];
	const clean = () => {
		for (const f of [fetched, ...subs.map((s) => s.path)]) rmSync(f, { force: true });
	};
	try {
		const file = episodeFile(job.entryId);
		let args: string[];
		if (file) {
			job.streamed = false;
			const f = await facts(file);
			args = [
				'-ss',
				String(job.from),
				'-t',
				String(length),
				'-i',
				file,
				'-map',
				'0:v:0',
				'-map',
				'0:a?',
				'-map',
				'0:s?',
				...(await encodeArgs()),
				'-c:s',
				'copy',
				...dispositions(f.subtitles, job.subtitle)
			];
		} else {
			job.step = 'fetching';
			job.percent = 0;
			job.streamed = true;
			const got = await fetchPart(job, fetched);
			// The stream ended before the out point: what there was is the clip.
			job.to = Math.min(job.to, got.end);
			if (job.to - job.from < 0.5) throw new Failed('stream', got.end);
			subs = await subtitleParts(job, got.subtitles, join(area.clips, tag));
			args = [
				'-ss',
				String(Math.max(0, job.from - got.start)),
				'-t',
				String(job.to - job.from),
				'-i',
				fetched,
				...subs.flatMap((s) => ['-f', 'webvtt', '-i', s.path]),
				'-map',
				'0:v:0',
				'-map',
				'0:a?',
				...subs.flatMap((_, i) => ['-map', `${i + 1}:s:0`]),
				...(await encodeArgs()),
				'-c:s',
				'srt',
				...subs.flatMap((s, i) => [`-metadata:s:s:${i}`, `language=${iso3(s.lang)}`]),
				...dispositions(
					subs.map((s) => s.lang),
					job.subtitle
				)
			];
		}
		job.step = 'cutting';
		job.percent = 0;
		const span = job.to - job.from;
		await ranFfmpeg(
			[
				'-nostdin',
				'-y',
				'-loglevel',
				'error',
				'-progress',
				'pipe:1',
				...args,
				'-f',
				'matroska',
				clip
			],
			job,
			(s) => (job.percent = Math.min(99, Math.round((s / span) * 100)))
		);
		await ranFfmpeg(
			[
				'-nostdin',
				'-y',
				'-loglevel',
				'error',
				'-i',
				clip,
				'-frames:v',
				'1',
				'-c:v',
				'libwebp',
				'-f',
				'webp',
				still
			],
			job,
			() => {}
		);
		return { clip, still, facts: await facts(clip) };
	} catch (e) {
		for (const f of [clip, still]) rmSync(f, { force: true });
		throw e;
	} finally {
		clean();
	}
}

function writeRow(
	job: Job,
	made: { clip: string; still: string; facts: Probed },
	area: ReturnType<typeof highlightsArea>,
	db: Database.Database,
	now: number
): number {
	return db
		.transaction(() => {
			// Read now: a series hidden while its clip was cut is hidden in the row.
			const snap = snapshot(job.entryId, true, db);
			if (!snap) throw new Failed('gone');
			const id = Number(
				db
					.prepare(
						`INSERT INTO highlights (kind, series_id, entry_id, origin_key, number, season, clip_in,
							clip_out, series_title, series_kind, entry_label, entry_title, volume, made_at, hidden,
							copy_bytes, copy_width, copy_height, quality)
						VALUES ('clip', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mkv h264')`
					)
					.run(
						snap.series_id,
						snap.entry_id,
						snap.origin_key,
						snap.number,
						snap.season,
						job.from,
						job.to,
						snap.series_title,
						snap.series_kind,
						snap.label,
						snap.title,
						snap.volume,
						now,
						snap.hidden,
						statSync(made.clip).size,
						made.facts.width,
						made.facts.height
					).lastInsertRowid
			);
			const copy = `clips/${id}.mkv`;
			const still = `stills/${id}.webp`;
			renameSync(made.clip, join(area.root, copy));
			renameSync(made.still, join(area.root, still));
			db.prepare(`UPDATE highlights SET copy_path = ?, still_path = ? WHERE id = ?`).run(
				copy,
				still,
				id
			);
			return id;
		})
		.immediate();
}

async function runJob(job: Job): Promise<void> {
	const db = getDb();
	const area = highlightsArea();
	try {
		mkdirSync(area.clips, { recursive: true });
		mkdirSync(area.stills, { recursive: true });
		const made = await cut(job, area);
		if (job.dropped) {
			rmSync(made.clip, { force: true });
			rmSync(made.still, { force: true });
			return;
		}
		job.highlightId = writeRow(job, made, area, db, Date.now());
		job.step = 'made';
		job.percent = 100;
	} catch (e) {
		if (job.dropped) return;
		const f = classify(e, job.streamed ? 'stream' : 'file');
		job.step = 'failed';
		job.why = f.why;
		job.stoppedAt = f.stoppedAt;
	} finally {
		job.finishedAt = Date.now();
		job.child = null;
	}
}

async function pump(): Promise<void> {
	if (busy) return;
	busy = true;
	try {
		for (let next = queue.shift(); next; next = queue.shift())
			if (!next.dropped) await runJob(next);
	} finally {
		busy = false;
	}
}

function forgetOld(now: number): void {
	for (const [id, j] of jobs)
		if (j.finishedAt !== null && now - j.finishedAt > KEEP_FINISHED_MS) jobs.delete(id);
}

/** A kept clip with this range already, not deleted. */
function standing(db: Database.Database, entryId: number, from: number, to: number): number | null {
	const r = db
		.prepare(
			`SELECT id FROM highlights WHERE kind = 'clip' AND entry_id = ? AND deleted_at IS NULL
			AND ABS(clip_in - ?) < 0.05 AND ABS(clip_out - ?) < 0.05 ORDER BY id LIMIT 1`
		)
		.get(entryId, from, to) as { id: number } | undefined;
	return r?.id ?? null;
}

export type KeepClip = {
	entryId: number;
	from: unknown;
	to: unknown;
	/** The track showing at KEEP, the clip's default; null when none shows. */
	subtitle?: string | null;
	height?: number | null;
	/** TRY AGAIN asks the stream afresh, as the player does. */
	fresh?: boolean;
};

/**
 * KEEP: a job, or the one already going for the same range (a second press), or
 * the clip already kept (`step: 'made'`). The lane picks it up in the background.
 */
export function keepClip(ask: KeepClip, reveal: boolean, db: Database.Database = getDb()): ClipJob {
	if (!swept) {
		swept = true;
		sweepClips(db);
	}
	const range = clipAsk(ask.from, ask.to);
	if (!range) throw new ClipError('no such range', 'bad_range');
	const ep = episodeRow(ask.entryId, reveal);
	if (!ep) throw new ClipError('no such episode', 'not_found');
	const snap = snapshot(ask.entryId, reveal, db);
	if (!snap) throw new ClipError('no such episode', 'not_found');
	const now = Date.now();
	forgetOld(now);
	const twin = [...jobs.values()].find(
		(j) =>
			j.entryId === ask.entryId &&
			Math.abs(j.from - range.from) < 0.05 &&
			Math.abs(j.to - range.to) < 0.05 &&
			!j.dropped &&
			j.step !== 'failed' &&
			j.step !== 'made'
	);
	if (twin) return publicJob(twin);
	const before = standing(db, ask.entryId, range.from, range.to);
	const job: Job = {
		id: randomBytes(8).toString('hex'),
		entryId: ask.entryId,
		seriesId: snap.series_id,
		seriesTitle: snap.series_title,
		entryLabel: snap.label,
		from: range.from,
		to: range.to,
		streamed: episodeFile(ask.entryId) === null,
		step: before !== null ? 'made' : 'waiting',
		percent: before !== null ? 100 : 0,
		why: null,
		stoppedAt: null,
		highlightId: before,
		finishedAt: before !== null ? now : null,
		subtitle: ask.subtitle ?? null,
		height: ask.height ?? null,
		fresh: ask.fresh ?? false,
		child: null,
		dropped: false
	};
	jobs.set(job.id, job);
	if (before === null) {
		queue.push(job);
		void pump();
	}
	return publicJob(job);
}

/** ✕: stops it and forgets it. Leaving the page does not come here (A6). */
export function dropClip(id: string, reveal: boolean): boolean {
	const j = jobs.get(id);
	if (!j || !episodeRow(j.entryId, reveal)) return false;
	j.dropped = true;
	j.child?.kill('SIGKILL');
	jobs.delete(id);
	return true;
}

/** Jobs the viewer may see: hidden means hidden, a job over a hidden series is none of theirs. */
export function clipJobs(reveal: boolean, entryId?: number): ClipJob[] {
	forgetOld(Date.now());
	const present = getDb().prepare(`SELECT 1 FROM highlights WHERE id = ? AND deleted_at IS NULL`);
	return (
		[...jobs.values()]
			// A clip deleted since it was made is no box on the scrubber.
			.filter((j) => j.step !== 'made' || !!present.get(j.highlightId))
			.filter(
				(j) => (entryId === undefined || j.entryId === entryId) && !!episodeRow(j.entryId, reveal)
			)
			.map(publicJob)
	);
}

/** For a test: the lane's own state back to nothing. */
export function forgetClips(): void {
	jobs.clear();
	queue.length = 0;
	swept = false;
	encoders.clear();
}

/** The boxes on the scrubber for one episode: kept clips, hidden means hidden. */
export function keptClipRanges(
	entryId: number,
	reveal: boolean,
	db: Database.Database = getDb()
): { from: number; to: number; id: number }[] {
	return db
		.prepare(
			`SELECT id, clip_in AS "from", clip_out AS "to" FROM highlights
			WHERE kind = 'clip' AND entry_id = ? AND deleted_at IS NULL
				AND clip_in IS NOT NULL AND clip_out IS NOT NULL ${reveal ? '' : 'AND hidden = 0'}
			ORDER BY clip_in`
		)
		.all(entryId) as { from: number; to: number; id: number }[];
}
