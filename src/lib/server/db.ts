import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The library database. One file, one connection per process.
 *
 * DATABASE_PATH is read on first use and never again, so a spec file that
 * wants its own database sets it at module scope before importing anything
 * that calls `getDb()` -- and tests/vitest.setup.ts is what guarantees two
 * spec files never share a process, and so never share this memo.
 */
let db: Database.Database | null = null;

export function databasePath(): string {
	return process.env.DATABASE_PATH ?? 'data/tsundoku.sqlite';
}

export function getDb(): Database.Database {
	if (db) return db;
	const path = databasePath();
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	db = new Database(path);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.pragma('busy_timeout = 5000');
	migrate(db);
	return db;
}

/** For specs only: drop the memo so the next `getDb()` opens afresh. */
export function closeDb(): void {
	db?.close();
	db = null;
}

/**
 * Ordered, append-only. A rung is never edited once it has shipped; a change
 * is a new rung. `user_version` records how far a database has climbed.
 */
const MIGRATIONS: string[] = [
	`
	-- A folder the scanner walks. Hidden roots hide everything inside them:
	-- the Hentoid import lands in one by default.
	CREATE TABLE roots (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		path TEXT NOT NULL UNIQUE,
		hidden INTEGER NOT NULL DEFAULT 0
	);

	CREATE TABLE series (
		id INTEGER PRIMARY KEY,
		root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
		title TEXT NOT NULL,
		kind TEXT NOT NULL CHECK (kind IN ('manga', 'manhwa', 'doujin', 'novel')),
		-- Rung 2 settled this: 0 is unrated and NULL is never written.
		rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 0 AND 5),
		favourite INTEGER NOT NULL DEFAULT 0,
		hidden INTEGER NOT NULL DEFAULT 0,
		hue INTEGER NOT NULL DEFAULT 0,
		added_at INTEGER NOT NULL,
		-- NULL while the scanner has found the series but not indexed it yet.
		indexed_at INTEGER,
		scan_job_id INTEGER REFERENCES scan_jobs(id) ON DELETE SET NULL
	);
	CREATE INDEX series_root ON series(root_id);

	-- A readable unit: chapter, volume, one-shot.
	CREATE TABLE entries (
		id INTEGER PRIMARY KEY,
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		position REAL NOT NULL,
		label TEXT NOT NULL,
		added_at INTEGER NOT NULL,
		read_at INTEGER,
		-- Last page or text position reached; NULL when never opened.
		last_position INTEGER,
		last_opened_at INTEGER
	);
	CREATE INDEX entries_series ON entries(series_id, position);
	CREATE INDEX entries_opened ON entries(last_opened_at);

	-- Owner-made shelves. Smart shelves (all, favourites, rated 4+) are queries,
	-- not rows.
	CREATE TABLE collections (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL UNIQUE COLLATE NOCASE,
		position INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE collection_series (
		collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		PRIMARY KEY (collection_id, series_id)
	);

	CREATE TABLE tags (
		id INTEGER PRIMARY KEY,
		namespace TEXT NOT NULL DEFAULT '',
		value TEXT NOT NULL,
		UNIQUE (namespace, value)
	);
	CREATE TABLE series_tags (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
		PRIMARY KEY (series_id, tag_id)
	);

	CREATE TABLE scan_jobs (
		id INTEGER PRIMARY KEY,
		started_at INTEGER NOT NULL,
		finished_at INTEGER,
		bytes_done INTEGER NOT NULL DEFAULT 0,
		bytes_total INTEGER NOT NULL DEFAULT 0,
		series_found INTEGER NOT NULL DEFAULT 0,
		source_label TEXT NOT NULL DEFAULT '',
		step INTEGER NOT NULL DEFAULT 0,
		steps INTEGER NOT NULL DEFAULT 0,
		failed_files INTEGER NOT NULL DEFAULT 0,
		dismissed_at INTEGER
	);
	`,
	`
	-- 0 is unrated (the owner's scale, 2026-09-22), so there is no separate
	-- NULL. The column keeps rung 1's nullable CHECK because SQLite cannot
	-- tighten a constraint without rebuilding a table four others reference;
	-- the code never writes NULL, and this clears the ones rung 1 allowed.
	UPDATE series SET rating = 0 WHERE rating IS NULL;
	`,
	`
	-- What the series screen shows. Alternative titles are a JSON array of
	-- strings; direction is NULL until the owner picks one, and the reader
	-- falls back to the kind's default (see $lib/library/series.ts).
	ALTER TABLE series ADD COLUMN alt_titles TEXT NOT NULL DEFAULT '[]';
	ALTER TABLE series ADD COLUMN source TEXT NOT NULL DEFAULT '';
	ALTER TABLE series ADD COLUMN status TEXT NOT NULL DEFAULT '';
	ALTER TABLE series ADD COLUMN description TEXT NOT NULL DEFAULT '';
	ALTER TABLE series ADD COLUMN direction TEXT
		CHECK (direction IS NULL OR direction IN ('rtl', 'ltr', 'vertical', 'paged', 'scroll'));
	ALTER TABLE series ADD COLUMN path TEXT NOT NULL DEFAULT '';

	-- Per entry: its own title ("Ashes at Veyne"), how many pages it has, and
	-- the file it lives in, relative to the series path, with its size.
	ALTER TABLE entries ADD COLUMN title TEXT NOT NULL DEFAULT '';
	ALTER TABLE entries ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE entries ADD COLUMN file TEXT NOT NULL DEFAULT '';
	ALTER TABLE entries ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;
	`,
	`
	-- The reading log: append-only, one row per thing that happened. Stats,
	-- history and tracker sync are all derived from it later, so it has to be
	-- written from the first page ever read -- a log can be re-summarised any
	-- number of ways, a missing one cannot be reconstructed. See
	-- doc/READING-LOG.md.
	CREATE TABLE reading_events (
		id INTEGER PRIMARY KEY,
		at INTEGER NOT NULL,
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
		kind TEXT NOT NULL CHECK (kind IN ('open', 'page', 'finish', 'close', 'mark_read', 'mark_unread')),
		-- 0-based page (or text position) the event happened at, when it has one.
		page INTEGER,
		-- Reading time this event accounts for: the gap since the previous event
		-- in the same sitting, capped by the reader so an idle tablet is not time.
		duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0)
	);
	CREATE INDEX reading_events_at ON reading_events(at);
	CREATE INDEX reading_events_series ON reading_events(series_id, at);

	-- Captured at import for later work, so nothing has to be re-scanned for it:
	-- where each series and entry came from (tracker matching, provenance), and
	-- a perceptual hash of each entry's cover (duplicate detection -- Hentoid
	-- already ships one per image).
	ALTER TABLE series ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
	ALTER TABLE entries ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
	ALTER TABLE entries ADD COLUMN cover_phash TEXT;
	`,
	`
	-- Books (doc/BOOKS.md). A doujin series of two or more entries is a series
	-- of books, and each book keeps its own rating (0 = unrated), favourite,
	-- cover page and tags. In a one-book series those live on the series, and
	-- grouping or taking out moves them between the two.
	ALTER TABLE entries ADD COLUMN rating INTEGER NOT NULL DEFAULT 0
		CHECK (rating BETWEEN 0 AND 5);
	ALTER TABLE entries ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0;
	-- 0-based page used as the cover; NULL is the first page.
	ALTER TABLE entries ADD COLUMN cover_page INTEGER;
	CREATE TABLE entry_tags (
		entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
		PRIMARY KEY (entry_id, tag_id)
	);

	-- People the owner keeps close: "watch this circle". Only artist, circle
	-- and author tags can be favourited.
	CREATE TABLE person_favourites (
		namespace TEXT NOT NULL CHECK (namespace IN ('artist', 'circle', 'author')),
		value TEXT NOT NULL,
		added_at INTEGER NOT NULL,
		PRIMARY KEY (namespace, value)
	);

	-- "Not a series": a dismissed suggestion, stored against the set of series
	-- it named (sorted ids, comma-joined). A suggestion whose set lies inside a
	-- dismissed one never comes back.
	CREATE TABLE suggestion_dismissals (
		series_ids TEXT PRIMARY KEY,
		dismissed_at INTEGER NOT NULL
	);

	-- History rows the owner removed. Only the row goes; progress stays.
	CREATE TABLE history_removed (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		day TEXT NOT NULL,
		PRIMARY KEY (series_id, day)
	);
	`
];

function migrate(conn: Database.Database): void {
	const current = conn.pragma('user_version', { simple: true }) as number;
	for (let i = current; i < MIGRATIONS.length; i++) {
		conn
			.transaction(() => {
				conn.exec(MIGRATIONS[i]);
				conn.pragma(`user_version = ${i + 1}`);
			})
			.immediate();
	}
}
