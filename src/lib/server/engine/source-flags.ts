import { getDb } from '../db.ts';
import { VISIBLE_SQL } from '../visibility.ts';
import type { Kind } from '../../library/kinds.ts';

/**
 * A source's own switches in tsundoku (doc/BROWSE.md, "A source's own
 * switches"; card c435): set on its settings page, above the extension's own
 * preferences, for every family (Mihon's and Aniyomi's extensions and
 * LNReader's plugins alike).
 *
 * - `hidden`, HIDDEN SOURCE: the source is listed, opened, searched and named
 *   only inside reveal, as a mostly-hidden one is (Hidden means hidden).
 * - `addedHidden`, ADDED HIDDEN: a series added to the library from it starts
 *   hidden.
 * - `offHistory`, OFF HISTORY: its reads and watches never show in HISTORY.
 *   They are still recorded, so progress, CONTINUE and tracking are unchanged.
 *
 * Stored in the `settings` key/value table, one row per switch that is on
 * (`source.<flag>:<source id>` = '1'; off is no row), with no rung:
 * `src/lib/server/db.ts` is not this card's, and the table is already the
 * server's own state. A row per switch, rather than one JSON value per
 * source, is what lets SQL ask the question as a primary-key lookup
 * (`offHistorySql`), so HISTORY filters in SQL as every hidden rule does.
 * The source id is BROWSE's: an engine source's number, or `ln:<plugin>`.
 */

export const SOURCE_FLAGS = ['hidden', 'addedHidden', 'offHistory'] as const;
export type SourceFlag = (typeof SOURCE_FLAGS)[number];
export type SourceFlags = Record<SourceFlag, boolean>;

/** Each switch's key prefix in `settings`. */
const PREFIX: Record<SourceFlag, string> = {
	hidden: 'source.hidden:',
	addedHidden: 'source.added-hidden:',
	offHistory: 'source.off-history:'
};

export const isSourceFlag = (v: string): v is SourceFlag =>
	(SOURCE_FLAGS as readonly string[]).includes(v);

/** The key a switch is kept under, for one source. */
export const sourceFlagKey = (flag: SourceFlag, sourceId: string) => `${PREFIX[flag]}${sourceId}`;

/** One source's switches; every one off for a source nothing was set on. */
export function sourceFlags(sourceId: string, db = getDb()): SourceFlags {
	const on = new Set(
		(
			db
				.prepare(`SELECT key FROM settings WHERE key IN (?, ?, ?) AND value = '1'`)
				.all(...SOURCE_FLAGS.map((f) => sourceFlagKey(f, sourceId))) as { key: string }[]
		).map((r) => r.key)
	);
	return Object.fromEntries(
		SOURCE_FLAGS.map((f) => [f, on.has(sourceFlagKey(f, sourceId))])
	) as SourceFlags;
}

/** Turns one switch on or off. Off deletes the row, so a source with none set has none. */
export function setSourceFlag(sourceId: string, flag: SourceFlag, on: boolean, db = getDb()): void {
	const key = sourceFlagKey(flag, sourceId);
	if (on)
		db.prepare(
			`INSERT INTO settings (key, value) VALUES (?, '1')
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`
		).run(key);
	else db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
}

/** Every source with one switch on, by BROWSE's id. */
export function sourcesWith(flag: SourceFlag, db = getDb()): Set<string> {
	return new Set(
		(
			db
				.prepare(`SELECT substr(key, ?) AS id FROM settings WHERE key LIKE ? AND value = '1'`)
				.all(PREFIX[flag].length + 1, `${PREFIX[flag]}%`) as { id: string }[]
		).map((r) => r.id)
	);
}

/**
 * The source id a series' `origin_key` names, in SQL: what `sourceOfKey`
 * (library/downloads.ts) answers in TypeScript. `mihon:<n>:<url>` and
 * `aniyomi:<n>:<url>` are `<n>`, `lnreader:<plugin>:<path>` is
 * `ln:<plugin>`, and any other key (Hentoid's, an EPUB's, none) is NULL.
 * `tests/source-flags-db.spec.ts` holds it to `sourceOfKey` on every key a
 * writer stores.
 */
export function sourceIdSql(col: string): string {
	// What follows the family's prefix, the id in it (up to the next colon) and
	// the address after that. GLOB, not LIKE: LIKE ignores case, and a key's
	// prefix and parsers do not (`parseKey`, `parseAnimeKey`, `parseNovelKey`).
	const rest = `substr(${col}, instr(${col}, ':') + 1)`;
	const id = `substr(${rest}, 1, instr(${rest}, ':') - 1)`;
	const url = `substr(${rest}, instr(${rest}, ':') + 1)`;
	const shaped = `instr(${rest}, ':') > 1 AND ${url} != ''`;
	return `(CASE
		WHEN (${col} GLOB 'mihon:*' OR ${col} GLOB 'aniyomi:*') AND ${shaped}
			AND ${id} NOT GLOB '*[^0-9]*' THEN ${id}
		WHEN ${col} GLOB 'lnreader:*' AND ${shaped}
			AND ${id} NOT GLOB '*[^A-Za-z0-9._-]*' THEN 'ln:' || ${id}
	END)`;
}

