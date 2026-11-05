import type Database from 'better-sqlite3';
import { posix } from './fspath.ts';

/**
 * Where a series' files are (doc/SYNC.md, "Other devices"). Every entry names
 * its file relative to its series' path, and everything that reads a file
 * joins the two. A series whose files are in more than one folder -- a
 * manga downloaded on the tablet and the phone, books grouped from two
 * places -- takes the folder they share as its path, and each entry names
 * its file from there.
 */

const { join, relative } = posix;

/** The deepest folder every path is in. */
export function commonDir(paths: string[]): string {
	if (paths.length === 0) return '';
	const split = paths.map((p) => p.split('/'));
	const out: string[] = [];
	for (let i = 0; i < split[0].length; i++) {
		const part = split[0][i];
		if (split.some((p) => p[i] !== part)) break;
		out.push(part);
	}
	return out.join('/') || '/';
}

/** `path` is `dir` or inside it. */
export const isUnder = (path: string, dir: string) =>
	dir !== '' && (path === dir || path.startsWith(dir.endsWith('/') ? dir : `${dir}/`));

/**
 * Make the series' path a folder holding every one of `files` (absolute),
 * rewriting its entries' file names if it has to move up, and return it. A
 * path already holding them all is left as it is.
 */
export function widenTo(db: Database.Database, seriesId: number, files: string[]): string {
	const { path } = db.prepare(`SELECT path FROM series WHERE id = ?`).get(seriesId) as {
		path: string;
	};
	if (path === '' || files.every((f) => isUnder(f, path))) return path;
	const wider = commonDir([path, ...files]);
	const entries = db
		.prepare(`SELECT id, file FROM entries WHERE series_id = ? AND file != ''`)
		.all(seriesId) as { id: number; file: string }[];
	const set = db.prepare(`UPDATE entries SET file = ? WHERE id = ?`);
	for (const e of entries) set.run(relative(wider, join(path, e.file)), e.id);
	db.prepare(`UPDATE series SET path = ? WHERE id = ?`).run(wider, seriesId);
	return wider;
}

/** An absolute file as the series names it, once its path holds it. */
export const fileIn = (seriesPath: string, abs: string) => relative(seriesPath, abs);
