import type Database from 'better-sqlite3';
import { posix } from '../fspath.ts';
import { fileIn, isUnder, widenTo } from '../paths.ts';
import { isSeasonFolder, seasonFolders, seriesHolding } from '../season-facts.ts';
import { getDb } from '../db.ts';
import { hueFor } from '../../library/cover.ts';
import { linkFromTracker } from '../catalogue.ts';
import type { PlannedEntry, PlannedSeries } from '../../import/plan.ts';
import { adoptFolder, adoptFormer, adoptNamed, folderSourceId, type Dropped } from './fold.ts';
import { hideIfAddedHidden, sourceFlags } from '../engine/source-flags.ts';

/**
 * The one writer every importer uses (doc/IMPORT-MIHON.md, doc/IMPORT-HENTOID.md):
 * a planned series into the database, in one transaction, idempotently.
 *
 * - A series is found again by its origin key. Failing that, by its entries:
 *   a Hentoid book the owner grouped into a series of books lives on in
 *   that series, and its own singleton row is gone -- so the book is updated
 *   where it now is, and no second copy is made.
 * - An entry is found by its source URL (or its file, when it has none).
 * - What the source owns is refreshed: files, sizes, pages, availability.
 *   Read state only moves forward. What the owner edits -- title, rating,
 *   favourite, hidden, shelves, tags, kind, direction -- is set once, when
 *   the series is created, and never again.
 */

export function ensureRoot(
	db: Database.Database,
	name: string,
	path: string,
	hidden: boolean
): number {
	const row = db.prepare(`SELECT id FROM roots WHERE path = ?`).get(path) as
		{ id: number } | undefined;
	if (row) return row.id;
	return Number(
		db
			.prepare(`INSERT INTO roots (name, path, hidden) VALUES (?, ?, ?)`)
			.run(name, path, hidden ? 1 : 0).lastInsertRowid
	);
}

/**
 * The root of this name, whatever its path: another device's copy of a
 * source (doc/SYNC.md, "Other devices") shares the library folder's root, and
 * makes it only if there's none yet.
 */
export function ensureNamedRoot(
	db: Database.Database,
	name: string,
	path: string,
	hidden: boolean
): number {
	const row = db.prepare(`SELECT id FROM roots WHERE name = ? ORDER BY id LIMIT 1`).get(name) as
		{ id: number } | undefined;
	return row?.id ?? ensureRoot(db, name, path, hidden);
}

