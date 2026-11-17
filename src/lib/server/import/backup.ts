import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { getDb } from '../db.ts';
import { visibleWhere } from '../visibility.ts';
import { join } from '../fspath.ts';
import { importArea } from '../data-dirs.ts';
import { libraryRoot, runQueued, type Source } from './index.ts';
import {
	MAX_UNPACKED_BACKUP_BYTES,
	readBackupLenient,
	type MihonBackup
} from '../../import/mihon-backup.ts';
import { planMihon } from '../../import/mihon-plan.ts';
import {
	BACKUP_LABEL,
	previewBackup,
	type BackupApp,
	type BackupPreview,
	type LibraryFacts
} from '../../import/backup-preview.ts';
import { ProtobufError } from '../../import/protobuf.ts';

/**
 * IMPORT A BACKUP's server half (doc/IMPORT-BACKUP.md): a file arrives in
 * chunks into the data folder's import area, is read before anything is
 * written, previewed, and on IMPORT runs as a scan job of one step through
 * the same writer a scan uses. The IMPORT LOG reads `imports` beside
 * `scan_jobs`.
 */

/**
 * The largest backup taken: 100 MB. A real Mihon backup of 373 series is well
 * under 1 MB gzipped (doc/IMPORT-MIHON.md's figures). A file past it is refused with a sentence before a byte
 * is kept.
 */
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

/**
 * One request's piece of a file. adapter-node refuses a body over
 * BODY_SIZE_LIMIT, 512 KB unless set, with a bare 413; chunks well below it
 * work under any server the app runs on, the release's included, and give
 * the pick screen its progress and CANCEL (doc/IMPORT-BACKUP.md, "The upload").
 */
export const CHUNK_BYTES = 256 * 1024;

export type ImportOrigin = 'desktop' | 'tablet' | 'phone';
export const ORIGINS: readonly ImportOrigin[] = ['desktop', 'tablet', 'phone'];

export type ImportState = 'read' | 'refused' | 'waiting' | 'running' | 'done' | 'failed';

/** What no row of `import_series` can say: kept as JSON in `imports.outcome`. */
export type ImportOutcome = {
	/** Categories left out on the preview. */
	leftOut?: string[];
	/** Shelves the import put series on, made or added to. */
	shelves?: string[];
	/** Rated by a category, and how many. */
	rated?: number;
	browsed?: number;
	local?: number;
	/** Titles of series in the file that could not be read. */
	refused?: string[];
	/** Sources the file needs that no extension provided when it ran: id and the file's name for it. */
	noSource?: { id: string; name: string }[];
	/** Extensions installed from the preview (by name). */
	installed?: string[];
};

export type ImportRow = {
	id: number;
	createdAt: number;
	app: BackupApp | '';
	fileName: string;
	fileBytes: number;
	madeAt: number | null;
	stored: string;
	origin: ImportOrigin | '';
	state: ImportState;
	refusal: string;
	jobId: number | null;
	seriesTotal: number;
	seriesDone: number;
	startedAt: number | null;
	finishedAt: number | null;
	outcome: ImportOutcome;
};

const area = () => importArea();

function rowOf(r: Record<string, unknown>): ImportRow {
	return {
		id: r.id as number,
		createdAt: r.created_at as number,
		app: r.app as BackupApp | '',
		fileName: r.file_name as string,
		fileBytes: r.file_bytes as number,
		madeAt: r.made_at as number | null,
		stored: r.stored as string,
		origin: r.origin as ImportOrigin | '',
		state: r.state as ImportState,
		refusal: r.refusal as string,
		jobId: r.job_id as number | null,
		seriesTotal: r.series_total as number,
		seriesDone: r.series_done as number,
		startedAt: r.started_at as number | null,
		finishedAt: r.finished_at as number | null,
		outcome: JSON.parse((r.outcome as string) || '{}') as ImportOutcome
	};
}

/**
 * The imports this process has queued or is running. Only its promise moves a
 * row on from `running` or `waiting`, and the queue a `waiting` row waits in
 * is in memory: a row in either state that is not here was left by a process
 * that died (a restart, a crash), and nothing will ever finish it.
 */
