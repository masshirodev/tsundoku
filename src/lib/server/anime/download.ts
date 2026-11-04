import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from '../fspath.ts';
import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { coverDir } from '../covers.ts';
import { getSetting } from '../settings.ts';
import { loopback } from './loopback.ts';
import { ownEntry } from './marks.ts';
import { showEntry } from '../season-links.ts';
import type { Kind } from '../../library/kinds.ts';
import { wantPictures } from './pictures.ts';
import { keptOf } from '../../settings/catalog.ts';
import { EngineError } from '../engine/client.ts';
import { failed, isPaused, nextUp, queueRows, recover } from '../engine/queue.ts';
import { parseAnimeKey, type DownloadState } from '../../library/downloads.ts';
import {
	ANIME_FOLDER,
	episodeNfo,
	episodePath,
	HIDDEN_ANIME_FOLDER,
	keptTracks,
	muxArgs,
	progressSeconds,
	seriesFolderName,
	tvshowNfo
} from '../../library/anime-files.ts';
import type { SeriesDownloads } from '../download-types.ts';
import { episodeStreams, probe, type StreamServer } from './streams.ts';

/**
 * Downloading episodes (doc/ANIME.md, "Downloading"; card c157): one at a
 * time, in a lane of their own in the one queue, so a 400 MB episode never
 * holds up a 3 MB chapter. An episode's streams are resolved right before
 * (AnimePahe's only work through the engine, and go stale), and ffmpeg
 * muxes the video, the audio and the subtitles into one MKV in the series'
 * Jellyfin-shaped folder, beside its NFO. ffmpeg never fetches anything
 * itself: its inputs are a loopback proxy of tsundoku's own that serves only
 * the tokens streams.ts handed out, so every fetch passes the same guard as
 * the player's (internet only, the engine only where the engine named it).
 */

const FFMPEG = () => process.env.FFMPEG ?? 'ffmpeg';
const FFPROBE = () => process.env.FFPROBE ?? 'ffprobe';

export type AnimeDeps = {
	db: Database.Database;
	library: string;
	now: () => number;
	/** How a re-ask waits (tests pass one that doesn't). */
	wait?: (ms: number) => Promise<void>;
	/** Each file written, as it lands: attached at once (engine/run.ts). */
	arrived?: (file: string) => void;
};

/** A source that answered with no videos is asked again after these (doc/ANIME.md, "Downloading"). */
export const REASK_MS = [10_000, 30_000];

export class AnimeDownloadError extends Error {
	readonly failure: 'source' | 'not-found' | 'down' | 'disk';
	constructor(message: string, failure: AnimeDownloadError['failure']) {
		super(message);
		this.failure = failure;
	}
}

// ---- where an episode goes ------------------------------------------------------------------------

type SeriesRow = {
	id: number;
	title: string;
	hidden: number;
	description: string;
	status: string;
	source: string;
	origin_key: string;
};

/**
 * The series' folder under the library folder, fixed at its first download
 * (rung 48): `Anime/<Series>`, or `Anime (hidden)/<Series>` for a hidden one.
 */
export function seriesFolder(db: Database.Database, s: SeriesRow): string {
	const known = db.prepare(`SELECT folder FROM anime_series WHERE series_id = ?`).get(s.id) as
		{ folder: string } | undefined;
	if (known) return known.folder;
	const top = s.hidden ? HIDDEN_ANIME_FOLDER : ANIME_FOLDER;
	const name = seriesFolderName(s.title);
	const taken = db.prepare(`SELECT 1 FROM anime_series WHERE folder = ?`);
	let folder = posix.join(top, name);
	for (let n = 2; taken.get(folder); n++) folder = posix.join(top, `${name} (${n})`);
	db.prepare(`INSERT INTO anime_series (series_id, folder) VALUES (?, ?)`).run(s.id, folder);
	return folder;
}

