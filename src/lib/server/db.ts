import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from './fspath.ts';
import { snapshotBeforeMigration } from './backup.ts';

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
	const conn = db;
	try {
		if (process.env.TSUNDOKU_MIGRATE === 'off') refuseDrift(conn);
		else migrate(conn, path);
	} catch (e) {
		db = null;
		conn.close();
		throw e;
	}
	return conn;
}

/**
 * A timer run (OCR, sync, backup) never moves the schema: it runs
 * `scripts/*.ts` from the working tree, which may hold a migration not yet
 * shipped, and once the OCR timer moved the live database to migration 29
 * under the served app's older code (doc/SERVING.md, "Who migrates"). The
 * served app migrates when it ships; until then a timer run whose migrations
 * differ from the database's refuses, and the next run after the deploy
 * does the work.
 */
function refuseDrift(conn: Database.Database): void {
	const current = conn.pragma('user_version', { simple: true }) as number;
	if (current !== MIGRATIONS.length)
		throw new Error(
			`tsundoku: the database is at v${current} and this code at v${MIGRATIONS.length}; ` +
				'with TSUNDOKU_MIGRATE=off it is left for the served app to migrate. Deploy first.'
		);
}

/** For specs only: drop the memo so the next `getDb()` opens afresh. */
export function closeDb(): void {
	db?.close();
	db = null;
}

/**
 * Ordered, append-only. A migration is never edited once it has shipped; a change
 * is a new migration. `user_version` records how far a database has run. A
 * migration is SQL, or, where SQL alone can't say it, a function given the
 * connection, run in the same transaction (migration 47).
 */
