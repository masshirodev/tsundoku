import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from '../fspath.ts';
import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { coverDir } from '../covers.ts';
import { getSetting } from '../settings.ts';
import { hlsReaderArgs } from './hls-reader.ts';
import { loopback } from './loopback.ts';
import { ownEntry } from './marks.ts';
import { seasonLinks, showEntry } from '../season-links.ts';
import {
	entryOrigin,
	folderTaken,
	followOrigin,
	seasonFact,
	seasonFacts,
	type SeasonFact
} from '../season-facts.ts';
import type { Kind } from '../../library/kinds.ts';
import { wantPictures } from './pictures.ts';
import { keptOf } from '../../settings/catalog.ts';
import { EngineError } from '../engine/client.ts';
import { failed, isPaused, nextUp, queueRows, recover } from '../engine/queue.ts';
import { parseAnimeKey, type DownloadState } from '../../library/downloads.ts';
import {
	episodeNfo,
	episodePath,
	filmFile,
	keptTracks,
	movieNfo,
	muxArgs,
	progressSeconds,
	seriesFolderName,
	tvshowNfo
} from '../../library/anime-files.ts';
import { kindFacts, storageOf } from '../../library/kinds.ts';
import { tmdbQuery } from '../../library/tmdb.ts';
import { tmdbFacts } from '../tmdb-links.ts';
import type { SeriesDownloads } from '../download-types.ts';
import { episodeStreams, probe, type StreamServer } from './streams.ts';

/**
 * Downloading episodes (doc/ANIME.md, "Downloading"): one at a
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
	/** Read from the series when a caller's row leaves it out. */
	kind?: Kind;
	title: string;
	hidden: number;
	description: string;
	status: string;
	source: string;
	origin_key: string | null;
};

const kindOfRow = (db: Database.Database, s: Pick<SeriesRow, 'id' | 'kind'>): Kind =>
	s.kind ??
	(db.prepare(`SELECT kind FROM series WHERE id = ?`).get(s.id) as { kind: Kind } | undefined)
		?.kind ??
	'anime';

/** The kind's own top folder: `Anime/`, `Shows/`, `Movies/`, or its hidden twin. */
const topFolder = (db: Database.Database, s: SeriesRow) => {
	const st = storageOf(kindOfRow(db, s));
	return s.hidden ? st.hidden : st.folder;
};

/**
 * A film's folder name, Jellyfin's `<Title (Year)>`: TMDB's title and year
 * when the film is linked, else the source's title with its release words
 * taken off (`Lupin [Hindi-English] 1080p` → `Lupin`) and the year it names.
 * A show's and an anime's is the series' own title.
 */
export function folderNameOf(
	db: Database.Database,
	s: Pick<SeriesRow, 'id' | 'kind' | 'title'>
): string {
	if (storageOf(kindOfRow(db, s)).layout !== 'film') return seriesFolderName(s.title);
	const t = tmdbFacts(s.id);
	if (t?.title) return seriesFolderName(t.title, t.year);
	const q = tmdbQuery(s.title);
	return seriesFolderName(q.query, q.year);
}

/**
 * The series' folder under the library folder, fixed at its first download
 * (migration 48): `Anime/<Series>`, `Shows/<Series>`, `Movies/<Title (Year)>`, or the
 * kind's hidden folder for a hidden one.
 */
export function seriesFolder(db: Database.Database, s: SeriesRow): string {
	const known = db.prepare(`SELECT folder FROM anime_series WHERE series_id = ?`).get(s.id) as
		{ folder: string } | undefined;
	if (known) return known.folder;
	const top = topFolder(db, s);
	const name = folderNameOf(db, s);
	const folder = freeFolder(db, top, name);
	db.prepare(`INSERT INTO anime_series (series_id, folder) VALUES (?, ?)`).run(s.id, folder);
	return folder;
}

/** The first of `<top>/<name>`, `<name> (2)`, … no series and no season holds. */
export function freeFolder(db: Database.Database, top: string, name: string): string {
	let folder = posix.join(top, name);
	for (let n = 2; folderTaken(folder, db); n++) folder = posix.join(top, `${name} (${n})`);
	return folder;
}

export type EpisodePlace = {
	folder: string;
	/** What this folder's tvshow.nfo names: the key its episodes came from. */
	key: string;
	title: string;
	/** Set when the folder is this one season's, so its link is the show's to Jellyfin there. */
	season: number | null;
};

/** The last file on disk of one season, as a path, for telling which folder holds it. */
function fileOfSeason(db: Database.Database, seriesId: number, season: number): string | null {
	const r = db
		.prepare(
			`SELECT s.path, e.file FROM entries e JOIN series s ON s.id = e.series_id
			WHERE e.series_id = ? AND COALESCE(e.season, 0) = ? AND e.available = 1 AND e.file != ''
			ORDER BY e.position DESC, e.id DESC LIMIT 1`
		)
		.get(seriesId, season) as { path: string; file: string } | undefined;
	return r ? posix.join(r.path, r.file) : null;
}

