/**
 * Works: the transactions behind the pure rules in `$lib/library/works.ts`
 * (doc/WORKS.md; card c216, first slice c275).
 *
 * A Work a level above series that merges nothing: a name, an order the owner
 * sets, and at most one Work per series. `work_series.series_id` is UNIQUE, so
 * adding a series that is already in another Work moves it -- and a Work left
 * with fewer than two series ends, exactly as taking a part out does. Both
 * paths go through `endIfOne`, because a rule at one door is not a rule. The
 * other door is not in this file at all: rung 61's `series_deleted_ends_work`
 * trigger ends the Work a deleted series is cascaded out of, so a delete that
 * never touches this module cannot leave a Work of one either.
 *
 * Rating and FAV are NOT a Work's own: they are each part's. Both setters
 * enforce the pure rule and then call the library's own write, so a linked
 * part still sends its tracker what its own RATING row would.
 */

import type Database from 'better-sqlite3';
import { getDb } from './db.ts';
import { HIDDEN_SQL, IN_LIBRARY_SQL, libraryWhere } from './visibility.ts';
import { setFavourite, setHidden, setRating } from './library.ts';
import { RATING_MAX } from '../library/rating.ts';
import { likePattern } from '../library/search.ts';
import { GRID_PAGE } from '../library/paging.ts';
import {
	defaultWorkName,
	workFavourite,
	workRating,
	type AddablePage,
	type AddableSeries,
	type WorkFootFacts,
	type WorkOrder,
	type WorkPart
} from '../library/works.ts';
import type { Kind, Rating } from '$lib/library/types';

export class WorkError extends Error {}

export type WorkRecord = {
	id: number;
	name: string;
	createdAt: number;
	orderMode: WorkOrder;
};

export type SeriesPlace = { seriesId: number; position: number };

/**
 * A Work an action ended, as it stood BEFORE that action: its row and every
 * member it had, the one that left included. UNDO restores the same id, name
 * and order, not a new Work.
 */
export type EndedWork = { work: WorkRecord; members: SeriesPlace[] };

/** What UNDO of a create needs: delete the Work, restore what it took. */
export type CreateFacts = {
	work: WorkRecord;
	members: SeriesPlace[];
	/** Series that came out of a Work that survived, and where they sat. */
	movedFrom: { seriesId: number; workId: number; position: number }[];
	/** Works the create left with fewer than two series. */
	ended: EndedWork[];
};

export type AddFacts = {
	workId: number;
	seriesId: number;
	/** The series' own name, carried so the band can say what was added: the
	 * page's lists have already changed by the time it renders. */
	title: string;
	position: number;
	/** The Work it came from, when that Work survived. */
	former: { workId: number; position: number } | null;
	ended: EndedWork[];
};

export type TakeOutFacts = {
	workId: number;
	seriesId: number;
	/** The series' own name, for the band (as in `AddFacts`). */
	title: string;
	position: number;
	/** Set when fewer than two series were left and the Work ended. */
	ended: EndedWork | null;
};

export type ReorderFacts = { workId: number; before: SeriesPlace[] };

export type RenameFacts = { workId: number; name: string };

export type UngroupFacts = { work: WorkRecord; members: SeriesPlace[] };

/** A part as the Work screen needs it: the pure part, plus what the run's row and the shelf say. */
export type WorkPartRow = WorkPart & {
	hidden: boolean;
	workId: number;
	/** The striped placeholder's hue, for a cover that has no thumbnail yet. */
	hue: number;
	/** The source's name ('asura', 'epub', '') for the run's kind · source · status line. */
	source: string;
	/**
	 * Entries that arrived after this part was last opened -- or after the Work
	 * was, when the part never has been: the run's "+4 NEW".
	 */
	newCount: number;
	/** Entries on disk: the run's "ALL DOWNLOADED" / "0 OF 98 DOWNLOADED". */
	downloaded: number;
	/** When its last counted chapter was read: the run's "FINISHED 12 MAR", or null. */
	finishedAt: number | null;
};

