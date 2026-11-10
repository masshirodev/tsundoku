import { createHash } from 'node:crypto';
import { getDb } from '../db.ts';
import { HIDDEN_SQL, IN_LIBRARY_SQL, VISIBLE_SQL } from '../visibility.ts';
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
 * - `neverTracked`, NEVER TRACKED (c522): nothing from this source is sent to
 *   AniList, MAL or Ranobe, and no edition is suggested for one of its novels.
 *   Reads still count locally (progress, CONTINUE and HISTORY are unchanged);
 *   only the catalogues hear nothing. The send doors ask it where a send is
 *   queued and where the queue is drained (`tracking.ts`'s `targets`,
 *   `ranobe.ts`'s sends and its edition suggestion), and the series screen's
 *   LISTS row says why instead of offering a send.
 *
 * Stored in the `settings` key/value table, one row per switch that is on
 * (`source.<flag>:<source id>` = '1'; off is no row), with no rung:
 * `src/lib/server/db.ts` is not this card's, and the table is already the
 * server's own state. A row per switch, rather than one JSON value per
 * source, is what lets SQL ask the question as a primary-key lookup
 * (`offHistorySql`), so HISTORY filters in SQL as every hidden rule does.
 * The source id is BROWSE's: an engine source's number, or `ln:<plugin>`.
 */

export const SOURCE_FLAGS = ['hidden', 'addedHidden', 'offHistory', 'neverTracked'] as const;
export type SourceFlag = (typeof SOURCE_FLAGS)[number];
export type SourceFlags = Record<SourceFlag, boolean>;

/** Each switch's key prefix in `settings`. */
const PREFIX: Record<SourceFlag, string> = {
	hidden: 'source.hidden:',
	addedHidden: 'source.added-hidden:',
	offHistory: 'source.off-history:',
	neverTracked: 'source.never-tracked:'
};

export const isSourceFlag = (v: string): v is SourceFlag =>
	(SOURCE_FLAGS as readonly string[]).includes(v);

/** The key a switch is kept under, for one source. */
export const sourceFlagKey = (flag: SourceFlag, sourceId: string) => `${PREFIX[flag]}${sourceId}`;

/** One source's switches; every one off for a source nothing was set on. */
export function sourceFlags(sourceId: string, db = getDb()): SourceFlags {
	const keys = SOURCE_FLAGS.map((f) => sourceFlagKey(f, sourceId));
	const on = new Set(
		(
			db
				.prepare(
					`SELECT key FROM settings WHERE key IN (${SOURCE_FLAGS.map(() => '?').join(', ')}) AND value = '1'`
				)
				.all(...keys) as { key: string }[]
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

/**
 * Every switch of many sources at once, keyed by BROWSE's id: one query per
 * switch, for the lists that ask about a whole extension (EXTENSIONS' SELECT,
 * card c696) rather than one source. An id nothing was set on is all off, as
 * `sourceFlags` answers.
 */
export function sourceFlagsOf(
	sourceIds: readonly string[],
	db = getDb()
): Map<string, SourceFlags> {
	const out = new Map<string, SourceFlags>(
		[...new Set(sourceIds)].map((id) => [
			id,
			Object.fromEntries(SOURCE_FLAGS.map((f) => [f, false])) as SourceFlags
		])
	);
	if (out.size === 0) return out;
	for (const flag of SOURCE_FLAGS)
		for (const r of db
			.prepare(`SELECT substr(key, ?) AS id FROM settings WHERE key LIKE ? AND value = '1'`)
			.all(PREFIX[flag].length + 1, `${PREFIX[flag]}%`) as { id: string }[]) {
			const s = out.get(r.id);
			if (s) s[flag] = true;
		}
	return out;
}

/**
 * What a switch was on one source before a press: UNDO's fact. UNDO writes it
 * back, so a source already on stays on.
 */
export type FlagFact = { sourceId: string; previous: boolean };

/**
 * Sets one switch on many sources in one transaction, and answers each
 * source's value before the press (card c696). A phone's SELECT press changes
 * every source of every ticked extension, which is dozens of rows: they are
 * one write, so a failure part-way leaves nothing changed. UNDO is
 * `setSourceFlagValues` over these facts.
 */
export function setSourceFlags(
	sourceIds: readonly string[],
	flag: SourceFlag,
	on: boolean,
	db = getDb()
): FlagFact[] {
	const ids = [...new Set(sourceIds)];
	return db.transaction(() => {
		const facts = ids.map((sourceId) => ({ sourceId, previous: sourceFlags(sourceId, db)[flag] }));
		for (const f of facts) setSourceFlag(f.sourceId, flag, on, db);
		return facts;
	})();
}

/**
 * Writes each source's own value of one switch, in one transaction: UNDO's
 * write, over the facts the press answered. Unlike `setSourceFlags` the
 * values differ per source, which is what makes a mixed selection come back
 * mixed.
 */
export function setSourceFlagValues(
	flag: SourceFlag,
	values: readonly { sourceId: string; on: boolean }[],
	db = getDb()
): void {
	db.transaction(() => {
		for (const v of values) setSourceFlag(v.sourceId, flag, v.on, db);
	})();
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
export const sourceFlagSql = (flag: SourceFlag, col = 's.origin_key') => {
	const flagged = (key: string) =>
		`EXISTS (SELECT 1 FROM settings sf WHERE sf.key = '${PREFIX[flag]}' || ${sourceIdSql(key)} AND sf.value = '1')`;
	// A series is flagged when any book in it is (card c885): a group of books
	// from two sources stays out of what either source's switch keeps it out of.
	if (col !== 's.origin_key') return flagged(col);
	return `(${flagged(col)} OR EXISTS (SELECT 1 FROM entry_origins eo JOIN entries oe ON oe.id = eo.entry_id
		WHERE oe.series_id = s.id AND ${flagged('eo.origin_key')}))`;
};

/** The series `s` holds a book from this source (`?`), its own key or a grouped book's (c885). */
const ofSourceSql = `(${sourceIdSql('s.origin_key')} = @source OR EXISTS (SELECT 1 FROM entry_origins eo
	JOIN entries oe ON oe.id = eo.entry_id WHERE oe.series_id = s.id AND ${sourceIdSql('eo.origin_key')} = @source))`;

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
			WHERE s.origin_key = @key OR s.id IN (SELECT oe.series_id FROM entry_origins eo
				JOIN entries oe ON oe.id = eo.entry_id WHERE eo.origin_key = @key)`
		)
		.get({ key }) as { id: number; hidden: number } | undefined;
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

// ---- CONCEAL ITS SERIES (c523) ------------------------------------------------------------------

/**
 * What CONCEAL would hide now, on a source's settings page (card c523;
 * doc/BROWSE.md, "Conceal its series"): `own`, every series in the library
 * from the source that the library shows, and `others`, the shown parts from
 * other sources of the Works those are parts of, which go with them, since a
 * Work is never left half hidden (doc/WORKS.md, "The one rule"; c389). The
 * write itself is `setHiddenWhole`'s (works.ts), over `own`; this is only the
 * count the cell and its question say. A series hidden already, for its own
 * reasons or by its root, is in neither.
 */
export function concealable(sourceId: string, db = getDb()): { own: number[]; others: number[] } {
	const own = (
		db
			.prepare(
				`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
				WHERE ${IN_LIBRARY_SQL} AND ${VISIBLE_SQL} AND ${ofSourceSql}
				ORDER BY s.id`
			)
			.all({ source: sourceId }) as { id: number }[]
	).map((r) => r.id);
	if (own.length === 0) return { own, others: [] };
	const others = (
		db
			.prepare(
				`SELECT DISTINCT s.id FROM work_series ws
				JOIN series s ON s.id = ws.series_id JOIN roots r ON r.id = s.root_id
				WHERE ws.work_id IN (
					SELECT work_id FROM work_series WHERE series_id IN (SELECT value FROM json_each(?))
				)
				AND s.id NOT IN (SELECT value FROM json_each(?)) AND ${VISIBLE_SQL}
				ORDER BY s.id`
			)
			.all(JSON.stringify(own), JSON.stringify(own)) as { id: number }[]
	).map((r) => r.id);
	return { own, others };
}

/**
 * A series' mark, for CONCEAL's UNDO (c523): six hex characters of its root,
 * key and path (its title when it has neither). The band carries each id
 * with its mark, because an id is given again once its series is gone, so an
 * id alone could name a series added after the press; UNDO shows only an id
 * whose mark still matches. A series renamed or moved meanwhile stays hidden:
 * when in doubt, hidden.
 */
export function seriesMarks(ids: number[], db = getDb()): Map<number, string> {
	if (ids.length === 0) return new Map();
	const rows = db
		.prepare(
			`SELECT id, root_id, origin_key, path, title FROM series
			WHERE id IN (SELECT value FROM json_each(?))`
		)
		.all(JSON.stringify(ids)) as {
		id: number;
		root_id: number;
		origin_key: string | null;
		path: string;
		title: string;
	}[];
	return new Map(
		rows.map((r) => [
			r.id,
			createHash('sha256')
				.update(`${r.root_id}\n${r.origin_key ?? ''}\n${r.path || (r.origin_key ? '' : r.title)}`)
				.digest('hex')
				.slice(0, 6)
		])
	);
}

/** Of `ids`, those hidden now, by the one rule (`HIDDEN_SQL`): what CONCEAL's band still has to undo. */
export function hiddenOf(ids: number[], db = getDb()): number[] {
	if (ids.length === 0) return [];
	return (
		db
			.prepare(
				`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
				WHERE s.id IN (SELECT value FROM json_each(?)) AND ${HIDDEN_SQL} ORDER BY s.id`
			)
			.all(JSON.stringify(ids)) as { id: number }[]
	).map((r) => r.id);
}

/** Of `ids`, those from `sourceId` (by their key, as `sourceIdSql` reads it): the band's "N FROM IT". */
export function ofSource(ids: number[], sourceId: string, db = getDb()): number[] {
	if (ids.length === 0) return [];
	return (
		db
			.prepare(
				`SELECT s.id FROM series s
				WHERE s.id IN (SELECT value FROM json_each(@ids)) AND ${ofSourceSql}
				ORDER BY s.id`
			)
			.all({ ids: JSON.stringify(ids), source: sourceId }) as { id: number }[]
	).map((r) => r.id);
}