const MIGRATIONS: (string | ((conn: Database.Database) => void))[] = [
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

	-- User-made shelves. Smart shelves (all, favourites, rated 4+) are queries,
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
	-- 0 is unrated, so there is no separate NULL. The column keeps migration 1's
	-- nullable CHECK because SQLite cannot tighten a constraint without rebuilding
	-- a table four others reference; the code never writes NULL, and this clears
	-- the ones migration 1 allowed.
	UPDATE series SET rating = 0 WHERE rating IS NULL;
	`,
	`
	-- What the series screen shows. Alternative titles are a JSON array of
	-- strings; direction is NULL until the user picks one, and the reader
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

	-- People the user keeps close: "watch this circle". Only artist, circle
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

	-- History rows the user removed. Only the row goes; progress stays.
	CREATE TABLE history_removed (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		day TEXT NOT NULL,
		PRIMARY KEY (series_id, day)
	);
	`,
	`
	-- Importers (doc/IMPORT-MIHON.md). A series an importer created carries
	-- the key it will find it by next time -- "mihon:<source id>:<url>" --
	-- so a rescan updates it instead of adding a second copy.
	ALTER TABLE series ADD COLUMN origin_key TEXT;
	CREATE UNIQUE INDEX series_origin ON series(origin_key) WHERE origin_key IS NOT NULL;

	-- 0 for an entry known from a backup whose file isn't on disk: a chapter
	-- read online, or not copied over yet. A later scan that finds the file
	-- sets it back to 1.
	ALTER TABLE entries ADD COLUMN available INTEGER NOT NULL DEFAULT 1;
	CREATE INDEX entries_source_url ON entries(series_id, source_url);
	`,
	`
	-- Pages, for entries that are folders of loose images (Hentoid). The
	-- source's own order is the reading order, and a multi-chapter Hentoid
	-- book is one folder split between several entries -- which only a
	-- stored list can say. Archives (CBZ) list their pages at read time.
	CREATE TABLE entry_pages (
		entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		position INTEGER NOT NULL,
		-- Relative to the entry's file (its folder).
		file TEXT NOT NULL,
		PRIMARY KEY (entry_id, position)
	);

	-- A cover image that isn't a page: Hentoid's thumb. Relative to the
	-- entry's file. cover_page, when the user sets one, wins.
	ALTER TABLE entries ADD COLUMN cover_file TEXT;
	`,
	`
	-- The /reveal gate (doc/PRIVACY.md): WebAuthn credentials of the devices
	-- that may unlock it -- the tablet's fingerprint or screen lock. While
	-- there are none, /reveal works as it always did.
	CREATE TABLE unlock_credentials (
		-- The credential id, base64url.
		id TEXT PRIMARY KEY,
		public_key BLOB NOT NULL,
		counter INTEGER NOT NULL DEFAULT 0,
		transports TEXT NOT NULL DEFAULT '[]',
		created_at INTEGER NOT NULL
	);
	`,
	`
	-- Public despite a hidden root (src/lib/server/visibility.ts). A root hides
	-- everything in it; UNHIDE on one of its series sets this, so a single
	-- book can come out while the rest of the root stays hidden.
	ALTER TABLE series ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
	`,
	// Migration 10: one chapter, several scanlators (doc/DUPLICATE-CHAPTERS.md). A shadowed
	// entry is a copy of a chapter another entry represents; everything that
	// lists or counts chapters skips it. series.scanlator is the user's
	// preference, NULL meaning automatic.
	`
	ALTER TABLE entries ADD COLUMN scanlator TEXT NOT NULL DEFAULT '';
	ALTER TABLE entries ADD COLUMN shadowed INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE series ADD COLUMN scanlator TEXT;
	`,
	// Migration 11: a novel's entries are places in one EPUB (doc/TEXT-READER.md).
	// locator is where the entry starts, 'doc.xhtml#anchor' inside the zip;
	// matter marks front and back matter, which is listed apart and never
	// counts as a chapter; last_offset is the character a text position is
	// at, beside last_position's paragraph.
	`
	ALTER TABLE entries ADD COLUMN locator TEXT NOT NULL DEFAULT '';
	ALTER TABLE entries ADD COLUMN matter TEXT NOT NULL DEFAULT '';
	ALTER TABLE entries ADD COLUMN last_offset INTEGER;
	`,
	// Migration 12: the library's cards count from this index alone, never the
	// table (library.ts, cardQuery).
	`
	CREATE INDEX entries_card ON entries(series_id, shadowed, matter, read_at, added_at, last_opened_at);
	`,
	// Migration 13: an event's day, in the server's local time, worked out once when
	// it's written instead of for every event on every history request (the
	// imported 19,000 events took history to 330 ms). A trigger fills it, so
	// no writer has to remember to. And the log by entry, for history's
	// "last page seen that day".
	`
	ALTER TABLE reading_events ADD COLUMN day TEXT;
	UPDATE reading_events SET day = date(at / 1000, 'unixepoch', 'localtime');
	CREATE TRIGGER reading_events_day AFTER INSERT ON reading_events WHEN NEW.day IS NULL
	BEGIN
		UPDATE reading_events SET day = date(NEW.at / 1000, 'unixepoch', 'localtime') WHERE id = NEW.id;
	END;
	CREATE INDEX reading_events_by_day ON reading_events(day, series_id);
	CREATE INDEX reading_events_entry ON reading_events(entry_id, at);
	`,
	// Migration 14: covers (doc/COVERS.md). cover_url is where the source site
	// keeps it (Mihon's backup has one per series); cover_key names the file,
	// page or URL the thumbnail was made from, so a changed source makes a new
	// one; cover_at is when, and the version in the thumbnail's URL. NULL:
	// no cover yet, and the tile keeps its stripes.
	`
	ALTER TABLE series ADD COLUMN cover_url TEXT NOT NULL DEFAULT '';
	ALTER TABLE series ADD COLUMN cover_key TEXT NOT NULL DEFAULT '';
	ALTER TABLE series ADD COLUMN cover_at INTEGER;
	ALTER TABLE series ADD COLUMN cover_failed_at INTEGER;
	`,
	// Migration 15: chapter numbers from Mihon's backup were stored at float32
	// precision (2.0999999046325684 for 2.1). The decoder rounds them now;
	// these are the ones already imported.
	`
	UPDATE entries SET position = round(position, 4) WHERE position != round(position, 4);
	`,
	// Migration 16: volumes (doc/BOOKS.md, "Volumes of a novel"). A novel grouped
	// from several EPUBs keeps each entry's book title here, so CONTENTS can
	// head each volume and UNGROUP can give each its name back. '' in a
	// series of one book.
	`
	ALTER TABLE entries ADD COLUMN volume TEXT NOT NULL DEFAULT '';
	`,
	// Migration 17: page borders (doc/READER.md, "Crop borders"). Each page's
	// plain margin, found once on the server, as fractions of its width
	// and height. All zero: nothing worth cropping. A row per page looked at,
	// so none is decoded twice.
	`
	CREATE TABLE page_crops (
		entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		page INTEGER NOT NULL,
		top REAL NOT NULL,
		right REAL NOT NULL,
		bottom REAL NOT NULL,
		left REAL NOT NULL,
		PRIMARY KEY (entry_id, page)
	) WITHOUT ROWID;
	`,
	// Migration 18: deleted books (doc/DELETING.md). What the user deleted, by the
	// keys the importers find it by -- a series' origin key, a chapter's or
	// book's source URL -- so a rescan or a sync never brings it back.
	`
	CREATE TABLE tombstones (
		key TEXT PRIMARY KEY,
		title TEXT NOT NULL DEFAULT '',
		deleted_at INTEGER NOT NULL
	) WITHOUT ROWID;
	`,
	// Migration 19: OCR (doc/JAPANESE.md). A page's text blocks, as mokuro read them
	// on the server, their boxes in fractions of the page. An entry notes
	// when it was read whole (ocr_at) or last failed (ocr_failed_at). A series'
	// ocr: NULL decides by language, 1 always, 0 never.
	`
	CREATE TABLE page_text (
		entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		page INTEGER NOT NULL,
		blocks TEXT NOT NULL,
		PRIMARY KEY (entry_id, page)
	) WITHOUT ROWID;
	ALTER TABLE entries ADD COLUMN ocr_at INTEGER;
	ALTER TABLE entries ADD COLUMN ocr_failed_at INTEGER;
	ALTER TABLE series ADD COLUMN ocr INTEGER;
	`,
	// Migration 20: mining (doc/JAPANESE.md). Every lookup, with the sentence and
	// the place it was met in; and what became of a word: 'pending' (approved,
	// not in Kumiko yet), 'sent', or 'rejected'. A word decided once isn't
	// offered again. (A block marked NOT TEXT is simply taken out of its
	// page_text; UNDO puts back the block the reader still holds.)
	`
	CREATE TABLE lookups (
		id INTEGER PRIMARY KEY,
		at INTEGER NOT NULL,
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
		place TEXT NOT NULL DEFAULT '',
		lemma TEXT NOT NULL,
		surface TEXT NOT NULL,
		reading TEXT,
		pos TEXT NOT NULL DEFAULT '',
		sentence TEXT NOT NULL DEFAULT ''
	);
	CREATE INDEX lookups_lemma ON lookups(lemma, at);
	CREATE INDEX lookups_series ON lookups(series_id);
	CREATE TABLE mined (
		lemma TEXT PRIMARY KEY,
		status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'rejected')),
		decided_at INTEGER NOT NULL,
		note_id TEXT
	) WITHOUT ROWID;
	`,
	// Migration 21: NOT TEXT keeps what it takes (doc/JAPANESE.md, "NOT TEXT").
	// Migration 20 only took a block out of its page, so once the band's UNDO was
	// gone the block was too. Each one is kept here with where it was, for the
	// series screen's RESTORE, and so reading a chapter again doesn't bring
	// it back.
	`
	CREATE TABLE not_text (
		id INTEGER PRIMARY KEY,
		entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		page INTEGER NOT NULL,
		idx INTEGER NOT NULL,
		block TEXT NOT NULL,
		at INTEGER NOT NULL
	);
	CREATE INDEX not_text_entry ON not_text(entry_id, page);
	`,
	// Migration 22: duplicate books (doc/DUPLICATE-BOOKS.md). Each page's own
	// perceptual hash (Hentoid hashes covers only), for the books in a
	// candidate pair; the pairs found, with their pages lined up; and what the
	// user decided about each, by pair, so a settled pair never comes back.
	// A decision waits (applied_at NULL) until the next one, which is what
	// makes UNDO possible for a KEEP that deletes.
	`
	CREATE TABLE page_hashes (
		entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		page INTEGER NOT NULL,
		hash TEXT NOT NULL,
		PRIMARY KEY (entry_id, page)
	) WITHOUT ROWID;
	CREATE TABLE dupe_pairs (
		a INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		b INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		bits INTEGER NOT NULL,
		rows TEXT NOT NULL,
		found_at INTEGER NOT NULL,
		PRIMARY KEY (a, b)
	) WITHOUT ROWID;
	CREATE TABLE dupe_decisions (
		pair TEXT PRIMARY KEY,
		decision TEXT NOT NULL CHECK (decision IN ('keep', 'both', 'group', 'fold', 'apart')),
		keep INTEGER,
		at INTEGER NOT NULL,
		applied_at INTEGER
	);
	`,
	// Migration 23: a series cover the user chose (doc/COVERS.md, "Chosen"): a page
	// of one of its entries, from the reader's page menu or the PAGES grid.
	// Both NULL is automatic. A book's own choice was already
	// entries.cover_page (migration 9).
	`
	ALTER TABLE series ADD COLUMN cover_entry INTEGER REFERENCES entries(id) ON DELETE SET NULL;
	ALTER TABLE series ADD COLUMN cover_page INTEGER;
	`,
	// Migration 24: one book in several languages (doc/EDITIONS.md). An edition is
	// an entry folded into another book's series: edition_of names the book's
	// own entry (its base), it's shadowed so every list and count passes it by
	// as it does a duplicate chapter, and edition_rows lines its pages up with
	// the base's. series.edition_lang is a book's own choice of language
	// (LANGUAGE on its screen), edition_read the one last read; settings holds
	// the library's own preferences, the preferred language first.
	`
	ALTER TABLE entries ADD COLUMN edition_of INTEGER REFERENCES entries(id) ON DELETE SET NULL;
	ALTER TABLE entries ADD COLUMN language TEXT;
	ALTER TABLE entries ADD COLUMN edition_rows TEXT;
	CREATE INDEX entries_edition ON entries(edition_of) WHERE edition_of IS NOT NULL;
	ALTER TABLE series ADD COLUMN edition_lang TEXT;
	ALTER TABLE series ADD COLUMN edition_read TEXT;
	CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
	`,
	// Migration 25: catalogue links (doc/LINKS.md). A series' MyAnimeList / AniList
	// entry, and where the link came from. anilist_id is NULL for a MAL link
	// AniList hasn't been asked about yet (resolved_at NULL) or doesn't have.
	// filled_rating is the rating the link's score gave an unrated series, kept
	// so UNDO can take it back and so it's given once. The search is kept per
	// series (a NULL searched_at is a SEARCH AGAIN waiting for the next pass),
	// with what it found; a decision is NONE OF THESE, or an UNLINK that an
	// import mustn't undo.
	`
	CREATE TABLE series_links (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		anilist_id INTEGER,
		mal_id INTEGER,
		via TEXT NOT NULL CHECK (via IN ('mihon', 'exact', 'review', 'pasted', 'list')),
		title TEXT NOT NULL DEFAULT '',
		cover_url TEXT NOT NULL DEFAULT '',
		linked_at INTEGER NOT NULL,
		resolved_at INTEGER,
		filled_rating INTEGER,
		score REAL
	);
	CREATE INDEX series_links_anilist ON series_links(anilist_id);
	CREATE INDEX series_links_mal ON series_links(mal_id);
	CREATE TABLE link_searches (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		query TEXT NOT NULL,
		searched_at INTEGER,
		found INTEGER NOT NULL DEFAULT 0,
		skipped_at INTEGER
	);
	CREATE TABLE link_candidates (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		anilist_id INTEGER NOT NULL,
		rank INTEGER NOT NULL,
		data TEXT NOT NULL,
		PRIMARY KEY (series_id, anilist_id)
	) WITHOUT ROWID;
	CREATE TABLE link_decisions (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		decision TEXT NOT NULL CHECK (decision IN ('none', 'unlinked')),
		at INTEGER NOT NULL
	);
	`,
	// Migration 26: the linked entry's AniList format (MANGA, NOVEL, ONE_SHOT), so a
	// link across kinds -- a novel to its comic's entry -- is known for what
	// it is: cover and details only, never tracked (doc/LINKS.md). NULL until
	// AniList has been asked.
	`
	ALTER TABLE series_links ADD COLUMN format TEXT;
	`,
	// Migration 27: tracking (doc/TRACKING.md). The user's sign-ins, one per
	// catalogue; what each catalogue's list says of a linked series (status in
	// tsundoku's words, score out of 10, chapter), with when it was read and
	// when tsundoku last sent to it; and what waits to be sent -- one row per
	// series and catalogue, the furthest wanted, gone once it's sent.
	`
	CREATE TABLE tracker_accounts (
		service TEXT PRIMARY KEY CHECK (service IN ('anilist', 'mal')),
		user_id TEXT NOT NULL,
		user_name TEXT NOT NULL,
		access_token TEXT NOT NULL,
		refresh_token TEXT,
		expires_at INTEGER,
		signed_in_at INTEGER NOT NULL,
		list_read_at INTEGER
	);
	CREATE TABLE tracker_state (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		service TEXT NOT NULL CHECK (service IN ('anilist', 'mal')),
		status TEXT,
		score REAL,
		progress INTEGER NOT NULL DEFAULT 0,
		read_at INTEGER,
		sent_at INTEGER,
		PRIMARY KEY (series_id, service)
	) WITHOUT ROWID;
	CREATE TABLE tracker_sends (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		service TEXT NOT NULL CHECK (service IN ('anilist', 'mal')),
		progress INTEGER,
		status TEXT,
		score REAL,
		wanted_at INTEGER NOT NULL,
		failed_at INTEGER,
		error TEXT,
		PRIMARY KEY (series_id, service)
	) WITHOUT ROWID;
	`,
	// Migration 28: when the user marked an entry unread (doc/SERIES.md, "Marked
	// unread stays unread"). The import moves read state only forward, from
	// Mihon's and Hentoid's own records, so a MARK UNREAD came back read on
	// the next import. Now a read from an import counts only when it's newer
	// than the unmark. Backfilled from the log: an unmark not undone since by a
	// read or a MARK READ; and a read an import put back, older than the
	// unmark, goes again. Copies (duplicate chapters) follow their chapter.
	`
	ALTER TABLE entries ADD COLUMN unread_at INTEGER;
	UPDATE entries SET unread_at = (
		SELECT MAX(r.at) FROM reading_events r WHERE r.entry_id = entries.id AND r.kind = 'mark_unread'
	);
	UPDATE entries SET unread_at = NULL WHERE unread_at IS NOT NULL AND EXISTS (
		SELECT 1 FROM reading_events r WHERE r.entry_id = entries.id
			AND r.kind IN ('finish', 'mark_read') AND r.at > entries.unread_at
	);
	UPDATE entries SET unread_at = (
		SELECT MAX(o.unread_at) FROM entries o
		WHERE o.series_id = entries.series_id AND o.position = entries.position AND o.shadowed = 0
	) WHERE shadowed = 1 AND unread_at IS NULL;
	UPDATE entries SET read_at = NULL WHERE unread_at IS NOT NULL AND read_at < unread_at;
	`,
	// Migration 29: ratings out of 10 (doc/SERIES.md, "Rating"). Five
	// steps with halves, as Ranobe rates. Existing ratings convert exactly,
	// x2: a 4 chosen out of five is an 8, never an 8-or-9, and 0 stays
	// unrated. SQLite can't change a CHECK in place, and rebuilding series and
	// entries would touch every table that references them, so the old column
	// is renamed (rating5, kept and never read or written) and a new
	// rating takes its name with a 0-10 CHECK: every query naming rating reads
	// the new one. A link's filled_rating is compared with the rating by UNDO,
	// so it doubles too.
	`
	ALTER TABLE series RENAME COLUMN rating TO rating5;
	ALTER TABLE series ADD COLUMN rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 10);
	UPDATE series SET rating = COALESCE(rating5, 0) * 2;
	ALTER TABLE entries RENAME COLUMN rating TO rating5;
	ALTER TABLE entries ADD COLUMN rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 10);
	UPDATE entries SET rating = rating5 * 2;
	UPDATE series_links SET filled_rating = filled_rating * 2 WHERE filled_rating IS NOT NULL;
	`,
	`
	-- Migration 30: the library's FILTER panel (doc/FILTERS.md) asks every card
	-- whether it has a chapter on disk, so the card index covers that too:
	-- without it, the whole revealed library's cards took twice as long.
	DROP INDEX entries_card;
	CREATE INDEX entries_card ON entries(series_id, shadowed, matter, read_at, added_at, last_opened_at, available);
	`,
	// Migration 31: Ranobe (doc/RANOBE.md). A novel links to a Ranobe
	// work, and several series may share one: a volume per EPUB. The edition
	// is NULL until one in the series' language exists, and volume is the
	// series' own number when it is one volume. Each entry keeps its unit.
	// ranobe_units is a unit read here against what was sent, so a send is
	// the difference and nothing sent from elsewhere is ever taken back.
	// ranobe_works holds the rating and favourite waiting to go, and
	// ranobe_suggestions the editions suggested to Ranobe, one per work and
	// language.
	`
	CREATE TABLE ranobe_links (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		work TEXT NOT NULL,
		edition TEXT,
		lang TEXT NOT NULL,
		volume TEXT,
		via TEXT NOT NULL CHECK (via IN ('lookup', 'review', 'pasted')),
		title TEXT NOT NULL DEFAULT '',
		linked_at INTEGER NOT NULL,
		mapped_at INTEGER
	);
	CREATE INDEX ranobe_links_work ON ranobe_links(work);
	ALTER TABLE entries ADD COLUMN ranobe_unit TEXT;
	CREATE TABLE ranobe_units (
		unit TEXT PRIMARY KEY,
		work TEXT NOT NULL,
		read_at INTEGER,
		sent_at INTEGER,
		failed_at INTEGER,
		error TEXT
	) WITHOUT ROWID;
	CREATE TABLE ranobe_works (
		work TEXT PRIMARY KEY,
		rating INTEGER,
		favourite INTEGER,
		wanted_at INTEGER,
		sent_at INTEGER,
		failed_at INTEGER,
		error TEXT
	) WITHOUT ROWID;
	CREATE TABLE ranobe_suggestions (
		work TEXT NOT NULL,
		lang TEXT NOT NULL,
		bundle INTEGER,
		status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'failed')),
		edition TEXT,
		sent_at INTEGER NOT NULL,
		checked_at INTEGER,
		error TEXT,
		PRIMARY KEY (work, lang)
	) WITHOUT ROWID;
	`,
	// Migration 32: choosing a Ranobe work (doc/RANOBE.md, "The
	// review"). A novel the ids didn't find is searched on Ranobe by title and
	// its candidates wait for the user, as link_searches and link_candidates
	// do for AniList; a decision is NOT ON RANOBE, or an UNLINK a pass mustn't
	// undo. ranobe_works gains what Ranobe itself says of the entry -- status,
	// how far in the edition's units, rating, favourite -- read with the
	// library and from each send's answer, for the TRACKING line.
	`
	CREATE TABLE ranobe_searches (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		query TEXT NOT NULL,
		searched_at INTEGER,
		found INTEGER NOT NULL DEFAULT 0,
		skipped_at INTEGER
	);
	CREATE TABLE ranobe_candidates (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		work TEXT NOT NULL,
		rank INTEGER NOT NULL,
		data TEXT NOT NULL,
		PRIMARY KEY (series_id, work)
	) WITHOUT ROWID;
	CREATE TABLE ranobe_decisions (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		decision TEXT NOT NULL CHECK (decision IN ('none', 'unlinked')),
		at INTEGER NOT NULL
	);
	ALTER TABLE ranobe_works ADD COLUMN status TEXT;
	ALTER TABLE ranobe_works ADD COLUMN progress_type TEXT;
	ALTER TABLE ranobe_works ADD COLUMN progress_number TEXT;
	ALTER TABLE ranobe_works ADD COLUMN progress_of INTEGER;
	ALTER TABLE ranobe_works ADD COLUMN remote_rating INTEGER;
	ALTER TABLE ranobe_works ADD COLUMN remote_favourite INTEGER;
	ALTER TABLE ranobe_works ADD COLUMN state_at INTEGER;
	`,
	// Migration 33: a novel suggested to Ranobe from its EPUB (doc/RANOBE.md,
	// "Suggesting a novel"). One per series: the bundle, how it stands, and the
	// work it made once approved. A pending one keeps the series out of the
	// review; an approved one links it.
	`
	CREATE TABLE ranobe_work_suggestions (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		bundle INTEGER NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
		work TEXT,
		sent_at INTEGER NOT NULL,
		checked_at INTEGER
	);
	`,
	// Migration 34: arrivals (doc/LIBRARY.md, "The NEW shelf"). When tsundoku first
	// had a file for a chapter, which Mihon's dates don't say: a chapter's
	// added_at is when the source listed it, years before it was downloaded.
	// A series' arrived_at is its latest arrival, a new series or a chapter's
	// file. Existing chapters' arrivals are unknown; a series an import
	// created arrived when that import started.
	`
	ALTER TABLE entries ADD COLUMN arrived_at INTEGER;
	ALTER TABLE series ADD COLUMN arrived_at INTEGER;
	UPDATE series SET arrived_at = (SELECT started_at FROM scan_jobs j WHERE j.id = series.scan_job_id)
		WHERE scan_job_id IS NOT NULL;
	CREATE INDEX series_arrived ON series(arrived_at) WHERE arrived_at IS NOT NULL;
	DROP INDEX entries_card;
	CREATE INDEX entries_card ON entries(series_id, shadowed, matter, read_at, added_at, last_opened_at, available, arrived_at);
	`,
	// Migration 35: migration 34's guess undone. Dating a series by the import that
	// made it put the whole library on NEW: the first import made nearly all of it,
	// inside the fortnight. An arrival is known from now on; before, it's unknown,
	// or what a file's mtime says (doc/LIBRARY.md).
	`
	UPDATE series SET arrived_at = NULL;
	`,
	// Migration 36: an arrival already read isn't new. Suwayomi downloads again
	// chapters the tablet had and the user read; dated by their files, 1,025
	// read chapters made their series new. A series' arrival is
	// its newest unread one.
	`
	UPDATE series SET arrived_at = (SELECT MAX(e.arrived_at) FROM entries e
		WHERE e.series_id = series.id AND e.read_at IS NULL)
	WHERE arrived_at IS NOT NULL;
	`,
	// Migration 37: FOLLOW (doc/DOWNLOADS.md). When the user followed a series:
	// chapters Suwayomi fetches after it are queued on their own. NULL is not
	// followed. Suwayomi can only auto-download a whole category or the whole
	// library, so the list is tsundoku's.
	`
	ALTER TABLE series ADD COLUMN followed_at INTEGER;
	CREATE INDEX series_followed ON series(followed_at) WHERE followed_at IS NOT NULL;
	`,
	// Migration 38: comics on Ranobe (doc/RANOBE.md, "Comics"). A comic
	// reads against the work's own chapters, not an edition's, and a chapter
	// the work doesn't list is refused, so each pass keeps what the work
	// counts: its type, 1..count, and the extras outside the run. type NULL is
	// a work that counts nothing yet, asked again in the next pass.
	`
	CREATE TABLE ranobe_work_units (
		work TEXT PRIMARY KEY,
		type TEXT,
		count INTEGER NOT NULL DEFAULT 0,
		extra TEXT NOT NULL DEFAULT '[]',
		checked_at INTEGER NOT NULL
	) WITHOUT ROWID;
	`,
	// Migration 39: extensions on tsundoku's own engine (doc/DOWNLOADS.md,
	// "Extensions"). Repositories the user adds (none ships), the
	// index each had when last read, installed extensions with the previous
	// version kept a week for BACK TO, their sources, and each source's
	// preferences, which the engine doesn't keep: they're sent with every call.
	// A preference outlives its extension, so a reinstall finds its settings.
	`
	CREATE TABLE engine_repos (
		id INTEGER PRIMARY KEY,
		base TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		fingerprint TEXT NOT NULL,
		website TEXT NOT NULL DEFAULT '',
		added_at INTEGER NOT NULL,
		checked_at INTEGER,
		-- Since when it stops answering; the index read before stays.
		failed_at INTEGER,
		error TEXT NOT NULL DEFAULT ''
	);
	CREATE TABLE engine_listings (
		repo_id INTEGER NOT NULL REFERENCES engine_repos(id) ON DELETE CASCADE,
		pkg TEXT NOT NULL,
		listing TEXT NOT NULL,
		PRIMARY KEY (repo_id, pkg)
	) WITHOUT ROWID;
	CREATE TABLE engine_extensions (
		pkg TEXT PRIMARY KEY,
		repo_id INTEGER REFERENCES engine_repos(id) ON DELETE SET NULL,
		name TEXT NOT NULL,
		kind TEXT NOT NULL CHECK (kind IN ('manga', 'anime')),
		version_code INTEGER NOT NULL,
		version_name TEXT NOT NULL,
		lib TEXT NOT NULL,
		adult INTEGER NOT NULL DEFAULT 0,
		-- The APK's SHA-256: the engine's handle, and its file in the store.
		handle TEXT NOT NULL,
		previous_handle TEXT,
		previous_version TEXT,
		previous_until INTEGER,
		installed_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		-- Why it doesn't run ('' when it does): failed to load, needs a browser.
		failed TEXT NOT NULL DEFAULT ''
	) WITHOUT ROWID;
	CREATE TABLE engine_sources (
		id TEXT PRIMARY KEY,
		pkg TEXT NOT NULL REFERENCES engine_extensions(pkg) ON DELETE CASCADE,
		name TEXT NOT NULL,
		lang TEXT NOT NULL,
		base_url TEXT NOT NULL DEFAULT ''
	) WITHOUT ROWID;
	CREATE INDEX engine_sources_pkg ON engine_sources(pkg);
	CREATE TABLE engine_preferences (
		source_id TEXT NOT NULL,
		key TEXT NOT NULL,
		entry TEXT NOT NULL,
		PRIMARY KEY (source_id, key)
	) WITHOUT ROWID;
	`,
	// Migration 40: tsundoku's own download queue (doc/DOWNLOADS.md).
	// Keyed by tsundoku's entries, never by a source's ids. engine_series and
	// engine_chapters hold what the extension calls a series and a chapter
	// now (Toonily's moved to a new URL scheme): the engine is called with
	// those, while the series' key and the entries' URLs, which the device's
	// backup carries, never move. engine_series.title is fixed at the first
	// download: the importer pairs a download folder with its series by it,
	// so a rename in tsundoku must not move the folder.
	`
	CREATE TABLE engine_series (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		source_id TEXT NOT NULL,
		engine_url TEXT NOT NULL,
		title TEXT NOT NULL,
		resolved_at INTEGER
	);
	CREATE TABLE engine_chapters (
		entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
		engine_url TEXT NOT NULL,
		name TEXT NOT NULL DEFAULT ''
	);
	CREATE TABLE download_queue (
		entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		position REAL NOT NULL,
		state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'downloading', 'failed')),
		tries INTEGER NOT NULL DEFAULT 0,
		failure TEXT NOT NULL DEFAULT '',
		error TEXT NOT NULL DEFAULT '',
		-- Not before this (ms): backoff after a failed try.
		next_at INTEGER NOT NULL DEFAULT 0,
		done_pages INTEGER NOT NULL DEFAULT 0,
		pages INTEGER NOT NULL DEFAULT 0,
		queued_at INTEGER NOT NULL
	);
	CREATE INDEX download_queue_order ON download_queue(state, position);
	`,
	// Migration 41: when the downloader wrote a chapter's CBZ. Between
	// that and the import that attaches the file, the row says IMPORTING, as
	// it does for a chapter Suwayomi has and tsundoku hasn't read in yet.
	`
	ALTER TABLE engine_chapters ADD COLUMN downloaded_at INTEGER;
	`,
	// Migration 42: BROWSE's RECENT, the last sources browsed (doc/BROWSE.md).
	// One row a source, moved to now on each visit. Who may see a row
	// is decided when it's read (a mostly-hidden source only in reveal).
	`
	CREATE TABLE browse_recent (
		source_id TEXT PRIMARY KEY,
		browsed_at INTEGER NOT NULL
	) WITHOUT ROWID;
	`,
	// Migration 43: sites seen behind a browser check (doc/BROWSE.md, "A site's
	// check"), by host, so BROWSE can say a first visit waits for
	// it. Its own table: a source's rows are rewritten on every install.
	`
	CREATE TABLE site_checks (
		host TEXT PRIMARY KEY,
		seen_at INTEGER NOT NULL
	) WITHOUT ROWID;
	`,
	// Migration 44: LNReader's plugin repositories and the plugins installed from them
	// (doc/NOVELS.md). Their own tables, not the engine's: a repository
	// is one plugins.min.json with no signing key, and a plugin is a JavaScript file
	// pinned by its hash, run by tsundoku's plugin host rather than the engine.
	`
	CREATE TABLE novel_repos (
		id INTEGER PRIMARY KEY,
		url TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		added_at INTEGER NOT NULL,
		checked_at INTEGER,
		failed_at INTEGER,
		error TEXT NOT NULL DEFAULT ''
	);
	CREATE TABLE novel_listings (
		repo_id INTEGER NOT NULL REFERENCES novel_repos(id) ON DELETE CASCADE,
		plugin TEXT NOT NULL,
		listing TEXT NOT NULL,
		PRIMARY KEY (repo_id, plugin)
	) WITHOUT ROWID;
	CREATE TABLE novel_plugins (
		id TEXT PRIMARY KEY,
		repo_id INTEGER REFERENCES novel_repos(id) ON DELETE SET NULL,
		name TEXT NOT NULL,
		site TEXT NOT NULL DEFAULT '',
		lang TEXT NOT NULL DEFAULT '',
		version TEXT NOT NULL,
		-- The file's SHA-256: its name in the store.
		hash TEXT NOT NULL,
		previous_hash TEXT,
		previous_version TEXT,
		previous_until INTEGER,
		installed_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		failed TEXT NOT NULL DEFAULT ''
	) WITHOUT ROWID;
	`,
	// Migration 45: a novel's EPUB, as tsundoku's device writes it (doc/NOVELS.md,
	// "Downloading"). novel_series.file is where the book is, under
	// the library folder, fixed at its first download as engine_series.title
	// fixes a manga's folder: the book is rewritten in place as chapters
	// arrive, and a rename in tsundoku must not start a second one.
	// novel_chapters is what the worker has written into it: until the import
	// attaches the file, such a chapter is IMPORTING.
	`
	CREATE TABLE novel_series (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		file TEXT NOT NULL UNIQUE
	);
	CREATE TABLE novel_chapters (
		entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
		downloaded_at INTEGER NOT NULL
	);
	`,
	// Migration 46: when a followed novel's plugin was last asked for new chapters
	// (doc/NOVELS.md, "FOLLOW"), as engine_series.resolved_at is a
	// manga's: FOLLOW's step asks each every six hours, and the DOWNLOAD row
	// says CHECKED … AGO. Its own table: novel_series has a row only once
	// something downloaded.
	`
	CREATE TABLE novel_checks (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		checked_at INTEGER NOT NULL
	);
	`,
	// Migration 47: anime (doc/ANIME.md). A series of kind `anime` is
	// episodes; an episode's last_position is seconds into it, not a page.
	(conn) => {
		widenKinds(conn);
		conn.exec(`
		-- Seconds; NULL until a source or a file says.
		ALTER TABLE entries ADD COLUMN duration_s REAL;
		-- The source's season; NULL for a flat list.
		ALTER TABLE entries ADD COLUMN season INTEGER;
		-- Its number as the source gives it, which starts again each season.
		-- position stays the order across the whole series, unique as for a
		-- chapter, so nothing that reads positions (duplicates, the reader's
		-- next) meets two "EP. 1"s. NULL: the position is the number.
		ALTER TABLE entries ADD COLUMN episode_number REAL;
		-- FILLER or RECAP, where the source says so.
		ALTER TABLE entries ADD COLUMN episode_note TEXT NOT NULL DEFAULT ''
			CHECK (episode_note IN ('', 'filler', 'recap'));
		-- The episode's 16:9 picture at the source, when it has one.
		ALTER TABLE entries ADD COLUMN thumb_url TEXT NOT NULL DEFAULT '';
		-- Where the ending starts, in seconds, from the source's timestamps:
		-- an episode is watched there (doc/ANIME.md, "Watching is reading").
		ALTER TABLE entries ADD COLUMN ending_at REAL;
		`);
	},
	// Migration 48: anime downloads (doc/ANIME.md, "Downloading").
	// anime_series.folder is the series' folder under the library folder, in
	// Jellyfin's TV layout, fixed at its first download as a novel's book is:
	// files aren't renamed when a title is edited here. anime_episodes is what
	// the worker wrote and at which height, until the import attaches the file
	// (IMPORTING), and the quality a queued episode is to be downloaded at.
	`
	CREATE TABLE anime_series (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		folder TEXT NOT NULL UNIQUE
	);
	CREATE TABLE anime_episodes (
		entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
		-- Lines: 1080, 720, 360. NULL: SETTINGS' default.
		quality INTEGER,
		downloaded_at INTEGER
	);
	`,
	// Migration 49: when a followed anime's source was last asked for new episodes
	// (doc/ANIME.md, "FOLLOW"), as novel_checks is a novel's: FOLLOW's
	// step asks each every six hours, and the DOWNLOAD row says CHECKED … AGO.
	`
	CREATE TABLE anime_checks (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		checked_at INTEGER NOT NULL
	);
	`,
	// v50: the browsing record (doc/READING-ONLINE.md). A series opened from
	// a source's preview without ADD is a series all the same, so the readers and
	// the player work on it unchanged, but `in_library = 0` keeps it off every
	// shelf, count and scan; HISTORY shows it, and ADD sets it to 1, its progress
	// kept. `browsed_at` is when it was last opened that way.
	`
	ALTER TABLE series ADD COLUMN in_library INTEGER NOT NULL DEFAULT 1 CHECK (in_library IN (0, 1));
	ALTER TABLE series ADD COLUMN browsed_at INTEGER;
	CREATE INDEX series_browsing ON series(browsed_at) WHERE in_library = 0;
	`,
	// v51: a browsing record forgotten (FORGET, or 30 days after its last open;
	// doc/READING-ONLINE.md, "Forgetting and pruning"). The row stays, because
	// its reading happened and HISTORY keeps it, dimmed; its place and marks
	// go. Opening it again clears this.
	`
	ALTER TABLE series ADD COLUMN pruned_at INTEGER;
	`,
	// v52: a running work's chapters (doc/RANOBE.md, "Comics"). Ranobe takes any
	// chapter 1–10,000 of a work still coming out, past its count or with none,
	// so the count caps only a finished one. Every work is asked again: what was
	// kept said nothing about which were running.
	`
	ALTER TABLE ranobe_work_units ADD COLUMN open_run INTEGER NOT NULL DEFAULT 0;
	UPDATE ranobe_work_units SET type = NULL;
	`,
	// v53: one settings page (doc/SETTINGS.md). Each device's own settings, kept
	// here as well as in its browser: every storage key with its value and when
	// it was set, so the newer side wins key by key. And what the player chose
	// for a series (audio, subtitles, their size), moved here from each browser
	// so the page can list them under N SERIES DIFFER.
	`
	CREATE TABLE devices (
		id TEXT PRIMARY KEY,
		kind TEXT NOT NULL CHECK (kind IN ('phone', 'tablet', 'desktop')),
		label TEXT NOT NULL,
		seen_at INTEGER NOT NULL,
		settings TEXT NOT NULL DEFAULT '{}'
	) WITHOUT ROWID;
	CREATE TABLE series_player (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		choice TEXT NOT NULL,
		chosen_at INTEGER NOT NULL
	);
	`,
	// v54: phones paired over Wi-Fi (doc/WIFI.md). A token's hash,
	// never the token; the Wi-Fi address it was paired at, which its cookie
	// belongs to; and its DEVICES row, once its browser checks in, so SIGN OUT
	// can end it.
	`
	CREATE TABLE paired_devices (
		token_hash TEXT PRIMARY KEY,
		device_id TEXT,
		label TEXT NOT NULL,
		address TEXT NOT NULL,
		paired_at INTEGER NOT NULL,
		seen_at INTEGER NOT NULL
	) WITHOUT ROWID;
	CREATE INDEX paired_devices_device ON paired_devices (device_id);
	`,
	// v55: an anime a source kept as its own season ("… 3rd Season", a
	// `-season-3` slug) has that season stamped on its episodes, so the season
	// heads, the season fold, CONTINUE, the Jellyfin folder and the NFOs all
	// know it (doc/ANIME.md, "Seasons"). Only episodes that name no
	// season are stamped. The rule is inlined rather than imported from
	// `seasonOfTitle`: a migration must say the same thing in ten years, whatever
	// that function has learned by then.
	(conn) => {
		const inTitle = (text: string): number | null => {
			const after = /\bseason\s*(\d{1,3})\b/i.exec(text);
			if (after) return Number(after[1]);
			const before = /\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i.exec(text);
			return before ? Number(before[1]) : null;
		};
		const inSlug = (url: string): number | null => {
			const plain = /-season-(\d{1,3})(?:-|$)/i.exec(url);
			if (plain) return Number(plain[1]);
			const ordinal = /-(\d{1,2})(?:st|nd|rd|th)-season(?:-|$)/i.exec(url);
			return ordinal ? Number(ordinal[1]) : null;
		};
		const rows = conn
			.prepare(`SELECT id, title, origin_key FROM series WHERE kind = 'anime'`)
			.all() as { id: number; title: string; origin_key: string | null }[];
		const stamp = conn.prepare(
			`UPDATE entries SET season = ? WHERE series_id = ? AND season IS NULL`
		);
		for (const r of rows) {
			const season = inTitle(r.title) ?? inSlug(r.origin_key ?? '');
			if (season !== null) stamp.run(season, r.id);
		}
	},
	// v56: an episode's picture, made on the server (doc/ANIME.md, "Episode
	// pictures"): the source's own when it gives one (`thumb_url`),
	// else a frame of the episode, kept as covers/episodes/<id>.webp. When it was
	// made; NULL is none yet, so a file left by a deleted entry whose id came
	// round again is never shown for the new one.
	`
	ALTER TABLE entries ADD COLUMN thumb_at INTEGER;
	`,
	// v57: MOVE (doc/MOVE.md). A series moved to another source
	// keeps the old origin key and when it left, for MOVE BACK's 30 days and so
	// the tablet's backup, which still names it, resolves to this series rather
	// than making a twin. Each entry keeps the source it came from, so a chapter
	// the new source lacks says its old source and still downloads from there;
	// former_url is the address it had there, which a backup's plan finds it by.
	// move_dismissed_at is NOT NOW on the NO VIDEO band. episode_failures is a
	// NO SERVER answer per episode, which is what the band and the player's
	// "not just this episode" line are counted from.
	`
	ALTER TABLE series ADD COLUMN former_key TEXT;
	ALTER TABLE series ADD COLUMN former_at INTEGER;
	ALTER TABLE series ADD COLUMN former_source TEXT NOT NULL DEFAULT '';
	ALTER TABLE series ADD COLUMN former_offset INTEGER NOT NULL DEFAULT 1;
	ALTER TABLE series ADD COLUMN move_dismissed_at INTEGER;
	ALTER TABLE entries ADD COLUMN origin_source TEXT NOT NULL DEFAULT '';
	ALTER TABLE entries ADD COLUMN former_url TEXT NOT NULL DEFAULT '';
	CREATE INDEX series_former ON series(former_key) WHERE former_key IS NOT NULL;
	CREATE INDEX entries_former_url ON entries(series_id, former_url);
	CREATE TABLE episode_failures (
		entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		first_at INTEGER NOT NULL,
		last_at INTEGER NOT NULL,
		tries INTEGER NOT NULL DEFAULT 1
	);
	CREATE INDEX episode_failures_series ON episode_failures(series_id, last_at);
	`,
	// v58: every key a series has left, not only the last (doc/MOVE.md). Migration
	// 57 kept one, so a series moved A → B → C forgot A and a backup still naming A
	// made a twin. This is what the writer resolves any former key through;
	// series.former_key stays as the most recent, which is the one MOVE BACK
	// offers. An entry has the same record of its own addresses: a chapter matched
	// A → B → C kept only B's in former_url, so a backup naming A's copy would have
	// added it again. Migration 57's values are copied in; a key or URL that is
	// also the current one is not a former one.
	`
	CREATE TABLE series_former_keys (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		origin_key TEXT NOT NULL,
		source TEXT NOT NULL DEFAULT '',
		left_at INTEGER NOT NULL,
		PRIMARY KEY (series_id, origin_key)
	) WITHOUT ROWID;
	CREATE INDEX series_former_keys_key ON series_former_keys(origin_key);
	CREATE TABLE entry_former_urls (
		entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		former_url TEXT NOT NULL,
		left_at INTEGER NOT NULL,
		PRIMARY KEY (entry_id, former_url)
	) WITHOUT ROWID;
	CREATE INDEX entry_former_urls_url ON entry_former_urls(former_url);
	INSERT INTO series_former_keys (series_id, origin_key, source, left_at)
		SELECT id, former_key, former_source, COALESCE(former_at, 0) FROM series
		WHERE former_key IS NOT NULL AND former_key != COALESCE(origin_key, '');
	INSERT INTO entry_former_urls (entry_id, former_url, left_at)
		SELECT id, former_url, 0 FROM entries
		WHERE former_url != '' AND former_url != source_url;
	`,
	// v59: a TV is its own kind in DEVICES (doc/TV.md, doc/ANDROID.md). The app's
	// user agent names it a TV, but its row's kind said desktop because
	// devices.kind's CHECK had no fourth value. SQLite cannot alter a CHECK in
	// place; widening one that allows more changes nothing stored, so the schema's
	// text is edited and the result checked before the migration commits (migration
	// 47, and its reason).
	(conn) => widenDeviceKinds(conn),
	// v60: an episode's opening and ending, found for it (doc/ANIME.md,
	// "Openings and endings"). One row per episode and finder --
	// the source's own timestamps, AniSkip, a fingerprint -- found or not, so
	// a negative answer is remembered and the episode is not asked again.
	// Longer than a source's honest truth is not required; the bounds are the
	// fingerprint's. `entries.ending_at` stays where watching counts from, and
	// the best ending is written there. Migration 47's source endings are copied in
	// as the source's own (its +90 is what the downloaded-copy path used).
	`
	CREATE TABLE episode_marks (
		entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		method TEXT NOT NULL CHECK (method IN ('source', 'aniskip', 'fingerprint')),
		intro_start REAL,
		intro_end REAL,
		ending_start REAL,
		ending_end REAL,
		tried_at INTEGER NOT NULL,
		PRIMARY KEY (entry_id, method)
	) WITHOUT ROWID;
	CREATE INDEX episode_marks_tried ON episode_marks(method, tried_at);
	INSERT INTO episode_marks (entry_id, method, ending_start, ending_end, tried_at)
		SELECT id, 'source', ending_at, ending_at + 90, 0 FROM entries
		WHERE ending_at IS NOT NULL AND ending_at > 0;
	`,
	// v61: Works (doc/WORKS.md). A Work is a level above series that merges
	// nothing: a name, an order the user sets, and up to one Work per series.
	// `series_id UNIQUE` is what makes the last part true, and the cascade means a
	// deleted series cannot leave a Work naming it. Positions start at 1 and a gap
	// is harmless: order is by position. A Work of one cannot exist, and the rule
	// sits where a series disappears: this trigger runs after the cascade has taken
	// the membership away, so any Work left with fewer than two members goes,
	// memberships and all. The app's own removers (takeOut, a move in createWork or
	// addSeries) never DELETE a series row, so they still end the Work themselves
	// (`endIfOne`, src/lib/server/works.ts) with the facts UNDO needs. A DELETE
	// that goes through `series` -- delete.ts, the books fold, an import -- needs
	// no caller to remember: there is nothing to undo, because the part is gone.
	//
	// Work dismissals get a table of their own rather than reusing
	// `suggestion_dismissals`: the books' reader takes every row of that table
	// and parses its key as sorted ids, so a Work's key in there would be a
	// shape that table's reader was never written for. One table per meaning
	// costs nothing and MIGHT CONTINUE gets store and undo for free.
	`
	CREATE TABLE works (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		order_mode TEXT NOT NULL CHECK (order_mode IN ('hand', 'added', 'title'))
	);
	CREATE TABLE work_series (
		work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
		series_id INTEGER NOT NULL UNIQUE REFERENCES series(id) ON DELETE CASCADE,
		position INTEGER NOT NULL,
		PRIMARY KEY (work_id, series_id)
	);
	CREATE INDEX work_series_work ON work_series(work_id, position);
	-- A series can disappear through any delete path in the app, and the app's
	-- own removers are not the only ones: a trigger is the one place every
	-- path reaches. It sees the FK cascade already applied, so a Work of two
	-- left with one ends here, and a Work left with none goes too.
	CREATE TRIGGER series_deleted_ends_work AFTER DELETE ON series
	BEGIN
		DELETE FROM works WHERE (SELECT COUNT(*) FROM work_series ws WHERE ws.work_id = works.id) < 2;
	END;
	CREATE TABLE work_dismissals (
		series_ids TEXT PRIMARY KEY,
		dismissed_at INTEGER NOT NULL
	) WITHOUT ROWID;
	`,
	// v62: anime tracked a season at a time (doc/TRACKING.md, doc/LINKS.md).
	// AniList and MAL list each season as its own entry, while a tsundoku series
	// can hold several, so an anime's link is per season -- and up to two parts,
	// where a catalogue splits one season in two (`PART 1 · EP. 1 – 12`, `PART 2 ·
	// EP. 13 – 23`). `series_links` keeps meaning what it meant for manga and
	// novels, which are one entry across a series; an anime's own link in that
	// table is read as season 0's -- the whole run, where the source gave no
	// seasons at all -- so a link made before this migration still tracks the show
	// as the one entry it was.
	//
	// Nothing is migrated: no anime was linked when this shipped (0 links, measured
	// at 5a8ce32a). A migration that found one would keep it as season 0's link by
	// reading `series_links` as season 0, so no copy is needed either way. (That
	// reading kept a legacy anime's later seasons out of the pass and the review:
	// migration 68 moves the link onto its season after all.)
	//
	// `season` is `entries.season` (migration 47's stamp), 0 for a source that
	// gave none -- one flat list is one season to tsundoku. `episodes` is the
	// entry's own count as the catalogue gave it, which is what puts part 2's
	// first episode at part 1's count + 1: the link can say where the split
	// is without asking AniList again, and `year` is the row's own ("TV · 24
	// EP. · 2018") without another request. The primary key is the uniqueness
	// that matters -- one live link per series, season, part and catalogue,
	// each row naming at most one entry in each -- and the plain indexes are
	// what the readers look a row up by. An entry is deliberately not unique
	// across series: two tsundoku series for one show is the duplicate case,
	// not an error to refuse.
	//
	// `series_links` keeps a mirror of the first season linked, refreshed by
	// `syncSeriesLink` and never read for an anime by tracking: the one reader
	// that asks a series for one MAL entry is AniSkip, whose episode numbers
	// are per entry, and which refuses a season past the first.
	//
	// The state and the queue are keyed the same way: a season's progress is
	// its own highest watched episode, counted within its part, and one
	// season's send must never overwrite its sibling's.
	`
	CREATE TABLE series_season_links (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		season INTEGER NOT NULL,
		part INTEGER NOT NULL DEFAULT 1 CHECK (part IN (1, 2)),
		anilist_id INTEGER,
		mal_id INTEGER,
		via TEXT NOT NULL CHECK (via IN ('mihon', 'exact', 'review', 'pasted', 'list', 'relations')),
		title TEXT NOT NULL DEFAULT '',
		cover_url TEXT NOT NULL DEFAULT '',
		linked_at INTEGER NOT NULL,
		resolved_at INTEGER,
		filled_rating INTEGER,
		score REAL,
		format TEXT,
		episodes INTEGER,
		year INTEGER,
		PRIMARY KEY (series_id, season, part)
	) WITHOUT ROWID;
	CREATE INDEX series_season_links_anilist ON series_season_links(anilist_id);
	CREATE INDEX series_season_links_mal ON series_season_links(mal_id);
	CREATE TABLE season_link_searches (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		season INTEGER NOT NULL,
		part INTEGER NOT NULL DEFAULT 1,
		query TEXT NOT NULL,
		searched_at INTEGER,
		found INTEGER NOT NULL DEFAULT 0,
		skipped_at INTEGER,
		PRIMARY KEY (series_id, season, part)
	) WITHOUT ROWID;
	CREATE TABLE season_link_candidates (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		season INTEGER NOT NULL,
		part INTEGER NOT NULL DEFAULT 1,
		anilist_id INTEGER NOT NULL,
		rank INTEGER NOT NULL,
		data TEXT NOT NULL,
		PRIMARY KEY (series_id, season, part, anilist_id)
	) WITHOUT ROWID;
	CREATE TABLE season_link_decisions (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		season INTEGER NOT NULL,
		part INTEGER NOT NULL DEFAULT 1,
		decision TEXT NOT NULL CHECK (decision IN ('none', 'unlinked')),
		at INTEGER NOT NULL,
		PRIMARY KEY (series_id, season, part)
	) WITHOUT ROWID;
	CREATE TABLE season_tracker_state (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		season INTEGER NOT NULL,
		part INTEGER NOT NULL,
		service TEXT NOT NULL CHECK (service IN ('anilist', 'mal')),
		status TEXT,
		score REAL,
		progress INTEGER NOT NULL DEFAULT 0,
		read_at INTEGER,
		sent_at INTEGER,
		PRIMARY KEY (series_id, season, part, service)
	) WITHOUT ROWID;
	CREATE TABLE season_tracker_sends (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		season INTEGER NOT NULL,
		part INTEGER NOT NULL,
		service TEXT NOT NULL CHECK (service IN ('anilist', 'mal')),
		progress INTEGER,
		status TEXT,
		score REAL,
		wanted_at INTEGER NOT NULL,
		failed_at INTEGER,
		error TEXT,
		PRIMARY KEY (series_id, season, part, service)
	) WITHOUT ROWID;
	`,
	// v63: fingerprints found by the first matcher are fragments of an opening, a
	// third to a half of the song, so SKIP INTRO landed in its middle
	// (doc/ANIME.md, "Fingerprints of downloaded episodes"). The matcher that finds
	// the whole opening replaced it, but an episode with any `fingerprint` row is
	// not read again (a negative waits 14 days), so the old rows are forgotten
	// here, negatives too, and the next play finds them under the new rule. A
	// fragment is worse than no mark: no mark shows no SKIP INTRO at all.
	//
	// `entries.ending_at` follows the marks that remain. The ORDER BY and the
	// validity test below are `MARK_ORDER` and `saneRange` (src/lib/library/
	// marks.ts) as they stood when this migration was written, which is what
	// `syncEndingAt` would choose. That is frozen history, run once on the data
	// of its day: it is not a second copy of the rule to keep in step.
	`
	CREATE TEMP TABLE c384_stale AS SELECT DISTINCT entry_id FROM episode_marks WHERE method = 'fingerprint';
	DELETE FROM episode_marks WHERE method = 'fingerprint';
	UPDATE entries SET ending_at = (
		SELECT m.ending_start FROM episode_marks m
		WHERE m.entry_id = entries.id
			AND m.ending_start IS NOT NULL AND m.ending_end IS NOT NULL
			AND m.ending_start >= 0 AND m.ending_end > m.ending_start
			AND (entries.duration_s IS NULL OR entries.duration_s <= 0 OR m.ending_end <= entries.duration_s + 1)
		ORDER BY CASE m.method WHEN 'source' THEN 0 WHEN 'aniskip' THEN 1 ELSE 2 END
		LIMIT 1
	)
	WHERE id IN (SELECT entry_id FROM c384_stale);
	DROP TABLE c384_stale;
	`,
	// v64: AniSkip numbers its answers by MAL **anime** id, and MAL numbers
	// anime and manga apart, so an anime linked to a manga's entry asked about
	// an unrelated anime (Ranma ½ (2024) was linked to the manga, MAL
	// 23). Now AniSkip is asked only under a link whose format is an
	// anime's (`lookupAniSkip`). What the old rule already stored goes: every
	// `aniskip` row of an anime series whose `series_links` row is not an anime
	// format -- a manga's, a novel's, an unknown (NULL or '') one, or no row at
	// all, which is what the lookup would not ask under either.
	//
	// The formats are spelled out because SQL cannot ask `sameKind`: they are
	// `ANIME_FORMATS` (src/lib/library/catalogue.ts) on the day this was
	// written, frozen like the rest of a migration, which runs once. `ending_at`
	// follows what remains, by the same frozen copy of `syncEndingAt` as v63.
	`
	CREATE TEMP TABLE c395_stale AS SELECT DISTINCT m.entry_id FROM episode_marks m
		JOIN entries e ON e.id = m.entry_id
		JOIN series s ON s.id = e.series_id
		LEFT JOIN series_links l ON l.series_id = s.id
		WHERE m.method = 'aniskip' AND s.kind = 'anime'
			AND (l.format IS NULL OR l.format NOT IN ('TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'));
	DELETE FROM episode_marks WHERE method = 'aniskip' AND entry_id IN (SELECT entry_id FROM c395_stale);
	UPDATE entries SET ending_at = (
		SELECT m.ending_start FROM episode_marks m
		WHERE m.entry_id = entries.id
			AND m.ending_start IS NOT NULL AND m.ending_end IS NOT NULL
			AND m.ending_start >= 0 AND m.ending_end > m.ending_start
			AND (entries.duration_s IS NULL OR entries.duration_s <= 0 OR m.ending_end <= entries.duration_s + 1)
		ORDER BY CASE m.method WHEN 'source' THEN 0 WHEN 'aniskip' THEN 1 ELSE 2 END
		LIMIT 1
	)
	WHERE id IN (SELECT entry_id FROM c395_stale);
	DROP TABLE c395_stale;
	`,
	// v65: watching time for the anime watched before the player reported it
	// (doc/READING-LOG.md, "Estimated rows"). The player first sent no
	// `durationMs`, so every episode event carried 0. Its `page` is the position in
	// seconds and it sent one every 15 s while playing, so where a step's position
	// moved forward by what the clock did -- within 2 s -- the episode was playing
	// for all of it, and that is the step's time. A pause or a stall moves the
	// clock and not the position, a seek the position more than the clock, and both
	// are left at 0: an estimate that only counts what it can vouch for. On a real
	// library's copy 685 of 769 steps matched, 2.9 h.
	//
	// The kind is spelled out because SQL cannot ask the registry: it is the
	// video medium's on the day this was written, frozen like the rest of a migration.
	`
	CREATE TEMP TABLE c443_steps AS
	SELECT id, (page - prev_page) * 1000 AS ms FROM (
		SELECT re.id, re.kind, re.page, re.at, re.duration_ms,
			LAG(re.page) OVER w AS prev_page, LAG(re.at) OVER w AS prev_at
		FROM reading_events re JOIN series s ON s.id = re.series_id
		WHERE s.kind = 'anime' AND re.entry_id IS NOT NULL
			AND re.kind IN ('open', 'page', 'finish', 'close')
		WINDOW w AS (PARTITION BY re.entry_id ORDER BY re.at, re.id)
	)
	WHERE kind IN ('page', 'finish', 'close') AND duration_ms = 0
		AND prev_at IS NOT NULL AND page > prev_page AND page - prev_page <= 60
		AND ABS((page - prev_page) * 1000 - (at - prev_at)) <= 2000;
	UPDATE reading_events SET duration_ms = (SELECT ms FROM c443_steps c WHERE c.id = reading_events.id)
	WHERE id IN (SELECT id FROM c443_steps);
	DROP TABLE c443_steps;
	`,
	// v66: IMPORT A BACKUP and its log (doc/IMPORT-BACKUP.md). One row per file
	// chosen on /import: what it was, where it came from, what became of it.
	// A scan stays a `scan_jobs` row alone; an import runs as a scan job too
	// (`job_id`), so the library's band and "one at a time" are the scan's.
	// `state`: read (previewed, nothing written), refused (not a backup it
	// reads), waiting (behind a running scan or import), running, done,
	// failed. The counts the log shows are not stored: they are read from
	// `import_series` through `series`, so they follow reveal and a series
	// deleted since stops counting. `outcome` holds what no row can: the
	// shelves made, the categories left out, the extensions installed or
	// skipped, the series left out and the titles refused.
	`
	CREATE TABLE imports (
		id INTEGER PRIMARY KEY,
		created_at INTEGER NOT NULL,
		app TEXT NOT NULL DEFAULT '',
		file_name TEXT NOT NULL,
		file_bytes INTEGER NOT NULL DEFAULT 0,
		made_at INTEGER,
		stored TEXT NOT NULL DEFAULT '',
		origin TEXT NOT NULL DEFAULT '',
		state TEXT NOT NULL CHECK (state IN ('read', 'refused', 'waiting', 'running', 'done', 'failed')),
		refusal TEXT NOT NULL DEFAULT '',
		job_id INTEGER REFERENCES scan_jobs(id) ON DELETE SET NULL,
		series_total INTEGER NOT NULL DEFAULT 0,
		series_done INTEGER NOT NULL DEFAULT 0,
		started_at INTEGER,
		finished_at INTEGER,
		outcome TEXT NOT NULL DEFAULT '{}'
	);
	CREATE INDEX imports_job ON imports(job_id) WHERE job_id IS NOT NULL;
	CREATE TABLE import_series (
		import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		created INTEGER NOT NULL,
		PRIMARY KEY (import_id, series_id)
	);
	CREATE INDEX import_series_series ON import_series(series_id);
	`,
	// v67: AniSkip answers asked under another season's entry (doc/ANIME.md,
	// "Openings and endings"). Before per-season lookups an episode was asked under
	// the series' `series_links` row -- the mirror `syncSeriesLink` keeps of the
	// lowest season linked, part 1 (of the season linked last, before 45d2a8d) --
	// with the season's own episode number, and only for a season of 0 or 1 (a NULL
	// season is 0; one past the first was never asked). Now it is asked under its
	// own season's row and part, numbered within the part (`episodeEntry`). A found
	// answer is never asked again, so the old ones stay unless a migration forgets
	// them.
	//
	// The class: an `aniskip` row of an anime with season rows, on an episode
	// of season 0 or 1, unless the mirror is that episode's own season's part
	// 1 and the episode lies in part 1: the season has one part, or the number
	// is within part 1's `episodes`. The mirror read here is the row the
	// answer was asked under: every path that changes a link forgets the
	// series' AniSkip rows, and a mirror whose MAL id moved otherwise (a
	// resolve) no longer matches, so its answers are forgotten too. Beside a
	// part 2, a part 1 of unknown length runs to the season's aired count,
	// which SQL does not have here: that season's answers all go, and part
	// 1's come back the same. The class takes a season-1 episode while season 0
	// is linked too (asked under season 0's id, whether or not season 1 is
	// linked), part 2 of a split season (asked under part 1's id as EP. 13, not
	// EP. 1), and a season-0 episode while only season 1 is (asked under season
	// 1's id). A series with no season rows, linked before migration 62, is asked
	// under that one link now as then, and a season past the first has only
	// answers the per-season lookup asked: both stay. An answer it asked on an
	// episode of the class goes too; it is asked again, once, and comes back the
	// same.
	//
	// The found answers and the remembered misses both go, so the next play
	// asks AniSkip at once rather than in a week. `ending_at` follows what
	// remains, by the same frozen copy of `syncEndingAt` as v63 and v64.
	`
	CREATE TEMP TABLE c463_stale AS SELECT DISTINCT m.entry_id FROM episode_marks m
		JOIN entries e ON e.id = m.entry_id
		JOIN series s ON s.id = e.series_id
		LEFT JOIN series_links l ON l.series_id = s.id
		WHERE m.method = 'aniskip' AND s.kind = 'anime'
			AND COALESCE(e.season, 0) <= 1
			AND EXISTS (SELECT 1 FROM series_season_links x WHERE x.series_id = s.id)
			AND NOT EXISTS (SELECT 1 FROM series_season_links x
				WHERE x.series_id = s.id AND x.season = COALESCE(e.season, 0) AND x.part = 1
					AND x.mal_id = l.mal_id
					AND (NOT EXISTS (SELECT 1 FROM series_season_links y
							WHERE y.series_id = s.id AND y.season = x.season AND y.part > 1)
						OR (x.episodes > 0
							AND COALESCE(e.episode_number, CASE WHEN e.season IS NULL THEN e.position END) <= x.episodes)));
	DELETE FROM episode_marks WHERE method = 'aniskip' AND entry_id IN (SELECT entry_id FROM c463_stale);
	UPDATE entries SET ending_at = (
		SELECT m.ending_start FROM episode_marks m
		WHERE m.entry_id = entries.id
			AND m.ending_start IS NOT NULL AND m.ending_end IS NOT NULL
			AND m.ending_start >= 0 AND m.ending_end > m.ending_start
			AND (entries.duration_s IS NULL OR entries.duration_s <= 0 OR m.ending_end <= entries.duration_s + 1)
		ORDER BY CASE m.method WHEN 'source' THEN 0 WHEN 'aniskip' THEN 1 ELSE 2 END
		LIMIT 1
	)
	WHERE id IN (SELECT entry_id FROM c463_stale);
	DROP TABLE c463_stale;
	`,
	// v68: an anime linked before migration 62 gets its season row (doc/LINKS.md,
	// "A link from before the seasons"). Such an anime has only a `series_links`
	// row, which `NEEDS_LOOK` reads as the whole series settled, so its later
	// seasons never reached the pass or the review. The link becomes the row of the
	// season it stood for, decided by the series' own episodes: the lowest numbered
	// season (1 and up) when the source numbers any, else season 0, the flat list
	// that is the whole run. Part 1, with the link's ids, `via` (whose values
	// `series_season_links` allows all of), title, cover, dates, score and
	// `filled_rating`, so UNDO and tracking read what they read before; `episodes`
	// and `year` were never stored and stay NULL, as a pasted link's do. From here
	// the season rule decides the series: every other season is open until linked
	// or settled.
	//
	// `series_links` is not touched: it becomes the first season's mirror
	// (`syncSeriesLink` writes the same ids, `via`, title, cover and dates),
	// and its readers -- the importer's keep-test, OTHER NAMES on MOVE, the
	// cover -- read what they did (v74 moves them). A season decision at the
	// row's own place goes, as `linkSeason` takes it: the link was what every
	// screen showed. What the user's list said of the series (`tracker_state`)
	// and a send still waiting (`tracker_sends`) move to that season, where an
	// anime's are read; a season's own row, written since, wins. An AniSkip
	// answer of an episode outside that season was asked under the old link,
	// which is now that season's alone, so it goes too, and `ending_at`
	// follows by the frozen copy of `syncEndingAt` (v63, v64, v67).
	`
	CREATE TEMP TABLE c383_moved AS SELECT l.series_id, COALESCE((SELECT MIN(e.season) FROM entries e
			WHERE e.series_id = l.series_id AND e.shadowed = 0 AND e.season >= 1), 0) AS season
		FROM series_links l JOIN series s ON s.id = l.series_id
		WHERE s.kind = 'anime' AND (l.anilist_id IS NOT NULL OR l.mal_id IS NOT NULL)
			AND NOT EXISTS (SELECT 1 FROM series_season_links x WHERE x.series_id = l.series_id);
	INSERT INTO series_season_links (series_id, season, part, anilist_id, mal_id, via, title, cover_url,
			linked_at, resolved_at, filled_rating, score, format)
		SELECT l.series_id, m.season, 1, l.anilist_id, l.mal_id, l.via, l.title, l.cover_url,
			l.linked_at, l.resolved_at, l.filled_rating, l.score, l.format
		FROM series_links l JOIN c383_moved m ON m.series_id = l.series_id;
	DELETE FROM season_link_decisions WHERE part = 1
		AND EXISTS (SELECT 1 FROM c383_moved m WHERE m.series_id = season_link_decisions.series_id
			AND m.season = season_link_decisions.season);
	INSERT OR IGNORE INTO season_tracker_state (series_id, season, part, service, status, score, progress, read_at, sent_at)
		SELECT t.series_id, m.season, 1, t.service, t.status, t.score, t.progress, t.read_at, t.sent_at
		FROM tracker_state t JOIN c383_moved m ON m.series_id = t.series_id;
	DELETE FROM tracker_state WHERE series_id IN (SELECT series_id FROM c383_moved);
	INSERT OR IGNORE INTO season_tracker_sends (series_id, season, part, service, progress, status, score, wanted_at, failed_at, error)
		SELECT t.series_id, m.season, 1, t.service, t.progress, t.status, t.score, t.wanted_at, t.failed_at, t.error
		FROM tracker_sends t JOIN c383_moved m ON m.series_id = t.series_id;
	DELETE FROM tracker_sends WHERE series_id IN (SELECT series_id FROM c383_moved);
	CREATE TEMP TABLE c383_stale AS SELECT DISTINCT mk.entry_id FROM episode_marks mk
		JOIN entries e ON e.id = mk.entry_id
		JOIN c383_moved m ON m.series_id = e.series_id
		WHERE mk.method = 'aniskip' AND COALESCE(e.season, 0) != m.season;
	DELETE FROM episode_marks WHERE method = 'aniskip' AND entry_id IN (SELECT entry_id FROM c383_stale);
	UPDATE entries SET ending_at = (
		SELECT m.ending_start FROM episode_marks m
		WHERE m.entry_id = entries.id
			AND m.ending_start IS NOT NULL AND m.ending_end IS NOT NULL
			AND m.ending_start >= 0 AND m.ending_end > m.ending_start
			AND (entries.duration_s IS NULL OR entries.duration_s <= 0 OR m.ending_end <= entries.duration_s + 1)
		ORDER BY CASE m.method WHEN 'source' THEN 0 WHEN 'aniskip' THEN 1 ELSE 2 END
		LIMIT 1
	)
	WHERE id IN (SELECT entry_id FROM c383_stale);
	DROP TABLE c383_stale;
	DROP TABLE c383_moved;
	`,
	// v69: which way a novel's paged pages turn (doc/TEXT-READER.md,
	// "Direction"). Its own column, because `direction` already holds a
	// novel's layout (PAGED or SCROLL) and a novel reads both ways in either.
	// NULL is the default, L→R, which REMEMBER L→R writes back as NULL; only
	// the text reader reads or writes it, and it means nothing for a series
	// that isn't a novel. Nothing stored moves: every series starts at NULL.
	`
	ALTER TABLE series ADD COLUMN text_direction TEXT
		CHECK (text_direction IS NULL OR text_direction IN ('ltr', 'rtl'));
	`,
	// v70: where a comic's entry comes from and the year it began (doc/LINKS.md,
	// doc/SERIES.md "LISTS"), so its LISTS line can say `MANHWA · 2020`. AniList's
	// countryOfOrigin (JP, KR, CN, TW) and startDate's year, kept where a link is
	// written. Both NULL on every link made before the migration: the next cover
	// pass asks AniList for them (`resolveLinks`), and until then the line says
	// what it said (MANGA). '' is asked and not known, so the pass doesn't ask
	// again. A season's link already keeps its year (`series_season_links.year`).
	`
	ALTER TABLE series_links ADD COLUMN country TEXT;
	ALTER TABLE series_links ADD COLUMN year INTEGER;
	`,
	// v71: the Works a scan's or an import's folds took a series out of
	// (doc/IMPORT-BACKUP.md, "The log"), as JSON (`Dropped[]`, import/fold.ts), so the
	// IMPORT LOG can say DROPPED FROM <WORK>. Before it only the summary and the
	// server's log had them. '[]' is right for every job already stored: nothing
	// recorded them, and what a fold dropped then cannot be read back from anything
	// kept, so an old job lists none.
	`
	ALTER TABLE scan_jobs ADD COLUMN dropped TEXT NOT NULL DEFAULT '[]';
	`,
	// v72: highlights (doc/HIGHLIGHTS.md). A highlight is a copy and a pointer, and
	// the copy outlives the place it points at, so nothing here cascades from
	// `series` or `entries`: a delete marks the pointer ORPHAN and keeps the row.
	// The pointer keeps what outlives an id: the series' origin key, and the
	// entry's number and season, by which a series re-added from the same source
	// finds its highlights again.
	//
	// The life is kept by triggers rather than a call in each path, because a
	// series or an entry goes through a dozen paths (delete.ts, the books'
	// folds, an import's fold, MOVE BACK, UNDO of an ADD, a root's cascade)
	// and a trigger is the one place every one of them reaches, foreign-key
	// cascades included: SQLite fires a child table's DELETE triggers for an
	// ON DELETE CASCADE (tests/highlights-db.spec.ts measures it).
	//
	// kind is the highlight's own (quote, page, clip), never a series' kind;
	// series_kind is the snapshot's. state: 'ok', 'orphan_series' (the series
	// is gone), 'orphan_entry' (the chapter or episode is gone), 'detached'
	// (a quote its chapter's text no longer holds).
	// rejoin is 1 while a re-added series waits for its entries to come back
	// by number; only those highlights re-attach, so an entry renumbered
	// inside a series that never left (the books' resequence) is never taken
	// for a lost one. hidden is copied from the series when made, follows it
	// while it exists, and is kept after it's gone. deleted_at is the user's
	// own DELETE, kept a moment for UNDO.
	`
	CREATE TABLE highlights (
		id INTEGER PRIMARY KEY,
		kind TEXT NOT NULL CHECK (kind IN ('quote', 'page', 'clip')),
		series_id INTEGER,
		entry_id INTEGER,
		origin_key TEXT,
		number REAL,
		season INTEGER,
		block INTEGER,
		block_offset INTEGER,
		end_block INTEGER,
		end_offset INTEGER,
		page INTEGER,
		page_end INTEGER,
		clip_in REAL,
		clip_out REAL,
		series_title TEXT NOT NULL,
		series_kind TEXT NOT NULL,
		cover TEXT NOT NULL DEFAULT '',
		entry_label TEXT NOT NULL DEFAULT '',
		entry_title TEXT NOT NULL DEFAULT '',
		volume TEXT NOT NULL DEFAULT '',
		quote TEXT NOT NULL DEFAULT '',
		quote_before TEXT NOT NULL DEFAULT '',
		quote_after TEXT NOT NULL DEFAULT '',
		paragraph TEXT NOT NULL DEFAULT '',
		context TEXT NOT NULL DEFAULT '',
		colour TEXT CHECK (colour IS NULL OR colour IN ('yellow', 'orange', 'blue')),
		note TEXT NOT NULL DEFAULT '',
		made_at INTEGER NOT NULL,
		hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
		copy_path TEXT NOT NULL DEFAULT '',
		still_path TEXT NOT NULL DEFAULT '',
		copy_bytes INTEGER NOT NULL DEFAULT 0,
		copy_width INTEGER,
		copy_height INTEGER,
		quality TEXT NOT NULL DEFAULT '',
		tracks TEXT NOT NULL DEFAULT '[]',
		track TEXT,
		state TEXT NOT NULL DEFAULT 'ok'
			CHECK (state IN ('ok', 'orphan_series', 'orphan_entry', 'detached')),
		orphaned_at INTEGER,
		rejoin INTEGER NOT NULL DEFAULT 0 CHECK (rejoin IN (0, 1)),
		deleted_at INTEGER,
		CHECK (kind = 'quote' OR colour IS NULL)
	);
	CREATE INDEX highlights_made ON highlights(made_at DESC, id DESC);
	CREATE INDEX highlights_series ON highlights(series_id) WHERE series_id IS NOT NULL;
	CREATE INDEX highlights_entry ON highlights(entry_id) WHERE entry_id IS NOT NULL;
	CREATE INDEX highlights_lost ON highlights(origin_key) WHERE series_id IS NULL;

	-- The place went: the pointer says so, the copy and the note stay.
	CREATE TRIGGER highlights_entry_gone AFTER DELETE ON entries
	BEGIN
		UPDATE highlights SET entry_id = NULL,
			state = CASE WHEN state = 'orphan_series' THEN state ELSE 'orphan_entry' END,
			orphaned_at = COALESCE(orphaned_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
		WHERE entry_id = OLD.id;
	END;
	CREATE TRIGGER highlights_series_gone AFTER DELETE ON series
	BEGIN
		UPDATE highlights SET series_id = NULL, entry_id = NULL, state = 'orphan_series', rejoin = 0,
			orphaned_at = COALESCE(orphaned_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
		WHERE series_id = OLD.id;
	END;

	-- An entry folded into another series takes its highlights along.
	CREATE TRIGGER highlights_entry_moved AFTER UPDATE OF series_id ON entries
		WHEN NEW.series_id IS NOT OLD.series_id
	BEGIN
		UPDATE highlights SET series_id = NEW.series_id,
			origin_key = (SELECT origin_key FROM series WHERE id = NEW.series_id),
			hidden = COALESCE((SELECT CASE WHEN s.hidden = 1 OR (r.hidden = 1 AND s.public = 0) THEN 1 ELSE 0 END
				FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = NEW.series_id), hidden)
		WHERE entry_id = NEW.id;
	END;
	-- However a highlight changes series (a fold's generic series_id sweep
	-- moves the orphaned ones no entry carries), it takes that series' key and
	-- hidden flag: a loser's key would re-resolve it into a series it left.
	CREATE TRIGGER highlights_moved AFTER UPDATE OF series_id ON highlights
		WHEN NEW.series_id IS NOT NULL AND NEW.series_id IS NOT OLD.series_id
	BEGIN
		UPDATE highlights SET
			origin_key = (SELECT origin_key FROM series WHERE id = NEW.series_id),
			hidden = COALESCE((SELECT CASE WHEN s.hidden = 1 OR (r.hidden = 1 AND s.public = 0) THEN 1 ELSE 0 END
				FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = NEW.series_id), hidden)
		WHERE id = NEW.id;
	END;
	-- The keys follow the entry while it is there, so a later re-add matches
	-- the number it had last, not the one it was made at.
	CREATE TRIGGER highlights_entry_numbered AFTER UPDATE OF position, episode_number, season ON entries
	BEGIN
		UPDATE highlights SET number = COALESCE(NEW.episode_number, NEW.position), season = NEW.season
		WHERE entry_id = NEW.id;
		UPDATE highlights SET entry_id = NEW.id, state = 'ok', rejoin = 0, orphaned_at = NULL
		WHERE rejoin = 1 AND entry_id IS NULL AND series_id = NEW.series_id
			AND number = COALESCE(NEW.episode_number, NEW.position) AND season IS NEW.season;
	END;
	CREATE TRIGGER highlights_entry_back AFTER INSERT ON entries
	BEGIN
		UPDATE highlights SET entry_id = NEW.id, state = 'ok', rejoin = 0, orphaned_at = NULL
		WHERE rejoin = 1 AND entry_id IS NULL AND series_id = NEW.series_id
			AND number = COALESCE(NEW.episode_number, NEW.position) AND season IS NEW.season;
	END;

	-- The series' key follows it (MOVE, MOVE BACK, a fold's re-key), and a key
	-- that comes back to the library finds what it left: the series at once,
	-- each entry by its number and season, now if it is already there (a
	-- browsing record's) and as it arrives otherwise (highlights_entry_back).
	CREATE TRIGGER highlights_series_rekeyed AFTER UPDATE OF origin_key ON series
		WHEN NEW.origin_key IS NOT NULL AND NEW.origin_key IS NOT OLD.origin_key
	BEGIN
		UPDATE highlights SET origin_key = NEW.origin_key WHERE series_id = NEW.id;
		UPDATE highlights SET series_id = NEW.id, state = 'orphan_entry', rejoin = 1,
			hidden = (SELECT CASE WHEN NEW.hidden = 1 OR (r.hidden = 1 AND NEW.public = 0) THEN 1 ELSE 0 END
				FROM roots r WHERE r.id = NEW.root_id)
		WHERE series_id IS NULL AND origin_key = NEW.origin_key AND NEW.in_library = 1;
		UPDATE highlights SET entry_id = (SELECT e.id FROM entries e WHERE e.series_id = NEW.id
				AND COALESCE(e.episode_number, e.position) = highlights.number AND e.season IS highlights.season
				ORDER BY e.id LIMIT 1),
			state = 'ok', rejoin = 0, orphaned_at = NULL
		WHERE rejoin = 1 AND entry_id IS NULL AND series_id = NEW.id AND EXISTS (SELECT 1 FROM entries e
			WHERE e.series_id = NEW.id AND COALESCE(e.episode_number, e.position) = highlights.number
				AND e.season IS highlights.season);
	END;
	CREATE TRIGGER highlights_series_back AFTER INSERT ON series
		WHEN NEW.origin_key IS NOT NULL AND NEW.in_library = 1
	BEGIN
		UPDATE highlights SET series_id = NEW.id, state = 'orphan_entry', rejoin = 1,
			hidden = (SELECT CASE WHEN NEW.hidden = 1 OR (r.hidden = 1 AND NEW.public = 0) THEN 1 ELSE 0 END
				FROM roots r WHERE r.id = NEW.root_id)
		WHERE series_id IS NULL AND origin_key = NEW.origin_key;
		UPDATE highlights SET entry_id = (SELECT e.id FROM entries e WHERE e.series_id = NEW.id
				AND COALESCE(e.episode_number, e.position) = highlights.number AND e.season IS highlights.season
				ORDER BY e.id LIMIT 1),
			state = 'ok', rejoin = 0, orphaned_at = NULL
		WHERE rejoin = 1 AND entry_id IS NULL AND series_id = NEW.id AND EXISTS (SELECT 1 FROM entries e
			WHERE e.series_id = NEW.id AND COALESCE(e.episode_number, e.position) = highlights.number
				AND e.season IS highlights.season);
	END;
	-- A browsing record made the library's by ADD (doc/READING-ONLINE.md) is a re-add too.
	CREATE TRIGGER highlights_series_added AFTER UPDATE OF in_library ON series
		WHEN NEW.in_library = 1 AND OLD.in_library = 0 AND NEW.origin_key IS NOT NULL
	BEGIN
		UPDATE highlights SET series_id = NEW.id, state = 'orphan_entry', rejoin = 1,
			hidden = (SELECT CASE WHEN NEW.hidden = 1 OR (r.hidden = 1 AND NEW.public = 0) THEN 1 ELSE 0 END
				FROM roots r WHERE r.id = NEW.root_id)
		WHERE series_id IS NULL AND origin_key = NEW.origin_key;
		UPDATE highlights SET entry_id = (SELECT e.id FROM entries e WHERE e.series_id = NEW.id
				AND COALESCE(e.episode_number, e.position) = highlights.number AND e.season IS highlights.season
				ORDER BY e.id LIMIT 1),
			state = 'ok', rejoin = 0, orphaned_at = NULL
		WHERE rejoin = 1 AND entry_id IS NULL AND series_id = NEW.id AND EXISTS (SELECT 1 FROM entries e
			WHERE e.series_id = NEW.id AND COALESCE(e.episode_number, e.position) = highlights.number
				AND e.season IS highlights.season);
	END;

	-- Hidden follows the series while it exists, by visibility.ts' one rule.
	CREATE TRIGGER highlights_series_hidden AFTER UPDATE OF hidden, public, root_id ON series
	BEGIN
		UPDATE highlights SET hidden = (SELECT CASE WHEN NEW.hidden = 1 OR (r.hidden = 1 AND NEW.public = 0)
			THEN 1 ELSE 0 END FROM roots r WHERE r.id = NEW.root_id)
		WHERE series_id = NEW.id;
	END;
	CREATE TRIGGER highlights_root_hidden AFTER UPDATE OF hidden ON roots
	BEGIN
		UPDATE highlights SET hidden = (SELECT CASE WHEN s.hidden = 1 OR (NEW.hidden = 1 AND s.public = 0)
			THEN 1 ELSE 0 END FROM series s WHERE s.id = highlights.series_id)
		WHERE series_id IN (SELECT id FROM series WHERE root_id = NEW.id);
	END;
	`,
	// v73: an anime's AniList relation graph, cached (doc/LINKS.md,
	// "The relation cache"). The series screen draws the seasons before an
	// anime and the one after from it, and never asks AniList on a load: the
	// link pass (`refreshLinks`) fills and refreshes it. One row a series, gone
	// with the series. `graph` is the JSON `RelGraph`
	// (src/lib/library/seasons-around.ts): every entry the walk met, by
	// AniList id, with its edges where the walk asked for them; NULL until a
	// walk first succeeds. Which entries the walk starts from is not stored:
	// it is read from the series' season links each time, so a relink, an
	// UNLINK or a season linked since is seen at once, and a graph that can't
	// answer for the links the series has now is not drawn. `fetched_at` is
	// when `graph` was last written; `tried_at` when the pass last asked,
	// which a failed ask moves without touching `graph`. Nothing is stored for
	// the library yet, so the table starts empty and fills from the next pass.
	`
	CREATE TABLE series_relations (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		graph TEXT,
		fetched_at INTEGER,
		tried_at INTEGER NOT NULL,
		CHECK ((graph IS NULL) = (fetched_at IS NULL))
	);
	`,
	// v74: an anime's `series_links` row beside a season row goes (doc/LINKS.md, "A
	// season's link is its own row"). Since migration 62 that row was a mirror of
	// the first season, kept by `syncSeriesLink` for readers that asked a series
	// for one row; the last of them moved to the season rows with this migration,
	// so nothing reads it. Taken only where a season row stands beside it, and
	// every column it held is either that row's too or was only its own and read by
	// nothing (`score`, `filled_rating`; migration 68 copied a real link's to the
	// season). An anime's row with no season row is the one link it has, read by
	// `legacyLink`, and stays; so does every comic's and novel's. Naming the kind
	// is what a frozen migration does: the registry may change, this migration's
	// meaning must not.
	`
	DELETE FROM series_links
	WHERE series_id IN (SELECT id FROM series WHERE kind = 'anime')
		AND EXISTS (SELECT 1 FROM series_season_links x WHERE x.series_id = series_links.series_id);
	`,
	// v75: a series' sources, a season at a time (doc/WORKS.md, "Per-season
	// sources"). Each season of a show merged from several source entries keeps
	// that entry's key, its folder and what the source called it. **Beside
	// `series_season_links` and not in it**: that table's key has a `part`, so a
	// two-part season would hold one source on two rows, and its `via` is NOT NULL
	// with a CHECK over how a link was made, so a season with a source and no
	// AniList or MAL link cannot be a row there. This one has no link column, so it
	// is never a second link table.
	//
	// Existing series get no rows. A series with none reads exactly as before,
	// through `series.origin_key` and `anime_series.folder`
	// (src/lib/server/season-facts.ts). `folder` is unique as
	// `anime_series.folder` is unique, and the walk that names a new one asks
	// both. `origin_key` is deliberately not unique: two seasons of one series
	// may share a source entry.
	`
	CREATE TABLE series_season_facts (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		season INTEGER NOT NULL,
		origin_key TEXT,
		folder TEXT,
		source_title TEXT NOT NULL DEFAULT '',
		PRIMARY KEY (series_id, season)
	) WITHOUT ROWID;
	CREATE INDEX series_season_facts_origin ON series_season_facts(origin_key) WHERE origin_key IS NOT NULL;
	CREATE UNIQUE INDEX series_season_facts_folder ON series_season_facts(folder) WHERE folder IS NOT NULL;
	`,
	// v76: a book's own origin (doc/BOOKS.md, "Where a book's origin
	// lives"). `series.origin_key` names one series at a source, and a group of
	// one-offs is several, so grouping moves a one-off's key here with what the
	// engine called it, beside its entry, and taking it out moves them back.
	// Keyed by the entry, because the entry is the one row that survives a
	// group, an UNGROUP and an UNDO, where the singleton's series id does not.
	// Beside `series_season_facts` and not in it: a one-off has no season, and
	// every book of a group would read one row as season 0. `origin_key` isn't
	// unique, since every chapter of a novel grouped as a volume holds its
	// novel's key.
	//
	// **It repairs nothing.** A book grouped before this migration kept only its
	// chapter's address (`entries.source_url`) and `origin_source`, which only
	// MOVE writes; the source id and the manga's address went with its series
	// row, and neither `engine_chapters` nor any other table holds them. A key
	// is `mihon:<source>:<manga url>`, so one built from those would be a guess
	// written into the library.
	`
	CREATE TABLE entry_origins (
		entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
		origin_key TEXT NOT NULL,
		source_title TEXT NOT NULL DEFAULT '',
		engine_url TEXT,
		engine_title TEXT,
		resolved_at INTEGER
	) WITHOUT ROWID;
	CREATE INDEX entry_origins_key ON entry_origins(origin_key);
	`,
	// v77: what a merged show was (doc/WORKS.md, "Per-season
	// sources"). The merge keeps S1's series row as the show and deletes every
	// other season's, which cascades everything that references it; UNDO must
	// put each one back **under its own id**, with its own rating, FAV, tags,
	// shelves, links, folders and tracking state, because an id that changes
	// breaks every outside reference.
	// `series_season_facts` knows each season's source and folder, and
	// `series_season_links` its links, but neither holds an original series
	// id, a rating or a FAV. So the merge records the whole of every series it
	// touches, as JSON, here; UNGROUP and a take-one-out restore from it and
	// delete the row. One show holds one row, and nothing else reads it.
	`
	CREATE TABLE season_merges (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		made_at INTEGER NOT NULL,
		facts TEXT NOT NULL
	) WITHOUT ROWID;

	-- The merge deletes the absorbed seasons' series rows, and SQLite hands a
	-- new row the largest id plus one, so the next series added would take an
	-- absorbed id (measured: the second season's) and the undo would fail for
	-- good. A row left in the table keeps the id from being handed
	-- out; reserve_at marks it, season_reservations says which merge it
	-- belongs to, and the trigger below takes it away when that merge is
	-- undone or the show is deleted. A placeholder is no library row:
	-- in_library = 0, hidden, no key, pruned, and favourite so the importer's
	-- empty-series sweep never takes it (import/index.ts).
	ALTER TABLE series ADD COLUMN reserve_at INTEGER;
	ALTER TABLE works ADD COLUMN reserve_at INTEGER;
	CREATE TABLE season_reservations (
		merge INTEGER NOT NULL REFERENCES season_merges(series_id)
			ON DELETE CASCADE ON UPDATE CASCADE,
		kind TEXT NOT NULL CHECK (kind IN ('series', 'works')),
		id INTEGER NOT NULL,
		PRIMARY KEY (merge, kind, id)
	) WITHOUT ROWID;
	CREATE TRIGGER season_reservations_cleared AFTER DELETE ON season_reservations
	BEGIN
		DELETE FROM series WHERE reserve_at IS NOT NULL AND id = OLD.id;
		DELETE FROM works WHERE reserve_at IS NOT NULL AND id = OLD.id;
	END;

	-- A Work of one ends, but a placeholder Work has no members and must wait
	-- for its merge's undo. The reservation trigger removes it.
	DROP TRIGGER series_deleted_ends_work;
	CREATE TRIGGER series_deleted_ends_work AFTER DELETE ON series
	BEGIN
		DELETE FROM works WHERE reserve_at IS NULL
			AND (SELECT COUNT(*) FROM work_series ws WHERE ws.work_id = works.id) < 2;
	END;
	`,
	// v78: whether an extension's code uses a WebView (doc/EXTENSION-ENGINE.md,
	// "Cloudflare and WebView extensions"; doc/BROWSE.md, "Extensions that need a WebView"): 1 or
	// 0, from the engine's `extensionInfo.usesWebView` at install, or from the
	// APK's own dex (`apkUsesWebView`). NULL until known: an extension
	// installed before this migration is read from its stored APK on the first
	// BROWSE or EXTENSIONS visit (`fillWebViewFlags`).
	`ALTER TABLE engine_extensions ADD COLUMN webview INTEGER;`,

	// v79: films and live-action shows are kinds (doc/FILMS-SHOWS.md). Same
	// reason and same way as migration 47: only the CHECK widens, and nothing
	// stored changes.
	(conn) => widenKindsForFilms(conn),

	// v80: TMDB links, a film's and a show's (doc/LINKS.md, "TMDB
	// links"). Their own three tables, not columns on `series_links`: those
	// are AniList's by construction (`anilist_id`, `mal_id`, the season rows,
	// the trackers' joins), and `requeueSearched` and `NEEDS_LOOK` read
	// `link_searches` with no kind filter, so a film's row there would be
	// judged by a comic's rules. A show links once, the whole show: TMDB's
	// seasons are inside its one entry, and the source's seasons stay the
	// source's (doc/FILMS-SHOWS.md, "How it is shaped, and why").
	//
	// `series_tmdb_links` keeps what the screen draws without asking again
	// (the overview, the poster, a film's runtime and collection, a show's
	// season count). `tmdb_link_searches` is the pass's record and the
	// user's decision in one row: a NULL `searched_at` is a search waiting
	// for the pass, and `decision` is NONE OF THESE or an UNLINK, which no
	// pass undoes. The candidates wait for the review, best first.
	`
	CREATE TABLE series_tmdb_links (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		tmdb_id INTEGER NOT NULL,
		media TEXT NOT NULL CHECK (media IN ('movie', 'tv')),
		via TEXT NOT NULL CHECK (via IN ('exact', 'review', 'pasted')),
		title TEXT NOT NULL DEFAULT '',
		original_title TEXT NOT NULL DEFAULT '',
		year INTEGER,
		overview TEXT NOT NULL DEFAULT '',
		poster_url TEXT NOT NULL DEFAULT '',
		runtime INTEGER,
		seasons INTEGER,
		collection_id INTEGER,
		collection_name TEXT NOT NULL DEFAULT '',
		linked_at INTEGER NOT NULL
	);
	CREATE INDEX series_tmdb_links_tmdb ON series_tmdb_links(media, tmdb_id);
	CREATE TABLE tmdb_link_searches (
		series_id INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		query TEXT NOT NULL,
		year INTEGER,
		searched_at INTEGER,
		found INTEGER NOT NULL DEFAULT 0,
		decision TEXT CHECK (decision IN ('none', 'unlinked')),
		decided_at INTEGER
	);
	CREATE TABLE tmdb_link_candidates (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		tmdb_id INTEGER NOT NULL,
		rank INTEGER NOT NULL,
		data TEXT NOT NULL,
		PRIMARY KEY (series_id, tmdb_id)
	) WITHOUT ROWID;
	`,

	// v81: what surrounds a TMDB entry (doc/LINKS.md, "What
	// surrounds it"): a show's seasons and next episode, a film's collection,
	// cached per TMDB entry rather than per series, since every season of a
	// show links the same entry. Filled by TMDB's timer and after a LINK, never
	// while a screen waits; a screen draws what is here or nothing.
	// `tmdb_offers_declined` is the user's NOT THIS on an offer (SEASON 4 IS OUT,
	// a collection's GROUP →), which no later refresh asks again.
	`
	CREATE TABLE tmdb_surroundings (
		media TEXT NOT NULL CHECK (media IN ('tv', 'collection')),
		tmdb_id INTEGER NOT NULL,
		data TEXT NOT NULL,
		fetched_at INTEGER NOT NULL,
		PRIMARY KEY (media, tmdb_id)
	) WITHOUT ROWID;
	CREATE TABLE tmdb_offers_declined (
		series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		offer TEXT NOT NULL,
		at INTEGER NOT NULL,
		PRIMARY KEY (series_id, offer)
	) WITHOUT ROWID;
	`,

	// v82: a film's backdrop: the 16:9 still the film's stage shows
	// above its collection, kept on the link as the poster is. '' until a link
	// is made or remade after this migration; the stage draws no picture then.
	`ALTER TABLE series_tmdb_links ADD COLUMN backdrop_url TEXT NOT NULL DEFAULT '';`
];

