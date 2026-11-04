import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { writeMihonFolder } = await import('./helpers/mihon-fixture');
const { writeHentoidFolder } = await import('./helpers/hentoid-fixture');
const { groupIntoSeries } = await import('$lib/server/books');
const { markEntries } = await import('$lib/server/series');
const { closeDeadJobs } = await import('$lib/server/import/write');
const { currentScan, dismissScan } = await import('$lib/server/library');

/**
 * The importer after c191 (doc/IMPORT-MIHON.md, "Where it reads from"): the
 * library's own `Mihon/` is a place for a backup, and tsundoku's downloads sit
 * in `devices/tsundoku/Mihon/`, read back by the same importer. The fixture's
 * `local/` folder is no longer read at all.
 */
const library = mkdtempSync(join(tmpdir(), 'tsundoku-mihon-'));
const root = writeMihonFolder(join(library, 'devices', 'tsundoku'));
const hentoid = writeHentoidFolder(library);
/** The Mihon part of a run's summary, flattened with the job's own fields. */
const importMihon = async (now?: number) => {
	const r = await runImport(library, { now });
	const source = r.sources.find((s) => s.name.startsWith('Mihon'));
	return { jobId: r.jobId, failedFiles: r.failedFiles, ...source };
};
const db = () => getDb();
const series = (title: string) =>
	db().prepare(`SELECT * FROM series WHERE title = ?`).get(title) as Record<string, unknown> & {
		id: number;
	};
const entries = (id: number) =>
	db()
		.prepare(
			`SELECT label, available, file, page_count, read_at, last_position FROM entries WHERE series_id = ? ORDER BY position`
		)
		.all(id) as {
		label: string;
		available: number;
		file: string;
		page_count: number;
		read_at: number | null;
		last_position: number | null;
	}[];
const count = (sql: string) => (db().prepare(sql).get() as { n: number }).n;

let first: Awaited<ReturnType<typeof importMihon>>;
beforeAll(async () => {
	first = await importMihon(1_800_000_000_000);
});

describe('the Mihon import', () => {
	it('imports the library and the unknown download, skips what was only browsed', () => {
		expect(first).toMatchObject({ seriesCreated: 5, skipped: 1, failedFiles: 1 });
		expect(series('Only Browsed')).toBeUndefined();
		// Its ComicInfo says "Manga", and a series' own genre beats its source.
		expect(series('Not In The Backup')).toMatchObject({ kind: 'manga' });
	});

	it('attaches the files it found, with page counts, and marks the rest not downloaded', () => {
		const d = series('Drawing: Saikyou Mangaka');
		expect(d).toMatchObject({ rating: 8, hidden: 0, source: 'mihon', status: 'ongoing' });
		expect(entries(d.id).map((e) => [e.label, e.available, e.page_count])).toEqual([
			['Ch. 1', 0, 0],
			['Ch. 2', 1, 12],
			['Ch. 3', 1, 13]
		]);
		const a = series('Academy’s Undercover Professor');
		expect(entries(a.id).find((e) => e.label === 'Ch. 98')).toMatchObject({
			available: 1,
			file: 'Chapter 98 - Lindenborough.cbz'
		});
	});

	it('hides the "+" series and shelves To Read', () => {
		expect(series('Bunk Beds')).toMatchObject({ hidden: 1, rating: 8 });
		const shelf = db()
			.prepare(
				`SELECT c.name FROM collections c JOIN collection_series cs ON cs.collection_id = c.id
				JOIN series s ON s.id = cs.series_id WHERE s.title = 'Myst, Might, Mayhem'`
			)
			.all();
		expect(shelf).toEqual([{ name: 'To Read' }]);
	});

	it('writes Mihon’s history into the reading log', () => {
		const d = series('Drawing: Saikyou Mangaka');
		const events = db()
			.prepare(
				`SELECT kind, at, page, duration_ms FROM reading_events WHERE series_id = ? ORDER BY at`
			)
			.all(d.id);
		expect(events).toEqual([
			{ kind: 'finish', at: 1_750_000_000_000, page: 0, duration_ms: 600_000 },
			{ kind: 'page', at: 1_750_000_100_000, page: 4, duration_ms: 120_000 }
		]);
	});

	it('links a series its MAL tracker names, and no other tracker (doc/LINKS.md)', () => {
		const d = series('Drawing: Saikyou Mangaka');
		const links = db().prepare(`SELECT series_id, mal_id, via, score FROM series_links`).all();
		// Rated already ("Good"), so the score gives it nothing.
		expect(links).toEqual([{ series_id: d.id, mal_id: 147272, via: 'mihon', score: 9 }]);
	});

	it('counts only visible arrivals on the band', () => {
		const job = db().prepare(`SELECT * FROM scan_jobs WHERE id = ?`).get(first.jobId) as Record<
			string,
			number
		>;
		expect(job.series_found).toBe(4);
		expect(job.finished_at).not.toBeNull();
		expect(job.dismissed_at).toBeNull();
	});
});

