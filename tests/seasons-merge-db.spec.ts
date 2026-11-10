import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Merging seasons into one show, and putting them back (card c283, S2;
 * doc/WORKS.md, "Per-season sources"). Three seasons -- one watched, one
 * partly, one streaming -- across the tables that name a series: their
 * episodes, log rows, progress, sources, folders, links, tracking, tags,
 * shelves, queue and Work. A merge is checked by what moved, and its UNDO by
 * dumping **every table** before the merge and after the undo; an id that
 * changed shows there.
 *
 * FOLLOW is run on the merged show against a stand-in source, because it asks
 * the **last** season (season-facts.ts, `followOrigin`) and writes what it
 * lists into that season.
 */

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const source = vi.hoisted(() => ({
	lists: new Map<string, { url: string; name: string; episode_number: number }[]>(),
	asked: [] as string[]
}));
vi.mock('$lib/server/engine/anime-source', async (original) => ({
	...(await original<typeof import('$lib/server/engine/anime-source')>()),
	fetchAnime: async (id: string) => {
		source.asked.push(id);
		const episodes = source.lists.get(id);
		if (!episodes) return null;
		return {
			sourceId: '7',
			details: {
				url: Buffer.from(id.split('~')[1], 'base64url').toString(),
				title: 'A show',
				description: '',
				status: 1
			},
			episodes
		};
	}
}));

const { getDb } = await import('$lib/server/db');
const books = await import('$lib/server/books');
const facts = await import('$lib/server/season-facts');
const { sourceMangaId } = await import('$lib/server/engine/backend');
const { checkAnime, followAnime } = await import('$lib/server/anime/follow');
const works = await import('$lib/server/works');
const library = await import('$lib/server/library');
const { dequeue } = await import('$lib/server/engine/queue');
const { episodeFile } = await import('$lib/server/anime/streams');
const { writeSeries } = await import('$lib/server/import/write');
const { prunePageless } = await import('$lib/server/import/index');
const { foldSeries } = await import('$lib/server/import/fold');
const { deleteBook, deleteSeries } = await import('$lib/server/delete');
const seriesDoors = await import('$lib/server/series');
import type { PlannedSeries } from '$lib/import/plan';

const db = getDb();

const at = (day: number) => Date.UTC(2026, 10, day, 12);
const NOW = at(9);

/** Every table, every row, canonically sorted: the round trip's measure. */
function dump(): Record<string, string[]> {
	const tables = (
		db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
			)
			.all() as { name: string }[]
	).map((r) => r.name);
	const out: Record<string, string[]> = {};
	for (const table of tables) {
		const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
		out[table] = rows.map((row) => JSON.stringify(row, Object.keys(row).sort())).sort();
	}
	return out;
}

/** Every table a merge must know about, walked from the schema, never listed. */
function seriesAndEntryTables(): { table: string; column: string; parent: string }[] {
	const tables = (
		db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
			)
			.all() as { name: string }[]
	).map((r) => r.name);
	const out: { table: string; column: string; parent: string }[] = [];
	for (const table of tables)
		for (const fk of db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as {
			table: string;
			from: string;
		}[])
			if (fk.table === 'series' || fk.table === 'entries')
				out.push({ table, column: fk.from, parent: fk.table });
	return out;
}

let next = 0;
const insert = (sql: string, values: unknown[]) =>
	Number(db.prepare(sql).run(...(values as never[])).lastInsertRowid);
const bump = () => ++next + 100;

type Show = {
	id: number;
	key: string;
	folder: string;
	title: string;
	rating: number;
	favourite: number;
	addedAt: number;
	season: number;
	read: 'all' | 'some' | 'none';
};

function series(s: Show): number {
	return insert(
		`INSERT INTO series (id, root_id, title, kind, rating, favourite, hidden, hue, added_at,
			indexed_at, source, path, origin_key, public, in_library)
		VALUES (?, ?, ?, 'anime', ?, ?, 0, 1, ?, ?, 'Aniyomi', '', ?, 1, 1)`,
		[s.id, 1, s.title, s.rating, s.favourite, s.addedAt, s.addedAt, s.key]
	);
}

function episode(
	seriesId: number,
	season: number,
	number: number,
	read: 'yes' | 'some' | 'no'
): number {
	const id = bump();
	const readAt = read === 'yes' ? at(9) : null;
	insert(
		`INSERT INTO entries (id, series_id, position, label, title, added_at, source_url, season,
			episode_number, read_at, last_position, last_opened_at, duration_s)
		VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, 1440)`,
		[
			id,
			seriesId,
			number,
			`Ep. ${number}`,
			at(1),
			`/watch/${seriesId}/${number}`,
			season,
			number,
			readAt,
			read === 'yes' ? 1440 : read === 'some' ? 600 : null,
			read === 'no' ? null : at(9)
		]
	);
	return id;
}

function seed() {
	db.exec(`
		DELETE FROM season_merges; DELETE FROM works; DELETE FROM roots; DELETE FROM tags;
		DELETE FROM collections; DELETE FROM scan_jobs; DELETE FROM tracker_accounts;
		DELETE FROM highlights;
	`);
	insert(`INSERT INTO roots (id, name, path, hidden) VALUES (1, 'Aniyomi', '/lib/Anime', 0)`, []);
	insert(`INSERT INTO roots (id, name, path, hidden) VALUES (2, 'Hidden', '/lib/Hidden', 1)`, []);
	const shows: Show[] = [
		{
			id: 101,
			key: 'aniyomi:7:/frieren',
			folder: 'Anime/Frieren',
			title: "Frieren: Beyond Journey's End",
			rating: 6,
			favourite: 0,
			addedAt: at(1),
			season: 1,
			read: 'all'
		},
		{
			id: 102,
			key: 'aniyomi:7:/frieren-s2',
			folder: 'Anime/Frieren S2',
			title: "Frieren: Beyond Journey's End Season 2",
			rating: 9,
			favourite: 1,
			addedAt: at(2),
			season: 2,
			read: 'some'
		},
		{
			id: 103,
			key: 'aniyomi:7:/frieren-s3',
			folder: 'Anime/Frieren S3',
			title: "Frieren: Beyond Journey's End Season 3",
			rating: 7,
			favourite: 0,
			addedAt: at(3),
			season: 3,
			read: 'none'
		}
	];
	for (const s of shows) {
		series(s);
		insert(`INSERT INTO anime_series (series_id, folder) VALUES (?, ?)`, [s.id, s.folder]);
		insert(`INSERT INTO anime_checks (series_id, checked_at) VALUES (?, ?)`, [s.id, at(8)]);
		insert(`INSERT INTO anime_episodes (entry_id, quality, downloaded_at) VALUES (?, 1080, ?)`, [
			episode(s.id, s.season, 1, s.read === 'all' ? 'yes' : s.read === 'some' ? 'yes' : 'no'),
			at(8)
		]);
		episode(s.id, s.season, 2, s.read === 'all' ? 'yes' : s.read === 'some' ? 'no' : 'no');
	}
	// Watched: a finished log and a mark on each episode; a flat row of the
	// series' own with no entry, as a close does.
	insert(
		`INSERT INTO reading_events (id, at, series_id, entry_id, kind, page)
		VALUES (?, ?, 101, NULL, 'close', NULL)`,
		[bump(), at(9)]
	);
	for (const e of db.prepare(`SELECT id FROM entries WHERE series_id = 101`).all() as {
		id: number;
	}[])
		insert(
			`INSERT INTO reading_events (at, series_id, entry_id, kind, page) VALUES (?, 101, ?, 'finish', ?)`,
			[at(9), e.id, 1440]
		);
	// Partly watched: an open on season 2's second episode.
	const partly = (
		db.prepare(`SELECT id FROM entries WHERE series_id = 102 AND episode_number = 2`).get() as {
			id: number;
		}
	).id;
	insert(
		`INSERT INTO reading_events (at, series_id, entry_id, kind, page) VALUES (?, 102, ?, 'page', 600)`,
		[at(9), partly]
	);
	// A queued episode and a source that failed, on the streaming season.
	const streamed = (
		db
			.prepare(`SELECT id FROM entries WHERE series_id = 103 ORDER BY episode_number LIMIT 1`)
			.get() as {
			id: number;
		}
	).id;
	insert(
		`INSERT INTO download_queue (entry_id, series_id, position, state, queued_at)
		VALUES (?, 103, 1, 'queued', ?)`,
		[streamed, at(9)]
	);
	insert(
		`INSERT INTO episode_failures (entry_id, series_id, first_at, last_at, tries)
		VALUES (?, 103, ?, ?, 2)`,
		[streamed, at(8), at(9)]
	);
	// Tags and a shelf across the seasons.
	insert(`INSERT INTO tags (id, namespace, value) VALUES (1, 'genre', 'fantasy')`, []);
	insert(`INSERT INTO tags (id, namespace, value) VALUES (2, 'studio', 'Madhouse')`, []);
	db.prepare(
		`INSERT INTO series_tags (series_id, tag_id) VALUES (101, 1), (102, 2), (103, 1)`
	).run();
	insert(`INSERT INTO collections (id, name, position) VALUES (1, 'Weekend', 0)`, []);
	db.prepare(
		`INSERT INTO collection_series (collection_id, series_id) VALUES (1, 102), (1, 103)`
	).run();
	// One Work of all three: merging it into one series ends it, and the undo
	// must bring the same Work back under the same id.
	insert(
		`INSERT INTO works (id, name, created_at, order_mode) VALUES (5, 'Frieren Run', ?, 'hand')`,
		[at(4)]
	);
	db.prepare(
		`INSERT INTO work_series (work_id, series_id, position) VALUES (5, 101, 1), (5, 102, 2), (5, 103, 3)`
	).run();
	// A link per season: seasons 1 and 2 their own rows, season 3 only the
	// legacy one an anime linked before c240 has.
	insert(
		`INSERT INTO series_season_links (series_id, season, part, anilist_id, via, title, linked_at)
		VALUES (101, 0, 1, 9001, 'exact', 'Frieren', ?)`,
		[at(5)]
	);
	insert(
		`INSERT INTO series_season_links (series_id, season, part, anilist_id, via, title, linked_at)
		VALUES (102, 2, 1, 9002, 'exact', 'Frieren 2', ?)`,
		[at(5)]
	);
	insert(
		`INSERT INTO series_links (series_id, anilist_id, via, title, linked_at)
		VALUES (103, 9003, 'pasted', 'Frieren 3', ?)`,
		[at(5)]
	);
	// Tracking and the show's own player choice, which must come back exactly.
	insert(
		`INSERT INTO tracker_state (series_id, service, status, progress) VALUES (101, 'anilist', 'CURRENT', 2)`,
		[]
	);
	insert(
		`INSERT INTO season_tracker_state (series_id, season, part, service, status, progress)
		VALUES (102, 2, 1, 'anilist', 'CURRENT', 1)`,
		[]
	);
	insert(`INSERT INTO series_player (series_id, choice, chosen_at) VALUES (101, 'subs', ?)`, [
		at(6)
	]);
	// Highlights: one pointing at season 2's second episode, and one that lost
	// its entry on season 3 and waits to rejoin (round 2). `highlights` names a
	// series with no foreign key, so the merge's walk must ask its column.
	insert(
		`INSERT INTO highlights (id, kind, series_id, entry_id, origin_key, number, season,
			series_title, series_kind, made_at, state, hidden, rejoin)
		VALUES (?, 'page', 102, ?, 'aniyomi:7:/frieren-s2', 2, 2, ?, 'anime', ?, 'ok', 0, 0)`,
		[bump(), partly, "Frieren: Beyond Journey's End Season 2", at(7)]
	);
	insert(
		`INSERT INTO highlights (id, kind, series_id, entry_id, origin_key, number, season,
			series_title, series_kind, made_at, state, hidden, rejoin)
		VALUES (?, 'page', 103, NULL, 'aniyomi:7:/frieren-s3', 1, 3, ?, 'anime', ?, 'orphan_entry', 0, 1)`,
		[bump(), "Frieren: Beyond Journey's End Season 3", at(7)]
	);
}

beforeEach(() => {
	source.lists.clear();
	source.asked = [];
	seed();
});