/**
 * Migration 47's first half: `anime` among series.kind's allowed values. SQLite
 * can't change a CHECK in place, and the usual way round (a new table, the
 * rows copied, the old one dropped) would, with foreign keys on, cascade the
 * drop through every table that references a series: the whole library. A
 * CHECK that allows more changes nothing stored, which is the case SQLite's
 * documentation gives for editing the schema's text instead (lang_altertable,
 * "Making Other Kinds Of Table Schema Changes"): writable_schema, the schema
 * version moved on, and the result checked before the migration commits.
 * better-sqlite3 opens connections defensive, which forbids that, so unsafe
 * mode is on for these few statements only.
 */
const OLD_KINDS = `CHECK (kind IN ('manga', 'manhwa', 'doujin', 'novel'))`;
const NEW_KINDS = `CHECK (kind IN ('manga', 'manhwa', 'doujin', 'novel', 'anime'))`;
function widenKinds(conn: Database.Database): void {
	const sql = (
		conn
			.prepare(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'series'`)
			.get() as {
			sql: string;
		}
	).sql;
	if (!sql.includes(OLD_KINDS))
		throw new Error('migration 47: series.kind is not the CHECK it expects');
	const version = conn.pragma('schema_version', { simple: true }) as number;
	conn.unsafeMode(true);
	try {
		conn.pragma('writable_schema = ON');
		conn
			.prepare(`UPDATE sqlite_schema SET sql = ? WHERE type = 'table' AND name = 'series'`)
			.run(sql.replace(OLD_KINDS, NEW_KINDS));
		conn.pragma(`schema_version = ${version + 1}`);
		conn.pragma('writable_schema = OFF');
	} finally {
		conn.unsafeMode(false);
	}
	const ok = conn.pragma('integrity_check', { simple: true });
	if (ok !== 'ok')
		throw new Error(`migration 47: integrity check after widening series.kind: ${ok}`);
}

/** Migration 79's CHECK: the five kinds migration 47 left, and the two films and shows add. */
const KINDS_BEFORE_FILMS = `CHECK (kind IN ('manga', 'manhwa', 'doujin', 'novel', 'anime'))`;
const KINDS_WITH_FILMS = `CHECK (kind IN ('manga', 'manhwa', 'doujin', 'novel', 'anime', 'movie', 'show'))`;

/**
 * Migration 79: `movie` and `show` among series.kind's allowed values. Same reason
 * and same way as migration 47 — the schema's text is widened rather than the
 * table rebuilt — with its own constants, since a migration is never edited once
 * it has shipped.
 */
function widenKindsForFilms(conn: Database.Database): void {
	const sql = (
		conn
			.prepare(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'series'`)
			.get() as { sql: string }
	).sql;
	if (!sql.includes(KINDS_BEFORE_FILMS))
		throw new Error('migration 79: series.kind is not the CHECK it expects');
	const version = conn.pragma('schema_version', { simple: true }) as number;
	conn.unsafeMode(true);
	try {
		conn.pragma('writable_schema = ON');
		conn
			.prepare(`UPDATE sqlite_schema SET sql = ? WHERE type = 'table' AND name = 'series'`)
			.run(sql.replace(KINDS_BEFORE_FILMS, KINDS_WITH_FILMS));
		conn.pragma(`schema_version = ${version + 1}`);
		conn.pragma('writable_schema = OFF');
	} finally {
		conn.unsafeMode(false);
	}
	const ok = conn.pragma('integrity_check', { simple: true });
	if (ok !== 'ok')
		throw new Error(`migration 79: integrity check after widening series.kind: ${ok}`);
}

