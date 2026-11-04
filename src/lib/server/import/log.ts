import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { visibleWhere } from '../visibility.ts';
import { importRow, type ImportOutcome, type ImportRow, type ImportState } from './backup.ts';

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

export type LogEntry =
	| {
			kind: 'backup';
			id: number;
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
	  };

/** One import's entry, as the log and the result page draw it. */
export function backupEntry(row: ImportRow, reveal: boolean): LogEntry & { kind: 'backup' } {
	return {
		kind: 'backup',
		id: row.id,
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
		outcome: row.outcome
	};
}

/**
 * Every import and scan, newest first, a running or waiting one at the top.
 * A preview nobody imported is not an import and is not listed.
 */
export function importLog(reveal: boolean, db: Database.Database = getDb()): LogEntry[] {
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
					j.failed_files,
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
		failedFiles: j.failed_files
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
	const r = db
		.prepare(`SELECT id FROM imports WHERE state IN ('running', 'waiting') ORDER BY id LIMIT 1`)
		.get() as { id: number } | undefined;
	return r ? importRow(r.id, db) : null;
}