export type WorkPage = {
	work: WorkRecord;
	parts: WorkPartRow[];
	/**
	 * How many parts the Work holds, hidden ones included: `parts` is only what
	 * the viewer may see, and a rule about the whole Work has to know the
	 * difference (a reveal-off page cannot offer a Work-wide rating).
	 */
	total: number;
	/** The union of its parts' shelves, which is what the Work is on (doc/WORKS.md). */
	shelves: { id: number; name: string }[];
};

// ---- rows ---------------------------------------------------------------------

type FactsRow = {
	id: number;
	title: string;
	kind: Kind;
	addedAt: number;
	hidden: number;
	inLibrary: number;
};

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

function workRow(db: Database.Database, id: number): WorkRecord | undefined {
	return db
		.prepare(
			`SELECT id, name, created_at AS createdAt, order_mode AS orderMode FROM works WHERE id = ?`
		)
		.get(id) as WorkRecord | undefined;
}

function membersOf(db: Database.Database, workId: number): SeriesPlace[] {
	return db
		.prepare(
			`SELECT series_id AS seriesId, position FROM work_series
			WHERE work_id = ? ORDER BY position, series_id`
		)
		.all(workId) as SeriesPlace[];
}

/** A series with the facts grouping decides on, all of them in SQL's own rule. */
function factsOf(db: Database.Database, id: number): FactsRow | undefined {
	return db
		.prepare(
			`SELECT s.id, s.title, s.kind, s.added_at AS addedAt,
				${HIDDEN_SQL} AS hidden, ${IN_LIBRARY_SQL} AS inLibrary
			FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ?`
		)
		.get(id) as FactsRow | undefined;
}

/**
 * How a Work's parts agree on visibility: all hidden, all visible, or mixed
 * when one part has been hidden on its own. A Work is hidden or shown whole,
 * so every part is read rather than whichever row the planner returns first;
 * a mixed Work refuses every add until W4's HIDE settles it.
 */
type WorkVisibility = 'hidden' | 'visible' | 'mixed';

function workVisibility(db: Database.Database, workId: number): WorkVisibility | null {
	const rows = db
		.prepare(
			`SELECT ${HIDDEN_SQL} AS hidden
			FROM work_series ws JOIN series s ON s.id = ws.series_id JOIN roots r ON r.id = s.root_id
			WHERE ws.work_id = ?`
		)
		.all(workId) as { hidden: number }[];
	if (rows.length === 0) return null;
	const hidden = rows.filter((r) => r.hidden !== 0).length;
	if (hidden === 0) return 'visible';
	return hidden === rows.length ? 'hidden' : 'mixed';
}

const insertMember = (db: Database.Database) =>
	db.prepare(`INSERT OR REPLACE INTO work_series (work_id, series_id, position) VALUES (?, ?, ?)`);

/**
 * The one place the app's own removers end a Work of one (Works Calls, question
 * 5). Every path here that removes a part calls this after its write, handing
 * the membership as it stood BEFORE the action so UNDO can put the Work back
 * whole. A series deleted from the table itself never reaches this: rung 61's
 * trigger ends that Work, and there is no part left for UNDO to restore.
 */
function endIfOne(db: Database.Database, workId: number, before: SeriesPlace[]): EndedWork | null {
	if (membersOf(db, workId).length >= 2) return null;
	const work = workRow(db, workId);
	// The members go with the Work: the cascade is the delete, not a second one.
	db.prepare(`DELETE FROM works WHERE id = ?`).run(workId);
	return work ? { work, members: before } : null;
}

function restore(db: Database.Database, facts: { work: WorkRecord; members: SeriesPlace[] }): void {
	db.prepare(`INSERT INTO works (id, name, created_at, order_mode) VALUES (?, ?, ?, ?)`).run(
		facts.work.id,
		facts.work.name,
		facts.work.createdAt,
		facts.work.orderMode
	);
	const insert = insertMember(db);
	for (const m of facts.members) insert.run(facts.work.id, m.seriesId, m.position);
}

