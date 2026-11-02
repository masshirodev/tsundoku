import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { HIDDEN_SQL } from '../visibility.ts';
import { chosenMarks, needsLookup, saveAttempt, saveMark } from './marks.ts';
import { episodeFile, episodeStreams, probe } from './streams.ts';
import { loopback } from './loopback.ts';
import {
	fingerprintFile,
	fingerprintRegions,
	stopFingerprint,
	type Prints
} from './fingerprint.ts';
import { sharedEnding, sharedIntro } from '../../library/fingerprint.ts';
import { parseAnimeKey } from '../../library/downloads.ts';
import type { Range } from '../../library/streams.ts';

/**
 * Finding an opening and an ending in the episodes themselves (doc/ANIME.md,
 * "Openings and endings"; card c239). Two episodes of a season share both, so
 * their fingerprints are compared and the longest run of matching points
 * within sane lengths becomes the mark. A downloaded file is read from disk;
 * a stream (card c239's third part) through the loopback proxy, at its
 * lowest quality.
 *
 * It runs in the background, one season at a time and one episode at a time:
 * a fingerprint is seconds of ffmpeg, and no request waits for it. A finder
 * that found nothing is remembered as such, so the same episode isn't read
 * again for a fortnight.
 */

/** A fingerprint that found nothing is tried again this much later: a file or a stream may have changed. */
export const FINGERPRINT_RETRY_MS = 14 * 24 * 60 * 60 * 1000;
/** Between two episodes: a season's files shouldn't be read all at once. */
const PAUSE_MS = 1000;

type SeasonRow = {
	id: number;
	position: number;
	season: number | null;
	duration_s: number | null;
	available: number;
	file: string;
};

const sameSeason = (a: { season: number | null }, b: { season: number | null }) =>
	(a.season ?? null) === (b.season ?? null);

/** The season an episode belongs to, with what a fingerprint needs of each episode. */
function seasonOf(
	seriesId: number,
	playingEntryId: number,
	db: Database.Database
): { hidden: boolean; episodes: SeasonRow[]; playing: SeasonRow } | null {
	const series = db
		.prepare(
			`SELECT ${HIDDEN_SQL} AS hidden FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.id = ? AND s.kind = 'anime'`
		)
		.get(seriesId) as { hidden: number } | undefined;
	if (!series) return null;
	const rows = db
		.prepare(
			`SELECT e.id, e.position, e.season, e.duration_s, e.available, e.file
			FROM entries e WHERE e.series_id = ? AND e.shadowed = 0 ORDER BY e.position, e.id`
		)
		.all(seriesId) as SeasonRow[];
	const playing = rows.find((r) => r.id === playingEntryId);
	if (!playing) return null;
	return {
		hidden: !!series.hidden,
		episodes: rows.filter((r) => sameSeason(r, playing)),
		playing
	};
}

type Best = { span: Range; seconds: number };

const keepLongest = (best: Map<number, Best>, entryId: number, span: Range, seconds: number) => {
	const had = best.get(entryId);
	if (!had || seconds > had.seconds) best.set(entryId, { span, seconds });
};

/**
 * Which episodes of a season a playing one makes worth fingerprinting from
 * their streams: itself, the next two after it (the ones CONTINUE will reach
 * next), and the one after those, so both next episodes have a pair.
 */
export function streamTargets(episodeIds: number[], playingEntryId: number): number[] {
	const i = episodeIds.indexOf(playingEntryId);
	return i < 0 ? [] : episodeIds.slice(i, i + 4);
}

/** A stream's own quality to fingerprint: the lowest at most 480p, on the first server that has one. */
function lowestQuality(server: {
	qualities: {
		src: string;
		kind: 'hls' | 'file';
		height: number | null;
		audio: { src: string }[];
	}[];
}) {
	return (
		server.qualities
			.filter((q) => q.height !== null && q.height <= 480)
			.sort((a, b) => a.height! - b.height!)[0] ?? null
	);
}

