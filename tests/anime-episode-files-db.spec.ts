import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Before anything imports db.ts or data-dirs.ts: both read these once.
process.env.DATABASE_PATH = ':memory:';
const work = mkdtempSync(join(tmpdir(), 'tsundoku-episode-files-'));
process.env.COVER_DIR = join(work, 'covers');
const dir = join(work, 'covers', 'episodes');
afterAll(() => rmSync(work, { recursive: true, force: true }));

// The nightly sweep of covers/episodes/ (doc/ANIME.md, "Episode pictures";
// card c454): an episode's picture and sprite go once its id is no longer an
// episode's, and stay under an id SQLite handed to a new episode.
const { getDb } = await import('$lib/server/db');
const { SWEEP_MIN_AGE_MS, sweepEpisodeFiles } = await import('$lib/server/anime/episode-files');

const db = getDb();
const root = Number(
	db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Anime', '/nowhere', 0)`).run()
		.lastInsertRowid
);
let n = 0;
const series = (kind: 'anime' | 'manga') =>
	Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, hidden)
				VALUES (?, ?, ?, 0, ?, 0)`
			)
			.run(root, `Series ${++n}`, kind, `test:${n}`).lastInsertRowid
	);
const entry = (seriesId: number, position: number) =>
	Number(
		db
			.prepare(`INSERT INTO entries (series_id, position, label, added_at) VALUES (?, ?, 'Ep.', 0)`)
			.run(seriesId, position).lastInsertRowid
	);
const NOW = 1_800_000_000_000;
/** An episode's three files, written a day before NOW unless told otherwise. */
const files = (id: number, at = NOW - 24 * 60 * 60 * 1000) => {
	for (const name of [`${id}.webp`, `${id}.sprite.jpg`, `${id}.sprite.json`]) {
		const path = join(dir, name);
		writeFileSync(path, 'x');
		utimesSync(path, at / 1000, at / 1000);
	}
};
const left = () => readdirSync(dir).sort();

beforeEach(() => {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	db.prepare(`DELETE FROM entries`).run();
	db.prepare(`DELETE FROM series`).run();
});

describe('the episode files’ sweep (c454)', () => {
	it('deletes a removed episode’s picture and sprite, and keeps a present one’s', () => {
		const show = series('anime');
		const kept = entry(show, 1);
		const removed = entry(show, 2);
		files(kept);
		files(removed);
		db.prepare(`DELETE FROM entries WHERE id = ?`).run(removed);
		expect(sweepEpisodeFiles(db, { now: NOW })).toEqual(
			[`${removed}.sprite.jpg`, `${removed}.sprite.json`, `${removed}.webp`].sort()
		);
		expect(left()).toEqual([`${kept}.sprite.jpg`, `${kept}.sprite.json`, `${kept}.webp`].sort());
	});

	it('deletes every episode’s files once its whole series is gone', () => {
		const show = series('anime');
		const a = entry(show, 1);
		const b = entry(show, 2);
		files(a);
		files(b);
		db.prepare(`DELETE FROM entries WHERE series_id = ?`).run(show);
		db.prepare(`DELETE FROM series WHERE id = ?`).run(show);
		expect(sweepEpisodeFiles(db, { now: NOW })).toHaveLength(6);
		expect(left()).toEqual([]);
	});

	it('keeps the files under an id SQLite gave to a new episode, and deletes them under a chapter', () => {
		// INTEGER PRIMARY KEY without AUTOINCREMENT: the highest id, deleted, is
		// the next insert's. A new episode keeps them: `currentSprite` judges the
		// sprite by its sidecar, and its own picture writes over the old one.
		const show = series('anime');
		const old = entry(show, 1);
		files(old);
		db.prepare(`DELETE FROM entries WHERE id = ?`).run(old);
		const episode = entry(show, 1);
		expect(episode).toBe(old);
		expect(sweepEpisodeFiles(db, { now: NOW })).toEqual([]);
		expect(left()).toHaveLength(3);
		// The same id handed to a manga's chapter is no episode's.
		db.prepare(`DELETE FROM entries WHERE id = ?`).run(episode);
		const chapter = entry(series('manga'), 1);
		expect(chapter).toBe(old);
		expect(sweepEpisodeFiles(db, { now: NOW })).toHaveLength(3);
		expect(left()).toEqual([]);
	});

	it('leaves a file younger than an hour, other names, and a folder that is not there', () => {
		const show = series('anime');
		const gone = entry(show, 1);
		db.prepare(`DELETE FROM entries WHERE id = ?`).run(gone);
		// Its entry may have been written after the sweep asked.
		files(gone, NOW - SWEEP_MIN_AGE_MS + 1000);
		writeFileSync(join(dir, 'notes.txt'), 'x');
		expect(sweepEpisodeFiles(db, { now: NOW })).toEqual([]);
		expect(left()).toHaveLength(4);
		expect(sweepEpisodeFiles(db, { now: NOW + SWEEP_MIN_AGE_MS })).toHaveLength(3);
		expect(left()).toEqual(['notes.txt']);
		expect(sweepEpisodeFiles(db, { dir: join(work, 'nowhere'), now: NOW })).toEqual([]);
	});
});