const live = new Set<number>();

/**
 * Close the imports a dead process left `running` or `waiting`: `failed`, so
 * the result page says STOPPED with what it wrote (the series it wrote stay,
 * as a stopped scan's do). Run where rows are read, never from `run()`'s
 * closeDeadJobs, where a second import is legitimately waiting while the
 * first one's job opens.
 */
export function closeDeadImports(db: Database.Database = getDb(), now = Date.now()): void {
	const rows = db.prepare(`SELECT id FROM imports WHERE state IN ('running', 'waiting')`).all() as {
		id: number;
	}[];
	for (const r of rows) if (!live.has(r.id)) closeDead(db, r.id, now);
}

function closeDead(db: Database.Database, id: number, now: number): void {
	db.prepare(
		`UPDATE imports SET state = 'failed', finished_at = COALESCE(finished_at, ?)
		WHERE id = ? AND state IN ('running', 'waiting')`
	).run(now, id);
}

export function importRow(id: number, db: Database.Database = getDb()): ImportRow | null {
	const read = () =>
		db.prepare(`SELECT * FROM imports WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
	let r = read();
	if (r && (r.state === 'running' || r.state === 'waiting') && !live.has(id)) {
		closeDead(db, id, Date.now());
		r = read();
	}
	return r ? rowOf(r) : null;
}

// ---- reading a file ------------------------------------------------------------

/** What a file is, read before anything is written. */
export type Reading =
	| { ok: true; app: 'mihon'; backup: MihonBackup; damaged: string[] }
	| { ok: false; app: BackupApp | ''; reason: string };

/**
 * Top-level fields only Aniyomi's backup has: its anime (3), their categories
 * (4), and their sources (102, 103), beside the manga fields it shares with
 * Mihon (1, 2, 101). Mihon's schema has none of them (its 100 is broken
 * sources, 104-106 preferences and repositories), and decodeBackup reads only
 * 1, 2 and 101, so without this an Aniyomi file would read as Mihon with its
 * anime silently dropped. Not measured against a real Aniyomi backup: none
 * was at hand (doc/IMPORT-BACKUP.md, "Which app").
 */
const ANIYOMI_FIELDS = [3, 4, 102, 103];

/** Mihon names its backups `app.mihon_2026-11-02_03-14.tachibk`: when it was made. */
export function madeAtOf(name: string): number | null {
	const m = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})/.exec(name);
	if (!m) return null;
	const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
	return Number.isFinite(t) ? t : null;
}

/** The most a file may inflate to: ten times the upload limit (mihon-backup.ts says why). */
export const MAX_RAW_BYTES = MAX_UNPACKED_BACKUP_BYTES;

export function readBackupFile(bytes: Uint8Array, name: string, maxRaw = MAX_RAW_BYTES): Reading {
	const upper = name.toUpperCase();
	const notOne = (why: string, app: BackupApp | '' = ''): Reading => ({
		ok: false,
		app,
		reason: `${upper} · ${why} · NOTHING CHANGED`
	});
	if (bytes.length === 0) return notOne('AN EMPTY FILE');
	// A zip: what LNReader writes. Its importer isn't built.
	if (bytes[0] === 0x50 && bytes[1] === 0x4b)
		return notOne('A ZIP · LNREADER BACKUPS ARE NOT READ YET', 'lnreader');
	if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
		return notOne('NOT A MIHON BACKUP: A .tachibk IS GZIPPED, THIS ISN’T');
	let raw: Uint8Array;
	try {
		raw = gunzipSync(bytes, { maxOutputLength: maxRaw });
	} catch (e) {
		if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
			return notOne(
				`IT UNPACKS TO MORE THAN THE ${maxRaw / 1024 / 1024} MB A BACKUP MAY HOLD`,
				'mihon'
			);
		return notOne('A .tachibk THAT ISN’T WHOLE (CUT OFF IN THE COPY)', 'mihon');
	}
	let read: ReturnType<typeof readBackupLenient>;
	try {
		read = readBackupLenient(raw);
	} catch (e) {
		if (e instanceof ProtobufError) return notOne('ITS CONTENTS DON’T READ AS A BACKUP');
		throw e;
	}
	if (ANIYOMI_FIELDS.some((f) => read.fields.has(f)))
		return notOne('AN ANIYOMI BACKUP · ANIYOMI IS NOT READ YET', 'aniyomi');
	const { backup, damaged } = read;
	if (backup.manga.length === 0 && backup.categories.length === 0 && damaged.length === 0)
		return notOne('NO LIBRARY IN IT: NOT A MIHON BACKUP');
	const library = backup.manga.filter((m) => m.favorite && m.source !== '0').length;
	if (library === 0) {
		const browsed = backup.manga.filter((m) => !m.favorite).length;
		return {
			ok: false,
			app: 'mihon',
			reason: `NOTHING TO BRING IN · MIHON BACKUP · 0 SERIES IN ITS LIBRARY · ${browsed} ONLY BROWSED`
		};
	}
	return { ok: true, app: 'mihon', backup, damaged };
}

// ---- the upload ----------------------------------------------------------------

type Upload = { name: string; size: number; origin: ImportOrigin; path: string; written: number };
const uploads = new Map<string, Upload>();

export type ChunkAnswer =
	| { state: 'more'; token: string; written: number }
	| { state: 'read'; id: number }
	| { state: 'refused'; id: number | null; reason: string };

/** What a file name may carry into a path: its own name, no folders. */
const safeName = (name: string) =>
	name
		.replace(/[\\/]/g, '_')
		.replace(/[^\w.\- ()[\]]/g, '_')
		.slice(0, 120) || 'backup';

/**
 * A file past the limit, refused before a byte is kept: the sentence the pick
 * screen shows ("a file past it is refused with a sentence, not a 413
 * page").
 */
export const tooLarge = (name: string, size: number) =>
	`${name.toUpperCase()} · ${(size / 1024 / 1024).toFixed(1)} MB · OVER THE ${MAX_BACKUP_BYTES / 1024 / 1024} MB A BACKUP MAY BE · NOTHING CHANGED`;

/**
 * One piece of a file. The first (offset 0, no token) opens the upload and
 * answers its token; each next one must start where the last ended. The last
 * piece reads the whole file and answers what it is.
 */
export function receiveChunk(
	head: { token: string | null; name: string; size: number; offset: number; origin: ImportOrigin },
	bytes: Uint8Array,
	now = Date.now()
): ChunkAnswer {
	if (!Number.isSafeInteger(head.size) || head.size < 0)
		return { state: 'refused', id: null, reason: 'NO SIZE GIVEN · NOTHING CHANGED' };
	if (head.size > MAX_BACKUP_BYTES)
		return { state: 'refused', id: null, reason: tooLarge(head.name, head.size) };
	if (bytes.length > CHUNK_BYTES)
		return { state: 'refused', id: null, reason: 'A PIECE TOO LARGE · NOTHING CHANGED' };
	let token = head.token;
	let u = token ? uploads.get(token) : undefined;
	if (!u) {
		if (head.offset !== 0 || token)
			return {
				state: 'refused',
				id: null,
				reason: 'THE UPLOAD WAS INTERRUPTED · CHOOSE THE FILE AGAIN'
			};
		token = randomBytes(12).toString('hex');
		mkdirSync(area(), { recursive: true });
		u = {
			name: head.name,
			size: head.size,
			origin: head.origin,
			path: join(area(), `upload-${token}.part`),
			written: 0
		};
		writeFileSync(u.path, '');
		uploads.set(token, u);
	}
	if (head.offset !== u.written || u.written + bytes.length > u.size) {
		cancelUpload(token!);
		return {
			state: 'refused',
			id: null,
			reason: 'THE UPLOAD WAS INTERRUPTED · CHOOSE THE FILE AGAIN'
		};
	}
	appendFileSync(u.path, bytes);
	u.written += bytes.length;
	if (u.written < u.size) return { state: 'more', token: token!, written: u.written };
	uploads.delete(token!);
	return finish(u, now);
}

export function cancelUpload(token: string): void {
	const u = uploads.get(token);
	if (!u) return;
	uploads.delete(token);
	rmSync(u.path, { force: true });
}

/**
 * A whole file: read it, and keep it only when it is a backup it reads. A
 * refused file is deleted and its row is kept, for the IMPORT LOG ("NOT
 * READ"). Previews nobody imported are cleared after a day.
 */
function finish(u: Upload, now: number): ChunkAnswer {
	const db = getDb();
	clearStale(db, now);
	const bytes = readFileSync(u.path);
	const r = readBackupFile(bytes, u.name);
	const id = Number(
		db
			.prepare(
				`INSERT INTO imports (created_at, app, file_name, file_bytes, made_at, origin, state, refusal, series_total)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				now,
				r.app,
				u.name,
				bytes.length,
				madeAtOf(u.name),
				u.origin,
				r.ok ? 'read' : 'refused',
				r.ok ? '' : r.reason,
				r.ok ? planMihon(r.backup, [], now).series.length : 0
			).lastInsertRowid
	);
	if (!r.ok) {
		rmSync(u.path, { force: true });
		return { state: 'refused', id, reason: r.reason };
	}
	const stored = join(area(), `${id}-${safeName(u.name)}`);
	renameSync(u.path, stored);
	db.prepare(`UPDATE imports SET stored = ? WHERE id = ?`).run(stored, id);
	return { state: 'read', id };
}