describe('merging three seasons', () => {
	it('moves every episode onto the first season, in the sheet’s order', () => {
		const before = dump();
		const made = books.mergeSeasons({
			seriesIds: [101, 102, 103],
			name: "Frieren: Beyond Journey's End",
			now: NOW
		});
		expect(made).toMatchObject({ seriesId: 101, seasons: 3 });
		const rows = db
			.prepare(
				`SELECT season, episode_number AS n, series_id FROM entries ORDER BY season, episode_number`
			)
			.all() as { season: number; n: number; series_id: number }[];
		expect(rows).toEqual([
			{ season: 1, n: 1, series_id: 101 },
			{ season: 1, n: 2, series_id: 101 },
			{ season: 2, n: 1, series_id: 101 },
			{ season: 2, n: 2, series_id: 101 },
			{ season: 3, n: 1, series_id: 101 },
			{ season: 3, n: 2, series_id: 101 }
		]);
		expect(dump()).not.toEqual(before);
		// One show; the absorbed ids are held by placeholder rows, which no
		// library listing sees (round 2).
		expect(db.prepare(`SELECT COUNT(*) AS n FROM series WHERE in_library = 1`).get()).toEqual({
			n: 1
		});
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM series WHERE reserve_at IS NOT NULL`).get()
		).toEqual({ n: 2 });
		expect(db.prepare(`SELECT COUNT(*) AS n FROM season_merges`).get()).toEqual({ n: 1 });
	});

	it('keeps each season’s source, folder and title in S1’s per-season rows', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		const rows = facts.seasonFacts(101, db);
		expect(rows.map((r) => [r.season, r.originKey, r.folder, r.sourceTitle])).toEqual([
			[1, 'aniyomi:7:/frieren', 'Anime/Frieren', "Frieren: Beyond Journey's End"],
			[2, 'aniyomi:7:/frieren-s2', 'Anime/Frieren S2', "Frieren: Beyond Journey's End Season 2"],
			[3, 'aniyomi:7:/frieren-s3', 'Anime/Frieren S3', "Frieren: Beyond Journey's End Season 3"]
		]);
		// FOLLOW asks the last season, and the season number is its own.
		expect(facts.followOrigin(101, db)).toEqual({ key: 'aniyomi:7:/frieren-s3', season: 3 });
		// Each link is its own season's, and the legacy row became season 3's.
		const links = db
			.prepare(
				`SELECT season, part, anilist_id AS anilist FROM series_season_links ORDER BY season, part`
			)
			.all() as { season: number; part: number; anilist: number }[];
		expect(links).toEqual([
			{ season: 1, part: 1, anilist: 9001 },
			{ season: 2, part: 1, anilist: 9002 },
			{ season: 3, part: 1, anilist: 9003 }
		]);
		expect(db.prepare(`SELECT COUNT(*) AS n FROM series_links`).get()).toEqual({ n: 0 });
	});

	it('takes the highest rating, FAV if any, every tag and shelf, and S1’s cover', () => {
		db.prepare(`UPDATE series SET cover_key = 'cover-101' WHERE id = 101`).run();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		const s = db
			.prepare(`SELECT rating, favourite, cover_key AS cover FROM series WHERE id = 101`)
			.get();
		expect(s).toEqual({ rating: 9, favourite: 1, cover: 'cover-101' });
		expect(
			(
				db.prepare(`SELECT tag_id FROM series_tags ORDER BY tag_id`).all() as { tag_id: number }[]
			).map((r) => r.tag_id)
		).toEqual([1, 2]);
		expect(
			(
				db.prepare(`SELECT collection_id FROM collection_series`).all() as {
					collection_id: number;
				}[]
			).map((r) => r.collection_id)
		).toEqual([1]);
	});

	it('moves the log, the queue and the tracking state with the episodes', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		const seriesIds = (
			db.prepare(`SELECT DISTINCT series_id AS id FROM reading_events`).all() as { id: number }[]
		).map((r) => r.id);
		expect(seriesIds).toEqual([101]);
		expect(db.prepare(`SELECT series_id FROM download_queue`).get()).toEqual({ series_id: 101 });
		expect(db.prepare(`SELECT series_id FROM episode_failures`).get()).toEqual({ series_id: 101 });
		expect(
			db.prepare(`SELECT season, service FROM season_tracker_state ORDER BY season`).all()
		).toEqual([{ season: 2, service: 'anilist' }]);
	});

	it('runs FOLLOW on the merged show, asking the last season', async () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		const url = '/frieren-s3';
		const ask = sourceMangaId('7', url);
		source.lists.set(ask, [{ url: `${url}/ep-3`, name: 'Episode 3', episode_number: 3 }]);
		const got = await checkAnime(101, NOW, db, { queue: false });
		expect(got).toEqual({ added: 1, queued: 0 });
		// The source asked is the last season's, not the show's own key.
		expect(source.asked).toEqual([ask]);
		expect(
			db
				.prepare(
					`SELECT season, episode_number AS n FROM entries
					WHERE series_id = 101 AND episode_number = 3`
				)
				.all()
		).toEqual([{ season: 3, n: 3 }]);
		expect(db.prepare(`SELECT checked_at FROM anime_checks WHERE series_id = 101`).get()).toEqual({
			checked_at: NOW
		});
	});

	it('ends the Work of the seasons merged, and the undo brings it back', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		// The Work itself is gone; a placeholder row holds its id (round 2).
		expect(db.prepare(`SELECT COUNT(*) AS n FROM works WHERE reserve_at IS NULL`).get()).toEqual({
			n: 0
		});
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM works WHERE reserve_at IS NOT NULL`).get()
		).toEqual({ n: 1 });
		books.ungroupSeasons(101, NOW);
		expect(db.prepare(`SELECT id, name, created_at FROM works`).get()).toEqual({
			id: 5,
			name: 'Frieren Run',
			created_at: at(4)
		});
		expect(db.prepare(`SELECT series_id FROM work_series ORDER BY position`).all()).toEqual([
			{ series_id: 101 },
			{ series_id: 102 },
			{ series_id: 103 }
		]);
	});

	it('puts every table back exactly, every series under its own id', () => {
		const before = dump();
		const tables = seriesAndEntryTables();
		// The walk is this fixture's own claim: these tables name a series or an entry.
		for (const table of [
			'series',
			'entries',
			'anime_series',
			'anime_checks',
			'reading_events',
			'download_queue',
			'episode_failures',
			'series_tags',
			'collection_series',
			'work_series',
			'series_season_links',
			'series_links',
			'tracker_state',
			'season_tracker_state',
			'series_player',
			'series_season_facts'
		])
			expect(
				tables.some((t) => t.table === table),
				table
			).toBe(true);

		books.mergeSeasons({ seriesIds: [101, 102, 103], name: 'One Show', now: NOW });
		const merged = dump();
		expect(merged).not.toEqual(before);
		// The merge really moved rows: three series are one, two ids are held
		// open, and the journal is a row.
		expect(db.prepare(`SELECT COUNT(*) AS n FROM series WHERE in_library = 1`).get()).toEqual({
			n: 1
		});
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM series WHERE reserve_at IS NOT NULL`).get()
		).toEqual({ n: 2 });
		expect(merged.season_merges).toHaveLength(1);
		expect(merged.series_season_facts).toHaveLength(3);
		expect(merged.season_reservations).toHaveLength(3);
		// The merge orphaned the highlight without an entry, as it must: the
		// undo has to bring it back exactly.
		expect(
			db.prepare(`SELECT series_id, state, rejoin FROM highlights WHERE entry_id IS NULL`).get()
		).toEqual({ series_id: null, state: 'orphan_series', rejoin: 0 });

		expect(books.ungroupSeasons(101, NOW)).toEqual([101, 102, 103]);
		expect(dump()).toEqual(before);
		expect(books.mergeState(101)).toBeNull();
	});
});

describe('the refusals', () => {
	it('refuses a selection that is not all anime', () => {
		db.prepare(`UPDATE series SET kind = 'manga' WHERE id = 103`).run();
		expect(() => books.mergeSeasons({ seriesIds: [101, 102, 103] })).toThrow(/only anime/);
	});

	it('refuses mixed hidden and visible roots (alike)', () => {
		db.prepare(`UPDATE roots SET hidden = 1 WHERE id = 2`).run();
		db.prepare(`UPDATE series SET root_id = 2 WHERE id = 103`).run();
		expect(() => books.mergeSeasons({ seriesIds: [101, 102, 103] })).toThrow(/hidden and visible/);
	});

	it('refuses a season already merged, and a show of one', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		insert(
			`INSERT INTO series (id, root_id, title, kind, rating, favourite, hidden, hue, added_at, indexed_at, source, path, origin_key, public, in_library)
			VALUES (104, 1, 'Another', 'anime', 0, 0, 0, 1, ?, ?, 'Aniyomi', '', 'aniyomi:7:/another', 1, 1)`,
			[at(9), at(9)]
		);
		expect(() => books.mergeSeasons({ seriesIds: [101, 104] })).toThrow(/already part/);
		expect(() => books.mergeSeasons({ seriesIds: [101] })).toThrow(/two seasons/);
	});

	it('refuses seasons in two Works', () => {
		db.prepare(`DELETE FROM work_series WHERE series_id IN (102, 103)`).run();
		insert(`INSERT INTO works (id, name, created_at, order_mode) VALUES (6, 'Other', ?, 'hand')`, [
			at(5)
		]);
		db.prepare(
			`INSERT INTO work_series (work_id, series_id, position) VALUES (6, 102, 1), (6, 103, 2)`
		).run();
		expect(() => books.mergeSeasons({ seriesIds: [101, 102, 103] })).toThrow(/two Works/);
	});

	it('refuses a series that already holds more than one season', () => {
		db.prepare(`UPDATE entries SET season = 2 WHERE series_id = 101 AND episode_number = 2`).run();
		expect(() => books.mergeSeasons({ seriesIds: [101, 102, 103] })).toThrow(
			/more than one season/
		);
	});
});

describe('taking one season out', () => {
	it('takes the last out, with its source, link, files and watched state, and renumbers', () => {
		const before = dump();
		books.mergeSeasons({ seriesIds: [101, 102, 103], name: 'One Show', now: NOW });
		expect(books.takeOutSeason(101, 3, NOW)).toBe(103);
		const s = db
			.prepare(`SELECT id, title, rating, favourite FROM series WHERE id = 103`)
			.get() as Record<string, unknown>;
		expect(s).toEqual({
			id: 103,
			title: "Frieren: Beyond Journey's End Season 3",
			rating: 7,
			favourite: 0
		});
		expect(db.prepare(`SELECT folder FROM anime_series WHERE series_id = 103`).get()).toEqual({
			folder: 'Anime/Frieren S3'
		});
		// Its episodes are its own again, with the source's own season and order.
		expect(
			db
				.prepare(
					`SELECT season, episode_number AS n, position FROM entries WHERE series_id = 103 ORDER BY position`
				)
				.all()
		).toEqual([
			{ season: 3, n: 1, position: 1 },
			{ season: 3, n: 2, position: 2 }
		]);
		expect(db.prepare(`SELECT anilist_id FROM series_links WHERE series_id = 103`).get()).toEqual({
			anilist_id: 9003
		});
		// The show keeps two seasons, renumbered from 1.
		expect(facts.seasonFacts(101, db).map((f) => f.season)).toEqual([1, 2]);
		expect(
			db.prepare(`SELECT DISTINCT season FROM entries WHERE series_id = 101 ORDER BY season`).all()
		).toEqual([{ season: 1 }, { season: 2 }]);
		expect(books.mergeState(101)).toEqual({ seasons: 2, madeAt: NOW });
		expect(before).not.toEqual(dump());
	});

	it('takes the middle out and closes the gap', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		expect(books.takeOutSeason(101, 2, NOW)).toBe(102);
		expect(facts.seasonFacts(101, db).map((f) => [f.season, f.originKey])).toEqual([
			[1, 'aniyomi:7:/frieren'],
			[2, 'aniyomi:7:/frieren-s3']
		]);
		expect(
			db
				.prepare(
					`SELECT season, episode_number AS n FROM entries WHERE series_id = 101 ORDER BY season, episode_number`
				)
				.all()
		).toEqual([
			{ season: 1, n: 1 },
			{ season: 1, n: 2 },
			{ season: 2, n: 1 },
			{ season: 2, n: 2 }
		]);
		expect(
			db.prepare(`SELECT series_id FROM series_season_links ORDER BY season, series_id`).all()
		).toEqual([{ series_id: 101 }, { series_id: 101 }, { series_id: 102 }]);
		expect(db.prepare(`SELECT COUNT(*) AS n FROM series WHERE in_library = 1`).get()).toEqual({
			n: 2
		});
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM series WHERE reserve_at IS NOT NULL`).get()
		).toEqual({ n: 1 });
	});

	it('takes the first out, handing the show to the next season', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], name: 'One Show', now: NOW });
		expect(books.takeOutSeason(101, 1, NOW)).toBe(101);
		// The first season is the series it was, with its own title and folder.
		expect(db.prepare(`SELECT title FROM series WHERE id = 101`).get()).toEqual({
			title: "Frieren: Beyond Journey's End"
		});
		expect(db.prepare(`SELECT folder FROM anime_series WHERE series_id = 101`).get()).toEqual({
			folder: 'Anime/Frieren'
		});
		// The show is season 2's row, under the name it was merged with, and its
		// seasons are 1 and 2 again.
		expect(db.prepare(`SELECT title FROM series WHERE id = 102`).get()).toEqual({
			title: 'One Show'
		});
		expect(facts.seasonFacts(102, db).map((f) => [f.season, f.originKey])).toEqual([
			[1, 'aniyomi:7:/frieren-s2'],
			[2, 'aniyomi:7:/frieren-s3']
		]);
		expect(
			db
				.prepare(
					`SELECT series_id, season FROM entries WHERE series_id = 102 ORDER BY season, episode_number`
				)
				.all()
		).toEqual([
			{ series_id: 102, season: 1 },
			{ series_id: 102, season: 1 },
			{ series_id: 102, season: 2 },
			{ series_id: 102, season: 2 }
		]);
		expect(books.mergeState(102)).toEqual({ seasons: 2, madeAt: NOW });
		expect(books.mergeState(101)).toBeNull();
	});

	it('taking the second-to-last out makes the last one an ordinary series', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], name: 'One Show', now: NOW });
		books.takeOutSeason(101, 1, NOW);
		books.takeOutSeason(102, 2, NOW);
		expect(books.mergeState(102)).toBeNull();
		expect(db.prepare(`SELECT COUNT(*) AS n FROM series`).get()).toEqual({ n: 3 });
		expect(db.prepare(`SELECT COUNT(*) AS n FROM season_merges`).get()).toEqual({ n: 0 });
		expect(
			db
				.prepare(
					`SELECT series_id, COUNT(*) AS n FROM entries GROUP BY series_id ORDER BY series_id`
				)
				.all()
		).toEqual([
			{ series_id: 101, n: 2 },
			{ series_id: 102, n: 2 },
			{ series_id: 103, n: 2 }
		]);
	});
});

