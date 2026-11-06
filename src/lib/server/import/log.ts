import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { visibleWhere } from '../visibility.ts';
import { droppedLine, type Dropped } from './fold.ts';
import {
	closeDeadImports,
	importRow,
	type ImportOutcome,
	type ImportRow,
	type ImportState
} from './backup.ts';

/**
 * The IMPORT LOG (c438, doc/IMPORT.md, "The log"): every import of a backup
 * and every scan, newest first, a running or waiting one too. Counts are read
 * through `series` and its root, so they follow reveal (a hidden series is not
 * counted with reveal off) and a series deleted since stops counting.
 */

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
 * One Work a job's folds took a series out of (c570, rung 71): the line the
 * summary printed (`droppedLine`), and the Work's id while that Work still
 * exists and the viewer may see it, so the line can open it.
 */
export type DroppedEntry = { line: string; workId: number | null };

/**
 * What a job's folds dropped, as the viewer may see it. Hidden means hidden:
 * the survivor is the fold's own series, and a Work is hidden or shown whole
 * (doc/WORKS.md), so a line whose survivor is hidden now is not shown with
 * reveal off (`from` hidden made the survivor hidden too, so this also
 * covers the Work it left). A survivor deleted since, or whose id another
 * series has taken (`series.id` is reused, so the id counts only with its
 * `added_at`), cannot be read either way, and is shown only with reveal on.
 * The link is to the Work by its id **and** `created_at`, so a Work that
 * ended is never linked through the id a new Work took (c583's class).
 */
export function droppedOf(
	json: string,
	reveal: boolean,
	db: Database.Database = getDb()
): DroppedEntry[] {
	let list: unknown;
	try {
		list = JSON.parse(json);
	} catch {
		return [];
	}
	if (!Array.isArray(list)) return [];
	const seen = db.prepare(
		`SELECT 1 FROM series s JOIN roots r ON r.id = s.root_id
		WHERE s.id = ? AND s.added_at = ? AND ${visibleWhere(reveal)}`
	);
	const work = db.prepare(
		`SELECT 1 FROM works w WHERE w.id = ? AND w.created_at = ? AND (? OR EXISTS (
			SELECT 1 FROM work_series ws JOIN series s ON s.id = ws.series_id JOIN roots r ON r.id = s.root_id
			WHERE ws.work_id = w.id AND ${visibleWhere(false)}))`
	);
	return (list as Partial<Dropped>[])
		.filter((d): d is Dropped => !!d && typeof d.work === 'string' && typeof d.series === 'string')
		.filter((d) => reveal || !!seen.get(d.seriesId ?? -1, d.seriesAt ?? -1))
		.map((d) => ({
			line: droppedLine(d),
			workId: !d.ended && work.get(d.workId ?? -1, d.workAt ?? -1, reveal ? 1 : 0) ? d.workId : null
		}));
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
			/** Works its folds took a series out of (c570). */
			dropped: DroppedEntry[];
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
			/** Works its folds took a series out of (c570). */
			dropped: DroppedEntry[];
	  };

/** What a job's folds dropped (`droppedOf`); none for a job forgotten since. */
function jobDropped(jobId: number, reveal: boolean, db: Database.Database = getDb()) {
	const r = db.prepare(`SELECT dropped FROM scan_jobs WHERE id = ?`).get(jobId) as
		{ dropped: string } | undefined;
	return r ? droppedOf(r.dropped, reveal, db) : [];
}

/** One import's entry, as the log and the result page draw it. */
export function backupEntry(row: ImportRow, reveal: boolean): LogEntry & { kind: 'backup' } {
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
		counts: importCounts(row.id, reveal),
		outcome: row.outcome,
		dropped: row.jobId === null ? [] : jobDropped(row.jobId, reveal)
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
						WHERE s.scan_job_id = j.id AND ${visibleWhere(reveal)}) AS series
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
		}[]
	).map((j): LogEntry => ({
		kind: 'scan',
		id: j.id,
		at: j.finished_at ?? j.started_at,
		label: j.source_label,
		running: j.finished_at === null,
		progress: j.bytes_total > 0 ? j.bytes_done / j.bytes_total : 0,
		series: j.series,
		failedFiles: j.failed_files,
		dropped: droppedOf(j.dropped, reveal, db)
	}));
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

/** The import running or waiting, if one is: the sidebar's IMPORT LOG row counts it. */
export function liveImport(db: Database.Database = getDb()): ImportRow | null {
	closeDeadImports(db);
	const r = db
		.prepare(`SELECT id FROM imports WHERE state IN ('running', 'waiting') ORDER BY id LIMIT 1`)
		.get() as { id: number } | undefined;
	return r ? importRow(r.id, db) : null;
}
