import { getDb } from './db.ts';
import { parseAnimeKey, parseKey, parseNovelKey } from '../library/downloads.ts';
import { addNewChapters } from './engine/backend.ts';
import { checkAnime } from './anime/follow.ts';
import { checkNovel } from './novels/follow.ts';

/**
 * REFRESH (card c220): ask a series' source, once, what it lists now, and make
 * entries of anything new. It downloads nothing, whatever FOLLOW is doing —
 * FOLLOW stays the only thing that queues, on its own turn (doc/DOWNLOADING.md,
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
	const key =
		(
			db.prepare(`SELECT origin_key FROM series WHERE id = ?`).get(seriesId) as
				{ origin_key: string | null } | undefined
		)?.origin_key ?? null;
	if (parseAnimeKey(key))
		return { kind: 'anime', added: (await checkAnime(seriesId, now, db, { queue: false })).added };
	if (parseNovelKey(key))
		return { kind: 'novel', added: (await checkNovel(seriesId, now, db, { queue: false })).added };
	if (parseKey(key))
		return { kind: 'manga', added: (await addNewChapters(seriesId, now, db))?.arrived.length ?? 0 };
	return null;
}