/** Positions in the order the sheet asked for; 'hand' keeps the selection's own. */
function orderedIds(rows: FactsRow[], order: WorkOrder): number[] {
	if (order === 'hand') return rows.map((r) => r.id);
	const copy = [...rows];
	if (order === 'added') copy.sort((a, b) => a.addedAt - b.addedAt || a.id - b.id);
	else
		copy.sort((a, b) =>
			a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' })
		);
	return copy.map((r) => r.id);
}

/** Every series a Work holds, hidden or not: for the writes that act on all of them. */
function allIds(db: Database.Database, workId: number): number[] {
	return (
		db
			.prepare(`SELECT series_id FROM work_series WHERE work_id = ? ORDER BY position, series_id`)
			.all(workId) as { series_id: number }[]
	).map((r) => r.series_id);
}

/** The number of memberships, which a filtered read cannot tell from its own rows. */
function memberCount(db: Database.Database, workId: number): number {
	return (
		db.prepare(`SELECT COUNT(*) AS n FROM work_series WHERE work_id = ?`).get(workId) as {
			n: number;
		}
	).n;
}

// ---- reads --------------------------------------------------------------------

/**
 * A Work's parts as the viewer may see them. Hidden and browsing records are
 * filtered in SQL with the library's own constants, so with reveal off a
 * hidden part never reaches the page (doc/LIBRARY.md, "Hidden means hidden").
 * `lastOpenedAt` is the most recent open of any of the part's entries, which
 * is what CONTINUE decides on; `entries` and `read` leave out front and back
 * matter, as the chapter counts do everywhere else. `newCount` and
 * `downloaded` come from the same grouped pass: the run asks every part's row
 * for them, and a correlated subquery per part is what W1 warned about. A
 * never-opened part's new chapters are read from the Work's last open, since
 * it has no last open of its own and otherwise could never say `+N NEW`.
 */
export function workParts(workId: number, reveal: boolean): WorkPartRow[] {
	return readParts(getDb(), [workId], libraryWhere(reveal));
}

/**
 * The parts of several Works in one read, for a library page that draws Work
 * tiles: one grouped pass over every part on the page, never `workParts` once
 * per tile (doc/handoff-notes/works.md, the W1 gaps).
 */
export function partsOfWorks(workIds: number[], reveal: boolean): WorkPartRow[] {
	if (workIds.length === 0) return [];
	return readParts(getDb(), workIds, libraryWhere(reveal));
}

/** Every part a Work holds, hidden or not: for the writes that act on all of them. */
function allParts(workId: number): WorkPartRow[] {
	return readParts(getDb(), [workId], '');
}

