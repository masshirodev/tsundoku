import type Database from 'better-sqlite3';
import { posix } from './fspath.ts';
import { commonDir, fileIn, isUnder, widenTo } from './paths.ts';
import { dataPaths } from './data-dirs.ts';
import { libraryWhere } from './visibility.ts';
import { getDb } from './db.ts';
import { hueFor } from '../library/cover.ts';
import { setKey, suggestionSets, type Candidate, type Suggestion } from '../library/books.ts';
import type { Rating } from '../library/types.ts';
import { kindFacts, kindsGrouped, type Kind } from '../library/kinds.ts';
import { keyFamily, parseKey } from '../library/downloads.ts';
import { resequenceAnime, seasonFacts } from './season-facts.ts';

const { dirname, join, relative, basename } = posix;

/**
 * Grouping books into series and taking them out again (doc/BOOKS.md).
 *
 * A singleton is a doujin series holding one book. Its rating, favourite and
 * tags live on the series, where the library and series screens read them.
 * Inside a series of books they live on each book. Grouping moves them from
 * the singleton to its book; taking out moves them back. So nothing a book
 * carries is ever merged, averaged or lost, and the move is reversible.
 *
 * Every move also re-homes the book's reading-log rows. They reference the
 * series, and deleting the emptied singleton would otherwise cascade them
 * away -- losing exactly the history the log exists to keep.
 */

type SeriesRow = {
	id: number;
	root_id: number;
	title: string;
	kind: Kind;
	rating: number;
	favourite: number;
	hidden: number;
	source: string;
	added_at: number;
};

/**
 * What GROUP may bind a series into, by its kind's `grouping` (doc/KINDS.md;
 * card c303): single books into a series of books (a doujin's), or EPUB
 * volumes into one novel. Never by the kind's name.
 */
const bindsBooks = (s: Pick<SeriesRow, 'kind'>) => kindFacts(s.kind).grouping === 'books';
const bindsVolumes = (s: Pick<SeriesRow, 'kind'>) => kindFacts(s.kind).grouping === 'volumes';
/** The same, as SQL: `s.kind IN (…)` over the kinds the registry says (a literal list, never input). */
const kindsIn = (grouping: 'books' | 'volumes') =>
	`s.kind IN (${kindsGrouped(grouping)
		.map((k) => `'${k}'`)
		.join(', ')})`;

function seriesRow(db: Database.Database, id: number): SeriesRow | undefined {
	return db
		.prepare(
			`SELECT id, root_id, title, kind, COALESCE(rating, 0) AS rating, favourite, hidden, source, added_at
			FROM series WHERE id = ?`
		)
		.get(id) as SeriesRow | undefined;
}

function entryIdsOf(db: Database.Database, seriesId: number): number[] {
	return (
		(
			db
				// An edition isn't a book of the series (doc/EDITIONS.md): it's its base's.
				.prepare(
					`SELECT id FROM entries WHERE series_id = ? AND edition_of IS NULL ORDER BY position, id`
				)
				.all(seriesId) as {
				id: number;
			}[]
		).map((r) => r.id)
	);
}

export class GroupingError extends Error {}

/**
 * Books from different sources can share a series -- the same work is often in
 * both Mihon's local source and Hentoid -- as long as they're alike: all hidden
 * or all visible. A series can't straddle a hidden source and a visible one,
 * or a hidden book would show in a visible series. Where the files are is no
 * obstacle: a series' path widens to hold them (src/lib/server/paths.ts).
 */
function alike(db: Database.Database, rootIds: number[]): boolean {
	const hidden = new Set(
		rootIds.map(
			(id) =>
				(db.prepare(`SELECT hidden FROM roots WHERE id = ?`).get(id) as { hidden: number }).hidden
		)
	);
	return hidden.size <= 1;
}

const MIXED = "hidden and visible books can't share a series";

/**
 * A book of its series, as SQL over an entries alias (c558; doc/FILTERS.md,
 * FORM): not shadowed -- an edition folded into its base, or a duplicate the
 * review set aside -- and not front or back matter, an extra. An extra
 * doesn't make a series (the owner, 2026-11-05), so a book and its extra are
 * one book. The library card's `entryCount` counts the same rows, which is
 * how the device's `isOneOff` agrees with the server.
 */
export const isBookSql = (e: string) => `(${e}.shadowed = 0 AND ${e}.matter = '')`;

/**
 * ONE-OFF (FILTER's FORM, and the `oneoff` shelf it replaced): a series of a
 * kind GROUP binds into a series of books (the registry's `grouping`, never a
 * kind's name), holding one book or none (`isBookSql`). SERIES is everything
 * else. The device's `isOneOff` (src/lib/library/filters.ts) and
 * `isSingleton` below ask the same two questions (c558).
 */
export const ONE_OFF_SQL = `(${kindsIn('books')} AND (SELECT COUNT(*) FROM entries e
	WHERE e.series_id = s.id AND ${isBookSql('e')}) <= 1)`;

/** How many books a series holds, as `isBookSql` counts them. */
function bookCount(db: Database.Database, seriesId: number): number {
	return (
		db
			.prepare(`SELECT COUNT(*) AS n FROM entries e WHERE e.series_id = ? AND ${isBookSql('e')}`)
			.get(seriesId) as { n: number }
	).n;
}

/**
 * A series that is one book, ONE-OFF's rule with exactly one (c558): a kind
 * that binds into a series of books, and one book, extras and editions left
 * out. Grouping it is a further question (`groupIntoSeries`): only a book
 * with nothing beside it can be moved whole today.
 */
export function isSingleton(seriesId: number): boolean {
	const db = getDb();
	const s = seriesRow(db, seriesId);
	return !!s && bindsBooks(s) && bookCount(db, seriesId) === 1;
}

// ---- a book's own origin (rung 76; card c885; doc/BOOKS.md) ---------------------------------

/**
 * A series about to go keeps its key on its entries, with what the engine
 * called it: its row is the only copy, and `series.origin_key` names one series
 * at a source where a group is several. `OR IGNORE`: a book that already holds
 * its own key keeps it, whatever the series around it held.
 */
function keepOrigin(db: Database.Database, series: SeriesRow, entryIds: number[]) {
	const { origin_key: key } = db
		.prepare(`SELECT origin_key FROM series WHERE id = ?`)
		.get(series.id) as { origin_key: string | null };
	if (!key) return;
	const engine = db
		.prepare(`SELECT engine_url, title, resolved_at FROM engine_series WHERE series_id = ?`)
		.get(series.id) as
		{ engine_url: string; title: string; resolved_at: number | null } | undefined;
	const put = db.prepare(
		`INSERT OR IGNORE INTO entry_origins (entry_id, origin_key, source_title, engine_url, engine_title, resolved_at)
		VALUES (?, ?, ?, ?, ?, ?)`
	);
	for (const id of entryIds)
		put.run(
			id,
			key,
			series.title,
			engine?.engine_url ?? null,
			engine?.title ?? null,
			engine?.resolved_at ?? null
		);
}

/**
 * Give a book back the key it kept, as the series' own, and the engine's row
 * with it. Before its entries move: a highlight takes the key of the series
 * its entry moves into (rung 72's trigger). A key something else now holds
 * stays on the book, which still reads and downloads by it.
 */
function giveOriginBack(db: Database.Database, seriesId: number, entryIds: number[]) {
	const rows = db
		.prepare(
			`SELECT origin_key, engine_url, engine_title, source_title, resolved_at FROM entry_origins
			WHERE entry_id IN (${entryIds.map(() => '?').join(',')})`
		)
		.all(...entryIds) as {
		origin_key: string;
		engine_url: string | null;
		engine_title: string | null;
		source_title: string;
		resolved_at: number | null;
	}[];
	// Every entry of a volume holds its novel's key; one that doesn't is no one key.
	if (rows.length !== entryIds.length || new Set(rows.map((r) => r.origin_key)).size !== 1) return;
	const [o] = rows;
	const held = db
		.prepare(
			`SELECT 1 FROM series WHERE origin_key = @key AND id != @series
			UNION ALL SELECT 1 FROM series_season_facts WHERE origin_key = @key
			UNION ALL SELECT 1 FROM entry_origins WHERE origin_key = @key
				AND entry_id NOT IN (${entryIds.join(',')})`
		)
		.get({ key: o.origin_key, series: seriesId });
	if (held) return;
	db.prepare(`UPDATE series SET origin_key = ? WHERE id = ?`).run(o.origin_key, seriesId);
	const key = parseKey(o.origin_key);
	if (key && o.engine_url !== null)
		db.prepare(
			`INSERT OR REPLACE INTO engine_series (series_id, source_id, engine_url, title, resolved_at)
			VALUES (?, ?, ?, ?, ?)`
		).run(seriesId, key.sourceId, o.engine_url, o.engine_title ?? o.source_title, o.resolved_at);
	db.prepare(
		`DELETE FROM entry_origins WHERE entry_id IN (${entryIds.map(() => '?').join(',')})`
	).run(...entryIds);
}

/** A Mihon source's key: the only family whose download a device folder brings back. */
function holdsSourceKey(db: Database.Database, s: SeriesRow, entryId: number): boolean {
	return !!db
		.prepare(
			`SELECT 1 FROM series WHERE id = ? AND origin_key GLOB 'mihon:*'
			UNION ALL SELECT 1 FROM entry_origins WHERE entry_id = ? AND origin_key GLOB 'mihon:*'`
		)
		.get(s.id, entryId);
}

/**
 * A series holding books from a source is named from its root or above. The
 * importer writes each download through the series its key finds, and with a
 * path of none, or one inside the device's folder, it would take that one
 * book's folder for the series' and mark every other book's file gone
 * (import/write.ts, `shared`): a path outside the device folder is what makes
 * it name this book's file from there and answer for this folder alone.
 *
 * A root can be that folder itself: a scan makes the Mihon root at
 * `<library>/devices/<device>/Mihon` when no other exists (import/index.ts,
 * `rootOf`), and ADD then uses it. Such a root names nothing outside the
 * devices, so the library's own folder stands in for it.
 */
function nameFromRoot(db: Database.Database, seriesId: number) {
	const { path, root } = db
		.prepare(
			`SELECT s.path, r.path AS root FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ?`
		)
		.get(seriesId) as { path: string; root: string };
	const { library } = dataPaths();
	const home = isUnder(root, join(library, 'devices')) ? library : root;
	if (path === '') db.prepare(`UPDATE series SET path = ? WHERE id = ?`).run(home, seriesId);
	else widenTo(db, seriesId, [join(home, 'book')]);
}

/**
 * A queued download goes where its entry goes. `download_queue.series_id` is
 * what the queue's readers join to find the series, and it cascades: left
 * behind, it names the wrong series, or the row goes with the series it names.
 * Before the old series can be deleted.
 */
function carryQueued(db: Database.Database, target: number, entryIds: number[]) {
	const set = db.prepare(`UPDATE download_queue SET series_id = ? WHERE entry_id = ?`);
	for (const id of entryIds) set.run(target, id);
}

/**
 * Move one singleton's book into `target` at `position`: its rating, favourite
 * and tags go onto the book, its title becomes the book's own, its key keeps
 * it at its source, its log rows follow it, and the emptied singleton is
 * deleted.
 */
function absorb(db: Database.Database, singleton: SeriesRow, target: number, position: number) {
	const [entryId] = entryIdsOf(db, singleton.id);
	keepOrigin(db, singleton, [entryId]);
	rehome(db, entryId, singleton.id, target);
	db.prepare(
		`UPDATE entries SET series_id = ?, position = ?,
			title = CASE WHEN title = '' THEN ? ELSE title END,
			rating = ?, favourite = ?
		WHERE id = ?`
	).run(target, position, singleton.title, singleton.rating, singleton.favourite, entryId);
	carryQueued(db, target, [entryId]);
	db.prepare(
		`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?, tag_id FROM series_tags WHERE series_id = ?`
	).run(entryId, singleton.id);
	db.prepare(
		`INSERT OR IGNORE INTO series_tags (series_id, tag_id) SELECT ?, tag_id FROM series_tags WHERE series_id = ?`
	).run(target, singleton.id);
	db.prepare(
		`INSERT OR IGNORE INTO collection_series (collection_id, series_id)
		SELECT collection_id, ? FROM collection_series WHERE series_id = ?`
	).run(target, singleton.id);
	db.prepare(`UPDATE reading_events SET series_id = ? WHERE entry_id = ?`).run(target, entryId);
	db.prepare(`UPDATE reading_events SET series_id = ? WHERE series_id = ?`).run(
		target,
		singleton.id
	);
	db.prepare(`DELETE FROM series WHERE id = ?`).run(singleton.id);
	return entryId;
}

/**
 * An entry's file named from the series it's moving to, whose path widens if
 * it doesn't already hold it: books from two folders, or two devices, keep
 * pointing at their files (src/lib/server/paths.ts).
 */
function rehome(db: Database.Database, entryId: number, from: number, to: number) {
	const e = db.prepare(`SELECT file FROM entries WHERE id = ?`).get(entryId) as { file: string };
	const fromPath = pathOf(db, from);
	if (e.file === '' || fromPath === '') return;
	const abs = join(fromPath, e.file);
	const toPath = widenTo(db, to, [abs]);
	db.prepare(`UPDATE entries SET file = ? WHERE id = ?`).run(fileIn(toPath, abs), entryId);
}

export type GroupResult = {
	seriesId: number;
	entryIds: number[];
	/** Volumes of a novel: the first entry of each volume moved. */
	volumes?: number[];
};

/**
 * Group singletons, in the given order, into a new series named `name` or
 * onto the end of an existing series of books. All must be doujin
 * singletons in the same root: a series cannot straddle a hidden root and a
 * visible one.
 */
