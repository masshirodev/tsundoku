import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport, sourcesIn, startScan } = await import('$lib/server/import');
const mihonFixture = await import('./helpers/mihon-fixture');
const { CATEGORIES, writeMihonFolder } = mihonFixture;
const { encode } = await import('./helpers/protobuf-writer');
type Msg = import('./helpers/protobuf-writer').Msg;
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

/**
 * c268, c292: a `Mihon/` folder is a place for a backup, and one with no
 * backup in it is no source. START SCAN on it refuses with where it looked,
 * instead of opening a job that finds nothing and leaves no band.
 */
describe('a Mihon folder with no backup in it', () => {
	const fresh = () => mkdtempSync(join(tmpdir(), 'tsundoku-empty-mihon-'));
	const jobs = () => count(`SELECT COUNT(*) n FROM scan_jobs`);

	it('is no source, and START SCAN says where the backup should have been', () => {
		const lib = fresh();
		mkdirSync(join(lib, 'Mihon', 'autobackup'), { recursive: true });
		// Not a backup by name: a stray file must not make the folder count.
		writeFileSync(join(lib, 'Mihon', 'autobackup', 'notes.txt'), 'x');
		expect(sourcesIn(lib)).toEqual([]);
		const before = jobs();
		const r = startScan(lib);
		expect(r).toMatchObject({
			started: false,
			looked: lib,
			backups: join(lib, 'Mihon', 'autobackup')
		});
		expect(r.started ? '' : r.message).toBe(
			`NOTHING TO IMPORT · NO BACKUP IN ${join(lib, 'Mihon', 'autobackup')} AND NO H/.Hentoid/ FOLDER IN ${lib}`
		);
		expect(jobs()).toBe(before);
		rmSync(lib, { recursive: true });
	});

	it('says the same with no autobackup folder at all', () => {
		const lib = fresh();
		mkdirSync(join(lib, 'Mihon'));
		const r = startScan(lib);
		expect(r.started ? '' : r.message).toContain(
			`NO BACKUP IN ${join(lib, 'Mihon', 'autobackup')}`
		);
		rmSync(lib, { recursive: true });
	});

	it('without a Mihon folder says the old sentence, naming the library folder', () => {
		const lib = fresh();
		const r = startScan(lib);
		expect(r).toMatchObject({ started: false, looked: lib, backups: null });
		expect(r.started ? '' : r.message).toBe(
			`NOTHING TO IMPORT · NO Mihon/ FOLDER OR H/.Hentoid/ FOLDER IN ${lib}`
		);
		rmSync(lib, { recursive: true });
	});

	it('becomes a source once a backup is in it, under either name', () => {
		for (const name of ['app.mihon_2026-09-22_19-06.tachibk', 'old.proto.gz']) {
			const lib = fresh();
			mkdirSync(join(lib, 'Mihon', 'autobackup'), { recursive: true });
			writeFileSync(join(lib, 'Mihon', 'autobackup', name), '');
			expect(sourcesIn(lib).map((s) => [s.name, s.device])).toEqual([['Mihon', null]]);
			rmSync(lib, { recursive: true });
		}
	});

	it('does not drop tsundoku’s own downloads beside it', () => {
		const lib = fresh();
		mkdirSync(join(lib, 'Mihon'));
		mkdirSync(join(lib, 'devices', 'tsundoku', 'Mihon'), { recursive: true });
		expect(sourcesIn(lib).map((s) => [s.name, s.device])).toEqual([['Mihon', 'tsundoku']]);
		rmSync(lib, { recursive: true });
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

describe('a backup from a source with ADDED HIDDEN (c503, the owner’s (a))', () => {
	// A library of its own, holding only a backup, with two sources of its own
	// so the shared library's series are untouched: HIDING has the switch on,
	// PLAIN has it off. Categories as the fixture's: 1 is "Good", 7 "Good+"
	// (adult, so the backup hides it).
	const HIDING = 9_100_000_000_000_000_001n;
	const PLAIN = 9_100_000_000_000_000_002n;
	const lib = mkdtempSync(join(tmpdir(), 'tsundoku-c503-'));
	const manga = (src: bigint, title: string, category: number): Msg => [
		[1, src],
		[2, `/c503/${title.replace(/\s/g, '-').toLowerCase()}`],
		[3, title],
		[
			16,
			[
				[1, `/c503/${title.replace(/\s/g, '-').toLowerCase()}/1`],
				[2, 'Chapter 1'],
				[9, { f32: 1 }]
			]
		],
		[17, category]
	];
	const writeBackup = (list: Msg[]) => {
		const dir = join(lib, 'Mihon', 'autobackup');
		mkdirSync(dir, { recursive: true });
		const msg: Msg = [
			...list.map((m): [number, Msg] => [1, m]),
			...CATEGORIES.map((name, i): [number, Msg] => [
				2,
				[[1, name], ...(i ? ([[2, i]] as Msg) : []), [3, i + 1]]
			]),
			[
				101,
				[
					[1, 'Hiding Scans'],
					[2, HIDING]
				]
			],
			[
				101,
				[
					[1, 'Plain Scans'],
					[2, PLAIN]
				]
			]
		];
		writeFileSync(join(dir, 'app.mihon_2026-11-05_10-00.tachibk'), gzipSync(encode(msg)));
	};
	const hidden = (title: string) =>
		(db().prepare(`SELECT hidden FROM series WHERE title = ?`).get(title) as { hidden: number })
			.hidden;

	it('can only add hiding: a new series from it arrives hidden, one the import merely updates does not', async () => {
		const { setSourceFlag } = await import('$lib/server/engine/source-flags');
		// Brought in before the switch was on: shown, as the backup says.
		writeBackup([manga(HIDING, 'Before The Switch', 1)]);
		await runImport(lib, { now: 1_800_002_000_000 });
		expect(hidden('Before The Switch')).toBe(0);

		setSourceFlag(String(HIDING), 'addedHidden', true, db());
		writeBackup([
			manga(HIDING, 'Before The Switch', 1),
			manga(HIDING, 'Shown In The Backup', 1),
			manga(HIDING, 'Hidden In The Backup', 7),
			manga(PLAIN, 'Plain Shown', 1),
			manga(PLAIN, 'Plain Hidden', 7)
		]);
		const r = await runImport(lib, { now: 1_800_002_100_000 });
		// Every combination: the switch on or off, the backup showing or hiding,
		// and a series that already existed.
		expect({
			before: hidden('Before The Switch'),
			shown: hidden('Shown In The Backup'),
			hiddenToo: hidden('Hidden In The Backup'),
			plainShown: hidden('Plain Shown'),
			plainHidden: hidden('Plain Hidden')
		}).toEqual({ before: 0, shown: 1, hiddenToo: 1, plainShown: 0, plainHidden: 1 });
		expect(r.sources[0]).toMatchObject({ seriesCreated: 4, seriesUpdated: 1 });
		// The band counts what can be seen with reveal off: only Plain Shown.
		const job = db().prepare(`SELECT series_found FROM scan_jobs WHERE id = ?`).get(r.jobId) as {
			series_found: number;
		};
		expect(job.series_found).toBe(1);

		// A second run changes nothing, and showing it again sticks: the switch
		// is for what arrives, not a rule over what is there.
		db().prepare(`UPDATE series SET hidden = 0 WHERE title = 'Shown In The Backup'`).run();
		await runImport(lib, { now: 1_800_002_200_000 });
		expect(hidden('Shown In The Backup')).toBe(0);
		setSourceFlag(String(HIDING), 'addedHidden', false, db());
	});

	it('a download attached at once (attachWritten) hides its new series too, and BROWSE’s counts are asked again', async () => {
		const { setSourceFlag } = await import('$lib/server/engine/source-flags');
		const { attachWritten } = await import('$lib/server/import');
		const { sourceUse } = await import('$lib/server/library-sources');
		const { cbz, comicInfo } = await import('./helpers/mihon-fixture');
		// tsundoku's own device: its backup names the series, and a chapter
		// lands in its downloads, as the downloader writes them.
		const device = join(lib, 'devices', 'tsundoku', 'Mihon');
		const title = 'Downloaded While Hiding';
		const dir = join(device, 'autobackup');
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, 'app.mihon_2026-11-05_11-00.tachibk'),
			gzipSync(
				encode([
					[1, manga(HIDING, title, 1)],
					...CATEGORIES.map((name, i): [number, Msg] => [
						2,
						[[1, name], ...(i ? ([[2, i]] as Msg) : []), [3, i + 1]]
					]),
					[
						101,
						[
							[1, 'Hiding Scans'],
							[2, HIDING]
						]
					]
				])
			)
		);
		const chapters = join(device, 'downloads', 'Hiding Scans (EN)', title);
		mkdirSync(chapters, { recursive: true });
		const file = join(chapters, 'Chapter 1.cbz');
		writeFileSync(
			file,
			cbz(
				comicInfo({
					series: title,
					title: 'Chapter 1',
					number: 1,
					web: 'https://hiding.example/c503/downloaded-while-hiding',
					source: 'Hiding Scans'
				})
			)
		);
		setSourceFlag(String(HIDING), 'addedHidden', true, db());
		try {
			// BROWSE has asked already: the counts are cached for a minute.
			const before = sourceUse().get(String(HIDING)) ?? { series: 0, hidden: 0 };
			expect(await attachWritten(lib, [file], 1_800_002_300_000)).toEqual([]);
			expect(hidden(title)).toBe(1);
			// Without `forgetSourceUse` the cached counts would stand for the minute.
			expect(sourceUse().get(String(HIDING))).toEqual({
				series: before.series + 1,
				hidden: before.hidden + 1
			});
		} finally {
			setSourceFlag(String(HIDING), 'addedHidden', false, db());
		}
	});
});

describe('a novel’s R→L survives a backup’s fold (c551)', () => {
	// Folder series imported before a backup knew them, set to R→L by the
	// owner (series.text_direction, rung 69), then folded into the URL's series
	// once a backup names them (import/fold.ts): one renamed, so `carryEdit`
	// carries the owner's edit, and one still named as its folder, so only the
	// fold's own fill-in can keep it.
	const at = 1_800_003_000_000;
	const { ASURA, backup, cbz, comicInfo } = mihonFixture;
	const one = <T>(sql: string, ...args: unknown[]) =>
		db()
			.prepare(sql)
			.get(...args) as T;
	const byKey = (key: string) =>
		one<{ id: number } | undefined>(`SELECT id FROM series WHERE origin_key = ?`, key)?.id;
	const textDirection = (id: number) =>
		one<{ text_direction: string | null }>(`SELECT text_direction FROM series WHERE id = ?`, id)
			.text_direction;
	// The third: renamed and chosen L→R ('ltr', as REMEMBER L→R stores it, c617)
	// while the old URL series had R→L, so carryEdit's owner's edit must win over
	// the survivor's own. The fourth: renamed and never chosen (NULL) over the
	// same R→L, so there is no choice to carry and the survivor keeps its own.
	// The fifth: the survivor itself chose L→R and the folder, not renamed, has
	// R→L, so only the fold's fill-in can reach it and a chosen L→R must hold.
	const folders = [
		'Novel Renamed',
		'Novel Kept',
		'Novel Turned',
		'Novel Unset',
		'Novel Chosen'
	] as const;
	const folderDirection = (name: (typeof folders)[number]) =>
		name === 'Novel Turned' ? 'ltr' : name === 'Novel Unset' ? null : 'rtl';
	const survivorDirection = (name: (typeof folders)[number]) =>
		name === 'Novel Turned' || name === 'Novel Unset'
			? 'rtl'
			: name === 'Novel Chosen'
				? 'ltr'
				: null;
	const slug = (name: string) => name.toLowerCase().replace(/ /g, '-');
	const dirKey = (name: string) => `mihon-dir:Asura Scans (EN)/${name}`;
	const urlKey = (name: string) => `mihon:${ASURA}:/series/${slug(name)}`;
	const urlSeries = new Map<string, number>();

	beforeAll(async () => {
		for (const name of folders) {
			const dir = join(root, 'downloads', 'Asura Scans (EN)', name);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, 'Chapter 1.cbz'),
				cbz(
					comicInfo({
						title: 'Chapter 1',
						series: name,
						number: 1,
						web: `https://asura.example/series/${slug(name)}/1`,
						source: 'Asura Scans'
					})
				)
			);
		}
		await runImport(library, { now: at });
		for (const name of folders) {
			const id = byKey(dirKey(name));
			expect(id, name).toBeTruthy();
			// What the owner did while it was the only one: a novel, read R→L.
			db()
				.prepare(`UPDATE series SET kind = 'novel', text_direction = ? WHERE id = ?`)
				.run(folderDirection(name), id);
			if (name !== 'Novel Kept' && name !== 'Novel Chosen')
				db().prepare(`UPDATE series SET title = ? WHERE id = ?`).run(`My ${name}`, id);
			// The old importer's second series under the URL key, on the same files.
			const other = Number(
				db()
					.prepare(
						`INSERT INTO series (root_id, title, kind, added_at, path, origin_key, source, rating)
						SELECT root_id, ?, 'novel', added_at, path, ?, source, 0 FROM series WHERE id = ?`
					)
					.run(name, urlKey(name), id).lastInsertRowid
			);
			db()
				.prepare(
					`INSERT INTO entries (series_id, position, label, added_at, file, source_url, available)
					SELECT ?, position, label, added_at, file, ?, 1 FROM entries WHERE series_id = ?`
				)
				.run(other, `/series/${slug(name)}/1`, id);
			db()
				.prepare(`UPDATE series SET text_direction = ? WHERE id = ?`)
				.run(survivorDirection(name), other);
			urlSeries.set(name, other);
		}
		const manga = (name: string): Msg => [
			[1, ASURA],
			[2, `/series/${slug(name)}`],
			[3, name],
			[
				16,
				[
					[1, `/series/${slug(name)}/1`],
					[2, 'Chapter 1'],
					[9, { f32: 1 }]
				]
			]
		];
		writeFileSync(
			join(root, 'autobackup', 'app.mihon_2026-11-06_09-00.tachibk'),
			gzipSync(backup([], folders.map(manga)))
		);
		await runImport(library, { now: at + 10_000 });
	});

	it('folds each folder into its URL’s series', () => {
		for (const name of folders) {
			expect(byKey(dirKey(name)), name).toBeUndefined();
			expect(byKey(urlKey(name)), name).toBe(urlSeries.get(name));
		}
	});

	it('carries a renamed folder’s R→L with its name, kind and layout (carryEdit)', () => {
		const id = urlSeries.get('Novel Renamed')!;
		expect(
			one<{ title: string; kind: string }>(`SELECT title, kind FROM series WHERE id = ?`, id)
		).toEqual({ title: 'My Novel Renamed', kind: 'novel' });
		expect(textDirection(id)).toBe('rtl');
	});

	it('carries a renamed folder’s chosen L→R over the survivor’s R→L: the owner’s edit wins whole (c617)', () => {
		expect(textDirection(urlSeries.get('Novel Turned')!)).toBe('ltr');
	});

	it('leaves the survivor’s R→L when the renamed folder never chose one (c617)', () => {
		const id = urlSeries.get('Novel Unset')!;
		// The rename did carry, so this is carryEdit's path and not the fill-in.
		expect(one<{ title: string }>(`SELECT title FROM series WHERE id = ?`, id).title).toBe(
			'My Novel Unset'
		);
		expect(textDirection(id)).toBe('rtl');
	});

	it('keeps a folder’s R→L when the survivor had none, as a rating fills in (foldSeries)', () => {
		const id = urlSeries.get('Novel Kept')!;
		// Not renamed: the survivor keeps its own name, and only the fill-in carried R→L.
		expect(one<{ title: string }>(`SELECT title FROM series WHERE id = ?`, id).title).toBe(
			'Novel Kept'
		);
		expect(textDirection(id)).toBe('rtl');
	});

	it('keeps a survivor’s chosen L→R over an unrenamed folder’s R→L: a choice is not a gap to fill (c617)', () => {
		expect(textDirection(urlSeries.get('Novel Chosen')!)).toBe('ltr');
	});

	it('GROUP takes a first volume’s chosen L→R over a later R→L, and a later one’s over never chosen (c617)', () => {
		const rootId = one<{ root_id: number }>(
			`SELECT root_id FROM series WHERE id = ?`,
			urlSeries.get('Novel Kept')!
		).root_id;
		const novel = (title: string, direction: string | null) => {
			const id = Number(
				db()
					.prepare(
						`INSERT INTO series (root_id, title, kind, added_at, path, rating, text_direction)
						VALUES (?, ?, 'novel', ?, ?, 0, ?)`
					)
					.run(rootId, title, at, join(library, 'grouped', title), direction).lastInsertRowid
			);
			db()
				.prepare(
					`INSERT INTO entries (series_id, position, label, added_at, file, available)
					VALUES (?, 1, 'Vol. 1', ?, 'book.epub', 1)`
				)
				.run(id, at);
			return id;
		};
		const chosenFirst = groupIntoSeries({
			seriesIds: [novel('First L', 'ltr'), novel('First R', 'rtl')],
			name: 'Chosen first'
		});
		expect(textDirection(chosenFirst.seriesId)).toBe('ltr');
		const unsetFirst = groupIntoSeries({
			seriesIds: [novel('Unset N', null), novel('Unset L', 'ltr'), novel('Unset R', 'rtl')],
			name: 'Unset first'
		});
		expect(textDirection(unsetFirst.seriesId)).toBe('ltr');
	});
});

