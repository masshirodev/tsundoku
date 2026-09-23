import type Database from 'better-sqlite3';
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

export type GroupResult = { seriesId: number; entryIds: number[] };

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
				target = Number(
					db
						.prepare(
							`INSERT INTO series (root_id, title, kind, rating, favourite, hidden, hue, added_at, indexed_at, source)
							VALUES (?, ?, 'doujin', 0, 0, ?, ?, ?, ?, ?)`
						)
						.run(
							root,
							name,
							Math.max(...singles.map((s) => s.hidden)),
							hueFor(name),
							Math.min(...singles.map((s) => s.added_at)),
							now,
							singles.every((s) => s.source === singles[0].source) ? singles[0].source : ''
						).lastInsertRowid
				);
				next = 1;
			}
			const entryIds = singles.map((s, i) => absorb(db, s, target, next + i));
			return { seriesId: target, entryIds };
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
							`INSERT INTO series (root_id, title, kind, rating, favourite, hidden, hue, added_at, indexed_at, source)
							VALUES (?, ?, 'doujin', ?, ?, ?, ?, ?, ?, ?)`
						)
						.run(
							series.root_id,
							title,
							e.rating,
							e.favourite,
							series.hidden,
							hueFor(title),
							e.added_at,
							now,
							series.source
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

const VISIBLE = `(s.hidden = 0 AND r.hidden = 0)`;

/** Visible doujin singletons: the only things a suggestion may name. */
function singletonCandidates(reveal: boolean): (Candidate & { hue: number; addedAt: number })[] {
	return getDb()
		.prepare(
			`SELECT s.id AS seriesId, s.title, s.hue, s.added_at AS addedAt
			FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.kind = 'doujin' AND ${reveal ? '1' : VISIBLE}
			AND (SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id) = 1`
		)
		.all() as (Candidate & { hue: number; addedAt: number })[];
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

export function rootOf(seriesId: number): number | null {
	const row = getDb().prepare(`SELECT root_id FROM series WHERE id = ?`).get(seriesId) as
		{ root_id: number } | undefined;
	return row?.root_id ?? null;
}