describe('the episodes’ files, and the show’s folder (round 2)', () => {
	/** A real folder per season, each holding `Episode 1.mkv`: the same name twice. */
	function giveFiles() {
		const root = mkdtempSync(join('temp', 'seasons-files-'));
		const dirs = ['One', 'Two', 'Three'].map((name) => {
			const dir = join(root, name);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, 'Episode 1.mkv'), name);
			return dir;
		});
		[101, 102, 103].forEach((id, i) => {
			db.prepare(`UPDATE series SET path = ? WHERE id = ?`).run(dirs[i], id);
			// The season's own folder is the one on disk, so the importer's own
			// `isSeasonFolder` names a downloaded file against the show's folder.
			db.prepare(`UPDATE anime_series SET folder = ? WHERE series_id = ?`).run(dirs[i], id);
			db.prepare(
				`UPDATE entries SET file = 'Episode 1.mkv', available = 1
				WHERE series_id = ? AND episode_number = 1`
			).run(id);
		});
		return { root, dirs, cleanup: () => rmSync(root, { recursive: true, force: true }) };
	}
	/** The three episodes' ids, before the merge moves them. */
	const ids = (): Record<number, number> =>
		Object.fromEntries(
			[101, 102, 103].map((id) => [
				id,
				(
					db
						.prepare(`SELECT id FROM entries WHERE series_id = ? AND episode_number = 1`)
						.get(id) as { id: number }
				).id
			])
		);
	const own = (dirs: string[], seriesId: number) =>
		join(dirs[seriesId === 101 ? 0 : seriesId === 102 ? 1 : 2], 'Episode 1.mkv');

	it('names every moved episode from the show’s folder, and puts them back', () => {
		const files = giveFiles();
		const e = ids();
		try {
			expect(episodeFile(e[101])).toBe(own(files.dirs, 101));
			expect(episodeFile(e[102])).toBe(own(files.dirs, 102));
			expect(episodeFile(e[103])).toBe(own(files.dirs, 103));
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			// The same file name under three folders: each still resolves to its own.
			expect(episodeFile(e[101])).toBe(own(files.dirs, 101));
			expect(episodeFile(e[102])).toBe(own(files.dirs, 102));
			expect(episodeFile(e[103])).toBe(own(files.dirs, 103));
			books.ungroupSeasons(101, NOW);
			expect(episodeFile(e[101])).toBe(own(files.dirs, 101));
			expect(episodeFile(e[102])).toBe(own(files.dirs, 102));
			expect(episodeFile(e[103])).toBe(own(files.dirs, 103));
			expect(db.prepare(`SELECT file FROM entries WHERE id = ?`).get(e[102])).toEqual({
				file: 'Episode 1.mkv'
			});
		} finally {
			files.cleanup();
		}
	});

	it('names them from the taken-out season’s folder again on a take-out', () => {
		const files = giveFiles();
		const e = ids();
		try {
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			books.takeOutSeason(101, 2, NOW);
			expect(episodeFile(e[102])).toBe(own(files.dirs, 102));
			// The show keeps the others, named from its own folder.
			expect(episodeFile(e[103])).toBe(own(files.dirs, 103));
			expect(db.prepare(`SELECT file FROM entries WHERE id = ?`).get(e[103])).toEqual({
				file: '../Three/Episode 1.mkv'
			});
		} finally {
			files.cleanup();
		}
	});

	it('hands the show’s folder to the next season on a first-season take-out', () => {
		const files = giveFiles();
		const e = ids();
		try {
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			books.takeOutSeason(101, 1, NOW);
			expect(episodeFile(e[101])).toBe(own(files.dirs, 101));
			expect(episodeFile(e[102])).toBe(own(files.dirs, 102));
			expect(episodeFile(e[103])).toBe(own(files.dirs, 103));
			expect(db.prepare(`SELECT file FROM entries WHERE id = ?`).get(e[103])).toEqual({
				file: '../Three/Episode 1.mkv'
			});
		} finally {
			files.cleanup();
		}
	});

	it('takes the first season folder that has one, so a streaming first season keeps files', () => {
		const files = giveFiles();
		const e = ids();
		try {
			db.prepare(`UPDATE series SET path = '' WHERE id = 101`).run();
			const before = db.prepare(`SELECT path FROM series WHERE id = 101`).get();
			expect(episodeFile(e[102])).toBe(own(files.dirs, 102));
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			// The show takes season 2's folder: the moved files stay reachable,
			// rather than becoming no file under an empty first season.
			expect(db.prepare(`SELECT path FROM series WHERE id = 101`).get()).toEqual({
				path: files.dirs[1]
			});
			expect(episodeFile(e[102])).toBe(own(files.dirs, 102));
			expect(episodeFile(e[103])).toBe(own(files.dirs, 103));
			books.ungroupSeasons(101, NOW);
			expect(db.prepare(`SELECT path FROM series WHERE id = 101`).get()).toEqual(before);
			expect(episodeFile(e[102])).toBe(own(files.dirs, 102));
			expect(episodeFile(e[103])).toBe(own(files.dirs, 103));
		} finally {
			files.cleanup();
		}
	});

	it('hands a streaming first season’s show the next folder it finds, so later files survive (round 3)', () => {
		const files = giveFiles();
		const e = ids();
		try {
			// The next season streams, while the last still holds a file.
			db.prepare(`UPDATE series SET path = '' WHERE id = 102`).run();
			db.prepare(`UPDATE entries SET file = '', available = 0 WHERE series_id = 102`).run();
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			books.takeOutSeason(101, 1, NOW);
			// The show takes the first remaining season that has a folder (3's),
			// not the next season's empty one, and names the files from it.
			expect(db.prepare(`SELECT path FROM series WHERE id = 102`).get()).toEqual({
				path: files.dirs[2]
			});
			expect(db.prepare(`SELECT file, available FROM entries WHERE id = ?`).get(e[103])).toEqual({
				file: 'Episode 1.mkv',
				available: 1
			});
			expect(episodeFile(e[103])).toBe(own(files.dirs, 103));
			books.ungroupSeasons(102, NOW);
			expect(episodeFile(e[103])).toBe(own(files.dirs, 103));
			expect(db.prepare(`SELECT path FROM series WHERE id = 103`).get()).toEqual({
				path: files.dirs[2]
			});
		} finally {
			files.cleanup();
		}
	});
});

/** The ids of each season's first two episodes, before a merge moves them. */
function episodeIds(): Record<string, number> {
	const row = (seriesId: number, number: number) =>
		(
			db
				.prepare(`SELECT id FROM entries WHERE series_id = ? AND episode_number = ?`)
				.get(seriesId, number) as { id: number }
		).id;
	return { s1e1: row(101, 1), s2e1: row(102, 1), s2e2: row(102, 2), s3e1: row(103, 1) };
}

describe('what the show is used for while merged (round 2)', () => {
	it('carries the log, the queue, the failures and the tracker state to the right series', () => {
		const e = episodeIds();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		// Two finished episodes, one on season 2 and one on season 3, and the
		// show's own close (no entry).
		insert(
			`INSERT INTO reading_events (at, series_id, entry_id, kind, page) VALUES (?, 101, ?, 'finish', 1440)`,
			[at(10), e.s2e1]
		);
		insert(
			`INSERT INTO reading_events (at, series_id, entry_id, kind, page) VALUES (?, 101, ?, 'finish', 1440)`,
			[at(10), e.s3e1]
		);
		const close = insert(
			`INSERT INTO reading_events (at, series_id, entry_id, kind, page) VALUES (?, 101, NULL, 'close', NULL)`,
			[at(10)]
		);
		insert(
			`INSERT INTO download_queue (entry_id, series_id, position, state, queued_at)
			VALUES (?, 101, 1, 'queued', ?)`,
			[e.s2e1, at(10)]
		);
		// The seed already has a failure for season 3's first episode; writing it
		// while merged is an update to the row the merge moved.
		db.prepare(`UPDATE episode_failures SET tries = 3, last_at = ? WHERE entry_id = ?`).run(
			at(10),
			e.s3e1
		);
		db.prepare(`UPDATE tracker_state SET progress = 9 WHERE series_id = 101`).run();
		insert(
			`INSERT INTO season_tracker_state (series_id, season, part, service, status, progress)
			VALUES (101, 3, 1, 'anilist', 'CURRENT', 5)`,
			[]
		);

		books.ungroupSeasons(101, NOW);

		expect(
			db.prepare(`SELECT entry_id, series_id FROM reading_events ORDER BY entry_id, id`).all()
		).toEqual(
			expect.arrayContaining([
				{ entry_id: e.s2e1, series_id: 102 },
				{ entry_id: e.s3e1, series_id: 103 },
				{ entry_id: null, series_id: 101 }
			])
		);
		expect(db.prepare(`SELECT series_id FROM reading_events WHERE id = ?`).get(close)).toEqual({
			series_id: 101
		});
		expect(
			db.prepare(`SELECT series_id FROM download_queue WHERE entry_id = ?`).get(e.s2e1)
		).toEqual({
			series_id: 102
		});
		expect(
			db.prepare(`SELECT series_id FROM episode_failures WHERE entry_id = ?`).get(e.s3e1)
		).toEqual({ series_id: 103 });
		// The show's own tracker state keeps what was written while merged.
		expect(db.prepare(`SELECT progress FROM tracker_state WHERE series_id = 101`).get()).toEqual({
			progress: 9
		});
		expect(
			db
				.prepare(
					`SELECT series_id, season, progress FROM season_tracker_state WHERE series_id = 103`
				)
				.get()
		).toEqual({ series_id: 103, season: 3, progress: 5 });
	});

	it('sends an episode FOLLOW added to its season, with that season’s numbering', async () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		const url = '/frieren-s3';
		const ask = sourceMangaId('7', url);
		source.lists.set(ask, [{ url: `${url}/ep-9`, name: 'Episode 9', episode_number: 9 }]);
		expect(await checkAnime(101, NOW, db, { queue: false })).toEqual({ added: 1, queued: 0 });
		const added = db
			.prepare(`SELECT id, season FROM entries WHERE episode_number = 9 AND series_id = 101`)
			.get() as { id: number; season: number };
		expect(added.season).toBe(3);
		books.ungroupSeasons(101, NOW);
		expect(db.prepare(`SELECT series_id, season FROM entries WHERE id = ?`).get(added.id)).toEqual({
			series_id: 103,
			season: 3
		});
		// The receiving season put its episodes back in order.
		expect(
			(
				db
					.prepare(`SELECT position FROM entries WHERE series_id = 103 ORDER BY position`)
					.all() as { position: number }[]
			).map((r) => r.position)
		).toEqual([1, 2, 3]);
	});

	it('keeps an added episode through a take-out of another season, renumbered with the show', async () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		const url = '/frieren-s3';
		const ask = sourceMangaId('7', url);
		source.lists.set(ask, [{ url: `${url}/ep-9`, name: 'Episode 9', episode_number: 9 }]);
		await checkAnime(101, NOW, db, { queue: false });
		const added = (
			db.prepare(`SELECT id FROM entries WHERE episode_number = 9 AND series_id = 101`).get() as {
				id: number;
			}
		).id;
		books.takeOutSeason(101, 2, NOW);
		// Season 3 is season 2 of the show now, and the episode went with it.
		expect(db.prepare(`SELECT series_id, season FROM entries WHERE id = ?`).get(added)).toEqual({
			series_id: 101,
			season: 2
		});
	});
});

describe('FOLLOW is the last season’s (round 2)', () => {
	const list = (url: string) => {
		const ask = sourceMangaId('7', url);
		source.lists.set(ask, [{ url: `${url}/ep-3`, name: 'Episode 3', episode_number: 3 }]);
		return ask;
	};

	it('follows the show when the last season is followed, and the undo gives each its own', async () => {
		db.prepare(`UPDATE series SET followed_at = ? WHERE id = 103`).run(at(7));
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		expect(db.prepare(`SELECT followed_at FROM series WHERE id = 101`).get()).toEqual({
			followed_at: at(7)
		});
		const ask = list('/frieren-s3');
		// Through FOLLOW's own due list, not `checkAnime` directly: the show is
		// due, the last season's source is asked, and its new episode is queued.
		expect(await followAnime(NOW, db)).toEqual({ series: 1, queued: 1 });
		expect(source.asked).toEqual([ask]);
		books.ungroupSeasons(101, NOW);
		expect(db.prepare(`SELECT followed_at FROM series WHERE id = 101`).get()).toEqual({
			followed_at: null
		});
		expect(db.prepare(`SELECT followed_at FROM series WHERE id = 103`).get()).toEqual({
			followed_at: at(7)
		});
		expect(db.prepare(`SELECT followed_at FROM series WHERE id = 102`).get()).toEqual({
			followed_at: null
		});
	});

	it('does not follow the show when only the first season is followed', async () => {
		db.prepare(`UPDATE series SET followed_at = ? WHERE id = 101`).run(at(7));
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		expect(db.prepare(`SELECT followed_at FROM series WHERE id = 101`).get()).toEqual({
			followed_at: null
		});
		expect(await followAnime(NOW, db)).toEqual({ series: 0, queued: 0 });
		expect(source.asked).toEqual([]);
		books.ungroupSeasons(101, NOW);
		expect(db.prepare(`SELECT followed_at FROM series WHERE id = 101`).get()).toEqual({
			followed_at: at(7)
		});
	});
});