/** The height an episode downloads at: its own, else SETTINGS' (1080 by default). */
function wantedHeight(db: Database.Database, entryId: number): number {
	const own = db.prepare(`SELECT quality FROM anime_episodes WHERE entry_id = ?`).get(entryId) as
		{ quality: number | null } | undefined;
	return own?.quality ?? (Number(getSetting('anime_download_quality')) || 1080);
}

/**
 * The stream to download: the first server, in the source's order, with a
 * quality at most [height] lines, the best of those; failing that, the
 * first server's lowest.
 */
export function pickStream(servers: StreamServer[], height: number) {
	return streamsToTry(servers, height)[0] ?? null;
}

/**
 * Every stream worth trying, in order: each server's best at most [height]
 * lines, in the source's order, then each server's lowest for a server with
 * nothing that low. A server that fails mid-download passes to the next, as
 * the player's do.
 */
export function streamsToTry(servers: StreamServer[], height: number) {
	const out: { server: StreamServer; quality: StreamServer['qualities'][number] }[] = [];
	for (const s of servers) {
		const q = s.qualities.find((x) => x.height !== null && x.height <= height);
		if (q) out.push({ server: s, quality: q });
	}
	for (const s of servers)
		if (!out.some((o) => o.server === s) && s.qualities.length)
			out.push({ server: s, quality: s.qualities[s.qualities.length - 1] });
	return out;
}

async function run(cmd: string, args: string[], onLine?: (block: string) => void): Promise<string> {
	return new Promise((ok, no) => {
		const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		p.stdout.on('data', (b: Buffer) => {
			out += b.toString();
			onLine?.(b.toString());
		});
		p.stderr.on('data', (b: Buffer) => (err += b.toString()));
		p.on('error', (e) => no(new AnimeDownloadError(`${cmd} didn't start: ${e.message}`, 'disk')));
		p.on('close', (code) =>
			code === 0
				? ok(out)
				: no(new AnimeDownloadError(err.trim().split('\n').pop() || `${cmd} failed`, 'source'))
		);
	});
}

/** A file's length in seconds, and whether it has a picture at all. */
async function fileFacts(path: string): Promise<{ seconds: number | null; video: boolean }> {
	const out = await run(FFPROBE(), [
		'-v',
		'error',
		'-show_entries',
		'format=duration:stream=codec_type',
		'-of',
		'json',
		path
	]);
	const j = JSON.parse(out) as {
		format?: { duration?: string };
		streams?: { codec_type: string }[];
	};
	const d = Number(j.format?.duration);
	return {
		seconds: Number.isFinite(d) && d > 0 ? d : null,
		video: !!j.streams?.some((s) => s.codec_type === 'video')
	};
}

/** tvshow.nfo and poster.jpg, beside the seasons; the poster from the library's own cover. */
async function writeSeriesFiles(db: Database.Database, s: SeriesRow, dir: string): Promise<void> {
	const genres = (
		db
			.prepare(
				`SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id WHERE st.series_id = ? AND t.namespace = 'genre' ORDER BY t.value`
			)
			.all(s.id) as { value: string }[]
	).map((r) => r.value);
	// Jellyfin's metadata plugins look a show up by these ids, so only a link
	// to the show's own kind of entry gives them (c395, `ownEntry`): a manga's
	// AniList or MAL id would fetch another work's metadata, or another show's.
	// They are the show's: season 1's link, else the earliest season linked,
	// read from the season rows (c381), so a show with only season 2 linked
	// has them too. The first-season mirror, `series_links`, is not read.
	const kind = (db.prepare(`SELECT kind FROM series WHERE id = ?`).get(s.id) as { kind: Kind })
		.kind;
	const link = showEntry(s.id, (format) => ownEntry(kind, format), db);
	writeFileSync(
		join(dir, 'tvshow.nfo'),
		tvshowNfo({
			key: s.origin_key,
			title: s.title,
			plot: s.description,
			status: s.status,
			genres,
			source: s.source,
			anilist: link?.anilistId ?? null,
			mal: link?.malId ?? null
		})
	);
	const poster = join(dir, 'poster.jpg');
	const cover = join(coverDir(), `${s.id}.webp`);
	if (!existsSync(poster) && existsSync(cover)) {
		try {
			const sharp = (await import('sharp')).default;
			await sharp(readFileSync(cover)).jpeg({ quality: 88 }).toFile(poster);
		} catch {
			// A series without a poster is still a series to Jellyfin.
		}
	}
}