function readParts(db: Database.Database, workIds: number[], where: string): WorkPartRow[] {
	const ids = placeholders(workIds.length);
	const rows = db
		.prepare(
			`WITH part AS MATERIALIZED (
				SELECT ws.work_id AS workId, ws.series_id AS seriesId, ws.position
				FROM work_series ws WHERE ws.work_id IN (${ids})
			), opened AS MATERIALIZED (
				SELECT e.series_id, MAX(e.last_opened_at) AS at FROM entries e
				WHERE e.series_id IN (SELECT seriesId FROM part) GROUP BY e.series_id
			), work_opened AS MATERIALIZED (
				-- A never-opened part has no last open of its own, so "new" is
				-- measured from the last time the owner read any part of the Work.
				SELECT p.workId, MAX(e.last_opened_at) AS at FROM part p
				JOIN entries e ON e.series_id = p.seriesId GROUP BY p.workId
			), aggs AS MATERIALIZED (
				SELECT e.series_id,
					SUM(e.shadowed = 0 AND e.matter = '') AS entries,
					SUM(e.shadowed = 0 AND e.matter = '' AND e.read_at IS NOT NULL) AS read,
					SUM(CASE WHEN e.shadowed = 0 AND (e.added_at > COALESCE(o.at, wo.at)
						OR (e.read_at IS NULL AND COALESCE(e.arrived_at, 0) > COALESCE(o.at, wo.at)))
						THEN 1 ELSE 0 END) AS newCount,
					-- The same set the entries count uses: a shadowed duplicate and
					-- front or back matter are not chapters the run can say are on
					-- disk, and the library's own count leaves out a row with no
					-- file (src/lib/server/catalogue.ts). Counting every available
					-- row let ALL DOWNLOADED stand over a missing chapter and N
					-- exceed M on a book.
					SUM(e.shadowed = 0 AND e.matter = '' AND e.available = 1 AND e.file != '')
						AS downloaded,
					MAX(CASE WHEN e.shadowed = 0 AND e.matter = '' AND e.read_at IS NOT NULL
						THEN e.read_at END) AS finishedAt
				FROM entries e JOIN opened o ON o.series_id = e.series_id
				JOIN part p ON p.seriesId = e.series_id
				LEFT JOIN work_opened wo ON wo.workId = p.workId
				GROUP BY e.series_id
			)
			SELECT p.workId, p.seriesId, p.position, s.title, s.kind, s.hue, s.source,
				s.added_at AS addedAt,
				COALESCE(s.rating, 0) AS rating, s.favourite, s.cover_at AS cover, s.status,
				${HIDDEN_SQL} AS hidden,
				COALESCE(a.entries, 0) AS entries, COALESCE(a.read, 0) AS read,
				o.at AS lastOpenedAt,
				COALESCE(a.newCount, 0) AS newCount, COALESCE(a.downloaded, 0) AS downloaded,
				a.finishedAt
			FROM part p JOIN series s ON s.id = p.seriesId JOIN roots r ON r.id = s.root_id
			LEFT JOIN aggs a ON a.series_id = p.seriesId
			LEFT JOIN opened o ON o.series_id = p.seriesId
			WHERE 1 = 1${where ? ` AND ${where}` : ''}
			ORDER BY p.position, p.seriesId`
		)
		.all(...workIds) as (Omit<WorkPartRow, 'favourite' | 'hidden'> & {
		favourite: number;
		hidden: number;
	})[];
	return rows.map((r) => ({
		...r,
		favourite: r.favourite !== 0,
		hidden: r.hidden !== 0
	}));
}

/**
 * A Work and its parts, or null when it no longer exists or nothing of it is
 * visible: a Work is hidden or shown whole, so being unable to see any part
 * is being unable to see the Work. `total` is every member, so a page that can
 * see only some of them says so instead of applying a whole-Work rule to the
 * part it happened to see.
 */
export function workPage(workId: number, opts: { reveal: boolean }): WorkPage | null {
	const db = getDb();
	const work = workRow(db, workId);
	if (!work) return null;
	const parts = workParts(workId, opts.reveal);
	if (parts.length === 0) return null;
	return { work, parts, total: memberCount(db, workId), shelves: shelvesOf(db, workId) };
}

/** A Work's shelves: every collection any of its parts is on, which is what makes the Work be on it. */
function shelvesOf(db: Database.Database, workId: number): { id: number; name: string }[] {
	return db
		.prepare(
			`SELECT c.id, c.name FROM collections c WHERE c.id IN (
				SELECT cs.collection_id FROM collection_series cs
				WHERE cs.series_id IN (SELECT series_id FROM work_series WHERE work_id = ?)
			) ORDER BY c.position, c.id`
		)
		.all(workId) as { id: number; name: string }[];
}

/** The Works' own rows for a page of Work tiles: one query, however many the page holds. */
export function workRecords(ids: number[]): WorkRecord[] {
	if (ids.length === 0) return [];
	return getDb()
		.prepare(
			`SELECT id, name, created_at AS createdAt, order_mode AS orderMode FROM works
				WHERE id IN (${placeholders(ids.length)})`
		)
		.all(...ids) as WorkRecord[];
}

/**
 * Where each of these series sits in its Work, for the finding lists (search,
 * a tag filter, a person's page): "PART 2 OF 3" and the Work's name, in one
 * query. A series in no Work is absent from the map.
 */