const DAY = 24 * 60 * 60 * 1000;

/** A preview left a day without IMPORT: its file goes, and its row, which no log shows. */
function clearStale(db: Database.Database, now: number): void {
	const stale = db
		.prepare(`SELECT id, stored FROM imports WHERE state = 'read' AND created_at < ?`)
		.all(now - DAY) as { id: number; stored: string }[];
	for (const s of stale) {
		if (s.stored) rmSync(s.stored, { force: true });
		db.prepare(`DELETE FROM imports WHERE id = ?`).run(s.id);
	}
	// Pieces of an upload a restart forgot.
	if (!existsSync(area())) return;
	for (const n of readdirSync(area()))
		if (n.startsWith('upload-') && n.endsWith('.part')) {
			const path = join(area(), n);
			const live = [...uploads.values()].some((u) => u.path === path);
			if (!live && statSync(path).mtimeMs < now - DAY) rmSync(path, { force: true });
		}
}

// ---- the preview ---------------------------------------------------------------

/** The stored file read again: a preview is cheap next to an import. */
function readStored(row: ImportRow): Reading {
	if (!row.stored || !existsSync(row.stored))
		return { ok: false, app: row.app, reason: 'THE FILE IS GONE · CHOOSE IT AGAIN' };
	return readBackupFile(readFileSync(row.stored), row.fileName);
}

