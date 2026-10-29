import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
const { getDb } = await import('$lib/server/db');
const { ensureRoot } = await import('$lib/server/import/write');
const { recordReading } = await import('$lib/server/series');

// Watching is reading (doc/ANIME.md, "The player"): an episode's place is
// seconds into it, and the player tells the log how long the episode is.
describe('watching an episode', () => {
	it('keeps its place in seconds and learns its length, a page’s count left alone', () => {
		const db = getDb();
		const root = ensureRoot(db, 'Anime', '/nowhere/Anime', false);
		const s = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at) VALUES (?, 'Show', 'anime', 0)`
				)
				.run(root).lastInsertRowid
		);
		const e = Number(
			db
				.prepare(
					`INSERT INTO entries (series_id, position, label, added_at) VALUES (?, 1, 'Ep. 1', 0)`
				)
				.run(s).lastInsertRowid
		);
		recordReading({ seriesId: s, entryId: e, kind: 'page', page: 568, lengthS: 1440, now: 10 });
		expect(
			db
				.prepare(`SELECT last_position, duration_s, page_count, read_at FROM entries WHERE id = ?`)
				.get(e)
		).toEqual({
			last_position: 568,
			duration_s: 1440,
			page_count: 0,
			read_at: null
		});
		recordReading({ seriesId: s, entryId: e, kind: 'finish', page: 1400, now: 20 });
		expect(db.prepare(`SELECT duration_s, read_at FROM entries WHERE id = ?`).get(e)).toEqual({
			duration_s: 1440,
			read_at: 20
		});
		expect(
			db.prepare(`SELECT kind, page FROM reading_events WHERE entry_id = ? ORDER BY at`).all(e)
		).toEqual([
			{ kind: 'page', page: 568 },
			{ kind: 'finish', page: 1400 }
		]);
	});
});
