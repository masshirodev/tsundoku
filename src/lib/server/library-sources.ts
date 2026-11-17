import { getDb } from './db.ts';
import { IN_LIBRARY_SQL, libraryWhere, VISIBLE_SQL } from './visibility.ts';
import { sourcesWith } from './engine/source-flags.ts';
import { namesOf } from './engine/device.ts';
import { entryOriginSql } from './season-facts.ts';
import {
	mostlyHidden,
	normTitle,
	sourceOfKey,
	type QueueSeries,
	type SourceUse
} from '../library/downloads.ts';

/**
 * What the library holds of each source, for finding, adding and queueing
 * series (doc/DOWNLOADS.md, "Finding a series"): library queries the
 * engine's backend (engine/backend.ts) asks, kept apart from it since none
 * of it is the engine's.
 */

let used: { at: number; use: Map<string, SourceUse> } | null = null;

/** Whether a key names a source's own entry: what the two queries below keep. */
const HAS_SOURCE = (key: string) =>
	`(${key} LIKE 'mihon:%' OR ${key} LIKE 'lnreader:%' OR ${key} LIKE 'aniyomi:%')`;

/** How many series, and how many hidden, the library has from each source. Kept a minute. */
export function sourceUse(): Map<string, SourceUse> {
	if (used && Date.now() - used.at < 60_000) return used.use;
	const rows = getDb()
		.prepare(
			`SELECT s.id, s.origin_key AS k, NOT ${VISIBLE_SQL} AS hidden
			FROM series s JOIN roots r ON r.id = s.root_id WHERE ${IN_LIBRARY_SQL} AND ${HAS_SOURCE('s.origin_key')}
			UNION ALL
			SELECT s.id, f.origin_key, NOT ${VISIBLE_SQL}
			FROM series_season_facts f JOIN series s ON s.id = f.series_id JOIN roots r ON r.id = s.root_id
			WHERE ${IN_LIBRARY_SQL} AND ${HAS_SOURCE('f.origin_key')}
			UNION ALL
			SELECT s.id, eo.origin_key, NOT ${VISIBLE_SQL}
			FROM entry_origins eo JOIN entries e ON e.id = eo.entry_id
			JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
			WHERE ${IN_LIBRARY_SQL} AND ${HAS_SOURCE('eo.origin_key')}`
		)
		.all() as { id: number; k: string; hidden: number }[];
	const use = new Map<string, SourceUse>();
	// A series with seasons at one source, or a season and the series both, counts there once.
	const counted = new Set<string>();
	for (const r of rows) {
		const sourceId = sourceOfKey(r.k);
		if (!sourceId) continue;
		const pair = `${r.id}\u0000${sourceId}`;
		if (counted.has(pair)) continue;
		counted.add(pair);
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

/** A key's family of source: `mihon` (manga), `lnreader` (novels) or `aniyomi` (anime). */
const familyOf = (key: string) => key.slice(0, key.indexOf(':'));

/** What tsundoku has, for telling a result IN LIBRARY or SAME TITLE IN LIBRARY. */
export function libraryIndex(reveal: boolean) {
	type Holding = {
		id: number;
		title: string;
		alts: string;
		k: string;
		hidden: number;
		total: number;
		have: number;
	};
	const db = getDb();
	// A key's count is what its source supplies: a series' own key does not
	// count the seasons that have another source (c282).
	const ofKey = (key: string) =>
		`e.series_id = s.id AND e.shadowed = 0 AND ${entryOriginSql('e', 's')} = ${key}`;
	const rows = db
		.prepare(
			`SELECT s.id, s.title, s.alt_titles AS alts, s.origin_key AS k, NOT ${VISIBLE_SQL} AS hidden,
				(SELECT COUNT(*) FROM entries e WHERE ${ofKey('s.origin_key')}) AS total,
				(SELECT COUNT(*) FROM entries e WHERE ${ofKey('s.origin_key')} AND e.available = 1) AS have
			FROM series s JOIN roots r ON r.id = s.root_id WHERE ${IN_LIBRARY_SQL} AND ${HAS_SOURCE('s.origin_key')}`
		)
		.all() as Holding[];
	// Each season's source too, by the name that source gave it. Two seasons
	// sharing a key are one row, named by the first; a key the series itself
	// holds is already above. Lowest id last, so `seriesHolding`'s answer wins
	// if a key is ever held twice.
	const seasons = db
		.prepare(
			`SELECT s.id, COALESCE(NULLIF(f.source_title, ''), s.title) AS title, '[]' AS alts,
				f.origin_key AS k, NOT ${VISIBLE_SQL} AS hidden, MIN(f.season) AS first,
				(SELECT COUNT(*) FROM entries e WHERE ${ofKey('f.origin_key')}) AS total,
				(SELECT COUNT(*) FROM entries e WHERE ${ofKey('f.origin_key')} AND e.available = 1) AS have
			FROM series_season_facts f JOIN series s ON s.id = f.series_id JOIN roots r ON r.id = s.root_id
			WHERE ${IN_LIBRARY_SQL} AND ${HAS_SOURCE('f.origin_key')}
				AND f.origin_key IS NOT COALESCE(s.origin_key, '')
			GROUP BY s.id, f.origin_key ORDER BY s.id DESC`
		)
		.all() as Holding[];
	// A book in a group is held at its own source (card c885), under the name
	// the source knows it by, so a result still says it's in the library.
	const books = db
		.prepare(
			`SELECT s.id, COALESCE(NULLIF(eo.source_title, ''), NULLIF(e.title, ''), s.title) AS title,
				'[]' AS alts, eo.origin_key AS k, NOT ${VISIBLE_SQL} AS hidden,
				1 AS total, e.available AS have
			FROM entry_origins eo JOIN entries e ON e.id = eo.entry_id
			JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
			WHERE ${IN_LIBRARY_SQL} AND ${HAS_SOURCE('eo.origin_key')} AND e.shadowed = 0`
		)
		.all() as Holding[];
	const held = [...seasons, ...books, ...rows];
	const byKey = new Map(held.map((r) => [r.k, r]));
	// SAME TITLE only within a kind of source: an anime named as a manga is an
	// adaptation, not a copy of it from elsewhere ("Oshi no Ko" on KickAssAnime
	// isn't Weeb Central's), and a light novel isn't its manga either.
	// By the names a series had or goes by too (c555): a source still calls
	// a renamed series by its old name, which a rename keeps in `alt_titles`.
	// Titles are set last, so a result named as one series is titled and
	// another was once called is the titled one's.
	const byTitle = new Map<string, string>();
	const shown = held.filter((r) => reveal || !r.hidden);
	for (const r of shown) {
		const sourceId = sourceOfKey(r.k);
		for (const alt of namesOf('', r.alts))
			if (sourceId) byTitle.set(`${familyOf(r.k)}\u0000${normTitle(alt)}`, sourceId);
	}
	for (const r of shown) {
		const sourceId = sourceOfKey(r.k);
		if (sourceId) byTitle.set(`${familyOf(r.k)}\u0000${normTitle(r.title)}`, sourceId);
	}
	/** Another source's series by this title, of the same family as `key`'s, or undefined. */
	const sameTitle = (key: string, title: string) =>
		byTitle.get(`${familyOf(key)}\u0000${normTitle(title)}`);
	// A twin in a mostly-hidden source is still a twin, but with reveal off the
	// source isn't named: hidden means not named, not just not listed.
	const use = sourceUse();
	// Nor is a source whose own HIDDEN SOURCE switch is on (card c435).
	const switchedOff = reveal ? new Set<string>() : sourcesWith('hidden');
	const nameable = (sourceId: string) =>
		reveal ||
		(!switchedOff.has(sourceId) && !mostlyHidden(use.get(sourceId) ?? { series: 0, hidden: 0 }));
	return { byKey, sameTitle, nameable };
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

/**
 * The tsundoku series a queued manga is, by key; null when it hasn't been
 * imported. Only the library's: a browsing record (doc/READING-ONLINE.md) isn't one.
 */
export function seriesForKey(key: string): QueueSeries | null {
	const row = getDb()
		.prepare(
			`SELECT s.id,
				-- The queue groups by key, so a book in a group goes by its own name there (c885).
				COALESCE((SELECT NULLIF(eo.source_title, '') FROM entry_origins eo
					JOIN entries e ON e.id = eo.entry_id
					WHERE e.series_id = s.id AND eo.origin_key = @key), s.title) AS title,
				NOT ${VISIBLE_SQL} AS hidden, s.cover_at, s.hue
			FROM series s JOIN roots r ON r.id = s.root_id
			WHERE (s.origin_key = @key OR EXISTS (SELECT 1 FROM series_season_facts f
					WHERE f.series_id = s.id AND f.origin_key = @key)
					OR EXISTS (SELECT 1 FROM entry_origins eo JOIN entries e ON e.id = eo.entry_id
						WHERE e.series_id = s.id AND eo.origin_key = @key))
				AND ${IN_LIBRARY_SQL}
			ORDER BY s.origin_key IS @key DESC, s.id LIMIT 1`
		)
		.get({ key }) as
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
				WHERE e.arrived_at >= ? AND e.shadowed = 0 AND ${libraryWhere(reveal)}`
			)
			.get(since) as { n: number }
	).n;
}