/**
 * Migration 59: `tv` among devices.kind's allowed values. Same reason and same way
 * as migration 47: the CHECK is the only thing that changes, so the schema's text is
 * widened rather than the table rebuilt and every device's settings copied for
 * nothing. A table rebuild is safe here (nothing references `devices`), but one
 * way of changing a CHECK in this repo is better than two.
 */
const OLD_DEVICE_KINDS = `CHECK (kind IN ('phone', 'tablet', 'desktop'))`;
const NEW_DEVICE_KINDS = `CHECK (kind IN ('phone', 'tablet', 'desktop', 'tv'))`;
function widenDeviceKinds(conn: Database.Database): void {
	const sql = (
		conn
			.prepare(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'devices'`)
			.get() as {
			sql: string;
		}
	).sql;
	if (!sql.includes(OLD_DEVICE_KINDS))
		throw new Error('migration 59: devices.kind is not the CHECK it expects');
	const version = conn.pragma('schema_version', { simple: true }) as number;
	conn.unsafeMode(true);
	try {
		conn.pragma('writable_schema = ON');
		conn
			.prepare(`UPDATE sqlite_schema SET sql = ? WHERE type = 'table' AND name = 'devices'`)
			.run(sql.replace(OLD_DEVICE_KINDS, NEW_DEVICE_KINDS));
		conn.pragma(`schema_version = ${version + 1}`);
		conn.pragma('writable_schema = OFF');
	} finally {
		conn.unsafeMode(false);
	}
	const ok = conn.pragma('integrity_check', { simple: true });
	if (ok !== 'ok')
		throw new Error(`migration 59: integrity check after widening devices.kind: ${ok}`);
}

function migrate(conn: Database.Database, path: string): void {
	const current = conn.pragma('user_version', { simple: true }) as number;
	// A database with data in it is copied before its schema moves
	// (doc/BACKUPS.md). A new one (migration 0) has nothing to lose.
	if (current > 0 && current < MIGRATIONS.length && path !== ':memory:') {
		try {
			const kept = snapshotBeforeMigration(conn, path, current);
			console.log(`tsundoku: before migrating past v${current}, saved ${kept}`);
		} catch (e) {
			// Refusing to start would take the library down over a full backup
			// disk; the nightly snapshot is still the net under this.
			console.warn(`tsundoku: no snapshot before migrating past v${current}: ${String(e)}`);
		}
	}
	climb(conn);
}

/**
 * Run the migrations from wherever `conn` stands, up to migration `upTo`. Exported so
 * a test can stop a database at an old migration, fill it as it was, and watch the
 * next migration move it (tests/migrations-db.spec.ts).
 */
export function climb(conn: Database.Database, upTo = MIGRATIONS.length): void {
	const current = conn.pragma('user_version', { simple: true }) as number;
	for (let i = current; i < Math.min(upTo, MIGRATIONS.length); i++) {
		conn
			.transaction(() => {
				const rung = MIGRATIONS[i];
				if (typeof rung === 'string') conn.exec(rung);
				else rung(conn);
				conn.pragma(`user_version = ${i + 1}`);
			})
			.immediate();
	}
}