/**
 * The library's side of a preview: what is here, the shelves, the sources.
 * What is here, and what an earlier import brought, follow reveal: with it
 * off, a hidden series is neither ALREADY HERE nor GONE, so nothing on the
 * preview says one exists.
 */
export function libraryFacts(
	app: BackupApp,
	exceptImport: number,
	db: Database.Database = getDb(),
	reveal = true
): LibraryFacts {
	const here = new Map<string, Set<string>>();
	const rows = db
		.prepare(
			`SELECT s.origin_key AS k, e.source_url AS u FROM series s JOIN roots r ON r.id = s.root_id
			LEFT JOIN entries e ON e.series_id = s.id AND e.read_at IS NOT NULL
			WHERE s.origin_key LIKE 'mihon:%' AND ${visibleWhere(reveal)}`
		)
		.all() as { k: string; u: string | null }[];
	for (const r of rows) {
		const set = here.get(r.k) ?? new Set<string>();
		if (r.u) set.add(r.u);
		here.set(r.k, set);
	}
	const shelves = new Set(
		(db.prepare(`SELECT name FROM collections`).all() as { name: string }[]).map((r) => r.name)
	);
	const installed = new Set(
		(
			db
				.prepare(
					`SELECT s.id FROM engine_sources s JOIN engine_extensions e ON e.pkg = s.pkg WHERE e.failed = ''`
				)
				.all() as { id: string }[]
		).map((r) => r.id)
	);
	// What an added repository lists, read as EXTENSIONS reads it (engine_listings).
	const listings = (
		db
			.prepare(
				`SELECT l.listing, r.name AS repo FROM engine_listings l JOIN engine_repos r ON r.id = l.repo_id
				ORDER BY r.failed_at IS NOT NULL, r.id`
			)
			.all() as { listing: string; repo: string }[]
	).map((r) => {
		const l = JSON.parse(r.listing) as { pkg: string; name: string; sources: { id: string }[] };
		return { pkg: l.pkg, name: l.name, repo: r.repo, sources: l.sources.map((x) => x.id) };
	});
	const earlier = (
		db
			.prepare(
				`SELECT id, finished_at FROM imports WHERE app = ? AND state = 'done' AND id != ?
				ORDER BY finished_at DESC, id DESC`
			)
			.all(app, exceptImport) as { id: number; finished_at: number }[]
	).map((i) => ({
		id: i.id,
		at: i.finished_at,
		keys: new Set(
			(
				db
					.prepare(
						`SELECT s.origin_key AS k FROM import_series i JOIN series s ON s.id = i.series_id
						JOIN roots r ON r.id = s.root_id
						WHERE i.import_id = ? AND ${visibleWhere(reveal)}`
					)
					.all(i.id) as { k: string }[]
			).map((r) => r.k)
		)
	}));
	return { here, shelves, installed, listings, earlier };
}

