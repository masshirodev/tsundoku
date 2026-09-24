import type Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { cp, mkdir, rename, rm, unlink } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { getDb } from './db.ts';
import { seriesDetail } from './library.ts';
import { libraryRoot } from './import/index.ts';
import { coverDir } from './covers.ts';
import { isUnder } from './paths.ts';
import { SAMPLE_PREFIX } from './pages/sample.ts';

/**
 * Deleting books and series (doc/DELETING.md). A delete does three things:
 *
 * 1. the rows go: the series or book, its chapters, its reading log;
 * 2. its files move to the trash folder on the library disk, under the path
 *    they had in the library folder, never erased: a slip is undone by moving
 *    them back;
 * 3. a tombstone keeps it gone: the importers find things by their origin key
 *    and source URLs, and both stay in Mihon's backup and on the other
 *    devices, so without one the next scan or sync would bring it back.
 *
 * Only files inside the library folder are ever moved.
 */

export function trashDir(): string {
	return process.env.TRASH_DIR ?? '/mnt/hdd2/tsundoku/trash';
}

export class DeleteError extends Error {}

type EntryFile = { id: number; file: string; source_url: string };

function entriesOf(db: Database.Database, seriesId: number, only?: number): EntryFile[] {
	return db
		.prepare(
			`SELECT id, file, source_url FROM entries WHERE series_id = ? AND (? IS NULL OR id = ?)`
		)
		.all(seriesId, only ?? null, only ?? null) as EntryFile[];
}

/** The files to move: each once (a book's chapters can share one EPUB), inside the library only. */
function filesOf(path: string, entries: EntryFile[]): string[] {
	if (path === '' || path.startsWith(SAMPLE_PREFIX)) return [];
	const library = libraryRoot();
	const out = new Set<string>();
	for (const e of entries) {
		if (e.file === '') continue;
		const abs = join(path, e.file);
		if (isUnder(abs, library) && abs !== library) out.add(abs);
	}
	return [...out];
}

async function moveToTrash(files: string[], stamp: string): Promise<number> {
	const library = libraryRoot();
	let moved = 0;
	for (const abs of files) {
		if (!existsSync(abs)) continue;
		const dest = join(trashDir(), stamp, relative(library, abs));
		await mkdir(dirname(dest), { recursive: true });
		try {
			await rename(abs, dest);
		} catch (e) {
			// Another disk: copied, then removed.
			if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
			await cp(abs, dest, { recursive: true });
			await rm(abs, { recursive: true, force: true });
		}
		moved += 1;
	}
	return moved;
}

function bury(db: Database.Database, keys: string[], title: string, now: number) {
	const put = db.prepare(
		`INSERT OR REPLACE INTO tombstones (key, title, deleted_at) VALUES (?, ?, ?)`
	);
	for (const k of keys) if (k) put.run(k, title, now);
}

const stampOf = (now: number) => new Date(now).toISOString().replace(/[:.]/g, '-');

export type DeleteResult = { series: number; entries: number; files: number };

/**
 * Delete whole series. Each must be one the viewer can see: a hidden series
 * is only deleted with reveal on, as it's only seen then.
 */
export async function deleteSeries(
	ids: number[],
	reveal: boolean,
	now = Date.now()
): Promise<DeleteResult> {
	const db = getDb();
	const result: DeleteResult = { series: 0, entries: 0, files: 0 };
	const stamp = stampOf(now);
	for (const id of ids) {
		const card = seriesDetail(id, reveal);
		if (!card) continue;
		const row = db.prepare(`SELECT path, origin_key, title FROM series WHERE id = ?`).get(id) as {
			path: string;
			origin_key: string | null;
			title: string;
		};
		const entries = entriesOf(db, id);
		result.files += await moveToTrash(filesOf(row.path, entries), stamp);
		db.transaction(() => {
			bury(db, [row.origin_key ?? '', ...entries.map((e) => e.source_url)], row.title, now);
			db.prepare(`DELETE FROM series WHERE id = ?`).run(id);
		}).immediate();
		await unlink(join(coverDir(), `${id}.webp`)).catch(() => undefined);
		result.series += 1;
		result.entries += entries.length;
	}
	return result;
}

/**
 * Delete one book of a series of books. The series keeps the rest; one left
 * with none is deleted too.
 */
export async function deleteBook(
	seriesId: number,
	entryId: number,
	reveal: boolean,
	now = Date.now()
): Promise<DeleteResult & { seriesGone: boolean }> {
	const db = getDb();
	if (!seriesDetail(seriesId, reveal)) throw new DeleteError('no such series');
	const row = db.prepare(`SELECT path, title FROM series WHERE id = ?`).get(seriesId) as {
		path: string;
		title: string;
	};
	const entries = entriesOf(db, seriesId, entryId);
	if (entries.length === 0) throw new DeleteError('that book is not in this series');
	const files = await moveToTrash(filesOf(row.path, entries), stampOf(now));
	const seriesGone = db
		.transaction((): boolean => {
			const title = (
				db.prepare(`SELECT title FROM entries WHERE id = ?`).get(entryId) as { title: string }
			).title;
			bury(db, [entries[0].source_url], title || row.title, now);
			db.prepare(`DELETE FROM entries WHERE id = ?`).run(entryId);
			const left = db
				.prepare(`SELECT id FROM entries WHERE series_id = ? ORDER BY position, id`)
				.all(seriesId) as { id: number }[];
			if (left.length === 0) {
				db.prepare(`DELETE FROM series WHERE id = ?`).run(seriesId);
				return true;
			}
			const set = db.prepare(`UPDATE entries SET position = ? WHERE id = ?`);
			left.forEach((e, i) => set.run(i + 1, e.id));
			return false;
		})
		.immediate();
	return { series: seriesGone ? 1 : 0, entries: 1, files, seriesGone };
}
