import { getDb } from './db.ts';
import { parseAnimeKey, parseKey, parseNovelKey } from '../library/downloads.ts';
import { libraryWhere } from './visibility.ts';
import { addNewChapters } from './engine/backend.ts';
import { checkAnime } from './anime/follow.ts';
import { checkNovel } from './novels/follow.ts';
import { bookOrigins, followOrigin } from './season-facts.ts';
import { resolveBook } from './engine/worker.ts';
import { extensionFor } from './engine/extensions.ts';
import type { RefreshBatch } from '../library/types.ts';

/**
 * REFRESH: ask a series' source, once, what it lists now, and make
 * entries of anything new. It downloads nothing, whatever FOLLOW is doing —
 * FOLLOW stays the only thing that queues, on its own turn (doc/DOWNLOADS.md,
 * "FOLLOW"). The three kinds answer the same question through their own checks,
 * which record when they were asked, so FOLLOW's next turn doesn't repeat it.
 *
 * Null when the series isn't from a source: a folder-scanned one (Hentoid, a
 * Mihon import found on disk, an EPUB) has nothing to ask, and its new chapters
 * arrive by a scan.
 */
export type Refreshed = { kind: 'manga' | 'anime' | 'novel'; added: number };

export async function refreshSeries(seriesId: number, now = Date.now()): Promise<Refreshed | null> {
	const db = getDb();
	// A group of one-offs (doc/BOOKS.md): every book's own source is
	// asked where its chapter stands. Nothing new becomes an entry, since a book
	// is one entry the reader chose, and a chapter that appeared at its source
	// would be a book nobody grouped. One source failing is not the group's.
	const own = (
		db.prepare(`SELECT origin_key FROM series WHERE id = ?`).get(seriesId) as
			{ origin_key: string | null } | undefined
	)?.origin_key;
	if (!parseKey(own ?? null)) {
		const books = bookOrigins(seriesId, db).filter((b) => {
			const key = parseKey(b.key);
			return key && extensionFor(key.sourceId, db);
		});
		if (books.length > 0) {
			const asked = await Promise.allSettled(
				books.map((b) => resolveBook(b.entryId, { db, now: () => now }, true))
			);
			const failed = asked.find((a) => a.status === 'rejected');
			if (failed && asked.every((a) => a.status === 'rejected'))
				throw (failed as PromiseRejectedResult).reason;
			return { kind: 'manga', added: 0 };
		}
	}
	// The key FOLLOW asks: a series' source, or its last season's when
	// the seasons have their own. Which family answers is that key's.
	const key = followOrigin(seriesId, db).key;
	if (parseAnimeKey(key))
		return { kind: 'anime', added: (await checkAnime(seriesId, now, db, { queue: false })).added };
	if (parseNovelKey(key))
		return { kind: 'novel', added: (await checkNovel(seriesId, now, db, { queue: false })).added };
	if (parseKey(key))
		return { kind: 'manga', added: (await addNewChapters(seriesId, now, db))?.arrived.length ?? 0 };
	return null;
}

/**
 * How many series one REFRESH run of a selection asks. Each source
 * answers in its own time, so a selection of sixty would hold one request open
 * for minutes; a run asks this many and the band offers the rest, one run at a
 * time, which is also what keeps a source that never answers from holding the
 * whole selection.
 */
export const REFRESH_BATCH = 24;

/**
 * A source that has not answered in this long is that run's failure, not the
 * next series' wait. Under the engine's own minute, so a slow but working
 * source usually still lands; the call it abandons may write what it found
 * after the band has already said it failed, which is the same entries a
 * second REFRESH would add.
 */
export const REFRESH_TIMEOUT_MS = 30_000;

/** How many sources a run has in the air at once (the engine serialises per source anyway). */
const REFRESH_PARALLEL = 4;

/** Whether a series' origin can be asked at all: the same test refreshSeries makes. */
const hasSource = (key: string | null) =>
	!!(parseAnimeKey(key) || parseNovelKey(key) || parseKey(key));

/** REFRESH's ask, given a deadline: a source that never answers must not stop the rest. */
function within<T>(ask: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('the source did not answer')), ms);
		ask.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

/**
 * REFRESH over a selection, the library's bulk bar. Each selected
 * series that has a source is asked through the same `refreshSeries`, in the
 * order the selection was made, and nothing is downloaded. A source that
 * throws or misses its deadline is one failure among the rest, never the end
 * of the run; a series with no source is skipped and counted as skipped.
 *
 * Hidden series are left out in SQL, as everywhere (doc/LIBRARY.md, "Hidden
 * means hidden"): an id that reveal does not show is never asked, whatever a
 * form sent.
 */
export async function refreshMany(
	seriesIds: number[],
	opts: { reveal: boolean; now?: number; timeoutMs?: number }
): Promise<RefreshBatch> {
	const { reveal, now = Date.now(), timeoutMs = REFRESH_TIMEOUT_MS } = opts;
	const ids = [...new Set(seriesIds)];
	const out: RefreshBatch = { asked: 0, found: 0, skipped: 0, failed: [], remaining: [] };
	if (ids.length === 0) return out;

	const db = getDb();
	const rows = db
		.prepare(
			`SELECT s.id, s.title, s.origin_key FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.id IN (${ids.map(() => '?').join(',')}) AND ${libraryWhere(reveal)}`
		)
		.all(...ids) as { id: number; title: string; origin_key: string | null }[];
	const byId = new Map(rows.map((r) => [r.id, r]));
	// The selection's own order, so a run past the bound asks where the reader
	// began and the band's "the rest" runs on from there.
	const selected: typeof rows = [];
	for (const id of ids) {
		const row = byId.get(id);
		if (row) selected.push(row);
	}
	const sourced = selected.filter((r) => hasSource(followOrigin(r.id, db).key));
	out.skipped = selected.length - sourced.length;

	const run = sourced.slice(0, REFRESH_BATCH);
	out.asked = run.length;
	out.remaining = sourced.slice(REFRESH_BATCH).map((r) => r.id);

	let next = 0;
	const worker = async () => {
		while (next < run.length) {
			const row = run[next++];
			try {
				const r = await within(refreshSeries(row.id, now), timeoutMs);
				if (r && r.added > 0) out.found += 1;
			} catch {
				out.failed.push(row.title);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(REFRESH_PARALLEL, run.length) }, worker));
	// Which one finished last is the network's business, not the band's.
	out.failed.sort();
	return out;
}
