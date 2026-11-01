import { beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const move = await import('$lib/server/move');
const series = await import('$lib/server/series');
const library = await import('$lib/server/library');
const { writeSeries } = await import('$lib/server/import/write');

/**
 * MOVE as one transaction (doc/MOVE.md; card c139): what it re-keys, what it
 * keeps, what it adds, what it leaves in the queue, and the way back. The
 * source answers are fabricated here; nothing reaches a network.
 */

const NOW = Date.UTC(2026, 10, 1, 12);

let manga = 0;
let extraEntry = 0;
let readEntry = 0;
let keptQueueEntry = 0;
let anime = 0;
let root = 0;

function source(db: Database.Database, id: string, pkg: string, name: string) {
	db.prepare(
		`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
		VALUES (?, ?, 'manga', 1, '1', '1', ?, 0, 0, '')`
	).run(pkg, name, `${pkg}`.padEnd(64, '0'));
	db.prepare(
		`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', '')`
	).run(id, pkg, name);
}

function candidate(
	n: number,
	season: number | null = null,
	url = `/c${n}`
): import('$lib/library/move').MoveCandidateEntry {
	return {
		number: n,
		season,
		title: `Chapter ${n}`,
		url,
		name: `Chapter ${n}`,
		uploaded: NOW,
		order: n
	};
}

/** The old source's own addresses, which is what MOVE BACK maps back to. */
const oldCandidate = (n: number) => candidate(n, null, `/old/c${n}`);

beforeAll(() => {
	const db = getDb();
	root = Number(
		db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Library', '/l', 0)`).run()
			.lastInsertRowid
	);
	source(db, '100', 'e2e.asura', 'Asura Scans');
	source(db, '200', 'e2e.weeb', 'Weeb Central');
	manga = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, source, status, added_at, indexed_at, origin_key, followed_at)
				VALUES (?, 'Movenberg Heir', 'manga', 'mihon', 'ongoing', ?, ?, 'mihon:100:/old', ?)`
			)
			.run(root, NOW, NOW, NOW - 1000).lastInsertRowid
	);
	const entry = db.prepare(
		`INSERT INTO entries (series_id, position, label, title, added_at, read_at, last_position, available, file,
			bytes, page_count, source_url)
		VALUES (@series, @position, @label, @title, @added, @read, @at, @available, @file, 10, 10, @url)`
	);
	const put = (
		n: number,
		o: { read?: number | null; available?: number; file?: string; url?: string }
	) =>
		Number(
			entry.run({
				series: manga,
				position: n,
				label: `Ch. ${n}`,
				title: n === 4.5 ? 'Afterword' : '',
				added: NOW,
				read: o.read ?? null,
				at: o.read ? 4 : null,
				available: o.available ?? 0,
				file: o.file ?? '',
				url: o.url ?? `/old/c${n}`
			}).lastInsertRowid
		);
	readEntry = put(1, { read: NOW - 100, available: 1, file: 'Ch. 1.cbz' });
	keptQueueEntry = put(2, { read: NOW - 90, available: 1, file: 'Ch. 2.cbz' });
	put(3, {});
	put(4, {});
	extraEntry = put(4.5, { available: 1, file: 'Afterword.cbz' });
	const chapter = db.prepare(
		`INSERT INTO engine_chapters (entry_id, engine_url, name) VALUES (?, ?, ?)`
	);
	for (const n of [1, 2, 3, 4, 4.5]) chapter.run(putId(n), `/old/c${n}`, `Chapter ${n}`);
	const queue = db.prepare(
		`INSERT INTO download_queue (entry_id, series_id, position, state, queued_at) VALUES (?, ?, ?, 'queued', ?)`
	);
	queue.run(keptQueueEntry, manga, 1, NOW);
	queue.run(extraEntry, manga, 2, NOW);
	db.prepare(
		`INSERT INTO reading_events (at, series_id, entry_id, kind, page) VALUES (?, ?, ?, 'page', 4)`
	).run(NOW - 100, manga, readEntry);
	db.prepare(
		`INSERT INTO engine_series (series_id, source_id, engine_url, title, resolved_at)
		VALUES (?, '100', '/old', 'Movenberg Heir', ?)`
	).run(manga, NOW - 60_000);

	// An anime with a season, for the NO VIDEO band and the player's line.
	anime = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, source, status, added_at, indexed_at, origin_key)
				VALUES (?, 'Movenberg Animation', 'anime', 'AnimePahe', 'ongoing', ?, ?, 'aniyomi:300:/show/a')`
			)
			.run(root, NOW, NOW).lastInsertRowid
	);
	for (let n = 1; n <= 4; n++)
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, season, episode_number, available)
			VALUES (?, ?, ?, ?, 2, ?, 0)`
		).run(anime, n, `Ep. ${n}`, NOW, n);

	function putId(n: number): number {
		return Number(
			(
				db.prepare(`SELECT id FROM entries WHERE series_id = ? AND position = ?`).get(manga, n) as {
					id: number;
				}
			).id
		);
	}
});

const row = (id: number) =>
	getDb()
		.prepare(
			`SELECT origin_key, former_key, former_at, former_source, source, followed_at, move_dismissed_at
			FROM series WHERE id = ?`
		)
		.get(id) as {
		origin_key: string;
		former_key: string | null;
		former_at: number | null;
		former_source: string;
		source: string;
		followed_at: number | null;
		move_dismissed_at: number | null;
	};

const entry = (id: number) =>
	getDb()
		.prepare(
			`SELECT id, position, source_url, former_url, origin_source, read_at, available, file, season,
				episode_number, title
			FROM entries WHERE id = ?`
		)
		.get(id) as {
		id: number;
		position: number;
		source_url: string;
		former_url: string;
		origin_source: string;
		read_at: number | null;
		available: number;
		file: string;
		season: number | null;
		episode_number: number | null;
		title: string;
	};

const chapter = (id: number) =>
	getDb().prepare(`SELECT engine_url FROM engine_chapters WHERE entry_id = ?`).get(id) as
		{ engine_url: string } | undefined;

const added = () =>
	getDb()
		.prepare(
			`SELECT id, position, source_url, origin_source, read_at, available, season, episode_number
			FROM entries WHERE series_id = ? AND source_url IN ('/c0','/c6','/c7') ORDER BY position`
		)
		.all(manga) as {
		id: number;
		position: number;
		source_url: string;
		origin_source: string;
		read_at: number | null;
		available: number;
		season: number | null;
		episode_number: number | null;
	}[];

describe('MOVE', () => {
	it('re-keys the series, remembers where it came from, and changes nothing the owner owns', () => {
		const before = row(manga);
		const result = move.applyMove(
			manga,
			{ key: 'mihon:200:/new', source: 'Weeb Central', sourceId: '200', url: '/new' },
			[
				candidate(0),
				candidate(1),
				candidate(2),
				candidate(3),
				candidate(4),
				candidate(6),
				candidate(7)
			],
			{ now: NOW }
		);
		expect(result).toMatchObject({
			matched: 4,
			kept: 1,
			added: 3,
			queuedMoved: 1,
			queuedDropped: 1
		});
		expect(result.detail).toBe('3 CHAPTERS ADDED, NOT DOWNLOADED · 1 KEPT FROM ASURA SCANS');
		expect(row(manga)).toMatchObject({
			origin_key: 'mihon:200:/new',
			former_key: 'mihon:100:/old',
			former_at: NOW,
			former_source: 'Asura Scans',
			source: 'Weeb Central',
			followed_at: before.followed_at
		});
	});

	it('moves a matched chapter to the new source and keeps its reading and its file', () => {
		const e = entry(readEntry);
		expect(e).toMatchObject({
			source_url: '/c1',
			former_url: '/old/c1',
			origin_source: '',
			available: 1,
			file: 'Ch. 1.cbz',
			read_at: NOW - 100
		});
		expect(chapter(readEntry)?.engine_url).toBe('/c1');
	});

	it('keeps a chapter the new source lacks, says whose it is, and takes it out of the queue', () => {
		expect(entry(extraEntry)).toMatchObject({
			source_url: '/old/c4.5',
			origin_source: '100',
			available: 1,
			read_at: null
		});
		expect(
			getDb().prepare(`SELECT 1 FROM download_queue WHERE entry_id = ?`).get(extraEntry)
		).toBeUndefined();
		// The matched one that was queued stays queued, now for the new source.
		expect(
			getDb().prepare(`SELECT 1 FROM download_queue WHERE entry_id = ?`).get(keptQueueEntry)
		).toBeDefined();
	});

	it('adds what only the new source has, unread, not downloaded, from that source', () => {
		const rows = added();
		expect(
			rows.map((r) => [r.source_url, r.position, r.available, r.read_at, r.origin_source])
		).toEqual([
			['/c0', 0, 0, null, ''],
			['/c6', 6, 0, null, ''],
			['/c7', 7, 0, null, '']
		]);
		for (const r of rows) expect(chapter(r.id)?.engine_url).toBe(r.source_url);
		// The new source is where the series' own engine calls go.
		const engine = getDb()
			.prepare(`SELECT source_id, engine_url FROM engine_series WHERE series_id = ?`)
			.get(manga) as { source_id: string; engine_url: string };
		expect(engine).toEqual({ source_id: '200', engine_url: '/new' });
	});

	it('keeps the reading log where it was', () => {
		expect(
			(
				getDb()
					.prepare(`SELECT COUNT(*) AS n FROM reading_events WHERE series_id = ? AND entry_id = ?`)
					.get(manga, readEntry) as { n: number }
			).n
		).toBe(1);
	});

	it('offers MOVE BACK for 30 days, by the old source’s name', () => {
		expect(move.moveState(manga, NOW).former).toEqual({
			name: 'Asura Scans',
			until: NOW + 30 * 86_400_000
		});
		expect(move.moveState(manga, NOW + 31 * 86_400_000).former).toBeNull();
		expect(move.moveBackTarget(manga)).toEqual({
			key: 'mihon:100:/old',
			source: 'Asura Scans',
			sourceId: '100',
			url: '/old'
		});
	});

	it('moves back: reading carries, a fileful addition stays, a fileless one goes, and the way back flips', () => {
		// The new source added 0, 6 and 7 without files; give 6 one, as an owner
		// who downloaded it would have.
		const six = added().find((r) => r.source_url === '/c6')!;
		getDb()
			.prepare(`UPDATE entries SET available = 1, file = 'Ch. 6.cbz' WHERE id = ?`)
			.run(six.id);
		const result = move.applyMoveBack(
			manga,
			[oldCandidate(1), oldCandidate(2), oldCandidate(3), oldCandidate(4), oldCandidate(5)],
			{ now: NOW + 1000 }
		);
		expect(result.matched).toBe(4);
		// 4.5 and 6 stay; 0 and 7 have no file and go; 5 is on the old source and comes back.
		expect(entry(entry(readEntry).id).read_at).toBe(NOW - 100);
		// 4.5 was kept from the source we are going back to, so it is current again.
		expect(entry(extraEntry)).toMatchObject({ available: 1, origin_source: '' });
		expect(entry(six.id).origin_source).toBe('200');
		const left = getDb()
			.prepare(`SELECT source_url FROM entries WHERE series_id = ? ORDER BY position`)
			.all(manga) as { source_url: string }[];
		expect(left.map((r) => r.source_url)).toEqual([
			'/old/c1',
			'/old/c2',
			'/old/c3',
			'/old/c4',
			'/old/c4.5',
			'/old/c5',
			'/c6'
		]);
		expect(row(manga)).toMatchObject({
			origin_key: 'mihon:100:/old',
			former_key: 'mihon:200:/new',
			former_source: 'Weeb Central',
			source: 'Asura Scans'
		});
	});

	it('the tablet’s backup, which still names the old key, resolves to this series and adds nothing', () => {
		// The backup of the source just left (200): its key is `former_key`, its
		// chapters' addresses are `former_url`. The writer finds the one series
		// and every chapter in it, so no twin and no duplicated chapter.
		const before = (
			getDb().prepare(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ?`).get(manga) as {
				n: number;
			}
		).n;
		const result = writeSeries(
			{
				originKey: 'mihon:200:/new',
				source: 'mihon',
				title: 'Movenberg Heir',
				kind: 'manga',
				rating: 0,
				favourite: false,
				hidden: false,
				shelves: [],
				tags: [],
				description: '',
				status: '',
				direction: null,
				addedAt: NOW,
				sourceUrl: '/new',
				path: '',
				entries: [1, 2, 3, 4].map((n) => ({
					position: n,
					label: `Ch. ${n}`,
					title: '',
					sourceUrl: `/c${n}`,
					available: false,
					file: '',
					bytes: 0,
					pageCount: 0,
					addedAt: NOW,
					readAt: null,
					lastPosition: null,
					lastOpenedAt: null,
					history: null
				}))
			},
			{ rootId: root, jobId: null, now: NOW + 5000 }
		);
		expect(result.created).toBe(false);
		expect(result.entriesAdded).toBe(0);
		expect(
			(
				getDb().prepare(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ?`).get(manga) as {
					n: number;
				}
			).n
		).toBe(before);
		expect(
			(
				getDb()
					.prepare(`SELECT COUNT(*) AS n FROM series WHERE title = 'Movenberg Heir'`)
					.get() as { n: number }
			).n
		).toBe(1);
		// The key stays where the series moved to, not where the backup thinks it is.
		expect(row(manga).origin_key).toBe('mihon:100:/old');
	});

	it('is the same series the tablet’s backup still names, not a twin', () => {
		// A backup names the source it was downloaded from; after a move that is
		// `former_key` (rung 57). One series holds it, and no second appears.
		const count = () =>
			(
				getDb()
					.prepare(`SELECT COUNT(*) AS n FROM series WHERE title = 'Movenberg Heir'`)
					.get() as { n: number }
			).n;
		expect(count()).toBe(1);
		expect(
			getDb().prepare(`SELECT id FROM series WHERE former_key = 'mihon:200:/new'`).get()
		).toBeDefined();
	});
});

describe('a hidden series', () => {
	it('answers 404 outside reveal and is there inside it', () => {
		const before = series.seriesPage(manga, false);
		expect(before).not.toBeNull();
		library.setHidden([manga], true);
		expect(series.seriesPage(manga, false)).toBeNull();
		expect(series.seriesPage(manga, true)).not.toBeNull();
		library.setHidden([manga], false);
	});
});

describe('NO SERVER', () => {
	it('counts failures per episode into the band, NOT NOW hides it, and a new failure brings it back', () => {
		const ids = (
			getDb()
				.prepare(`SELECT id FROM entries WHERE series_id = ? ORDER BY position`)
				.all(anime) as {
				id: number;
			}[]
		).map((r) => r.id);
		move.recordNoVideo(ids[0], NOW - 3000);
		move.recordNoVideo(ids[1], NOW - 2000);
		// Two of four: not three, and not every episode yet.
		expect(move.moveState(anime, NOW).band).toBeNull();
		move.recordNoVideo(ids[2], NOW - 1000);
		const state = move.moveState(anime, NOW);
		expect(state.band?.title).toBe('NO VIDEO FROM ANIMEPAHE');
		expect(state.band?.detail).toContain('3 EPISODES TRIED SINCE');
		expect(state.trouble).toContain('NO VIDEO FOR 3 EPISODES SINCE');

		move.dismissMoveBand(anime, NOW);
		expect(move.moveState(anime, NOW).band).toBeNull();
		// TRY AGAIN fails again: the band is back.
		move.recordNoVideo(ids[0], NOW + 1000);
		expect(move.moveState(anime, NOW + 1000).band).not.toBeNull();
	});

	it('says the player it is not just this episode', async () => {
		expect(await move.noVideoLine(anime, NOW + 1000)).toMatch(
			/^EPISODES 1, 2 AND 3 FAILED THE SAME WAY SINCE /
		);
		// One episode alone says nothing: it is just this one.
		const one = anime;
		getDb().prepare(`DELETE FROM episode_failures WHERE series_id = ?`).run(one);
		move.recordNoVideo(
			(
				getDb().prepare(`SELECT id FROM entries WHERE series_id = ? LIMIT 1`).get(anime) as {
					id: number;
				}
			).id,
			NOW
		);
		expect(await move.noVideoLine(anime, NOW)).toBeNull();
	});
});