function ensureShelf(db: Database.Database, name: string): number {
	const row = db.prepare(`SELECT id FROM collections WHERE name = ?`).get(name) as
		{ id: number } | undefined;
	if (row) return row.id;
	const { p } = db
		.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM collections`)
		.get() as { p: number };
	return Number(
		db.prepare(`INSERT INTO collections (name, position) VALUES (?, ?)`).run(name, p)
			.lastInsertRowid
	);
}

function ensureTag(db: Database.Database, namespace: string, value: string): number {
	return (
		db
			.prepare(
				`INSERT INTO tags (namespace, value) VALUES (?, ?)
				ON CONFLICT (namespace, value) DO UPDATE SET value = value RETURNING id`
			)
			.get(namespace, value) as { id: number }
	).id;
}

function setPages(db: Database.Database, entryId: number, e: PlannedEntry): void {
	if (!e.pages) return;
	db.prepare(`DELETE FROM entry_pages WHERE entry_id = ?`).run(entryId);
	const add = db.prepare(`INSERT INTO entry_pages (entry_id, position, file) VALUES (?, ?, ?)`);
	e.pages.forEach((file, i) => add.run(entryId, i, file));
}

export type WriteResult = {
	created: boolean;
	entriesAdded: number;
	filesAttached: number;
	/** Created visible and hidden by its source's ADDED HIDDEN (`opts.addedHidden`). */
	addedHidden?: boolean;
	/** Works a fold of this write took a series out of (c472; `Dropped`, fold.ts). */
	dropped?: Dropped[];
};

export function writeSeries(
	s: PlannedSeries,
	opts: {
		rootId: number;
		jobId: number | null;
		now: number;
		/** Entries of this series whose file is no longer planned become not downloaded. */
		markMissing?: boolean;
		/**
		 * The device folder this plan was read from (doc/SYNC.md, "Other devices").
		 * A series whose files are outside it has them on another device too.
		 */
		deviceRoot?: string;
		/**
		 * Write a series that doesn't exist yet as a browsing record (doc/BROWSING.md):
		 * opened from a source without ADD, on no shelf. One that exists keeps
		 * whatever it is, so opening never takes a series out of the library.
		 */
		browsing?: boolean;
		/**
		 * Apply the source's ADDED HIDDEN to a series this write creates in the
		 * library (card c503, the owner's (a); doc/BROWSE.md, "A source's own
		 * switches"), in this same transaction: an importer can only add hiding.
		 * A series the plan already hides stays hidden, one it shows from a
		 * source with the switch on arrives hidden, and one that already existed
		 * is only updated, never newly hidden. The importers pass it
		 * (import/index.ts); BROWSE's add doors call `hideIfAddedHidden`
		 * themselves, after their own reads.
		 */
		addedHidden?: boolean;
	},
	db: Database.Database = getDb()
): WriteResult {
	// Deleted by the owner (doc/DELETING.md): passed by, and so are its deleted
	// chapters or books, however many backups and devices still carry them.
	const buried = db.prepare(`SELECT 1 FROM tombstones WHERE key = ?`);
	const gone = (key: string) => key !== '' && !!buried.get(key);
	if (gone(s.originKey)) return { created: false, entriesAdded: 0, filesAttached: 0 };
	if (s.entries.some((e) => gone(e.sourceUrl))) {
		s = { ...s, entries: s.entries.filter((e) => !gone(e.sourceUrl)) };
		// Every book of it deleted: nothing left to make a series of.
		if (s.entries.length === 0) return { created: false, entriesAdded: 0, filesAttached: 0 };
	}
	return db
		.transaction((): WriteResult => {
			const dropped: Dropped[] = [];
			adoptFormer(db, s, opts.now, dropped);
			// Its own key, or a season's (c282): an anime's season folder and
			// FOLLOW's plan both name a source entry the series holds a season of.
			let seriesId: number | null = seriesHolding(s.originKey, db)?.id ?? null;
			// Moved to another source (doc/MOVE.md): the backup still names the
			// source it was downloaded from, and every key the series has left is
			// in series_former_keys (rung 58), however many moves ago. The series
			// is this one, not a twin; its key stays where it moved to. If two
			// series somehow list one key, the most recent move away wins: a key
			// has one series that left it last.
			let leftKey = false;
			if (seriesId === null) {
				const former = db
					.prepare(
						`SELECT series_id AS id FROM series_former_keys WHERE origin_key = ?
						ORDER BY left_at DESC LIMIT 1`
					)
					.get(s.originKey) as { id: number } | undefined;
				if (former) {
					seriesId = former.id;
					leftKey = true;
				}
			}
			// A Mihon folder's series and the series a backup names are one, even
			// when the backup is another device's (doc/IMPORT-MIHON.md, "Before the
			// backup knows it"): whichever of the two this plan is, the other is
			// found and the two are settled before anything is written.
			const folderPlan = s.originKey.startsWith('mihon-dir:');
			if (folderPlan) {
				if (!leftKey) seriesId = adoptNamed(db, s, opts.rootId, opts.now, dropped) ?? seriesId;
			} else if (seriesId === null) {
				seriesId = adoptFolder(db, s, opts.rootId, opts.now);
			}
			let created = false;
			// Grouped since the last scan: the entries are in another series, in
			// this source or another -- a Hentoid book grouped with another
			// root's is in a series of that root (doc/BOOKS.md).
			if (seriesId === null) {
				const moved = s.entries
					.filter((e) => e.sourceUrl !== '')
					.map(
						(e) =>
							db
								.prepare(
									`SELECT e.series_id AS id FROM entries e JOIN series s ON s.id = e.series_id
									WHERE e.source_url = ? LIMIT 1`
								)
								.get(e.sourceUrl) as { id: number } | undefined
					)
					.find((r) => r !== undefined);
				if (moved) seriesId = moved.id;
			}

			// A book grouped as a volume of a novel (doc/BOOKS.md): the series is
			// the owner's, holding other books too. This book's entries are found
			// by its own prefix; its files are named from the series' folder; and
			// its chapters keep the volume's place among the others.
			const own = s.source === 'epub' ? `${s.originKey}!` : '';
			let volume: { path: string; name: string } | null = null;
			if (seriesId !== null && own) {
				const row = db
					.prepare(
						`SELECT path,
							(SELECT COUNT(*) FROM entries WHERE series_id = s.id AND substr(source_url, 1, ?) != ?) AS others,
							(SELECT volume FROM entries WHERE series_id = s.id AND substr(source_url, 1, ?) = ? AND volume != '' LIMIT 1) AS name
						FROM series s WHERE id = ?`
					)
					.get(own.length, own, own.length, own, seriesId) as {
					path: string;
					others: number;
					name: string | null;
				};
				if (row.others > 0) volume = { path: row.path, name: row.name ?? s.title };
			}
			// A series another device has files in too (doc/SYNC.md, "Other devices"):
			// its path is left where it is, widened only when this device brings a
			// file the series has no copy of, and this device's files are named from
			// there. A series with files on two devices is one, its chapters from
			// whichever device has them.
			let shared: string | null = null;
			if (seriesId !== null && volume === null && opts.deviceRoot && s.path !== '') {
				const { path } = db.prepare(`SELECT path FROM series WHERE id = ?`).get(seriesId) as {
					path: string;
				};
				if (path !== '' && path !== s.path && !isUnder(path, opts.deviceRoot)) {
					const have = db.prepare(
						`SELECT 1 FROM entries WHERE series_id = ? AND source_url = ? AND available = 1`
					);
					const brings = s.entries
						.filter((e) => e.available && (e.sourceUrl === '' || !have.get(seriesId, e.sourceUrl)))
						.map((e) => posix.join(s.path, e.file));
					shared = brings.length ? widenTo(db, seriesId, brings) : path;
				}
			}
			// An anime season's own folder (c282, doc/ANIME.md, "Downloading"): this
			// folder's episodes are named from the folder the series is named from.
			// A series that has none yet takes the first folder to arrive, even a
			// season's, so its own folder arriving later takes over and what was
			// named from the season's is named again from there: the result is the
			// same whichever folder came first. A series with no season rows never
			// takes this path.
			let seasonFolderFrom: string | null = null;
			if (seriesId !== null && volume === null && shared === null && s.path !== '') {
				const { path } = db.prepare(`SELECT path FROM series WHERE id = ?`).get(seriesId) as {
					path: string;
				};
				if (path !== '' && path !== s.path) {
					if (isSeasonFolder(seriesId, s.path, db)) seasonFolderFrom = path;
					else if (isSeasonFolder(seriesId, path, db)) nameFilesFrom(db, seriesId, path, s.path);
				}
			}
			// A chapter not downloaded has no file, whichever folder the series is named from.
			const fileOf = (e: PlannedEntry) =>
				e.file === ''
					? ''
					: volume
						? posix.relative(volume.path, posix.join(s.path, e.file))
						: seasonFolderFrom !== null
							? posix.relative(seasonFolderFrom, posix.join(s.path, e.file))
							: shared !== null
								? fileIn(shared, posix.join(s.path, e.file))
								: e.file;

			if (seriesId !== null && volume === null) {
				const path = shared === null && seasonFolderFrom === null ? s.path : '';
				db.prepare(
					`UPDATE series SET
						path = CASE WHEN ? != '' THEN ? ELSE path END,
						status = CASE WHEN status = '' THEN ? ELSE status END,
						description = CASE WHEN description = '' THEN ? ELSE description END,
						cover_url = CASE WHEN ? != '' THEN ? ELSE cover_url END
					WHERE id = ?`
				).run(path, path, s.status, s.description, s.coverUrl ?? '', s.coverUrl ?? '', seriesId);
			} else if (seriesId === null) {
				created = true;
				seriesId = Number(
					db
						.prepare(
							`INSERT INTO series (root_id, title, kind, rating, favourite, hidden, hue, added_at,
								indexed_at, scan_job_id, alt_titles, source, status, description, direction, path,
								source_url, origin_key, cover_url, arrived_at, in_library, browsed_at)
							VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
						)
						.run(
							opts.rootId,
							s.title,
							s.kind,
							s.rating,
							s.favourite ? 1 : 0,
							s.hidden ? 1 : 0,
							hueFor(s.title),
							s.addedAt,
							opts.now,
							opts.jobId,
							s.source,
							s.status,
							s.description,
							s.direction,
							s.path,
							s.sourceUrl,
							s.originKey,
							s.coverUrl ?? '',
							opts.now,
							opts.browsing ? 0 : 1,
							opts.browsing ? opts.now : null
						).lastInsertRowid
				);
				for (const t of s.tags)
					db.prepare(`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
						seriesId,
						ensureTag(db, t.namespace, t.value)
					);
				for (const shelf of s.shelves)
					db.prepare(
						`INSERT OR IGNORE INTO collection_series (collection_id, series_id) VALUES (?, ?)`
					).run(ensureShelf(db, shelf), seriesId);
			}

			const seriesPath = (
				db.prepare(`SELECT path FROM series WHERE id = ?`).get(seriesId) as { path: string }
			).path;
			const find = db.prepare(
				`SELECT id, read_at, unread_at, last_opened_at, available, file FROM entries
				WHERE series_id = @series AND ((@url != '' AND (source_url = @url OR former_url = @url
						OR EXISTS (SELECT 1 FROM entry_former_urls f
							WHERE f.entry_id = entries.id AND f.former_url = @url)))
					OR (@url = '' AND file = @file))`
			);
			// A folder's plan names a chapter by the ComicInfo URL it carries, while
			// the series may know it by the backup's path once the two are one
			// (adoptNamed): the same file, or else the same number, is that chapter.
			const findFile = db.prepare(
				`SELECT id, read_at, unread_at, last_opened_at, available, file FROM entries
				WHERE series_id = @series AND file = @file`
			);
			const findLabel = db.prepare(
				`SELECT id, read_at, unread_at, last_opened_at, available, file FROM entries
				WHERE series_id = @series AND label = @label
				ORDER BY available, position, id`
			);
			// Two chapters of one number are two files (two scanlators, or a file the
			// backup doesn't know): an entry an earlier planned chapter took is not
			// free to take again, or the later one overwrites its file and the first
			// is left on disk with nothing pointing at it.
			const taken = new Set<number>();
			const insert = db.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, read_at, last_position,
					last_opened_at, page_count, file, bytes, source_url, available, cover_file, cover_phash,
					scanlator, locator, matter, volume, arrived_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			);
			const log = db.prepare(
				`INSERT INTO reading_events (at, series_id, entry_id, kind, page, duration_ms)
				SELECT @at, @series, @entry, @kind, @page, @duration
				WHERE NOT EXISTS (SELECT 1 FROM reading_events WHERE entry_id = @entry AND at = @at AND kind = @kind)`
			);
			let entriesAdded = 0;
			let filesAttached = 0;
			const planned = new Set<string>();
			for (const e of s.entries) {
				const file = fileOf(e);
				if (e.available) planned.add(file);
				type Had = {
					id: number;
					read_at: number | null;
					unread_at: number | null;
					last_opened_at: number | null;
					available: number;
					file: string;
				};
				const free = (rows: unknown[]) => (rows as Had[]).find((r) => !taken.has(r.id));
				let had = free(find.all({ series: seriesId, url: e.sourceUrl, file }));
				if (!had && folderPlan) {
					if (file !== '') had = free(findFile.all({ series: seriesId, file }));
					if (!had) had = free(findLabel.all({ series: seriesId, label: e.label }));
				}
				if (had) taken.add(had.id);
				// Another device's copy, already here: kept, rather than swapped for this one.
				const elsewhere =
					!!had?.available &&
					(shared !== null || volume !== null) &&
					!isUnder(posix.join(seriesPath, had.file), s.path);
				let entryId: number;
				if (!had) {
					entryId = Number(
						insert.run(
							seriesId,
							// Placed among the other volumes below.
							volume ? VOLUME_PENDING + e.position : e.position,
							e.label,
							e.title,
							e.addedAt,
							e.readAt,
							e.lastPosition,
							e.lastOpenedAt,
							e.pageCount,
							file,
							e.bytes,
							e.sourceUrl,
							e.available ? 1 : 0,
							e.coverFile ?? null,
							e.coverPhash ?? null,
							e.scanlator ?? '',
							e.locator ?? '',
							e.matter ?? '',
							volume?.name ?? '',
							// Arrived now, whatever date the source gives it (rung 34).
							e.available ? opts.now : null
						).lastInsertRowid
					);
					if (e.episode) setEpisode(db, entryId, e.episode, true);
					setPages(db, entryId, e);
					for (const t of e.tags ?? [])
						db.prepare(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)`).run(
							entryId,
							ensureTag(db, t.namespace, t.value)
						);
					entriesAdded += 1;
					if (e.available) filesAttached += 1;
				} else {
					entryId = had.id;
					// What the source says of an episode can change (a title, a length); its watch state can't.
					if (e.episode) setEpisode(db, entryId, e.episode, false);
					// Rung 10 came after the first imports: a rescan fills it in.
					if (e.scanlator)
						db.prepare(`UPDATE entries SET scanlator = ? WHERE id = ?`).run(e.scanlator, entryId);
					// A book's structure is the file's: a new edition moves its places.
					if (e.locator !== undefined)
						db.prepare(
							`UPDATE entries SET locator = ?, matter = ?, position = COALESCE(?, position), label = ?, bytes = ? WHERE id = ?`
						).run(e.locator, e.matter ?? '', volume ? null : e.position, e.label, e.bytes, entryId);
					if (e.available && !elsewhere) {
						if (!had.available) {
							filesAttached += 1;
							db.prepare(`UPDATE entries SET arrived_at = ? WHERE id = ?`).run(opts.now, entryId);
						}
						// Another file: its pages' borders are measured again (doc/READER.md, "Crop borders").
						if (had.file !== file)
							db.prepare(`DELETE FROM page_crops WHERE entry_id = ?`).run(entryId);
						db.prepare(
							`UPDATE entries SET available = 1, file = ?, bytes = ?, page_count = ?,
								cover_file = COALESCE(?, cover_file), cover_phash = COALESCE(?, cover_phash)
							WHERE id = ?`
						).run(file, e.bytes, e.pageCount, e.coverFile ?? null, e.coverPhash ?? null, entryId);
						setPages(db, entryId, e);
					}
					// Read state only moves forward: never un-read what tsundoku read. And
					// what the owner marked unread stays unread, unless the source read
					// it again since (rung 28): Mihon keeps its old "read" forever.
					if (
						e.readAt !== null &&
						had.read_at === null &&
						(had.unread_at === null || e.readAt > had.unread_at)
					)
						db.prepare(`UPDATE entries SET read_at = ? WHERE id = ?`).run(e.readAt, entryId);
					if (
						e.lastOpenedAt !== null &&
						(had.last_opened_at === null || e.lastOpenedAt > had.last_opened_at)
					)
						db.prepare(
							`UPDATE entries SET last_opened_at = ?, last_position = COALESCE(?, last_position) WHERE id = ?`
						).run(e.lastOpenedAt, e.lastPosition, entryId);
				}
				if (e.history)
					log.run({
						at: e.history.at,
						series: seriesId,
						entry: entryId,
						kind: e.history.finished ? 'finish' : 'page',
						page: e.history.page,
						duration: Math.max(0, e.history.durationMs)
					});
			}
			if (volume) placeVolume(db, seriesId, own, s.entries);
			// A chapter not yet read arrived: the series is on the NEW shelf again
			// (doc/LIBRARY.md). One already read, downloaded again on another
			// device, isn't new to anyone.
			if (filesAttached > 0)
				db.prepare(
					`UPDATE series SET arrived_at = @now WHERE id = @series AND EXISTS (
						SELECT 1 FROM entries WHERE series_id = @series AND arrived_at = @now AND read_at IS NULL)`
				).run({ now: opts.now, series: seriesId });
			// Mihon's MAL tracker: a sure catalogue link (doc/LINKS.md).
			if (s.malLink) linkFromTracker(db, seriesId, s.malLink, opts.now);
			if (opts.markMissing && s.path !== '') {
				// A season's folder answers for its own files, and the series' folder
				// for its own, each from wherever the other's entries point.
				const hasSeasonFolder = seasonFolders(seriesId, db).length > 0;
				// A volume answers only for its own entries: the others are other files.
				const onDisk = (
					db
						.prepare(
							`SELECT id, file, source_url FROM entries WHERE series_id = ? AND available = 1 AND file != ''`
						)
						.all(seriesId) as { id: number; file: string; source_url: string }[]
				)
					.filter((r) => !volume || r.source_url.startsWith(own))
					// With another device's files in the series, this one answers for its own only.
					.filter(
						(r) =>
							(shared === null && !hasSeasonFolder) ||
							isUnder(posix.join(seriesPath, r.file), s.path)
					);
				for (const r of onDisk)
					if (!planned.has(r.file))
						db.prepare(`UPDATE entries SET available = 0 WHERE id = ?`).run(r.id);
			}
			// A download folder's own series names no source by its key, so its
			// source is read from the folder (c571): created before any backup
			// named it, it arrives hidden as the backup's series would have.
			const addedHidden =
				created &&
				opts.addedHidden === true &&
				(folderPlan
					? hideFolderIfAddedHidden(db, seriesId, s.originKey)
					: hideIfAddedHidden(seriesId, db));
			return {
				created,
				entriesAdded,
				filesAttached,
				...(addedHidden ? { addedHidden } : {}),
				...(dropped.length ? { dropped } : {})
			};
		})
		.immediate();
}

