import { getDb } from './db.ts';
import { VISIBLE_SQL } from './visibility.ts';
import { mostlyHidden, normTitle, parseKey, type SourceUse } from '../library/downloads.ts';

/**
 * What the library holds of each source, for finding and adding series
 * (doc/DOWNLOADING.md, "Finding a series"): shared by both download
 * backends, Suwayomi's (suwayomi-library.ts) and the engine's
 * (engine/backend.ts), since none of it is either's.
 */

let used: { at: number; use: Map<string, SourceUse> } | null = null;

/** How many series, and how many hidden, the library has from each source. Kept a minute. */
export function sourceUse(): Map<string, SourceUse> {
	if (used && Date.now() - used.at < 60_000) return used.use;
	const rows = getDb()
		.prepare(
			`SELECT s.origin_key AS k, NOT ${VISIBLE_SQL} AS hidden
			FROM series s JOIN roots r ON r.id = s.root_id WHERE s.origin_key LIKE 'mihon:%'`
		)
		.all() as { k: string; hidden: number }[];
	const use = new Map<string, SourceUse>();
	for (const r of rows) {
		const key = parseKey(r.k);
		if (!key) continue;
		const u = use.get(key.sourceId) ?? { series: 0, hidden: 0 };
		u.series++;
		u.hidden += r.hidden;
		use.set(key.sourceId, u);
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
			FROM series s JOIN roots r ON r.id = s.root_id WHERE s.origin_key LIKE 'mihon:%'`
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
		const key = parseKey(r.k);
		if (key) byTitle.set(normTitle(r.title), key.sourceId);
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