describe('ids held open across a merge (round 2)', () => {
	it('keeps absorbed series and Work ids from being reissued, then puts them back', () => {
		const before = db.prepare(`SELECT id FROM works WHERE id = 5`).get();
		expect(before).toEqual({ id: 5 });
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		// The placeholders are not library rows: the listing counts the show only.
		expect(db.prepare(`SELECT COUNT(*) AS n FROM series WHERE in_library = 1`).get()).toEqual({
			n: 1
		});
		// A series and a Work made while merged take ids past the reserved ones.
		const newSeries = insert(
			`INSERT INTO series (root_id, title, kind, added_at) VALUES (1, 'A new series', 'anime', ?)`,
			[at(10)]
		);
		const newSeries2 = insert(
			`INSERT INTO series (root_id, title, kind, added_at) VALUES (1, 'A new pair', 'anime', ?)`,
			[at(10)]
		);
		const newWork = insert(
			`INSERT INTO works (name, created_at, order_mode) VALUES ('A new Work', ?, 'hand')`,
			[at(10)]
		);
		// A Work of one cannot exist, so the newcomer holds two series and the
		// placeholder teardown's `series_deleted_ends_work` leaves it alone.
		insert(`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, 1)`, [
			newWork,
			newSeries
		]);
		insert(`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, 2)`, [
			newWork,
			newSeries2
		]);
		expect([101, 102, 103]).not.toContain(newSeries);
		expect(newSeries).toBeGreaterThan(103);
		expect(newWork).toBeGreaterThan(5);
		books.ungroupSeasons(101, NOW);
		expect(
			db.prepare(`SELECT id FROM series WHERE id IN (101, 102, 103) ORDER BY id`).all()
		).toEqual([{ id: 101 }, { id: 102 }, { id: 103 }]);
		expect(db.prepare(`SELECT id FROM works WHERE id = 5`).get()).toEqual({ id: 5 });
		// The newcomer is untouched, under its own id.
		expect(db.prepare(`SELECT title FROM series WHERE id = ?`).get(newSeries)).toEqual({
			title: 'A new series'
		});
		expect(db.prepare(`SELECT name FROM works WHERE id = ?`).get(newWork)).toEqual({
			name: 'A new Work'
		});
	});
});

describe('highlights and the walk (round 2)', () => {
	it('restores a highlight the merge orphaned, and moves one made since', () => {
		const e = episodeIds();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		expect(
			db.prepare(`SELECT series_id, state, rejoin FROM highlights WHERE entry_id IS NULL`).get()
		).toEqual({ series_id: null, state: 'orphan_series', rejoin: 0 });
		expect(
			db.prepare(`SELECT series_id, state FROM highlights WHERE entry_id IS NOT NULL`).get()
		).toEqual({ series_id: 101, state: 'ok' });
		// A highlight made while merged on season 2's episode follows it back.
		const made = insert(
			`INSERT INTO highlights (kind, series_id, entry_id, origin_key, number, season,
				series_title, series_kind, made_at)
			VALUES ('page', 101, ?, 'aniyomi:7:/frieren', 1, 2, 'Show', 'anime', ?)`,
			[e.s2e1, at(10)]
		);
		books.ungroupSeasons(101, NOW);
		// The seeded orphan is exactly what it was (the round-trip spec dumps
		// every table); the highlight made since follows its episode.
		expect(
			db.prepare(`SELECT series_id, state, rejoin FROM highlights WHERE entry_id IS NULL`).get()
		).toEqual({ series_id: 103, state: 'orphan_entry', rejoin: 1 });
		expect(db.prepare(`SELECT series_id FROM highlights WHERE id = ?`).get(made)).toEqual({
			series_id: 102
		});
	});

	it('walks every table that names a series, including the one with no foreign key', () => {
		const walk = books.seriesChildTables(db);
		expect(walk.filter((t) => t.via === 'column').map((t) => t.table)).toEqual(['highlights']);
		const tables = (
			db
				.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
				.all() as { name: string }[]
		).map((r) => r.name);
		const withSeriesId = tables
			.filter(
				(name) =>
					name !== 'series' &&
					(db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).some(
						(c) => c.name === 'series_id'
					)
			)
			.sort();
		expect(walk.map((t) => t.table).sort()).toEqual(withSeriesId);
	});
});

describe('the log across a take-out (round 2)', () => {
	const totals = () => ({
		log: (db.prepare(`SELECT COUNT(*) AS n FROM reading_events`).get() as { n: number }).n,
		queue: (db.prepare(`SELECT COUNT(*) AS n FROM download_queue`).get() as { n: number }).n,
		failures: (db.prepare(`SELECT COUNT(*) AS n FROM episode_failures`).get() as { n: number }).n
	});
	const writeHistory = (e: Record<string, number>) => {
		for (const entry of [e.s1e1, e.s2e1, e.s3e1])
			insert(
				`INSERT INTO reading_events (at, series_id, entry_id, kind, page) VALUES (?, 101, ?, 'finish', 1440)`,
				[at(10), entry]
			);
	};
	const cases: [string, number][] = [
		['the last', 3],
		['the middle', 2],
		['the first', 1]
	];
	for (const [name, season] of cases)
		it(`keeps every row when ${name} is taken out`, () => {
			const e = episodeIds();
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			writeHistory(e);
			const before = totals();
			const taken = books.takeOutSeason(101, season, NOW);
			expect(totals()).toEqual(before);
			// The taken season's event went with it, and the others stayed.
			const moved = (
				db
					.prepare(`SELECT series_id FROM reading_events WHERE entry_id = ?`)
					.get(e[`s${season}e1` as 's1e1']) as { series_id: number }
			).series_id;
			expect(moved).toBe(taken);
		});

	it('keeps every row through a first take-out and then a second-to-last', () => {
		const e = episodeIds();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		writeHistory(e);
		const before = totals();
		books.takeOutSeason(101, 1, NOW);
		expect(totals()).toEqual(before);
		// The show is season 2's row now, and the first season is its own.
		expect(
			db.prepare(`SELECT series_id FROM reading_events WHERE entry_id = ?`).get(e.s3e1)
		).toEqual({ series_id: 102 });
		books.takeOutSeason(102, 2, NOW);
		expect(totals()).toEqual(before);
	});
});

/** A series that is not part of the merge: a Work's outside member, a newcomer. */
function outsider(id: number, title: string, key: string) {
	series({
		id,
		key,
		folder: `Anime/${title}`,
		title,
		rating: 0,
		favourite: 0,
		addedAt: at(1),
		season: 1,
		read: 'none'
	});
}

const workMembers = () =>
	db
		.prepare(`SELECT series_id, position FROM work_series WHERE work_id = 5 ORDER BY position`)
		.all();

describe('a Work with a member outside the merge (round 2)', () => {
	it('keeps the outside member when the first season is in the Work', () => {
		outsider(9, 'A Movie', 'aniyomi:7:/movie');
		db.prepare(`DELETE FROM work_series WHERE work_id = 5`).run();
		db.prepare(
			`INSERT INTO work_series (work_id, series_id, position) VALUES (5, 101, 1), (5, 102, 2), (5, 9, 3)`
		).run();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		books.ungroupSeasons(101, NOW);
		expect(workMembers()).toEqual([
			{ series_id: 101, position: 1 },
			{ series_id: 102, position: 2 },
			{ series_id: 9, position: 3 }
		]);
	});

	it('keeps the outside member when only a later season is in the Work', () => {
		outsider(9, 'A Movie', 'aniyomi:7:/movie');
		db.prepare(`DELETE FROM work_series WHERE work_id = 5`).run();
		db.prepare(
			`INSERT INTO work_series (work_id, series_id, position) VALUES (5, 102, 1), (5, 9, 2)`
		).run();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		books.ungroupSeasons(101, NOW);
		expect(workMembers()).toEqual([
			{ series_id: 102, position: 1 },
			{ series_id: 9, position: 2 }
		]);
	});

	it('keeps the Work’s members and positions through a take-out', () => {
		outsider(9, 'A Movie', 'aniyomi:7:/movie');
		db.prepare(`DELETE FROM work_series WHERE work_id = 5`).run();
		db.prepare(
			`INSERT INTO work_series (work_id, series_id, position)
			VALUES (5, 101, 1), (5, 102, 2), (5, 103, 3), (5, 9, 4)`
		).run();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		books.takeOutSeason(101, 3, NOW);
		// The show (seasons 1 and 2) and the taken season keep their places; the
		// outside member never leaves.
		expect(workMembers()).toEqual([
			{ series_id: 101, position: 1 },
			{ series_id: 103, position: 3 },
			{ series_id: 9, position: 4 }
		]);
	});
});

/** A plan the downloader's arrived hook hands to the importer, for one file. */
function filePlan(
	folder: string,
	seriesId: number,
	season: number,
	episode: number,
	file: string,
	url = `/watch/${seriesId}/${episode}`
): PlannedSeries {
	return {
		originKey: 'aniyomi:7:/frieren',
		source: 'Aniyomi',
		title: "Frieren: Beyond Journey's End",
		kind: 'anime',
		rating: 0,
		favourite: false,
		hidden: false,
		shelves: [],
		tags: [],
		description: '',
		status: '',
		direction: null,
		addedAt: at(1),
		sourceUrl: '',
		path: folder,
		entries: [
			{
				position: episode,
				label: `Ep. ${episode}`,
				title: '',
				sourceUrl: url,
				scanlator: '',
				available: true,
				file,
				bytes: 0,
				pageCount: 0,
				addedAt: at(1),
				readAt: null,
				lastPosition: null,
				lastOpenedAt: null,
				history: null,
				episode: { season, number: episode, note: '', durationS: null, thumbUrl: '' }
			}
		]
	};
}

