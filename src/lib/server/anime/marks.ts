import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { HIDDEN_SQL } from '../visibility.ts';
import {
	chooseMarks,
	saneRange,
	type ChosenMarks,
	type MarkMethod,
	type MarkRow
} from '../../library/marks.ts';
import type { Range } from '../../library/streams.ts';

/**
 * An episode's opening and ending, kept (doc/ANIME.md, "Openings and
 * endings"; card c239). One row per episode and finder, whether it found
 * anything or not: an answer is not asked for again, and a finder that found
 * nothing is remembered too (AniSkip is asked again after some days).
 *
 * `entries.ending_at` stays the one place the rest of the app reads where an
 * episode counts as watched, so every mark that becomes the best one writes
 * it there. The source's own timestamps are written as a `source` row as
 * soon as the streams are resolved; AniSkip and fingerprints fill what is
 * still empty.
 */

export const MARK_METHODS: readonly MarkMethod[] = ['source', 'aniskip', 'fingerprint'];

type MarkDbRow = {
	method: MarkMethod;
	intro_start: number | null;
	intro_end: number | null;
	ending_start: number | null;
	ending_end: number | null;
	tried_at: number;
};

const span = (start: number | null, end: number | null): Range | null =>
	start !== null && end !== null && end > start ? { start, end } : null;

/** Every finder's answer for an episode, as rows the pure rules read. */
export function storedMarks(entryId: number, db: Database.Database = getDb()): MarkRow[] {
	const rows = db
		.prepare(
			`SELECT method, intro_start, intro_end, ending_start, ending_end, tried_at
			FROM episode_marks WHERE entry_id = ?`
		)
		.all(entryId) as MarkDbRow[];
	return rows.map((r) => ({
		method: r.method,
		intro: span(r.intro_start, r.intro_end),
		ending: span(r.ending_start, r.ending_end)
	}));
}

/** What the player uses: the best finder's opening and ending. */
export function chosenMarks(entryId: number, db: Database.Database = getDb()): ChosenMarks {
	const duration = db.prepare(`SELECT duration_s FROM entries WHERE id = ?`).get(entryId) as
		{ duration_s: number | null } | undefined;
	return chooseMarks(storedMarks(entryId, db), duration?.duration_s ?? null);
}

/** Whether a finder still has to be asked: never asked, or asked and found nothing and the retry is due. */
export function needsLookup(
	entryId: number,
	method: MarkMethod,
	retryMs: number,
	now = Date.now(),
	db: Database.Database = getDb()
): boolean {
	const row = db
		.prepare(
			`SELECT intro_start, ending_start, tried_at FROM episode_marks WHERE entry_id = ? AND method = ?`
		)
		.get(entryId, method) as
		{ intro_start: number | null; ending_start: number | null; tried_at: number } | undefined;
	if (!row) return true;
	if (row.intro_start !== null || row.ending_start !== null) return false;
	return now - row.tried_at >= retryMs;
}

/** When a finder was last asked, or null: the specs' window into the remembering. */
export function markTriedAt(
	entryId: number,
	method: MarkMethod,
	db: Database.Database = getDb()
): number | null {
	const row = db
		.prepare(`SELECT tried_at FROM episode_marks WHERE entry_id = ? AND method = ?`)
		.get(entryId, method) as { tried_at: number } | undefined;
	return row?.tried_at ?? null;
}

/**
 * Keeps what a finder found. A part it didn't find this time keeps the part
 * it found before, so a second attempt can fill the other one without losing
 * the first. `entries.ending_at` follows the best ending.
 */
export function saveMark(
	entryId: number,
	method: MarkMethod,
	marks: { intro: Range | null; ending: Range | null },
	db: Database.Database = getDb(),
	now = Date.now()
): void {
	const intro = saneRange(marks.intro, null) ? marks.intro : null;
	const ending = saneRange(marks.ending, null) ? marks.ending : null;
	db.prepare(
		`INSERT INTO episode_marks (entry_id, method, intro_start, intro_end, ending_start, ending_end, tried_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (entry_id, method) DO UPDATE SET
			intro_start = COALESCE(excluded.intro_start, episode_marks.intro_start),
			intro_end = COALESCE(excluded.intro_end, episode_marks.intro_end),
			ending_start = COALESCE(excluded.ending_start, episode_marks.ending_start),
			ending_end = COALESCE(excluded.ending_end, episode_marks.ending_end),
			tried_at = excluded.tried_at`
	).run(
		entryId,
		method,
		intro?.start ?? null,
		intro?.end ?? null,
		ending?.start ?? null,
		ending?.end ?? null,
		now
	);
	syncEndingAt(entryId, db);
}

/** Remembers that a finder was asked and found nothing; a found row is never overwritten by this. */
export function saveAttempt(
	entryId: number,
	method: MarkMethod,
	db: Database.Database = getDb(),
	now = Date.now()
): void {
	db.prepare(
		`INSERT INTO episode_marks (entry_id, method, tried_at) VALUES (?, ?, ?)
		ON CONFLICT (entry_id, method) DO UPDATE SET tried_at = excluded.tried_at
		WHERE episode_marks.intro_start IS NULL AND episode_marks.ending_start IS NULL`
	).run(entryId, method, now);
}

/**
 * Forgets every AniSkip answer a series' episodes have, found or not. A link
 * set, changed or removed asks a different MAL entry, and a negative kept
 * from the old one would keep AniSkip from being asked for a week (card
 * c299). Called inside every door that writes a link (catalogue.ts).
 */
export function clearAniSkip(seriesId: number, db: Database.Database = getDb()): void {
	db.prepare(
		`DELETE FROM episode_marks WHERE method = 'aniskip'
		AND entry_id IN (SELECT id FROM entries WHERE series_id = ?)`
	).run(seriesId);
}

/** `entries.ending_at` is where an episode counts as watched: the best ending, or none. */
export function syncEndingAt(entryId: number, db: Database.Database = getDb()): void {
	const rows = storedMarks(entryId, db);
	if (!rows.length) return;
	const chosen = chosenMarks(entryId, db);
	db.prepare(`UPDATE entries SET ending_at = ? WHERE id = ?`).run(
		chosen.ending?.start ?? null,
		entryId
	);
}

/** The source's timestamps, kept as they are found, so a later finder can't displace them. */
export function saveSourceMarks(
	entryId: number,
	marks: { intro: Range | null; ending: Range | null },
	db: Database.Database = getDb(),
	now = Date.now()
): void {
	if (!marks.intro && !marks.ending) return;
	saveMark(entryId, 'source', marks, db, now);
}

export type EpisodeForLookup = {
	entry_id: number;
	series_id: number;
	episode_number: number | null;
	position: number;
	season: number | null;
	duration_s: number | null;
	hidden: number;
	mal_id: number | null;
};

/**
 * An episode and the facts a lookup needs: its number, its length, whether
 * its series is hidden, and the MAL entry its series is linked to. Null for
 * anything that isn't an anime episode. The join is the one rule: a hidden
 * series is never looked up, whatever reveal is doing.
 */
export function lookupRow(
	entryId: number,
	db: Database.Database = getDb()
): EpisodeForLookup | null {
	return (
		(db
			.prepare(
				`SELECT e.id AS entry_id, e.series_id, e.episode_number, e.position, e.season,
					e.duration_s, ${HIDDEN_SQL} AS hidden, l.mal_id
				FROM entries e JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
				LEFT JOIN series_links l ON l.series_id = s.id
				WHERE e.id = ? AND s.kind = 'anime'`
			)
			.get(entryId) as EpisodeForLookup | undefined) ?? null
	);
}