/**
 * The series is about to be named from another folder: every file it knows
 * keeps pointing at the same place on disk. Only the name changes, so nothing
 * here is an arrival.
 */
function nameFilesFrom(db: Database.Database, seriesId: number, from: string, to: string): void {
	const rows = db
		.prepare(`SELECT id, file FROM entries WHERE series_id = ? AND file != ''`)
		.all(seriesId) as { id: number; file: string }[];
	const rename = db.prepare(`UPDATE entries SET file = ? WHERE id = ?`);
	for (const r of rows) rename.run(posix.relative(to, posix.join(from, r.file)), r.id);
}

/**
 * An episode's own columns (rung 47). A length or picture already known isn't
 * blanked by a source that stopped saying it.
 */
function setEpisode(
	db: Database.Database,
	entryId: number,
	e: NonNullable<PlannedEntry['episode']>,
	fresh: boolean
): void {
	db.prepare(
		`UPDATE entries SET season = ?, episode_number = ?, episode_note = ?,
			duration_s = CASE WHEN ? THEN ? ELSE COALESCE(?, duration_s) END,
			thumb_url = CASE WHEN ? != '' THEN ? ELSE thumb_url END
		WHERE id = ?`
	).run(
		e.season,
		e.number,
		e.note,
		fresh ? 1 : 0,
		e.durationS,
		e.durationS,
		e.thumbUrl,
		e.thumbUrl,
		entryId
	);
}