describe('a file gained while merged (round 2)', () => {
	const give = () => {
		const root = mkdtempSync(join('temp', 'seasons-gained-'));
		const dirs = ['One', 'Two', 'Three'].map((name) => {
			const dir = join(root, name);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, 'Episode 1.mkv'), name);
			return dir;
		});
		[101, 102, 103].forEach((id, i) => {
			db.prepare(`UPDATE series SET path = ? WHERE id = ?`).run(dirs[i], id);
			db.prepare(`UPDATE anime_series SET folder = ? WHERE series_id = ?`).run(dirs[i], id);
			db.prepare(
				`UPDATE entries SET file = 'Episode 1.mkv', available = 1
				WHERE series_id = ? AND episode_number = 1`
			).run(id);
		});
		return { dirs, cleanup: () => rmSync(root, { recursive: true, force: true }) };
	};
	const entryOf = (seriesId: number, number = 1) =>
		(
			db
				.prepare(`SELECT id FROM entries WHERE series_id = ? AND episode_number = ?`)
				.get(seriesId, number) as { id: number }
		).id;
	const write = (
		folder: string,
		seriesId: number,
		season: number,
		file: string,
		number = 1,
		url?: string
	) => {
		writeFileSync(join(folder, file), 'x');
		return writeSeries(
			filePlan(folder, seriesId, season, number, file, url),
			{ rootId: 1, jobId: null, now: NOW, markMissing: false },
			db
		);
	};

	it('keeps a later season’s new file after an undo, on its own series', () => {
		const files = give();
		const e = entryOf(102);
		try {
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			write(files.dirs[1], 102, 2, 'Episode 2.mkv');
			// While merged it is named from the show's folder.
			expect(db.prepare(`SELECT file FROM entries WHERE id = ?`).get(e)).toEqual({
				file: '../Two/Episode 2.mkv'
			});
			books.ungroupSeasons(101, NOW);
			expect(episodeFile(e)).toBe(join(files.dirs[1], 'Episode 2.mkv'));
			expect(db.prepare(`SELECT file FROM entries WHERE id = ?`).get(e)).toEqual({
				file: 'Episode 2.mkv'
			});
		} finally {
			files.cleanup();
		}
	});

	it('keeps the first season’s new file after an undo', () => {
		const files = give();
		const e = entryOf(101);
		try {
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			write(files.dirs[0], 101, 1, 'Episode 3.mkv');
			books.ungroupSeasons(101, NOW);
			expect(episodeFile(e)).toBe(join(files.dirs[0], 'Episode 3.mkv'));
		} finally {
			files.cleanup();
		}
	});

	it('keeps a later season’s new file through a take-out', () => {
		const files = give();
		const e = entryOf(102);
		try {
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			write(files.dirs[1], 102, 2, 'Episode 2.mkv');
			books.takeOutSeason(101, 2, NOW);
			expect(episodeFile(e)).toBe(join(files.dirs[1], 'Episode 2.mkv'));
		} finally {
			files.cleanup();
		}
	});

	it('keeps the first season’s new file through a take-out', () => {
		const files = give();
		const e = entryOf(101);
		try {
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			write(files.dirs[0], 101, 1, 'Episode 3.mkv');
			books.takeOutSeason(101, 1, NOW);
			expect(episodeFile(e)).toBe(join(files.dirs[0], 'Episode 3.mkv'));
		} finally {
			files.cleanup();
		}
	});

	it('gives a season with no folder one of its own, so its file survives the undo (round 3)', () => {
		// Every season streams, so the merge leaves the show with no folder.
		db.prepare(`UPDATE series SET path = '' WHERE id IN (101, 102, 103)`).run();
		const e = entryOf(102);
		const root = mkdtempSync(join('temp', 'seasons-first-'));
		try {
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			expect(db.prepare(`SELECT path FROM series WHERE id = 101`).get()).toEqual({ path: '' });
			// The download's arrived hook gives the show the folder it downloaded
			// into, because the show had none.
			write(root, 102, 2, 'Episode 1.mkv');
			expect(db.prepare(`SELECT path FROM series WHERE id = 101`).get()).toEqual({ path: root });
			expect(episodeFile(e)).toBe(join(root, 'Episode 1.mkv'));
			books.ungroupSeasons(101, NOW);
			// The season had no folder at merge, so it takes the file's own
			// directory rather than dropping the file.
			expect(db.prepare(`SELECT path FROM series WHERE id = 102`).get()).toEqual({ path: root });
			expect(db.prepare(`SELECT file, available FROM entries WHERE id = ?`).get(e)).toEqual({
				file: 'Episode 1.mkv',
				available: 1
			});
			expect(episodeFile(e)).toBe(join(root, 'Episode 1.mkv'));
			// The first season's own empty path is the journal's, not the show's.
			expect(db.prepare(`SELECT path FROM series WHERE id = 101`).get()).toEqual({ path: '' });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('gives a season with no folder one on a take-out, so its file survives (round 3)', () => {
		db.prepare(`UPDATE series SET path = '' WHERE id IN (101, 102, 103)`).run();
		const e = entryOf(102);
		const root = mkdtempSync(join('temp', 'seasons-first-'));
		try {
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			write(root, 102, 2, 'Episode 1.mkv');
			expect(episodeFile(e)).toBe(join(root, 'Episode 1.mkv'));
			books.takeOutSeason(101, 2, NOW);
			expect(db.prepare(`SELECT path FROM series WHERE id = 102`).get()).toEqual({ path: root });
			expect(db.prepare(`SELECT file, available FROM entries WHERE id = ?`).get(e)).toEqual({
				file: 'Episode 1.mkv',
				available: 1
			});
			expect(episodeFile(e)).toBe(join(root, 'Episode 1.mkv'));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('keeps a streaming season’s file beside a season with a folder (round 3)', () => {
		const files = give();
		const e = entryOf(102);
		try {
			// Season 2 streams: no folder and no files, while 1 and 3 have both.
			db.prepare(`UPDATE series SET path = '' WHERE id = 102`).run();
			db.prepare(`UPDATE entries SET file = '', available = 0 WHERE series_id = 102`).run();
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			write(files.dirs[1], 102, 2, 'Episode 1.mkv');
			expect(episodeFile(e)).toBe(join(files.dirs[1], 'Episode 1.mkv'));
			books.ungroupSeasons(101, NOW);
			expect(episodeFile(e)).toBe(join(files.dirs[1], 'Episode 1.mkv'));
			expect(db.prepare(`SELECT path FROM series WHERE id = 102`).get()).toEqual({
				path: files.dirs[1]
			});
			expect(db.prepare(`SELECT file, available FROM entries WHERE id = ?`).get(e)).toEqual({
				file: 'Episode 1.mkv',
				available: 1
			});
		} finally {
			files.cleanup();
		}
	});

	it('keeps a streaming season’s file beside a folder through a take-out (round 3)', () => {
		const files = give();
		const e = entryOf(102);
		try {
			db.prepare(`UPDATE series SET path = '' WHERE id = 102`).run();
			db.prepare(`UPDATE entries SET file = '', available = 0 WHERE series_id = 102`).run();
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			write(files.dirs[1], 102, 2, 'Episode 1.mkv');
			expect(episodeFile(e)).toBe(join(files.dirs[1], 'Episode 1.mkv'));
			books.takeOutSeason(101, 2, NOW);
			expect(episodeFile(e)).toBe(join(files.dirs[1], 'Episode 1.mkv'));
			expect(db.prepare(`SELECT file, available FROM entries WHERE id = ?`).get(e)).toEqual({
				file: 'Episode 1.mkv',
				available: 1
			});
		} finally {
			files.cleanup();
		}
	});

	it('names an added episode, and its available, on a season with no folder (round 3)', async () => {
		const files = give();
		try {
			db.prepare(`UPDATE series SET path = '' WHERE id = 102`).run();
			db.prepare(`UPDATE entries SET file = '', available = 0 WHERE series_id = 102`).run();
			books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
			const url = '/frieren-s2';
			const ask = sourceMangaId('7', url);
			source.lists.set(ask, [{ url: `${url}/ep-9`, name: 'Episode 9', episode_number: 9 }]);
			expect(await checkAnime(101, NOW, db, { queue: false })).toEqual({ added: 1, queued: 0 });
			const added = (
				db.prepare(`SELECT id FROM entries WHERE episode_number = 9 AND series_id = 101`).get() as {
					id: number;
				}
			).id;
			write(files.dirs[1], 101, 2, 'Episode 9.mkv', 9, `${url}/ep-9`);
			expect(db.prepare(`SELECT file, available FROM entries WHERE id = ?`).get(added)).toEqual({
				file: '../Two/Episode 9.mkv',
				available: 1
			});
			books.ungroupSeasons(101, NOW);
			expect(
				db.prepare(`SELECT series_id, file, available FROM entries WHERE id = ?`).get(added)
			).toEqual({ series_id: 102, file: 'Episode 9.mkv', available: 1 });
			expect(episodeFile(added)).toBe(join(files.dirs[1], 'Episode 9.mkv'));
		} finally {
			files.cleanup();
		}
	});

	it('names an added episode, and its available, on a taken-out season with no folder (round 3)', async () => {
		const files = give();
		try {
			db.prepare(`UPDATE series SET path = '' WHERE id = 103`).run();
			db.prepare(`UPDATE entries SET file = '', available = 0 WHERE series_id = 103`).run();
			books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
			const url = '/frieren-s3';
			const ask = sourceMangaId('7', url);
			source.lists.set(ask, [{ url: `${url}/ep-9`, name: 'Episode 9', episode_number: 9 }]);
			expect(await checkAnime(101, NOW, db, { queue: false })).toEqual({ added: 1, queued: 0 });
			const added = (
				db.prepare(`SELECT id FROM entries WHERE episode_number = 9 AND series_id = 101`).get() as {
					id: number;
				}
			).id;
			write(files.dirs[2], 101, 3, 'Episode 9.mkv', 9, `${url}/ep-9`);
			expect(db.prepare(`SELECT file FROM entries WHERE id = ?`).get(added)).toEqual({
				file: '../Three/Episode 9.mkv'
			});
			books.takeOutSeason(101, 3, NOW);
			expect(
				db.prepare(`SELECT series_id, file, available FROM entries WHERE id = ?`).get(added)
			).toEqual({ series_id: 103, file: 'Episode 9.mkv', available: 1 });
			expect(episodeFile(added)).toBe(join(files.dirs[2], 'Episode 9.mkv'));
		} finally {
			files.cleanup();
		}
	});
});

describe('a finished download is not queued again (round 2)', () => {
	it('does not put back a queue row a finished download removed', () => {
		const e = episodeIds();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		expect(db.prepare(`SELECT COUNT(*) AS n FROM download_queue`).get()).toEqual({ n: 1 });
		// The queue's own writer removes the row (`dequeue`, the same DELETE the
		// downloader's end runs; that end needs ffmpeg, an engine and a loopback,
		// so it cannot run in a db spec).
		dequeue([e.s3e1], db);
		books.ungroupSeasons(101, NOW);
		expect(db.prepare(`SELECT COUNT(*) AS n FROM download_queue`).get()).toEqual({ n: 0 });
	});

	it('does not put back a failure that was cleared', () => {
		const e = episodeIds();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		expect(db.prepare(`SELECT COUNT(*) AS n FROM episode_failures`).get()).toEqual({ n: 1 });
		// The only writer that clears a failure is a MOVE's `clearFailures`
		// (move.ts), which needs a candidate from the network and cannot run in a
		// db spec; the removal is the statement that writer runs.
		db.prepare(`DELETE FROM episode_failures WHERE entry_id = ?`).run(e.s3e1);
		books.ungroupSeasons(101, NOW);
		expect(db.prepare(`SELECT COUNT(*) AS n FROM episode_failures`).get()).toEqual({ n: 0 });
	});
});

describe('a Work id held across a take-out (round 2)', () => {
	it('does not hand the ended Work’s id to a new Work', () => {
		outsider(9, 'A Movie', 'aniyomi:7:/movie');
		outsider(10, 'A Second Movie', 'aniyomi:7:/movie-2');
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		expect(books.takeOutSeason(101, 3, NOW)).toBe(103);
		// The Work the merge ended still holds its id, reserved for the undo.
		expect(db.prepare(`SELECT id FROM works WHERE id = 5`).get()).toEqual({ id: 5 });
		expect(
			db.prepare(`SELECT 1 FROM season_reservations WHERE kind = 'works' AND id = 5`).get()
		).toBeTruthy();
		const newWork = insert(
			`INSERT INTO works (name, created_at, order_mode) VALUES ('Unrelated', ?, 'hand')`,
			[at(10)]
		);
		expect(newWork).toBeGreaterThan(5);
		insert(`INSERT INTO work_series (work_id, series_id, position) VALUES (?, 9, 1)`, [newWork]);
		insert(`INSERT INTO work_series (work_id, series_id, position) VALUES (?, 10, 2)`, [newWork]);
		books.ungroupSeasons(101, NOW);
		// Work 5 is the merge’s again; the newcomer is untouched.
		expect(
			db.prepare(`SELECT series_id FROM work_series WHERE work_id = 5 ORDER BY position`).all()
		).toEqual([{ series_id: 101 }, { series_id: 102 }, { series_id: 103 }]);
		expect(
			db
				.prepare(`SELECT series_id FROM work_series WHERE work_id = ? ORDER BY position`)
				.all(newWork)
		).toEqual([{ series_id: 9 }, { series_id: 10 }]);
	});
});

describe('a Work id reissued while merged (round 3)', () => {
	const setup = () => {
		const folk: [number, string, string][] = [
			[9, 'A Movie', 'aniyomi:7:/movie'],
			[10, 'A Second Movie', 'aniyomi:7:/movie-2'],
			[11, 'A Short', 'aniyomi:7:/short'],
			[20, 'A Newcomer', 'aniyomi:7:/newcomer'],
			[21, 'Another Newcomer', 'aniyomi:7:/newcomer-2']
		];
		for (const [id, title, key] of folk) outsider(id, title, key);
		db.prepare(`DELETE FROM works`).run();
		const older = works.createWork({ seriesIds: [9, 10], name: 'Older', now: at(5) });
		const run = works.createWork({ seriesIds: [101, 102, 11], name: 'Run', now: at(6) });
		return { older: older.work.id, run: run.work.id };
	};

	it('does not put a Work ended while merged onto the stranger that took its id', () => {
		const { run } = setup();
		expect(run).toBe(2);
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		// Its outside member keeps it live through the merge.
		expect(db.prepare(`SELECT COUNT(*) AS n FROM work_series WHERE work_id = ?`).get(run)).toEqual({
			n: 2
		});
		works.ungroup(run);
		const newcomer = works.createWork({ seriesIds: [20, 21], name: 'Unrelated', now: at(10) });
		expect(newcomer.work.id).toBe(run);
		books.ungroupSeasons(101, NOW);
		// The newcomer is untouched, and the journal's Work is gone with its id.
		expect(db.prepare(`SELECT name FROM works WHERE id = ?`).get(run)).toEqual({
			name: 'Unrelated'
		});
		expect(
			db.prepare(`SELECT series_id FROM work_series WHERE work_id = ? ORDER BY position`).all(run)
		).toEqual([{ series_id: 20 }, { series_id: 21 }]);
	});

	it('does not put it back through a take-out that left the Work short of members', () => {
		const { run } = setup();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		works.takeOut(run, 11);
		expect(db.prepare(`SELECT 1 FROM works WHERE id = ?`).get(run)).toBeUndefined();
		const newcomer = works.createWork({ seriesIds: [20, 21], name: 'Unrelated', now: at(10) });
		expect(newcomer.work.id).toBe(run);
		books.ungroupSeasons(101, NOW);
		expect(db.prepare(`SELECT name FROM works WHERE id = ?`).get(run)).toEqual({
			name: 'Unrelated'
		});
		expect(
			db.prepare(`SELECT series_id FROM work_series WHERE work_id = ? ORDER BY position`).all(run)
		).toEqual([{ series_id: 20 }, { series_id: 21 }]);
	});
});

describe('a hide made while merged (round 3)', () => {
	const state = (id: number) =>
		db.prepare(`SELECT hidden, public FROM series WHERE id = ?`).get(id);

	it('keeps the hide on every season through the undo', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		expect(library.setHidden([101], true)).toBe(1);
		books.ungroupSeasons(101, NOW);
		for (const id of [101, 102, 103]) expect(state(id)).toEqual({ hidden: 1, public: 0 });
	});

	it('keeps the hide on the season taken out, and on the show', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		library.setHidden([101], true);
		books.takeOutSeason(101, 3, NOW);
		expect(state(103)).toEqual({ hidden: 1, public: 0 });
		expect(state(101)).toEqual({ hidden: 1, public: 0 });
		books.ungroupSeasons(101, NOW);
		for (const id of [101, 102, 103]) expect(state(id)).toEqual({ hidden: 1, public: 0 });
	});

	it('keeps the hide through a first-season take-out', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		library.setHidden([101], true);
		books.takeOutSeason(101, 1, NOW);
		for (const id of [101, 102, 103]) expect(state(id)).toEqual({ hidden: 1, public: 0 });
	});

	it('keeps an unhide made while merged, with public following the root', () => {
		db.prepare(`UPDATE roots SET hidden = 1 WHERE id = 1`).run();
		library.setHidden([101, 102, 103], true);
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		library.setHidden([101], false);
		books.ungroupSeasons(101, NOW);
		for (const id of [101, 102, 103]) expect(state(id)).toEqual({ hidden: 0, public: 1 });
	});
});

describe('a journal row whose entry is gone (round 3)', () => {
	it('restores a log row without its entry instead of failing the undo', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		const partly = (
			db
				.prepare(
					`SELECT id FROM entries WHERE series_id = 101 AND season = 2 AND episode_number = 2`
				)
				.get() as { id: number }
		).id;
		// No anime door deletes an episode today (?/deleteBook's sheet is the
		// books'); the review measured this state with the same DELETE, and the
		// foreign key nulls the live log row's reference.
		db.prepare(`DELETE FROM entries WHERE id = ?`).run(partly);
		expect(() => books.ungroupSeasons(101, NOW)).not.toThrow();
		expect(
			db
				.prepare(`SELECT entry_id FROM reading_events WHERE series_id = 102 AND kind = 'page'`)
				.all()
		).toEqual([{ entry_id: null }]);
	});
});