export function workFeetFor(seriesIds: number[]): Map<number, WorkFootFacts> {
	if (seriesIds.length === 0) return new Map();
	const rows = getDb()
		.prepare(
			`SELECT ws.series_id AS seriesId, ws.work_id AS workId, ws.position,
				w.name, (SELECT COUNT(*) FROM work_series x WHERE x.work_id = ws.work_id) AS total
			FROM work_series ws JOIN works w ON w.id = ws.work_id
			WHERE ws.series_id IN (${placeholders(seriesIds.length)})`
		)
		.all(...seriesIds) as {
		seriesId: number;
		workId: number;
		position: number;
		name: string;
		total: number;
	}[];
	return new Map(
		rows.map((r) => [r.seriesId, { id: r.workId, name: r.name, part: r.position, of: r.total }])
	);
}

/**
 * The library a Work's + ADD A SERIES picker offers: everything the viewer can
 * see that is not already in it, with the Work it would move out of. A
 * browsing record is not offered (doc/BROWSING.md), and neither is anything a
 * diverged Work would refuse (W1's `workVisibility`).
 */
export function addableSeries(
	workId: number,
	reveal: boolean,
	opts: { q?: string; limit?: number; offset?: number } = {}
): AddablePage {
	const q = opts.q?.trim() ?? '';
	const limit =
		Number.isInteger(opts.limit) && opts.limit! > 0 ? Math.min(opts.limit!, GRID_PAGE) : GRID_PAGE;
	const offset = Number.isInteger(opts.offset) && opts.offset! > 0 ? opts.offset! : 0;
	const db = getDb();
	const where = `${libraryWhere(reveal)} AND s.id NOT IN (
		SELECT series_id FROM work_series WHERE work_id = ?)`;
	const filter = q === '' ? '' : ` AND s.title LIKE ? ESCAPE '\\'`;
	const params = q === '' ? [workId] : [workId, likePattern(q)];
	const total = (
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM series s JOIN roots r ON r.id = s.root_id WHERE ${where}${filter}`
			)
			.get(...params) as { n: number }
	).n;
	const items = db
		.prepare(
			`SELECT s.id AS seriesId, s.title, s.kind, s.hue, s.cover_at AS cover, w.name AS inWork
			FROM series s JOIN roots r ON r.id = s.root_id
			LEFT JOIN work_series ws ON ws.series_id = s.id LEFT JOIN works w ON w.id = ws.work_id
			WHERE ${where}${filter}
			ORDER BY s.title COLLATE NOCASE, s.id
			LIMIT ? OFFSET ?`
		)
		.all(...params, limit, offset) as AddableSeries[];
	return { items, total };
}

/** The Works a series belongs to at most one of; the row the series screen draws. */
export function workOfSeries(seriesId: number): WorkRecord | null {
	const db = getDb();
	const row = db.prepare(`SELECT work_id FROM work_series WHERE series_id = ?`).get(seriesId) as
		{ work_id: number } | undefined;
	return row ? (workRow(db, row.work_id) ?? null) : null;
}

// ---- writes -------------------------------------------------------------------

/**
 * Make a Work of the selected series, in the order the sheet asked for. It
 * refuses fewer than two, a series that is only a browsing record, and a
 * selection that mixes hidden with visible -- the books rule. A series already
 * in another Work moves here, and a Work that move leaves with one series ends
 * (its facts ride along so UNDO can put it back).
 */
export function createWork(opts: {
	seriesIds: number[];
	name?: string;
	order?: WorkOrder;
	now?: number;
}): CreateFacts {
	const db = getDb();
	const now = opts.now ?? Date.now();
	const order = opts.order ?? 'hand';
	const ids = [...opts.seriesIds];
	if (new Set(ids).size !== ids.length) throw new WorkError('a series can only be in a Work once');
	if (ids.length < 2) throw new WorkError('a Work needs at least two series');
	return db
		.transaction((): CreateFacts => {
			const rows = ids.map((id) => factsOf(db, id));
			if (rows.some((r) => !r)) throw new WorkError('a series no longer exists');
			const found = rows as FactsRow[];
			// Grouping refuses to mix hidden and visible in either direction, so a
			// hidden series never becomes visible by joining a Work.
			if (found.some((r) => r.hidden !== found[0].hidden))
				throw new WorkError("hidden and visible series can't share a Work");
			// A browsing record is on no shelf (doc/BROWSING.md), so it is not part
			// of the library a Work shows.
			if (found.some((r) => !r.inLibrary))
				throw new WorkError('a browsing record cannot join a Work');
			const name = (opts.name ?? defaultWorkName(found.map((r) => r.title))).trim();
			if (name === '') throw new WorkError('a Work needs a name: the titles share no words');
			const workId = Number(
				db
					.prepare(`INSERT INTO works (name, created_at, order_mode) VALUES (?, ?, ?)`)
					.run(name, now, order).lastInsertRowid
			);
			const ordered = orderedIds(found, order);
			const former = new Map<number, { workId: number; position: number }>();
			for (const id of ordered) {
				const f = db
					.prepare(`SELECT work_id AS workId, position FROM work_series WHERE series_id = ?`)
					.get(id) as { workId: number; position: number } | undefined;
				if (f) former.set(id, f);
			}
			const snapshots = new Map<number, SeriesPlace[]>();
			for (const f of former.values())
				if (!snapshots.has(f.workId)) snapshots.set(f.workId, membersOf(db, f.workId));
			db.prepare(
				`DELETE FROM work_series WHERE series_id IN (${placeholders(ordered.length)})`
			).run(...ordered);
			const insert = insertMember(db);
			ordered.forEach((id, i) => insert.run(workId, id, i + 1));
			const ended: EndedWork[] = [];
			for (const [leftId, before] of snapshots) {
				const e = endIfOne(db, leftId, before);
				if (e) ended.push(e);
			}
			const movedFrom = [...former.entries()]
				.filter(([, f]) => !ended.some((e) => e.work.id === f.workId))
				.map(([seriesId, f]) => ({ seriesId, workId: f.workId, position: f.position }));
			return {
				work: workRow(db, workId)!,
				members: membersOf(db, workId),
				movedFrom,
				ended
			};
		})
		.immediate();
}

/** UNDO of a create: the Work goes, and every series it took goes back where it was. */
export function undoCreate(facts: CreateFacts): void {
	const db = getDb();
	db.transaction(() => {
		db.prepare(`DELETE FROM works WHERE id = ?`).run(facts.work.id);
		// Ended Works go back after the delete, so a series can't be in two at once.
		for (const e of facts.ended) restore(db, e);
		const insert = insertMember(db);
		for (const m of facts.movedFrom) insert.run(m.workId, m.seriesId, m.position);
	}).immediate();
}

/**
 * Add one series to the end of a Work. It moves here if it is already in
 * another Work -- a series belongs to one Work at most -- and that Work ends
 * if the move leaves it with one series. Visibility must still match.
 */
export function addSeries(workId: number, seriesId: number): AddFacts {
	const db = getDb();
	return db
		.transaction((): AddFacts => {
			const work = workRow(db, workId);
			if (!work) throw new WorkError('no such Work');
			const facts = factsOf(db, seriesId);
			if (!facts) throw new WorkError('a series no longer exists');
			if (!facts.inLibrary) throw new WorkError('a browsing record cannot join a Work');
			const hidden = workVisibility(db, workId);
			if (hidden === 'mixed')
				throw new WorkError('a Work whose parts are hidden differently cannot take another');
			if (hidden !== null && (hidden === 'hidden') !== (facts.hidden !== 0))
				throw new WorkError("hidden and visible series can't share a Work");
			const formerRow = db
				.prepare(`SELECT work_id AS workId, position FROM work_series WHERE series_id = ?`)
				.get(seriesId) as { workId: number; position: number } | undefined;
			if (formerRow?.workId === workId) throw new WorkError('that series is already in this Work');
			const before = formerRow ? membersOf(db, formerRow.workId) : null;
			db.prepare(`DELETE FROM work_series WHERE series_id = ?`).run(seriesId);
			const position =
				((
					db
						.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM work_series WHERE work_id = ?`)
						.get(workId) as { p: number }
				).p ?? 0) + 1;
			insertMember(db).run(workId, seriesId, position);
			const ended = formerRow && before ? endIfOne(db, formerRow.workId, before) : null;
			const former =
				formerRow && !ended ? { workId: formerRow.workId, position: formerRow.position } : null;
			return {
				workId,
				seriesId,
				title: facts.title,
				position,
				former,
				ended: ended ? [ended] : []
			};
		})
		.immediate();
}

