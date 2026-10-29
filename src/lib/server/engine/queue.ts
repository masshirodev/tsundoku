import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { getSetting, setSetting } from '../settings.ts';
import { keyKind, sourceOfKey } from '../../library/downloads.ts';

/**
 * tsundoku's download queue (doc/DOWNLOADER.md; card c137): chapters, as
 * entries, waiting for the worker. Keyed by tsundoku's own rows; what a
 * source calls them is the worker's business (engine_series,
 * engine_chapters). A novel's chapters wait in the same queue (doc/NOVELS.md,
 * "Downloading"; card c150), so PAUSE, the queue screen, RETRY and ↑ TO THE
 * TOP are one; the novel worker takes those, the engine's the rest.
 */

/**
 * Which worker a queued chapter is for: a novel plugin's, the engine's for a
 * manga, or the engine's episode lane for an anime (doc/ANIME.md), by its
 * series' key.
 */
export type QueueKind = 'novel' | 'manga' | 'anime';
const ofKind = (r: QueueRow, kind: QueueKind | undefined) => kind === undefined || r.kind === kind;

/** After this many tries a chapter is FAILED and waits for RETRY. */
export const MAX_TRIES = 3;

export type QueueRow = {
	entryId: number;
	seriesId: number;
	sourceId: string;
	kind: QueueKind;
	state: 'queued' | 'downloading' | 'failed';
	tries: number;
	failure: string;
	error: string;
	nextAt: number;
	donePages: number;
	pages: number;
	position: number;
};

/**
 * Queues [entryIds] after everything already queued, in the order given.
 * Only what can be downloaded: a chapter of a series from a source (a Mihon
 * one or a novel plugin's), with no file, not queued already. Returns how
 * many were queued.
 */
