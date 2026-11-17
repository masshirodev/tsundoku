import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { HIDDEN_SQL, visibleWhere } from '../visibility.ts';
import { droppedLine, type Dropped } from './fold.ts';
import type { StartImport } from '../../library/start.ts';
import {
	closeDeadImports,
	importRow,
	type ImportOutcome,
	type ImportRow,
	type ImportState
} from './backup.ts';

/**
 * The IMPORT LOG (doc/IMPORT-BACKUP.md, "The log"): every import of a backup
 * and every scan, newest first, a running or waiting one too. Counts are read
 * through `series` and its root, so a series deleted since stops counting.
 *
 * An import takes everything, whatever the reveal mode, and its report says so:
 * with reveal off, what belongs to hidden series is counted apart
 * (`HiddenReport`, the section `HiddenFold.svelte` draws) and named nowhere.
 * Hidden means hidden on this screen too: the entry's own counts and lines
 * leave it out, and its titles and Work names appear only with reveal on.
 */

/**
 * What a job brought that belongs to hidden series, with reveal off: how many
 * and nothing else. Null when there is none, and
 * always with reveal on, where the entry's own counts and lines say it all.
 */
export type HiddenReport = {
	/** New series, hidden now. */
	fresh: number;
	/** Series already here and merged, hidden now. */
	merged: number;
	noSource: number;
	/** Lines of WORKS kept off the list because they name something hidden. */
	dropped: number;
};

/** What an import brought, as the viewer may see it. */
export type ImportCounts = {
	/** New series. */
	fresh: number;
	/** Series already here, merged. */
	merged: number;
	/** Series it brought whose source no installed extension provides now. */
	noSource: number;
};

export function importCounts(
	id: number,
	reveal: boolean,
	db: Database.Database = getDb()
): ImportCounts {
	const r = db
		.prepare(
			`SELECT
				COALESCE(SUM(i.created), 0) AS fresh,
				COALESCE(SUM(1 - i.created), 0) AS merged,
				COALESCE(SUM(NOT EXISTS (
					SELECT 1 FROM engine_sources es JOIN engine_extensions e ON e.pkg = es.pkg
					WHERE e.failed = '' AND s.origin_key LIKE 'mihon:' || es.id || ':%'
				)), 0) AS noSource
			FROM import_series i JOIN series s ON s.id = i.series_id JOIN roots r ON r.id = s.root_id
			WHERE i.import_id = ? AND ${visibleWhere(reveal)}`
		)
		.get(id) as ImportCounts;
	return r;
}

/**
 * The sources an import's series still lack, by name: the ones it lacked when
 * it ran, less any installed since. Named from what the file called them.
 */
export function sourcesLacking(
	id: number,
	reveal: boolean,
	db: Database.Database = getDb()
): string[] {
	const ids = new Set(
		(
			db
				.prepare(
					`SELECT DISTINCT substr(s.origin_key, 7, instr(substr(s.origin_key, 7), ':') - 1) AS id
					FROM import_series i JOIN series s ON s.id = i.series_id JOIN roots r ON r.id = s.root_id
					WHERE i.import_id = ? AND s.origin_key LIKE 'mihon:%' AND ${visibleWhere(reveal)}
						AND NOT EXISTS (
							SELECT 1 FROM engine_sources es JOIN engine_extensions e ON e.pkg = es.pkg
							WHERE e.failed = '' AND s.origin_key LIKE 'mihon:' || es.id || ':%')`
				)
				.all(id) as { id: string }[]
		).map((r) => r.id)
	);
	return (importRow(id, db)?.outcome.noSource ?? [])
		.filter((x) => ids.has(x.id))
		.map((x) => x.name);
}

/**
 * One Work a job's folds took a series out of (migration 71): the line the
 * summary printed (`droppedLine`), and the Work's id while that Work still
 * exists and the viewer may see it, so the line can open it.
 */
export type DroppedEntry = { line: string; workId: number | null };