describe('a flat list and an episode added while merged (round 2)', () => {
	const listOf = (url: string) => {
		const ask = sourceMangaId('7', url);
		source.lists.set(ask, [{ url: `${url}/ep-9`, name: 'Episode 9', episode_number: 9 }]);
		return ask;
	};

	it('sends an episode FOLLOW added to a flat list back without a season', async () => {
		db.prepare(`UPDATE entries SET season = NULL WHERE series_id = 102`).run();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		listOf('/frieren-s2');
		expect(await checkAnime(101, NOW, db, { queue: false })).toEqual({ added: 1, queued: 0 });
		const added = db
			.prepare(`SELECT id, season FROM entries WHERE episode_number = 9 AND series_id = 101`)
			.get() as { id: number; season: number };
		expect(added.season).toBe(2);
		books.ungroupSeasons(101, NOW);
		expect(db.prepare(`SELECT series_id, season FROM entries WHERE id = ?`).get(added.id)).toEqual({
			series_id: 102,
			season: null
		});
		// The receiving flat list is in order again.
		expect(
			(
				db
					.prepare(`SELECT position FROM entries WHERE series_id = 102 ORDER BY position`)
					.all() as { position: number }[]
			).map((r) => r.position)
		).toEqual([1, 2, 3]);
	});

	it('sends an episode added while merged out with a flat-list season on a take-out', async () => {
		db.prepare(`UPDATE entries SET season = NULL WHERE series_id = 102`).run();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		listOf('/frieren-s2');
		expect(await checkAnime(101, NOW, db, { queue: false })).toEqual({ added: 1, queued: 0 });
		const added = (
			db.prepare(`SELECT id FROM entries WHERE episode_number = 9 AND series_id = 101`).get() as {
				id: number;
			}
		).id;
		// Two seasons: taking either out restores both, and the flat list's
		// episode is back with no season.
		books.takeOutSeason(101, 2, NOW);
		expect(db.prepare(`SELECT series_id, season FROM entries WHERE id = ?`).get(added)).toEqual({
			series_id: 102,
			season: null
		});
	});
});

/**
 * Every Work, its moment and each member's place: what the undo reads and
 * writes (round 3's owner-action table). A `LEFT JOIN` so a Work with no
 * members shows as one row, which is a state the undo must never leave.
 */
function workTable() {
	return db
		.prepare(
			`SELECT w.id AS work_id, w.name, w.created_at AS made, ws.series_id, ws.position
			FROM works w LEFT JOIN work_series ws ON ws.work_id = w.id
			ORDER BY w.id, ws.position, ws.series_id`
		)
		.all();
}

const membersOfWork = (workId: number) =>
	db
		.prepare(`SELECT series_id, position FROM work_series WHERE work_id = ? ORDER BY position`)
		.all(workId);

/** A series' own row, the columns an owner action writes. */
function seriesRowOf(id: number) {
	return db
		.prepare(
			`SELECT id, title, rating, favourite, hidden, public, path, followed_at
			FROM series WHERE id = ?`
		)
		.get(id) as Record<string, unknown> | undefined;
}

const titlesOf = () =>
	db.prepare(`SELECT id, title FROM series WHERE id IN (101, 102, 103) ORDER BY id`).all();

/**
 * Two Works with an outside member each, as the round-2 and round-3 reviews
 * measured: Work 1 "Older" of two films, Work 2 "Run" of the first two seasons
 * and a third series that is not part of the merge.
 */
function twoWorks() {
	const folk: [number, string, string][] = [
		[9, 'A Movie', 'aniyomi:7:/movie'],
		[10, 'A Second Movie', 'aniyomi:7:/movie-2'],
		[11, 'A Short', 'aniyomi:7:/short'],
		[20, 'A Newcomer', 'aniyomi:7:/newcomer'],
		[21, 'Another Newcomer', 'aniyomi:7:/newcomer-2']
	];
	for (const [id, title, key] of folk) outsider(id, title, key);
	db.prepare(`DELETE FROM works`).run();
	const older = works.createWork({ seriesIds: [9, 10], name: 'Older', now: at(5) });
	const run = works.createWork({ seriesIds: [101, 102, 11], name: 'Run', now: at(6) });
	return { older: older.work.id, run: run.work.id, made: run.work.createdAt };
}

describe('a Work renamed while merged (round 3)', () => {
	it('puts the absorbed season back into the Work the owner renamed', () => {
		const { run, made } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		works.rename(run, 'Run, renamed', made);
		books.ungroupSeasons(101, NOW);
		// The name the owner gave it while merged is theirs; the membership the
		// journal holds is the merge's.
		expect(db.prepare(`SELECT name FROM works WHERE id = ?`).get(run)).toEqual({
			name: 'Run, renamed'
		});
		expect(workTable()).toEqual([
			{ work_id: 1, name: 'Older', made: at(5), series_id: 9, position: 1 },
			{ work_id: 1, name: 'Older', made: at(5), series_id: 10, position: 2 },
			{ work_id: 2, name: 'Run, renamed', made: made, series_id: 101, position: 1 },
			{ work_id: 2, name: 'Run, renamed', made: made, series_id: 102, position: 2 },
			{ work_id: 2, name: 'Run, renamed', made: made, series_id: 11, position: 3 }
		]);
		expect(seriesRowOf(102)).toMatchObject({
			title: "Frieren: Beyond Journey's End Season 2",
			path: ''
		});
	});
});

describe('a season taken out after its Work was reissued (round 3)', () => {
	it('does not put the taken season into the stranger that took the Work id', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		works.ungroup(run);
		const newcomer = works.createWork({ seriesIds: [20, 21], name: 'Unrelated', now: at(10) });
		expect(newcomer.work.id).toBe(run);
		expect(books.takeOutSeason(101, 2, NOW)).toBe(102);
		// The newcomer keeps exactly its own members and places.
		expect(membersOfWork(run)).toEqual([
			{ series_id: 20, position: 1 },
			{ series_id: 21, position: 2 }
		]);
		expect(db.prepare(`SELECT name FROM works WHERE id = ?`).get(run)).toEqual({
			name: 'Unrelated'
		});
		// The taken season is a series of its own again, with its own row.
		expect(seriesRowOf(102)).toMatchObject({
			title: "Frieren: Beyond Journey's End Season 2",
			path: ''
		});
		expect(db.prepare(`SELECT COUNT(*) AS n FROM work_series WHERE series_id = 102`).get()).toEqual(
			{
				n: 0
			}
		);
	});
});

describe('the owner-action table (round 3)', () => {
	it('puts a Work’s order back when the owner reordered it while merged', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		expect(membersOfWork(run)).toEqual([
			{ series_id: 101, position: 1 },
			{ series_id: 11, position: 3 }
		]);
		works.reorder(run, [11, 101]);
		books.ungroupSeasons(101, NOW);
		expect(membersOfWork(run)).toEqual([
			{ series_id: 101, position: 1 },
			{ series_id: 102, position: 2 },
			{ series_id: 11, position: 3 }
		]);
	});

	it('leaves the show in the Work the owner added it to while merged', () => {
		const { older, run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		works.addSeries(older, 101);
		// The add ended Work 2, and the outside member went with it.
		expect(db.prepare(`SELECT 1 FROM works WHERE id = ?`).get(run)).toBeUndefined();
		books.ungroupSeasons(101, NOW);
		// The owner's add is theirs; the journal's Work comes back with the
		// members the owner left it (round 4).
		expect(membersOfWork(run)).toEqual([
			{ series_id: 102, position: 2 },
			{ series_id: 11, position: 3 }
		]);
		expect(membersOfWork(older)).toEqual([
			{ series_id: 9, position: 1 },
			{ series_id: 10, position: 2 },
			{ series_id: 101, position: 3 }
		]);
	});

	it('puts the show back in its Work when the owner took it out while merged', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		works.takeOut(run, 101);
		expect(db.prepare(`SELECT 1 FROM works WHERE id = ?`).get(run)).toBeUndefined();
		books.ungroupSeasons(101, NOW);
		expect(membersOfWork(run)).toEqual([
			{ series_id: 101, position: 1 },
			{ series_id: 102, position: 2 },
			{ series_id: 11, position: 3 }
		]);
	});

	it('puts the show back whole-hidden when the owner took it out and hid it', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		works.takeOutAndHide([101]);
		books.ungroupSeasons(101, NOW);
		expect(membersOfWork(run)).toEqual([
			{ series_id: 101, position: 1 },
			{ series_id: 102, position: 2 },
			{ series_id: 11, position: 3 }
		]);
		// A Work is hidden whole: the outside member cannot be left visible
		// among the seasons the owner hid.
		for (const id of [101, 102, 11]) expect(seriesRowOf(id)).toMatchObject({ hidden: 1 });
	});

	it('puts a Work’s rating back when the owner rated it while merged', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		// The Work's parts must agree before it can be rated whole.
		library.setRating([11], 9);
		works.setWorkRating(run, 3);
		books.ungroupSeasons(101, NOW);
		expect(seriesRowOf(101)).toMatchObject({ rating: 6 });
		expect(seriesRowOf(102)).toMatchObject({ rating: 9 });
	});

	it('puts a Work’s FAV back when the owner set it while merged', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		library.setFavourite([11], true);
		works.setWorkFavourite(run, false);
		books.ungroupSeasons(101, NOW);
		expect(seriesRowOf(101)).toMatchObject({ favourite: 0 });
		expect(seriesRowOf(102)).toMatchObject({ favourite: 1 });
	});

	it('keeps a Work hidden whole through the undo', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		works.hideWork(run, true);
		books.ungroupSeasons(101, NOW);
		for (const id of [101, 102, 11]) expect(seriesRowOf(id)).toMatchObject({ hidden: 1 });
	});

	it('keeps a Work shown whole through the undo', () => {
		const { run } = twoWorks();
		library.setHidden([9, 10, 101, 102, 11], true);
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		works.hideWork(run, false);
		books.ungroupSeasons(101, NOW);
		for (const id of [101, 102, 11]) expect(seriesRowOf(id)).toMatchObject({ hidden: 0 });
	});

	it('drops a rename of the show, as the journal’s title wins', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		seriesDoors.renameSeries(101, 'A New Name');
		books.ungroupSeasons(101, NOW);
		expect(titlesOf()).toEqual([
			{ id: 101, title: "Frieren: Beyond Journey's End" },
			{ id: 102, title: "Frieren: Beyond Journey's End Season 2" },
			{ id: 103, title: "Frieren: Beyond Journey's End Season 3" }
		]);
	});

	it('drops a rating and a FAV of the show, as the journal’s win', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		library.setRating([101], 3);
		library.setFavourite([101], false);
		books.ungroupSeasons(101, NOW);
		expect(seriesRowOf(101)).toMatchObject({ rating: 6, favourite: 0 });
		expect(seriesRowOf(102)).toMatchObject({ rating: 9, favourite: 1 });
		expect(seriesRowOf(103)).toMatchObject({ rating: 7, favourite: 0 });
	});

	it('drops a tag and a shelf of the show, as the journal’s win', () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		seriesDoors.addTag(101, { namespace: 'genre', value: 'isekai' });
		library.setInCollection([101], 1, true);
		books.ungroupSeasons(101, NOW);
		expect(
			db
				.prepare(
					`SELECT st.series_id, t.namespace, t.value FROM series_tags st
					JOIN tags t ON t.id = st.tag_id ORDER BY st.series_id, t.value`
				)
				.all()
		).toEqual([
			{ series_id: 101, namespace: 'genre', value: 'fantasy' },
			{ series_id: 102, namespace: 'studio', value: 'Madhouse' },
			{ series_id: 103, namespace: 'genre', value: 'fantasy' }
		]);
		expect(db.prepare(`SELECT series_id FROM collection_series ORDER BY series_id`).all()).toEqual([
			{ series_id: 102 },
			{ series_id: 103 }
		]);
	});

	it('keeps a MARK READ THROUGH made while merged on its own season', () => {
		const e = episodeIds();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		seriesDoors.markReadThrough(101, e.s2e2, at(10));
		books.ungroupSeasons(101, NOW);
		expect(db.prepare(`SELECT series_id, read_at FROM entries WHERE id = ?`).get(e.s2e2)).toEqual({
			series_id: 102,
			read_at: at(10)
		});
		// The log rides with the entry's season.
		expect(
			db
				.prepare(`SELECT series_id FROM reading_events WHERE entry_id = ? AND kind = 'mark_read'`)
				.all(e.s2e2)
		).toEqual([{ series_id: 102 }]);
	});

	it('keeps a reading event made while merged on its own season', () => {
		const e = episodeIds();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		seriesDoors.recordReading({
			seriesId: 101,
			entryId: e.s3e1,
			kind: 'page',
			page: 300,
			now: at(10)
		});
		books.ungroupSeasons(101, NOW);
		expect(
			db
				.prepare(`SELECT series_id, page FROM reading_events WHERE entry_id = ? AND kind = 'page'`)
				.all(e.s3e1)
		).toEqual([{ series_id: 103, page: 300 }]);
		expect(
			db.prepare(`SELECT series_id, last_position FROM entries WHERE id = ?`).get(e.s3e1)
		).toEqual({
			series_id: 103,
			last_position: 300
		});
	});

	it('deletes the show and the ids it held, with no journal left to undo', async () => {
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		// The series screen's DELETE: the journal cascades with the show, and the
		// reservations' trigger takes the placeholders away. There is nothing
		// left to undo, which is what DELETE says.
		await deleteSeries([101], true, { now: NOW });
		expect(
			db.prepare(`SELECT id FROM series WHERE id IN (101, 102, 103) ORDER BY id`).all()
		).toEqual([]);
		expect(db.prepare(`SELECT COUNT(*) AS n FROM season_merges`).get()).toEqual({ n: 0 });
		expect(db.prepare(`SELECT COUNT(*) AS n FROM season_reservations`).get()).toEqual({ n: 0 });
	});

	it('leaves an episode deleted while merged gone, and the rest back', async () => {
		const e = episodeIds();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		// The series screen's DELETE on a book's sheet; no file moves, since the
		// seed's paths are empty.
		await deleteBook(101, e.s2e2, true, { now: NOW });
		expect(db.prepare(`SELECT 1 FROM entries WHERE id = ?`).get(e.s2e2)).toBeUndefined();
		expect(() => books.ungroupSeasons(101, NOW)).not.toThrow();
		expect(db.prepare(`SELECT 1 FROM entries WHERE id = ?`).get(e.s2e2)).toBeUndefined();
		expect(db.prepare(`SELECT series_id FROM entries WHERE id = ?`).get(e.s1e1)).toEqual({
			series_id: 101
		});
		expect(db.prepare(`SELECT series_id FROM entries WHERE id = ?`).get(e.s3e1)).toEqual({
			series_id: 103
		});
	});
});

