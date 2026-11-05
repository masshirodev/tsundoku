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
	nextPart,
	partPlace,
	partState,
	workEndMode,
	workFavourite,
	workHeld,
	workRating,
	workRowLine,
	continuePart,
	offerMatch,
	offerReason,
	type OfferWork,
	inOrder,
	type AddablePage,
	type AddableSeries,
	type PartState,
	type WorkEnd,
	type WorkEndMode,
	type WorkFootFacts,
	type WorkNextPart,
	type WorkOrder,
	type WorkPart
} from '../library/works.ts';
import { effectiveDirection, type Direction } from '../library/series.ts';
import { kindDirection } from './series.ts';
import { readsOnline } from './pages/online.ts';
import type { Kind, Rating } from '../library/types.ts';

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
 * member it had, the one that left included. UNDO restores the same name,
 * order and moment of making, and the same id unless a newer Work holds it
 * (`restore`).
 */
export type EndedWork = { work: WorkRecord; members: SeriesPlace[] };

/** What UNDO of a create needs: delete the Work, restore what it took. */
export type CreateFacts = {
	work: WorkRecord;
	members: SeriesPlace[];
	/** Series that came out of a Work that survived, where they sat, and that
	 * Work's making (`createdAt`), so UNDO knows it from a newer one given its id. */
	movedFrom: {
		seriesId: number;
		workId: number;
		createdAt: number;
		/** That Work's name then, which a later UNDO finds it by (`locate`, c470). */
		name?: string;
		position: number;
	}[];
	/** Works the create left with fewer than two series. */
	ended: EndedWork[];
};

export type AddFacts = {
	workId: number;
	/** When that Work was made: `works.id` is reused, so the id alone does not
	 * say it is the same Work an UNDO finds there later. */
	workCreatedAt: number;
	/** That Work's name at the add: with `workCreatedAt`, how a later UNDO finds
	 * it once an earlier UNDO brought it back under a new id (`locate`, c470).
	 * Optional only for facts a page rendered before it was carried. */
	workName?: string;
	seriesId: number;
	/** The series' own name, carried so the band can say what was added: the
	 * page's lists have already changed by the time it renders. */
	title: string;
	position: number;
	/** The Work it came from, when that Work survived, when it was made, and its name. */
	former: { workId: number; createdAt: number; name?: string; position: number } | null;
	ended: EndedWork[];
};

