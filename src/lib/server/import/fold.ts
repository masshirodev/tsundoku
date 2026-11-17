import type Database from 'better-sqlite3';
import { posix } from '../fspath.ts';
import { fileIn, widenTo } from '../paths.ts';
import { folderTitleMatches, sourceDirMatches } from '../../import/mihon-plan.ts';
import type { PlannedEntry, PlannedSeries } from '../../import/plan.ts';
import { HIDDEN_SQL } from '../visibility.ts';
import { setHiddenWhole } from '../works.ts';

/**
 * A Mihon download imports keyed by its folder (`mihon-dir:`) until a backup
 * knows the manga, then by its URL (doc/IMPORT-MIHON.md, "Before the backup
 * knows it"). Without this the folder's series lingered beside the URL's,
 * both reading the same files: nothing plans the folder key again once a
 * backup claims the folder, so nothing ever marked it gone.
 *
 * Run inside the writer's transaction, before it looks the series up. A plan
 * carries the folder key it used to have (`formerKey`) when this device has
 * both the download and the backup; when the backup is another device's, the
 * folder is found by the source and title a download of the series is filed
 * under (`adoptFolder`), or a folder's plan finds the series a backup names
 * (`adoptNamed`). A folder key that is settled stays in `series_former_keys`,
 * as a move's old key does (doc/MOVE.md), so the device whose backup still
 * doesn't name the manga never makes it again.
 */
export function adoptFormer(
	db: Database.Database,
	s: PlannedSeries,
	now: number,
	dropped: Dropped[] = []
): void {
	if (!s.formerKey) return;
	const former = seriesBy(db, s.formerKey);
	if (!former) return;
	const current = seriesBy(db, s.originKey);
	// A browsing record is never the survivor (doc/READING-ONLINE.md): this device has
	// the folder's series *and* a record under the URL key, which is what an
	// open from a source's preview without ADD makes. Folding the folder into
	// the record would take a downloaded, rated, read series out of the library
	// and let pruneRecords forget its reading. So the record's data moves into
	// the folder's series, which keeps the library row, its id and its key.
	if (current && current.in_library !== 1) note(dropped, foldSeries(db, current.id, former.id));
	// Both exist and the URL's is the library's: the folder's is folded into it,
	// keeping whatever the user did in either. No file is moved. A fold keeps
	// only one side's title, kind and direction, so the folder's edit is carried
	// first, as `adoptNamed` does on the other path (doc/IMPORT-MIHON.md, "Both
	// exist"). `formerKey` is always a `mihon-dir:` key (`folderKey`,
	// mihon-plan.ts); the guard is for a key that somehow is not.
	else if (current) {
		const parts = folderParts(s.formerKey);
		if (parts) carryEdit(db, former.id, current.id, parts.dir);
		note(dropped, foldSeries(db, former.id, current.id));
		rememberKey(db, current.id, s.formerKey, 'mihon', s.originKey, now);
		return;
	}
	takeKey(db, s, former.id);
	rememberKey(db, former.id, s.formerKey, 'mihon', s.originKey, now);
	// ComicInfo's full `Web` URL against the backup's path: the same chapter
	// takes the URL the writer will look it up by.
	rekeyEntries(db, former.id, s.entries, now);
}

/** The URL key, the source URL and the direction a folder's series takes on. */
function takeKey(db: Database.Database, s: PlannedSeries, id: number): void {
	db.prepare(
		`UPDATE series SET origin_key = ?,
			source_url = CASE WHEN source_url = '' THEN ? ELSE source_url END,
			direction = COALESCE(direction, ?)
		WHERE id = ?`
	).run(s.originKey, s.sourceUrl, s.direction, id);
}

const FOLDER_KEY = 'mihon-dir:';

/** A folder key's own two names, or null for any other key. */
function folderParts(key: string): { sourceDir: string; dir: string } | null {
	if (!key.startsWith(FOLDER_KEY)) return null;
	const rest = key.slice(FOLDER_KEY.length);
	const slash = rest.indexOf('/');
	if (slash <= 0 || slash === rest.length - 1) return null;
	return { sourceDir: rest.slice(0, slash), dir: rest.slice(slash + 1) };
}