type EpisodeRow = {
	id: number;
	series_id: number;
	source_url: string;
	title: string;
	position: number;
	season: number | null;
	episode_number: number | null;
	episode_note: string;
	duration_s: number | null;
};

/**
 * Downloads one queued episode into its series' folder. Throws an
 * AnimeDownloadError (the queue counts the try); writes nothing half-done:
 * the MKV is written beside its place and renamed.
 */
export async function downloadEpisode(entryId: number, d: AnimeDeps): Promise<string> {
	const e = d.db
		.prepare(
			`SELECT id, series_id, source_url, title, position, season, episode_number, episode_note, duration_s FROM entries WHERE id = ?`
		)
		.get(entryId) as EpisodeRow | undefined;
	const s = e
		? (d.db
				.prepare(
					`SELECT id, title, hidden, description, status, source, origin_key FROM series WHERE id = ?`
				)
				.get(e.series_id) as SeriesRow | undefined)
		: undefined;
	if (!e || !s || !parseAnimeKey(s.origin_key))
		throw new AnimeDownloadError('Not an episode from a source', 'not-found');

	const wait = d.wait ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
	let tries: ReturnType<typeof streamsToTry> = [];
	// An empty answer is often a source asked too soon, not an episode without videos:
	// asked again a little later before the queue counts a try.
	for (const pause of [0, ...REASK_MS]) {
		if (pause) await wait(pause);
		let streams;
		try {
			streams = await episodeStreams(entryId, true, true, d.now());
		} catch (err) {
			throw new AnimeDownloadError(
				(err as Error).message,
				err instanceof EngineError && err.failure === 'down' ? 'down' : 'source'
			);
		}
		tries = streams ? streamsToTry(streams.servers, wantedHeight(d.db, entryId)) : [];
		if (tries.length) break;
	}
	if (!tries.length) throw new AnimeDownloadError('No server answered', 'source');

	const folder = seriesFolder(d.db, s);
	const dir = join(d.library, folder);
	const number = e.episode_number ?? e.position;
	const rel = episodePath({
		series: posix.basename(folder),
		season: e.season,
		number,
		title: e.title
	});
	const path = join(dir, rel);
	mkdirSync(dirname(path), { recursive: true });

	const { port, secret } = await loopback();
	const local = (src: string) => `http://127.0.0.1:${port}${src}`;
	const progress = d.db.prepare(
		`UPDATE download_queue SET pages = 1000, done_pages = ? WHERE entry_id = ?`
	);
	const partial = `${path}.partial`;
	// What's kept of each server's tracks: SETTINGS' DOWNLOADING (c160).
	const keep = {
		kept: keptOf(getSetting('anime_download_audio')),
		subs: getSetting('anime_download_subs') === 'audio' ? ('audio' as const) : ('all' as const)
	};
	// Kept and tagged by language alone, as before c386 gave tracks variants
	// (PT-BR, ES-419): SETTINGS' AUDIO KEPT names languages, and a file's
	// tag is ISO 639-2's three letters, which have no variant.
	const base = <T extends { lang: string }>(ts: T[]) =>
		ts.map((t) => ({ ...t, lang: t.lang.split('-')[0] }));
	const kept = (q: (typeof tries)[number]['quality']) =>
		keptTracks(base(q.audio), base(q.subtitles), keep);
	let got: (typeof tries)[number] | null = null;
	let last: unknown = null;
	for (const pick of tries) {
		progress.run(0, entryId);
		// How long the episode is, so the queue's share means something.
		const length =
			(await probe(pick.quality.src).catch(() => null))?.seconds ?? e.duration_s ?? null;
		try {
			await run(
				FFMPEG(),
				muxArgs({
					video: local(pick.quality.src),
					videoKind: pick.quality.kind,
					audio: kept(pick.quality).audio.map((a) => ({ url: local(a.src), lang: a.lang })),
					subtitles: kept(pick.quality).subtitles.map((t) => ({ url: local(t.src), lang: t.lang })),
					header: `x-tsundoku: ${secret}`,
					out: partial,
					title: e.title || `Episode ${number}`
				}),
				(block) => {
					const at = progressSeconds(block);
					if (at !== null && length)
						progress.run(Math.min(999, Math.round((at / length) * 1000)), entryId);
				}
			);
			const facts = await fileFacts(partial);
			if (!facts.video) throw new AnimeDownloadError('The stream had no picture', 'source');
			renameSync(partial, path);
			writeFileSync(
				path.replace(/\.mkv$/, '.nfo'),
				episodeNfo({
					sourceUrl: e.source_url,
					title: e.title,
					season: e.season,
					number,
					position: e.position,
					durationS: facts.seconds ?? length,
					note: (e.episode_note || '') as '' | 'filler' | 'recap'
				})
			);
			got = pick;
			break;
		} catch (err) {
			rmSync(partial, { force: true });
			last = err;
		}
	}
	if (!got)
		throw last instanceof AnimeDownloadError
			? last
			: new AnimeDownloadError((last as Error)?.message ?? 'No server sent the episode', 'source');
	try {
		await writeSeriesFiles(d.db, s, dir);
	} catch (err) {
		throw new AnimeDownloadError(
			`The series' files couldn't be written: ${(err as Error).message}`,
			'disk'
		);
	}
	d.db
		.prepare(
			`INSERT INTO anime_episodes (entry_id, quality, downloaded_at) VALUES (?, ?, ?)
			ON CONFLICT (entry_id) DO UPDATE SET downloaded_at = excluded.downloaded_at`
		)
		.run(entryId, got.quality.height, d.now());
	return path;
}