export type Previewed =
	| { ok: true; row: ImportRow; preview: BackupPreview }
	| { ok: false; row: ImportRow; reason: string };

export function previewImport(id: number, reveal: boolean, now = Date.now()): Previewed | null {
	const row = importRow(id);
	if (!row) return null;
	if (row.state === 'refused') return { ok: false, row, reason: row.refusal };
	const r = readStored(row);
	if (!r.ok) return { ok: false, row, reason: r.reason };
	const plan = planMihon(r.backup, [], now);
	return {
		ok: true,
		row,
		preview: previewBackup(
			r.backup,
			plan,
			libraryFacts('mihon', row.id, getDb(), reveal),
			r.damaged
		)
	};
}

// ---- IMPORT --------------------------------------------------------------------

/**
 * IMPORT: the file runs as a scan job of one step, after any scan or import
 * running (one at a time). Returns at once; the page follows the row. Refused
 * when the row is not a preview waiting for it.
 */
export function startBackupImport(
	id: number,
	opts: { leaveOut?: string[]; covers?: boolean } = {}
): { started: true } | { started: false; reason: string } {
	const db = getDb();
	const row = importRow(id, db);
	if (!row || row.state !== 'read') return { started: false, reason: 'NOT A PREVIEW WAITING' };
	const reading = readStored(row);
	if (!reading.ok) return { started: false, reason: reading.reason };
	const leaveOut = new Set(opts.leaveOut ?? []);
	const set = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args, id);
	// Live from here until its promise settles; a row read meanwhile stays as written.
	live.add(id);
	// Everything up to the queue runs here, synchronously, and only the queue's
	// then/catch below takes the row out of `live`: a throw in between (a
	// malformed `engine_listings` row read by `libraryFacts`) left the row
	// `running` and live, so its page polled until a restart. Now it fails
	// where it stands, with a reason the page draws.
	try {
		return queueBackupImport(id, row, reading, leaveOut, set, opts.covers);
	} catch (e) {
		live.delete(id);
		console.error('[import] the backup could not start:', e);
		db.prepare(
			`UPDATE imports SET state = 'failed', finished_at = ? WHERE id = ? AND state IN ('read', 'running', 'waiting')`
		).run(Date.now(), id);
		return { started: false, reason: COULD_NOT_START };
	}
}

/** Why an IMPORT that threw before its run failed; the error itself is in the server's log. */
export const COULD_NOT_START = 'THE LIBRARY’S OWN RECORDS COULD NOT BE READ · SEE THE SERVER’S LOG';

