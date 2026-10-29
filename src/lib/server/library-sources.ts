import { getDb } from './db.ts';
import { VISIBLE_SQL } from './visibility.ts';
import {
	mostlyHidden,
	normTitle,
	sourceOfKey,
	type QueueSeries,
	type SourceUse
} from '../library/downloads.ts';

/**
 * What the library holds of each source, for finding, adding and queueing
 * series (doc/DOWNLOADING.md, "Finding a series"): library queries the
 * engine's backend (engine/backend.ts) asks, kept apart from it since none
 * of it is the engine's.
 */

let used: { at: number; use: Map<string, SourceUse> } | null = null;

/** How many series, and how many hidden, the library has from each source. Kept a minute. */
export function sourceUse(): Map<string, SourceUse> {
	if (used && Date.now() - used.at < 60_000) return used.use;
	const rows = getDb()
		.prepare(
			`SELECT s.origin_key AS k, NOT ${VISIBLE_SQL} AS hidden
			FROM series s JOIN roots r ON r.id = s.root_id WHERE (s.origin_key LIKE 'mihon:%' OR s.origin_key LIKE 'lnreader:%')`
		)
		.all() as { k: string; hidden: number }[];
	const use = new Map<string, SourceUse>();
	for (const r of rows) {
		const sourceId = sourceOfKey(r.k);
		if (!sourceId) continue;
		const u = use.get(sourceId) ?? { series: 0, hidden: 0 };
		u.series++;
		u.hidden += r.hidden;
		use.set(sourceId, u);
	}
	used = { at: Date.now(), use };
	return use;
}

/** After adding or removing a series: the counts are asked again. */
export const forgetSourceUse = () => {
	used = null;
};

/** What tsundoku has, for telling a result IN LIBRARY or SAME TITLE IN LIBRARY. */
export function libraryIndex(reveal: boolean) {
	const rows = getDb()
		.prepare(
			`SELECT s.id, s.title, s.origin_key AS k, NOT ${VISIBLE_SQL} AS hidden,
				(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0) AS total,
				(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0 AND e.available = 1) AS have
			FROM series s JOIN roots r ON r.id = s.root_id WHERE (s.origin_key LIKE 'mihon:%' OR s.origin_key LIKE 'lnreader:%')`
		)
		.all() as {
		id: number;
		title: string;
		k: string;
		hidden: number;
		total: number;
		have: number;
	}[];
	const byKey = new Map(rows.map((r) => [r.k, r]));
	const byTitle = new Map<string, string>();
	for (const r of rows) {
		if (r.hidden && !reveal) continue;
		const sourceId = sourceOfKey(r.k);
		if (sourceId) byTitle.set(normTitle(r.title), sourceId);
	}
	// A twin in a mostly-hidden source is still a twin, but with reveal off the
	// source isn't named: hidden means not named, not just not listed.
	const use = sourceUse();
	const nameable = (sourceId: string) =>
		reveal || !mostlyHidden(use.get(sourceId) ?? { series: 0, hidden: 0 });
	return { byKey, byTitle, nameable };
}

/** The root Mihon series live in: the one most of them are in already. */
export function mihonRoot(): number | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT root_id AS id FROM series WHERE origin_key LIKE 'mihon:%'
			GROUP BY root_id ORDER BY COUNT(*) DESC LIMIT 1`
		)
		.get() as { id: number } | undefined;
	return (
		row?.id ??
		(db.prepare(`SELECT id FROM roots WHERE name = 'Mihon'`).get() as { id: number } | undefined)
			?.id ??
		null
	);
}

/** The tsundoku series a queued manga is, by key; null when it hasn't been imported. */
export function seriesForKey(key: string): QueueSeries | null {
	const row = getDb()
		.prepare(
			`SELECT s.id, s.title, NOT ${VISIBLE_SQL} AS hidden, s.cover_at, s.hue
			FROM series s JOIN roots r ON r.id = s.root_id WHERE s.origin_key = ?`
		)
		.get(key) as
		{ id: number; title: string; hidden: number; cover_at: number | null; hue: number } | undefined;
	return row
		? { id: row.id, title: row.title, hidden: row.hidden === 1, cover: row.cover_at, hue: row.hue }
		: null;
}

/**
 * Chapters that arrived since `since` (the NEW shelf's own clock,
 * `entries.arrived_at`), for "12 DOWNLOADED IN THE LAST HOUR": what finished
 * is the NEW shelf's, and the queue only points there.
 */
export function arrivedSince(since: number, reveal: boolean): number {
	return (
		getDb()
			.prepare(
				`SELECT COUNT(*) AS n FROM entries e JOIN series s ON s.id = e.series_id
				JOIN roots r ON r.id = s.root_id
				WHERE e.arrived_at >= ? AND e.shadowed = 0 AND ${reveal ? '1' : VISIBLE_SQL}`
			)
			.get(since) as { n: number }
	).n;
}