/**
 * Where a season's episodes go (doc/DOWNLOADS.md). A season with a
 * folder keeps it. **A season with files stays where they are**, whatever its
 * row says of its source: a MOVE re-keys the row and moves no file, so the
 * next episode lands beside the last (`series_season_facts_folder` is unique,
 * so the place can't be written onto the row for every season that moves). Only
 * a season with no files and a source of its own gets a folder at its first
 * download, as a series does, named by what the source calls it, under the
 * same uniqueness; a season sharing that source reuses its folder. Everything
 * else is the series' folder: no row at all, or a row that says nothing of
 * where its files are.
 *
 * The answer names the folder's own key and title, which are its tvshow.nfo:
 * a season lodging in another's folder doesn't rename that folder to itself.
 */
export function episodePlace(
	db: Database.Database,
	s: SeriesRow,
	season: number | null
): EpisodePlace {
	const fact = seasonFact(s.id, season, db);
	const inSeriesFolder = (): EpisodePlace => ({
		folder: seriesFolder(db, s),
		key: s.origin_key ?? fact?.originKey ?? '',
		title: s.title,
		season: null
	});
	const seasonsOwn = (f: SeasonFact, folder: string): EpisodePlace => ({
		folder,
		key: f.originKey ?? s.origin_key ?? '',
		title: f.sourceTitle || s.title,
		season: f.season
	});
	if (!fact) return inSeriesFolder();
	if (fact.folder) return seasonsOwn(fact, fact.folder);
	const facts = seasonFacts(s.id, db);
	const file = fileOfSeason(db, s.id, fact.season);
	if (file !== null) {
		const holder = facts.find((f) => f.folder && file.includes(`/${f.folder}/`));
		return holder?.folder ? seasonsOwn(holder, holder.folder) : inSeriesFolder();
	}
	if (!fact.originKey || fact.originKey === s.origin_key) return inSeriesFolder();
	const sibling = facts.find((f) => f.originKey === fact.originKey && f.folder)?.folder;
	if (sibling) return seasonsOwn(fact, sibling);
	const folder = freeFolder(db, topFolder(db, s), seriesFolderName(fact.sourceTitle || s.title));
	db.prepare(`UPDATE series_season_facts SET folder = ? WHERE series_id = ? AND season = ?`).run(
		folder,
		s.id,
		fact.season
	);
	return seasonsOwn(fact, folder);
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

const genresOf = (db: Database.Database, seriesId: number): string[] =>
	(
		db
			.prepare(
				`SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id WHERE st.series_id = ? AND t.namespace = 'genre' ORDER BY t.value`
			)
			.all(seriesId) as { value: string }[]
	).map((r) => r.value);

/**
 * A film's NFO: Jellyfin's `<movie>`, with its TMDB id when linked, and the
 * series' key, the entry's address and its position, so a
 * rescan folds the file back onto both without a tvshow.nfo above it.
 */
function filmNfo(
	db: Database.Database,
	s: SeriesRow,
	place: EpisodePlace,
	e: { sourceUrl: string; position: number; durationS: number | null }
): string {
	const t = tmdbFacts(s.id);
	return movieNfo({
		key: place.key,
		sourceUrl: e.sourceUrl,
		title: t?.title || place.title,
		plot: s.description || t?.overview || '',
		genres: genresOf(db, s.id),
		source: s.source,
		position: e.position,
		year: t?.year ?? tmdbQuery(s.title).year,
		durationS: e.durationS,
		tmdb: t?.id ?? null
	});
}

/**
 * tvshow.nfo and poster.jpg, beside the seasons; the poster from the library's
 * own cover. A film has no tvshow.nfo (its `<movie>` NFO is beside its file),
 * only the poster.
 */
async function writeSeriesFiles(
	db: Database.Database,
	s: SeriesRow,
	dir: string,
	place: EpisodePlace
): Promise<void> {
	const genres = genresOf(db, s.id);
	// Jellyfin's metadata plugins look a show up by these ids, so only a link
	// to the show's own kind of entry gives them (`ownEntry`): a manga's
	// AniList or MAL id would fetch another work's metadata, or another show's.
	// They are the show's: season 1's link, else the earliest season linked,
	// read from the season rows, so a show with only season 2 linked
	// has them too. The first-season mirror, `series_links`, is not read.
	const kind = kindOfRow(db, s);
	// A season's own folder is its own show to Jellyfin, so the ids are that
	// season's, and the key is the one its episodes come from: the importer
	// folds this folder back onto the series by that key (import/write.ts).
	const seasonEntry =
		place.season === null
			? null
			: seasonLinks(s.id, db).find(
					(l) => l.season === place.season && l.part === 1 && ownEntry(kind, l.format)
				);
	const link =
		place.season === null ? showEntry(s.id, (format) => ownEntry(kind, format), db) : seasonEntry;
	if (storageOf(kind).layout !== 'film')
		writeFileSync(
			join(dir, 'tvshow.nfo'),
			tvshowNfo({
				key: place.key,
				title: place.title,
				plot: s.description,
				status: s.status,
				genres,
				source: s.source,
				anilist: link?.anilistId ?? null,
				mal: link?.malId ?? null,
				// A show's TMDB entry, the whole show's, as every season links it.
				tmdb: kindFacts(kind).catalogue.provider === 'tmdb' ? (tmdbFacts(s.id)?.id ?? null) : null,
				kind
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
					`SELECT id, kind, title, hidden, description, status, source, origin_key FROM series WHERE id = ?`
				)
				.get(e.series_id) as SeriesRow | undefined)
		: undefined;
	if (!e || !s || !parseAnimeKey(entryOrigin(entryId, d.db)))
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

	const place = episodePlace(d.db, s, e.season);
	const folder = place.folder;
	const dir = join(d.library, folder);
	const number = e.episode_number ?? e.position;
	// A film is one file named as its folder; everything else, a season's.
	const film = storageOf(kindOfRow(d.db, s)).layout === 'film';
	const rel = film
		? filmFile(posix.basename(folder), e.position)
		: episodePath({
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
	// What's kept of each server's tracks: SETTINGS' DOWNLOADING.
	const keep = {
		kept: keptOf(getSetting('anime_download_audio')),
		subs: getSetting('anime_download_subs') === 'audio' ? ('audio' as const) : ('all' as const)
	};
	// Kept and tagged by language alone, without a track's variant (PT-BR,
	// ES-419): SETTINGS' AUDIO KEPT names languages, and a file's
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
					title: e.title || `Episode ${number}`,
					hlsReader: await hlsReaderArgs(FFMPEG())
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
				film
					? filmNfo(d.db, s, place, {
							sourceUrl: e.source_url,
							position: e.position,
							durationS: facts.seconds ?? length
						})
					: episodeNfo({
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
		await writeSeriesFiles(d.db, s, dir, place);
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
	return parseAnimeKey(followOrigin(seriesId, db).key) !== null;
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
	const s = db.prepare(`SELECT followed_at FROM series WHERE id = ?`).get(seriesId) as
		{ followed_at: number | null } | undefined;
	if (!parseAnimeKey(followOrigin(seriesId, db).key)) return { kind: 'none' };
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

/**
 * Write a downloaded video series' NFOs again, in place, after what they say
 * changed without a download: a TMDB link, an UNLINK or its UNDO (the
 * NFO carries `<uniqueid type="tmdb">`), and the kind switch, which moves a
 * film's file into a show's place or back. Every file's own NFO beside it, in
 * the kind's shape (a `<movie>`, or an episode's), and a show's tvshow.nfo, so
 * the importer reads the folder as the series' kind. Nothing for a series with
 * no folder yet, whose first download writes them, and nothing into a folder
 * that is not on disk.
 */
export async function rewriteVideoNfos(
	seriesId: number,
	library: string,
	db: Database.Database = getDb()
): Promise<number> {
	const s = db
		.prepare(
			`SELECT id, kind, title, hidden, description, status, source, origin_key FROM series WHERE id = ?`
		)
		.get(seriesId) as SeriesRow | undefined;
	if (!s?.kind || !(kindFacts(s.kind) as { storage?: unknown }).storage) return 0;
	const known = db.prepare(`SELECT folder FROM anime_series WHERE series_id = ?`).get(seriesId) as
		{ folder: string } | undefined;
	if (!known) return 0;
	const place = episodePlace(db, s, null);
	const dir = join(library, place.folder);
	if (!existsSync(dir)) return 0;
	const film = storageOf(s.kind).layout === 'film';
	const files = db
		.prepare(
			`SELECT e.source_url, e.position, e.duration_s, e.file, e.title, e.season, e.episode_number,
				e.episode_note, s.path FROM entries e JOIN series s ON s.id = e.series_id
			WHERE e.series_id = ? AND e.available = 1 AND e.file != ''`
		)
		.all(seriesId) as {
		source_url: string;
		position: number;
		duration_s: number | null;
		file: string;
		title: string;
		season: number | null;
		episode_number: number | null;
		episode_note: string;
		path: string;
	}[];
	let n = 0;
	for (const f of files) {
		const mkv = join(f.path, f.file);
		if (!existsSync(mkv)) continue;
		writeFileSync(
			mkv.replace(/\.mkv$/i, '.nfo'),
			film
				? filmNfo(db, s, place, {
						sourceUrl: f.source_url,
						position: f.position,
						durationS: f.duration_s
					})
				: episodeNfo({
						sourceUrl: f.source_url,
						title: f.title,
						season: f.season,
						number: f.episode_number ?? f.position,
						position: f.position,
						durationS: f.duration_s,
						note: (f.episode_note || '') as '' | 'filler' | 'recap'
					})
		);
		n += 1;
	}
	// tvshow.nfo and the poster: a show's both, a film's poster alone.
	await writeSeriesFiles(db, s, dir, place);
	return n + (film ? 0 : 1);
}