/** A download of the same source is running: don't read its streams at the same time. */
function sameSourceDownloading(seriesId: number, db: Database.Database): boolean {
	const row = db.prepare(`SELECT origin_key FROM series WHERE id = ?`).get(seriesId) as
		{ origin_key: string | null } | undefined;
	const key = parseAnimeKey(row?.origin_key ?? null);
	if (!key) return false;
	return !!db
		.prepare(
			`SELECT 1 FROM download_queue q JOIN series s ON s.id = q.series_id
			WHERE q.state = 'downloading' AND s.origin_key LIKE ?`
		)
		.get(`aniyomi:${key.sourceId}:%`);
}

/**
 * Fingerprints an episode through the streams the player would use: the
 * lowest quality at most 480p, a separate audio rendition where the source
 * offers one, through the loopback proxy, seeking to the minutes it needs.
 * Servers are tried in the source's order; one that fails is left quietly.
 */
async function streamPrints(
	entryId: number,
	durationS: number | null,
	db: Database.Database
): Promise<Prints | null> {
	const streams = await episodeStreams(entryId, true).catch(() => null);
	if (!streams) return null;
	const { port, secret } = await loopback();
	for (const server of streams.servers) {
		const q = lowestQuality(server);
		if (!q) continue;
		let duration = durationS;
		if (!duration) {
			const measured = await probe(q.src).catch(() => null);
			if (!measured?.seconds) continue;
			duration = measured.seconds;
			db.prepare(`UPDATE entries SET duration_s = COALESCE(duration_s, ?) WHERE id = ?`).run(
				Math.round(duration),
				entryId
			);
		}
		// A separate audio rendition is the smallest thing that carries the
		// opening and ending; without one, the video stream's own audio.
		const src = q.audio[0]?.src ?? q.src;
		const prints = await fingerprintRegions(`http://127.0.0.1:${port}${src}`, duration, {
			header: `x-tsundoku: ${secret}`,
			hls: q.audio.length > 0 || q.kind === 'hls'
		}).catch(() => null);
		if (prints && (prints.intro || prints.ending)) return prints;
	}
	return null;
}

/**
 * Fingerprints one season's downloaded episodes and keeps what the pairs
 * agree on. Returns how many episodes were read and how many got a mark.
 * Nothing happens for a hidden series, for an episode whose series has fewer
 * than two readable episodes, or for one already resolved by any finder.
 */