/** One pass: the next ready episode, if any. Returns how many arrived (0 or 1). */
export async function runAnimeOnce(d: AnimeDeps): Promise<number> {
	if (isPaused()) return 0;
	const [job] = nextUp(1, d.now(), d.db, 'anime');
	if (!job) return 0;
	d.db
		.prepare(`UPDATE download_queue SET state = 'downloading' WHERE entry_id = ?`)
		.run(job.entryId);
	try {
		const file = await downloadEpisode(job.entryId, d);
		d.db.prepare(`DELETE FROM download_queue WHERE entry_id = ?`).run(job.entryId);
		d.arrived?.(file);
		// Its picture from the file, if it has none yet (doc/ANIME.md, "Episode pictures").
		wantPictures([job.entryId], d.db);
		return 1;
	} catch (err) {
		const f = err instanceof AnimeDownloadError ? err.failure : 'source';
		failed(job.entryId, f, (err as Error).message, d.now(), d.db);
		return 0;
	}
}

let loop: ReturnType<typeof setTimeout> | null = null;
let running = false;

/** The episode lane, started beside the chapter and novel workers (engine/run.ts). */
export function startAnimeWorker(
	library: string,
	onArrived: (files: string[]) => void,
	db: Database.Database = getDb()
): void {
	if (loop || running) return;
	recover(db, 'anime');
	const d: AnimeDeps = { db, library, now: Date.now };
	const tick = async () => {
		running = true;
		try {
			const written: string[] = [];
			d.arrived = (file) => written.push(file);
			if ((await runAnimeOnce(d)) > 0) onArrived(written);
		} catch (err) {
			console.warn(`tsundoku: episode downloader: ${(err as Error).message}`);
		} finally {
			running = false;
			loop = setTimeout(() => void tick(), 3000);
			loop.unref();
		}
	};
	loop = setTimeout(() => void tick(), 1500);
	loop.unref();
	const stop = () => {
		if (loop) clearTimeout(loop);
		loop = null;
	};
	process.once('SIGTERM', stop);
	process.once('SIGINT', stop);
}