describe('ADDED HIDDEN reaches a Mihon download folder imported before its backup (c571)', () => {
	// Each case a library of its own: tsundoku's downloads hold one folder, and
	// tsundoku's own backup beside them (when it comes) names the same manga,
	// as in c503's attach case: one Mihon root. (The library's backup in
	// `Mihon/` and `adoptFolder` are devices-import-db.spec.ts's c571 case,
	// whose library has one Mihon root for both.) The sources
	// are installed (engine_sources), as the switch's own screen needs them:
	// HIDING has ADDED HIDDEN on, PLAIN off; TWIN is two installed sources of
	// one name and one language, one switched; LANG is one name in two
	// languages, only Japanese switched.
	const HIDING = 9_100_000_000_000_000_011n;
	const PLAIN = 9_100_000_000_000_000_012n;
	const TWIN_A = 9_100_000_000_000_000_013n;
	const TWIN_B = 9_100_000_000_000_000_014n;
	const LANG_EN = 9_100_000_000_000_000_015n;
	const LANG_JA = 9_100_000_000_000_000_016n;
	const NAMES = new Map<bigint, [string, string]>([
		[HIDING, ['C571 Hiding', 'en']],
		[PLAIN, ['C571 Plain', 'en']],
		[TWIN_A, ['C571 Twin', 'en']],
		[TWIN_B, ['C571 Twin', 'en']],
		[LANG_EN, ['C571 Lang', 'en']],
		[LANG_JA, ['C571 Lang', 'ja']]
	]);
	const slug = (title: string) => title.replace(/\s/g, '-').toLowerCase();
	const dirOf = (src: bigint) => {
		const [name, lang] = NAMES.get(src)!;
		return `${name} (${lang.toUpperCase()})`;
	};
	const hidden = (title: string) =>
		(
			db().prepare(`SELECT hidden FROM series WHERE title = ? AND in_library = 1`).all(title) as {
				hidden: number;
			}[]
		).map((r) => r.hidden);
	const keyOf = (title: string) =>
		(
			db().prepare(`SELECT origin_key FROM series WHERE title = ?`).all(title) as {
				origin_key: string;
			}[]
		).map((r) => r.origin_key);

	let flags: typeof import('$lib/server/engine/source-flags');
	beforeAll(async () => {
		flags = await import('$lib/server/engine/source-flags');
		db()
			.prepare(
				`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
				VALUES ('c571.ext', 'C571', 'manga', 1, '1.0', '1.5', ?, 0, 0, '')`
			)
			.run('c571.ext'.padEnd(64, '0'));
		const add = db().prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang) VALUES (?, 'c571.ext', ?, ?)`
		);
		for (const [id, [name, lang]] of NAMES) add.run(String(id), name, lang);
		for (const id of [HIDING, TWIN_A, LANG_JA])
			flags.setSourceFlag(String(id), 'addedHidden', true, db());
	});

	/** A library whose tsundoku device downloaded chapter 1 of `title` from `src`. */
	const folderLibrary = (src: bigint, title: string) => {
		const lib = mkdtempSync(join(tmpdir(), 'tsundoku-c571-'));
		mkdirSync(join(lib, 'Mihon', 'autobackup'), { recursive: true });
		const dir = join(lib, 'devices', 'tsundoku', 'Mihon', 'downloads', dirOf(src), title);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, 'Chapter 1.cbz'),
			mihonFixture.cbz(
				mihonFixture.comicInfo({
					series: title,
					title: 'Chapter 1',
					number: 1,
					web: `https://c571.example/c571/${slug(title)}/1`,
					source: NAMES.get(src)![0]
				})
			)
		);
		return lib;
	};
	/** tsundoku's own backup, naming `title` from `src`, its chapter 1 the same. */
	const writeBackup = (lib: string, src: bigint, title: string) => {
		const msg: Msg = [
			[
				1,
				[
					[1, src],
					[2, `/c571/${slug(title)}`],
					[3, title],
					[
						16,
						[
							[1, `/c571/${slug(title)}/1`],
							[2, 'Chapter 1'],
							[9, { f32: 1 }]
						]
					],
					[17, 1]
				]
			],
			...CATEGORIES.map((name, i): [number, Msg] => [
				2,
				[[1, name], ...(i ? ([[2, i]] as Msg) : []), [3, i + 1]]
			]),
			[
				101,
				[
					[1, NAMES.get(src)![0]],
					[2, src]
				]
			]
		];
		const dir = join(lib, 'devices', 'tsundoku', 'Mihon', 'autobackup');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'app.mihon_2026-11-05_12-00.tachibk'), gzipSync(encode(msg)));
	};
	const at = 1_800_004_000_000;

	it('folder first, then the backup, from a switched source: hidden from the start, and still one hidden series', async () => {
		const title = 'C571 Folder First';
		const lib = folderLibrary(HIDING, title);
		const r = await runImport(lib, { now: at });
		expect(keyOf(title)).toEqual([`mihon-dir:${dirOf(HIDING)}/${title}`]);
		expect(hidden(title)).toEqual([1]);
		// The band counts what reveal-off can see: not this one.
		expect(
			(
				db().prepare(`SELECT series_found FROM scan_jobs WHERE id = ?`).get(r.jobId) as {
					series_found: number;
				}
			).series_found
		).toBe(0);
		writeBackup(lib, HIDING, title);
		await runImport(lib, { now: at + 1000 });
		// The backup adopted the folder's series (re-keyed, not created again).
		expect(keyOf(title)).toEqual([`mihon:${HIDING}:/c571/${slug(title)}`]);
		expect(hidden(title)).toEqual([1]);
		rmSync(lib, { recursive: true });
	});

	it('backup first, then the folder, from a switched source: hidden too', async () => {
		const title = 'C571 Backup First';
		const lib = mkdtempSync(join(tmpdir(), 'tsundoku-c571-'));
		writeBackup(lib, HIDING, title);
		await runImport(lib, { now: at + 2000 });
		expect(keyOf(title)).toEqual([`mihon:${HIDING}:/c571/${slug(title)}`]);
		expect(hidden(title)).toEqual([1]);
		// Then the download lands beside it: the same series, still hidden.
		const withFolder = folderLibrary(HIDING, title);
		writeBackup(withFolder, HIDING, title);
		rmSync(lib, { recursive: true });
		await runImport(withFolder, { now: at + 3000 });
		expect(keyOf(title)).toEqual([`mihon:${HIDING}:/c571/${slug(title)}`]);
		expect(hidden(title)).toEqual([1]);
		rmSync(withFolder, { recursive: true });
	});

	it('a folder from a source without the switch arrives visible, and stays so when its backup comes', async () => {
		const title = 'C571 Plain Folder';
		const lib = folderLibrary(PLAIN, title);
		await runImport(lib, { now: at + 4000 });
		expect(hidden(title)).toEqual([0]);
		writeBackup(lib, PLAIN, title);
		await runImport(lib, { now: at + 5000 });
		expect(keyOf(title)).toEqual([`mihon:${PLAIN}:/c571/${slug(title)}`]);
		expect(hidden(title)).toEqual([0]);
		rmSync(lib, { recursive: true });
	});

	it('two installed sources of one name and language: the folder cannot say which, and stays visible', async () => {
		const { folderSourceId } = await import('$lib/server/import/fold');
		expect(folderSourceId(db(), `mihon-dir:${dirOf(TWIN_A)}/X`)).toBeNull();
		const title = 'C571 Twin Folder';
		const lib = folderLibrary(TWIN_A, title);
		await runImport(lib, { now: at + 6000 });
		expect(hidden(title)).toEqual([0]);
		rmSync(lib, { recursive: true });
	});

	it('one name in two languages is told apart by the folder’s language', async () => {
		const { folderSourceId } = await import('$lib/server/import/fold');
		expect(folderSourceId(db(), `mihon-dir:C571 Lang (JA)/X`)).toBe(String(LANG_JA));
		expect(folderSourceId(db(), `mihon-dir:C571 Lang (EN)/X`)).toBe(String(LANG_EN));
		// A bare name is one source only when one source has it: these are two.
		expect(folderSourceId(db(), `mihon-dir:C571 Lang/X`)).toBeNull();
		expect(folderSourceId(db(), `mihon-dir:C571 Hiding/X`)).toBe(String(HIDING));
		// A language nobody installed under that name is no source.
		expect(folderSourceId(db(), `mihon-dir:C571 Hiding (JA)/X`)).toBeNull();
		const ja = folderLibrary(LANG_JA, 'C571 Japanese Folder');
		await runImport(ja, { now: at + 7000 });
		expect(hidden('C571 Japanese Folder')).toEqual([1]);
		rmSync(ja, { recursive: true });
		const en = folderLibrary(LANG_EN, 'C571 English Folder');
		await runImport(en, { now: at + 8000 });
		expect(hidden('C571 English Folder')).toEqual([0]);
		rmSync(en, { recursive: true });
	});

	it('hides only what it creates: a folder series shown before the switch went on stays shown', async () => {
		const title = 'C571 Shown Before';
		const lib = folderLibrary(PLAIN, title);
		flags.setSourceFlag(String(PLAIN), 'addedHidden', false, db());
		await runImport(lib, { now: at + 9000 });
		expect(hidden(title)).toEqual([0]);
		flags.setSourceFlag(String(PLAIN), 'addedHidden', true, db());
		try {
			// A rescan, then the backup that adopts it: updated twice, never created.
			await runImport(lib, { now: at + 10_000 });
			writeBackup(lib, PLAIN, title);
			await runImport(lib, { now: at + 11_000 });
			expect(keyOf(title)).toEqual([`mihon:${PLAIN}:/c571/${slug(title)}`]);
			expect(hidden(title)).toEqual([0]);
		} finally {
			flags.setSourceFlag(String(PLAIN), 'addedHidden', false, db());
			rmSync(lib, { recursive: true });
		}
	});
});