/**
 * A drop as the job's row keeps it: fold.ts's record, and whether the survivor
 * was hidden the moment the fold finished (written by `runQueued`). A
 * fold hides the survivor when the part folded in was hidden, so this is the
 * one thing that remembers a Work was hidden once the Work has ended and its
 * parts are plain series. Absent on a job from before this was kept: nothing recorded it.
 */
export type KeptDrop = Dropped & { hiddenAtFold?: boolean };

/**
 * What a job's folds dropped, as the viewer may see it, and how many lines
 * that leaves out for belonging to something hidden. Hidden means hidden, and
 * with reveal off a line is drawn only when two things hold. First, its
 * survivor (the fold's own series) is visible now: a survivor deleted since,
 * or whose id another series has taken (`series.id` is reused, so the id
 * counts only with its `added_at`), cannot be read either way, and is shown
 * only with reveal on. Second, when the dropped Work still exists (its id
 * **and** `created_at` match a `works` row, and it did not end at the fold),
 * it has a visible part now. The second exists because a Work can be hidden
 * after its fold: the line prints that Work's name, and a Work that kept
 * three or more parts can be HIDE ALL'd later while the survivor stays
 * shown. A Work that ended, or whose id another Work now holds, can't be
 * asked, so the fold's own record answers: a survivor hidden at the fold
 * keeps the line off the list however it is shown today (unhiding the
 * survivor alone must not bring back the name of a Work whose other part is
 * still hidden). The link is to the Work by the same id and `created_at`, so
 * a Work that ended is never linked through the id a new Work took.
 *
 * A line left out is counted when it can be said to belong to something
 * hidden. One whose survivor is gone, about a Work that is gone, with no
 * record of either, can't be: it is neither drawn nor counted, as before.
 */
function readDropped(
	json: string,
	reveal: boolean,
	db: Database.Database
): { shown: DroppedEntry[]; hidden: number } {
	let list: unknown;
	try {
		list = JSON.parse(json);
	} catch {
		return { shown: [], hidden: 0 };
	}
	if (!Array.isArray(list)) return { shown: [], hidden: 0 };
	const seen = db.prepare(
		`SELECT 1 FROM series s JOIN roots r ON r.id = s.root_id
		WHERE s.id = ? AND s.added_at = ? AND ${visibleWhere(reveal)}`
	);
	const here = db.prepare(`SELECT 1 FROM series WHERE id = ? AND added_at = ?`);
	const work = db.prepare(
		`SELECT 1 FROM works w WHERE w.id = ? AND w.created_at = ? AND (? OR EXISTS (
			SELECT 1 FROM work_series ws JOIN series s ON s.id = ws.series_id JOIN roots r ON r.id = s.root_id
			WHERE ws.work_id = w.id AND ${visibleWhere(false)}))`
	);
	const alive = db.prepare(`SELECT 1 FROM works WHERE id = ? AND created_at = ?`);
	const shown: DroppedEntry[] = [];
	let hidden = 0;
	for (const d of (list as Partial<KeptDrop>[]).filter(
		(d): d is KeptDrop => !!d && typeof d.work === 'string' && typeof d.series === 'string'
	)) {
		const series = [d.seriesId ?? -1, d.seriesAt ?? -1];
		const owner = [d.workId ?? -1, d.workAt ?? -1];
		const gone = d.ended || !alive.get(...owner);
		const shownWork = !gone && !!work.get(...owner, 0);
		const visible = !!seen.get(...series);
		if (reveal || (visible && (gone ? !d.hiddenAtFold : shownWork)))
			shown.push({
				line: droppedLine(d),
				workId: !d.ended && work.get(...owner, reveal ? 1 : 0) ? d.workId : null
			});
		else if (d.hiddenAtFold || (!visible && here.get(...series)) || (!gone && !shownWork))
			hidden += 1;
	}
	return { shown, hidden };
}

/** The lines of `readDropped` the viewer may see. */
export function droppedOf(
	json: string,
	reveal: boolean,
	db: Database.Database = getDb()
): DroppedEntry[] {
	return readDropped(json, reveal, db).shown;
}