/** UNDO of an add: the series leaves, and the Work it came from is put back. */
export function undoAdd(facts: AddFacts): void {
	getDb()
		.transaction(() => {
			const db = getDb();
			db.prepare(`DELETE FROM work_series WHERE work_id = ? AND series_id = ?`).run(
				facts.workId,
				facts.seriesId
			);
			for (const e of facts.ended) restore(db, e);
			if (facts.former)
				insertMember(db).run(facts.former.workId, facts.seriesId, facts.former.position);
		})
		.immediate();
}

/**
 * Take one series out of a Work. Fewer than two left ends the Work: the row
 * goes and UNDO gets the name, the order and every member back, the removed
 * one included.
 */
export function takeOut(workId: number, seriesId: number): TakeOutFacts {
	const db = getDb();
	return db
		.transaction((): TakeOutFacts => {
			if (!workRow(db, workId)) throw new WorkError('no such Work');
			const before = membersOf(db, workId);
			const member = before.find((m) => m.seriesId === seriesId);
			if (!member) throw new WorkError('that series is not in this Work');
			db.prepare(`DELETE FROM work_series WHERE work_id = ? AND series_id = ?`).run(
				workId,
				seriesId
			);
			const ended = endIfOne(db, workId, before);
			return {
				workId,
				seriesId,
				title: factsOf(db, seriesId)?.title ?? '',
				position: member.position,
				ended
			};
		})
		.immediate();
}