/** Episodes written and not imported yet: a restart dropped their import. */
export const pendingAnimeImports = (db: Database.Database = getDb()) =>
	(
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM anime_episodes a JOIN entries e ON e.id = a.entry_id
				WHERE a.downloaded_at IS NOT NULL AND e.available = 0`
			)
			.get() as { n: number }
	).n;

// ---- the series screen ------------------------------------------------------------------------------

/** Whether a series is an anime from a source: its downloads are this module's. */
export function isAnimeSeries(seriesId: number, db: Database.Database = getDb()): boolean {
	const s = db.prepare(`SELECT origin_key FROM series WHERE id = ?`).get(seriesId) as
		{ origin_key: string | null } | undefined;
	return parseAnimeKey(s?.origin_key ?? null) !== null;
}

/**
 * Where an anime's episodes stand, for its DOWNLOAD row and rows: the
 * queue, and what the worker wrote that the import hasn't attached yet.
 * FOLLOW asks its source (anime/follow.ts).
 */
export function animeSeriesDownloads(
	seriesId: number,
	entries: { id: number; available: boolean }[],
	db: Database.Database = getDb()
): SeriesDownloads {
	const s = db.prepare(`SELECT origin_key, followed_at FROM series WHERE id = ?`).get(seriesId) as
		{ origin_key: string | null; followed_at: number | null } | undefined;
	if (!parseAnimeKey(s?.origin_key ?? null)) return { kind: 'none' };
	const written = new Set(
		(
			db
				.prepare(
					`SELECT a.entry_id FROM anime_episodes a JOIN entries e ON e.id = a.entry_id
					WHERE e.series_id = ? AND a.downloaded_at IS NOT NULL`
				)
				.all(seriesId) as { entry_id: number }[]
		).map((r) => r.entry_id)
	);
	const rows = new Map(queueRows(db).map((r) => [r.entryId, r]));
	const states: Record<number, DownloadState> = {};
	for (const e of entries) {
		const q = rows.get(e.id);
		if (e.available) states[e.id] = { kind: 'have' };
		else if (written.has(e.id)) states[e.id] = { kind: 'importing' };
		else if (q?.state === 'queued') states[e.id] = { kind: 'queued', chapterId: e.id };
		else if (q?.state === 'downloading')
			states[e.id] = {
				kind: 'downloading',
				chapterId: e.id,
				page: q.donePages,
				pages: q.pages,
				fraction: q.pages > 0 ? q.donePages / q.pages : 0
			};
		else if (q?.state === 'failed')
			states[e.id] = { kind: 'failed', chapterId: e.id, tries: q.tries };
		else states[e.id] = { kind: 'none', chapterId: e.id };
	}
	const queuedElsewhere = [...rows.values()].filter(
		(r) => r.seriesId !== seriesId && r.state !== 'failed'
	).length;
	const checked = db
		.prepare(`SELECT checked_at FROM anime_checks WHERE series_id = ?`)
		.get(seriesId) as { checked_at: number } | undefined;
	return {
		kind: 'ok',
		states,
		queuedElsewhere,
		follow: { on: (s?.followed_at ?? null) !== null, checked: checked?.checked_at ?? null }
	};
}

/** Queues episodes at a height of their own (ALL's QUALITY), or SETTINGS' when none is given. */
export function rememberQuality(
	entryIds: number[],
	height: number | null,
	db: Database.Database = getDb()
): void {
	if (height === null) return;
	const put = db.prepare(
		`INSERT INTO anime_episodes (entry_id, quality) VALUES (?, ?)
		ON CONFLICT (entry_id) DO UPDATE SET quality = excluded.quality`
	);
	db.transaction(() => entryIds.forEach((id) => put.run(id, height)))();
}