describe('a rescan', () => {
	it('changes nothing when nothing changed, and leaves no band', async () => {
		const before = [
			count(`SELECT COUNT(*) n FROM entries`),
			count(`SELECT COUNT(*) n FROM reading_events`)
		];
		const again = await importMihon(1_800_000_100_000);
		expect(again).toMatchObject({
			seriesCreated: 0,
			seriesUpdated: 5,
			entriesAdded: 0,
			filesAttached: 0
		});
		expect([
			count(`SELECT COUNT(*) n FROM entries`),
			count(`SELECT COUNT(*) n FROM reading_events`)
		]).toEqual(before);
		const job = db()
			.prepare(`SELECT dismissed_at FROM scan_jobs WHERE id = ?`)
			.get(again.jobId) as { dismissed_at: number };
		expect(job.dismissed_at).not.toBeNull();
	});

	it('keeps a chapter the owner marked unread unread, though Mihon still says read (rung 28)', async () => {
		const d = series('Drawing: Saikyou Mangaka');
		const ch1 = db()
			.prepare(`SELECT id FROM entries WHERE series_id = ? AND label = 'Ch. 1'`)
			.get(d.id) as { id: number };
		expect(markEntries(d.id, [ch1.id], false, 1_800_000_200_000)).toBe(1);
		await importMihon(1_800_000_300_000);
		const after = db().prepare(`SELECT read_at, unread_at FROM entries WHERE id = ?`).get(ch1.id);
		// Mihon's read is from before the unmark: it doesn't come back.
		expect(after).toEqual({ read_at: null, unread_at: 1_800_000_200_000 });
		// Marked read again, the unmark is forgotten.
		markEntries(d.id, [ch1.id], true, 1_800_000_400_000);
		expect(db().prepare(`SELECT unread_at FROM entries WHERE id = ?`).get(ch1.id)).toEqual({
			unread_at: null
		});
	});

	it('keeps what the owner changed, and marks a file that went away', async () => {
		const d = series('Drawing: Saikyou Mangaka');
		db().prepare(`UPDATE series SET rating = 1, title = 'Drawing (mine)' WHERE id = ?`).run(d.id);
		rmSync(
			join(
				root,
				'downloads',
				'Weeb Central (EN)',
				'Drawing_ Saikyou Mangaka',
				'Unknown_Chapter 3_abc3.cbz'
			)
		);
		await importMihon();
		const after = db().prepare(`SELECT title, rating FROM series WHERE id = ?`).get(d.id);
		expect(after).toEqual({ title: 'Drawing (mine)', rating: 1 });
		expect(entries(d.id).map((e) => e.available)).toEqual([0, 1, 0]);
	});
});

