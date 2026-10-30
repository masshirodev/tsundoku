import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { snapshotName, stamp, toPrune, DEFAULT_TIERS, type Tiers } from '../backup/retention.ts';
import { dataPaths } from './data-dirs.ts';

/**
 * Database snapshots (doc/BACKUPS.md). The files on disk can be scanned again;
 * the database can't -- ratings, shelves, groupings, hidden flags and the
 * reading log exist nowhere else.
 *
 * A snapshot is `VACUUM INTO`: a consistent copy of the database as of one
 * transaction, taken while the server keeps it open in WAL mode, which a file
 * copy is not. It's written under a temporary name, checked, and only then
 * renamed into place, so a half-written or corrupt file is never counted as a
 * backup and never lets retention delete a good one.
 */

export function backupDir(): string {
	return dataPaths().backups;
}

/** `library` for data/library.sqlite: what the snapshots are named after. */
export const baseName = (dbPath: string) => basename(dbPath, extname(dbPath));

export type Snapshot = {
	path: string;
	bytes: number;
	userVersion: number;
	series: number;
	entries: number;
	pruned: string[];
};

export class BackupError extends Error {}

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** Open a snapshot read-only and make sure it's a database worth keeping. */
export function verify(path: string): Omit<Snapshot, 'path' | 'bytes' | 'pruned'> {
	const db = new Database(path, { readonly: true, fileMustExist: true });
	try {
		const check = db.pragma('integrity_check', { simple: true });
		if (check !== 'ok') throw new BackupError(`integrity_check: ${String(check)}`);
		const count = (table: string) =>
			(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
		return {
			userVersion: db.pragma('user_version', { simple: true }) as number,
			series: count('series'),
			entries: count('entries')
		};
	} finally {
		db.close();
	}
}

/** Write one snapshot of an open connection into `dir` under `name`. */
function writeInto(conn: Database.Database, dir: string, name: string): string {
	mkdirSync(dir, { recursive: true });
	const final = join(dir, name);
	const partial = `${final}.partial`;
	rmSync(partial, { force: true });
	try {
		conn.exec(`VACUUM INTO ${quote(partial)}`);
		verify(partial);
	} catch (e) {
		rmSync(partial, { force: true });
		throw e instanceof BackupError ? e : new BackupError(String(e));
	}
	renameSync(partial, final);
	return final;
}

/**
 * Snapshot the database at `dbPath` into `dir`, then prune `dir` to the
 * retention tiers. Opens its own read-only connection, so it runs beside the
 * server as well as without it.
 */
export function takeSnapshot(
	dbPath: string,
	opts: { dir?: string; now?: Date; tiers?: Tiers } = {}
): Snapshot {
	const dir = opts.dir ?? backupDir();
	const base = baseName(dbPath);
	const src = new Database(dbPath, { readonly: true, fileMustExist: true });
	let path: string;
	try {
		src.pragma('busy_timeout = 5000');
		path = writeInto(src, dir, snapshotName(base, opts.now ?? new Date()));
	} finally {
		src.close();
	}
	const pruned = toPrune(base, readdirSync(dir), opts.tiers ?? DEFAULT_TIERS);
	for (const name of pruned) rmSync(join(dir, name), { force: true });
	return { path, bytes: statSync(path).size, ...verify(path), pruned };
}

/**
 * Before a migration climbs a rung: a copy of the database as it was, named
 * for the rung it was on. Retention never prunes these; migrations are rare
 * and this is the one copy from before the schema moved.
 */
export function snapshotBeforeMigration(
	conn: Database.Database,
	dbPath: string,
	fromVersion: number,
	now = new Date()
): string {
	return writeInto(
		conn,
		backupDir(),
		`${baseName(dbPath)}-pre-v${fromVersion + 1}-${stamp(now)}.sqlite`
	);
}