export function groupIntoSeries(opts: {
	seriesIds: number[];
	name?: string;
	into?: number;
	now?: number;
}): GroupResult {
	const db = getDb();
	const now = opts.now ?? Date.now();
	return db
		.transaction((): GroupResult => {
			const rows = opts.seriesIds.map((id) => seriesRow(db, id));
			if (rows.some((r) => !r)) throw new GroupingError('a book no longer exists');
			const singles = rows as SeriesRow[];
			if (singles.length > 0 && singles.every(bindsVolumes))
				return groupVolumes(db, singles, opts, now);
			for (const s of singles) {
				if (!bindsBooks(s) || bookCount(db, s.id) !== 1) {
					throw new GroupingError(`"${s.title}" is not a single book`);
				}
				// A single book with an extra or a duplicate beside it is still
				// one book (c558), but `absorb` moves the book alone, and deleting
				// the emptied singleton would take what is left with it. So it
				// refuses, rather than lose the extra; binding a book's extras
				// along with it is a change of its own.
				if (entryIdsOf(db, s.id).length !== 1) {
					throw new GroupingError(
						`"${s.title}" holds an extra or a duplicate beside its book, which grouping can't carry`
					);
				}
			}
			let target: number;
			let next: number;
			if (opts.into != null) {
				const t = seriesRow(db, opts.into);
				if (!t || !bindsBooks(t)) throw new GroupingError('no such series of books');
				if (!alike(db, [t.root_id, ...singles.map((s) => s.root_id)])) {
					throw new GroupingError(MIXED);
				}
				target = t.id;
				next =
					(
						db
							.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM entries WHERE series_id = ?`)
							.get(target) as {
							p: number;
						}
					).p + 1;
			} else {
				if (singles.length < 2) throw new GroupingError('a series needs at least two books');
				const name = (opts.name ?? '').trim();
				if (name === '') throw new GroupingError('a series needs a name');
				const root = singles[0].root_id;
				if (
					!alike(
						db,
						singles.map((s) => s.root_id)
					)
				) {
					throw new GroupingError(MIXED);
				}
				// Books name their own folders relative to the series path, and an
				// importer's books all share one (Hentoid's is its root), so the new
				// series takes it; books with different paths fall back to the root's.
				const paths = new Set(
					singles.map(
						(s) =>
							(db.prepare(`SELECT path FROM series WHERE id = ?`).get(s.id) as { path: string })
								.path
					)
				);
				const path =
					paths.size === 1
						? [...paths][0]
						: (db.prepare(`SELECT path FROM roots WHERE id = ?`).get(root) as { path: string })
								.path;
				target = Number(
					db
						.prepare(
							`INSERT INTO series (root_id, title, kind, rating, favourite, hidden, public, hue, added_at, indexed_at, source, path)
							VALUES (?, ?, 'doujin', 0, 0, ?, ?, ?, ?, ?, ?, ?)`
						)
						.run(
							root,
							name,
							Math.max(...singles.map((s) => s.hidden)),
							// Public only if every book was: grouping never shows a hidden one.
							Math.min(
								...singles.map(
									(s) =>
										(
											db.prepare(`SELECT public FROM series WHERE id = ?`).get(s.id) as {
												public: number;
											}
										).public
								)
							),
							hueFor(name),
							Math.min(...singles.map((s) => s.added_at)),
							now,
							singles.every((s) => s.source === singles[0].source) ? singles[0].source : '',
							path
						).lastInsertRowid
				);
				next = 1;
			}
			if (singles.some((s) => holdsSourceKey(db, s, entryIdsOf(db, s.id)[0])))
				nameFromRoot(db, target);
			const entryIds = singles.map((s, i) => absorb(db, s, target, next + i));
			return { seriesId: target, entryIds };
		})
		.immediate();
}

// ---- volumes of a novel -------------------------------------------------------

/**
 * Volumes of a novel (doc/BOOKS.md): each EPUB imports as a series of its
 * own, and grouping puts them in one. A volume is every entry from one file;
 * `entries.volume` keeps its book's title for CONTENTS' headings and for
 * UNGROUP. Entry files are relative to the series' path, so the grouped
 * series takes the folder the volumes share and each file is re-expressed
 * from there.
 */

type VolumeEntry = {
	id: number;
	file: string;
	volume: string;
	source_url: string;
	locator: string;
};

function volumeEntries(db: Database.Database, seriesId: number): VolumeEntry[] {
	return db
		.prepare(
			`SELECT id, file, volume, source_url, locator FROM entries WHERE series_id = ? ORDER BY position, id`
		)
		.all(seriesId) as VolumeEntry[];
}

/** A series' volumes in reading order: its entries, one run per file. */
export function volumesOf<E extends { file: string }>(entries: E[]): E[][] {
	const out: E[][] = [];
	const at = new Map<string, E[]>();
	for (const e of entries) {
		let v = at.get(e.file);
		if (!v) {
			v = [];
			at.set(e.file, v);
			out.push(v);
		}
		v.push(e);
	}
	return out;
}

/** The first of these series' own page directions, in their order, or NULL (c551). */
function textDirectionAmong(db: Database.Database, ids: number[]): string | null {
	const get = db.prepare(`SELECT text_direction FROM series WHERE id = ?`);
	for (const id of ids) {
		const own = (get.get(id) as { text_direction: string | null } | undefined)?.text_direction;
		if (own != null) return own;
	}
	return null;
}

function pathOf(db: Database.Database, seriesId: number): string {
	return (db.prepare(`SELECT path FROM series WHERE id = ?`).get(seriesId) as { path: string })
		.path;
}

function groupVolumes(
	db: Database.Database,
	books: SeriesRow[],
	opts: { name?: string; into?: number },
	now: number
): GroupResult {
	const root = books[0].root_id;
	if (
		!alike(
			db,
			books.map((b) => b.root_id)
		)
	)
		throw new GroupingError(MIXED);
	let target: SeriesRow;
	if (opts.into != null) {
		const t = seriesRow(db, opts.into);
		if (!t || !bindsVolumes(t)) throw new GroupingError('no such novel');
		if (!alike(db, [t.root_id, root])) throw new GroupingError(MIXED);
		if (books.some((b) => b.id === t.id)) throw new GroupingError('a series cannot join itself');
		target = t;
	} else {
		if (books.length < 2) throw new GroupingError('a series needs at least two volumes');
		const name = (opts.name ?? '').trim();
		if (name === '') throw new GroupingError('a series needs a name');
		const paths = books.map((b) => pathOf(db, b.id));
		const path =
			commonDir(paths) ||
			(db.prepare(`SELECT path FROM roots WHERE id = ?`).get(root) as { path: string }).path;
		const first = db
			.prepare(`SELECT direction, description FROM series WHERE id = ?`)
			.get(books[0].id) as { direction: string | null; description: string };
		// The page direction (c551; series.text_direction, rung 69) rides with the
		// layout: the first volume's own, else the first that has one. NULL is the
		// default L→R, and 'rtl' its only stored value, so a novel any volume of
		// which was set to R→L stays R→L once its volumes are one series.
		const text = textDirectionAmong(
			db,
			books.map((b) => b.id)
		);
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, rating, favourite, hidden, public, hue, added_at,
						indexed_at, source, path, direction, description, text_direction)
					VALUES (?, ?, 'novel', ?, ?, ?, ?, ?, ?, ?, 'epub', ?, ?, ?, ?)`
				)
				.run(
					root,
					name,
					Math.max(...books.map((b) => b.rating)),
					Math.max(...books.map((b) => b.favourite)),
					Math.max(...books.map((b) => b.hidden)),
					// Public only if every volume was: grouping never shows a hidden one.
					Math.min(
						...books.map(
							(b) =>
								(
									db.prepare(`SELECT public FROM series WHERE id = ?`).get(b.id) as {
										public: number;
									}
								).public
						)
					),
					hueFor(name),
					Math.min(...books.map((b) => b.added_at)),
					now,
					path,
					first.direction,
					first.description,
					text
				).lastInsertRowid
		);
		target = seriesRow(db, id)!;
	}
	const targetPath = pathOf(db, target.id);
	// A series joined as it was: its entries until now name no volume, so
	// they're one volume under its own title.
	db.prepare(`UPDATE entries SET volume = ? WHERE series_id = ? AND volume = ''`).run(
		target.title,
		target.id
	);
	let next =
		(
			db
				.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM entries WHERE series_id = ?`)
				.get(target.id) as { p: number }
		).p + 1;
	const moved: number[] = [];
	const firsts: number[] = [];
	const move = db.prepare(
		`UPDATE entries SET series_id = ?, position = ?, file = ?, volume = ? WHERE id = ?`
	);
	for (const b of books) {
		const from = pathOf(db, b.id);
		const entries = volumeEntries(db, b.id);
		for (const vol of volumesOf(entries)) firsts.push(vol[0].id);
		// A source's novel keeps its key; an EPUB's is its file, rebuilt from there.
		const { origin_key: key } = db
			.prepare(`SELECT origin_key FROM series WHERE id = ?`)
			.get(b.id) as { origin_key: string | null };
		if (keyFamily(key))
			keepOrigin(
				db,
				b,
				entries.map((e) => e.id)
			);
		for (const e of entries) {
			move.run(
				target.id,
				next++,
				relative(targetPath, join(from, e.file)),
				e.volume || b.title,
				e.id
			);
			carryQueued(db, target.id, [e.id]);
			moved.push(e.id);
		}
		db.prepare(
			`INSERT OR IGNORE INTO series_tags (series_id, tag_id) SELECT ?, tag_id FROM series_tags WHERE series_id = ?`
		).run(target.id, b.id);
		db.prepare(
			`INSERT OR IGNORE INTO collection_series (collection_id, series_id)
			SELECT collection_id, ? FROM collection_series WHERE series_id = ?`
		).run(target.id, b.id);
		db.prepare(`UPDATE reading_events SET series_id = ? WHERE series_id = ?`).run(target.id, b.id);
		db.prepare(`DELETE FROM series WHERE id = ?`).run(b.id);
	}
	// A new cover is made from the first volume at the next refresh.
	db.prepare(`UPDATE series SET cover_key = '', cover_at = NULL WHERE id = ?`).run(target.id);
	return { seriesId: target.id, entryIds: moved, volumes: firsts };
}

/**
 * Take volumes out of a series of volumes, each back into a series of its
 * own under its book's title, found by its file again at the next scan. The
 * series' rating, FAV, tags and shelves go with each; progress is on the
 * entries and moves with them. `files` defaults to every volume.
 */
export function takeOutVolumes(seriesId: number, files?: string[], now = Date.now()): number[] {
	const db = getDb();
	return db
		.transaction((): number[] => {
			const series = seriesRow(db, seriesId);
			if (!series || !bindsVolumes(series)) throw new GroupingError('no such novel');
			const path = pathOf(db, seriesId);
			const extra = db
				.prepare(`SELECT public, direction, description, text_direction FROM series WHERE id = ?`)
				.get(seriesId) as {
				public: number;
				direction: string | null;
				description: string;
				text_direction: string | null;
			};
			const created: number[] = [];
			for (const vol of volumesOf(volumeEntries(db, seriesId))) {
				if (files && !files.includes(vol[0].file)) continue;
				const abs = join(path, vol[0].file);
				const title = vol[0].volume || series.title;
				const at = vol[0].source_url.lastIndexOf(`!${vol[0].locator}`);
				const origin =
					vol[0].source_url.startsWith('epub:') && at > 0 ? vol[0].source_url.slice(0, at) : null;
				const volIds = vol.map((e) => e.id);
				const single = Number(
					db
						.prepare(
							`INSERT INTO series (root_id, title, kind, rating, favourite, hidden, public, hue, added_at,
								indexed_at, source, path, direction, description, text_direction, origin_key)
							VALUES (?, ?, 'novel', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
						)
						.run(
							series.root_id,
							title,
							series.rating,
							series.favourite,
							series.hidden,
							extra.public,
							hueFor(title),
							// When the volume itself arrived, so ADDED sorts it where it was.
							(
								db
									.prepare(
										`SELECT MIN(added_at) AS at FROM entries WHERE id IN (${vol.map((e) => e.id).join(',')})`
									)
									.get() as { at: number | null }
							).at ?? series.added_at,
							now,
							series.source,
							dirname(abs),
							extra.direction,
							extra.description,
							// Each volume taken out reads as its series did (c551).
							extra.text_direction,
							// Its own again: the next scan finds it by its file.
							origin && !db.prepare(`SELECT 1 FROM series WHERE origin_key = ?`).get(origin)
								? origin
								: null
						).lastInsertRowid
				);
				giveOriginBack(db, single, volIds);
				const set = db.prepare(
					`UPDATE entries SET series_id = ?, position = ?, file = ?, volume = '' WHERE id = ?`
				);
				vol.forEach((e, i) => set.run(single, i + 1, basename(abs), e.id));
				carryQueued(db, single, volIds);
				db.prepare(
					`INSERT OR IGNORE INTO series_tags (series_id, tag_id) SELECT ?, tag_id FROM series_tags WHERE series_id = ?`
				).run(single, seriesId);
				db.prepare(
					`INSERT OR IGNORE INTO collection_series (collection_id, series_id)
					SELECT collection_id, ? FROM collection_series WHERE series_id = ?`
				).run(single, seriesId);
				const move = db.prepare(`UPDATE reading_events SET series_id = ? WHERE entry_id = ?`);
				for (const e of vol) move.run(single, e.id);
				created.push(single);
			}
			const left = volumesOf(volumeEntries(db, seriesId));
			if (left.length === 0) db.prepare(`DELETE FROM series WHERE id = ?`).run(seriesId);
			else {
				renumber(db, seriesId);
				// One volume left is a book again, not a volume of one.
				if (left.length === 1)
					db.prepare(`UPDATE entries SET volume = '' WHERE series_id = ?`).run(seriesId);
			}
			return created;
		})
		.immediate();
}

/**
 * Take books out of a series, each back into a singleton of its own with its
 * rating, favourite, tags, progress and log rows. The series keeps the rest;
 * one emptied completely is deleted.
 */
