import type Database from 'better-sqlite3';
import { posix } from 'node:path';
import { fileIn, widenTo } from '../paths.ts';
import type { PlannedSeries } from '../../import/plan.ts';

/**
 * A Mihon download imports keyed by its folder (`mihon-dir:`) until a backup
 * knows the manga, then by its URL (doc/IMPORT-MIHON.md, "Before the backup
 * knows it"). Without this the folder's series lingered beside the URL's,
 * both reading the same files: nothing plans the folder key again once a
 * backup claims the folder, so nothing ever marked it gone.
 *
 * Run inside the writer's transaction, before it looks the series up:
 *
 * - no series under the URL key yet: the folder's series takes the key, and
 *   its chapters the backup's URLs, so the writer finds it and goes on;
 * - both exist: the folder's series is folded into the URL's, keeping
 *   whatever the owner did in either, and its row goes. No file is moved.
 */
export function adoptFormer(db: Database.Database, s: PlannedSeries): void {
	if (!s.formerKey) return;
	const former = seriesBy(db, s.formerKey);
	if (!former) return;
	const current = seriesBy(db, s.originKey);
	if (current) {
		foldSeries(db, former.id, current.id);
		return;
	}
	db.prepare(
		`UPDATE series SET origin_key = ?,
			source_url = CASE WHEN source_url = '' THEN ? ELSE source_url END,
			direction = COALESCE(direction, ?)
		WHERE id = ?`
	).run(s.originKey, s.sourceUrl, s.direction, former.id);
	// ComicInfo's full `Web` URL against the backup's path: the same chapter,
	// found by its file, takes the URL the writer will look it up by.
	const byFile = new Map(
		s.entries.filter((e) => e.file !== '').map((e) => [posix.join(s.path, e.file), e.sourceUrl])
	);
	const rows = db
		.prepare(`SELECT id, file, source_url FROM entries WHERE series_id = ?`)
		.all(former.id) as { id: number; file: string; source_url: string }[];
	const taken = new Set(rows.map((r) => r.source_url));
	const set = db.prepare(`UPDATE entries SET source_url = ? WHERE id = ?`);
	for (const r of rows) {
		if (r.file === '') continue;
		const url = byFile.get(posix.join(former.path, r.file));
		if (!url || url === r.source_url || taken.has(url)) continue;
		set.run(url, r.id);
		taken.add(url);
	}
}

function seriesBy(db: Database.Database, key: string) {
	return db.prepare(`SELECT id, path FROM series WHERE origin_key = ?`).get(key) as
		{ id: number; path: string } | undefined;
}

type Row = {
	id: number;
	file: string;
	source_url: string;
	label: string;
	available: number;
	bytes: number;
	page_count: number;
	read_at: number | null;
	unread_at: number | null;
	last_opened_at: number | null;
	last_position: number | null;
	last_offset: number | null;
	rating: number;
	favourite: number;
};

/** Caches of a file's pages: moved only with the file they describe. */
const FILE_TABLES = new Set(['entry_pages', 'page_crops', 'page_hashes', 'page_text', 'not_text']);

/** Every table with a column of this name, the series and entries themselves aside. */
function tablesWith(db: Database.Database, column: string): string[] {
	return (
		db
			.prepare(
				`SELECT m.name FROM sqlite_master m JOIN pragma_table_info(m.name) p
				WHERE m.type = 'table' AND p.name = ? AND m.name NOT IN ('series', 'entries')`
			)
			.all(column) as { name: string }[]
	).map((r) => r.name);
}

/**
 * Fold series `from` into series `into`, then delete `from`. A chapter both
 * have (the same file, else the same URL, else the same label) is one: read
 * state moves forward as on a rescan, the newer place in it wins, a rating
 * or FAV fills in where `into` has none, and `into` takes the file if it had
 * none. A chapter only `from` has moves across. Everything else that hangs
 * off either -- reading log, shelves, tags, links, lookups -- joins `into`,
 * which keeps its own where both have one. A hidden series stays hidden.
 */