function queueBackupImport(
	id: number,
	row: NonNullable<ReturnType<typeof importRow>>,
	reading: Extract<Reading, { ok: true }>,
	leaveOut: Set<string>,
	set: (sql: string, ...args: unknown[]) => unknown,
	covers: boolean | undefined
): { started: true } {
	const db = getDb();
	const backup = reading.backup;
	set(
		`UPDATE imports SET state = 'running', started_at = ?, outcome = ? WHERE id = ?`,
		Date.now(),
		'{}'
	);
	const library = libraryRoot();
	const shelves = new Set<string>();
	let rated = 0;
	let done = 0;
	const installedAtStart = libraryFacts('mihon', id, db).installed;
	const source: Source = {
		name: 'Mihon',
		label: BACKUP_LABEL,
		device: null,
		// The root a `Mihon/` folder's backup writes to, whether the folder
		// exists or not: one Mihon root, so a later scan of a backup dropped
		// there finds these series by their keys.
		root: join(library, 'Mihon'),
		hidden: false,
		markMissing: false,
		// Progress counts series written, not bytes: the file is read whole first.
		counts: 'series',
		bytes: async () => 0,
		plan: async (_progress, now) => {
			const plan = planMihon(backup, [], now, leaveOut);
			db.prepare(`UPDATE imports SET series_total = ? WHERE id = ?`).run(plan.series.length, id);
			return { series: plan.series, skipped: plan.skipped, backup: row.stored };
		},
		started: (d, jobId) =>
			d
				.prepare(`UPDATE imports SET job_id = ?, state = 'running', started_at = ? WHERE id = ?`)
				.run(jobId, Date.now(), id),
		written: (d, s, created) => {
			const sid = d.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(s.originKey) as
				{ id: number } | undefined;
			if (sid)
				d.prepare(
					`INSERT OR IGNORE INTO import_series (import_id, series_id, created) VALUES (?, ?, ?)`
				).run(id, sid.id, created ? 1 : 0);
			if (created) {
				for (const sh of s.shelves) shelves.add(sh);
				if (s.rating > 0) rated += 1;
			}
			done += 1;
			d.prepare(`UPDATE imports SET series_done = ? WHERE id = ?`).run(done, id);
		}
	};
	const keys = new Set(backup.manga.map((m) => m.source));
	const outcome = (): ImportOutcome => ({
		leftOut: [...leaveOut],
		shelves: [...shelves],
		rated,
		browsed: backup.manga.filter((m) => !m.favorite && m.source !== '0').length,
		local: backup.manga.filter((m) => m.source === '0').length,
		refused: reading.damaged,
		noSource: [...keys]
			.filter((k) => k !== '0' && !installedAtStart.has(k))
			.map((k) => ({ id: k, name: backup.sources.get(k) ?? `Source ${k}` }))
	});
	void runQueued(source, {
		covers,
		waiting: () => set(`UPDATE imports SET state = 'waiting' WHERE id = ?`)
	})
		.then(() => {
			set(
				`UPDATE imports SET state = 'done', finished_at = ?, outcome = ? WHERE id = ?`,
				Date.now(),
				JSON.stringify(outcome())
			);
			live.delete(id);
		})
		.catch((e: unknown) => {
			live.delete(id);
			console.error('[import] the backup failed:', e);
			set(
				`UPDATE imports SET state = 'failed', finished_at = ?, outcome = ? WHERE id = ?`,
				Date.now(),
				JSON.stringify(outcome())
			);
		});
	// The row says `running` from here, `waiting` when another job runs first,
	// and `running` again when its own job opens.
	return { started: true };
}

/** For a spec: wait until no import of a file is waiting or running. */
export async function settled(timeoutMs = 10_000): Promise<void> {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		closeDeadImports();
		const n = getDb()
			.prepare(`SELECT COUNT(*) n FROM imports WHERE state IN ('waiting', 'running')`)
			.get() as { n: number };
		if (n.n === 0) return;
		await new Promise((r) => setTimeout(r, 20));
	}
	throw new Error('an import did not settle');
}

/** The import area's files, for a spec that checks nothing landed in the library. */
export const storedFiles = (): string[] => (existsSync(area()) ? readdirSync(area()) : []);