/**
 * The installed source a Mihon download folder's series is from
 * (doc/BROWSE.md, "ADDED HIDDEN at the importer"), by the engine's own name
 * for it, or null. A `mihon-dir:` key names no source id (`sourceIdSql`
 * answers NULL), only the folder Mihon filed it under, which Mihon names
 * `<name> (<LANG>)` (its `Source.toString()`). So the folder is a source's
 * when it is exactly that source's name and language; failing any such
 * source, when it is exactly a source's bare name. **Only one source may
 * answer**: two installed sources with one name and one language (two
 * extensions both calling themselves "Asura Scans", EN) cannot be told
 * apart from the folder, and the answer is null, so nothing is decided by a
 * guess. Two of one name in different languages are told apart by the
 * folder's language. A source not installed has no row, and answers null.
 */
export function folderSourceId(db: Database.Database, key: string): string | null {
	const parts = folderParts(key);
	if (!parts) return null;
	const dir = parts.sourceDir.toLowerCase();
	const rows = db.prepare(`SELECT id, name, lang FROM engine_sources`).all() as {
		id: string;
		name: string;
		lang: string;
	}[];
	const exact = rows.filter((r) => dir === `${r.name} (${r.lang})`.toLowerCase());
	const one = exact.length > 0 ? exact : rows.filter((r) => dir === r.name.toLowerCase());
	return one.length === 1 ? one[0].id : null;
}

type KeyedRow = {
	id: number;
	origin_key: string;
	title: string;
	path: string;
	in_library: number;
	pruned_at: number | null;
};

/**
 * A backup's plan, and a download imported by its folder, are the same series
 * even when the backup is another device's: the folder's series takes the URL
 * key, as it does when one device has both. Its entries take the backup's
 * chapter URLs by the same rule the disk match uses (the `Web` URL ends with
 * the backup's path, then the number); one that matches neither is left as it
 * is, so nothing is lost by adopting.
 */
export function adoptFolder(
	db: Database.Database,
	s: PlannedSeries,
	rootId: number,
	now: number
): number | null {
	const folder = s.folder;
	if (!s.originKey.startsWith('mihon:')) return null;
	// A folder's series is the same series by the importer's own rule: the same
	// source and the same title (doc/IMPORT-MIHON.md, "Matching downloads").
	// A backup that names no source gives the plan no folder: the
	// source is then confirmed by the second signal (`unnamedSourceIs`).
	const candidates = rowsIn(db, rootId, 'mihon-dir:%').filter((row) => {
		const parts = folderParts(row.origin_key);
		if (!parts) return false;
		if (folder)
			return (
				sourceDirMatches(parts.sourceDir, folder.source) &&
				(folderTitleMatches(parts.dir, folder.title) || row.title === folder.title)
			);
		return (
			(folderTitleMatches(parts.dir, s.title) || row.title === s.title) &&
			unnamedSourceIs(db, s.originKey, parts.sourceDir, row.title === s.title, () =>
				addressMatches(db, row.id, s.entries)
			)
		);
	});
	const best = bestOf(db, s, candidates);
	// A name is not an entry in common: adopting on name alone would take the
	// folder's series to the URL key with its chapters still addressed by the
	// folder, and the writer would add the backup's chapters beside them -- every
	// chapter twice (doc/IMPORT-MIHON.md, "Before the backup knows it"). A plan
	// with no chapters proves nothing, so a chapterless backup entry is still
	// adopted by name.
	if (!best || (s.entries.length > 0 && best.matches.size === 0)) return null;
	takeKey(db, s, best.row.id);
	rememberKey(db, best.row.id, best.row.origin_key, 'mihon', s.originKey, now);
	for (const [entryId, planned] of best.matches) rekeyEntry(db, entryId, planned.sourceUrl, now);
	return best.row.id;
}

/**
 * The other order: a folder's plan meets the series a backup names, whether
 * this device's own (the folder was left behind by an import before the rule)
 * or another's. The folder's series is folded into the named one -- keeping
 * what the user did in either -- and the folder key joins the named series'
 * former keys, so the device that still plans it finds the same series.
 */
