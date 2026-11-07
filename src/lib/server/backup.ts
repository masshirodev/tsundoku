import Database from 'better-sqlite3';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync
} from 'node:fs';
import { basename, dirname, extname, join, relative } from './fspath.ts';
import { snapshotName, stamp, toPrune, DEFAULT_TIERS, type Tiers } from '../backup/retention.ts';
import { dataPaths, highlightsArea } from './data-dirs.ts';

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
	/** The highlights' copies mirrored beside it (c701), null when it was told not to. */
	copies: Mirror | null;
};

export class BackupError extends Error {}

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** Open a snapshot read-only and make sure it's a database worth keeping. */
export function verify(path: string): Omit<Snapshot, 'path' | 'bytes' | 'pruned' | 'copies'> {
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
	opts: {
		dir?: string;
		now?: Date;
		tiers?: Tiers;
		/** The highlights folder to mirror; null mirrors nothing. The data folder's by default. */
		highlights?: string | null;
	} = {}
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
	const source = opts.highlights === undefined ? highlightsArea().root : opts.highlights;
	// After the snapshot, so a copy that fails to mirror never costs the
	// database its night: the snapshot is on disk, and the error is said.
	const copies =
		source === null
			? null
			: mirrorHighlights(source, join(dir, HIGHLIGHTS_MIRROR), opts.now ?? new Date());
	return { path, bytes: statSync(path).size, ...verify(path), pruned, copies };
}

// ---- the highlights' copies (c701; doc/BACKUPS.md, "Highlights' copies") -------------------

/** The mirror's folder inside BACKUP_DIR. Retention never reads it: it is no snapshot's name. */
export const HIGHLIGHTS_MIRROR = 'highlights';
/** Where a copy whose highlight was deleted waits, by the night it was set aside. */
const GONE = '.gone';
/** How long a set-aside copy is kept: as long as the daily snapshots that still name it, and more. */
export const GONE_DAYS = 30;

export type Mirror = { copied: number; kept: number; setAside: number; pruned: number };

function filesUnder(root: string): string[] {
	if (!existsSync(root)) return [];
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const d of readdirSync(dir, { withFileTypes: true })) {
			if (d.name === GONE || d.name.endsWith('.partial')) continue;
			const abs = join(dir, d.name);
			if (d.isDirectory()) walk(abs);
			else if (d.isFile()) out.push(relative(root, abs));
		}
	};
	walk(root);
	return out;
}

/**
 * The copies are the one part of a highlight a database snapshot cannot hold
 * (a page's image, a clip's video), and they never change once made. So the
 * mirror copies what is new or changed in size, under a temporary name and
 * renamed into place; a copy no longer in the folder (its highlight deleted)
 * is set aside under `.gone/<night>/`, not erased, and those go after
 * GONE_DAYS. A restored snapshot from within that time still finds its copies.
 */
export function mirrorHighlights(source: string, dest: string, now = new Date()): Mirror {
	const out: Mirror = { copied: 0, kept: 0, setAside: 0, pruned: 0 };
	const have = filesUnder(source);
	const wanted = new Set(have);
	for (const rel of have) {
		const from = join(source, rel);
		const to = join(dest, rel);
		const size = statSync(from).size;
		if (existsSync(to) && statSync(to).size === size) {
			out.kept += 1;
			continue;
		}
		mkdirSync(dirname(to), { recursive: true });
		const partial = `${to}.partial`;
		copyFileSync(from, partial);
		renameSync(partial, to);
		out.copied += 1;
	}
	const night = stamp(now);
	for (const rel of filesUnder(dest)) {
		if (wanted.has(rel)) continue;
		const to = join(dest, GONE, night, rel);
		mkdirSync(dirname(to), { recursive: true });
		renameSync(join(dest, rel), to);
		out.setAside += 1;
	}
	const gone = join(dest, GONE);
	if (existsSync(gone))
		for (const name of readdirSync(gone)) {
			const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(name);
			if (!m) continue;
			const [, y, mo, d, h, mi, sec] = m.map(Number);
			const at = new Date(y, mo - 1, d, h, mi, sec).getTime();
			if (now.getTime() - at > GONE_DAYS * 86_400_000) {
				rmSync(join(gone, name), { recursive: true, force: true });
				out.pruned += 1;
			}
		}
	return out;
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