/** UNDO of a take-out: the series goes back at its place, or the whole Work comes back. */
export function undoTakeOut(facts: TakeOutFacts): void {
	const db = getDb();
	db.transaction(() => {
		if (facts.ended) restore(db, facts.ended);
		else insertMember(db).run(facts.workId, facts.seriesId, facts.position);
	}).immediate();
}

/**
 * Rewrite a Work's order from the whole list, positions from 1. A partial list
 * is a bug, not a convenience: it would leave the parts it names first and the
 * rest wherever they fell.
 */
export function reorder(workId: number, seriesIds: number[]): ReorderFacts {
	const db = getDb();
	return db
		.transaction((): ReorderFacts => {
			if (!workRow(db, workId)) throw new WorkError('no such Work');
			const before = membersOf(db, workId);
			const have = new Set(before.map((m) => m.seriesId));
			if (
				seriesIds.length !== before.length ||
				new Set(seriesIds).size !== seriesIds.length ||
				seriesIds.some((id) => !have.has(id))
			)
				throw new WorkError('a reorder takes every series of the Work, once');
			const update = db.prepare(
				`UPDATE work_series SET position = ? WHERE work_id = ? AND series_id = ?`
			);
			seriesIds.forEach((id, i) => update.run(i + 1, workId, id));
			return { workId, before };
		})
		.immediate();
}

/** UNDO of a reorder: every position goes back to what it was. */
export function undoReorder(facts: ReorderFacts): void {
	const db = getDb();
	const update = db.prepare(
		`UPDATE work_series SET position = ? WHERE work_id = ? AND series_id = ?`
	);
	db.transaction(() => {
		for (const m of facts.before) update.run(m.position, facts.workId, m.seriesId);
	}).immediate();
}