describe('the Hentoid import', () => {
	const bookSeries = (title: string) => series(title);
	const pagesOf = (entryId: number) =>
		(
			db()
				.prepare(`SELECT file FROM entry_pages WHERE entry_id = ? ORDER BY position`)
				.all(entryId) as { file: string }[]
		).map((p) => p.file);

	it('lands every book in the hidden Hentoid root', () => {
		const root = db().prepare(`SELECT name, hidden FROM roots WHERE path = ?`).get(hentoid);
		expect(root).toEqual({ name: 'Hentoid', hidden: 1 });
		for (const t of ['Summer Days', 'Summer Days 2', 'Quiet Rooms', 'Lost Json'])
			expect(bookSeries(t)).toMatchObject({ kind: 'doujin', source: 'hentoid' });
	});

	it('keeps a book’s rating, FAV and progress, with its pages and cover', () => {
		const s = bookSeries('Summer Days');
		expect(s).toMatchObject({ rating: 8, favourite: 1, path: hentoid });
		const e = db().prepare(`SELECT * FROM entries WHERE series_id = ?`).get(s.id) as Record<
			string,
			unknown
		> & { id: number };
		expect(e).toMatchObject({
			label: 'Book',
			file: 'nhentai/Aoi Rin - Summer Days - [111]',
			page_count: 4,
			cover_file: 'thumb.jpg'
		});
		expect(e.read_at).toBe(1_750_000_000_000);
		expect(pagesOf(e.id)).toEqual(['0001.jpg', '0002.jpg', '0003.jpg', '0004.jpg']);
	});

	it('splits a multi-chapter book into a series of books', () => {
		const s = bookSeries('Quiet Rooms');
		const books = db()
			.prepare(
				`SELECT id, label, page_count, read_at, last_position FROM entries WHERE series_id = ? ORDER BY position`
			)
			.all(s.id) as {
			id: number;
			label: string;
			page_count: number;
			read_at: number | null;
			last_position: number | null;
		}[];
		expect(books.map((b) => [b.label, b.page_count])).toEqual([
			['Ch. 1', 3],
			['Ch. 1.5', 2],
			['Ch. 2', 2]
		]);
		expect(books[1]).toMatchObject({ read_at: null, last_position: 1 });
		expect(pagesOf(books[2].id)).toEqual(['0006.jpg', '0007.jpg']);
		const tags = db()
			.prepare(
				`SELECT t.namespace, t.value FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = ?`
			)
			.all(books[0].id);
		expect(tags).toContainEqual({ namespace: 'artist', value: 'mori' });
	});

	it('does not count hidden arrivals on the band', () => {
		const job = db()
			.prepare(`SELECT series_found FROM scan_jobs WHERE id = ?`)
			.get(first.jobId) as { series_found: number };
		// Four visible Mihon series; Bunk Beds and every Hentoid book are hidden.
		expect(job.series_found).toBe(4);
	});

	it('finds a book the owner grouped, instead of making it again', async () => {
		const a = bookSeries('Summer Days');
		const b = bookSeries('Summer Days 2');
		const { seriesId } = groupIntoSeries({ seriesIds: [a.id, b.id], name: 'Summer Days' });
		const before = count(`SELECT COUNT(*) n FROM series`);
		await importMihon();
		expect(count(`SELECT COUNT(*) n FROM series`)).toBe(before);
		const grouped = db().prepare(`SELECT path FROM series WHERE id = ?`).get(seriesId);
		expect(grouped).toEqual({ path: hentoid });
	});

	it('marks a deleted book folder not downloaded, keeping its entry', async () => {
		rmSync(join(hentoid, 'nhentai', 'someone - Lost Json - [333]'), { recursive: true });
		await importMihon();
		const s = bookSeries('Lost Json');
		expect(entries(s.id).map((e) => e.available)).toEqual([0]);
	});
});

describe('Mihon’s local manga', () => {
	it('is not imported any more: no local folder, no hidden root (c191)', () => {
		expect(db().prepare(`SELECT name FROM roots WHERE path LIKE '%/local'`).get()).toBeUndefined();
		expect(series('Local Book')).toBeUndefined();
		expect(series('No Artist Here')).toBeUndefined();
	});

	it('never turns the backup’s local manga into series in the visible Mihon root', () => {
		const n = (
			db()
				.prepare(`SELECT COUNT(*) n FROM series WHERE title = 'aoi rin - Local Book - [555]'`)
				.get() as { n: number }
		).n;
		expect(n).toBe(0);
	});
});

describe('an import a dead process left open', () => {
	const open = (found: number) =>
		Number(
			db()
				.prepare(
					`INSERT INTO scan_jobs (started_at, series_found, steps, step) VALUES (?, ?, 11, 1)`
				)
				.run(1_800_000_200_000, found).lastInsertRowid
		);
	const job = (id: number) =>
		db().prepare(`SELECT finished_at, dismissed_at FROM scan_jobs WHERE id = ?`).get(id) as {
			finished_at: number | null;
			dismissed_at: number | null;
		};

	it('is closed at the next start, and one that brought nothing leaves no band', () => {
		const id = open(0);
		expect(currentScan()?.finishedAt).toBeNull();
		expect(closeDeadJobs(db(), 1_800_000_300_000)).toBe(1);
		expect(job(id)).toEqual({ finished_at: 1_800_000_300_000, dismissed_at: 1_800_000_300_000 });
		expect(currentScan()?.id).not.toBe(id);
	});

	it('keeps its band when it brought series in before it died', () => {
		const id = open(3);
		closeDeadJobs(db(), 1_800_000_400_000);
		expect(job(id)).toEqual({ finished_at: 1_800_000_400_000, dismissed_at: null });
		dismissScan(id);
	});

	it('a later import that brought nothing does not hand the band back to an older one', () => {
		const older = open(2);
		closeDeadJobs(db(), 1_800_000_500_000);
		expect(currentScan()?.id).toBe(older);
		const quiet = open(0);
		closeDeadJobs(db(), 1_800_000_600_000);
		expect(job(quiet).dismissed_at).not.toBeNull();
		expect(currentScan()).toBeNull();
	});

	it('leaves finished jobs alone', () => {
		expect(closeDeadJobs(db())).toBe(0);
	});
});

/**
 * c382: the importer's one delete of a series, `prunePageless`, keeps an empty
 * series only while nobody has touched it. A link is a touch, and since rung 62
 * an anime's link is per season: with only a later season linked there is no
 * `series_links` mirror (`syncSeriesLink` mirrors season 1 alone), so the
 * keep-test has to ask the season rows too.
 */
