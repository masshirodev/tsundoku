import type Database from 'better-sqlite3';
import { posix } from 'node:path';
import { VISIBLE_SQL } from './visibility.ts';
import { getDb } from './db.ts';
import { hueFor } from '../library/cover.ts';
import { setKey, suggestionSets, type Candidate, type Suggestion } from '../library/books.ts';
import type { Rating } from '$lib/library/types';

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
	kind: string;
	rating: number;
	favourite: number;
	hidden: number;
	source: string;
	added_at: number;
};

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
		db
			.prepare(`SELECT id FROM entries WHERE series_id = ? ORDER BY position, id`)
			.all(seriesId) as {
			id: number;
		}[]
	).map((r) => r.id);
}

export class GroupingError extends Error {}

/** A series that is one doujin book, and so can be grouped. */
export function isSingleton(seriesId: number): boolean {
	const db = getDb();
	const s = seriesRow(db, seriesId);
	return !!s && s.kind === 'doujin' && entryIdsOf(db, seriesId).length === 1;
}

/**
 * Move one singleton's book into `target` at `position`: its rating, favourite
 * and tags go onto the book, its title becomes the book's own, its log rows
 * follow it, and the emptied singleton is deleted.
 */
function absorb(db: Database.Database, singleton: SeriesRow, target: number, position: number) {
	const [entryId] = entryIdsOf(db, singleton.id);
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
			if (singles.length > 0 && singles.every((r) => r.kind === 'novel'))
				return groupVolumes(db, singles, opts, now);
			for (const s of singles) {
				if (s.kind !== 'doujin' || entryIdsOf(db, s.id).length !== 1) {
					throw new GroupingError(`"${s.title}" is not a single book`);
				}
			}
			let target: number;
			let next: number;
			if (opts.into != null) {
				const t = seriesRow(db, opts.into);
				if (!t || t.kind !== 'doujin') throw new GroupingError('no such series of books');
				if (singles.some((s) => s.root_id !== t.root_id)) {
					throw new GroupingError('books from another library root cannot join this series');
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
				if (singles.some((s) => s.root_id !== root)) {
					throw new GroupingError('books from different library roots cannot share a series');
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

const { dirname, join, relative, basename } = posix;

/** The deepest folder every path is in. */
export function commonDir(paths: string[]): string {
	if (paths.length === 0) return '';
	const split = paths.map((p) => p.split('/'));
	const out: string[] = [];
	for (let i = 0; i < split[0].length; i++) {
		const part = split[0][i];
		if (split.some((p) => p[i] !== part)) break;
		out.push(part);
	}
	return out.join('/');
}

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
	if (books.some((b) => b.root_id !== root))
		throw new GroupingError('volumes from different library roots cannot share a series');
	let target: SeriesRow;
	if (opts.into != null) {
		const t = seriesRow(db, opts.into);
		if (!t || t.kind !== 'novel') throw new GroupingError('no such novel');
		if (t.root_id !== root)
			throw new GroupingError('volumes from another library root cannot join this series');
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
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, rating, favourite, hidden, public, hue, added_at,
						indexed_at, source, path, direction, description)
					VALUES (?, ?, 'novel', ?, ?, ?, ?, ?, ?, ?, 'epub', ?, ?, ?)`
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
					first.description
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
			if (!series || series.kind !== 'novel') throw new GroupingError('no such novel');
			const path = pathOf(db, seriesId);
			const extra = db
				.prepare(`SELECT public, direction, description FROM series WHERE id = ?`)
				.get(seriesId) as { public: number; direction: string | null; description: string };
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
								indexed_at, source, path, direction, description, origin_key)
							VALUES (?, ?, 'novel', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
		if (!to || !from || to.kind !== 'doujin') throw new GroupingError('no such series of books');
		if (to.root_id !== from.root_id)
			throw new GroupingError('books cannot move between library roots');
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

const VISIBLE = VISIBLE_SQL;

/** Visible doujin singletons: the only things a suggestion may name. */
function singletonCandidates(
	reveal: boolean
): (Candidate & { hue: number; addedAt: number; cover: number | null })[] {
	return getDb()
		.prepare(
			`SELECT s.id AS seriesId, s.title, s.hue, s.added_at AS addedAt, s.cover_at AS cover
			FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.kind = 'doujin' AND ${reveal ? '1' : VISIBLE}
			AND (SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id) = 1`
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
 * send a book. Grouping still refuses a target in another root.
 */
export function seriesOfBooks(reveal: boolean): BookSeriesOption[] {
	return getDb()
		.prepare(
			`SELECT s.id, s.title, s.root_id AS rootId,
				(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id) AS books
			FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.kind = 'doujin' AND ${reveal ? '1' : VISIBLE}
			AND (SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id) > 1
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
			WHERE s.kind = 'novel' AND ${reveal ? '1' : VISIBLE}
			ORDER BY s.title COLLATE NOCASE`
		)
		.all() as BookSeriesOption[];
}

export function rootOf(seriesId: number): number | null {
	const row = getDb().prepare(`SELECT root_id FROM series WHERE id = ?`).get(seriesId) as
		{ root_id: number } | undefined;
	return row?.root_id ?? null;
}