export function adoptNamed(
	db: Database.Database,
	s: PlannedSeries,
	rootId: number,
	now: number,
	dropped: Dropped[] = []
): number | null {
	const folder = s.folder;
	const parts = folderParts(s.originKey);
	if (!folder || !parts) return null;
	const sourceTag = db.prepare(
		`SELECT 1 FROM series_tags st JOIN tags t ON t.id = st.tag_id
		WHERE st.series_id = ? AND t.namespace = 'source' AND t.value = ? COLLATE NOCASE`
	);
	const anySourceTag = db.prepare(
		`SELECT 1 FROM series_tags st JOIN tags t ON t.id = st.tag_id
		WHERE st.series_id = ? AND t.namespace = 'source'`
	);
	const candidates = rowsIn(db, rootId, 'mihon:%').filter(
		(row) =>
			// The folder is this source's, and the title's under either name.
			(row.title === folder.title || folderTitleMatches(parts.dir, row.title)) &&
			(!!sourceTag.get(row.id, folder.source) ||
				// Untagged, from a backup that named no source: a series
				// tagged with another source is still not this folder's.
				(!anySourceTag.get(row.id) &&
					unnamedSourceIs(db, row.origin_key, parts.sourceDir, row.title === folder.title, () =>
						addressMatches(db, row.id, s.entries)
					)))
	);
	const best = bestOf(db, s, candidates);
	// No entry in common: not the same manga, whatever the names say.
	if (!best || best.matches.size === 0) return null;
	const own = seriesBy(db, s.originKey);
	if (own && own.id !== best.row.id) {
		// The named series has no folder of its own yet: take this one before the
		// entries move, so both sides name their files from it.
		if (best.row.path === '' && own.path !== '')
			db.prepare(`UPDATE series SET path = ? WHERE id = ?`).run(own.path, best.row.id);
		carryEdit(db, own.id, best.row.id, parts.dir);
		note(dropped, foldSeries(db, own.id, best.row.id));
	}
	rememberKey(db, best.row.id, s.originKey, 'mihon', best.row.origin_key, now);
	return best.row.id;
}

/**
 * The second signal for a URL series whose backup named no source
 * (doc/IMPORT-MIHON.md, "A backup that names no source"): its key holds the
 * source's number, and nothing in the backup says that number's name, so the
 * `source:` tag and a plan's download folder are both missing.
 *
 * - **The engine's own name for the number**, when tsundoku has the source
 *   installed (`engine_sources`): the folder is this source's when its source
 *   folder is that name, as "Matching downloads" reads a backup's. A name the
 *   engine gives that the folder is not is a no, whatever else matches.
 * - Otherwise **the chapter's own address under the exact title**: at least
 *   one chapter whose ComicInfo `Web` ends with the backup's chapter path (or
 *   the reverse), which is a source's own address for that chapter, not a
 *   number every source shares. A title and chapter numbers alone stay apart,
 *   as a folder whose chapters the backup does not share does.
 *
 * `addressed` is asked only when it decides, since it reads the entries.
 */
function unnamedSourceIs(
	db: Database.Database,
	urlKey: string,
	sourceDir: string,
	exactTitle: boolean,
	addressed: () => number
): boolean {
	const id = /^mihon:(\d+):/.exec(urlKey)?.[1];
	if (!id) return false;
	const named = db.prepare(`SELECT name FROM engine_sources WHERE id = ?`).get(id) as
		{ name: string } | undefined;
	if (named) return sourceDirMatches(sourceDir.toLowerCase(), named.name.toLowerCase());
	return exactTitle && addressed() > 0;
}

/**
 * How many of a series' entries match a plan's by address alone: the URL in
 * ComicInfo's `Web` against the backup's chapter path, either way round, the
 * first half of `matchFolderEntries`' rule without its fall back to numbers.
 */
function addressMatches(db: Database.Database, seriesId: number, planned: PlannedEntry[]): number {
	const urls = (
		db
			.prepare(`SELECT source_url FROM entries WHERE series_id = ? AND source_url != ''`)
			.all(seriesId) as { source_url: string }[]
	).map((r) => r.source_url);
	return urls.filter((url) =>
		planned.some(
			(e) =>
				e.sourceUrl !== '' &&
				(url === e.sourceUrl || url.endsWith(e.sourceUrl) || e.sourceUrl.endsWith(url))
		)
	).length;
}