export function takeOut(seriesId: number, entryIds: number[], now = Date.now()): number[] {
	const db = getDb();
	return db
		.transaction((): number[] => {
			const series = seriesRow(db, seriesId);
			if (!series) throw new GroupingError('no such series');
			const created: number[] = [];
			for (const entryId of entryIds) {
				const e = db
					.prepare(
						`SELECT id, title, rating, favourite, added_at FROM entries WHERE id = ? AND series_id = ?`
					)
					.get(entryId, seriesId) as
					| { id: number; title: string; rating: number; favourite: number; added_at: number }
					| undefined;
				if (!e) continue;
				const title = e.title || series.title;
				const single = Number(
					db
						.prepare(
							`INSERT INTO series (root_id, title, kind, rating, favourite, hidden, public, hue, added_at, indexed_at, source, path)
							VALUES (?, ?, 'doujin', ?, ?, ?, (SELECT public FROM series WHERE id = ?), ?, ?, ?, ?, (SELECT path FROM series WHERE id = ?))`
						)
						.run(
							series.root_id,
							title,
							e.rating,
							e.favourite,
							series.hidden,
							seriesId,
							hueFor(title),
							e.added_at,
							now,
							series.source,
							seriesId
						).lastInsertRowid
				);
				giveOriginBack(db, single, [e.id]);
				db.prepare(
					`UPDATE entries SET series_id = ?, position = 1, rating = 0, favourite = 0 WHERE id = ?`
				).run(single, e.id);
				carryQueued(db, single, [e.id]);
				// The book's own tags become the singleton's. A book grouped before it
				// had any of its own takes the series' tags instead of none.
				const own = db
					.prepare(`SELECT COUNT(*) AS n FROM entry_tags WHERE entry_id = ?`)
					.get(e.id) as { n: number };
				if (own.n > 0) {
					db.prepare(
						`INSERT OR IGNORE INTO series_tags (series_id, tag_id) SELECT ?, tag_id FROM entry_tags WHERE entry_id = ?`
					).run(single, e.id);
				} else {
					db.prepare(
						`INSERT OR IGNORE INTO series_tags (series_id, tag_id) SELECT ?, tag_id FROM series_tags WHERE series_id = ?`
					).run(single, seriesId);
				}
				db.prepare(`UPDATE reading_events SET series_id = ? WHERE entry_id = ?`).run(single, e.id);
				created.push(single);
			}
			if (entryIdsOf(db, seriesId).length === 0)
				db.prepare(`DELETE FROM series WHERE id = ?`).run(seriesId);
			else renumber(db, seriesId);
			return created;
		})
		.immediate();
}

/** Close gaps in a series' positions after a book left it. */
function renumber(db: Database.Database, seriesId: number) {
	const ids = entryIdsOf(db, seriesId);
	const set = db.prepare(`UPDATE entries SET position = ? WHERE id = ?`);
	ids.forEach((id, i) => set.run(i + 1, id));
}

/** Set the reading order of a series' books. Ids not in the series are ignored. */
export function reorderBooks(seriesId: number, orderedEntryIds: number[]): void {
	const db = getDb();
	db.transaction(() => {
		const current = entryIdsOf(db, seriesId);
		const wanted = orderedEntryIds.filter((id) => current.includes(id));
		// Anything the caller left out keeps its relative place at the end.
		const order = [...wanted, ...current.filter((id) => !wanted.includes(id))];
		const set = db.prepare(`UPDATE entries SET position = ? WHERE id = ? AND series_id = ?`);
		order.forEach((id, i) => set.run(i + 1, id, seriesId));
	}).immediate();
}