export function enqueue(
	entryIds: number[],
	now = Date.now(),
	db: Database.Database = getDb()
): number {
	const row = db.prepare(
		`SELECT e.id, e.series_id, s.origin_key FROM entries e JOIN series s ON s.id = e.series_id
		WHERE e.id = ? AND e.available = 0 AND e.source_url != ''
			AND NOT EXISTS (SELECT 1 FROM download_queue q WHERE q.entry_id = e.id)`
	);
	const put = db.prepare(
		`INSERT INTO download_queue (entry_id, series_id, position, queued_at) VALUES (?, ?, ?, ?)`
	);
	return db.transaction(() => {
		let at = (
			db.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM download_queue`).get() as {
				p: number;
			}
		).p;
		let n = 0;
		for (const id of entryIds) {
			const r = row.get(id) as
				{ id: number; series_id: number; origin_key: string | null } | undefined;
			if (!r || !sourceOfKey(r.origin_key)) continue;
			put.run(r.id, r.series_id, ++at, now);
			n++;
		}
		return n;
	})();
}

/** Takes [entryIds] out of the queue: ✕ and CANCEL. They stay NOT DOWNLOADED. */
export function dequeue(entryIds: number[], db: Database.Database = getDb()): void {
	const del = db.prepare(
		`DELETE FROM download_queue WHERE entry_id = ? AND state != 'downloading'`
	);
	db.transaction(() => entryIds.forEach((id) => del.run(id)))();
}

/** RETRY: a failed chapter back in the queue where it was, its tries counted afresh. */
export function retry(entryIds: number[], db: Database.Database = getDb()): void {
	const set = db.prepare(
		`UPDATE download_queue SET state = 'queued', tries = 0, failure = '', error = '', next_at = 0 WHERE entry_id = ? AND state = 'failed'`
	);
	db.transaction(() => entryIds.forEach((id) => set.run(id)))();
}

/** ↑ TO THE TOP: a series' queued chapters before everything else, in their own order. */
export function toTheTop(seriesId: number, db: Database.Database = getDb()): void {
	db.transaction(() => {
		const first = (
			db.prepare(`SELECT COALESCE(MIN(position), 0) AS p FROM download_queue`).get() as {
				p: number;
			}
		).p;
		const rows = db
			.prepare(`SELECT entry_id FROM download_queue WHERE series_id = ? ORDER BY position`)
			.all(seriesId) as { entry_id: number }[];
		const set = db.prepare(`UPDATE download_queue SET position = ? WHERE entry_id = ?`);
		rows.forEach((r, i) => set.run(first - rows.length + i, r.entry_id));
	})();
}

export function queueRows(db: Database.Database = getDb()): QueueRow[] {
	return (
		db
			.prepare(
				`SELECT q.entry_id, q.series_id, s.origin_key, q.state, q.tries, q.failure, q.error, q.next_at,
					q.done_pages, q.pages, q.position
				FROM download_queue q JOIN series s ON s.id = q.series_id ORDER BY q.position`
			)
			.all() as {
			entry_id: number;
			series_id: number;
			origin_key: string;
			state: QueueRow['state'];
			tries: number;
			failure: string;
			error: string;
			next_at: number;
			done_pages: number;
			pages: number;
			position: number;
		}[]
	).map((r) => ({
		entryId: r.entry_id,
		seriesId: r.series_id,
		sourceId: sourceOfKey(r.origin_key) ?? '',
		kind: keyKind(r.origin_key) ?? 'manga',
		state: r.state,
		tries: r.tries,
		failure: r.failure,
		error: r.error,
		nextAt: r.next_at,
		donePages: r.done_pages,
		pages: r.pages,
		position: r.position
	}));
}

/**
 * The chapters to start now: the first ready one of each source not already
 * downloading, up to [lanes] sources at once. One chapter per source at a
 * time, since the engine serialises calls into an extension anyway, and the
 * sites are kinder to a reader than to a crawler. [kind] keeps to one
 * worker's chapters.
 */
export function nextUp(
	lanes: number,
	now = Date.now(),
	db: Database.Database = getDb(),
	kind?: QueueKind
): QueueRow[] {
	const rows = queueRows(db).filter((r) => ofKind(r, kind));
	const busy = new Set(rows.filter((r) => r.state === 'downloading').map((r) => r.sourceId));
	const picked: QueueRow[] = [];
	for (const r of rows) {
		if (busy.size + picked.length >= lanes) break;
		if (r.state !== 'queued' || r.nextAt > now || busy.has(r.sourceId)) continue;
		if (picked.some((p) => p.sourceId === r.sourceId)) continue;
		picked.push(r);
	}
	return picked;
}

/**
 * How long to wait before trying a chapter again: longer each time, and
 * longer for a site that asked to slow down. Capped, so a chapter that
 * failed overnight isn't still waiting at noon.
 */
export function backoffMs(tries: number, failure: string): number {
	const base = failure === 'rate-limited' ? 60_000 : 15_000;
	return Math.min(base * 2 ** Math.max(0, tries - 1), 30 * 60_000);
}

/** A try failed: back in the queue after its backoff, or FAILED once it has had its tries. */
export function failed(
	entryId: number,
	failure: string,
	error: string,
	now = Date.now(),
	db: Database.Database = getDb()
): void {
	const r = db.prepare(`SELECT tries FROM download_queue WHERE entry_id = ?`).get(entryId) as
		{ tries: number } | undefined;
	if (!r) return;
	const tries = r.tries + 1;
	// A chapter the source doesn't list won't appear by retrying.
	const final = tries >= MAX_TRIES || failure === 'not-at-source';
	db.prepare(
		`UPDATE download_queue SET state = ?, tries = ?, failure = ?, error = ?, next_at = ?, done_pages = 0 WHERE entry_id = ?`
	).run(
		final ? 'failed' : 'queued',
		tries,
		failure,
		error.slice(0, 500),
		final ? 0 : now + backoffMs(tries, failure),
		entryId
	);
}

/**
 * PAUSE and RESUME, the setting Suwayomi's backend used before c129
 * (`downloads_paused_at`), so the screens read one place whichever backend
 * runs.
 */
export const isPaused = () => getSetting('downloads_paused_at') !== '';
export const setPaused = (paused: boolean, now = Date.now()) =>
	setSetting('downloads_paused_at', paused ? String(now) : '');

/**
 * Anything left `downloading` by a process that stopped mid-chapter goes back
 * to the queue; with [kind], only that worker's.
 */
export function recover(db: Database.Database = getDb(), kind?: QueueKind): number {
	const stuck = queueRows(db).filter((r) => r.state === 'downloading' && ofKind(r, kind));
	const put = db.prepare(
		`UPDATE download_queue SET state = 'queued', done_pages = 0 WHERE entry_id = ? AND state = 'downloading'`
	);
	return db.transaction(() => stuck.reduce((n, r) => n + put.run(r.entryId).changes, 0))();
}