/**
 * The one thing a fold cannot keep from both sides: title, kind and direction,
 * a novel's page direction (`text_direction`) with them, though that one
 * only when the folder's series chose one: NULL is 'never chosen', and
 * has nothing to carry over a survivor's R→L.
 * The folder's series wins them when the user renamed it, which is the state
 * that made the backup's row a second one -- it no longer answers to its
 * folder's name, so `adoptFolder` could not have found it by name either, and
 * the survivor would otherwise be the import's name over the user's. A
 * folder's series still named as its folder carries no edit, and the survivor
 * keeps its own (doc/IMPORT-MIHON.md, "Before the backup knows it").
 */
function carryEdit(db: Database.Database, from: number, into: number, dir: string): void {
	const own = db.prepare(`SELECT title FROM series WHERE id = ?`).get(from) as { title: string };
	if (folderTitleMatches(dir, own.title)) return;
	db.prepare(
		`UPDATE series SET
			title = (SELECT title FROM series WHERE id = @from),
			kind = (SELECT kind FROM series WHERE id = @from),
			direction = (SELECT direction FROM series WHERE id = @from),
			text_direction = COALESCE((SELECT text_direction FROM series WHERE id = @from), text_direction)
		WHERE id = @into`
	).run({ from, into });
}

function rowsIn(db: Database.Database, rootId: number, family: string): KeyedRow[] {
	return db
		.prepare(
			`SELECT id, origin_key, title, path, in_library, pruned_at FROM series
			WHERE root_id = ? AND origin_key LIKE ?`
		)
		.all(rootId, family) as KeyedRow[];
}

/** The candidate the plan shares most entries with: a folder can have been imported twice. */
function bestOf(
	db: Database.Database,
	s: PlannedSeries,
	candidates: KeyedRow[]
): { row: KeyedRow; matches: Map<number, PlannedEntry> } | null {
	let best: { row: KeyedRow; matches: Map<number, PlannedEntry> } | null = null;
	for (const row of candidates) {
		if (row.origin_key === s.originKey) continue;
		// A browsing record is never a series to adopt (doc/READING-ONLINE.md): it is a
		// series opened from a source's preview without ADD, which every shelf,
		// count, search and link leaves out and which pruneRecords forgets 30 days
		// after it was last opened. A library series folded into one would leave
		// the library and then lose its reading. `pruned_at` says a record was
		// forgotten already, which changes nothing: `in_library` alone decides.
		if (row.in_library !== 1) continue;
		const matches = matchFolderEntries(db, row.id, s.entries);
		if (
			!best ||
			matches.size > best.matches.size ||
			(matches.size === best.matches.size && row.id < best.row.id)
		)
			best = { row, matches };
	}
	return best;
}

/**
 * A series' entries and the plan's, by the same rule the disk match uses: the
 * URL in ComicInfo's `Web` against the backup's path (Weeb Central), then the
 * number, which both sides build into the label (`Ch. 98`). One matched
 * nothing is left out: it stays as it is, in the series.
 */
function matchFolderEntries(
	db: Database.Database,
	seriesId: number,
	planned: PlannedEntry[]
): Map<number, PlannedEntry> {
	const rows = db
		.prepare(`SELECT id, source_url, label FROM entries WHERE series_id = ?`)
		.all(seriesId) as { id: number; source_url: string; label: string }[];
	const holder = new Map(rows.filter((r) => r.source_url !== '').map((r) => [r.source_url, r.id]));
	const byLabel = new Map<string, PlannedEntry>();
	for (const e of planned) if (!byLabel.has(e.label)) byLabel.set(e.label, e);
	const taken = new Set<PlannedEntry>();
	const out = new Map<number, PlannedEntry>();
	for (const r of rows) {
		const url = r.source_url;
		let hit =
			url === ''
				? undefined
				: planned.find(
						(e) =>
							e.sourceUrl !== '' &&
							!taken.has(e) &&
							// another entry already answers to this address
							(holder.get(e.sourceUrl) ?? r.id) === r.id &&
							(url === e.sourceUrl || url.endsWith(e.sourceUrl) || e.sourceUrl.endsWith(url))
					);
		if (!hit) {
			const e = byLabel.get(r.label);
			if (e && !taken.has(e)) hit = e;
		}
		if (!hit) continue;
		taken.add(hit);
		out.set(r.id, hit);
	}
	return out;
}