export function foldSeries(db: Database.Database, from: number, into: number): void {
	const pathOf = (id: number) =>
		(db.prepare(`SELECT path FROM series WHERE id = ?`).get(id) as { path: string }).path;
	const entriesOf = (id: number) =>
		db.prepare(`SELECT * FROM entries WHERE series_id = ? ORDER BY position, id`).all(id) as Row[];
	const fromPath = pathOf(from);
	const abs = (path: string, r: Row) =>
		r.file === '' || path === '' ? '' : posix.join(path, r.file);

	const theirs = entriesOf(into);
	const intoPath = pathOf(into);
	const byFile = new Map(theirs.filter((t) => abs(intoPath, t)).map((t) => [abs(intoPath, t), t]));
	const byUrl = new Map(theirs.filter((t) => t.source_url).map((t) => [t.source_url, t]));
	const byLabel = new Map(theirs.map((t) => [t.label, t]));
	const matched = new Set<number>();
	const pick = (t: Row | undefined) => (t && !matched.has(t.id) ? t : undefined);

	const entryTables = tablesWith(db, 'entry_id');
	const repoint = (fromEntry: number, intoEntry: number, withFile: boolean) => {
		for (const t of entryTables)
			if (withFile || !FILE_TABLES.has(t))
				db.prepare(`UPDATE OR IGNORE ${t} SET entry_id = ? WHERE entry_id = ?`).run(
					intoEntry,
					fromEntry
				);
	};

	for (const f of entriesOf(from)) {
		const file = abs(fromPath, f);
		const t =
			(file ? pick(byFile.get(file)) : undefined) ??
			(f.source_url ? pick(byUrl.get(f.source_url)) : undefined) ??
			pick(byLabel.get(f.label));
		if (!t) {
			// Only `from` has it: across, its file named from `into`'s folder.
			let name = '';
			if (file) {
				const path = widenTo(db, into, [file]);
				name = path === '' ? '' : fileIn(path, file);
			}
			db.prepare(`UPDATE entries SET series_id = ?, file = ? WHERE id = ?`).run(
				into,
				name || f.file,
				f.id
			);
			continue;
		}
		matched.add(t.id);
		const sameFile = file !== '' && file === abs(intoPath, t);
		const takesFile = !t.available && !!f.available && file !== '';
		if (takesFile) {
			const path = widenTo(db, into, [file]);
			db.prepare(
				`UPDATE entries SET available = 1, file = ?, bytes = ?, page_count = ? WHERE id = ?`
			).run(fileIn(path, file), f.bytes, f.page_count, t.id);
		}
		// Read state moves forward, as on a rescan (write.ts); unread by the
		// owner since stays unread.
		if (
			f.read_at !== null &&
			t.read_at === null &&
			(t.unread_at === null || f.read_at > t.unread_at)
		)
			db.prepare(`UPDATE entries SET read_at = ? WHERE id = ?`).run(f.read_at, t.id);
		if (
			f.last_opened_at !== null &&
			(t.last_opened_at === null || f.last_opened_at > t.last_opened_at)
		)
			db.prepare(
				`UPDATE entries SET last_opened_at = ?, last_position = ?, last_offset = ? WHERE id = ?`
			).run(f.last_opened_at, f.last_position, f.last_offset, t.id);
		if (f.rating > 0 && t.rating === 0)
			db.prepare(`UPDATE entries SET rating = ? WHERE id = ?`).run(f.rating, t.id);
		if (f.favourite && !t.favourite)
			db.prepare(`UPDATE entries SET favourite = 1 WHERE id = ?`).run(t.id);
		repoint(f.id, t.id, sameFile || takesFile);
	}

	for (const t of tablesWith(db, 'series_id'))
		db.prepare(`UPDATE OR IGNORE ${t} SET series_id = ? WHERE series_id = ?`).run(into, from);
	db.prepare(
		`UPDATE series SET
			rating = CASE WHEN rating = 0 THEN (SELECT rating FROM series WHERE id = @from) ELSE rating END,
			favourite = MAX(favourite, (SELECT favourite FROM series WHERE id = @from)),
			hidden = MAX(hidden, (SELECT hidden FROM series WHERE id = @from))
		WHERE id = @into`
	).run({ from, into });
	db.prepare(`DELETE FROM series WHERE id = ?`).run(from);
}