/**
 * True, in SQL, for a series (`s`) whose source has `flag` on: a lookup of
 * the switch's own row by primary key. A series from no source is never
 * flagged.
 */
export const sourceFlagSql = (flag: SourceFlag, col = 's.origin_key') =>
	`EXISTS (SELECT 1 FROM settings sf WHERE sf.key = '${PREFIX[flag]}' || ${sourceIdSql(col)} AND sf.value = '1')`;

/**
 * ADD's half of ADDED HIDDEN: a series that has just become the library's
 * (a new series written with ADD, or a browsing record promoted by it) starts
 * hidden when its source has the switch on. Every add door a source has calls
 * this after the series is in the library: `addToLibrary` (engine/backend.ts),
 * `addNovel` (novels/source.ts), `addAnime` (engine/anime-source.ts) and
 * `keepOrPromote` (browsing.ts). A browsing record itself is not an add, and
 * stays as it was written: the reader and the player open it from the
 * preview, and a hidden one would refuse them outside reveal. Answers whether
 * it hid the series.
 */
export function hideIfAddedHidden(seriesId: number, db = getDb()): boolean {
	return (
		db
			.prepare(
				`UPDATE series SET hidden = 1
				WHERE id = ? AND in_library = 1 AND hidden = 0 AND ${sourceFlagSql('addedHidden', 'origin_key')}`
			)
			.run(seriesId).changes > 0
	);
}

/**
 * A series' hidden state under the key a preview knows it by, in the library
 * or a browsing record, or null when nothing here has that key. ADD AND
 * DOWNLOAD reads it before and after its ADD (c505): only a series that was
 * not hidden before and is after was hidden by *this* ADD, and only that one
 * is queued outside reveal. Hidden is the one rule (`VISIBLE_SQL`), a hidden
 * root included.
 */
export function hiddenByKey(key: string, db = getDb()): { id: number; hidden: boolean } | null {
	const r = db
		.prepare(
			`SELECT s.id, NOT ${VISIBLE_SQL} AS hidden FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.origin_key = ?`
		)
		.get(key) as { id: number; hidden: number } | undefined;
	return r ? { id: r.id, hidden: r.hidden === 1 } : null;
}

/**
 * An ADD, and whether it was this ADD that hid the series (c505). Every add
 * door also answers with a series already here (`keepOrPromote`), so the
 * hidden state under `key` (the preview's) is read before and after: only a
 * series not hidden before and hidden after, and the one the ADD answered
 * with, was hidden by this ADD (ADDED HIDDEN, `hideIfAddedHidden`). A null
 * key reads nothing and answers false: the caller asks only outside reveal.
 */
export async function addWatchingHidden(
	key: string | null,
	add: () => Promise<number>,
	db = getDb()
): Promise<{ seriesId: number; hidByThisAdd: boolean }> {
	const before = key ? hiddenByKey(key, db) : null;
	const seriesId = await add();
	const after = key ? hiddenByKey(key, db) : null;
	return {
		seriesId,
		hidByThisAdd: !!after && after.id === seriesId && after.hidden && !(before?.hidden ?? false)
	};
}

/**
 * The source page's ADDED band after an ADD outside reveal landed there
 * (c505): the series the band's URL names, only while it is still the one
 * added from that preview (its id and its key both: an id is reused once its
 * series is gone, so the id alone could name a series added later), still in
 * the library and still from this source. `touched` is UNDO's own refusal
 * (`undoAdd`): something of it is downloaded or read. Null when there is no
 * such series any more (UNDO ran, or it was deleted), and the band is not
 * drawn.
 */
export function addedHere(
	seriesId: number,
	key: string,
	db = getDb()
): { entries: number; touched: boolean; kind: Kind } | null {
	const r = db
		.prepare(
			`SELECT s.kind,
				(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0) AS entries,
				(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id
					AND (e.available = 1 OR e.read_at IS NOT NULL)) AS touched
			FROM series s WHERE s.id = ? AND s.origin_key = ? AND s.in_library = 1`
		)
		.get(seriesId, key) as { kind: Kind; entries: number; touched: number } | undefined;
	return r ? { entries: r.entries, touched: r.touched > 0, kind: r.kind } : null;
}