export async function fingerprintSeason(
	seriesId: number,
	playingEntryId: number,
	opts: {
		now?: number;
		db?: Database.Database;
		pauseMs?: number;
		/** Only a player's resolve allows streams: the next episodes after it. */
		allowStreams?: boolean;
	} = {}
): Promise<{ episodes: number; found: number }> {
	const db = opts.db ?? getDb();
	const now = opts.now ?? Date.now();
	const pauseMs = opts.pauseMs ?? PAUSE_MS;
	const season = seasonOf(seriesId, playingEntryId, db);
	if (!season || season.hidden) return { episodes: 0, found: 0 };
	// A download of the same source is busy: its streams are left alone.
	if (sameSourceDownloading(seriesId, db)) return { episodes: 0, found: 0 };
	const streamIds = opts.allowStreams
		? new Set(
				streamTargets(
					season.episodes.map((e) => e.id),
					playingEntryId
				)
			)
		: new Set<number>();

	const prints = new Map<number, Prints>();
	const missing = new Map<number, { intro: boolean; ending: boolean }>();
	for (const episode of season.episodes) {
		if (stopped) break;
		if (!needsLookup(episode.id, 'fingerprint', FINGERPRINT_RETRY_MS, now, db)) continue;
		const chosen = chosenMarks(episode.id, db);
		if (chosen.intro && chosen.ending) continue;
		const file = episodeFile(episode.id);
		let p: Prints | null = null;
		if (file) p = await fingerprintFile(file, episode.duration_s).catch(() => null);
		else if (streamIds.has(episode.id)) {
			// A download may have started since the season was read.
			if (sameSourceDownloading(seriesId, db)) break;
			p = await streamPrints(episode.id, episode.duration_s, db);
		}
		if (!p || (!p.intro && !p.ending)) continue;
		prints.set(episode.id, p);
		missing.set(episode.id, { intro: !chosen.intro, ending: !chosen.ending });
		if (pauseMs) await new Promise((ok) => setTimeout(ok, pauseMs));
	}

	// One episode is no pair: a season with nothing to compare leaves no mark
	// and no memory, so the next episode to arrive can still be its partner.
	if (prints.size < 2) return { episodes: prints.size, found: 0 };

	const intro = new Map<number, Best>();
	const ending = new Map<number, Best>();
	const ids = [...prints.keys()];
	for (let i = 0; i < ids.length; i++)
		for (let j = i + 1; j < ids.length; j++) {
			const a = prints.get(ids[i])!;
			const b = prints.get(ids[j])!;
			if (a.intro && b.intro) {
				const run = sharedIntro(a.intro, b.intro);
				if (run) {
					keepLongest(intro, ids[i], run.a, run.seconds);
					keepLongest(intro, ids[j], run.b, run.seconds);
				}
			}
			if (a.ending && b.ending) {
				const run = sharedEnding(a.ending, b.ending);
				if (run) {
					keepLongest(ending, ids[i], run.a, run.seconds);
					keepLongest(ending, ids[j], run.b, run.seconds);
				}
			}
		}

	let found = 0;
	for (const id of ids) {
		const want = missing.get(id)!;
		const gotIntro = want.intro ? intro.get(id) : undefined;
		const gotEnding = want.ending ? ending.get(id) : undefined;
		if (!gotIntro && !gotEnding) {
			saveAttempt(id, 'fingerprint', db, now);
			continue;
		}
		saveMark(
			id,
			'fingerprint',
			{ intro: gotIntro?.span ?? null, ending: gotEnding?.span ?? null },
			db,
			now
		);
		found += 1;
	}
	return { episodes: prints.size, found };
}

// ---- the background queue ---------------------------------------------------------------------

type Job = { seriesId: number; playingEntryId: number };
const queue = new Map<string, Job>();
let draining: Promise<void> | null = null;
let stopped = false;

/** The series and episode a job is for: the same episode asks once. */
const keyOf = (j: Job) => `${j.seriesId}:${j.playingEntryId}`;

/**
 * Asks for a season's openings and endings, in the background: the player
 * asks, never the functions it calls, so a spec that resolves streams starts
 * nothing. Hidden series are left alone, and incognito never gets here.
 */
export function wantSkipMarks(entryId: number, opts: { db?: Database.Database } = {}): void {
	const db = opts.db ?? getDb();
	const row = db.prepare(`SELECT series_id FROM entries WHERE id = ?`).get(entryId) as
		{ series_id: number } | undefined;
	if (!row) return;
	const season = seasonOf(row.series_id, entryId, db);
	if (!season || season.hidden) return;
	const job = { seriesId: row.series_id, playingEntryId: entryId };
	queue.set(keyOf(job), job);
	if (!draining)
		draining = drain(db).finally(() => {
			draining = null;
		});
}

async function drain(db: Database.Database): Promise<void> {
	while (!stopped && queue.size) {
		const job = queue.values().next().value!;
		queue.delete(keyOf(job));
		await fingerprintSeason(job.seriesId, job.playingEntryId, { db, allowStreams: true }).catch(
			() => undefined
		);
	}
}

/** Resolves when the queue is empty: tests wait on it. */
export const skipMarksIdle = () => draining ?? Promise.resolve();

/**
 * On SIGTERM adapter-node waits for the process; a fingerprint in flight is
 * seconds of ffmpeg, and a stopping server shouldn't sit out the timeout.
 * The children are killed and no new job starts.
 */
function stopAll() {
	stopped = true;
	queue.clear();
	stopFingerprint();
}
process.once('SIGTERM', stopAll);
process.once('SIGINT', stopAll);
