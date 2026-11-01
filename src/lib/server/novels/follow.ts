import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { writeSeries } from '../import/write.ts';
import { libraryRoot } from '../import/index.ts';
import { enqueue, queueRows } from '../engine/queue.ts';
import { planNovel } from '../../import/novel-plan.ts';
import { followQueue, parseNovelKey } from '../../library/downloads.ts';
import { installedPlugins, type InstalledPlugin } from './plugins.ts';
import { NovelSourceError, parseNovel } from './source.ts';
import { writeBook } from './downloader.ts';

/**
 * FOLLOW for a novel (doc/NOVELS.md, "FOLLOW"; card c151), as for a manga
 * (engine/backend.ts, followNew): every six hours its plugin is asked for the
 * novel again; a chapter it lists that no entry is becomes one, through the
 * importers' one writer with the same plan ADD used, and is queued unless
 * read, fifty a series a run at most, oldest first, so the next ones to read
 * are the first to come.
 */

/** How often a followed novel's plugin is asked for new chapters. */
const FOLLOW_EVERY = 6 * 60 * 60 * 1000;

function pluginOf(id: string): InstalledPlugin | null {
	const p = installedPlugins().find((x) => x.id === id);
	return p && !p.failed ? p : null;
}

const checking = new Set<number>();

/** FOLLOW and FOLLOWING ✓ on a novel: followed from now on, and its plugin asked at once. */
export function setNovelFollowed(
	seriesId: number,
	on: boolean,
	now = Date.now(),
	db: Database.Database = getDb()
): void {
	const s = db.prepare(`SELECT origin_key FROM series WHERE id = ?`).get(seriesId) as
		{ origin_key: string | null } | undefined;
	const key = parseNovelKey(s?.origin_key ?? null);
	if (!key || !pluginOf(key.plugin))
		throw new NovelSourceError('only a novel from an installed plugin can be followed');
	db.prepare(`UPDATE series SET followed_at = ? WHERE id = ?`).run(on ? now : null, seriesId);
	if (!on || checking.has(seriesId)) return;
	checking.add(seriesId);
	void checkNovel(seriesId, Date.now(), db)
		.catch(() => {})
		.finally(() => checking.delete(seriesId));
}

/** When a novel's plugin was last asked about it; null before the first time. */
export function novelCheckedAt(seriesId: number, db: Database.Database = getDb()): number | null {
	return (
		(
			db.prepare(`SELECT checked_at FROM novel_checks WHERE series_id = ?`).get(seriesId) as
				{ checked_at: number } | undefined
		)?.checked_at ?? null
	);
}

/**
 * Asks a novel's plugin for its chapters, makes entries of the new ones and
 * queues what FOLLOW should. Returns how many arrived, and how many were
 * queued. Throws when the plugin can't answer: the check isn't recorded, so
 * the next step asks again. As for an anime, FOLLOW is not a condition:
 * REFRESH (card c220) asks a novel the owner doesn't follow, and queues
 * nothing (`queue: false`).
 */
export async function checkNovel(
	seriesId: number,
	now = Date.now(),
	db: Database.Database = getDb(),
	opts: { queue?: boolean } = {}
): Promise<{ added: number; queued: number }> {
	const s = db
		.prepare(`SELECT id, root_id, origin_key, followed_at FROM series WHERE id = ?`)
		.get(seriesId) as
		{ id: number; root_id: number; origin_key: string; followed_at: number | null } | undefined;
	const key = parseNovelKey(s?.origin_key ?? null);
	if (!s || !key) return { added: 0, queued: 0 };
	const p = pluginOf(key.plugin);
	if (!p) throw new NovelSourceError('No installed plugin has this source');
	const n = await parseNovel(p, key.path, true);
	const plan = planNovel({ ...n, path: key.path }, { plugin: p.id, name: p.name }, now);

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
	let moved = 0;
	db.transaction(() => {
		if (fresh.length)
			// Only the new chapters; nothing the owner set on the series moves.
			writeSeries(
				{ ...plan, coverUrl: undefined, entries: fresh },
				{ rootId: s.root_id, jobId: null, now, markMissing: false },
				db
			);
		// A chapter the source inserted can move an unnumbered one after it.
		const set = db.prepare(`UPDATE entries SET position = ? WHERE id = ?`);
		for (const e of plan.entries) {
			const h = had.get(e.sourceUrl);
			if (h && h.position !== e.position) {
				set.run(e.position, h.id);
				moved++;
			}
		}
		db.prepare(
			`INSERT INTO novel_checks (series_id, checked_at) VALUES (?, ?)
			ON CONFLICT (series_id) DO UPDATE SET checked_at = excluded.checked_at`
		).run(seriesId, now);
	})();
	// The book names each chapter's place, and a rescan applies it: moved
	// places go into the book too, or the next import would put them back.
	const hasBook = db.prepare(`SELECT 1 FROM novel_series WHERE series_id = ?`).get(seriesId);
	if (moved > 0 && hasBook)
		await writeBook(seriesId, p, [], { db, library: libraryRoot(), now: () => now });
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
	const read = new Set(rows.filter((r) => r.read_at !== null).map((r) => r.source_url));
	const pick = followQueue(
		arrived,
		s.followed_at,
		new Set(queueRows(db).map((r) => r.entryId)),
		read
	);
	return { added: arrived.length, queued: enqueue(pick, now, db) };
}

/**
 * FOLLOW's step for novels, beside the engine's (engine/run.ts, every ten
 * minutes): each followed novel whose plugin wasn't asked in six hours. A
 * plugin that fails is asked again at the next step.
 */
export async function followNovels(
	now = Date.now(),
	db: Database.Database = getDb()
): Promise<{ series: number; queued: number }> {
	const due = db
		.prepare(
			`SELECT s.id FROM series s LEFT JOIN novel_checks c ON c.series_id = s.id
			WHERE s.followed_at IS NOT NULL AND s.origin_key LIKE 'lnreader:%'
				AND (c.checked_at IS NULL OR c.checked_at < ?)`
		)
		.all(now - FOLLOW_EVERY) as { id: number }[];
	let queued = 0;
	for (const s of due) {
		try {
			queued += (await checkNovel(s.id, now, db)).queued;
		} catch {
			// Asked again next time.
		}
	}
	return { series: due.length, queued };
}
