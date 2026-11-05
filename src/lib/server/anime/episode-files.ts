import { readdirSync, rmSync, statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { join } from '../fspath.ts';
import { dataPaths } from '../data-dirs.ts';
import { KINDS, kindFacts } from '../../library/kinds.ts';

/**
 * The nightly sweep of covers/episodes/ (doc/ANIME.md, "Episode pictures";
 * card c454). An episode's picture (`<id>.webp`) and its seek-preview sprite
 * (`<id>.sprite.jpg` and `<id>.sprite.json`) are named after its entry id,
 * and no door that removes a series or an entry deletes them, so they stayed
 * on disk for good. The backup timer runs this after its snapshot.
 *
 * A file goes when its id is no longer an episode: no entry has it, or the
 * entry that has it now belongs to a series that is not video. SQLite gives
 * a deleted entry's id to the next entry, so a new episode can find an old
 * episode's files under its own id. Those stay. A sprite is checked against
 * its sidecar on every read (`currentSprite`), which deletes one cut from
 * another file. A picture is shown only once the new entry's own `thumb_at`
 * is set, and making that picture writes over the old one.
 */

/** A file younger than this is left alone: its entry may have been written after the query. */
export const SWEEP_MIN_AGE_MS = 60 * 60 * 1000;

/** `12.webp`, `12.sprite.jpg`, `12.sprite.json`, `12.webp.partial`: the entry id at the front. */
const ID = /^(\d+)\./;

/**
 * Deletes covers/episodes files whose entry id is no longer an episode.
 * Returns the names it deleted. `db` can be a read-only connection, since
 * nothing in the database changes.
 */
export function sweepEpisodeFiles(
	db: Database.Database,
	opts: { dir?: string; now?: number } = {}
): string[] {
	const dir = opts.dir ?? join(dataPaths().covers, 'episodes');
	const now = opts.now ?? Date.now();
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		// No folder: no episode ever got a picture or a sprite.
		return [];
	}
	// The kinds whose entries are episodes, asked of the registry (doc/KINDS.md).
	const video = KINDS.filter((k) => kindFacts(k).medium === 'video');
	const isEpisode = db.prepare(
		`SELECT 1 FROM entries e JOIN series s ON s.id = e.series_id
		WHERE e.id = ? AND s.kind IN (${video.map(() => '?').join(', ')})`
	);
	const answers = new Map<number, boolean>();
	const gone: string[] = [];
	for (const name of names) {
		const m = ID.exec(name);
		if (!m) continue;
		const id = Number(m[1]);
		let keep = answers.get(id);
		if (keep === undefined) {
			keep = !!isEpisode.get(id, ...video);
			answers.set(id, keep);
		}
		if (keep) continue;
		const path = join(dir, name);
		try {
			const s = statSync(path);
			if (!s.isFile() || now - s.mtimeMs < SWEEP_MIN_AGE_MS) continue;
			rmSync(path, { force: true });
			gone.push(name);
		} catch {
			// Gone already, or unreadable: the next night tries again.
		}
	}
	return gone.sort();
}
