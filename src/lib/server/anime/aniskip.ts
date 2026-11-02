import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { lookupRow, needsLookup, saveAttempt, saveMark } from './marks.ts';
import type { Range } from '../../library/streams.ts';

/**
 * AniSkip (doc/ANIME.md, "Openings and endings"; card c239): the community's
 * opening and ending times, keyed by MyAnimeList id and episode number. It is
 * asked only for a series linked to a MAL entry, never for a hidden one, and
 * only once: a 404 is an answer too, and is remembered for
 * `ANISKIP_RETRY_MS` (a new episode of a running show may be added later).
 *
 * The request carries the MAL id and the episode number and nothing else:
 * no title, no account, no reading.
 */

/** A 404 is asked again this much later: AniSkip's data for a new episode arrives late. */
export const ANISKIP_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
/** Longer than AniSkip usually takes; a slow answer isn't worth a blocked player. */
const TIMEOUT_MS = 4000;

const base = () => (process.env.ANISKIP_URL ?? 'https://api.aniskip.com/v2').replace(/\/+$/, '');

type AniSkipResult = {
	interval: { startTime: number; endTime: number };
	skipType: string;
	episodeLength?: number;
};

type AniSkipAnswer = {
	found?: boolean;
	results?: AniSkipResult[];
	statusCode?: number;
	message?: string;
};

const span = (r: AniSkipResult | undefined): Range | null => {
	if (!r) return null;
	const start = Number(r.interval?.startTime);
	const end = Number(r.interval?.endTime);
	return Number.isFinite(start) && Number.isFinite(end) && end > start && start >= 0
		? { start, end }
		: null;
};

/** AniSkip's answer as the two marks; null when it found neither. */
export function readAniSkip(answer: AniSkipAnswer): { intro: Range | null; ending: Range | null } {
	const results = Array.isArray(answer.results) ? answer.results : [];
	const first = (kind: 'op' | 'ed') =>
		span(results.find((r) => (r.skipType ?? '').toLowerCase().endsWith(kind)));
	return { intro: first('op'), ending: first('ed') };
}

/** The one address AniSkip is asked at. Exported so a spec can assert what leaves the app. */
export function aniSkipUrl(malId: number, episode: number, lengthS: number): string {
	const q = new URLSearchParams({ episodeLength: String(Math.round(lengthS)) });
	q.append('types[]', 'op');
	q.append('types[]', 'ed');
	return `${base()}/skip-times/${malId}/${episode}?${q}`;
}

/**
 * Asks AniSkip for one episode, if there is anything to ask. Returns whether
 * it answered with a mark. A hidden series, a series with no MAL link, a
 * season beyond the first (links are per series until c240) and an episode
 * whose length or number isn't known are all quietly left alone.
 *
 * `durationS` is the length the caller has just measured or probed, when the
 * episode hasn't stored one yet: AniSkip needs it to place an ending.
 */
export async function lookupAniSkip(
	entryId: number,
	opts: { now?: number; durationS?: number | null; db?: Database.Database } = {}
): Promise<boolean> {
	const db = opts.db ?? getDb();
	const now = opts.now ?? Date.now();
	const row = lookupRow(entryId, db);
	if (!row) return false;
	// Hidden means hidden: never looked up, even while reveal is on (doc/LINKS.md).
	if (row.hidden) return false;
	if (row.mal_id === null || row.mal_id <= 0) return false;
	// A link is the series', and a MAL entry is one season. Until c240 links a
	// season, only the first (or a flat list) can be the entry it names.
	if (row.season !== null && row.season > 1) return false;
	const episode = row.episode_number ?? (row.season === null ? row.position : null);
	if (episode === null || !Number.isFinite(episode) || episode <= 0) return false;
	const lengthS = opts.durationS ?? row.duration_s;
	if (lengthS === null || !Number.isFinite(lengthS) || lengthS <= 0) return false;
	if (!needsLookup(entryId, 'aniskip', ANISKIP_RETRY_MS, now, db)) return false;

	let res: Response;
	try {
		res = await fetch(aniSkipUrl(row.mal_id, episode, lengthS), {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch {
		// No answer is not a "not found": the next resolve asks again.
		return false;
	}
	// 404 is AniSkip's "this episode has none", which is worth remembering.
	if (res.status === 404) {
		saveAttempt(entryId, 'aniskip', db, now);
		return false;
	}
	if (!res.ok) return false;
	const answer = (await res.json().catch(() => null)) as AniSkipAnswer | null;
	if (!answer) return false;
	const marks = readAniSkip(answer);
	if (!marks.intro && !marks.ending) {
		saveAttempt(entryId, 'aniskip', db, now);
		return false;
	}
	saveMark(entryId, 'aniskip', marks, db, now);
	return true;
}