/**
 * ADDED HIDDEN for a Mihon download folder's new series (card c571): the
 * same write as `hideIfAddedHidden` (engine/source-flags.ts), which reads the
 * source from the series' key and so finds none in a `mihon-dir:` key, with
 * the source read from the folder instead (`folderSourceId`). A folder whose
 * name answers to no one installed source is left as it is. Answers whether
 * it hid the series.
 */
function hideFolderIfAddedHidden(db: Database.Database, seriesId: number, key: string): boolean {
	const source = folderSourceId(db, key);
	if (source === null || !sourceFlags(source, db).addedHidden) return false;
	return (
		db
			.prepare(`UPDATE series SET hidden = 1 WHERE id = ? AND in_library = 1 AND hidden = 0`)
			.run(seriesId).changes > 0
	);
}

/** Above any real position: a volume's new entries, until placeVolume puts them in their run. */
const VOLUME_PENDING = 1e9;

/**
 * Put one volume's entries back into its run in a series of volumes, in the
 * book's order: where its first entry already was, or at the end if it had
 * none there. The other volumes keep their order, and positions run 1..n.
 */
function placeVolume(
	db: Database.Database,
	seriesId: number,
	own: string,
	planned: PlannedEntry[]
): void {
	const rows = db
		.prepare(
			`SELECT id, source_url, position FROM entries WHERE series_id = ? ORDER BY position, id`
		)
		.all(seriesId) as { id: number; source_url: string; position: number }[];
	const mine = (r: { source_url: string }) => r.source_url.startsWith(own);
	const order = new Map(planned.map((e, i) => [e.sourceUrl, i]));
	const rank = (r: { source_url: string }) => order.get(r.source_url) ?? planned.length;
	const volume = rows.filter(mine).sort((a, b) => rank(a) - rank(b));
	const others = rows.filter((r) => !mine(r));
	const first = rows.findIndex((r) => mine(r) && r.position < VOLUME_PENDING);
	const at = first < 0 ? others.length : rows.slice(0, first).filter((r) => !mine(r)).length;
	const all = [...others.slice(0, at), ...volume, ...others.slice(at)];
	const set = db.prepare(`UPDATE entries SET position = ? WHERE id = ?`);
	all.forEach((r, i) => set.run(i + 1, r.id));
}

