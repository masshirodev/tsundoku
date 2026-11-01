import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { writeSeries } from '../import/write.ts';
import { enqueue, queueRows } from '../engine/queue.ts';
import { EngineError } from '../engine/client.ts';
import { extensionFor } from '../engine/extensions.ts';
import { sourceMangaId } from '../engine/backend.ts';
import { fetchAnime, planOf } from '../engine/anime-source.ts';
import { followQueue, parseAnimeKey } from '../../library/downloads.ts';

/**
 * FOLLOW for an anime (doc/ANIME.md, "FOLLOW"; card c158), as for a manga
 * and a novel: its source asked at once when turned on, then every six
 * hours by FOLLOW's step; an episode it lists that no entry is becomes one
 * with ADD's own plan through the one writer, queued unless watched, fifty
 * a series a run at most, oldest first.
 */

const FOLLOW_EVERY = 6 * 60 * 60 * 1000;
const checking = new Set<number>();

function animeOf(db: Database.Database, seriesId: number) {
	const s = db
		.prepare(`SELECT id, root_id, origin_key, followed_at FROM series WHERE id = ?`)
		.get(seriesId) as
		| { id: number; root_id: number; origin_key: string | null; followed_at: number | null }
		| undefined;
	const key = parseAnimeKey(s?.origin_key ?? null);
	return s && key ? { ...s, key } : null;
}

/** FOLLOW and FOLLOWING ✓ on an anime: followed from now on, and its source asked at once. */
export function setAnimeFollowed(
	seriesId: number,
	on: boolean,
	now = Date.now(),
	db: Database.Database = getDb()
): void {
	const s = animeOf(db, seriesId);
	if (!s || !extensionFor(s.key.sourceId, db))
		throw new EngineError('only an anime from an installed source can be followed', 'not-found');
	db.prepare(`UPDATE series SET followed_at = ? WHERE id = ?`).run(on ? now : null, seriesId);
	if (!on || checking.has(seriesId)) return;
	checking.add(seriesId);
	void checkAnime(seriesId, Date.now(), db)
		.catch(() => {})
		.finally(() => checking.delete(seriesId));
}

export const animeCheckedAt = (seriesId: number, db: Database.Database = getDb()) =>
	(
		db.prepare(`SELECT checked_at FROM anime_checks WHERE series_id = ?`).get(seriesId) as
			{ checked_at: number } | undefined
	)?.checked_at ?? null;

/**
 * Asks an anime's source for its episodes, makes entries of the new ones,
 * moves what the source renumbered, and queues what FOLLOW should. Returns
 * how many arrived, and how many were queued. Throws when the source can't
 * answer (the check isn't recorded, so the next step asks again).
 *
 * FOLLOW is not a condition: REFRESH (card c220) asks a series the owner
 * doesn't follow, and it downloads nothing (`queue: false`), so the two
 * can't disagree about what arriving means.
 */
export async function checkAnime(
	seriesId: number,
	now = Date.now(),
	db: Database.Database = getDb(),
	opts: { queue?: boolean } = {}
): Promise<{ added: number; queued: number }> {
	const s = animeOf(db, seriesId);
	if (!s) return { added: 0, queued: 0 };
	const got = await fetchAnime(sourceMangaId(s.key.sourceId, s.key.url));
	if (!got) throw new EngineError('The source no longer lists this anime', 'not-found');
	const plan = planOf(got, now);
	plan.originKey = s.origin_key!;
	const had = new Map(
		(
			db
				.prepare(
					`SELECT id, source_url, position FROM entries WHERE series_id = ? AND source_url != ''`
				)
				.all(seriesId) as { id: number; source_url: string; position: number }[]
		).map((e) => [e.source_url, e])
	);
	const fresh = plan.entries.filter((e) => !had.has(e.sourceUrl));
	db.transaction(() => {
		if (fresh.length)
			// Only the new episodes; nothing the owner set on the series moves.
			writeSeries(
				{ ...plan, coverUrl: undefined, entries: fresh },
				{ rootId: s.root_id, jobId: null, now, markMissing: false },
				db
			);
		// The plan's order, the whole series': an episode the source inserted moves the ones after it.
		const set = db.prepare(`UPDATE entries SET position = ? WHERE id = ?`);
		for (const e of plan.entries) {
			const h = had.get(e.sourceUrl);
			if (h && h.position !== e.position) set.run(e.position, h.id);
		}
		db.prepare(
			`INSERT INTO anime_checks (series_id, checked_at) VALUES (?, ?)
			ON CONFLICT (series_id) DO UPDATE SET checked_at = excluded.checked_at`
		).run(seriesId, now);
	})();
	if (fresh.length === 0) return { added: 0, queued: 0 };
	const rows = db
		.prepare(`SELECT id, source_url, read_at FROM entries WHERE series_id = ?`)
		.all(seriesId) as { id: number; source_url: string; read_at: number | null }[];
	const byUrl = new Map(rows.map((r) => [r.source_url, r]));
	const arrived = fresh
		.map((e) => byUrl.get(e.sourceUrl))
		.filter((r) => r !== undefined)
		.map((r) => ({ id: r.id, url: r.source_url, fetchedAt: now, downloaded: false }));
	if (opts.queue === false || s.followed_at === null) return { added: arrived.length, queued: 0 };
	const watched = new Set(rows.filter((r) => r.read_at !== null).map((r) => r.source_url));
	const pick = followQueue(
		arrived,
		s.followed_at,
		new Set(queueRows(db).map((r) => r.entryId)),
		watched
	);
	return { added: arrived.length, queued: enqueue(pick, now, db) };
}

/** FOLLOW's step for anime, beside the engine's manga and the plugins' novels. */
export async function followAnime(
	now = Date.now(),
	db: Database.Database = getDb()
): Promise<{ series: number; queued: number }> {
	const due = db
		.prepare(
			`SELECT s.id FROM series s LEFT JOIN anime_checks c ON c.series_id = s.id
			WHERE s.followed_at IS NOT NULL AND s.origin_key LIKE 'aniyomi:%'
				AND (c.checked_at IS NULL OR c.checked_at < ?)`
		)
		.all(now - FOLLOW_EVERY) as { id: number }[];
	let queued = 0;
	for (const s of due) {
		try {
			queued += (await checkAnime(s.id, now, db)).queued;
		} catch {
			// Asked again next time.
		}
	}
	return { series: due.length, queued };
}