/**
 * A Work the owner makes while the show is merged is not the merge's: the undo
 * puts the journal's membership back only where the series is in no Work or
 * still in the Work the journal names. Taking a series out of a Work the owner
 * made since would delete or break it (round 4).
 */
describe('a Work made while merged (round 4)', () => {
	const olderRows = [
		{ work_id: 1, name: 'Older', made: at(5), series_id: 9, position: 1 },
		{ work_id: 1, name: 'Older', made: at(5), series_id: 10, position: 2 }
	];

	it('does not take the show’s outside member out of the Work the owner made of it', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		const shorts = works.createWork({ seriesIds: [11, 20], name: 'Shorts', now: at(7) });
		expect(shorts.work.id).toBe(3);
		books.ungroupSeasons(101, NOW);
		expect(workTable()).toEqual([
			...olderRows,
			{ work_id: 2, name: 'Run', made: at(6), series_id: 101, position: 1 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 102, position: 2 },
			{ work_id: 3, name: 'Shorts', made: at(7), series_id: 11, position: 1 },
			{ work_id: 3, name: 'Shorts', made: at(7), series_id: 20, position: 2 }
		]);
		void run;
	});

	it('leaves a Work of three the owner made around the show’s outsider whole', () => {
		twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		works.createWork({ seriesIds: [11, 20, 21], name: 'Shorts', now: at(7) });
		books.ungroupSeasons(101, NOW);
		expect(workTable()).toEqual([
			...olderRows,
			{ work_id: 2, name: 'Run', made: at(6), series_id: 101, position: 1 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 102, position: 2 },
			{ work_id: 3, name: 'Shorts', made: at(7), series_id: 11, position: 1 },
			{ work_id: 3, name: 'Shorts', made: at(7), series_id: 20, position: 2 },
			{ work_id: 3, name: 'Shorts', made: at(7), series_id: 21, position: 3 }
		]);
	});

	it('leaves a Work the owner made around the show itself alone', () => {
		twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		works.createWork({ seriesIds: [101, 20], name: 'X', now: at(7) });
		books.ungroupSeasons(101, NOW);
		// The show goes back where the journal had it; the Work the owner made
		// around the show keeps the series it holds.
		expect(workTable()).toEqual([
			...olderRows,
			{ work_id: 2, name: 'Run', made: at(6), series_id: 102, position: 2 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 11, position: 3 },
			{ work_id: 3, name: 'X', made: at(7), series_id: 101, position: 1 },
			{ work_id: 3, name: 'X', made: at(7), series_id: 20, position: 2 }
		]);
	});
});

/**
 * The first-season take-out hands the show to the next season; a Work action
 * made while merged must not stop it (round 4's red: an ended Work took the
 * reinserted membership with it and the whole undo rolled back).
 */
describe('the first-season take-out after a Work action (round 4)', () => {
	const olderRows = [
		{ work_id: 1, name: 'Older', made: at(5), series_id: 9, position: 1 },
		{ work_id: 1, name: 'Older', made: at(5), series_id: 10, position: 2 }
	];

	it('takes the first out after the owner made a Work around the show', () => {
		twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		works.createWork({ seriesIds: [101, 20], name: 'X', now: at(7) });
		expect(() => books.takeOutSeason(101, 1, NOW)).not.toThrow();
		// The owner's Work follows the show, as its shelves do: X holds the season
		// that now is the show, at the place the first season had, and 101 is in no
		// Work. Run cannot stay with one member (11), so it ends here for good:
		// the journal's next undo can only bring 11 back (102 is in X, the owner's
		// Work), so the reservation holds an id nothing will use again.
		expect(workTable()).toEqual([
			...olderRows,
			{ work_id: 2, name: 'Run', made: at(6), series_id: null, position: null },
			{ work_id: 3, name: 'X', made: at(7), series_id: 102, position: 1 },
			{ work_id: 3, name: 'X', made: at(7), series_id: 20, position: 2 }
		]);
		expect(db.prepare(`SELECT 1 FROM work_series WHERE series_id = 101`).get()).toBeUndefined();

		// Measured: the show's UNGROUP leaves Run gone and 11 in no Work. The
		// placeholder goes with the journal, and nothing was ever going to rebuild
		// it (the low this pins).
		books.ungroupSeasons(102, at(8));
		expect(workTable()).toEqual([
			...olderRows,
			{ work_id: 3, name: 'X', made: at(7), series_id: 102, position: 1 },
			{ work_id: 3, name: 'X', made: at(7), series_id: 20, position: 2 }
		]);
		expect(db.prepare(`SELECT 1 FROM work_series WHERE series_id = 11`).get()).toBeUndefined();
	});

	it('takes the first out after the owner added the show to another Work', () => {
		const { older } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		works.addSeries(older, 101, at(5));
		expect(() => books.takeOutSeason(101, 1, NOW)).not.toThrow();
		// The Work the show was added to follows it too: Older keeps the show, as
		// the season that now holds it, in the same place.
		expect(workTable()).toEqual([
			{ work_id: 1, name: 'Older', made: at(5), series_id: 9, position: 1 },
			{ work_id: 1, name: 'Older', made: at(5), series_id: 10, position: 2 },
			{ work_id: 1, name: 'Older', made: at(5), series_id: 102, position: 3 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: null, position: null }
		]);
	});

	it('cannot be reached: a merged season is no series a Work may take', () => {
		twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		works.createWork({ seriesIds: [101, 20], name: 'X', now: at(7) });
		// The season that would hold the show after the take-out is a placeholder
		// while merged: out of the library and hidden, so neither kind of door
		// will put it in a Work the owner made. The follow's own guard (a Work
		// other than the journal's) is therefore not reachable through a door;
		// this is the measurement, and the guard stays as a cheap refusal.
		expect(() => works.createWork({ seriesIds: [102, 21], name: 'Y', now: at(8) })).toThrow(
			/hidden and visible|browsing record/
		);
		expect(() => works.addSeries(3, 102, at(7))).toThrow(/browsing record|hidden and visible/);
		expect(db.prepare(`SELECT 1 FROM work_series WHERE series_id = 102`).get()).toBeUndefined();
	});

	it('takes the first out after the owner took the show out of its Work', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		works.takeOut(run, 101);
		expect(() => books.takeOutSeason(101, 1, NOW)).not.toThrow();
		expect(workTable()).toEqual([
			...olderRows,
			{ work_id: 2, name: 'Run', made: at(6), series_id: 101, position: 1 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 102, position: 2 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 11, position: 3 }
		]);
	});

	it('takes the first out after the owner reordered the Work', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		works.reorder(run, [11, 101]);
		expect(() => books.takeOutSeason(101, 1, NOW)).not.toThrow();
		expect(workTable()).toEqual([
			...olderRows,
			{ work_id: 2, name: 'Run', made: at(6), series_id: 101, position: 1 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 102, position: 2 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 11, position: 3 }
		]);
	});

	it('takes the first out after the owner renamed the Work', () => {
		const { run, made } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		works.rename(run, 'Run, renamed', made);
		expect(() => books.takeOutSeason(101, 1, NOW)).not.toThrow();
		expect(workTable()).toEqual([
			...olderRows,
			{ work_id: 2, name: 'Run, renamed', made, series_id: 101, position: 1 },
			{ work_id: 2, name: 'Run, renamed', made, series_id: 102, position: 2 },
			{ work_id: 2, name: 'Run, renamed', made, series_id: 11, position: 3 }
		]);
	});
});

/**
 * A season taken out of the journal is no longer the merge's; the show's later
 * UNGROUP must not reach it, nor a Work the owner made of it (round 4).
 */
describe('a taken-out season and the journal (round 4)', () => {
	it('does not pull it back out of the Work the owner made of it', () => {
		twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		expect(books.takeOutSeason(101, 2, NOW)).toBe(102);
		const y = works.createWork({ seriesIds: [102, 21], name: 'Y', now: at(7) });
		expect(y.work.id).toBe(3);
		books.ungroupSeasons(101, NOW);
		expect(workTable()).toEqual([
			{ work_id: 1, name: 'Older', made: at(5), series_id: 9, position: 1 },
			{ work_id: 1, name: 'Older', made: at(5), series_id: 10, position: 2 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 101, position: 1 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 11, position: 3 },
			{ work_id: 3, name: 'Y', made: at(7), series_id: 102, position: 1 },
			{ work_id: 3, name: 'Y', made: at(7), series_id: 21, position: 2 }
		]);
	});

	it('does not carry a hide to a season the owner grouped out of the show', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		books.takeOutSeason(101, 2, NOW);
		works.createWork({ seriesIds: [102, 21], name: 'Y', now: at(7) });
		// The owner hides the show's Work while merged; a Work is hidden whole,
		// but the season the owner grouped out of the show is not the show's.
		works.hideWork(run, true);
		books.ungroupSeasons(101, NOW);
		expect(membersOfWork(3)).toEqual([
			{ series_id: 102, position: 1 },
			{ series_id: 21, position: 2 }
		]);
		expect(seriesRowOf(102)).toMatchObject({ hidden: 0 });
		expect(seriesRowOf(21)).toMatchObject({ hidden: 0 });
		expect(seriesRowOf(101)).toMatchObject({ hidden: 1 });
		expect(seriesRowOf(11)).toMatchObject({ hidden: 1 });
	});

	it('does not put a taken-out season back into the Work the owner removed it from', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102, 103], now: NOW });
		books.takeOutSeason(101, 2, NOW);
		works.takeOut(run, 102);
		expect(db.prepare(`SELECT 1 FROM work_series WHERE series_id = 102`).get()).toBeUndefined();
		// The show's next undo still holds the journal of the merge, but the
		// season left it: it is not put back into the Work.
		books.takeOutSeason(101, 1, NOW);
		expect(workTable()).toEqual([
			{ work_id: 1, name: 'Older', made: at(5), series_id: 9, position: 1 },
			{ work_id: 1, name: 'Older', made: at(5), series_id: 10, position: 2 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 101, position: 1 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 11, position: 3 }
		]);
		expect(db.prepare(`SELECT 1 FROM work_series WHERE series_id = 102`).get()).toBeUndefined();
	});
});

/**
 * A journal member whose series is gone at UNGROUP time. The journal holds what
 * was true at the merge, and a `deleteSeries` while merged takes the outsider's
 * row (and its `work_series` row, cascading). The undo cannot bring it back, so
 * counting it would put the Work back with one member, which the schema's own
 * trigger forbids (round 5).
 */