/** What belongs to hidden series, or null when nothing does. */
function hiddenReport(counts: HiddenReport): HiddenReport | null {
	return Object.values(counts).some((n) => n > 0) ? counts : null;
}

export type LogEntry =
	| {
			kind: 'backup';
			id: number;
			/** Its scan job, which the library's band knows it by (`?job=`). */
			jobId: number | null;
			at: number;
			app: string;
			fileName: string;
			fileBytes: number;
			origin: string;
			state: ImportState;
			refusal: string;
			seriesTotal: number;
			seriesDone: number;
			counts: ImportCounts;
			outcome: ImportOutcome;
			/** Works its folds took a series out of. */
			dropped: DroppedEntry[];
			/** What belongs to hidden series, with reveal off. */
			hidden: HiddenReport | null;
	  }
	| {
			kind: 'scan';
			id: number;
			at: number;
			label: string;
			running: boolean;
			progress: number;
			series: number;
			failedFiles: number;
			/** Works its folds took a series out of. */
			dropped: DroppedEntry[];
			/** What belongs to hidden series, with reveal off. */
			hidden: HiddenReport | null;
	  };

/** What a job's folds dropped (`readDropped`); none for a job forgotten since. */
function jobDropped(jobId: number, reveal: boolean, db: Database.Database = getDb()) {
	const r = db.prepare(`SELECT dropped FROM scan_jobs WHERE id = ?`).get(jobId) as
		{ dropped: string } | undefined;
	return r ? readDropped(r.dropped, reveal, db) : { shown: [], hidden: 0 };
}

/** One import's entry, as the log and the result page draw it. */
export function backupEntry(row: ImportRow, reveal: boolean): LogEntry & { kind: 'backup' } {
	const counts = importCounts(row.id, reveal);
	const dropped = row.jobId === null ? { shown: [], hidden: 0 } : jobDropped(row.jobId, reveal);
	// Everything less what the viewer may see, so the two can't disagree.
	const all = reveal ? counts : importCounts(row.id, true);
	return {
		kind: 'backup',
		id: row.id,
		jobId: row.jobId,
		at: row.finishedAt ?? row.startedAt ?? row.createdAt,
		app: row.app,
		fileName: row.fileName,
		fileBytes: row.fileBytes,
		origin: row.origin,
		state: row.state,
		refusal: row.refusal,
		seriesTotal: row.seriesTotal,
		seriesDone: row.seriesDone,
		counts,
		outcome: row.outcome,
		dropped: dropped.shown,
		hidden: hiddenReport({
			fresh: all.fresh - counts.fresh,
			merged: all.merged - counts.merged,
			noSource: all.noSource - counts.noSource,
			dropped: dropped.hidden
		})
	};
}

/**
 * Every import and scan, newest first, a running or waiting one at the top.
 * A preview nobody imported is not an import and is not listed.
 */
