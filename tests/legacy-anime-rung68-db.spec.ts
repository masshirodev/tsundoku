import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Rung 68 (card c383): an anime linked before rung 62 has only a
 * `series_links` row, which the season rule read as the whole series settled,
 * so its season 2 never reached the pass or the review. The rung moves the
 * link onto the season it stood for. The library is a file stopped at v67,
 * filled as the pre-rung-62 app left it, and the app's own `getDb()` opens it,
 * so the climb is the one a release's first start makes; every assertion
 * after it asks the app's own doors (the pass's `searchable`, the review's
 * queue, the series screen's `seriesSeasons`, AniSkip's `episodeEntry`), not
 * the tables.
 */
const work = mkdtempSync(join(tmpdir(), 'tsundoku-rung68-'));
const path = join(work, 'library.sqlite');
process.env.DATABASE_PATH = path;
process.env.BACKUP_DIR = join(work, 'backups');
afterAll(() => rmSync(work, { recursive: true, force: true }));

const { climb } = await import('$lib/server/db');

// The library at v67, before the app opens it.
const SEASONED = 1; // seasons 1 and 2, linked as one before rung 62
const SPECIALS = 2; // a special at season 0, then seasons 1 and 2
const FLAT = 3; // a flat list, no seasons at all
const DECIDED = 4; // seasons 1 and 2, season 1 also settled NONE OF THESE since
const TWO_ON = 5; // only seasons 2 and 3 in the source
const SPLIT = 6; // already has season rows: not moved
const COMIC = 7; // a manga's link: not an anime's, not moved

const seed = new Database(path);
seed.pragma('foreign_keys = ON');
climb(seed, 67);
seed.exec(`
	INSERT INTO roots (id, name, path, hidden) VALUES (1, 'Anime', '/nowhere', 0);
	INSERT INTO series (id, root_id, title, kind, added_at, origin_key, rating) VALUES
		(1, 1, 'Seasoned', 'anime', 0, 'a:1', 8),
		(2, 1, 'Specials', 'anime', 0, 'a:2', 0),
		(3, 1, 'Flat', 'anime', 0, 'a:3', 0),
		(4, 1, 'Decided', 'anime', 0, 'a:4', 0),
		(5, 1, 'Two On', 'anime', 0, 'a:5', 0),
		(6, 1, 'Split', 'anime', 0, 'a:6', 0),
		(7, 1, 'Comic', 'manga', 0, 'm:7', 0);
	INSERT INTO entries (id, series_id, position, label, added_at, source_url, season, episode_number, duration_s) VALUES
		(11, 1, 1, 'S1E1', 0, '/1/1', 1, 1, 1440),
		(12, 1, 2, 'S1E2', 0, '/1/2', 1, 2, 1440),
		(13, 1, 3, 'S2E1', 0, '/1/3', 2, 1, 1440),
		(21, 2, 1, 'SP', 0, '/2/0', 0, 1, 1440),
		(22, 2, 2, 'S1E1', 0, '/2/1', 1, 1, 1440),
		(23, 2, 3, 'S2E1', 0, '/2/2', 2, 1, 1440),
		(31, 3, 1, 'Ep 1', 0, '/3/1', NULL, NULL, 1440),
		(32, 3, 2, 'Ep 2', 0, '/3/2', NULL, NULL, 1440),
		(41, 4, 1, 'S1E1', 0, '/4/1', 1, 1, 1440),
		(42, 4, 2, 'S2E1', 0, '/4/2', 2, 1, 1440),
		(51, 5, 1, 'S2E1', 0, '/5/1', 2, 1, 1440),
		(52, 5, 2, 'S3E1', 0, '/5/2', 3, 1, 1440),
		(61, 6, 1, 'S1E1', 0, '/6/1', 1, 1, 1440),
		(62, 6, 2, 'S2E1', 0, '/6/2', 2, 1, 1440),
		(71, 7, 1, 'Ch 1', 0, '/7/1', NULL, NULL, NULL);
	-- The links as the pre-rung-62 app wrote them: one row a series.
	INSERT INTO series_links (series_id, anilist_id, mal_id, via, title, cover_url, linked_at, resolved_at, filled_rating, score, format) VALUES
		(1, 101, 901, 'review', 'Seasoned', 'https://img/101.jpg', 10, 11, 8, 85, 'TV'),
		(2, 102, 902, 'exact', 'Specials', '', 20, 21, NULL, NULL, 'TV'),
		(3, 103, 903, 'pasted', 'Flat', '', 30, 31, NULL, NULL, 'TV'),
		(4, 104, 904, 'mihon', 'Decided', '', 40, 41, NULL, 70, 'TV'),
		(5, 105, 905, 'list', 'Two On', '', 50, 51, NULL, NULL, 'TV'),
		(6, 106, 906, 'review', 'Split', '', 60, 61, NULL, NULL, 'TV'),
		(7, 107, 907, 'mihon', 'Comic', '', 70, 71, NULL, NULL, 'MANGA');
	INSERT INTO series_season_links (series_id, season, part, anilist_id, mal_id, via, title, linked_at, format)
		VALUES (6, 1, 1, 106, 906, 'review', 'Split', 60, 'TV');
	INSERT INTO season_link_decisions (series_id, season, part, decision, at) VALUES (4, 1, 1, 'none', 45);
	-- What the owner's list said of the series, filed at series level then.
	INSERT INTO tracker_state (series_id, service, status, score, progress, read_at) VALUES
		(1, 'anilist', 'CURRENT', 85, 2, 12);
	INSERT INTO tracker_sends (series_id, service, progress, status, score, wanted_at) VALUES
		(1, 'mal', 2, 'watching', NULL, 13);
	-- AniSkip asked under the one link, for every episode of season 0 or 1.
	INSERT INTO episode_marks (entry_id, method, ending_start, ending_end, tried_at) VALUES
		(11, 'aniskip', 1300, 1390, 1),
		(21, 'aniskip', 1300, 1390, 1),
		(22, 'aniskip', 1300, 1390, 1),
		(21, 'source', 1200, 1290, 1),
		(31, 'aniskip', 1300, 1390, 1);
	UPDATE entries SET ending_at = 1300 WHERE id IN (11, 22, 31);
	UPDATE entries SET ending_at = 1200 WHERE id = 21;
`);
const mirrors = seed.prepare(`SELECT * FROM series_links ORDER BY series_id`).all();
seed.close();