export function rename(workId: number, name: string): RenameFacts {
	const db = getDb();
	const trimmed = name.trim();
	if (trimmed === '') throw new WorkError('a Work needs a name');
	return db
		.transaction((): RenameFacts => {
			const work = workRow(db, workId);
			if (!work) throw new WorkError('no such Work');
			db.prepare(`UPDATE works SET name = ? WHERE id = ?`).run(trimmed, workId);
			return { workId, name: work.name };
		})
		.immediate();
}

/** UNDO of a rename: the old name, by the same function the screen would call. */
export function undoRename(facts: RenameFacts): void {
	getDb().prepare(`UPDATE works SET name = ? WHERE id = ?`).run(facts.name, facts.workId);
}

/** Take every series out and end the Work: the facts carry the whole row for UNDO. */
export function ungroup(workId: number): UngroupFacts {
	const db = getDb();
	return db
		.transaction((): UngroupFacts => {
			const work = workRow(db, workId);
			if (!work) throw new WorkError('no such Work');
			const members = membersOf(db, workId);
			db.prepare(`DELETE FROM works WHERE id = ?`).run(workId);
			return { work, members };
		})
		.immediate();
}

/** UNDO of an ungroup: the same Work, the same id and name and order. */
export function undoUngroup(facts: UngroupFacts): void {
	const db = getDb();
	db.transaction(() => {
		restore(db, facts);
	}).immediate();
}

/**
 * Set every part's rating, but only while the parts agree (doc/WORKS.md, "A
 * Work's rating and FAV"): mixed parts refuse, because one tap would otherwise
 * overwrite ratings given apart. The write goes through `library.setRating`,
 * so each part's tracker hears exactly what its own RATING row would send.
 */
export function setWorkRating(workId: number, rating: Rating): number {
	const db = getDb();
	if (!workRow(db, workId)) throw new WorkError('no such Work');
	if (!Number.isInteger(rating) || rating < 0 || rating > RATING_MAX)
		throw new WorkError('a rating is 0-10');
	const ids = allIds(db, workId);
	if (!workRating(allParts(workId), ids.length).settable)
		throw new WorkError('the parts are rated differently; rate them one at a time');
	return setRating(ids, rating);
}

/** Set every part's FAV, but only while the parts agree. FAV never goes to a tracker. */
export function setWorkFavourite(workId: number, favourite: boolean): number {
	const db = getDb();
	if (!workRow(db, workId)) throw new WorkError('no such Work');
	const ids = allIds(db, workId);
	if (!workFavourite(allParts(workId), ids.length).settable)
		throw new WorkError('only some parts are a favourite; set them one at a time');
	return setFavourite(ids, favourite);
}

/** HIDE or SHOW a whole Work: the library's own write, with every part's id. */
export function hideWork(workId: number, hidden: boolean): { ids: number[]; changed: number } {
	const db = getDb();
	if (!workRow(db, workId)) throw new WorkError('no such Work');
	const ids = allIds(db, workId);
	return { ids, changed: setHidden(ids, hidden) };
}

// ---- offers (W7 stores and undoes one) ----------------------------------------

/**
 * The key a dismissed Work offer is stored under. `work:` keeps it apart from
 * the books' sorted-id keys at a glance; the table is separate anyway, so no
 * reader of `suggestion_dismissals` ever sees one.
 */
export const workDismissalKey = (workId: number, seriesId: number) => `work:${workId}:${seriesId}`;

export function dismissWorkOffer(key: string, now = Date.now()): string {
	getDb()
		.prepare(`INSERT OR REPLACE INTO work_dismissals (series_ids, dismissed_at) VALUES (?, ?)`)
		.run(key, now);
	return key;
}

export function undoWorkOffer(key: string): void {
	getDb().prepare(`DELETE FROM work_dismissals WHERE series_ids = ?`).run(key);
}

export function workOfferDismissed(key: string): boolean {
	return (
		getDb().prepare(`SELECT 1 AS yes FROM work_dismissals WHERE series_ids = ?`).get(key) !==
		undefined
	);
}