/**
 * The key a series has just left joins every other one it has left (migration 58,
 * doc/MOVE.md): the device whose backup still names the manga, or whose
 * download is still keyed by its folder, finds this series rather than making
 * a twin. The key it now has is not also a former one.
 */
function rememberKey(
	db: Database.Database,
	seriesId: number,
	leftKey: string,
	source: string,
	currentKey: string,
	now: number
): void {
	db.prepare(
		`INSERT INTO series_former_keys (series_id, origin_key, source, left_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (series_id, origin_key) DO UPDATE SET source = excluded.source,
			left_at = excluded.left_at`
	).run(seriesId, leftKey, source, now);
	db.prepare(`DELETE FROM series_former_keys WHERE series_id = ? AND origin_key = ?`).run(
		seriesId,
		currentKey
	);
}

/** An entry that takes another address keeps the one it had (migration 58, doc/MOVE.md). */
function rekeyEntry(db: Database.Database, entryId: number, url: string, now: number): void {
	const was = (
		db.prepare(`SELECT source_url FROM entries WHERE id = ?`).get(entryId) as {
			source_url: string;
		}
	).source_url;
	if (was === url) return;
	if (was !== '')
		db.prepare(
			`INSERT INTO entry_former_urls (entry_id, former_url, left_at) VALUES (?, ?, ?)
			ON CONFLICT (entry_id, former_url) DO UPDATE SET left_at = excluded.left_at`
		).run(entryId, was, now);
	db.prepare(
		`UPDATE entries SET former_url = CASE WHEN source_url != '' THEN source_url ELSE former_url END,
			source_url = ?, origin_source = '' WHERE id = ?`
	).run(url, entryId);
	if (url !== '')
		db.prepare(`DELETE FROM entry_former_urls WHERE entry_id = ? AND former_url = ?`).run(
			entryId,
			url
		);
}

function seriesBy(db: Database.Database, key: string) {
	return db.prepare(`SELECT id, path, in_library FROM series WHERE origin_key = ?`).get(key) as
		{ id: number; path: string; in_library: number } | undefined;
}

/** The series' entries, matched to the plan's by URL suffix then by label (below). */
function rekeyEntries(
	db: Database.Database,
	seriesId: number,
	planned: PlannedEntry[],
	now: number
): void {
	for (const [entryId, e] of matchFolderEntries(db, seriesId, planned))
		rekeyEntry(db, entryId, e.sourceUrl, now);
}

type Row = {
	id: number;
	file: string;
	source_url: string;
	label: string;
	available: number;
	bytes: number;
	page_count: number;
	read_at: number | null;
	unread_at: number | null;
	last_opened_at: number | null;
	last_position: number | null;
	last_offset: number | null;
	rating: number;
	favourite: number;
};

/** Caches of a file's pages: moved only with the file they describe. */
const FILE_TABLES = new Set(['entry_pages', 'page_crops', 'page_hashes', 'page_text', 'not_text']);

/** Every table with a column of this name, the series and entries themselves aside. */
function tablesWith(db: Database.Database, column: string): string[] {
	return (
		db
			.prepare(
				`SELECT m.name FROM sqlite_master m JOIN pragma_table_info(m.name) p
				WHERE m.type = 'table' AND p.name = ? AND m.name NOT IN ('series', 'entries')`
			)
			.all(column) as { name: string }[]
	).map((r) => r.name);
}

/**
 * A Work a fold took a series out of: `from` was a part of it and
 * `into` a part of another, and a series is in one Work at most, so `from`'s
 * membership went with its row. `series` is the survivor's title, as the
 * library shows it after the fold; `ended` says the Work was left with one
 * series and so ended (migration 61's trigger). Named in the import's summary as
 * DROPPED FROM <WORK> (`droppedLine`), since the user's grouping cannot be
 * put back by the import, and kept on the job's row (`scan_jobs.dropped`,
 * migration 71) for the IMPORT LOG.
 *
 * Ids are not identities here: `works.id` and `series.id` are reused once the
 * newest row ends (no AUTOINCREMENT), so each is kept with the row's own
 * creation time, and the log trusts an id only while both still match
 * (`droppedOf`, log.ts).
 */