describe('an empty series the owner touched is never pruned (c382)', () => {
	const seasons = () => import('$lib/server/season-links');
	const works = () => import('$lib/server/works');
	const cand = (anilistId: number) => ({
		anilistId,
		malId: null,
		title: `Entry ${anilistId}`,
		alts: [],
		format: 'TV',
		country: 'JP',
		year: 2020,
		chapters: null,
		volumes: null,
		episodes: 12,
		season: null,
		seasonYear: null,
		status: 'FINISHED',
		coverUrl: ''
	});
	const byTitle = (title: string) =>
		db().prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number } | undefined;

	it('keeps an anime with only season 2 linked when every episode file has gone (the card’s case)', async () => {
		const { tvshowNfo, episodeNfo } = await import('$lib/library/anime-files');
		const show = join(library, 'Anime', 'Two Seasons');
		const key = 'aniyomi:7001:/anime/two-seasons';
		mkdirSync(show, { recursive: true });
		writeFileSync(
			join(show, 'tvshow.nfo'),
			tvshowNfo({ key, title: 'Two Seasons', plot: '', status: '', genres: [], source: 'fake' })
		);
		const episode = (season: number, n: number, position: number) => {
			const dir = join(show, `Season ${season}`);
			mkdirSync(dir, { recursive: true });
			const name = `S0${season}E0${n}`;
			writeFileSync(join(dir, `${name}.mkv`), Buffer.alloc(64, n));
			writeFileSync(
				join(dir, `${name}.nfo`),
				episodeNfo({
					sourceUrl: `/anime/two-seasons/s${season}e${n}`,
					title: '',
					season,
					number: n,
					position,
					durationS: 1440,
					note: ''
				})
			);
			return join(dir, `${name}.mkv`);
		};
		const files = [episode(1, 1, 1), episode(1, 2, 2), episode(2, 1, 3)];
		await runImport(library, { now: 1_800_001_000_000 });
		const id = byTitle('Two Seasons')!.id;
		expect((await seasons()).linkSeason(id, 2, 1, cand(2002), 'pasted')).toBe(true);
		// The state the card names: a season row, and no series_links mirror.
		expect(db().prepare(`SELECT 1 FROM series_links WHERE series_id = ?`).get(id)).toBeUndefined();

		for (const f of files) rmSync(f);
		await runImport(library, { now: 1_800_001_100_000 });
		expect(byTitle('Two Seasons')?.id).toBe(id);
		expect((await seasons()).seasonLinks(id).map((l) => l.season)).toEqual([2]);
		// The anime source marks a gone file NOT DOWNLOADED; it never empties the
		// series, so nothing here reaches the prune (the card's premise, measured).
		expect(entries(id).map((e) => e.available)).toEqual([0, 0, 0]);
	});

	it('keeps an empty series in the pruned root that has a season link, a season decision, or a Work', async () => {
		const rootId = (
			db().prepare(`SELECT id FROM roots WHERE path = ?`).get(hentoid) as { id: number }
		).id;
		const now = 1_800_001_200_000;
		// What an earlier import made of folders with no pages (card c64): empty
		// series, the state the prune exists for, made as tests/hentoid-pageless-db
		// makes them.
		const add = (title: string) =>
			Number(
				db()
					.prepare(
						`INSERT INTO series (root_id, title, kind, rating, added_at, source, path, origin_key)
						VALUES (?, ?, 'doujin', 0, ?, 'hentoid', ?, ?)`
					)
					.run(rootId, title, now, hentoid, `hentoid:NHENTAI:/c382-${title}/`).lastInsertRowid
			);
		const linked = add('Season Linked');
		const decided = add('Season Decided');
		const grouped = add('Grouped Empty');
		add('Untouched Empty');
		const s = await seasons();
		expect(s.linkSeason(linked, 2, 1, cand(3003), 'pasted')).toBe(true);
		s.noneOfSeason(decided, 1, 1, now);
		// A Work is the owner's grouping, as a shelf is: grouped with a real book.
		const book = byTitle('Summer Days')!.id;
		const w = await works();
		const work = w.createWork({ seriesIds: [grouped, book], name: 'Kept Run', now });

		await runImport(library, { now: now + 1 });
		expect(byTitle('Untouched Empty')).toBeUndefined();
		expect(byTitle('Season Linked')?.id).toBe(linked);
		expect(byTitle('Season Decided')?.id).toBe(decided);
		expect(byTitle('Grouped Empty')?.id).toBe(grouped);
		// Before, the cascade took the link and the decision, and rung 61's
		// trigger ended the Work the deleted series left with one.
		expect(s.seasonLinks(linked)).toHaveLength(1);
		expect(w.workOfSeries(book)?.id).toBe(work.work.id);
		w.ungroup(work.work.id);
	});
});
