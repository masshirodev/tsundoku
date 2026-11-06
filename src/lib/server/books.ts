import type Database from 'better-sqlite3';
import { posix } from './fspath.ts';
import { commonDir, fileIn, widenTo } from './paths.ts';
import { libraryWhere } from './visibility.ts';
import { getDb } from './db.ts';
import { hueFor } from '../library/cover.ts';
import { setKey, suggestionSets, type Candidate, type Suggestion } from '../library/books.ts';
import type { Rating } from '../library/types.ts';
import { kindFacts, kindsGrouped, type Kind } from '../library/kinds.ts';

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

/**
 * Move one singleton's book into `target` at `position`: its rating, favourite
 * and tags go onto the book, its title becomes the book's own, its log rows
 * follow it, and the emptied singleton is deleted.
 */
function absorb(db: Database.Database, singleton: SeriesRow, target: number, position: number) {
	const [entryId] = entryIdsOf(db, singleton.id);
	rehome(db, entryId, singleton.id, target);
	db.prepare(
		`UPDATE entries SET series_id = ?, position = ?,
			title = CASE WHEN title = '' THEN ? ELSE title END,
			rating = ?, favourite = ?
		WHERE id = ?`
	).run(target, position, singleton.title, singleton.rating, singleton.favourite, entryId);
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
		for (const e of entries) {
			move.run(
				target.id,
				next++,
				relative(targetPath, join(from, e.file)),
				e.volume || b.title,
				e.id
			);
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
				const set = db.prepare(
					`UPDATE entries SET series_id = ?, position = ?, file = ?, volume = '' WHERE id = ?`
				);
				vol.forEach((e, i) => set.run(single, i + 1, basename(abs), e.id));
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
				db.prepare(
					`UPDATE entries SET series_id = ?, position = 1, rating = 0, favourite = 0 WHERE id = ?`
				).run(single, e.id);
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
		rehome(db, entryId, fromSeries, toSeries);
		db.prepare(`UPDATE entries SET series_id = ?, position = ? WHERE id = ?`).run(
			toSeries,
			next,
			entryId
		);
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
 * as ONE-OFF counts it (`isBookSql`, c558), so a book with an extra or a
 * folded edition beside it is a candidate too.
 */
function singletonCandidates(
	reveal: boolean
): (Candidate & { hue: number; addedAt: number; cover: number | null })[] {
	return getDb()
		.prepare(
			`SELECT s.id AS seriesId, s.title, s.hue, s.added_at AS addedAt, s.cover_at AS cover
			FROM series s JOIN roots r ON r.id = s.root_id
			WHERE ${kindsIn('books')} AND ${libraryWhere(reveal)}
			AND (SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND ${isBookSql('e')}) = 1`
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
				rehome(db, entry, id, baseSeries);
				db.prepare(
					`UPDATE entries SET series_id = ?, position = ?, shadowed = 1, edition_of = ?,
						language = ?, edition_rows = ?
					WHERE id = ?`
				).run(baseSeries, position, baseEntry, lang, JSON.stringify(rowsOf(entry)), entry);
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
				const rows = JSON.parse(e.edition_rows ?? '[]') as { a: number | null; b: number | null }[];
				const page = own.last_position === null ? null : toEdition(rows, own.last_position);
				db.prepare(
					`UPDATE entries SET series_id = ?, position = 1, shadowed = 0, edition_of = NULL,
						edition_rows = NULL, read_at = ?, last_position = ?, last_opened_at = ?
					WHERE id = ?`
				).run(single, own.read_at, own.read_at === null ? page : null, own.last_opened_at, e.id);
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