export type Dropped = {
	work: string;
	series: string;
	ended: boolean;
	/** The Work's id and `created_at`, for the log's link while it exists. */
	workId: number;
	workAt: number;
	/** The survivor's id and `added_at`, for the log's reveal rule. */
	seriesId: number;
	seriesAt: number;
};

const note = (into: Dropped[], d: Dropped | null) => {
	if (d) into.push(d);
};

/** The summary's line for one dropped membership. */
export const droppedLine = (d: Dropped) =>
	`DROPPED FROM ${d.work.toUpperCase()} · ${d.series}${d.ended ? ' · THE WORK ENDED' : ''}`;

/**
 * Fold series `from` into series `into`, then delete `from`. A chapter both
 * have (the same file, else the same URL, else the same label) is one: read
 * state moves forward as on a rescan, the newer place in it wins, a rating
 * or FAV fills in where `into` has none, and so does a novel's page direction
 * (`text_direction`: NULL is 'never chosen', which reads as L→R, and
 * a stored 'ltr' is a choice `into` keeps), and `into` takes the file if it had
 * none. A chapter only `from` has moves across. Everything else that hangs
 * off either -- reading log, shelves, tags, links, lookups -- joins `into`,
 * which keeps its own where both have one. A hidden series stays hidden,
 * and takes its Work with it (`setHiddenWhole`).
 *
 * Runs inside the writer's transaction, on `getDb()`'s connection, which is
 * the one `setHiddenWhole` writes through. Answers the Work `from` was
 * dropped from, when `into` was a part of another one (`Dropped`), else null.
 */