export type TakeOutFacts = {
	workId: number;
	/** When that Work was made (as in `AddFacts`). */
	workCreatedAt: number;
	/** Its name at the take-out (as in `AddFacts`). */
	workName?: string;
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

/**
 * A membership written fresh: a plain INSERT, so `work_series.series_id`'s
 * UNIQUE raises rather than REPLACE quietly deleting another Work's row
 * (c308). Only the writes that have just cleared the series' old row use it
 * (`createWork`, `addSeries`); an UNDO puts a series back through `putBack`,
 * which first asks whether the place is still free.
 */
const insertMember = (db: Database.Database) =>
	db.prepare(`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, ?)`);

/** The series' title for a refusal, or its id when it has none. */
function titleOf(db: Database.Database, seriesId: number): string {
	const row = db.prepare(`SELECT title FROM series WHERE id = ?`).get(seriesId) as
		{ title: string } | undefined;
	return row?.title ?? `series ${seriesId}`;
}

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

/**
 * UNDO puts a series back where an action took it from -- but an UNDO is
 * pressed later, and the library may have moved on: the series added to
 * another Work since, deleted, or the Work it goes back to ended. Each of
 * those refuses (c308). Overwriting would take the series out of the Work it
 * is in now without `endIfOne`, and leave that Work with one member for good,
 * the state question 5 forbids. The caller's transaction rolls the whole UNDO
 * back, so a refusal never leaves it half done.
 */
function putBack(
	db: Database.Database,
	restored: Restored,
	ref: WorkRef,
	seriesId: number,
	position: number
): number {
	// The id alone is not the Work: `works.id` is reused once the newest Work
	// ends, so a Work made since may hold it. That Work is not the one the
	// series left, and putting the series into it would be the c308 class
	// again, silently (round 2). `locate` finds the Work itself, wherever an
	// UNDO has brought it back to (c470).
	const workId = locate(db, restored, ref);
	if (workId === null) throw new WorkError('the Work this UNDO puts it back into has ended');
	mustBeFree(db, workId, seriesId);
	insertMember(db).run(workId, seriesId, position);
	return workId;
}

/**
 * A Work as an UNDO's facts name it: its id at the time, when it was made,
 * and its name then (absent only in facts rendered before c470 carried it).
 */
type WorkRef = { id: number; createdAt: number; name?: string };

/**
 * The ids the Works one UNDO has brought back came back under, keyed by the
 * id and moment their facts name them. `restore` may give an ended Work a new
 * id, and the other facts of the same UNDO still name the old one, so every
 * later write into a Work resolves its id here first (round 2). It lives for
 * one press; a later press finds the Work through `locate`'s own lookup.
 */
type Restored = Map<string, number>;

const refKey = (ref: WorkRef) => `${ref.id}@${ref.createdAt}`;

/**
 * Where the Work a ref names is now, or null when it has ended (c470). An id
 * is not an identity across an UNDO: `restore` brings an ended Work back with
 * its own name, order and `created_at`, but under a new id when a newer Work
 * was given the old one. So, in order: the id this press's own `restore`
 * gave it; the id itself, while the Work there was made at the same moment;
 * then the one Work made at that moment under the same name -- the Work an
 * earlier, separate UNDO brought back. Two Works share a moment only when
 * made in one millisecond (a test's fixed clock), and a ref with no name then
 * resolves only when one Work has it, so the lookup never guesses between two.
 */
function locate(db: Database.Database, restored: Restored, ref: WorkRef): number | null {
	const mapped = restored.get(refKey(ref));
	if (mapped !== undefined) return workRow(db, mapped) ? mapped : null;
	if (workRow(db, ref.id)?.createdAt === ref.createdAt) return ref.id;
	const rows = db
		.prepare(`SELECT id, name FROM works WHERE created_at = ? AND id <> ?`)
		.all(ref.createdAt, ref.id) as { id: number; name: string }[];
	const same = ref.name === undefined ? rows : rows.filter((r) => r.name === ref.name);
	return same.length === 1 ? same[0].id : null;
}

/** A series an UNDO may put back: still in the library, and in no Work. */
function mustBeFree(db: Database.Database, workId: number, seriesId: number): void {
	if (!db.prepare(`SELECT 1 FROM series WHERE id = ?`).get(seriesId))
		throw new WorkError('a series this UNDO puts back is no longer in the library');
	const at = db
		.prepare(
			`SELECT w.id, w.name FROM work_series ws JOIN works w ON w.id = ws.work_id
				WHERE ws.series_id = ?`
		)
		.get(seriesId) as { id: number; name: string } | undefined;
	if (at)
		throw new WorkError(
			at.id === workId
				? `${titleOf(db, seriesId)} is already back in ${at.name}`
				: `${titleOf(db, seriesId)} is in ${at.name} now · take it out there first`
		);
}

/**
 * A Work an UNDO brings back, with its name, order and members, under its
 * own id -- unless a newer Work has been given that id since (`works.id` is a
 * plain INTEGER PRIMARY KEY, so the next Work made after the last one ended
 * reuses it), when it comes back under a new one rather than answer for that
 * Work. Returns the id it came back under, and records it in `restored` so
 * the rest of the same UNDO writes into this Work and not the newer one
 * (round 2). A second press of the same UNDO finds it already back and
 * refuses.
 */
function restore(
	db: Database.Database,
	restored: Restored,
	facts: { work: WorkRecord; members: SeriesPlace[] }
): number {
	// Back already, under its own id or, after an earlier UNDO, under a new one.
	const back = locate(db, restored, facts.work);
	if (back !== null && workRow(db, back)?.name === facts.work.name)
		throw new WorkError(`${facts.work.name} is already back`);
	// Every member first, so the refusal names the series that moved on. No
	// Work is this one yet (`locate` above), so any Work a member is in now is
	// another, whatever its id.
	for (const m of facts.members) mustBeFree(db, 0, m.seriesId);
	const taken = workRow(db, facts.work.id) !== undefined;
	const id = Number(
		db
			.prepare(`INSERT INTO works (id, name, created_at, order_mode) VALUES (?, ?, ?, ?)`)
			.run(
				taken ? null : facts.work.id,
				facts.work.name,
				facts.work.createdAt,
				facts.work.orderMode
			).lastInsertRowid
	);
	restored.set(refKey(facts.work), id);
	const insert = insertMember(db);
	for (const m of facts.members) insert.run(id, m.seriesId, m.position);
	return id;
}

/**
 * The last check of an UNDO that is not about to show or hide anything: a
 * Work it wrote into must not be left hidden in part (doc/WORKS.md, "The one
 * rule"). A series taken out and then hidden on its own, put back into a
 * visible Work, would be exactly the diverged state no door may make.
 */
function refuseMixed(db: Database.Database, workIds: Iterable<number>): void {
	for (const id of new Set(workIds))
		if (workVisibility(db, id) === 'mixed')
			throw new WorkError(
				"hidden and visible series can't share a Work · one was hidden or shown since"
			);
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
 * The Works a GROUP sheet can add to (W4; Works Calls, "Making and breaking a
 * Work"): each name and how many series it holds. One query, for the sheet's
 * ADD TO A WORK · N.
 */
export type WorkChoice = { id: number; name: string; series: number };

export function workChoices(): WorkChoice[] {
	return getDb()
		.prepare(
			`SELECT w.id, w.name, COUNT(ws.series_id) AS series FROM works w
				LEFT JOIN work_series ws ON ws.work_id = w.id
				GROUP BY w.id ORDER BY w.name COLLATE NOCASE, w.id`
		)
		.all() as WorkChoice[];
}

/**
 * Finding a person's page (Works Calls, question 7; Work-States 7): one row
 * per Work that has a series here -- "3 OF 3 HERE · UP NEXT: OSHI NO KO". It
 * says the run exists and is one tap away; it never pulls the Work's other
 * series onto the page. Two queries for the whole page: which Works these
 * series are in, then every part of those Works in one grouped pass.
 */
export type TagWork = {
	id: number;
	name: string;
	/** How many of this page's series are in it. */
	here: number;
	/** How many series the Work holds, hidden ones included. */
	of: number;
	/** The part CONTINUE opens, named; null once the run is read. */
	upNext: string | null;
};

export function worksOnTagPage(seriesIds: number[], reveal: boolean): TagWork[] {
	const uniq = [...new Set(seriesIds)];
	if (uniq.length === 0) return [];
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT ws.work_id AS id, w.name, COUNT(DISTINCT ws.series_id) AS here FROM work_series ws
				JOIN works w ON w.id = ws.work_id
				WHERE ws.series_id IN (${placeholders(uniq.length)})
				GROUP BY ws.work_id ORDER BY w.name COLLATE NOCASE, w.id`
		)
		.all(...uniq) as { id: number; name: string; here: number }[];
	const parts = partsOfWorks(
		rows.map((r) => r.id),
		reveal
	);
	return rows.flatMap((r) => {
		const mine = parts.filter((p) => p.workId === r.id);
		// A Work is hidden or shown whole: with reveal off, one of its parts being
		// unreadable means the Work is too, and the page says nothing of it.
		if (mine.length === 0) return [];
		const current = continuePart(mine);
		return [
			{
				id: r.id,
				name: r.name,
				here: r.here,
				of: memberCount(db, r.id),
				upNext: current ? current.title : null
			}
		];
	});
}

/**
 * One series' Work as the series screen's WORK row draws it (W5; Work-Row B3):
 * its place, its state, the neighbours its ← → cells open, and the next part
 * the read-through row offers. `mode` is the same rule the end page reads
 * (`workEndMode`), so the series screen and the end of a part cannot disagree.
 */
export type SeriesWorkPart = { seriesId: number; title: string };

export type SeriesWorkRow = {
	id: number;
	name: string;
	part: number;
	of: number;
	/** Where this part is: not started, in progress, caught up, read through. */
	state: PartState;
	mode: WorkEndMode;
	prev: SeriesWorkPart | null;
	next: SeriesWorkPart | null;
	/** The next part, in the shape the accent row and the end block both read. */
	nextPart: WorkNextPart | null;
	/** "YOU'RE IN NEW WAVES" when the run is already in another part; null otherwise. */
	youAreIn: string | null;
	/** "NEXT · ETERNAL FORCE": the neighbour's title, when the run is here. */
	nextTitle: string | null;
	/** This part is done and leads into an unstarted next one: the accent row. */
	accent: boolean;
};

export function seriesWorkRow(seriesId: number, reveal: boolean): SeriesWorkRow | null {
	const work = workOfSeries(seriesId);
	if (!work) return null;
	const parts = workParts(work.id, reveal);
	const place = partPlace(parts, seriesId);
	const current = parts.find((p) => p.seriesId === seriesId);
	if (!place || !current) return null;
	const ordered = inOrder(parts);
	const i = ordered.findIndex((p) => p.seriesId === seriesId);
	const mode = workEndMode(parts, seriesId);
	const line = workRowLine(parts, seriesId);
	// The row's accent is the pure row's own rule; `mode` stays for the end page,
	// which offers the next part however far into it the owner is.
	const next = line?.accent ? nextPart(parts, seriesId) : null;
	return {
		id: work.id,
		name: work.name,
		part: place.part,
		of: place.of,
		state: partState(current),
		mode,
		prev: i > 0 ? { seriesId: ordered[i - 1].seriesId, title: ordered[i - 1].title } : null,
		next:
			i + 1 < ordered.length
				? { seriesId: ordered[i + 1].seriesId, title: ordered[i + 1].title }
				: null,
		nextPart: next ? nextFacts(next) : null,
		youAreIn: line?.youAreIn ?? null,
		nextTitle: line?.nextTitle ?? null,
		accent: line?.accent ?? false
	};
}

/**
 * Where each of these series sits in its Work, for the finding lists (search,
 * a tag filter, a person's page): "PART 2 OF 3" and the Work's name, in one
 * query. A series in no Work is absent from the map.
 *
 * The part is a place, counted the way `partPlace` counts it (the members
 * before this one in `position, series_id` order, plus one), never the raw
 * `position`: a take-out leaves the others' positions alone, so after a
 * middle one goes the last part's position is past the count.
 */
export function workFeetFor(seriesIds: number[]): Map<number, WorkFootFacts> {
	if (seriesIds.length === 0) return new Map();
	const rows = getDb()
		.prepare(
			`SELECT ws.series_id AS seriesId, ws.work_id AS workId, w.name,
				(SELECT COUNT(*) FROM work_series x WHERE x.work_id = ws.work_id
					AND (x.position < ws.position
						OR (x.position = ws.position AND x.series_id <= ws.series_id))) AS part,
				(SELECT COUNT(*) FROM work_series x WHERE x.work_id = ws.work_id) AS total
			FROM work_series ws JOIN works w ON w.id = ws.work_id
			WHERE ws.series_id IN (${placeholders(seriesIds.length)})`
		)
		.all(...seriesIds) as {
		seriesId: number;
		workId: number;
		name: string;
		part: number;
		total: number;
	}[];
	return new Map(
		rows.map((r) => [r.seriesId, { id: r.workId, name: r.name, part: r.part, of: r.total }])
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

/** The first chapter START opens on the next part, and whether it can. */
export function workEndOf(seriesId: number, reveal: boolean): WorkEnd | null {
	const work = workOfSeries(seriesId);
	if (!work) return null;
	const parts = workParts(work.id, reveal);
	const place = partPlace(parts, seriesId);
	if (!place) return null;
	const mode = workEndMode(parts, seriesId);
	const next = mode === 'next' || mode === 'meanwhile' ? nextPart(parts, seriesId) : null;
	return {
		id: work.id,
		name: work.name,
		createdAt: work.createdAt,
		part: place.part,
		of: place.of,
		mode,
		next: next ? nextFacts(next) : null,
		held: mode === 'read' ? workHeld(parts) : null
	};
}

function nextFacts(p: WorkPartRow): WorkNextPart {
	const db = getDb();
	const series = db.prepare(`SELECT direction FROM series WHERE id = ?`).get(p.seriesId) as
		{ direction: Direction | null } | undefined;
	// The first chapter, never front or back matter and never a shadowed copy;
	// a part with only matter (unlikely) still offers its first row rather than
	// nothing.
	const first = (db
		.prepare(
			`SELECT id, COALESCE(episode_number, position) AS number, label, available FROM entries
				WHERE series_id = ? AND shadowed = 0 AND matter = '' ORDER BY position, id LIMIT 1`
		)
		.get(p.seriesId) ??
		db
			.prepare(
				`SELECT id, COALESCE(episode_number, position) AS number, label, available FROM entries
					WHERE series_id = ? AND shadowed = 0 ORDER BY position, id LIMIT 1`
			)
			.get(p.seriesId)) as
		{ id: number; number: number; label: string; available: number } | undefined;
	return {
		seriesId: p.seriesId,
		title: p.title,
		kind: p.kind,
		hue: p.hue,
		cover: p.cover,
		entries: p.entries,
		downloaded: p.downloaded,
		state: partState(p),
		direction: effectiveDirection(
			{ kind: p.kind, direction: series?.direction ?? null },
			kindDirection(p.kind)
		),
		source: p.source,
		entry: first
			? {
					id: first.id,
					number: first.number,
					label: first.label,
					available: first.available !== 0,
					online: first.available === 0 && readsOnline(first.id)
				}
			: null
	};
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
			type Former = { workId: number; createdAt: number; name: string; position: number };
			const former = new Map<number, Former>();
			for (const id of ordered) {
				const f = db
					.prepare(
						`SELECT ws.work_id AS workId, w.created_at AS createdAt, w.name, ws.position
							FROM work_series ws JOIN works w ON w.id = ws.work_id WHERE ws.series_id = ?`
					)
					.get(id) as Former | undefined;
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
				.map(([seriesId, f]) => ({
					seriesId,
					workId: f.workId,
					createdAt: f.createdAt,
					name: f.name,
					position: f.position
				}));
			return {
				work: workRow(db, workId)!,
				members: membersOf(db, workId),
				movedFrom,
				ended
			};
		})
		.immediate();
}

/**
 * UNDO of a create: the Work goes, and every series it took goes back where it
 * was. It refuses when the Work is no longer the one the create made -- ended,
 * or holding other series since -- because deleting it would take series out
 * that the create never put in.
 */
export function undoCreate(facts: CreateFacts): void {
	const db = getDb();
	db.transaction(() => {
		const now = membersOf(db, facts.work.id).map((m) => m.seriesId);
		const made = new Set(facts.members.map((m) => m.seriesId));
		// The same Work by id and the moment it was made: a rename since changes
		// nothing this UNDO puts back, so it does not count as a change here.
		const same = workRow(db, facts.work.id)?.createdAt === facts.work.createdAt;
		if (!same || now.length !== made.size || now.some((id) => !made.has(id)))
			throw new WorkError(`${facts.work.name} has changed since it was made · undo that first`);
		db.prepare(`DELETE FROM works WHERE id = ?`).run(facts.work.id);
		// Ended Works go back after the delete, so a series can't be in two at once.
		// A Work in `movedFrom` survived the create, so it is never one of
		// `ended`; the map is for a restore that took a newer Work's id, and
		// `putBack`'s check refuses a movedFrom Work that has ended since.
		const restored: Restored = new Map();
		const touched = facts.ended.map((e) => restore(db, restored, e));
		for (const m of facts.movedFrom)
			touched.push(
				putBack(
					db,
					restored,
					{ id: m.workId, createdAt: m.createdAt, name: m.name },
					m.seriesId,
					m.position
				)
			);
		refuseMixed(db, touched);
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
				.prepare(
					`SELECT ws.work_id AS workId, w.created_at AS createdAt, w.name, ws.position
						FROM work_series ws JOIN works w ON w.id = ws.work_id WHERE ws.series_id = ?`
				)
				.get(seriesId) as
				{ workId: number; createdAt: number; name: string; position: number } | undefined;
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
				formerRow && !ended
					? {
							workId: formerRow.workId,
							createdAt: formerRow.createdAt,
							name: formerRow.name,
							position: formerRow.position
						}
					: null;
			return {
				workId,
				workCreatedAt: work.createdAt,
				workName: work.name,
				seriesId,
				title: facts.title,
				position,
				former,
				ended: ended ? [ended] : []
			};
		})
		.immediate();
}

/**
 * UNDO of an add: the series leaves, and the Work it came from is put back.
 * A series that has since moved on to a third Work stays there: putting it
 * back would take it from that one (c308), so the UNDO refuses instead.
 */
export function undoAdd(facts: AddFacts): void {
	undoAdds([facts]);
}

/** Several adds' UNDO, last first, as one write: a refusal undoes none of them. */
export function undoAdds(list: AddFacts[]): void {
	const db = getDb();
	db.transaction(() => {
		const touched: number[] = [];
		const restored: Restored = new Map();
		for (const facts of [...list].reverse()) {
			// Only out of the Work it was added to: one made since under the same
			// id is another Work, and taking a series out of that one would skip
			// its `endIfOne` and leave it a Work of one (round 2). The Work itself
			// may be back under a new id since an earlier UNDO (c470).
			const into = locate(db, restored, {
				id: facts.workId,
				createdAt: facts.workCreatedAt,
				name: facts.workName
			});
			if (into === null) throw new WorkError('the Work this UNDO takes it out of has ended');
			const name = workRow(db, into)!.name;
			const out = db
				.prepare(`DELETE FROM work_series WHERE work_id = ? AND series_id = ?`)
				.run(into, facts.seriesId);
			// Taken out since, by hand or by this same UNDO pressed before: there
			// is nothing left for it to undo, and putting the series back where it
			// came from would act on a library that has moved on.
			if (out.changes === 0) {
				const now = db
					.prepare(
						`SELECT w.name FROM work_series ws JOIN works w ON w.id = ws.work_id
							WHERE ws.series_id = ?`
					)
					.get(facts.seriesId) as { name: string } | undefined;
				throw new WorkError(
					now
						? `${facts.title} is in ${now.name} now · take it out there first`
						: `${facts.title} is no longer in ${name}`
				);
			}
			// A take-out since may have left only one other part (c470): the add's
			// UNDO would then leave a Work of one, the state question 5 forbids.
			// Ending the Work here would undo the owner's grouping as a side
			// effect with no band of its own, so the UNDO refuses, and TAKE OUT on
			// the Work's screen, which ends it with its own UNDO, is the way.
			if (memberCount(db, into) < 2)
				throw new WorkError(
					`${name} would be left with one series · take ${facts.title} out on its screen instead`
				);
			for (const e of facts.ended) touched.push(restore(db, restored, e));
			if (facts.former)
				touched.push(
					putBack(
						db,
						restored,
						{
							id: facts.former.workId,
							createdAt: facts.former.createdAt,
							name: facts.former.name
						},
						facts.seriesId,
						facts.former.position
					)
				);
		}
		refuseMixed(db, touched);
	}).immediate();
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
			const work = workRow(db, workId);
			if (!work) throw new WorkError('no such Work');
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
				workCreatedAt: work.createdAt,
				workName: work.name,
				seriesId,
				title: factsOf(db, seriesId)?.title ?? '',
				position: member.position,
				ended
			};
		})
		.immediate();
}

/** One take-out put back, inside the caller's transaction; returns the Work it wrote into. */
function putTakeOutBack(db: Database.Database, restored: Restored, facts: TakeOutFacts): number {
	if (facts.ended) return restore(db, restored, facts.ended);
	return putBack(
		db,
		restored,
		{ id: facts.workId, createdAt: facts.workCreatedAt, name: facts.workName },
		facts.seriesId,
		facts.position
	);
}

/**
 * UNDO of a take-out: the series goes back at its place, or the whole Work
 * comes back -- refusing, never overwriting, when the library has moved on
 * (`putBack`, c308). This is the put-back half alone, with no check of the
 * Work's visibility, because a HIDE's UNDO puts a hidden series back and then
 * shows it: a caller that will not show anything afterwards uses
 * `undoTakeOuts`, and the library's HIDE UNDO uses `undoHideWhole`.
 */
export function undoTakeOut(facts: TakeOutFacts): void {
	const db = getDb();
	db.transaction(() => {
		putTakeOutBack(db, new Map(), facts);
	}).immediate();
}

/**
 * Several take-outs' UNDO, last first (the last is the one that ended the
 * Work, and it restores every member), as one write: a refusal undoes none.
 * It also refuses to leave a Work hidden in part -- a series hidden on its own
 * since it was taken out does not go back into a visible Work.
 */
export function undoTakeOuts(list: TakeOutFacts[]): void {
	const db = getDb();
	db.transaction(() => {
		const restored: Restored = new Map();
		const touched = [...list].reverse().map((f) => putTakeOutBack(db, restored, f));
		refuseMixed(db, touched);
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
		refuseMixed(db, [restore(db, new Map(), facts)]);
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

/**
 * HIDE or SHOW a whole Work: the same write as `setHiddenWhole`, from the
 * Work's id. `ids` is what the write changed (c390), which is what an UNDO of
 * it may put back; a part already as asked is not one of them.
 */
export function hideWork(workId: number, hidden: boolean): { ids: number[]; changed: number } {
	const db = getDb();
	if (!workRow(db, workId)) throw new WorkError('no such Work');
	const { ids } = setHiddenWhole(allIds(db, workId), hidden);
	return { ids, changed: ids.length };
}

/** The Works these series are parts of, once each. */
export function worksTouched(seriesIds: number[]): number[] {
	if (seriesIds.length === 0) return [];
	const rows = getDb()
		.prepare(
			`SELECT DISTINCT work_id AS id FROM work_series
				WHERE series_id IN (${placeholders(seriesIds.length)}) ORDER BY work_id`
		)
		.all(...seriesIds) as { id: number }[];
	return rows.map((r) => r.id);
}

/**
 * What `setHiddenWhole` did: the series whose visibility it changed, and
 * which of them were a Work's (c390). Only a change is reported, so an UNDO
 * that reverses `ids` puts back exactly what the press did, and never shows
 * a series that was hidden before it.
 */
export type WholeFacts = {
	/** Every series this write hid or showed: the Works' parts and the series in none. */
	ids: number[];
	/** Those of `ids` that are a Work's parts. */
	whole: number[];
	/** How many Works had a part change: what the band calls `THE WORK` or `2 WORKS`. */
	works: number;
};

/** Each series' visibility as SQL reads it: its own flag, or its root's unless made public. */
function hiddenNow(db: Database.Database, ids: number[]): Map<number, boolean> {
	if (ids.length === 0) return new Map();
	const rows = db
		.prepare(
			`SELECT s.id, ${HIDDEN_SQL} AS hidden FROM series s JOIN roots r ON r.id = s.root_id
				WHERE s.id IN (${placeholders(ids.length)})`
		)
		.all(...ids) as { id: number; hidden: number }[];
	return new Map(rows.map((r) => [r.id, r.hidden !== 0]));
}

/**
 * HIDE or SHOW series by id, with the one rule (doc/WORKS.md, "The one rule")
 * applied at the write rather than at the screen that asked: a part of a Work
 * takes its Work with it, every part, so no caller can leave a Work
 * half-hidden in either direction. A series in no Work is written exactly as
 * `setHidden` writes it.
 *
 * Every door that hides or shows series by id goes through here (the library's
 * `?/hide`, `?/bulk`, `?/hideAll`, `?/showAll` and their UNDOs, the series
 * screen's TAKE OUT and its UNDO, and an import's fold, `foldSeries`), so the
 * rule has one home. `hideWork` is the same write for a caller that already
 * holds a Work's id.
 *
 * Visibility is read before and after, inside the transaction, so the facts
 * name only what changed (c390): a part of an already-hidden Work, hidden
 * again by a selection that held it, is not something UNDO may show.
 */
export function setHiddenWhole(seriesIds: number[], hidden: boolean): WholeFacts {
	const db = getDb();
	return db
		.transaction((): WholeFacts => {
			const workOf = new Map<number, number>();
			for (const workId of worksTouched(seriesIds))
				for (const id of allIds(db, workId)) workOf.set(id, workId);
			const asked = [...new Set([...seriesIds, ...workOf.keys()])];
			const before = hiddenNow(db, asked);
			setHidden(asked, hidden);
			const after = hiddenNow(db, asked);
			// A HIDE that settles a Work some part of which was already hidden is
			// not one UNDO can take back: it could only show the parts it hid,
			// and leave the Work half-hidden again, or show the whole Work and a
			// part the owner had hidden. So such a Work stays out of the facts,
			// and its UNDO leaves it hidden -- when in doubt, hidden. UNHIDE has
			// no such case: its UNDO hides the Work whole, never too little.
			const settled = new Set<number>();
			if (hidden) for (const [id, workId] of workOf) if (before.get(id)) settled.add(workId);
			const ids = asked.filter(
				(id) =>
					after.has(id) && before.get(id) !== after.get(id) && !settled.has(workOf.get(id) ?? -1)
			);
			const changed = new Set(ids);
			// In each Work's own order, as `allIds` reads it.
			const whole = [...workOf.keys()].filter((id) => changed.has(id));
			return { ids, whole, works: new Set(whole.map((id) => workOf.get(id))).size };
		})
		.immediate();
}

/**
 * TAKE OUT, THEN HIDE over a selection (the library's `?/hideParts`): each
 * selected part leaves its Work, then the selection is hidden, in one write.
 * The hide still goes through the rule, so whatever is still a part when it
 * runs takes its Work with it rather than being hidden alone. Inside one
 * transaction a take-out cannot fail for a series `workOfSeries` has just
 * found in a Work, so the route's old catch-and-carry-on branch is gone.
 */
export function takeOutAndHide(seriesIds: number[]): { out: TakeOutFacts[]; facts: WholeFacts } {
	const db = getDb();
	return db
		.transaction(() => {
			const out: TakeOutFacts[] = [];
			for (const id of seriesIds) {
				const work = workOfSeries(id);
				if (work) out.push(takeOut(work.id, id));
			}
			return { out, facts: setHiddenWhole(seriesIds, true) };
		})
		.immediate();
}

/**
 * UNDO after a HIDE answer: every take-out put back (last first), then what
 * the HIDE changed shown again, through the rule, in one write. Put back
 * first, so the show sees each series in the Work it returns to and shows
 * that Work whole; then nothing it wrote into may be left hidden in part. A
 * refusal from either half rolls back both.
 */
export function undoHideWhole(facts: { hidden: number[]; out: TakeOutFacts[] }): void {
	const db = getDb();
	db.transaction(() => {
		const restored: Restored = new Map();
		const touched = [...facts.out].reverse().map((f) => putTakeOutBack(db, restored, f));
		// Showing a part shows its Work whole, so a part is shown only while
		// every hidden part of its Work is one this HIDE hid. A Work hidden
		// since by another press keeps its parts hidden, this one included:
		// UNDO never shows what it did not hide.
		const mine = new Set(facts.hidden);
		const hiddenNowOf = (workId: number) => {
			const parts = allIds(db, workId);
			const now = hiddenNow(db, parts);
			return parts.filter((id) => now.get(id));
		};
		const show = facts.hidden.filter((id) => {
			const work = workOfSeries(id);
			return !work || hiddenNowOf(work.id).every((p) => mine.has(p));
		});
		setHiddenWhole(show, false);
		refuseMixed(db, touched);
	}).immediate();
}

// ---- offers (W7 stores and undoes one) ----------------------------------------

/**
 * The key a dismissed Work offer is stored under: the Work's moment of making
 * and the series it was offered to. `work:` keeps it apart from the books'
 * sorted-id keys at a glance; the table is separate anyway, so no reader of
 * `suggestion_dismissals` ever sees one.
 *
 * Not the Work's id (W1 wrote `work:<workId>:<seriesId>`, and nothing stored
 * one before W7): an id is not an identity across an UNDO. Once the newest
 * Work ends the next one made is given its id, so a NOT THIS said to the old
 * Work would silence a different Work's offer; and an ended Work an UNDO
 * brings back under a new id is still the Work the owner said NOT THIS to.
 * `created_at` is what `restore` keeps, so it is what the key names.
 */
export const workDismissalKey = (work: { createdAt: number }, seriesId: number) =>
	`work:${work.createdAt}:${seriesId}`;

/** A key as a form posts it: `work:<moment>:<series id>`, or null for anything else. */
export function parseWorkDismissalKey(key: string): string | null {
	return /^work:\d{1,16}:\d{1,12}$/.test(key) ? key : null;
}

/** A series as the offer and the sheet's rows draw it. */
export type OfferSeries = {
	seriesId: number;
	title: string;
	hue: number;
	addedAt: number;
	cover: number | null;
};

/**
 * MIGHT CONTINUE <WORK> · AS PART N (W7; Works Calls, question 6): the one
 * Work a series' title continues (`offerMatch`), for the series' own screen.
 * Nothing joins here: REVIEW opens the sheet, and only its tap adds.
 */
export type WorkOffer = {
	workId: number;
	name: string;
	createdAt: number;
	/** The place it would take: last, one after the Work's parts. */
	part: number;
	/** `ITS TITLE STARTS WITH THE WORK'S NAME · THE WORK HOLDS 2 SERIES`. */
	reason: string;
	/** What NOT THIS stores (`workDismissalKey`). */
	key: string;
	/** The run as it stands, for the sheet's numbered rows above the newcomer. */
	parts: OfferSeries[];
	/** The newcomer itself, the sheet's ticked last row. */
	series: OfferSeries;
};

/**
 * The offer for one series, or null. None for a series already in a Work, a
 * browsing record, or a hidden series with reveal off; and none naming a Work
 * the series could not join -- one hidden differently from it, which with
 * reveal off is every Work with a hidden part, so a visible series' screen
 * never names a hidden Work -- or one the owner has said NOT THIS to. One read
 * of every Work's parts: a library holds few Works, and the stem rule has to
 * see every name and part title to find the longest.
 */
export function workOfferFor(seriesId: number, reveal: boolean): WorkOffer | null {
	const db = getDb();
	const me = factsOf(db, seriesId);
	if (!me || !me.inLibrary) return null;
	if (me.hidden !== 0 && !reveal) return null;
	if (db.prepare(`SELECT 1 FROM work_series WHERE series_id = ?`).get(seriesId)) return null;
	const rows = db
		.prepare(
			`SELECT ws.work_id AS workId, w.name, w.created_at AS createdAt,
				s.id AS seriesId, s.title, s.hue, s.added_at AS addedAt, s.cover_at AS cover,
				${HIDDEN_SQL} AS hidden
			FROM work_series ws JOIN works w ON w.id = ws.work_id
			JOIN series s ON s.id = ws.series_id JOIN roots r ON r.id = s.root_id
			ORDER BY ws.work_id, ws.position, ws.series_id`
		)
		.all() as (OfferSeries & {
		workId: number;
		name: string;
		createdAt: number;
		hidden: number;
	})[];
	const dismissed = new Set(
		(db.prepare(`SELECT series_ids FROM work_dismissals`).all() as { series_ids: string }[]).map(
			(r) => r.series_ids
		)
	);
	const byWork = new Map<number, typeof rows>();
	for (const r of rows) byWork.set(r.workId, [...(byWork.get(r.workId) ?? []), r]);
	const candidates: (OfferWork & { rows: typeof rows })[] = [];
	for (const [id, parts] of byWork) {
		const { name, createdAt } = parts[0];
		// Joinable only: `addSeries` refuses a Work hidden differently, and a
		// mixed Work refuses every add, so neither is offered.
		if (parts.some((p) => (p.hidden !== 0) !== (me.hidden !== 0))) continue;
		if (dismissed.has(workDismissalKey({ createdAt }, seriesId))) continue;
		candidates.push({ id, name, createdAt, parts: parts.map((p) => p.title), rows: parts });
	}
	const match = offerMatch(me.title, candidates);
	if (!match) return null;
	const work = candidates.find((c) => c.id === match.work.id)!;
	const own = (r: OfferSeries): OfferSeries => ({
		seriesId: r.seriesId,
		title: r.title,
		hue: r.hue,
		addedAt: r.addedAt,
		cover: r.cover
	});
	const self = db
		.prepare(
			`SELECT id AS seriesId, title, hue, added_at AS addedAt, cover_at AS cover
			FROM series WHERE id = ?`
		)
		.get(seriesId) as OfferSeries;
	return {
		workId: work.id,
		name: work.name,
		createdAt: work.createdAt,
		part: work.rows.length + 1,
		reason: offerReason(match),
		key: workDismissalKey(work, seriesId),
		parts: work.rows.map(own),
		series: own(self)
	};
}

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