const { getDb } = await import('$lib/server/db');
const db = getDb();
const cat = await import('$lib/server/catalogue');
const seasons = await import('$lib/server/season-links');
const { markTriedAt } = await import('$lib/server/anime/marks');

const searchable = () =>
	cat
		.searchable(100)
		.map((r) => [r.id, r.season ?? null])
		.sort((a, b) => (a[0]! - b[0]! || a[1]! - b[1]!) as number);

describe('rung 68: a link from before rung 62 becomes its season’s row (c383)', () => {
	it('is the rung the app climbs to on opening a v67 library', () => {
		expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(68);
	});

	it('puts the link on the lowest numbered season, keeping its via, score and filled rating', () => {
		expect(seasons.seasonLinks(SEASONED)).toEqual([
			{
				seriesId: SEASONED,
				season: 1,
				part: 1,
				anilistId: 101,
				malId: 901,
				via: 'review',
				title: 'Seasoned',
				coverUrl: 'https://img/101.jpg',
				linkedAt: 10,
				resolvedAt: 11,
				filledRating: 8,
				score: 85,
				format: 'TV',
				episodes: null,
				year: null
			}
		]);
		// Season 1 keeps the owner's entry on the series screen; season 2 is not linked.
		const view = seasons.seriesSeasons(SEASONED)!;
		expect(view.seasons.map((s) => [s.season, s.link?.anilistId ?? null])).toEqual([
			[1, 101],
			[2, null]
		]);
		// A special before season 1 does not take it: season 1 is the lowest numbered.
		expect(seasons.seasonLinks(SPECIALS).map((l) => [l.season, l.part, l.via])).toEqual([
			[1, 1, 'exact']
		]);
		// A source with seasons 2 and 3 only: the link is season 2's.
		expect(seasons.seasonLinks(TWO_ON).map((l) => [l.season, l.via])).toEqual([[2, 'list']]);
	});

	it('keeps a flat list on season 0, where it is the whole run', () => {
		expect(seasons.seasonLinks(FLAT).map((l) => [l.season, l.part, l.anilistId, l.via])).toEqual([
			[0, 1, 103, 'pasted']
		]);
		const view = seasons.seriesSeasons(FLAT)!;
		expect(view.seasons.map((s) => [s.season, s.link?.anilistId ?? null])).toEqual([[0, 103]]);
	});

	it('brings the later seasons to the pass, and no settled season', () => {
		// Before the rung, none of these anime was searchable: their one link
		// settled each series. Now each open season is a row of its own.
		expect(searchable()).toEqual(
			[
				[SPECIALS, 0],
				[SPECIALS, 2],
				[SEASONED, 2],
				[DECIDED, 2],
				[TWO_ON, 3],
				[SPLIT, 2]
			].sort((a, b) => a[0] - b[0] || a[1] - b[1])
		);
		expect(seasons.seasonToLook(SEASONED)).toBe(2);
		expect(seasons.seasonToLook(FLAT)).toBeUndefined();
	});

	it('brings season 2 to the review as its own item once the pass has searched it', () => {
		seasons.saveSeasonSearch(
			SEASONED,
			2,
			1,
			'Seasoned Season 2',
			[
				{
					anilistId: 201,
					malId: 9201,
					title: 'Seasoned 2nd Season',
					alts: [],
					format: 'TV',
					country: 'JP',
					year: 2025,
					chapters: null,
					volumes: null,
					episodes: 12,
					season: 'SPRING',
					seasonYear: 2025,
					status: 'FINISHED',
					coverUrl: ''
				},
				// Season 1's own entry, which AniList's answer usually lists too: left out.
				{
					anilistId: 101,
					malId: 901,
					title: 'Seasoned',
					alts: [],
					format: 'TV',
					country: 'JP',
					year: 2024,
					chapters: null,
					volumes: null,
					episodes: 12,
					season: 'SPRING',
					seasonYear: 2024,
					status: 'FINISHED',
					coverUrl: ''
				}
			],
			1000
		);
		const items = cat.linkQueue(false).filter((i) => i.seriesId === SEASONED);
		expect(items.map((i) => [i.season, i.candidates.map((c) => c.anilistId)])).toEqual([
			[2, [201]]
		]);
	});

	it('takes a season decision at the link’s place, as linkSeason does, and leaves the others', () => {
		expect(seasons.seasonLinks(DECIDED).map((l) => [l.season, l.score])).toEqual([[1, 70]]);
		expect(seasons.seasonDecision(DECIDED, 1)).toBeNull();
	});

	it('moves nothing of a series that already has season rows, nor a comic’s link', () => {
		expect(seasons.seasonLinks(SPLIT).map((l) => [l.season, l.part])).toEqual([[1, 1]]);
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM series_season_links WHERE series_id = ?`).get(COMIC)
		).toEqual({ n: 0 });
	});

	it('leaves the mirror as it was, so its readers read the same answer', () => {
		// The columns it had at v67: a later rung's own (rung 70's country and
		// year) are that rung's to add, and its own test says what they hold.
		const atV67 = Object.keys(mirrors[0] as Record<string, unknown>);
		const now = db.prepare(`SELECT * FROM series_links ORDER BY series_id`).all() as Record<
			string,
			unknown
		>[];
		expect(now.map((r) => Object.fromEntries(atV67.map((c) => [c, r[c]])))).toEqual(mirrors);
		// The cover and the show's ids come from the season row now: the same entry.
		expect(cat.linkCover(SEASONED)).toEqual({ anilistId: 101, url: 'https://img/101.jpg' });
		expect(seasons.showEntry(SEASONED, () => true)).toEqual({ anilistId: 101, malId: 901 });
		expect(seasons.showEntry(TWO_ON, () => true)).toEqual({ anilistId: 105, malId: 905 });
	});

	it('moves what the list said, and a send still waiting, to the season', () => {
		expect(
			db
				.prepare(
					`SELECT season, part, service, status, progress FROM season_tracker_state WHERE series_id = ?`
				)
				.all(SEASONED)
		).toEqual([{ season: 1, part: 1, service: 'anilist', status: 'CURRENT', progress: 2 }]);
		expect(
			db
				.prepare(
					`SELECT season, part, service, progress FROM season_tracker_sends WHERE series_id = ?`
				)
				.all(SEASONED)
		).toEqual([{ season: 1, part: 1, service: 'mal', progress: 2 }]);
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM tracker_state WHERE series_id = ?`).get(SEASONED)
		).toEqual({ n: 0 });
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM tracker_sends WHERE series_id = ?`).get(SEASONED)
		).toEqual({ n: 0 });
	});

	it('keeps AniSkip’s answers for the season’s own episodes and forgets the special’s', () => {
		// The season's episodes ask the same entry, numbered the same, as before.
		expect(seasons.episodeEntry(SEASONED, 1, 1)).toMatchObject({ malId: 901, number: 1 });
		expect(seasons.episodeEntry(FLAT, null, 2)).toMatchObject({ malId: 903, number: 2 });
		expect(markTriedAt(11, 'aniskip')).toBe(1);
		expect(markTriedAt(22, 'aniskip')).toBe(1);
		expect(markTriedAt(31, 'aniskip')).toBe(1);
		// The special was asked under the one link, now season 1's alone: it goes,
		// its source mark stays, and its ending is the source's.
		expect(seasons.episodeEntry(SPECIALS, 0, 1)).toBeNull();
		expect(markTriedAt(21, 'aniskip')).toBeNull();
		expect(markTriedAt(21, 'source')).toBe(1);
		expect(db.prepare(`SELECT ending_at FROM entries WHERE id = 21`).get()).toEqual({
			ending_at: 1200
		});
	});
});