/** Move one book from its series into another series of books. */
export function moveBook(fromSeries: number, entryId: number, toSeries: number): void {
	const db = getDb();
	db.transaction(() => {
		const to = seriesRow(db, toSeries);
		const from = seriesRow(db, fromSeries);
		if (!to || !from || !bindsBooks(to)) throw new GroupingError('no such series of books');
		if (!alike(db, [to.root_id, from.root_id])) throw new GroupingError(MIXED);
		const owned = db
			.prepare(`SELECT 1 FROM entries WHERE id = ? AND series_id = ?`)
			.get(entryId, fromSeries);
		if (!owned) throw new GroupingError('that book is not in this series');
		const next =
			(
				db
					.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM entries WHERE series_id = ?`)
					.get(toSeries) as {
					p: number;
				}
			).p + 1;
		// The last book of its series, which goes with it: keeps its key. A book
		// leaving a series that stays is one chapter of that series' key, which
		// the series keeps; that key has one holder.
		if (entryIdsOf(db, fromSeries).length === 1) keepOrigin(db, from, [entryId]);
		if (holdsSourceKey(db, from, entryId)) nameFromRoot(db, toSeries);
		rehome(db, entryId, fromSeries, toSeries);
		db.prepare(`UPDATE entries SET series_id = ?, position = ? WHERE id = ?`).run(
			toSeries,
			next,
			entryId
		);
		carryQueued(db, toSeries, [entryId]);
		db.prepare(
			`INSERT OR IGNORE INTO series_tags (series_id, tag_id) SELECT ?, tag_id FROM entry_tags WHERE entry_id = ?`
		).run(toSeries, entryId);
		db.prepare(`UPDATE reading_events SET series_id = ? WHERE entry_id = ?`).run(toSeries, entryId);
		if (entryIdsOf(db, fromSeries).length === 0)
			db.prepare(`DELETE FROM series WHERE id = ?`).run(fromSeries);
		else renumber(db, fromSeries);
	}).immediate();
}

export function setBookRating(seriesId: number, entryId: number, rating: Rating): number {
	return getDb()
		.prepare(`UPDATE entries SET rating = ? WHERE id = ? AND series_id = ?`)
		.run(rating, entryId, seriesId).changes;
}

export function setBookFavourite(seriesId: number, entryId: number, on: boolean): number {
	return getDb()
		.prepare(`UPDATE entries SET favourite = ? WHERE id = ? AND series_id = ?`)
		.run(on ? 1 : 0, entryId, seriesId).changes;
}

// ---- suggestions -------------------------------------------------------------

/**
 * Visible one-book series: the only things a suggestion may name. One book
 * as ONE-OFF counts it (`isBookSql`, c558), and nothing beside it: a
 * suggestion must be something GROUP can bind, and `groupIntoSeries` refuses
 * a book with an extra or a set-aside duplicate next to it (it moves the book
 * alone, and the emptied singleton's delete would take the rest with it). A
 * folded edition beside the book is left out of both counts, as EDITIONS says.
 */
function singletonCandidates(
	reveal: boolean
): (Candidate & { hue: number; addedAt: number; cover: number | null })[] {
	return getDb()
		.prepare(
			`SELECT s.id AS seriesId, s.title, s.hue, s.added_at AS addedAt, s.cover_at AS cover
			FROM series s JOIN roots r ON r.id = s.root_id
			WHERE ${kindsIn('books')} AND ${libraryWhere(reveal)}
			AND (SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND ${isBookSql('e')}) = 1
			AND (SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.edition_of IS NULL) = 1`
		)
		.all() as (Candidate & { hue: number; addedAt: number; cover: number | null })[];
}

/**
 * The suggestion that includes this singleton, if any. It counts only what
 * the viewer can see, so it never mentions a hidden book while reveal is off.
 */
export function suggestionFor(seriesId: number, reveal: boolean): Suggestion | null {
	const db = getDb();
	const candidates = singletonCandidates(reveal);
	const dismissed = (
		db.prepare(`SELECT series_ids FROM suggestion_dismissals`).all() as { series_ids: string }[]
	).map((r) => r.series_ids);
	const byId = new Map(candidates.map((c) => [c.seriesId, c]));
	for (const set of suggestionSets(candidates, dismissed)) {
		if (set.some((c) => c.seriesId === seriesId)) {
			return {
				key: setKey(set.map((c) => c.seriesId)),
				books: set.map((c) => byId.get(c.seriesId)!)
			};
		}
	}
	return null;
}

export function dismissSuggestion(seriesIds: number[], now = Date.now()): string {
	const key = setKey(seriesIds);
	getDb()
		.prepare(
			`INSERT OR REPLACE INTO suggestion_dismissals (series_ids, dismissed_at) VALUES (?, ?)`
		)
		.run(key, now);
	return key;
}

export function undoDismissal(key: string): void {
	getDb().prepare(`DELETE FROM suggestion_dismissals WHERE series_ids = ?`).run(key);
}

export type BookSeriesOption = { id: number; title: string; books: number; rootId: number };

/**
 * Series of books the viewer can see: where MOVE TO… and ADD TO EXISTING can
 * send a book. Grouping still refuses a target in another root. A series is
 * two books or more, and `books` counts them, as ONE-OFF does (`isBookSql`,
 * c558): a book with an extra or a folded edition is a one-off, not a series
 * of 2 BOOKS.
 */
export function seriesOfBooks(reveal: boolean): BookSeriesOption[] {
	return getDb()
		.prepare(
			`SELECT s.id, s.title, s.root_id AS rootId,
				(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND ${isBookSql('e')}) AS books
			FROM series s JOIN roots r ON r.id = s.root_id
			WHERE ${kindsIn('books')} AND ${libraryWhere(reveal)}
			AND (SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND ${isBookSql('e')}) > 1
			ORDER BY s.title COLLATE NOCASE`
		)
		.all() as BookSeriesOption[];
}

/**
 * Novels the viewer can see: where ADD TO EXISTING can send a volume. Any
 * novel qualifies, a single book included -- it becomes the first volume.
 */
export function seriesOfVolumes(reveal: boolean): BookSeriesOption[] {
	return getDb()
		.prepare(
			`SELECT s.id, s.title, s.root_id AS rootId,
				(SELECT COUNT(DISTINCT e.file) FROM entries e WHERE e.series_id = s.id) AS books
			FROM series s JOIN roots r ON r.id = s.root_id
			WHERE ${kindsIn('volumes')} AND ${libraryWhere(reveal)}
			ORDER BY s.title COLLATE NOCASE`
		)
		.all() as BookSeriesOption[];
}

export function rootOf(seriesId: number): number | null {
	const row = getDb().prepare(`SELECT root_id FROM series WHERE id = ?`).get(seriesId) as
		{ root_id: number } | undefined;
	return row?.root_id ?? null;
}

// ---- a book's own tags (doc/BOOKS.md, "Every book keeps its own") -------------

/**
 * Tag one book of a series of books. The series carries every tag its books
 * carry (grouping unites them), so the series gets it too: the library's tag
 * filters and person pages find the series by it.
 */
export function addBookTag(
	seriesId: number,
	entryId: number,
	tag: { namespace: string; value: string }
): boolean {
	const db = getDb();
	return db
		.transaction((): boolean => {
			if (
				!db.prepare(`SELECT 1 FROM entries WHERE id = ? AND series_id = ?`).get(entryId, seriesId)
			)
				return false;
			const { id } = db
				.prepare(
					`INSERT INTO tags (namespace, value) VALUES (?, ?)
					ON CONFLICT (namespace, value) DO UPDATE SET value = excluded.value RETURNING id`
				)
				.get(tag.namespace, tag.value) as { id: number };
			db.prepare(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)`).run(
				entryId,
				id
			);
			db.prepare(`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
				seriesId,
				id
			);
			return true;
		})
		.immediate();
}

/**
 * Take a tag off one book. The series keeps it while another of its books
 * still has it; with none left, it goes from the series too.
 */
export function removeBookTag(
	seriesId: number,
	entryId: number,
	tag: { namespace: string; value: string }
): boolean {
	const db = getDb();
	return db
		.transaction((): boolean => {
			const t = db
				.prepare(`SELECT id FROM tags WHERE namespace = ? AND value = ?`)
				.get(tag.namespace, tag.value) as { id: number } | undefined;
			if (!t) return false;
			const gone = db
				.prepare(
					`DELETE FROM entry_tags WHERE tag_id = ? AND entry_id = ?
					AND entry_id IN (SELECT id FROM entries WHERE series_id = ?)`
				)
				.run(t.id, entryId, seriesId).changes;
			if (!gone) return false;
			const still = db
				.prepare(
					`SELECT 1 FROM entry_tags et JOIN entries e ON e.id = et.entry_id
					WHERE et.tag_id = ? AND e.series_id = ? LIMIT 1`
				)
				.get(t.id, seriesId);
			if (!still)
				db.prepare(`DELETE FROM series_tags WHERE series_id = ? AND tag_id = ?`).run(
					seriesId,
					t.id
				);
			return true;
		})
		.immediate();
}

// ---- one book in several languages (doc/EDITIONS.md) ------------------------------

export class EditionError extends Error {}

type EditionRow = {
	id: number;
	series_id: number;
	title: string;
	page_count: number;
	language: string | null;
	edition_rows: string | null;
	read_at: number | null;
	last_position: number | null;
	last_opened_at: number | null;
};

/** A single doujin's language, from its `language:` tag. */
function languageOfSeries(db: Database.Database, seriesId: number): string | null {
	return (
		(
			db
				.prepare(
					`SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
					WHERE st.series_id = ? AND t.namespace = 'language' AND t.value NOT IN ('translated', 'rewrite')
					ORDER BY t.value LIMIT 1`
				)
				.get(seriesId) as { value: string } | undefined
		)?.value ?? null
	);
}

/**
 * FOLD: other single books become editions of `baseSeries`' book (a single
 * doujin, folded already or not). Each edition's entry moves into the book's
 * series, shadowed so it's no book of its own, with its language and its
 * pages lined up with the book's (`rowsOf`, from the duplicates review). The
 * book takes over what the others had: the higher rating, FAV, their shelves
 * and tags, the further page. Their series go; nothing on disk moves.
 */
export function foldEditions(
	baseSeries: number,
	others: number[],
	rowsOf: (otherEntry: number) => { a: number | null; b: number | null }[],
	now = Date.now()
): number[] {
	const db = getDb();
	return db
		.transaction((): number[] => {
			const base = seriesRow(db, baseSeries);
			if (!base || !bindsBooks(base)) throw new EditionError('no such book');
			const [baseEntry] = entryIdsOf(db, baseSeries);
			if (!baseEntry || entryIdsOf(db, baseSeries).length !== 1)
				throw new EditionError('only a single book folds: this is a series of books');
			const baseLang = db.prepare(`SELECT language FROM entries WHERE id = ?`).get(baseEntry) as {
				language: string | null;
			};
			const langs = new Set(
				(
					db
						.prepare(
							`SELECT language FROM entries WHERE (id = ? OR edition_of = ?) AND language IS NOT NULL`
						)
						.all(baseEntry, baseEntry) as { language: string }[]
				).map((r) => r.language)
			);
			if (!baseLang.language) {
				const l = languageOfSeries(db, baseSeries);
				if (!l) throw new EditionError('the book has no language tag');
				db.prepare(`UPDATE entries SET language = ? WHERE id = ?`).run(l, baseEntry);
				langs.add(l);
			}
			const position = (
				db.prepare(`SELECT position FROM entries WHERE id = ?`).get(baseEntry) as {
					position: number;
				}
			).position;
			const folded: number[] = [];
			for (const id of others) {
				const s = seriesRow(db, id);
				const ids = s ? entryIdsOf(db, id) : [];
				if (!s || !bindsBooks(s) || ids.length !== 1)
					throw new EditionError('only single books fold into another');
				if (!alike(db, [base.root_id, s.root_id])) throw new EditionError(MIXED);
				const lang = languageOfSeries(db, id);
				if (!lang) throw new EditionError('a book without a language tag can’t be an edition');
				if (langs.has(lang))
					throw new EditionError(`the book has a ${lang} edition already: that’s a duplicate`);
				langs.add(lang);
				const entry = ids[0];
				// Its own title stays with it: the book's screen names every edition.
				db.prepare(
					`UPDATE entries SET title = CASE WHEN title = '' THEN ? ELSE title END WHERE id = ?`
				).run(s.title, entry);
				keepOrigin(db, s, [entry]);
				// A queued edition still downloads, through this series' path.
				if (holdsSourceKey(db, s, entry)) nameFromRoot(db, baseSeries);
				rehome(db, entry, id, baseSeries);
				db.prepare(
					`UPDATE entries SET series_id = ?, position = ?, shadowed = 1, edition_of = ?,
						language = ?, edition_rows = ?
					WHERE id = ?`
				).run(baseSeries, position, baseEntry, lang, JSON.stringify(rowsOf(entry)), entry);
				carryQueued(db, baseSeries, [entry]);
				// What the owner did with it: kept by the book.
				db.prepare(
					`UPDATE series SET rating = MAX(COALESCE(rating, 0), ?), favourite = MAX(favourite, ?) WHERE id = ?`
				).run(s.rating, s.favourite, baseSeries);
				db.prepare(
					`INSERT OR IGNORE INTO series_tags (series_id, tag_id) SELECT ?, tag_id FROM series_tags WHERE series_id = ?`
				).run(baseSeries, id);
				db.prepare(
					`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?, tag_id FROM series_tags WHERE series_id = ?`
				).run(entry, id);
				db.prepare(
					`INSERT OR IGNORE INTO collection_series (collection_id, series_id)
					SELECT collection_id, ? FROM collection_series WHERE series_id = ?`
				).run(baseSeries, id);
				db.prepare(`UPDATE reading_events SET series_id = ? WHERE series_id = ?`).run(
					baseSeries,
					id
				);
				db.prepare(`DELETE FROM series WHERE id = ?`).run(id);
				folded.push(entry);
			}
			void now;
			return folded;
		})
		.immediate();
}

/** A folded book's editions, the book's own entry first. */
export function editionsOf(seriesId: number): EditionRow[] {
	const db = getDb();
	const [base] = entryIdsOf(db, seriesId);
	if (base === undefined) return [];
	return db
		.prepare(
			`SELECT id, series_id, title, page_count, language, edition_rows, read_at, last_position, last_opened_at
			FROM entries WHERE id = ? OR edition_of = ? ORDER BY edition_of IS NOT NULL, id`
		)
		.all(base, base) as EditionRow[];
}

/**
 * UNFOLD: each edition becomes a single book again, with the book's rating,
 * FAV and shelves, its own language, and the book's progress matched to its
 * own pages (`toEdition`). Nothing on disk moves; the duplicates review won't
 * offer the pair again. Returns the new series.
 */
export function unfoldEditions(
	seriesId: number,
	toEdition: (rows: { a: number | null; b: number | null }[], basePage: number) => number,
	now = Date.now()
): number[] {
	const db = getDb();
	return db
		.transaction((): number[] => {
			const base = seriesRow(db, seriesId);
			const eds = editionsOf(seriesId);
			if (!base || eds.length < 2) throw new EditionError('not a folded book');
			const [own, ...rest] = eds;
			const created: number[] = [];
			for (const e of rest) {
				const single = Number(
					db
						.prepare(
							`INSERT INTO series (root_id, title, kind, rating, favourite, hidden, public, hue, added_at, indexed_at, source, path)
							SELECT root_id, ?, 'doujin', rating, favourite, hidden, public, ?, added_at, ?, source, path
							FROM series WHERE id = ?`
						)
						.run(e.title || base.title, hueFor(e.title || base.title), now, seriesId)
						.lastInsertRowid
				);
				giveOriginBack(db, single, [e.id]);
				const rows = JSON.parse(e.edition_rows ?? '[]') as { a: number | null; b: number | null }[];
				const page = own.last_position === null ? null : toEdition(rows, own.last_position);
				db.prepare(
					`UPDATE entries SET series_id = ?, position = 1, shadowed = 0, edition_of = NULL,
						edition_rows = NULL, read_at = ?, last_position = ?, last_opened_at = ?
					WHERE id = ?`
				).run(single, own.read_at, own.read_at === null ? page : null, own.last_opened_at, e.id);
				carryQueued(db, single, [e.id]);
				// Its tags back from the book: everything but the book's other languages.
				db.prepare(
					`INSERT OR IGNORE INTO series_tags (series_id, tag_id)
					SELECT ?, st.tag_id FROM series_tags st JOIN tags t ON t.id = st.tag_id
					WHERE st.series_id = ? AND t.namespace != 'language'`
				).run(single, seriesId);
				db.prepare(
					`INSERT OR IGNORE INTO series_tags (series_id, tag_id)
					SELECT ?, id FROM tags WHERE namespace = 'language' AND value = ?`
				).run(single, e.language);
				db.prepare(
					`DELETE FROM series_tags WHERE series_id = ? AND tag_id =
					(SELECT id FROM tags WHERE namespace = 'language' AND value = ?)`
				).run(seriesId, e.language);
				db.prepare(
					`INSERT OR IGNORE INTO collection_series (collection_id, series_id)
					SELECT collection_id, ? FROM collection_series WHERE series_id = ?`
				).run(single, seriesId);
				db.prepare(`UPDATE reading_events SET series_id = ? WHERE entry_id = ?`).run(single, e.id);
				created.push(single);
				// The pair is settled: the duplicates review won't offer it again.
				db.prepare(
					`INSERT OR REPLACE INTO dupe_decisions (pair, decision, keep, at, applied_at)
					VALUES (?, 'apart', NULL, ?, ?)`
				).run(own.id < e.id ? `${own.id},${e.id}` : `${e.id},${own.id}`, now, now);
			}
			// And from each other: three languages unfold into three books, none offered again.
			for (const x of rest)
				for (const y of rest)
					if (x.id < y.id)
						db.prepare(
							`INSERT OR REPLACE INTO dupe_decisions (pair, decision, keep, at, applied_at)
							VALUES (?, 'apart', NULL, ?, ?)`
						).run(`${x.id},${y.id}`, now, now);
			db.prepare(`UPDATE series SET edition_lang = NULL, edition_read = NULL WHERE id = ?`).run(
				seriesId
			);
			return created;
		})
		.immediate();
}

// ---- seasons of one show (S2; card c283; doc/WORKS.md) ----------------------

/**
 * A merged show (card c283, the second slice of c215). S1's series row stays
 * the show; every other season's episodes move onto it, `entries.season`
 * becomes the sheet's order and `episode_number` stays the source's. Each
 * season's source, folder and link move into S1's per-season rows, and what
 * the merge changed is journalled so UNGROUP can put every series back under
 * its own id (`season_merges`, rung 77).
 *
 * The journal is a whole-copy of every series the merge touches, because the
 * rows a deleted series cascades are not all derivable from
 * `series_season_facts`: its rating, FAV, tags, shelves, work, links and
 * tracking state are its own, and an id that changes breaks every outside
 * reference. `snapshotSeries` walks `sqlite_master` and `PRAGMA
 * foreign_key_list`, so a table that later names a series is carried without
 * a second list to keep. `highlights` names one without a foreign key, so the
 * same walk asks `series_id` too (round 2).
 *
 * The journal is a picture of **merge time**, and the show goes on being used
 * after it. An undo therefore restores the journal's rows and then carries
 * what was written while merged to the series that now holds it: an episode
 * added by FOLLOW to its season, a log row to its entry's series, a season's
 * tracker state to that season, and the show's own rows to the show.
 */

type JsonRow = Record<string, unknown>;
type SnapshotGroup = { table: string; rows: JsonRow[] };
type SeriesSnapshot = { series: JsonRow; children: SnapshotGroup[] };
type EntrySnapshot = {
	id: number;
	series_id: number;
	season: number | null;
	position: number;
	/** Relative to its series' path at merge time; rewritten when it moves (round 2). */
	file: string;
	/** What the merge wrote into `file`, relative to the show's path (round 2). */
	mergeFile: string;
	/** `entries.available` at merge time (round 2). */
	available: number;
};

type MergeJournal = {
	target: number;
	/** The seasons' original ids, in the sheet's order: index 0 is the show itself. */
	order: number[];
	entries: EntrySnapshot[];
	snapshots: Record<string, SeriesSnapshot>;
	works: JsonRow[];
	/**
	 * Every journalled Work's members at merge time, a series outside the merge
	 * included. The seasons' own rows ride in their snapshots; a member outside
	 * the merge has no snapshot, so a reorder, an add or a take-out made while
	 * merged would otherwise lose its place (round 3).
	 */
	workMembers: { work_id: number; series_id: number; position: number }[];
};

/** The tables that key a season: a merge renumbers each one's `season`. */
const SEASON_TABLES = [
	'season_link_searches',
	'season_link_candidates',
	'season_link_decisions',
	'season_tracker_state',
	'season_tracker_sends'
] as const;

/** Rows the merge writes itself: the journal restores them, never carries them back. */
const MERGE_TABLES = new Set<string>([
	'series_season_facts',
	'series_season_links',
	'series_tags',
	'collection_series',
	'work_series',
	'series_links',
	...SEASON_TABLES.filter((t) => t !== 'season_tracker_state' && t !== 'season_tracker_sends')
]);

/** Rows keyed by the sheet's season: carried to the series whose season it was. */
const SEASON_CARRIED = new Set<string>(['season_tracker_state', 'season_tracker_sends']);

/** The tables a merge could move a log, queue or failure row of. */
const ENTRY_TABLES = new Set<string>(['reading_events', 'download_queue', 'episode_failures']);

/**
 * Rows the merge moved onto the show that a later event can take away: a
 * finished download removes its queue row, a cleared failure its own. The undo
 * restores these only while they still exist, so it never queues a finished
 * episode again (round 2).
 */
const RESTORE_ONLY_IF_PRESENT = new Set<string>(['download_queue', 'episode_failures']);

const quoteName = (name: string) => `"${name.replace(/"/g, '""')}"`;

type ChildTable = { table: string; columns: string[]; via: 'fk' | 'column' };

/**
 * Every table that names a series, by the column it does so. A table with a
 * `series_id` and no foreign key (highlights, measured: the only one) is
 * reported by the column alone, since the cascade that deletes a series never
 * reaches it.
 */
export function seriesChildTables(db: Database.Database): ChildTable[] {
	const names = (
		db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
			)
			.all() as { name: string }[]
	).map((r) => r.name);
	const out: ChildTable[] = [];
	for (const name of names) {
		const info = db.prepare(`PRAGMA table_info(${quoteName(name)})`).all() as { name: string }[];
		const fks = db.prepare(`PRAGMA foreign_key_list(${quoteName(name)})`).all() as {
			table: string;
			from: string;
		}[];
		const columns = [...new Set(fks.filter((f) => f.table === 'series').map((f) => f.from))];
		if (columns.length > 0) out.push({ table: name, columns, via: 'fk' });
		else if (info.some((c) => c.name === 'series_id'))
			out.push({ table: name, columns: ['series_id'], via: 'column' });
	}
	return out;
}

/** A table's primary key, in order. */
function primaryKey(db: Database.Database, table: string): string[] {
	return (
		db.prepare(`PRAGMA table_info(${quoteName(table)})`).all() as { name: string; pk: number }[]
	)
		.filter((c) => c.pk > 0)
		.sort((a, b) => a.pk - b.pk)
		.map((c) => c.name);
}

const pkKey = (row: JsonRow, pk: string[]) => pk.map((c) => String(row[c])).join('\u0000');

function insertRow(
	db: Database.Database,
	table: string,
	row: JsonRow,
	mode: 'or-replace' | 'ignore' | 'plain' = 'or-replace'
) {
	const columns = Object.keys(row);
	if (columns.length === 0) return;
	const verb =
		mode === 'ignore' ? 'INSERT OR IGNORE' : mode === 'plain' ? 'INSERT' : 'INSERT OR REPLACE';
	db.prepare(
		`${verb} INTO ${quoteName(table)} (${columns.map(quoteName).join(', ')})
		VALUES (${columns.map(() => '?').join(', ')})`
	).run(...columns.map((c) => row[c] as never));
}

function restoreSeriesRow(db: Database.Database, id: number, row: JsonRow) {
	const columns = Object.keys(row).filter((c) => c !== 'id');
	db.prepare(
		`UPDATE series SET ${columns.map((c) => `${quoteName(c)} = ?`).join(', ')} WHERE id = ?`
	).run(...columns.map((c) => row[c] as never), id);
}

/** A row that keeps an absorbed id from being handed to the next series added. */
function placeholderSeriesRow(row: JsonRow, now: number): JsonRow {
	return {
		...row,
		title: '',
		alt_titles: '[]',
		source: '',
		status: '',
		description: '',
		direction: null,
		path: '',
		source_url: '',
		origin_key: null,
		public: 0,
		scanlator: null,
		cover_url: '',
		cover_key: '',
		cover_at: null,
		cover_failed_at: null,
		ocr: null,
		cover_entry: null,
		cover_page: null,
		edition_lang: null,
		edition_read: null,
		rating: 1,
		favourite: 1,
		hidden: 1,
		added_at: now,
		arrived_at: null,
		followed_at: null,
		in_library: 0,
		browsed_at: null,
		pruned_at: now,
		former_key: null,
		former_at: null,
		former_source: '',
		former_offset: 1,
		move_dismissed_at: null,
		text_direction: null,
		reserve_at: now
	};
}

/** Put an absorbed id back in circulation: its placeholder and reservation go. */
function releaseReservation(db: Database.Database, kind: 'series' | 'works', id: number) {
	db.prepare(`DELETE FROM season_reservations WHERE kind = ? AND id = ?`).run(kind, id);
	db.prepare(
		`DELETE FROM ${kind === 'series' ? 'series' : 'works'} WHERE id = ? AND reserve_at IS NOT NULL`
	).run(id);
}

/**
 * Whether the row under a Work's id is the Work the journal names: the moment
 * it was made, alone (c583). `works.ts`' `mustBeWork(db, id, made)` and
 * `undoRename` decide the same way, and a rename while merged is an ordinary
 * owner action: the name must not make the owner's own Work a stranger
 * (round 3). Copied here because `works.ts` is another slot's file.
 */
const sameWorkMoment = (row: { created_at: number }, w: JsonRow): boolean =>
	Number(row.created_at) === Number(w.created_at);

/** The Work a series is in now, or null: a series belongs to one Work at most. */
function workHoldingSeries(db: Database.Database, seriesId: number): number | null {
	const row = db.prepare(`SELECT work_id FROM work_series WHERE series_id = ?`).get(seriesId) as
		{ work_id: number } | undefined;
	return row ? Number(row.work_id) : null;
}

/**
 * Whether a journal member row may go back where it was: a series the owner has
 * grouped since is the owner's, and the undo never takes it out of that Work
 * (round 4). The show is no exception -- a season the owner grouped around it
 * stays there. A series in no Work, or still in the journal's Work (whose place
 * the journal's word sets), comes back.
 */
function canRestoreMember(db: Database.Database, m: JsonRow): boolean {
	const now = workHoldingSeries(db, Number(m.series_id));
	return now === null || now === Number(m.work_id);
}

/**
 * Whether a journal member's series will exist when the undo puts it back: a
 * real row. A placeholder (`reserve_at` set) belongs to a second merge's
 * journal — its id is held for that merge's own undo, its row is out of the
 * library and hidden — so this undo counts it nowhere and writes nothing onto
 * it. One test for the three loops that walk a journal's members: the plan
 * (`planWorkMembers`), the reinsertion (`restoreWorkMembers`) and the hide a
 * merge carried (`restoreAll`), so they cannot drift apart again (round 6's
 * medium, and round 2's low that named this loop).
 */
function willExist(db: Database.Database, seriesId: number | string | null): boolean {
	return !!db.prepare(`SELECT 1 FROM series WHERE id = ? AND reserve_at IS NULL`).get(seriesId);
}

/**
 * The members each journal Work can have back: the ones the owner has not
 * grouped elsewhere since (round 4), and the ones whose series will exist when
 * the restore runs (round 5). The seasons are put back by `restoreAll` before
 * the Work's row does (`journal.order`, a placeholder or not); a member
 * outside the merge is back only if its `series` row still is, because a
 * `deleteSeries` or a fold while merged takes it and the undo does not
 * re-create it. Counting a gone one would put the Work back and then
 * `restoreWorkMembers` skips it, leaving a Work of one. A Work of one cannot
 * exist, so a Work the owner ended while merged comes back only if two of its
 * members can.
 *
 * A placeholder (`reserve_at` set) is no series either: a second merge that
 * absorbed the outsider holds its id for that merge's own undo, and that undo
 * is what gives the member back (round 6). Counting it would put the Work back
 * around a hidden row that is out of the library.
 */
function planWorkMembers(db: Database.Database, journal: MergeJournal): Map<number, JsonRow[]> {
	const plan = new Map<number, JsonRow[]>();
	for (const w of journal.works) plan.set(Number(w.id), []);
	const comesBack = new Set<number>(journal.order);
	for (const m of journal.workMembers ?? []) {
		const id = Number(m.work_id);
		const members = plan.get(id);
		if (!members) continue;
		const seriesId = Number(m.series_id);
		if (!comesBack.has(seriesId) && !willExist(db, seriesId)) continue;
		if (canRestoreMember(db, m)) members.push(m);
	}
	return plan;
}

/**
 * Put a Work the merge ended back as the row it was, in place. Deleting the
 * placeholder and re-inserting the journal's row would cascade every
 * `work_series` row of the Work, including members that are live series again
 * (a season taken out between the merge and the undo), so the placeholder's
 * id is reused instead (round 2).
 *
 * Answers whether the id still names the journal's Work. A Work the owner
 * ended while merged can have its id handed to a new Work, and the moment of
 * making is what tells the two apart; the journal's membership must not land
 * on the stranger (round 3). A Work that cannot come back with two members
 * stays ended, since a Work of one cannot exist (round 4).
 */
function restoreWorkRow(
	db: Database.Database,
	journal: MergeJournal,
	w: JsonRow,
	restorable: number
): boolean {
	const id = Number(w.id);
	const row = db.prepare(`SELECT name, created_at, reserve_at FROM works WHERE id = ?`).get(id) as
		{ name: string; created_at: number; reserve_at: number | null } | undefined;
	if (!row) {
		if (restorable < 2) return false;
		insertRow(db, 'works', w, 'plain');
		return true;
	}
	if (row.reserve_at === null) return sameWorkMoment(row, w);
	if (restorable < 2) return false;
	const columns = Object.keys(w).filter((c) => c !== 'id' && c !== 'reserve_at');
	db.prepare(
		`UPDATE works SET ${columns.map((c) => `${quoteName(c)} = ?`).join(', ')}, reserve_at = NULL
		WHERE id = ?`
	).run(...columns.map((c) => w[c] as never), id);
	// Cleared after the row is real, so the trigger that follows a reservation's
	// delete sees a Work, not a placeholder.
	db.prepare(`DELETE FROM season_reservations WHERE merge = ? AND kind = 'works' AND id = ?`).run(
		journal.target,
		id
	);
	return true;
}

/**
 * Keep every absorbed series and Work id from being reissued while the journal
 * lives: a placeholder row holds the id, and `season_reservations` binds it to
 * the show so the row goes when the journal does.
 */
function reserveReservations(db: Database.Database, journal: MergeJournal, now: number) {
	for (const id of journal.order) {
		if (id === journal.target) continue;
		const row = db.prepare(`SELECT reserve_at FROM series WHERE id = ?`).get(id) as
			{ reserve_at: number | null } | undefined;
		if (row && row.reserve_at === null) continue;
		if (!row)
			insertRow(db, 'series', placeholderSeriesRow(journal.snapshots[String(id)].series, now));
		db.prepare(
			`INSERT OR IGNORE INTO season_reservations (merge, kind, id) VALUES (?, 'series', ?)`
		).run(journal.target, id);
	}
	for (const w of journal.works) {
		const id = Number(w.id);
		const row = db.prepare(`SELECT reserve_at FROM works WHERE id = ?`).get(id) as
			{ reserve_at: number | null } | undefined;
		if (row && row.reserve_at === null) continue;
		if (!row) insertRow(db, 'works', { ...w, reserve_at: now }, 'plain');
		db.prepare(
			`INSERT OR IGNORE INTO season_reservations (merge, kind, id) VALUES (?, 'works', ?)`
		).run(journal.target, id);
	}
}

/**
 * Every row of every table that names this series, and the series' own row.
 * `entries` is left out on purpose: its rows move rather than go, and the
 * journal keeps their own series, season, position and file beside it.
 */
function snapshotSeries(db: Database.Database, id: number, tables: ChildTable[]): SeriesSnapshot {
	const series = db.prepare(`SELECT * FROM series WHERE id = ?`).get(id) as JsonRow;
	const children: SnapshotGroup[] = [];
	for (const { table, columns } of tables) {
		if (table === 'entries' || table === 'season_merges') continue;
		const where = columns.map((c) => `${quoteName(c)} = @id`).join(' OR ');
		const rows = db
			.prepare(`SELECT * FROM ${quoteName(table)} WHERE ${where}`)
			.all({ id }) as JsonRow[];
		if (rows.length > 0) children.push({ table, rows });
	}
	return { series, children };
}

/**
 * Put one series' journal back: its row, then every child row exactly as it
 * was. The caller has already inserted a missing series row (an absorbed
 * season's) or asks for the show's own row to be updated in place, since
 * delete-and-insert would cascade what is being restored. Rows are deleted by
 * their primary key, not by `series_id`, because the merge moved some of them
 * onto the show.
 */
/**
 * The columns of a table that name an entry, with what its foreign key does
 * when the entry goes: `SET NULL`, or the row cannot outlive its entry.
 */
function entryRefs(db: Database.Database, table: string): { column: string; onDelete: string }[] {
	return (
		db.prepare(`PRAGMA foreign_key_list(${quoteName(table)})`).all() as {
			table: string;
			from: string;
			on_delete: string;
		}[]
	)
		.filter((f) => f.table === 'entries')
		.map((f) => ({ column: f.from, onDelete: f.on_delete }));
}

function restoreSnapshot(
	db: Database.Database,
	id: number,
	snap: SeriesSnapshot,
	lostWorks: Set<number> = new Set()
) {
	restoreSeriesRow(db, id, snap.series);
	const entry = db.prepare(`SELECT 1 FROM entries WHERE id = ?`);
	for (const group of snap.children) {
		const pk = primaryKey(db, group.table);
		if (pk.length === 0) continue;
		// A Work the undo cannot name any more (its id is a stranger's) gets no
		// membership back (round 3), and a series the owner has grouped since is
		// not taken out of that Work (round 4).
		const rows =
			group.table === 'work_series'
				? group.rows.filter(
						(row) => !lostWorks.has(Number(row.work_id)) && canRestoreMember(db, row)
					)
				: group.rows;
		const where = pk.map((c) => `${quoteName(c)} = @${c}`).join(' AND ');
		const drop = db.prepare(`DELETE FROM ${quoteName(group.table)} WHERE ${where}`);
		// A finished download takes its queue row and a cleared failure its own:
		// a row gone since the merge is not put back (round 2).
		const present = RESTORE_ONLY_IF_PRESENT.has(group.table)
			? db.prepare(`SELECT 1 FROM ${quoteName(group.table)} WHERE ${where}`)
			: null;
		const refs = entryRefs(db, group.table);
		for (const row of rows) {
			const exists = present ? !!present.get(row) : true;
			drop.run(row);
			if (!exists) continue;
			// An entry deleted while merged stays gone: its log row comes back
			// with a null reference where the foreign key would null it, and a
			// row that cannot outlive its entry is not put back (round 3).
			const fixed = refs.length > 0 ? { ...row } : row;
			let orphan = false;
			for (const ref of refs) {
				const value = fixed[ref.column];
				if (value === null || value === undefined || entry.get(value)) continue;
				if (ref.onDelete.toUpperCase() === 'SET NULL') fixed[ref.column] = null;
				else orphan = true;
			}
			if (!orphan) insertRow(db, group.table, fixed);
		}
	}
}

/**
 * A journal highlight exactly as it was, after the entries are back. Moving an
 * entry's season back fires `highlights_entry_numbered`, whose own job is to
 * rejoin a waiting highlight by number and season; the undo's picture of merge
 * time wins, and a later arrival can rejoin it again (round 2).
 */
function restoreJournalHighlights(db: Database.Database, journal: MergeJournal, ids: number[]) {
	for (const id of ids)
		for (const group of journal.snapshots[String(id)]?.children ?? []) {
			if (group.table !== 'highlights') continue;
			const drop = db.prepare(`DELETE FROM highlights WHERE id = ?`);
			for (const row of group.rows) {
				drop.run(row.id as never);
				insertRow(db, 'highlights', row);
			}
		}
}

/**
 * Put each journalled entry back on its own series. Its file is only the
 * journal's when it still holds what the merge wrote: a file gained while
 * merged is relative to the show's folder now, so it is rebased onto the
 * entry's own series instead of being erased (round 2). `liveTargetPath` is
 * the show's folder at the moment of the undo, before the journal restores it.
 */
function restoreEntries(
	db: Database.Database,
	journal: MergeJournal,
	entries: EntrySnapshot[],
	liveTargetPath: string,
	liveFolders: Map<number, string | null>
) {
	const set = db.prepare(
		`UPDATE entries SET series_id = ?, season = ?, position = ?, file = ?, available = ? WHERE id = ?`
	);
	const read = db.prepare(`SELECT file, available FROM entries WHERE id = ?`);
	for (const e of entries) {
		const mergeFile = e.mergeFile ?? e.file;
		const cur = read.get(e.id) as { file: string; available: number } | undefined;
		let file: string;
		let available: number;
		if (cur && cur.file !== mergeFile) {
			// A file gained while merged is relative to the show's folder as it
			// stood at the undo; a season with no folder of its own takes the
			// file's own directory rather than losing it (round 3).
			const named = moveFileOnto(
				db,
				e.series_id,
				liveTargetPath,
				cur.file,
				cur.available,
				liveFolders.get(e.series_id) ?? null
			);
			file = named.file;
			available = named.available;
		} else {
			file = e.file;
			available = e.available ?? (file === '' ? 0 : 1);
		}
		set.run(e.series_id, e.season, e.position, file, available, e.id);
	}
}

function readJournal(db: Database.Database, seriesId: number): MergeJournal | null {
	const row = db.prepare(`SELECT facts FROM season_merges WHERE series_id = ?`).get(seriesId) as
		{ facts: string } | undefined;
	return row ? (JSON.parse(row.facts) as MergeJournal) : null;
}

/**
 * Write the journal in place. `INSERT OR REPLACE` would delete and reinsert the
 * row, which cascades `season_reservations` away and would take the
 * placeholders with it (round 2). A first-season take-out moves the journal to
 * the next season's id, which the reservation's foreign key follows.
 */
function writeJournal(
	db: Database.Database,
	journal: MergeJournal,
	now: number,
	previousTarget?: number
) {
	const facts = JSON.stringify(journal);
	if (previousTarget !== undefined && previousTarget !== journal.target) {
		db.prepare(
			`UPDATE season_merges SET series_id = ?, made_at = ?, facts = ? WHERE series_id = ?`
		).run(journal.target, now, facts, previousTarget);
		return;
	}
	const exists = db.prepare(`SELECT 1 FROM season_merges WHERE series_id = ?`).get(journal.target);
	if (exists)
		db.prepare(`UPDATE season_merges SET made_at = ?, facts = ? WHERE series_id = ?`).run(
			now,
			facts,
			journal.target
		);
	else
		db.prepare(`INSERT INTO season_merges (series_id, made_at, facts) VALUES (?, ?, ?)`).run(
			journal.target,
			now,
			facts
		);
}

/** A series' own season, when it is exactly one: what a merge can renumber. */
function ownSeasonOf(db: Database.Database, seriesId: number): number {
	const row = db
		.prepare(
			`SELECT MAX(season) AS top, COUNT(DISTINCT season) AS n FROM entries
			WHERE series_id = ? AND season IS NOT NULL`
		)
		.get(seriesId) as { top: number | null; n: number };
	const links = db
		.prepare(`SELECT COUNT(DISTINCT season) AS n FROM series_season_links WHERE series_id = ?`)
		.get(seriesId) as { n: number };
	if (row.n > 1 || links.n > 1) return 0;
	return Math.max(1, row.top ?? 1);
}

const seriesPathOf = (db: Database.Database, id: number): string =>
	(db.prepare(`SELECT path FROM series WHERE id = ?`).get(id) as { path: string } | undefined)
		?.path ?? '';

/**
 * A moved episode's file, relative to its new series' path, as `nameFilesFrom`
 * does (import/write.ts). A series path of `''` means "no file" (`episodeFile`
 * treats it so), and a file that meant nothing before the move must not mean
 * something after it: both ends answer `''`.
 */
function rebaseFile(from: string, to: string, file: string): string {
	if (file === '' || from === '' || to === '') return '';
	return relative(to, join(from, file));
}

/**
 * The show's live per-season folders, by the season's original series id, read
 * before an undo deletes them: a folder a download gave a season while merged
 * names where its gained file actually is (round 3).
 */
function liveSeasonFolders(
	db: Database.Database,
	journal: MergeJournal
): Map<number, string | null> {
	const out = new Map<number, string | null>();
	const rows = db
		.prepare(`SELECT season, folder FROM series_season_facts WHERE series_id = ?`)
		.all(journal.target) as { season: number; folder: string | null }[];
	for (const row of rows) {
		const id = journal.order[Number(row.season) - 1];
		if (id !== undefined) out.set(id, row.folder);
	}
	return out;
}

/**
 * Give a series that has no folder the directory a file landed in, and the
 * season's live folder name where the show has one, so the next download stays
 * in the same place. `anime_series.folder` and `series_season_facts.folder` are
 * both unique (`folderTaken`, season-facts.ts): a name another series holds is
 * left alone.
 */
function adoptFolder(
	db: Database.Database,
	seriesId: number,
	dir: string,
	folder: string | null
): void {
	db.prepare(`UPDATE series SET path = ? WHERE id = ?`).run(dir, seriesId);
	if (folder === null || folder === '') return;
	const taken = db
		.prepare(
			`SELECT 1 FROM anime_series WHERE folder = ? AND series_id != ?
			UNION ALL SELECT 1 FROM series_season_facts WHERE folder = ? AND series_id != ?`
		)
		.get(folder, seriesId, folder, seriesId);
	if (taken) return;
	const row = db.prepare(`SELECT 1 FROM anime_series WHERE series_id = ?`).get(seriesId);
	if (row)
		db.prepare(`UPDATE anime_series SET folder = ? WHERE series_id = ?`).run(folder, seriesId);
	else
		db.prepare(`INSERT INTO anime_series (series_id, folder) VALUES (?, ?)`).run(seriesId, folder);
}

/**
 * A moved file's name and its `available`, written together: the file is named
 * from its new series' folder, a series that has no folder takes the file's own
 * directory, and a file that cannot be named is no file, `available` included
 * (round 3).
 */
function moveFileOnto(
	db: Database.Database,
	seriesId: number,
	from: string,
	file: string,
	available: number,
	folder: string | null
): { file: string; available: number } {
	if (file === '' || from === '') return { file: '', available: 0 };
	const to = seriesPathOf(db, seriesId);
	if (to !== '') return { file: relative(to, join(from, file)), available };
	const dir = dirname(join(from, file));
	adoptFolder(db, seriesId, dir, folder);
	return { file: relative(dir, join(from, file)), available };
}

/**
 * The season a journal series originally numbered its entries with. A flat
 * list (every entry with a NULL season) answers NULL, so an episode added
 * while merged rejoins the flat list rather than becoming a season of one
 * (round 2).
 */
function originalSeasonOf(journal: MergeJournal, id: number): number | null {
	const own = journal.entries.filter((e) => e.series_id === id);
	if (own.length > 0 && own.every((e) => e.season === null)) return null;
	const seasons = new Set(own.filter((e) => e.season !== null).map((e) => Number(e.season)));
	if (seasons.size === 1) return [...seasons][0];
	if (seasons.size > 1) return Math.max(...seasons);
	for (const group of journal.snapshots[String(id)]?.children ?? [])
		if (group.table === 'series_season_links' && group.rows.length > 0)
			return Math.min(...group.rows.map((r) => Number(r.season)));
	return 1;
}

/** The ids of every highlight the journal knows, so its trigger-made orphans are not carried. */
function journalHighlightIds(journal: MergeJournal): number[] {
	const out = new Set<number>();
	for (const id of journal.order)
		for (const group of journal.snapshots[String(id)]?.children ?? [])
			if (group.table === 'highlights') for (const row of group.rows) out.add(Number(row.id));
	return [...out];
}

/**
 * Every row currently naming one of the merge's series, read before the
 * restore overwrites them: the merge-time rows (some moved onto the show) and
 * what was written while merged.
 */
function captureTargetRows(
	db: Database.Database,
	journal: MergeJournal,
	tables: ChildTable[]
): SnapshotGroup[] {
	const marks = journal.order.map(() => '?').join(',');
	const out: SnapshotGroup[] = [];
	for (const { table, columns } of tables) {
		if (table === 'entries' || table === 'season_merges') continue;
		const where = columns.map((c) => `${quoteName(c)} IN (${marks})`).join(' OR ');
		const rows = db
			.prepare(`SELECT * FROM ${quoteName(table)} WHERE ${where}`)
			.all(...journal.order) as JsonRow[];
		if (table === 'highlights') {
			const seen = new Set(rows.map((r) => Number(r.id)));
			const ids = journalHighlightIds(journal).filter((id) => !seen.has(id));
			if (ids.length > 0) {
				const marks2 = ids.map(() => '?').join(',');
				const extra = db
					.prepare(`SELECT * FROM highlights WHERE id IN (${marks2})`)
					.all(...ids) as JsonRow[];
				for (const row of extra) rows.push(row);
			}
		}
		if (rows.length > 0) out.push({ table, rows });
	}
	return out;
}

/** Every journal child row, by table and primary key, with the series it belonged to. */
function journalIndex(
	db: Database.Database,
	journal: MergeJournal
): Map<string, Map<string, { series: number; row: JsonRow }>> {
	const out = new Map<string, Map<string, { series: number; row: JsonRow }>>();
	for (const id of journal.order) {
		for (const group of journal.snapshots[String(id)]?.children ?? []) {
			const pk = primaryKey(db, group.table);
			if (pk.length === 0) continue;
			let byKey = out.get(group.table);
			if (!byKey) {
				byKey = new Map();
				out.set(group.table, byKey);
			}
			for (const row of group.rows) byKey.set(pkKey(row, pk), { series: id, row });
		}
	}
	return out;
}

/**
 * Put back what was written while merged: a log row, a queue row and a failure
 * ride with their entry's series; a season's tracker state rides with its
 * season; a highlight with its entry; everything else the show wrote stays on
 * the show. Rows the merge wrote itself (`MERGE_TABLES`) are the journal's.
 */
function carryCapturedRows(
	db: Database.Database,
	journal: MergeJournal,
	captured: SnapshotGroup[],
	index: Map<string, Map<string, { series: number; row: JsonRow }>>
) {
	const byEntry = db.prepare(`SELECT series_id AS id FROM entries WHERE id = ?`);
	const entrySeries = (entryId: unknown): number | null => {
		if (entryId === null || entryId === undefined) return null;
		return (byEntry.get(entryId) as { id: number } | undefined)?.id ?? null;
	};
	for (const { table, rows } of captured) {
		if (MERGE_TABLES.has(table)) continue;
		const pk = primaryKey(db, table);
		for (const row of rows) {
			if (table === 'highlights') {
				// A journal highlight's orphaned state is the merge's own doing; the
				// snapshot put it back exactly. Only a highlight made since moves.
				if (pk.length > 0 && index.get('highlights')?.has(pkKey(row, pk))) continue;
				insertRow(db, table, {
					...row,
					series_id: entrySeries(row.entry_id) ?? journal.target
				});
				continue;
			}
			const known = pk.length > 0 ? index.get(table)?.get(pkKey(row, pk)) : undefined;
			let dest: number;
			const next = { ...row };
			if (known) {
				dest = known.series;
				if (SEASON_CARRIED.has(table)) next.season = known.row.season;
			} else if (SEASON_CARRIED.has(table)) {
				const idx = Math.min(Math.max(Number(row.season) || 1, 1), journal.order.length) - 1;
				dest = journal.order[idx] ?? journal.target;
				// These tables' season is NOT NULL: a flat list has no number to give.
				next.season = originalSeasonOf(journal, dest) ?? 1;
			} else if (ENTRY_TABLES.has(table)) {
				dest = entrySeries(row.entry_id) ?? journal.target;
			} else {
				dest = journal.target;
			}
			next.series_id = dest;
			insertRow(db, table, next);
		}
	}
}

/**
 * An episode FOLLOW added while merged is on the show with a sheet season that
 * means nothing on its own: send it to the series of that season, give it that
 * season's own number, and resequence the series that received it (round 2).
 */
function rehomeAddedEntries(
	db: Database.Database,
	journal: MergeJournal,
	liveTargetPath: string,
	liveFolders: Map<number, string | null>
): void {
	const known = new Set(journal.entries.map((e) => e.id));
	const rows = (
		db
			.prepare(`SELECT id, season, file, available FROM entries WHERE series_id = ?`)
			.all(journal.target) as {
			id: number;
			season: number | null;
			file: string;
			available: number;
		}[]
	).filter((r) => !known.has(r.id));
	const move = db.prepare(
		`UPDATE entries SET series_id = ?, season = ?, file = ?, available = ? WHERE id = ?`
	);
	const touched = new Set<number>();
	for (const r of rows) {
		if (r.season === null) continue;
		const idx = Math.min(Math.max(Number(r.season), 1), journal.order.length) - 1;
		const dest = journal.order[idx];
		if (dest === undefined) continue;
		// The added entry's file is relative to the show's folder as it stands now,
		// which the journal may already have restored to an earlier one (round 2);
		// a season with no folder takes the file's own directory (round 3).
		const named = moveFileOnto(
			db,
			dest,
			liveTargetPath,
			r.file,
			r.available,
			liveFolders.get(dest) ?? null
		);
		move.run(dest, originalSeasonOf(journal, dest), named.file, named.available, r.id);
		touched.add(dest);
	}
	for (const id of touched) resequenceAnime(db, id);
}

/**
 * A series' live hide state, read before the journal puts its own back: a HIDE
 * or UNHIDE made while merged is the show's, and it decides every season's on
 * the undo (round 3).
 */
function liveHiddenOf(db: Database.Database, id: number): number | null {
	return (
		(db.prepare(`SELECT hidden FROM series WHERE id = ?`).get(id) as { hidden: number })?.hidden ??
		null
	);
}

/** The show's hide state at merge time, as the journal has it. */
function journalHidden(journal: MergeJournal): number {
	return Number(journal.snapshots[String(journal.target)]?.series.hidden ?? 0);
}

/**
 * `setHidden`'s own rule (library.ts): hiding takes back `public`; unhiding
 * clears the flag and, in a hidden root, makes the series public.
 */
function applyHidden(db: Database.Database, id: number, hidden: number) {
	db.prepare(
		`UPDATE series SET hidden = ?,
			public = CASE WHEN ? = 1 THEN 0 ELSE (SELECT r.hidden FROM roots r WHERE r.id = series.root_id) END
		WHERE id = ?`
	).run(hidden, hidden, id);
}

/**
 * Put every series back exactly: the show's own row too. Returns nothing; the
 * caller deletes the journal once this has committed.
 */
function restoreAll(db: Database.Database, journal: MergeJournal, tables: ChildTable[]) {
	const captured = captureTargetRows(db, journal, tables);
	const index = journalIndex(db, journal);
	// The show's folder as it stands before the journal restores it: a file
	// gained while merged is relative to this one (round 2), and its live
	// per-season folders are where the downloader put those seasons (round 3).
	const liveTargetPath = seriesPathOf(db, journal.target);
	const liveFolders = liveSeasonFolders(db, journal);
	const liveHidden = liveHiddenOf(db, journal.target);
	// What the merge itself wrote on the show goes first: the union of tags,
	// shelves, the renumbered links and season rows, and the season facts. The
	// journal puts each series' own back; anything written since is carried
	// afterwards. `work_series` waits: deleting the show's row here would leave
	// a Work short of members when a placeholder series goes, and the trigger
	// would end it and cascade its outside member (round 2).
	for (const table of new Set([...MERGE_TABLES, ...SEASON_TABLES]))
		if (table !== 'work_series')
			db.prepare(`DELETE FROM ${quoteName(table)} WHERE series_id = ?`).run(journal.target);
	for (const id of journal.order) if (id !== journal.target) releaseReservation(db, 'series', id);
	const lostWorks = new Set<number>();
	// Which members can come back, read before any Work row is put back: a Work
	// whose id a stranger holds, or whose members the owner has grouped
	// elsewhere since, must not return (rounds 3 and 4).
	const plan = planWorkMembers(db, journal);
	for (const w of journal.works)
		if (!restoreWorkRow(db, journal, w, plan.get(Number(w.id))?.length ?? 0))
			lostWorks.add(Number(w.id));
	for (const id of journal.order) {
		if (id === journal.target) continue;
		insertRow(db, 'series', journal.snapshots[String(id)].series, 'plain');
	}
	for (const id of journal.order) restoreSnapshot(db, id, journal.snapshots[String(id)], lostWorks);
	// A `work_series` row the merge added for the show is the journal's to
	// remove, and only now that the absorbed seasons' rows are back.
	removeMergeAddedWorkRows(db, journal, lostWorks);
	restoreWorkMembers(db, journal, lostWorks);
	restoreEntries(db, journal, journal.entries, liveTargetPath, liveFolders);
	rehomeAddedEntries(db, journal, liveTargetPath, liveFolders);
	restoreJournalHighlights(db, journal, journal.order);
	carryCapturedRows(db, journal, captured, index);
	// Privacy is not undone by putting the show back together: a HIDE or UNHIDE
	// made while merged follows every season (round 3) and every other member
	// of the Work, which is hidden whole (round 3's owner-action table). A
	// series the owner has grouped elsewhere since is not its member, and the
	// other Work must not be made mixed (round 4).
	if (liveHidden !== null && liveHidden !== journalHidden(journal)) {
		for (const id of journal.order) applyHidden(db, id, liveHidden);
		for (const m of journal.workMembers ?? [])
			if (
				!lostWorks.has(Number(m.work_id)) &&
				canRestoreMember(db, m) &&
				willExist(db, m.series_id)
			)
				applyHidden(db, m.series_id, liveHidden);
	}
}

/**
 * The Work's membership as the journal has it: the seasons' own rows are in
 * their snapshots, and a member outside the merge has none, so its place would
 * otherwise follow whatever the owner did while merged (a reorder, an add, a
 * take-out). A series still in the journal's Work gets its place back; a series
 * the owner has grouped since is left where the owner put it -- the undo never
 * takes a series out of a live Work it is not the journal's, and a Work is not
 * ended as a side effect of putting rows back (round 4).
 */
function restoreWorkMembers(db: Database.Database, journal: MergeJournal, lostWorks: Set<number>) {
	// The same test `planWorkMembers` counts with: a placeholder belongs to the
	// second merge's journal, not this one (round 6).
	for (const m of journal.workMembers ?? []) {
		if (lostWorks.has(Number(m.work_id))) continue;
		if (!willExist(db, m.series_id)) continue;
		if (!canRestoreMember(db, m)) continue;
		insertRow(db, 'work_series', m);
	}
}

/**
 * A Work the owner made around the show while merged follows the show (the
 * owner's decision, 2026-11-10), as the show's shelves do: on the first-season
 * take-out the row that held the season which was the show moves to the season
 * that now is, at the same position. Only a Work made after the merge follows
 * -- a Work the journal restores is the merge's own -- and never one whose new
 * season already sits in another Work the owner made: two owner Works cannot
 * both hold the show, so both are left as they are.
 */
function followShowIntoOwnersWork(
	db: Database.Database,
	journal: MergeJournal,
	taken: number,
	nextTarget: number
): void {
	const owners = (id: number): boolean => {
		const row = db.prepare(`SELECT created_at FROM works WHERE id = ?`).get(id) as
			{ created_at: number } | undefined;
		return !!row && !journal.works.some((w) => sameWorkMoment(row, w));
	};
	const targetWork = workHoldingSeries(db, nextTarget);
	if (targetWork !== null && owners(targetWork)) return;
	const rows = db
		.prepare(`SELECT work_id AS id FROM work_series WHERE series_id = ?`)
		.all(taken) as { id: number }[];
	for (const row of rows) {
		if (!owners(row.id)) continue;
		// One Work holds a series: the new show leaves the journal's Work the
		// restore put it in, and the owner's row takes its place.
		db.prepare(`DELETE FROM work_series WHERE series_id = ?`).run(nextTarget);
		db.prepare(`UPDATE work_series SET series_id = ? WHERE work_id = ? AND series_id = ?`).run(
			nextTarget,
			row.id,
			taken
		);
	}
}

/**
 * A `work_series` row the merge added for the show is not in the journal:
 * remove it after the absorbed seasons are back, so the Work never passes
 * through a moment short of members (round 2).
 */
function removeMergeAddedWorkRows(
	db: Database.Database,
	journal: MergeJournal,
	lostWorks: Set<number> = new Set()
) {
	const had = new Set<number>();
	for (const group of journal.snapshots[String(journal.target)]?.children ?? [])
		if (group.table === 'work_series') for (const row of group.rows) had.add(Number(row.work_id));
	for (const w of journal.works) {
		const id = Number(w.id);
		if (had.has(id) || lostWorks.has(id)) continue;
		db.prepare(`DELETE FROM work_series WHERE work_id = ? AND series_id = ?`).run(
			id,
			journal.target
		);
	}
}

export type MergeResult = { seriesId: number; seasons: number; order: number[] };

/**
 * Merge anime series into one show: the first stays the series, and every
 * other season's episodes, log rows, progress, source, folder and link move
 * onto it. The sheet's order is the season numbering. Refuses anything the
 * show cannot be: a selection that is not all anime, mixed hidden and visible
 * roots (`alike`), a season already merged, two Works, or a series that
 * already holds more than one season.
 */
export function mergeSeasons(opts: {
	seriesIds: number[];
	name?: string;
	now?: number;
}): MergeResult {
	const db = getDb();
	const now = opts.now ?? Date.now();
	return db
		.transaction((): MergeResult => {
			const order = opts.seriesIds;
			if (new Set(order).size !== order.length) throw new GroupingError('a season is named twice');
			if (order.length < 2) throw new GroupingError('a show needs two seasons');
			const rows = order.map((id) => seriesRow(db, id));
			if (rows.some((r) => !r)) throw new GroupingError('a season no longer exists');
			const seasons = rows as SeriesRow[];
			if (seasons.some((s) => kindFacts(s.kind).medium !== 'video'))
				throw new GroupingError('only anime seasons make a show');
			if (
				!alike(
					db,
					seasons.map((s) => s.root_id)
				)
			)
				throw new GroupingError(MIXED);
			for (const s of seasons) {
				if (seasonFacts(s.id, db).length > 0)
					throw new GroupingError(`"${s.title}" is already part of a merged show`);
				if (ownSeasonOf(db, s.id) === 0)
					throw new GroupingError(`"${s.title}" already holds more than one season`);
			}
			const workIds = [
				...new Set(
					(
						db
							.prepare(
								`SELECT DISTINCT work_id AS id FROM work_series
								WHERE series_id IN (${order.map(() => '?').join(',')})`
							)
							.all(...order) as { id: number }[]
					).map((r) => r.id)
				)
			];
			if (workIds.length > 1) throw new GroupingError('a show cannot join two Works');
			const workId = workIds[0] ?? null;
			// Read before the merge writes: the Work's own members, the series
			// outside the merge included, and each one's place (round 3).
			const workMembers =
				workId === null
					? []
					: (db
							.prepare(
								`SELECT work_id, series_id, position FROM work_series
								WHERE work_id = ? ORDER BY position`
							)
							.all(workId) as { work_id: number; series_id: number; position: number }[]);

			const tables = seriesChildTables(db);
			const snapshots: Record<string, SeriesSnapshot> = {};
			for (const s of seasons) snapshots[String(s.id)] = snapshotSeries(db, s.id, tables);
			const works: JsonRow[] = [];
			if (workId !== null) {
				const w = db.prepare(`SELECT * FROM works WHERE id = ?`).get(workId) as JsonRow | undefined;
				if (w) works.push(w);
			}

			const data = seasons.map((s, i) => {
				const meta = db
					.prepare(
						`SELECT origin_key AS key, path, followed_at AS followed FROM series WHERE id = ?`
					)
					.get(s.id) as { key: string | null; path: string; followed: number | null };
				return {
					series: s,
					season: i + 1,
					key: meta.key,
					path: meta.path,
					followed: meta.followed,
					folder:
						(
							db.prepare(`SELECT folder FROM anime_series WHERE series_id = ?`).get(s.id) as
								{ folder: string } | undefined
						)?.folder ?? null,
					links: db
						.prepare(`SELECT * FROM series_season_links WHERE series_id = ?`)
						.all(s.id) as JsonRow[],
					legacy:
						(db.prepare(`SELECT * FROM series_links WHERE series_id = ?`).get(s.id) as JsonRow) ??
						null,
					tables: SEASON_TABLES.map((table) => ({
						table,
						rows: db
							.prepare(`SELECT * FROM ${quoteName(table)} WHERE series_id = ?`)
							.all(s.id) as JsonRow[]
					}))
				};
			});
			const target = order[0];
			// The show's folder is the first season's that has one, so a streaming
			// first season does not erase the later seasons' files; the journal's
			// snapshot of the target row restores the empty path on undo (round 2).
			const targetPath = data.find((d) => d.path !== '')?.path ?? '';
			const paths = new Map(data.map((d) => [d.series.id, d.path]));
			const entries = (
				db
					.prepare(
						`SELECT id, series_id, season, position, file, available FROM entries
						WHERE series_id IN (${order.map(() => '?').join(',')}) ORDER BY id`
					)
					.all(...order) as Omit<EntrySnapshot, 'mergeFile'>[]
			).map((e) => ({
				...e,
				mergeFile: rebaseFile(paths.get(e.series_id) ?? '', targetPath, e.file)
			}));
			const name = (opts.name ?? '').trim() || seasons[0].title;
			const inList = order.join(', ');
			const last = data[data.length - 1];

			// FOLLOW asks the last season (c282), so the show is followed when it
			// is: a last season nobody follows leaves the show unfollowed, and an
			// earlier one being followed does not follow the show (round 2).
			db.prepare(
				`UPDATE series SET title = ?, rating = ?, favourite = ?, followed_at = ?, path = ? WHERE id = ?`
			).run(
				name,
				Math.max(...seasons.map((s) => s.rating)),
				Math.max(...seasons.map((s) => s.favourite)),
				last.followed,
				targetPath,
				target
			);
			db.prepare(
				`INSERT OR IGNORE INTO series_tags (series_id, tag_id)
				SELECT ?, tag_id FROM series_tags WHERE series_id IN (${inList})`
			).run(target);
			db.prepare(
				`INSERT OR IGNORE INTO collection_series (collection_id, series_id)
				SELECT collection_id, ? FROM collection_series WHERE series_id IN (${inList})`
			).run(target);
			if (workId !== null) {
				const there = db
					.prepare(`SELECT 1 FROM work_series WHERE work_id = ? AND series_id = ?`)
					.get(workId, target);
				if (!there) {
					const next =
						(
							db
								.prepare(
									`SELECT COALESCE(MAX(position), 0) AS p FROM work_series WHERE work_id = ?`
								)
								.get(workId) as { p: number }
						).p + 1;
					db.prepare(`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, ?)`).run(
						workId,
						target,
						next
					);
				}
			}
			// The episodes, their log rows and their queue follow the show; each
			// moved episode's file is named from the show's folder, and one that
			// cannot be named is no longer marked available (round 2).
			for (const d of data) {
				const moved = db
					.prepare(`SELECT id, file, available FROM entries WHERE series_id = ?`)
					.all(d.series.id) as { id: number; file: string; available: number }[];
				const set = db.prepare(
					`UPDATE entries SET series_id = ?, season = ?, file = ?, available = ? WHERE id = ?`
				);
				for (const e of moved) {
					const file = rebaseFile(d.path, targetPath, e.file);
					set.run(target, d.season, file, file === '' ? 0 : e.available, e.id);
				}
			}
			for (const d of data.slice(1)) {
				db.prepare(`UPDATE reading_events SET series_id = ? WHERE series_id = ?`).run(
					target,
					d.series.id
				);
				db.prepare(`UPDATE download_queue SET series_id = ? WHERE series_id = ?`).run(
					target,
					d.series.id
				);
				db.prepare(`UPDATE episode_failures SET series_id = ? WHERE series_id = ?`).run(
					target,
					d.series.id
				);
			}
			// Each season's link and tracking state, under its new season number.
			db.prepare(`DELETE FROM series_season_links WHERE series_id = ?`).run(target);
			for (const table of SEASON_TABLES)
				db.prepare(`DELETE FROM ${quoteName(table)} WHERE series_id = ?`).run(target);
			for (const d of data) {
				for (const row of d.links)
					insertRow(db, 'series_season_links', { ...row, series_id: target, season: d.season });
				if (d.links.length === 0 && d.legacy) {
					const l = d.legacy;
					if (l.anilist_id !== null || l.mal_id !== null)
						db.prepare(
							`INSERT OR REPLACE INTO series_season_links
							(series_id, season, part, anilist_id, mal_id, via, title, cover_url, linked_at,
								resolved_at, filled_rating, score, format)
							VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
						).run(
							target,
							d.season,
							l.anilist_id as never,
							l.mal_id as never,
							l.via as never,
							l.title as never,
							l.cover_url as never,
							l.linked_at as never,
							l.resolved_at as never,
							l.filled_rating as never,
							l.score as never
						);
				}
				for (const group of d.tables)
					for (const row of group.rows)
						insertRow(db, group.table, { ...row, series_id: target, season: d.season });
			}
			db.prepare(`DELETE FROM series_links WHERE series_id IN (${inList})`).run();
			// The seasons' own rows go, and with them what cascades: the journal
			// has every row this merge will need to put them back.
			for (const d of data.slice(1)) db.prepare(`DELETE FROM series WHERE id = ?`).run(d.series.id);
			db.prepare(`DELETE FROM series_season_facts WHERE series_id = ?`).run(target);
			for (const d of data)
				db.prepare(
					`INSERT INTO series_season_facts (series_id, season, origin_key, folder, source_title)
					VALUES (?, ?, ?, ?, ?)`
				).run(target, d.season, d.key, d.folder, d.series.title);
			resequenceAnime(db, target);
			const journal: MergeJournal = { target, order, entries, snapshots, works, workMembers };
			writeJournal(db, journal, now);
			reserveReservations(db, journal, now);
			return { seriesId: target, seasons: order.length, order };
		})
		.immediate();
}

/**
 * Whether a Work id is one a merge holds open, not a Work the owner can see
 * (c283, round 2). The sheet's ADD TO A WORK list reads this so a placeholder
 * never appears there; every other Work reader joins `work_series`, which a
 * placeholder has none of.
 */
export function isReservedWork(workId: number): boolean {
	return !!getDb()
		.prepare(`SELECT 1 FROM works WHERE id = ? AND reserve_at IS NOT NULL`)
		.get(workId);
}

/** What a series knows of a merge it is the show of, for the band and the screen. */
export function mergeState(seriesId: number): { seasons: number; madeAt: number } | null {
	const row = getDb()
		.prepare(`SELECT made_at, facts FROM season_merges WHERE series_id = ?`)
		.get(seriesId) as { made_at: number; facts: string } | undefined;
	if (!row) return null;
	return { seasons: (JSON.parse(row.facts) as MergeJournal).order.length, madeAt: row.made_at };
}

/**
 * UNGROUP a merged show: every season is a series of its own again, with its
 * own id, source, folder, link, rating, FAV, tags, shelves, Work and watched
 * state. The show's row is restored too, so a merge and its undo leave the
 * database as it was -- and whatever the show was used for in between rides
 * back to the series it belongs to (round 2).
 */
export function ungroupSeasons(seriesId: number, now = Date.now()): number[] {
	void now;
	const db = getDb();
	return db
		.transaction((): number[] => {
			const journal = readJournal(db, seriesId);
			if (!journal) throw new GroupingError('this series is not a merged show');
			const tables = seriesChildTables(db);
			restoreAll(db, journal, tables);
			db.prepare(`DELETE FROM season_merges WHERE series_id = ?`).run(seriesId);
			return journal.order;
		})
		.immediate();
}

/** A Work of one cannot exist: after a take-out, end any that was left. */
function endWorksOfOne(db: Database.Database) {
	db.prepare(
		`DELETE FROM works WHERE reserve_at IS NULL
			AND (SELECT COUNT(*) FROM work_series ws WHERE ws.work_id = works.id) < 2`
	).run();
}

/**
 * Take one season out of a merged show (S3's SEASONS · EDIT; no screen yet).
 * A season becomes a series of its own again with its source, link, files and
 * watched state; the show keeps the rest, renumbered. The first season is the
 * show's own row, so taking it out hands the show to the next season and puts
 * the first back as the series it was.
 */
export function takeOutSeason(seriesId: number, season: number, now = Date.now()): number {
	const db = getDb();
	return db
		.transaction((): number => {
			const journal = readJournal(db, seriesId);
			if (!journal) throw new GroupingError('this series is not a merged show');
			const idx = season - 1;
			if (!Number.isInteger(idx) || idx < 0 || idx >= journal.order.length)
				throw new GroupingError('no such season');
			if (journal.order.length < 2) throw new GroupingError('a show needs two seasons');
			const tables = seriesChildTables(db);
			const taken = journal.order[idx];
			const known = new Set(journal.entries.map((e) => e.id));

			// Two seasons: taking either out restores both, and the show is gone.
			if (journal.order.length === 2) {
				restoreAll(db, journal, tables);
				db.prepare(`DELETE FROM season_merges WHERE series_id = ?`).run(seriesId);
				endWorksOfOne(db);
				return taken;
			}

			if (idx > 0) {
				const snap = journal.snapshots[String(taken)];
				const showPath = seriesPathOf(db, seriesId);
				const liveFolders = liveSeasonFolders(db, journal);
				const liveHidden = liveHiddenOf(db, seriesId);
				releaseReservation(db, 'series', taken);
				// A Work the merge ended keeps its placeholder row: deleting it would
				// cascade the show's own membership, and the Work would end with no
				// reservation while the journal still lists it (round 2). One whose
				// id a stranger holds now is not the journal's, and the season's
				// membership must not land on it (round 3).
				const lostWorks = new Set<number>();
				for (const w of journal.works) {
					const id = Number(w.id);
					const row = db.prepare(`SELECT created_at FROM works WHERE id = ?`).get(id) as
						{ created_at: number } | undefined;
					if (!row) insertRow(db, 'works', w, 'plain');
					else if (!sameWorkMoment(row, w)) lostWorks.add(id);
				}
				insertRow(db, 'series', snap.series, 'plain');
				restoreSnapshot(db, taken, snap, lostWorks);
				// A hide made while merged is the show's; the season goes out
				// hidden with it (round 3).
				if (liveHidden !== null && liveHidden !== journalHidden(journal))
					applyHidden(db, taken, liveHidden);
				restoreEntries(
					db,
					journal,
					journal.entries.filter((e) => e.series_id === taken),
					showPath,
					liveFolders
				);
				// An episode added while merged: the one of this season goes with
				// it, the later ones renumber with the show, and the file's
				// `available` goes with it (rounds 2 and 3).
				const added = (
					db
						.prepare(`SELECT id, season, file, available FROM entries WHERE series_id = ?`)
						.all(seriesId) as {
						id: number;
						season: number | null;
						file: string;
						available: number;
					}[]
				).filter((e) => !known.has(e.id));
				const move = db.prepare(
					`UPDATE entries SET series_id = ?, season = ?, file = ?, available = ? WHERE id = ?`
				);
				for (const e of added) {
					if (e.season === null) continue;
					if (e.season === season) {
						const named = moveFileOnto(
							db,
							taken,
							showPath,
							e.file,
							e.available,
							liveFolders.get(taken) ?? null
						);
						move.run(taken, originalSeasonOf(journal, taken), named.file, named.available, e.id);
					} else if (e.season > season) move.run(seriesId, e.season - 1, e.file, e.available, e.id);
				}
				// A log, queue or failure the show wrote for this season's episodes
				// follows them out; the season's tracker state too (round 2).
				const seasonRows = [...SEASON_CARRIED].map((table) => ({
					table,
					rows: db
						.prepare(`SELECT * FROM ${quoteName(table)} WHERE series_id = ? AND season = ?`)
						.all(seriesId, season) as JsonRow[]
				}));
				for (const table of ENTRY_TABLES)
					db.prepare(
						`UPDATE ${quoteName(table)} SET series_id = ?
						WHERE series_id = ? AND entry_id IN (SELECT id FROM entries WHERE series_id = ?)`
					).run(taken, seriesId, taken);
				const at = idx + 1;
				db.prepare(`DELETE FROM series_season_facts WHERE series_id = ? AND season = ?`).run(
					seriesId,
					at
				);
				db.prepare(`DELETE FROM series_season_links WHERE series_id = ? AND season = ?`).run(
					seriesId,
					at
				);
				for (const table of SEASON_TABLES)
					db.prepare(`DELETE FROM ${quoteName(table)} WHERE series_id = ? AND season = ?`).run(
						seriesId,
						at
					);
				for (const group of seasonRows)
					for (const row of group.rows)
						insertRow(db, group.table, {
							...row,
							series_id: taken,
							// The season column is NOT NULL: a flat list has no number.
							season: originalSeasonOf(journal, taken) ?? 1
						});
				db.prepare(`UPDATE entries SET season = season - 1 WHERE series_id = ? AND season > ?`).run(
					seriesId,
					at
				);
				db.prepare(
					`UPDATE series_season_facts SET season = season - 1 WHERE series_id = ? AND season > ?`
				).run(seriesId, at);
				db.prepare(
					`UPDATE series_season_links SET season = season - 1 WHERE series_id = ? AND season > ?`
				).run(seriesId, at);
				for (const table of SEASON_TABLES)
					db.prepare(
						`UPDATE ${quoteName(table)} SET season = season - 1 WHERE series_id = ? AND season > ?`
					).run(seriesId, at);
				resequenceAnime(db, taken);
				resequenceAnime(db, seriesId);
				journal.order = journal.order.filter((id) => id !== taken);
				journal.entries = journal.entries.filter((e) => e.series_id !== taken);
				// A season out of the journal is out of its Work membership too: the
				// show's later UNGROUP must not reach the series the owner has since
				// made of it (round 4).
				journal.workMembers = (journal.workMembers ?? []).filter(
					(m) => Number(m.series_id) !== taken
				);
				delete journal.snapshots[String(taken)];
				writeJournal(db, journal, now);
				// A Work that ends here keeps its id reserved for the undo: reserve
				// after ending, never before, or a new Work takes the id (round 2).
				endWorksOfOne(db);
				reserveReservations(db, journal, now);
				return taken;
			}

			// The first season is the show's own row. Harvest the show as it
			// stands, put every series back, then hand the show to the next
			// season's row and renumber the rest from 1.
			const live = db.prepare(`SELECT * FROM series WHERE id = ?`).get(seriesId) as JsonRow;
			const facts = db
				.prepare(`SELECT * FROM series_season_facts WHERE series_id = ?`)
				.all(seriesId) as JsonRow[];
			const links = db
				.prepare(`SELECT * FROM series_season_links WHERE series_id = ?`)
				.all(seriesId) as JsonRow[];
			const seasonRows = SEASON_TABLES.map((table) => ({
				table,
				rows: db
					.prepare(`SELECT * FROM ${quoteName(table)} WHERE series_id = ?`)
					.all(seriesId) as JsonRow[]
			}));
			const tags = db
				.prepare(`SELECT tag_id FROM series_tags WHERE series_id = ?`)
				.all(seriesId) as { tag_id: number }[];
			const shelves = db
				.prepare(`SELECT collection_id FROM collection_series WHERE series_id = ?`)
				.all(seriesId) as { collection_id: number }[];

			restoreAll(db, journal, tables);
			const nextTarget = journal.order[idx + 1];
			// A Work the owner made around the show while merged follows the show
			// (the owner's decision, 2026-11-10), as its shelves do below.
			followShowIntoOwnersWork(db, journal, taken, nextTarget);
			// The show takes the first remaining season's folder that has one, as
			// the merge does, rather than the next season's empty one: a streaming
			// second season must not erase the last's files (round 3). The live
			// rows are the journal's again, with any folder the undo gave a gained
			// file.
			const nextPath =
				journal.order
					.slice(1)
					.map((id) => seriesPathOf(db, id))
					.find((path) => path !== '') ?? '';
			if (nextPath !== '')
				db.prepare(`UPDATE series SET path = ? WHERE id = ?`).run(nextPath, nextTarget);
			// The show's identity is the name and cover it was merged under, not
			// the first remaining season's own.
			for (const col of [
				'title',
				'cover_key',
				'cover_at',
				'cover_url',
				'cover_failed_at',
				'rating',
				'favourite',
				'hue',
				'added_at'
			])
				if (live[col] !== undefined)
					db.prepare(`UPDATE series SET ${quoteName(col)} = ? WHERE id = ?`).run(
						live[col] as never,
						nextTarget
					);
			db.prepare(`DELETE FROM series_season_facts WHERE series_id = ?`).run(nextTarget);
			db.prepare(`DELETE FROM series_season_links WHERE series_id = ?`).run(nextTarget);
			for (const table of SEASON_TABLES)
				db.prepare(`DELETE FROM ${quoteName(table)} WHERE series_id = ?`).run(nextTarget);
			db.prepare(`DELETE FROM series_tags WHERE series_id = ?`).run(nextTarget);
			db.prepare(`DELETE FROM collection_series WHERE series_id = ?`).run(nextTarget);
			for (const row of facts) {
				const n = Number(row.season);
				if (n <= 1) continue;
				db.prepare(
					`INSERT INTO series_season_facts (series_id, season, origin_key, folder, source_title)
					VALUES (?, ?, ?, ?, ?)`
				).run(
					nextTarget,
					n - 1,
					row.origin_key as never,
					row.folder as never,
					row.source_title as never
				);
			}
			for (const row of links) {
				const n = Number(row.season);
				if (n <= 1) continue;
				insertRow(db, 'series_season_links', { ...row, series_id: nextTarget, season: n - 1 });
			}
			for (const group of seasonRows)
				for (const row of group.rows) {
					const n = Number(row.season);
					if (n <= 1) continue;
					insertRow(db, group.table, { ...row, series_id: nextTarget, season: n - 1 });
				}
			for (const t of tags)
				db.prepare(`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
					nextTarget,
					t.tag_id
				);
			for (const s of shelves)
				db.prepare(
					`INSERT OR IGNORE INTO collection_series (collection_id, series_id) VALUES (?, ?)`
				).run(s.collection_id, nextTarget);
			// The show's Work membership is the journal's, restored above: the
			// next season keeps its own place, and the taken-out first season keeps
			// its own like any taken-out season. The show is not reinserted into a
			// Work the owner made around it since, and the Work it was in is not
			// ended by the restore (round 4).
			// The episodes of the seasons that stay move to the new show, named
			// from its folder now, and `available` goes with the file (round 3).
			const liveFolders = new Map<number, string | null>();
			for (const row of facts)
				liveFolders.set(
					journal.order[Number(row.season) - 1] ?? nextTarget,
					row.folder as string | null
				);
			for (let i = 1; i < journal.order.length; i++) {
				const id = journal.order[i];
				const fromPath = seriesPathOf(db, id);
				const rows = db
					.prepare(`SELECT id, file, available FROM entries WHERE series_id = ?`)
					.all(id) as { id: number; file: string; available: number }[];
				const move = db.prepare(
					`UPDATE entries SET series_id = ?, season = ?, file = ?, available = ? WHERE id = ?`
				);
				for (const e of rows) {
					const named = moveFileOnto(
						db,
						nextTarget,
						fromPath,
						e.file,
						e.available,
						liveFolders.get(id) ?? null
					);
					move.run(nextTarget, i, named.file, named.available, e.id);
				}
			}
			// The seasons that stay keep their reading log, queue and failures
			// before their old rows go (round 2).
			const gone = journal.order.slice(2);
			for (const table of ENTRY_TABLES)
				for (const id of gone)
					db.prepare(`UPDATE ${quoteName(table)} SET series_id = ? WHERE series_id = ?`).run(
						nextTarget,
						id
					);
			// The other seasons' rows were put back whole by `restoreAll`; their
			// content is the show's now, so only the taken-out season and the new
			// show keep a row.
			for (const id of gone) db.prepare(`DELETE FROM series WHERE id = ?`).run(id);
			journal.order = journal.order.slice(1);
			journal.snapshots = Object.fromEntries(
				journal.order.map((id) => [String(id), journal.snapshots[String(id)]])
			);
			journal.target = nextTarget;
			journal.entries = journal.entries.filter((e) => e.series_id !== taken);
			// The taken-out season is the journal's no more (round 4).
			journal.workMembers = (journal.workMembers ?? []).filter(
				(m) => Number(m.series_id) !== taken
			);
			writeJournal(db, journal, now, seriesId);
			// A Work that ends here keeps its id reserved for the undo (round 2).
			endWorksOfOne(db);
			reserveReservations(db, journal, now);
			return taken;
		})
		.immediate();
}