export function foldSeries(db: Database.Database, from: number, into: number): Dropped | null {
	const pathOf = (id: number) =>
		(db.prepare(`SELECT path FROM series WHERE id = ?`).get(id) as { path: string }).path;
	const entriesOf = (id: number) =>
		db.prepare(`SELECT * FROM entries WHERE series_id = ? ORDER BY position, id`).all(id) as Row[];
	const fromPath = pathOf(from);
	const abs = (path: string, r: Row) =>
		r.file === '' || path === '' ? '' : posix.join(path, r.file);

	const theirs = entriesOf(into);
	// A series with no folder of its own takes the one being folded in, so both
	// sides name their files from it (a series a backup names may have none yet).
	if (pathOf(into) === '' && fromPath !== '')
		db.prepare(`UPDATE series SET path = ? WHERE id = ?`).run(fromPath, into);
	const intoPath = pathOf(into);
	const byFile = new Map(theirs.filter((t) => abs(intoPath, t)).map((t) => [abs(intoPath, t), t]));
	const byUrl = new Map(theirs.filter((t) => t.source_url).map((t) => [t.source_url, t]));
	const byLabel = new Map(theirs.map((t) => [t.label, t]));
	const matched = new Set<number>();
	const pick = (t: Row | undefined) => (t && !matched.has(t.id) ? t : undefined);

	const entryTables = tablesWith(db, 'entry_id');
	const repoint = (fromEntry: number, intoEntry: number, withFile: boolean) => {
		for (const t of entryTables)
			if (withFile || !FILE_TABLES.has(t))
				db.prepare(`UPDATE OR IGNORE ${t} SET entry_id = ? WHERE entry_id = ?`).run(
					intoEntry,
					fromEntry
				);
	};

	for (const f of entriesOf(from)) {
		const file = abs(fromPath, f);
		const t =
			(file ? pick(byFile.get(file)) : undefined) ??
			(f.source_url ? pick(byUrl.get(f.source_url)) : undefined) ??
			pick(byLabel.get(f.label));
		if (!t) {
			// Only `from` has it: across, its file named from `into`'s folder.
			let name = '';
			if (file) {
				const path = widenTo(db, into, [file]);
				name = path === '' ? '' : fileIn(path, file);
			}
			db.prepare(`UPDATE entries SET series_id = ?, file = ? WHERE id = ?`).run(
				into,
				name || f.file,
				f.id
			);
			continue;
		}
		matched.add(t.id);
		const sameFile = file !== '' && file === abs(intoPath, t);
		const takesFile = !t.available && !!f.available && file !== '';
		if (takesFile) {
			const path = widenTo(db, into, [file]);
			db.prepare(
				`UPDATE entries SET available = 1, file = ?, bytes = ?, page_count = ? WHERE id = ?`
			).run(fileIn(path, file), f.bytes, f.page_count, t.id);
		}
		// Read state moves forward, as on a rescan (write.ts); unread by the
		// user since stays unread.
		if (
			f.read_at !== null &&
			t.read_at === null &&
			(t.unread_at === null || f.read_at > t.unread_at)
		)
			db.prepare(`UPDATE entries SET read_at = ? WHERE id = ?`).run(f.read_at, t.id);
		if (
			f.last_opened_at !== null &&
			(t.last_opened_at === null || f.last_opened_at > t.last_opened_at)
		)
			db.prepare(
				`UPDATE entries SET last_opened_at = ?, last_position = ?, last_offset = ? WHERE id = ?`
			).run(f.last_opened_at, f.last_position, f.last_offset, t.id);
		if (f.rating > 0 && t.rating === 0)
			db.prepare(`UPDATE entries SET rating = ? WHERE id = ?`).run(f.rating, t.id);
		if (f.favourite && !t.favourite)
			db.prepare(`UPDATE entries SET favourite = 1 WHERE id = ?`).run(t.id);
		repoint(f.id, t.id, sameFile || takesFile);
	}

	// Read before the row goes: hidden by its own flag, or by its root's.
	const fromHidden = hiddenNow(db, from);
	// And the Work each is a part of: two different ones mean `from`'s is lost.
	const workOf = db.prepare(
		`SELECT w.id, w.name, w.created_at AS at FROM work_series ws JOIN works w ON w.id = ws.work_id
		WHERE ws.series_id = ?`
	);
	type Lost = { id: number; name: string; at: number };
	const fromWork = workOf.get(from) as Lost | undefined;
	const intoWork = workOf.get(into) as Lost | undefined;
	const lost = fromWork && intoWork && fromWork.id !== intoWork.id ? fromWork : null;
	// `work_series` is one of these: `from`'s membership moves to `into` when
	// `into` is in no Work, and is dropped when it is in one (a series is in
	// one Work at most), the trigger ending a Work that leaves with one.
	for (const t of tablesWith(db, 'series_id'))
		db.prepare(`UPDATE OR IGNORE ${t} SET series_id = ? WHERE series_id = ?`).run(into, from);
	db.prepare(
		`UPDATE series SET
			rating = CASE WHEN rating = 0 THEN (SELECT rating FROM series WHERE id = @from) ELSE rating END,
			favourite = MAX(favourite, (SELECT favourite FROM series WHERE id = @from)),
			text_direction = COALESCE(text_direction, (SELECT text_direction FROM series WHERE id = @from))
		WHERE id = @into`
	).run({ from, into });
	db.prepare(`DELETE FROM series WHERE id = ?`).run(from);
	// A hidden series stays hidden, and a Work is hidden or shown whole
	// (doc/WORKS.md, "The one rule"): so when either side was hidden, `into`
	// is hidden through the rule's own write, taking any Work it is a part of
	// with it. Merging the flag by hand left a hidden part in a visible
	// Work -- `into` a part and `from` hidden, or `from` a visible part whose
	// Work `into` joined hidden -- the half-hidden Work no other path makes.
	// Never the other way: a fold never shows anything.
	if (fromHidden || hiddenNow(db, into)) setHiddenWhole([into], true);
	if (!lost) return null;
	const survivor = db.prepare(`SELECT title, added_at FROM series WHERE id = ?`).get(into) as {
		title: string;
		added_at: number;
	};
	const ended = !db.prepare(`SELECT 1 FROM works WHERE id = ?`).get(lost.id);
	return {
		work: lost.name,
		series: survivor.title,
		ended,
		workId: lost.id,
		workAt: lost.at,
		seriesId: into,
		seriesAt: survivor.added_at
	};
}

/** Whether SQL's rule reads this series as hidden: its own flag, or its root's. */
function hiddenNow(db: Database.Database, id: number): boolean {
	const row = db
		.prepare(
			`SELECT ${HIDDEN_SQL} AS hidden FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ?`
		)
		.get(id) as { hidden: number } | undefined;
	return (row?.hidden ?? 0) !== 0;
}