export function importLog(reveal: boolean, db: Database.Database = getDb()): LogEntry[] {
	closeDeadImports(db);
	const imports = (
		db.prepare(`SELECT id FROM imports WHERE state != 'read' ORDER BY id DESC`).all() as {
			id: number;
		}[]
	)
		.map((r) => importRow(r.id, db))
		.filter((r): r is ImportRow => r !== null)
		.map((r) => backupEntry(r, reveal));
	const scans = (
		db
			.prepare(
				`SELECT j.id, j.started_at, j.finished_at, j.source_label, j.bytes_done, j.bytes_total,
					j.failed_files, j.dropped,
					(SELECT COUNT(*) FROM series s JOIN roots r ON r.id = s.root_id
						WHERE s.scan_job_id = j.id AND ${visibleWhere(reveal)}) AS series,
						(SELECT COUNT(*) FROM series s JOIN roots r ON r.id = s.root_id
							WHERE s.scan_job_id = j.id AND ${reveal ? '0' : HIDDEN_SQL}) AS hidden_series
				FROM scan_jobs j
				WHERE NOT EXISTS (SELECT 1 FROM imports i WHERE i.job_id = j.id)
				ORDER BY j.id DESC`
			)
			.all() as {
			id: number;
			started_at: number;
			finished_at: number | null;
			source_label: string;
			bytes_done: number;
			bytes_total: number;
			failed_files: number;
			dropped: string;
			series: number;
			hidden_series: number;
		}[]
	).map((j): LogEntry => {
		const dropped = readDropped(j.dropped, reveal, db);
		return {
			kind: 'scan',
			id: j.id,
			at: j.finished_at ?? j.started_at,
			label: j.source_label,
			running: j.finished_at === null,
			progress: j.bytes_total > 0 ? j.bytes_done / j.bytes_total : 0,
			series: j.series,
			failedFiles: j.failed_files,
			dropped: dropped.shown,
			hidden: hiddenReport({
				fresh: j.hidden_series,
				merged: 0,
				noSource: 0,
				dropped: dropped.hidden
			})
		};
	});
	const live = (e: LogEntry) =>
		e.kind === 'scan' ? e.running : e.state === 'running' || e.state === 'waiting';
	return [...imports, ...scans].sort(
		(a, b) => Number(live(b)) - Number(live(a)) || b.at - a.at || b.id - a.id
	);
}

/** The last import that came in, for SETTINGS > 05 and GET STARTED's done row. */
export function lastImport(reveal: boolean, db: Database.Database = getDb()) {
	const r = db
		.prepare(
			`SELECT id FROM imports WHERE state = 'done' ORDER BY finished_at DESC, id DESC LIMIT 1`
		)
		.get() as { id: number } | undefined;
	const row = r ? importRow(r.id, db) : null;
	return row ? backupEntry(row, reveal) : null;
}

/**
 * The import that ticked GET STARTED's 03, as its done row names it. "The
 * series that first ticked 03" is not recorded anywhere: nothing keeps the
 * moment a step ticks. It is derived from the first series 03 still counts --
 * the lowest insertion id among the visible series a scan or a backup brought
 * in (`startFacts`'s own rule) -- and that series' job. SQLite hands a new row
 * the highest id plus one, so the first row that made the count non-zero is the
 * lowest id still there; a row deleted since cannot be read either way. When
 * the job is an import's, the row names that import and its count; a scan's
 * job, a series with no job at all (written before jobs, or by hand), or no
 * series at all answers null, and the step keeps the scan's line. Only a
 * finished import names it: one still running, or one that failed partway, has
 * a partial count and has not ticked anything as done yet, so the step keeps
 * the scan's line until it is `done` (the same rule `lastImport` holds).
 */
export function tickingImport(
	reveal: boolean,
	db: Database.Database = getDb()
): StartImport | null {
	const first = db
		.prepare(
			`SELECT s.scan_job_id AS job FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.in_library = 1
				AND NOT (s.scan_job_id IS NULL AND s.origin_key IS NOT NULL)
				AND ${visibleWhere(reveal)}
			ORDER BY s.id LIMIT 1`
		)
		.get() as { job: number | null } | undefined;
	if (!first?.job) return null;
	const imp = db
		.prepare(`SELECT id FROM imports WHERE job_id = ? AND state = 'done' ORDER BY id DESC LIMIT 1`)
		.get(first.job) as { id: number } | undefined;
	if (!imp) return null;
	const row = importRow(imp.id, db);
	if (!row) return null;
	const counts = importCounts(imp.id, reveal, db);
	return { id: row.id, app: row.app, series: counts.fresh + counts.merged };
}

/** The import running or waiting, if one is: the sidebar's IMPORT LOG row counts it. */
export function liveImport(db: Database.Database = getDb()): ImportRow | null {
	closeDeadImports(db);
	const r = db
		.prepare(`SELECT id FROM imports WHERE state IN ('running', 'waiting') ORDER BY id LIMIT 1`)
		.get() as { id: number } | undefined;
	return r ? importRow(r.id, db) : null;
}