/**
 * Close a job: a run that brought no new series has nothing to tidy, so it
 * leaves no band. `dropped` is every Work its folds took a series out of
 * (c570, rung 71), which the IMPORT LOG names.
 */
export function finishJob(
	db: Database.Database,
	jobId: number,
	seriesCreated: number,
	dropped: Dropped[] = []
): void {
	const done = Date.now();
	db.prepare(
		`UPDATE scan_jobs SET finished_at = ?, dismissed_at = CASE WHEN ? = 0 THEN ? END, dropped = ?
		WHERE id = ?`
	).run(done, seriesCreated, done, JSON.stringify(dropped), jobId);
}

/**
 * Close every job a process left unfinished by dying (a crash, or a restart
 * for an update) mid-import. Left open, the library believes an import is
 * still running: the IMPORTING band never ends and the grid stays on NEWEST
 * with no SORT (2026-11-01, scan 750). Like finishJob, a job that brought no
 * new series leaves no band. Returns how many it closed.
 */
export function closeDeadJobs(db: Database.Database, now = Date.now()): number {
	return db
		.prepare(
			`UPDATE scan_jobs SET finished_at = ?, dismissed_at = CASE WHEN series_found = 0 THEN ? END
			WHERE finished_at IS NULL`
		)
		.run(now, now).changes;
}
