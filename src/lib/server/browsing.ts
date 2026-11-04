import type Database from 'better-sqlite3';
import { getDb } from './db.ts';
import { forgetSourceUse } from './library-sources.ts';
import { hideIfAddedHidden } from './engine/source-flags.ts';
import { KEEP_DAYS } from '../library/keep.ts';

/**
 * Browsing records, past their first open (doc/BROWSING.md; cards c161, c165):
 * what one still holds, forgetting it, and pruning the ones nobody came back
 * to. A record is a series with `in_library = 0`; opening it again, ADD, and
 * the library's own reads live where they always did.
 */

export { KEEP_DAYS };
export const KEEP_MS = KEEP_DAYS * 24 * 60 * 60 * 1000;

/**
 * FORGET: the record's place and marks go, and so does the record as the
 * preview shows it. The row stays, `pruned_at` set, because HISTORY keeps the
 * reading that happened (dimmed, NOT KEPT). Never a library series.
 */
export function forgetRecord(seriesId: number, now = Date.now(), db = getDb()): boolean {
	return db.transaction(() => {
		const r = db
			.prepare(`UPDATE series SET pruned_at = ? WHERE id = ? AND in_library = 0`)
			.run(now, seriesId);
		if (r.changes === 0) return false;
		db.prepare(
			`UPDATE entries SET read_at = NULL, last_position = NULL, last_opened_at = NULL WHERE series_id = ?`
		).run(seriesId);
		return true;
	})();
}

/** Forgets every record not opened for KEEP_DAYS. Returns how many. */
export function pruneRecords(now = Date.now(), db: Database.Database = getDb()): number {
	const old = db
		.prepare(`SELECT id FROM series WHERE in_library = 0 AND pruned_at IS NULL AND browsed_at < ?`)
		.all(now - KEEP_MS) as { id: number }[];
	for (const o of old) forgetRecord(o.id, now, db);
	return old.length;
}

/** Opened again: kept another KEEP_DAYS, and no longer forgotten. */
export function touchRecord(seriesId: number, now = Date.now(), db = getDb()): void {
	db.prepare(
		`UPDATE series SET browsed_at = ?, pruned_at = NULL WHERE id = ? AND in_library = 0`
	).run(now, seriesId);
}

/** One episode or chapter of a record as its preview row draws it. */
export type RecordEntry = {
	read: boolean;
	/** Where it stopped: seconds into an episode, the 0-based page of a chapter. */
	position: number | null;
	durationS: number | null;
	pageCount: number;
};

export type RecordView = {
	seriesId: number;
	/** `source_url` → its state. */
	entries: Record<string, RecordEntry & { id: number }>;
	read: number;
	total: number;
	lastOpenedAt: number;
	keptUntil: number;
	/** What ▶ CONTINUE opens: the entry last opened and not finished, else the first unread. */
	next: {
		id: number;
		sourceUrl: string;
		label: string;
		position: number | null;
		durationS: number | null;
	} | null;
};

/** A key's record as the preview draws it; null when there's none, or it was forgotten. */
export function recordView(originKey: string, db = getDb()): RecordView | null {
	const s = db
		.prepare(
			`SELECT id, browsed_at FROM series WHERE origin_key = ? AND in_library = 0 AND pruned_at IS NULL`
		)
		.get(originKey) as { id: number; browsed_at: number | null } | undefined;
	if (!s) return null;
	const rows = db
		.prepare(
			`SELECT id, source_url, label, read_at, last_position, last_opened_at, duration_s, page_count
			FROM entries WHERE series_id = ? AND shadowed = 0 ORDER BY position`
		)
		.all(s.id) as {
		id: number;
		source_url: string;
		label: string;
		read_at: number | null;
		last_position: number | null;
		last_opened_at: number | null;
		duration_s: number | null;
		page_count: number;
	}[];
	const entries: RecordView['entries'] = {};
	for (const r of rows)
		entries[r.source_url] = {
			id: r.id,
			read: r.read_at !== null,
			position: r.read_at === null ? r.last_position : null,
			durationS: r.duration_s,
			pageCount: r.page_count
		};
	const opened = rows
		.filter((r) => r.read_at === null && r.last_opened_at !== null)
		.sort((a, b) => b.last_opened_at! - a.last_opened_at!)[0];
	const pick = opened ?? rows.find((r) => r.read_at === null) ?? null;
	const lastOpenedAt = s.browsed_at ?? 0;
	return {
		seriesId: s.id,
		entries,
		read: rows.filter((r) => r.read_at !== null).length,
		total: rows.length,
		lastOpenedAt,
		keptUntil: lastOpenedAt + KEEP_MS,
		next: pick
			? {
					id: pick.id,
					sourceUrl: pick.source_url,
					label: pick.label,
					position: pick === opened ? pick.last_position : null,
					durationS: pick.duration_s
				}
			: null
	};
}

/**
 * ADD, or another open, of a series that's already here (doc/BROWSING.md):
 * a record opened again is kept another KEEP_DAYS; ADD makes a record the
 * library's, the same series with its place, its added and arrived times
 * now. A library series is left as it is. Returns its id.
 */
export function keepOrPromote(
	s: { id: number; in_library: number },
	browsing: boolean,
	now = Date.now(),
	db = getDb()
): number {
	if (s.in_library === 0) {
		if (browsing) touchRecord(s.id, now, db);
		else {
			db.prepare(
				`UPDATE series SET in_library = 1, browsed_at = NULL, pruned_at = NULL, added_at = ?, arrived_at = ? WHERE id = ?`
			).run(now, now, s.id);
			// ADD from a source that adds hidden (card c435): it starts hidden.
			hideIfAddedHidden(s.id, db);
			forgetSourceUse();
		}
	}
	return s.id;
}