describe('a Work’s member deleted while merged (round 5)', () => {
	const olderRows = [
		{ work_id: 1, name: 'Older', made: at(5), series_id: 9, position: 1 },
		{ work_id: 1, name: 'Older', made: at(5), series_id: 10, position: 2 }
	];

	it('leaves the Work ended when its only other member is gone', async () => {
		const { run } = twoWorks();
		// The owner took the season out of its Work before the merge, so Run is
		// the show and one outside member: [101@1, 11@3].
		db.prepare(`DELETE FROM work_series WHERE work_id = ? AND series_id = 102`).run(run);
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		await deleteSeries([11], true, { now: NOW });
		// The delete left Run with one member, so `series_deleted_ends_work` ended it.
		expect(db.prepare(`SELECT 1 FROM works WHERE id = ?`).get(run)).toBeUndefined();

		books.ungroupSeasons(101, NOW);

		expect(workTable()).toEqual(olderRows);
		expect(db.prepare(`SELECT 1 FROM work_series WHERE work_id = ?`).all(run)).toEqual([]);
		expect(titlesOf()).toEqual([
			{ id: 101, title: "Frieren: Beyond Journey's End" },
			{ id: 102, title: "Frieren: Beyond Journey's End Season 2" },
			{ id: 103, title: "Frieren: Beyond Journey's End Season 3" }
		]);
	});

	it('brings a Work of four back with the three members that still exist', async () => {
		const { run } = twoWorks();
		works.addSeries(run, 20, at(6));
		expect(membersOfWork(run)).toEqual([
			{ series_id: 101, position: 1 },
			{ series_id: 102, position: 2 },
			{ series_id: 11, position: 3 },
			{ series_id: 20, position: 4 }
		]);
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		await deleteSeries([11], true, { now: NOW });
		// The outsider's row went with it; the show and the other outsider are two,
		// so the trigger left Run standing.
		expect(db.prepare(`SELECT 1 FROM works WHERE id = ?`).get(run)).toBeTruthy();

		books.ungroupSeasons(101, NOW);

		expect(workTable()).toEqual([
			...olderRows,
			{ work_id: 2, name: 'Run', made: at(6), series_id: 101, position: 1 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 102, position: 2 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 20, position: 4 }
		]);
		expect(db.prepare(`SELECT 1 FROM series WHERE id = 11`).get()).toBeUndefined();
	});

	// These two are **pins, not proofs** (round 2's low 7): a two-season merge
	// takes the `restoreAll` path, which ends a Work of one with the global
	// `endWorksOfOne`, so they pass with or without `planWorkMembers`' count.
	// They still pin the state a later wave must not break.
	it('pins the Work ended through the later take-out', async () => {
		const { run } = twoWorks();
		db.prepare(`DELETE FROM work_series WHERE work_id = ? AND series_id = 102`).run(run);
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		await deleteSeries([11], true, { now: NOW });
		expect(books.takeOutSeason(101, 2, NOW)).toBe(102);
		expect(workTable()).toEqual(olderRows);
		expect(db.prepare(`SELECT 1 FROM series WHERE id = 102`).get()).toBeTruthy();
	});

	it('pins the Work ended through the first-season take-out', async () => {
		const { run } = twoWorks();
		db.prepare(`DELETE FROM work_series WHERE work_id = ? AND series_id = 102`).run(run);
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		await deleteSeries([11], true, { now: NOW });
		expect(books.takeOutSeason(101, 1, NOW)).toBe(101);
		// The show is now 102; the taken-out first season is alone, and Run cannot
		// come back: the only member it had left is the one just taken out.
		expect(workTable()).toEqual(olderRows);
		expect(db.prepare(`SELECT 1 FROM series WHERE id IN (101, 102)`).all()).toHaveLength(2);
	});

	it('leaves the Work ended when the outsider’s last book is deleted', async () => {
		const { run } = twoWorks();
		const ep = episode(11, 1, 1, 'no');
		db.prepare(`DELETE FROM work_series WHERE work_id = ? AND series_id = 102`).run(run);
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		await deleteBook(11, ep, true, { now: NOW });
		expect(db.prepare(`SELECT 1 FROM series WHERE id = 11`).get()).toBeUndefined();
		books.ungroupSeasons(101, NOW);
		expect(workTable()).toEqual(olderRows);
	});

	it('leaves the Work ended when the outsider is emptied by a take-out', () => {
		const { run } = twoWorks();
		const ep = episode(11, 1, 1, 'no');
		db.prepare(`DELETE FROM work_series WHERE work_id = ? AND series_id = 102`).run(run);
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		books.takeOut(11, [ep], NOW);
		expect(db.prepare(`SELECT 1 FROM series WHERE id = 11`).get()).toBeUndefined();
		books.ungroupSeasons(101, NOW);
		expect(workTable()).toEqual(olderRows);
	});

	it('leaves the Work ended when the outsider is folded into another series', () => {
		const { run } = twoWorks();
		db.prepare(`DELETE FROM work_series WHERE work_id = ? AND series_id = 102`).run(run);
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		foldSeries(db, 11, 9);
		expect(db.prepare(`SELECT 1 FROM series WHERE id = 11`).get()).toBeUndefined();
		books.ungroupSeasons(101, NOW);
		expect(workTable()).toEqual(olderRows);
	});

	it('a rescan deletes neither a season nor a Work’s outsider', () => {
		const { run } = twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		// A re-import is a door, and `prunePageless` is the one that deletes a row
		// without being asked: the absorbed season is a placeholder (rated 1,
		// favourite 1, out of the library) and the outsider is in a Work, so both
		// guards hold and neither is touched.
		prunePageless(db, 1, '/lib/Anime', new Set());
		expect(db.prepare(`SELECT 1 FROM series WHERE id = 102`).get()).toBeTruthy();
		expect(db.prepare(`SELECT 1 FROM series WHERE id = 11`).get()).toBeTruthy();
		books.ungroupSeasons(101, NOW);
		expect(membersOfWork(run)).toEqual([
			{ series_id: 101, position: 1 },
			{ series_id: 102, position: 2 },
			{ series_id: 11, position: 3 }
		]);
	});

	it('leaves the Work whole when a book outsider is grouped into another series', () => {
		const { run } = twoWorks();
		// A book outsider (GROUP's own door binds books) and the series it would
		// join, both under the same root.
		for (const [id, title, key] of [
			[30, 'A Book', 'mihon:1:/book'],
			[31, 'A Book 2', 'mihon:1:/book-2']
		] as [number, string, string][])
			insert(
				`INSERT INTO series (id, root_id, title, kind, rating, favourite, hidden, hue, added_at,
					indexed_at, source, path, origin_key, public, in_library)
				VALUES (?, 1, ?, 'doujin', 0, 0, 0, 1, ?, ?, 'Hentoid', '', ?, 1, 1)`,
				[id, title, at(1), at(1), key]
			);
		insert(
			`INSERT INTO entries (id, series_id, position, label, title, added_at, source_url)
			VALUES (?, 30, 1, 'Book', '', ?, '/book/30')`,
			[bump(), at(1)]
		);
		insert(
			`INSERT INTO entries (id, series_id, position, label, title, added_at, source_url)
			VALUES (?, 31, 1, 'Book', '', ?, '/book/31')`,
			[bump(), at(1)]
		);
		works.addSeries(run, 30, at(6));
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		books.groupIntoSeries({ seriesIds: [30], into: 31, now: NOW });
		expect(db.prepare(`SELECT 1 FROM series WHERE id = 30`).get()).toBeUndefined();

		books.ungroupSeasons(101, NOW);

		expect(workTable()).toEqual([
			...olderRows,
			{ work_id: 2, name: 'Run', made: at(6), series_id: 101, position: 1 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 102, position: 2 },
			{ work_id: 2, name: 'Run', made: at(6), series_id: 11, position: 3 }
		]);
	});
});

/**
 * A journal member that is a placeholder when the undo runs: a second merge
 * absorbed the outsider into its own show, and its row is held for that
 * merge's undo (`reserve_at` set, hidden, out of the library). It is no
 * series the undo may put back -- its own journal restores it -- so counting
 * it would rebuild a Work of one around a hidden placeholder (round 6).
 */
describe('a placeholder in a journal’s Work (round 6)', () => {
	const olderRows = [
		{ work_id: 1, name: 'Older', made: at(5), series_id: 9, position: 1 },
		{ work_id: 1, name: 'Older', made: at(5), series_id: 10, position: 2 }
	];
	const runRows = (members: { series_id: number; position: number }[]) =>
		members.map((m) => ({ work_id: 2, name: 'Run', made: at(6), ...m }));
	/** No Work names a series held open for a merge: it is no library row. */
	const placeholderRows = () =>
		db
			.prepare(
				`SELECT ws.work_id, ws.series_id FROM work_series ws
				JOIN series s ON s.id = ws.series_id WHERE s.reserve_at IS NOT NULL`
			)
			.all();

	/** The red's setup: Run = [101, 11], the first show absorbs 102, then a second absorbs 11. */
	function secondShowTakesTheOutsider() {
		const { run } = twoWorks();
		db.prepare(`DELETE FROM work_series WHERE work_id = ? AND series_id = 102`).run(run);
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		books.mergeSeasons({ seriesIds: [20, 11], now: at(6) });
		expect(workTable()).toEqual([
			...olderRows,
			...runRows([
				{ series_id: 101, position: 1 },
				{ series_id: 20, position: 4 }
			])
		]);
		works.takeOut(run, 20, at(6));
		// Run is left with the show alone, so `series_deleted_ends_work` did not
		// fire and the take-out's own `endIfOne` ended it.
		expect(workTable()).toEqual(olderRows);
		return run;
	}

	it('keeps the Work ended until the second show’s UNGROUP gives its member back', () => {
		const run = secondShowTakesTheOutsider();
		books.ungroupSeasons(101, NOW);
		// 11 is the second show's placeholder: it is no member, so Run cannot come
		// back with two, and it must not come back with one.
		expect(workTable()).toEqual(olderRows);
		expect(db.prepare(`SELECT 1 FROM work_series WHERE work_id = ?`).all(run)).toEqual([]);
		expect(placeholderRows()).toEqual([]);

		books.ungroupSeasons(20, at(7));
		// 11 is a series again, and the second merge's journal puts its membership
		// back: Run is whole, at its places.
		expect(workTable()).toEqual([
			...olderRows,
			...runRows([
				{ series_id: 101, position: 1 },
				{ series_id: 11, position: 3 }
			])
		]);
		expect(placeholderRows()).toEqual([]);
	});

	it('brings the Work back at the second show’s UNGROUP, in the other order', () => {
		secondShowTakesTheOutsider();
		books.ungroupSeasons(20, at(7));
		// The second merge's journal restores the Work it read and 11's place in it.
		expect(workTable()).toEqual([
			...olderRows,
			...runRows([
				{ series_id: 101, position: 1 },
				{ series_id: 11, position: 3 }
			])
		]);
		expect(placeholderRows()).toEqual([]);

		books.ungroupSeasons(101, NOW);
		expect(workTable()).toEqual([
			...olderRows,
			...runRows([
				{ series_id: 101, position: 1 },
				{ series_id: 11, position: 3 }
			])
		]);
		expect(placeholderRows()).toEqual([]);
	});

	it('never puts the placeholder into the Work when the Work was not ended', () => {
		// Run holds both seasons and the outsider at the first merge, so 102's own
		// snapshot is a member the undo puts back.
		twoWorks();
		books.mergeSeasons({ seriesIds: [101, 102], now: NOW });
		books.mergeSeasons({ seriesIds: [20, 11], now: at(6) });
		expect(workTable()).toEqual([
			...olderRows,
			...runRows([
				{ series_id: 101, position: 1 },
				{ series_id: 20, position: 4 }
			])
		]);

		books.ungroupSeasons(101, NOW);

		// 102 comes back with its own snapshot row (it was in Run at the merge),
		// and 11 is still the second show's placeholder: the Work keeps three
		// real members and no placeholder.
		expect(workTable()).toEqual([
			...olderRows,
			...runRows([
				{ series_id: 101, position: 1 },
				{ series_id: 102, position: 2 },
				{ series_id: 20, position: 4 }
			])
		]);
		expect(placeholderRows()).toEqual([]);
		expect(db.prepare(`SELECT hidden FROM series WHERE id = 11`).get()).toEqual({ hidden: 1 });

		books.ungroupSeasons(20, at(7));
		// 20 was in no Work before the second merge (that merge put it in Run), so
		// the journal's word takes it out again and 11 takes its place.
		expect(workTable()).toEqual([
			...olderRows,
			...runRows([
				{ series_id: 101, position: 1 },
				{ series_id: 102, position: 2 },
				{ series_id: 11, position: 3 }
			])
		]);
		expect(placeholderRows()).toEqual([]);
	});
});

/**
 * The show line's read (round 2's low 8): the library and the search ask for
 * every tile they draw, so `showRowFacts` narrows to the kinds whose seasons
 * can merge before its per-tile queries. A manga is never a season.
 */
describe('the show line’s read (round 2)', () => {
	it('answers only for a kind whose seasons can merge', () => {
		const manga = insert(
			`INSERT INTO series (id, root_id, title, kind, rating, favourite, hidden, hue, added_at,
				indexed_at, source, path, origin_key, public, in_library)
			VALUES (200, 1, 'A Manga', 'manga', 0, 0, 0, 1, ?, ?, 'Mihon', '', 'mihon:1:/m', 1, 1)`,
			[at(1), at(1)]
		);
		insert(
			`INSERT INTO entries (id, series_id, position, label, title, added_at, source_url, available)
			VALUES (?, 200, 1, 'Ch. 1', '', ?, '/m/1', 1)`,
			[bump(), at(1)]
		);
		expect(Object.keys(facts.showRowFacts([101, manga], true))).toEqual(['101']);
	});
});
