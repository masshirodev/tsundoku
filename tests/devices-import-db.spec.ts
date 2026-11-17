import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Msg } from './helpers/protobuf-writer';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport, sourcesIn } = await import('$lib/server/import');
const { writeMihonFolder, cbz, comicInfo, backup, ASURA, WEEB } =
	await import('./helpers/mihon-fixture');
const { writeHentoidFolder, book, content } = await import('./helpers/hentoid-fixture');
const { zip } = await import('./helpers/zip-writer');
const { groupIntoSeries } = await import('$lib/server/books');
const { ensureRoot } = await import('$lib/server/import/write');

/**
 * One library after c191 (doc/IMPORT-MIHON.md, "Where it reads from"): the
 * library's own `Mihon/` holds a friend's backup, tsundoku's downloads sit in
 * `devices/tsundoku/Mihon/`, and the phone's Hentoid copy is read while its
 * `Mihon/` copy is not (doc/SYNC.md, "Other devices").
 */
const library = mkdtempSync(join(tmpdir(), 'tsundoku-devices-'));
// The library's own Mihon folder: a place to drop a backup, and no downloads.
const rootMihon = join(library, 'Mihon');
mkdirSync(join(rootMihon, 'autobackup'), { recursive: true });
// tsundoku's own device: what its downloader wrote.
const tsundokuMihon = writeMihonFolder(join(library, 'devices', 'tsundoku'));
// The phone's Mihon copy, which nothing reads any more, and its Hentoid one.
const phoneMihon = writeMihonFolder(join(library, 'devices', 'phone'));
writeHentoidFolder(library);
const phoneHentoid = writeHentoidFolder(join(library, 'devices', 'phone'));
// A book only the phone downloaded.
book(
	phoneHentoid,
	'nhentai/Aoi Rin - Phone Only - [999]',
	content({ title: 'Phone Only', site: 'NHENTAI', url: '/g/999/', pages: [{ name: '0001' }] }),
	['0001.jpg']
);
// tsundoku downloaded Ch. 1 too, beside the fixture's 2 and 3.
const tsundokuWeeb = join(
	tsundokuMihon,
	'downloads',
	'Weeb Central (EN)',
	'Drawing_ Saikyou Mangaka'
);
writeFileSync(
	join(tsundokuWeeb, 'Unknown_Chapter 1_abc1.cbz'),
	cbz(
		comicInfo({
			title: 'Chapter 1',
			series: 'Drawing: Saikyou Mangaka',
			number: 1,
			web: 'https://weebcentral.com/chapters/AAA1',
			source: 'Weeb Central'
		}),
		11
	)
);
// The library's backup is newer and knows a Ch. 4 nobody downloaded.
writeFileSync(
	join(rootMihon, 'autobackup', 'app.mihon_2026-09-23_08-00.tachibk'),
	gzipSync(backup([4]))
);
// The phone downloaded Ch. 1 of the same manga; nothing may read it.
const phoneWeeb = join(phoneMihon, 'downloads', 'Weeb Central (EN)', 'Drawing_ Saikyou Mangaka');
rmSync(join(phoneWeeb, 'Unknown_Chapter 3_abc3.cbz'));

const db = () => getDb();
const drawing = () =>
	db().prepare(`SELECT id, path FROM series WHERE title = 'Drawing: Saikyou Mangaka'`).all() as {
		id: number;
		path: string;
	}[];
const chapters = (id: number) =>
	db()
		.prepare(`SELECT label, available, file FROM entries WHERE series_id = ? ORDER BY position`)
		.all(id) as { label: string; available: number; file: string }[];
const snapshot = () =>
	db()
		.prepare(
			`SELECT s.title, s.path, e.label, e.file, e.available FROM entries e JOIN series s ON s.id = e.series_id ORDER BY e.id`
		)
		.all();

beforeAll(async () => {
	await runImport(library, { now: 1_800_000_000_000 });
});

describe('one library after c191', () => {
	it('reads the library’s backup and tsundoku’s downloads, not a device’s Mihon folder', () => {
		expect(sourcesIn(library).map((s) => [s.name, s.device])).toEqual([
			['Mihon', null],
			['Hentoid', null],
			['Hentoid', 'phone'],
			['Mihon', 'tsundoku']
		]);
		// The phone's Hentoid book is here; nothing from its Mihon copy is.
		expect(db().prepare(`SELECT name FROM roots ORDER BY id`).all()).toEqual([
			{ name: 'Mihon' },
			{ name: 'Hentoid' }
		]);
		expect(db().prepare(`SELECT id FROM series WHERE title = 'Phone Only'`).get()).toBeTruthy();
	});

	it('makes one series of what both devices have, with no second root', () => {
		const dupes = db()
			.prepare(`SELECT title FROM series GROUP BY title, root_id HAVING COUNT(*) > 1`)
			.all();
		expect(dupes).toEqual([]);
		expect(drawing()).toHaveLength(1);
	});

	it('takes each chapter from the device that has it, every file where it says', () => {
		const [d] = drawing();
		expect(d.path).toBe(
			join(tsundokuMihon, 'downloads', 'Weeb Central (EN)', 'Drawing_ Saikyou Mangaka')
		);
		expect(chapters(d.id).map((c) => [c.label, c.available])).toEqual([
			['Ch. 1', 1],
			['Ch. 2', 1],
			['Ch. 3', 1],
			['Ch. 4', 0]
		]);
		// Not downloaded: no file, not the folder of the device that knew of it.
		expect(chapters(d.id)[3].file).toBe('');
		for (const c of chapters(d.id).slice(0, 3))
			expect(existsSync(join(d.path, c.file)), c.file).toBe(true);
	});

	it('changes nothing on a rescan', async () => {
		const before = snapshot();
		const r = await runImport(library, { now: 1_800_000_100_000 });
		expect(r.sources.every((s) => s.seriesCreated === 0)).toBe(true);
		expect(snapshot()).toEqual(before);
	});

	it('marks missing only what left the device that had it', async () => {
		rmSync(join(tsundokuWeeb, 'Unknown_Chapter 1_abc1.cbz'));
		await runImport(library, { now: 1_800_000_200_000 });
		const [d] = drawing();
		expect(chapters(d.id).map((c) => [c.label, c.available])).toEqual([
			['Ch. 1', 0],
			['Ch. 2', 1],
			['Ch. 3', 1],
			['Ch. 4', 0]
		]);
	});

	it('groups a book from each device into one series, both still found', () => {
		const idOf = (t: string) =>
			(db().prepare(`SELECT id FROM series WHERE title = ?`).get(t) as { id: number }).id;
		const r = groupIntoSeries({
			seriesIds: [idOf('Summer Days'), idOf('Phone Only')],
			name: 'Across'
		});
		const s = db().prepare(`SELECT path FROM series WHERE id = ?`).get(r.seriesId) as {
			path: string;
		};
		const files = db().prepare(`SELECT file FROM entries WHERE series_id = ?`).all(r.seriesId) as {
			file: string;
		}[];
		expect(files).toHaveLength(2);
		for (const f of files) expect(existsSync(join(s.path, f.file)), f.file).toBe(true);
	});
});

/** A manga a backup lists, with the chapters it has (their URLs and numbers). */
const manga = (
	source: bigint,
	url: string,
	title: string,
	chapters: { n: number; url: string }[]
): Msg => [
	[1, source],
	[2, url],
	[3, title],
	...chapters.map((c): [number, Msg] => [
		16,
		[
			[1, c.url],
			[2, `Chapter ${c.n}`],
			[9, { f32: c.n }],
			[10, 10 - c.n]
		]
	])
];

/**
 * A download neither backup listed when it was imported, while the other
 * device's backup knows the manga (doc/IMPORT-MIHON.md, "Before the backup
 * knows it"). The folder's series is the backup's series: it takes the URL
 * key, its chapters the backup's paths, and the owner's reading, rating,
 * shelves, tags, links and history stay on the same series.
 *
 * One folder root: a download tsundoku wrote into `devices/tsundoku`, and the
 * library's backup that names it, arriving in the same scan.
 */
describe('a folder the library’s backup names', () => {
	const at = 1_800_000_300_000;
	const flowersDir = join(tsundokuMihon, 'downloads', 'Weeb Central (EN)', 'The Flowers of Evil');
	const sluggedDir = join(tsundokuMihon, 'downloads', 'Asura Scans (EN)', 'Slugged Tale');
	const reverseDir = join(tsundokuMihon, 'downloads', 'Weeb Central (EN)', 'Reverse Tale');
	const FLOWERS_DIR = 'mihon-dir:Weeb Central (EN)/The Flowers of Evil';
	const SLUGGED_DIR = 'mihon-dir:Asura Scans (EN)/Slugged Tale';
	const REVERSE_DIR = 'mihon-dir:Weeb Central (EN)/Reverse Tale';
	const FLOWERS = `mihon:${WEEB}:/series/flowers-of-evil`;
	const REVERSE = `mihon:${WEEB}:/series/reverse-tale`;

	const one = <T>(sql: string, ...args: unknown[]) =>
		db()
			.prepare(sql)
			.get(...args) as T;
	const all = <T>(sql: string, ...args: unknown[]) =>
		db()
			.prepare(sql)
			.all(...args) as T[];
	const byKey = (key: string) =>
		one<{ id: number } | undefined>(`SELECT id FROM series WHERE origin_key = ?`, key)?.id;

	let flowers: number;
	let slugged: number;

	beforeAll(async () => {
		// What tsundoku downloaded before any backup named it.
		const chapter = (
			dir: string,
			file: string,
			series: string,
			source: string,
			n: number,
			web: string
		) => {
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, file),
				cbz(comicInfo({ title: `Chapter ${n}`, series, number: n, web, source }))
			);
		};
		for (const [n, file] of [
			[1, 'Chapter 1.cbz'],
			[2, 'Chapter 2.cbz'],
			[9, 'Extra.cbz']
		] as [number, string][])
			chapter(
				flowersDir,
				file,
				'The Flowers of Evil',
				'Weeb Central',
				n,
				`https://weebcentral.com/chapters/FLO${n}`
			);
		chapter(
			sluggedDir,
			'Chapter 1.cbz',
			'Slugged Tale',
			'Asura Scans',
			1,
			'https://asuracomic.net/series/slugged-tale-abc123/chapter/1'
		);

		await runImport(library, { now: at });
		flowers = byKey(FLOWERS_DIR)!;
		slugged = byKey(SLUGGED_DIR)!;
		expect(flowers && slugged).toBeTruthy();

		// What the owner did with each folder's series while it was on its own.
		const entryOf = (series: number, label: string) =>
			one<{ id: number }>(`SELECT id FROM entries WHERE series_id = ? AND label = ?`, series, label)
				.id;
		const first = entryOf(flowers, 'Ch. 1');
		db()
			.prepare(`UPDATE entries SET read_at = ?, last_opened_at = ?, last_position = 7 WHERE id = ?`)
			.run(at + 1_000, at + 2_000, first);
		db()
			.prepare(
				`INSERT INTO reading_events (at, series_id, entry_id, kind, page, duration_ms)
				VALUES (?, ?, ?, 'finish', 7, 90000)`
			)
			.run(at + 2_000, flowers, first);
		db().prepare(`UPDATE series SET rating = 4, favourite = 1 WHERE id = ?`).run(flowers);
		const shelf = Number(
			db().prepare(`INSERT INTO collections (name, position) VALUES ('Adopted shelf', 0)`).run()
				.lastInsertRowid
		);
		db()
			.prepare(`INSERT INTO collection_series (collection_id, series_id) VALUES (?, ?)`)
			.run(shelf, flowers);
		db().prepare(`INSERT OR IGNORE INTO tags (namespace, value) VALUES ('genre', 'tragedy')`).run();
		const tag = one<{ id: number }>(
			`SELECT id FROM tags WHERE namespace = 'genre' AND value = 'tragedy'`
		).id;
		db().prepare(`INSERT INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(flowers, tag);
		db()
			.prepare(
				`INSERT INTO series_links (series_id, mal_id, via, linked_at) VALUES (?, 147272, 'mihon', ?)`
			)
			.run(flowers, at);

		// A download and the backup that names it arriving together, the other
		// way round from the two above: no folder's series exists yet.
		chapter(
			reverseDir,
			'Chapter 1.cbz',
			'Reverse Tale',
			'Weeb Central',
			1,
			'https://weebcentral.com/chapters/RVT1'
		);

		// The library's backup, naming all three.
		writeFileSync(
			join(rootMihon, 'autobackup', 'app.mihon_2026-09-24_08-00.tachibk'),
			gzipSync(
				backup(
					[],
					[
						manga(WEEB, '/series/flowers-of-evil', 'The Flowers of Evil', [
							{ n: 1, url: '/chapters/FLO1' },
							{ n: 2, url: '/chapters/FLO2' }
						]),
						manga(ASURA, '/series/slugged-tale', 'Slugged Tale', [
							{ n: 1, url: '/series/slugged-tale/chapter/1' }
						]),
						manga(WEEB, '/series/reverse-tale', 'Reverse Tale', [{ n: 1, url: '/chapters/RVT1' }])
					]
				)
			)
		);
		await runImport(library, { now: at + 10_000 });
	});

	it('gives the folder’s series the URL key, and keeps its id', () => {
		expect(byKey(FLOWERS_DIR)).toBeUndefined();
		expect(byKey(SLUGGED_DIR)).toBeUndefined();
		expect(byKey(FLOWERS)).toBe(flowers);
		expect(byKey(`mihon:${ASURA}:/series/slugged-tale`)).toBe(slugged);
		expect(
			one<{ n: number }>(`SELECT COUNT(*) AS n FROM series WHERE title IN
			('The Flowers of Evil', 'Slugged Tale', 'Reverse Tale')`).n
		).toBe(3);
	});

	it('matches chapters by the Web URL’s suffix, then by number', () => {
		// Weeb Central: the ComicInfo URL ends with the backup's path.
		expect(
			all<{ source_url: string; available: number }>(
				`SELECT source_url, available FROM entries WHERE series_id = ? AND label = 'Ch. 1'`,
				flowers
			)
		).toEqual([{ source_url: '/chapters/FLO1', available: 1 }]);
		// Asura adds a slug hash to its URLs, so only the number matches.
		expect(
			all<{ source_url: string; available: number; file: string }>(
				`SELECT source_url, available, file FROM entries WHERE series_id = ?`,
				slugged
			)
		).toEqual([
			{ source_url: '/series/slugged-tale/chapter/1', available: 1, file: 'Chapter 1.cbz' }
		]);
	});

	it('keeps a file that matches neither, rather than dropping it', () => {
		const extra = all<{ source_url: string; available: number; file: string }>(
			`SELECT source_url, available, file FROM entries WHERE series_id = ? AND label = 'Ch. 9'`,
			flowers
		);
		expect(extra).toEqual([
			{ source_url: 'https://weebcentral.com/chapters/FLO9', available: 1, file: 'Extra.cbz' }
		]);
	});

	it('loses no read state, setting, shelf, tag or link', () => {
		expect(
			one<{ rating: number; favourite: number }>(
				`SELECT rating, favourite FROM series WHERE id = ?`,
				flowers
			)
		).toEqual({ rating: 4, favourite: 1 });
		const read = one<{
			read_at: number | null;
			last_opened_at: number | null;
			last_position: number | null;
		}>(
			`SELECT read_at, last_opened_at, last_position FROM entries WHERE series_id = ? AND label = 'Ch. 1'`,
			flowers
		);
		expect(read).toEqual({
			read_at: at + 1_000,
			last_opened_at: at + 2_000,
			last_position: 7
		});
		expect(
			all<{ series_id: number }>(`SELECT series_id FROM reading_events WHERE at = ?`, at + 2_000)
		).toEqual([{ series_id: flowers }]);
		expect(
			all(
				`SELECT c.name FROM collections c JOIN collection_series cs ON cs.collection_id = c.id
				WHERE cs.series_id = ?`,
				flowers
			)
		).toEqual([{ name: 'Adopted shelf' }]);
		expect(
			all<{ value: string }>(
				`SELECT t.value FROM tags t JOIN series_tags st ON st.tag_id = t.id
				WHERE st.series_id = ? AND t.namespace = 'genre' ORDER BY t.value`,
				flowers
			)
		).toEqual([{ value: 'action' }, { value: 'tragedy' }]);
		expect(
			one<{ mal_id: number }>(`SELECT mal_id FROM series_links WHERE series_id = ?`, flowers)
		).toEqual({ mal_id: 147272 });
	});

	it('folds a download into the series the backup named, when both arrive at once', () => {
		expect(byKey(REVERSE_DIR)).toBeUndefined();
		expect(byKey(REVERSE)).toBeDefined();
		expect(
			all<{ available: number; file: string }>(
				`SELECT available, file FROM entries WHERE series_id = ?`,
				byKey(REVERSE)!
			)
		).toEqual([{ available: 1, file: 'Chapter 1.cbz' }]);
	});

	it('settles both keys, so no scan makes the folder’s series again', async () => {
		const r = await runImport(library, { now: at + 20_000 });
		expect(r.sources.every((s) => s.seriesCreated === 0)).toBe(true);
		expect(byKey(FLOWERS_DIR)).toBeUndefined();
		expect(byKey(SLUGGED_DIR)).toBeUndefined();
		expect(byKey(REVERSE_DIR)).toBeUndefined();
		expect(byKey(FLOWERS)).toBe(flowers);
		expect(
			all<{ origin_key: string }>(
				`SELECT origin_key FROM series_former_keys WHERE series_id = ? ORDER BY origin_key`,
				flowers
			)
		).toEqual([{ origin_key: FLOWERS_DIR }]);
		// No second entry for a chapter a repeat scan meets again by its file.
		expect(
			all<{ label: string }>(
				`SELECT label FROM entries WHERE series_id = ? ORDER BY position`,
				flowers
			).map((e) => e.label)
		).toEqual(['Ch. 1', 'Ch. 2', 'Ch. 9']);
	});
});

/**
 * The two pairs an adoption cannot settle: a library series beside a browsing
 * record, and a folder whose chapters share nothing with the backup's. Both
 * stay two series. Folding into the record would take a downloaded, rated,
 * read series out of the library and let it be forgotten; adopting the
 * folder's series on its name alone would list every chapter twice
 * (doc/IMPORT-MIHON.md, "Before the backup knows it").
 */
describe('two pairs an adoption cannot match up', () => {
	const at = 1_800_000_600_000;
	const tablet = tsundokuMihon;
	const browsingDir = join(tablet, 'downloads', 'Asura Scans (EN)', 'Browsing Title');
	const numberedDir = join(tablet, 'downloads', 'Weeb Central (EN)', 'Numbered Ahead');
	const bareDir = join(tablet, 'downloads', 'Weeb Central (EN)', 'No Metadata');
	const BROWSING_DIR = 'mihon-dir:Asura Scans (EN)/Browsing Title';
	const BROWSING = `mihon:${ASURA}:/series/browsing-title`;
	const NUMBERED_DIR = 'mihon-dir:Weeb Central (EN)/Numbered Ahead';
	const NUMBERED = `mihon:${WEEB}:/series/numbered-ahead`;
	const BARE_DIR = 'mihon-dir:Weeb Central (EN)/No Metadata';
	const BARE = `mihon:${WEEB}:/series/no-metadata`;

	const one = <T>(sql: string, ...args: unknown[]) =>
		db()
			.prepare(sql)
			.get(...args) as T;
	const all = <T>(sql: string, ...args: unknown[]) =>
		db()
			.prepare(sql)
			.all(...args) as T[];
	const byKey = (key: string) =>
		one<{ id: number } | undefined>(`SELECT id FROM series WHERE origin_key = ?`, key)?.id;

	let browsing: number;
	let numbered: number;
	let bare: number;
	let record: number;

	beforeAll(async () => {
		const chapter = (
			dir: string,
			file: string,
			series: string,
			source: string,
			n: number,
			web: string
		) => {
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, file),
				cbz(comicInfo({ title: `Chapter ${n}`, series, number: n, web, source }))
			);
		};
		chapter(
			browsingDir,
			'Chapter 1.cbz',
			'Browsing Title',
			'Asura Scans',
			1,
			'https://asuracomic.net/series/browsing-title-abc123/chapter/1'
		);
		// Numbered from 1, where the backup counts from 5.
		for (const n of [1, 2])
			chapter(
				numberedDir,
				`Chapter ${n}.cbz`,
				'Numbered Ahead',
				'Weeb Central',
				n,
				`https://weebcentral.com/chapters/NUM${n}`
			);
		// Mihon's chapter metadata off: no ComicInfo at all, so the label is the file's.
		mkdirSync(bareDir, { recursive: true });
		for (const n of [1, 2])
			writeFileSync(
				join(bareDir, `Chapter ${n}.cbz`),
				zip([
					{ name: '001.png', data: Buffer.alloc(16, n) },
					{ name: '002.png', data: Buffer.alloc(16, n + 1) }
				])
			);

		await runImport(library, { now: at });
		browsing = byKey(BROWSING_DIR)!;
		numbered = byKey(NUMBERED_DIR)!;
		bare = byKey(BARE_DIR)!;
		expect(browsing && numbered && bare).toBeTruthy();

		// What the owner did with the library's series while it was on its own.
		const first = one<{ id: number }>(
			`SELECT id FROM entries WHERE series_id = ? AND label = 'Ch. 1'`,
			browsing
		).id;
		db()
			.prepare(`UPDATE entries SET read_at = ?, last_opened_at = ?, last_position = 3 WHERE id = ?`)
			.run(at + 1_000, at + 2_000, first);
		db().prepare(`UPDATE series SET rating = 4 WHERE id = ?`).run(browsing);

		// A record on the same root: the series opened from the source's preview
		// without ADD, which every shelf, count and search leaves out
		// (doc/BROWSING.md).
		record = Number(
			db()
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, indexed_at, source,
						origin_key, in_library, browsed_at)
					SELECT root_id, 'Browsing Title', 'manga', ?, ?, 'mihon', ?, 0, ?
					FROM series WHERE id = ?`
				)
				.run(at, at, BROWSING, at, browsing).lastInsertRowid
		);
		db()
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, source_url, available)
				VALUES (?, 0, 'Ch. 1', ?, '/series/browsing-title/chapter/1', 0)`
			)
			.run(record, at);
		db()
			.prepare(`INSERT OR IGNORE INTO tags (namespace, value) VALUES ('source', 'Asura Scans')`)
			.run();
		const tag = one<{ id: number }>(
			`SELECT id FROM tags WHERE namespace = 'source' AND value = 'Asura Scans'`
		).id;
		db().prepare(`INSERT INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(record, tag);

		// The library's backup names all three; tsundoku's folder has them.
		writeFileSync(
			join(rootMihon, 'autobackup', 'app.mihon_2026-09-29_08-00.tachibk'),
			gzipSync(
				backup(
					[],
					[
						manga(ASURA, '/series/browsing-title', 'Browsing Title', [
							{ n: 1, url: '/series/browsing-title/chapter/1' }
						]),
						manga(WEEB, '/series/numbered-ahead', 'Numbered Ahead', [
							{ n: 5, url: '/chapters/NUM5' },
							{ n: 6, url: '/chapters/NUM6' }
						]),
						manga(WEEB, '/series/no-metadata', 'No Metadata', [
							{ n: 1, url: '/chapters/NoMeta1' },
							{ n: 2, url: '/chapters/NoMeta2' }
						])
					]
				)
			)
		);
		await runImport(library, { now: at + 10_000 });
	});

	it('never folds a library series into a browsing record', () => {
		// The folder's series is still the library's, under its own key and id.
		expect(byKey(BROWSING_DIR)).toBe(browsing);
		expect(
			one<{ in_library: number }>(`SELECT in_library FROM series WHERE id = ?`, browsing)
		).toEqual({ in_library: 1 });
		expect(one<{ rating: number }>(`SELECT rating FROM series WHERE id = ?`, browsing)).toEqual({
			rating: 4
		});
		expect(
			all<{ label: string; read_at: number | null; last_opened_at: number | null; file: string }>(
				`SELECT label, read_at, last_opened_at, file FROM entries WHERE series_id = ?`,
				browsing
			)
		).toEqual([
			{
				label: 'Ch. 1',
				read_at: at + 1_000,
				last_opened_at: at + 2_000,
				file: 'Chapter 1.cbz'
			}
		]);
		// The record keeps its own key, and is still a record.
		expect(byKey(BROWSING)).toBe(record);
		expect(
			one<{ in_library: number }>(`SELECT in_library FROM series WHERE id = ?`, record)
		).toEqual({ in_library: 0 });
		expect(all<{ label: string }>(`SELECT label FROM entries WHERE series_id = ?`, record)).toEqual(
			[{ label: 'Ch. 1' }]
		);
	});

	it('refuses to adopt a folder whose chapters the backup does not share', () => {
		// Two series, both under the keys they had: nothing was renamed.
		expect(byKey(NUMBERED_DIR)).toBe(numbered);
		expect(byKey(NUMBERED)).toBeDefined();
		expect(byKey(NUMBERED)).not.toBe(numbered);
		// The folder's chapters keep their files and their ComicInfo URLs, once.
		expect(
			all<{ label: string; available: number; file: string; source_url: string }>(
				`SELECT label, available, file, source_url FROM entries WHERE series_id = ? ORDER BY position`,
				numbered
			)
		).toEqual([
			{
				label: 'Ch. 1',
				available: 1,
				file: 'Chapter 1.cbz',
				source_url: 'https://weebcentral.com/chapters/NUM1'
			},
			{
				label: 'Ch. 2',
				available: 1,
				file: 'Chapter 2.cbz',
				source_url: 'https://weebcentral.com/chapters/NUM2'
			}
		]);
		// The backup's chapters sit beside them, not doubled into them: not downloaded.
		expect(
			all<{ label: string; available: number; file: string }>(
				`SELECT label, available, file FROM entries WHERE series_id = ? ORDER BY position`,
				byKey(NUMBERED)!
			)
		).toEqual([
			{ label: 'Ch. 5', available: 0, file: '' },
			{ label: 'Ch. 6', available: 0, file: '' }
		]);
	});

	it('refuses the same when there is no ComicInfo, whose labels differ', () => {
		expect(byKey(BARE_DIR)).toBe(bare);
		expect(byKey(BARE)).not.toBe(bare);
		expect(
			all<{ label: string; available: number; file: string }>(
				`SELECT label, available, file FROM entries WHERE series_id = ? ORDER BY position`,
				bare
			).map((e) => [e.label, e.available, e.file])
		).toEqual([
			['Chapter 1', 1, 'Chapter 1.cbz'],
			['Chapter 2', 1, 'Chapter 2.cbz']
		]);
		expect(
			all<{ label: string; available: number }>(
				`SELECT label, available FROM entries WHERE series_id = ? ORDER BY position`,
				byKey(BARE)!
			)
		).toEqual([
			{ label: 'Ch. 1', available: 0 },
			{ label: 'Ch. 2', available: 0 }
		]);
	});

	it('settles: a rescan creates neither series again, and doubles no chapter', async () => {
		const r = await runImport(library, { now: at + 20_000 });
		expect(r.sources.every((s) => s.seriesCreated === 0)).toBe(true);
		expect(byKey(BROWSING_DIR)).toBe(browsing);
		expect(byKey(BROWSING)).toBe(record);
		expect(byKey(NUMBERED_DIR)).toBe(numbered);
		expect(byKey(BARE_DIR)).toBe(bare);
		expect(
			all<{ n: number }>(
				`SELECT COUNT(*) AS n FROM entries WHERE series_id IN (?, ?)`,
				numbered,
				byKey(NUMBERED)!
			)
		).toEqual([{ n: 4 }]);
		expect(
			all<{ n: number }>(
				`SELECT COUNT(*) AS n FROM entries WHERE series_id IN (?, ?)`,
				bare,
				byKey(BARE)!
			)
		).toEqual([{ n: 4 }]);
	});
});

/**
 * The same-device door: this root has the folder's download *and* the backup
 * that names it, and a browsing record already holds the URL key (the manga
 * was opened from a source's preview without ADD). The card's rule holds at
 * every door -- a record is never the survivor -- so the record's data moves
 * into the library's series and its row goes.
 */
describe('a record under the URL key this device’s own backup names', () => {
	const seriesDir = join(tsundokuMihon, 'downloads', 'Asura Scans (EN)', 'Adopted Tale');
	const DIR = 'mihon-dir:Asura Scans (EN)/Adopted Tale';
	const URL = `mihon:${ASURA}:/series/adopted-tale`;
	const at = 1_800_001_000_000;
	let folder: number;
	let record: number;

	const one = <T>(sql: string, ...args: unknown[]) =>
		db()
			.prepare(sql)
			.get(...args) as T;
	const all = <T>(sql: string, ...args: unknown[]) =>
		db()
			.prepare(sql)
			.all(...args) as T[];
	const byKey = (key: string) =>
		one<{ id: number } | undefined>(`SELECT id FROM series WHERE origin_key = ?`, key)?.id;

	beforeAll(async () => {
		// The download on its own: keyed by its folder, as a scan before the backup knew it.
		mkdirSync(seriesDir, { recursive: true });
		writeFileSync(
			join(seriesDir, 'Chapter 1.cbz'),
			cbz(
				comicInfo({
					title: 'Chapter 1',
					series: 'Adopted Tale',
					number: 1,
					web: 'https://asuracomic.net/series/adopted-tale-abc123/chapter/1',
					source: 'Asura Scans'
				})
			)
		);
		await runImport(library, { now: at });
		folder = byKey(DIR)!;
		expect(folder).toBeTruthy();

		const entry = one<{ id: number }>(
			`SELECT id FROM entries WHERE series_id = ? AND label = 'Ch. 1'`,
			folder
		).id;
		db().prepare(`UPDATE series SET rating = 4, favourite = 1 WHERE id = ?`).run(folder);
		db()
			.prepare(`UPDATE entries SET read_at = ?, last_opened_at = ?, last_position = 5 WHERE id = ?`)
			.run(at + 1_000, at + 2_000, entry);

		// A record under the URL key: the preview opened without ADD (doc/BROWSING.md).
		record = Number(
			db()
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, indexed_at, source,
						origin_key, in_library, browsed_at)
					SELECT root_id, 'Adopted Tale', 'manhwa', ?, ?, 'mihon', ?, 0, ?
					FROM series WHERE id = ?`
				)
				.run(at, at, URL, at, folder).lastInsertRowid
		);
		db()
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, source_url, available)
				VALUES (?, 0, 'Ch. 1', ?, '/series/adopted-tale/chapter/1', 0)`
			)
			.run(record, at);

		writeFileSync(
			join(tsundokuMihon, 'autobackup', 'app.mihon_2026-10-05_08-00.tachibk'),
			gzipSync(
				backup(
					[],
					[
						manga(ASURA, '/series/adopted-tale', 'Adopted Tale', [
							{ n: 1, url: '/series/adopted-tale/chapter/1' }
						])
					]
				)
			)
		);
		await runImport(library, { now: at + 10_000 });
	});

	it('leaves the library series the survivor, not the record', () => {
		expect(byKey(URL)).toBe(folder);
		expect(byKey(DIR)).toBeUndefined();
		expect(
			one<{ in_library: number; rating: number; favourite: number }>(
				`SELECT in_library, rating, favourite FROM series WHERE id = ?`,
				folder
			)
		).toEqual({ in_library: 1, rating: 4, favourite: 1 });
		// The record's row went; its entry's state came across.
		expect(byKey(URL)).not.toBe(record);
		expect(all<{ id: number }>(`SELECT id FROM series WHERE id = ?`, record)).toEqual([]);
	});

	it('re-keys the chapter to the backup’s path, keeping its file and its reading', () => {
		expect(
			all<{ source_url: string; available: number; file: string; read_at: number | null }>(
				`SELECT source_url, available, file, read_at FROM entries WHERE series_id = ?`,
				folder
			)
		).toEqual([
			{
				source_url: '/series/adopted-tale/chapter/1',
				available: 1,
				file: 'Chapter 1.cbz',
				read_at: at + 1_000
			}
		]);
	});

	it('settles: no rescan makes either series again', async () => {
		const r = await runImport(library, { now: at + 20_000 });
		expect(r.sources.every((s) => s.seriesCreated === 0)).toBe(true);
		expect(byKey(URL)).toBe(folder);
		expect(byKey(DIR)).toBeUndefined();
		expect(
			all<{ n: number }>(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ?`, folder)
		).toEqual([{ n: 1 }]);
	});
});

/**
 * One chapter number, two files: two scanlators of it, downloaded by tsundoku
 * while the library's backup knows one chapter. The folder's plan meets the
 * series the backup made, and its label fallback must not let the second
 * planned chapter take the first one's entry -- or the first file is left on
 * disk with nothing pointing at it.
 */
describe('two files of one chapter number', () => {
	const seriesDir = join(tsundokuMihon, 'downloads', 'Asura Scans (EN)', 'Twin Scan');
	const URL = `mihon:${ASURA}:/series/twin-scan`;
	const at = 1_800_002_000_000;
	let id: number;

	const all = <T>(sql: string, ...args: unknown[]) =>
		db()
			.prepare(sql)
			.all(...args) as T[];
	const byKey = (key: string) =>
		(
			db().prepare(`SELECT id FROM series WHERE origin_key = ?`).get(key) as
				{ id: number } | undefined
		)?.id;

	beforeAll(async () => {
		// The library's backup names it first, and tsundoku has downloaded nothing.
		writeFileSync(
			join(rootMihon, 'autobackup', 'app.mihon_2026-10-06_08-00.tachibk'),
			gzipSync(
				backup(
					[],
					[
						manga(ASURA, '/series/twin-scan', 'Twin Scan', [
							{ n: 1, url: '/series/twin-scan/chapter/1' }
						])
					]
				)
			)
		);
		await runImport(library, { now: at });
		id = byKey(URL)!;
		expect(id).toBeTruthy();

		// Then the tablet downloads that chapter from two scanlators: both say number 1.
		mkdirSync(seriesDir, { recursive: true });
		for (const [file, web] of [
			['Chapter 1 (A).cbz', 'https://asuracomic.net/series/twin-scan/chapter/1?scanlator=A'],
			['Chapter 1 (B).cbz', 'https://asuracomic.net/series/twin-scan/chapter/1?scanlator=B']
		])
			writeFileSync(
				join(seriesDir, file),
				cbz(
					comicInfo({
						title: 'Chapter 1',
						series: 'Twin Scan',
						number: 1,
						web,
						source: 'Asura Scans'
					})
				)
			);
		await runImport(library, { now: at + 10_000 });
	});

	it('folds the folder into the backup’s series', () => {
		expect(byKey(URL)).toBe(id);
		expect(byKey('mihon-dir:Asura Scans (EN)/Twin Scan')).toBeUndefined();
	});

	it('keeps an entry for each file, none overwriting the other', () => {
		expect(
			all<{ available: number; file: string }>(
				`SELECT available, file FROM entries WHERE series_id = ? AND label = 'Ch. 1' ORDER BY file`,
				id
			)
		).toEqual([
			{ available: 1, file: 'Chapter 1 (A).cbz' },
			{ available: 1, file: 'Chapter 1 (B).cbz' }
		]);
	});

	it('leaves both on a rescan', async () => {
		await runImport(library, { now: at + 20_000 });
		expect(
			all<{ n: number }>(
				`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND available = 1`,
				id
			)
		).toEqual([{ n: 2 }]);
	});
});

/**
 * The card's own case, and the friend's: the backup is all this library
 * reads. The folder-keyed series was imported before (an earlier version, or
 * another library) and no scan reaches it now, so the adoption has to come
 * from the backup's source and title, not from a scanned plan
 * (doc/IMPORT-MIHON.md, "Before the backup knows it").
 */
describe('a backup adopts a folder nothing scans any more', () => {
	const l = mkdtempSync(join(tmpdir(), 'tsundoku-backup-only-'));
	const root = join(l, 'Mihon');
	const seriesPath = join(root, 'downloads', 'Weeb Central (EN)', 'Kept Tale');
	const DIR = 'mihon-dir:Weeb Central (EN)/Kept Tale';
	const URL = `mihon:${WEEB}:/series/kept-tale`;
	const at = 1_800_003_000_000;
	let folder: number;

	const one = <T>(sql: string, ...args: unknown[]) =>
		db()
			.prepare(sql)
			.get(...args) as T;
	const all = <T>(sql: string, ...args: unknown[]) =>
		db()
			.prepare(sql)
			.all(...args) as T[];
	const byKey = (key: string) =>
		one<{ id: number } | undefined>(`SELECT id FROM series WHERE origin_key = ?`, key)?.id;

	beforeAll(async () => {
		mkdirSync(join(root, 'autobackup'), { recursive: true });
		// What an earlier import of the folder left: its own key, its files, its
		// ComicInfo URLs and a read mark.
		const rootId = ensureRoot(db(), 'Mihon', root, false);
		mkdirSync(seriesPath, { recursive: true });
		for (const n of [1, 2])
			writeFileSync(
				join(seriesPath, `Chapter ${n}.cbz`),
				cbz(
					comicInfo({
						title: `Chapter ${n}`,
						series: 'Kept Tale',
						number: n,
						web: `https://weebcentral.com/chapters/KEPT${n}`,
						source: 'Weeb Central'
					})
				)
			);
		folder = Number(
			db()
				.prepare(
					`INSERT INTO series (root_id, title, kind, rating, favourite, added_at, indexed_at,
						source, path, origin_key, in_library)
					VALUES (?, 'Kept Tale', 'manga', 0, 0, ?, ?, 'mihon', ?, ?, 1)`
				)
				.run(rootId, at, at, seriesPath, DIR).lastInsertRowid
		);
		const add = db().prepare(
			`INSERT INTO entries (series_id, position, label, added_at, source_url, available, file,
				bytes, page_count)
			VALUES (?, ?, ?, ?, ?, 1, ?, 100, 3)`
		);
		add.run(folder, 1, 'Ch. 1', at, `https://weebcentral.com/chapters/KEPT1`, 'Chapter 1.cbz');
		add.run(folder, 2, 'Ch. 2', at, `https://weebcentral.com/chapters/KEPT2`, 'Chapter 2.cbz');
		db()
			.prepare(
				`UPDATE entries SET read_at = ?, last_opened_at = ?, last_position = 4 WHERE series_id = ? AND label = 'Ch. 1'`
			)
			.run(at + 1_000, at + 2_000, folder);

		// Only a backup is read from here on.
		writeFileSync(
			join(root, 'autobackup', 'app.mihon_2026-10-07_08-00.tachibk'),
			gzipSync(
				backup(
					[],
					[
						manga(WEEB, '/series/kept-tale', 'Kept Tale', [
							{ n: 1, url: '/chapters/KEPT1' },
							{ n: 2, url: '/chapters/KEPT2' }
						])
					]
				)
			)
		);
		await runImport(l, { now: at + 10_000 });
	});

	it('gives the folder’s series the URL key, with its id', () => {
		expect(byKey(DIR)).toBeUndefined();
		expect(byKey(URL)).toBe(folder);
	});

	it('matches chapters by URL suffix, keeping their files and reading', () => {
		expect(
			all<{ label: string; source_url: string; available: number; file: string }>(
				`SELECT label, source_url, available, file FROM entries WHERE series_id = ? ORDER BY position`,
				folder
			).map((e) => [e.label, e.source_url, e.available, e.file])
		).toEqual([
			['Ch. 1', '/chapters/KEPT1', 1, 'Chapter 1.cbz'],
			['Ch. 2', '/chapters/KEPT2', 1, 'Chapter 2.cbz']
		]);
		expect(
			one<{ read_at: number | null }>(
				`SELECT read_at FROM entries WHERE series_id = ? AND label = 'Ch. 1'`,
				folder
			)
		).toEqual({ read_at: at + 1_000 });
	});

	it('settles: nothing is created again', async () => {
		const r = await runImport(l, { now: at + 20_000 });
		expect(r.sources.every((s) => s.seriesCreated === 0)).toBe(true);
		expect(byKey(URL)).toBe(folder);
	});
});

/**
 * A mirror's series after c191 (doc/IMPORT-MIHON.md, "What a mirror left
 * behind"): its row, its path and its files stay, and nothing reads the folder
 * any more. Then tsundoku downloads a chapter of it into its own device: the
 * two files are one series, so its path widens to the folder both are under
 * and every entry's file is rewritten against it (write.ts, `widenTo`). Get
 * that rewrite wrong and every file of the series stops resolving -- reader,
 * covers and DELETE all join the two -- with no test failing.
 */
describe('a download that widens a series a mirror left', () => {
	const at = 1_800_004_000_000;
	const mirrorPath = join(rootMihon, 'downloads', 'Weeb Central (EN)', 'Split Tale');
	const devicePath = join(tsundokuMihon, 'downloads', 'Weeb Central (EN)', 'Split Tale');
	const DIR = 'mihon-dir:Weeb Central (EN)/Split Tale';
	let id: number;

	beforeAll(async () => {
		// What an earlier import of the library's own `Mihon/downloads` left:
		// a folder-keyed series, available, its file on disk. The folder is not
		// read now: only `autobackup` is.
		const rootId = ensureRoot(db(), 'Mihon', rootMihon, false);
		mkdirSync(mirrorPath, { recursive: true });
		writeFileSync(
			join(mirrorPath, 'Chapter 1.cbz'),
			cbz(
				comicInfo({
					title: 'Chapter 1',
					series: 'Split Tale',
					number: 1,
					web: 'https://weebcentral.com/chapters/SPL1',
					source: 'Weeb Central'
				})
			)
		);
		id = Number(
			db()
				.prepare(
					`INSERT INTO series (root_id, title, kind, rating, favourite, added_at, indexed_at,
						source, path, origin_key, in_library)
					VALUES (?, 'Split Tale', 'manga', 0, 0, ?, ?, 'mihon', ?, ?, 1)`
				)
				.run(rootId, at, at, mirrorPath, DIR).lastInsertRowid
		);
		db()
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, source_url, available, file,
					bytes, page_count)
				VALUES (?, 1, 'Ch. 1', ?, 'https://weebcentral.com/chapters/SPL1', 1, 'Chapter 1.cbz',
					100, 3)`
			)
			.run(id, at);

		// A different chapter of it, downloaded by tsundoku into its own device.
		mkdirSync(devicePath, { recursive: true });
		writeFileSync(
			join(devicePath, 'Chapter 2.cbz'),
			cbz(
				comicInfo({
					title: 'Chapter 2',
					series: 'Split Tale',
					number: 2,
					web: 'https://weebcentral.com/chapters/SPL2',
					source: 'Weeb Central'
				})
			)
		);
		await runImport(library, { now: at });
	});

	it('keeps one series, its path the folder both files are under', () => {
		expect(db().prepare(`SELECT id, path FROM series WHERE origin_key = ?`).get(DIR)).toEqual({
			id,
			path: library
		});
		expect(
			db().prepare(`SELECT COUNT(*) AS n FROM series WHERE title = 'Split Tale'`).get()
		).toEqual({ n: 1 });
	});

	it('resolves every available entry from there, the mirror’s file too', () => {
		const rows = db()
			.prepare(
				`SELECT label, file FROM entries WHERE series_id = ? AND available = 1 ORDER BY position`
			)
			.all(id) as { label: string; file: string }[];
		expect(rows.map((r) => r.label)).toEqual(['Ch. 1', 'Ch. 2']);
		for (const r of rows) expect(existsSync(join(library, r.file)), r.file).toBe(true);
		// The mirror's chapter still names the mirror's own file, the new one this device's.
		expect(join(library, rows[0].file)).toBe(join(mirrorPath, 'Chapter 1.cbz'));
		expect(join(library, rows[1].file)).toBe(join(devicePath, 'Chapter 2.cbz'));
	});

	it('changes nothing on a rescan', async () => {
		const before = snapshot();
		const r = await runImport(library, { now: at + 10_000 });
		expect(r.sources.every((s) => s.seriesCreated === 0)).toBe(true);
		expect(snapshot()).toEqual(before);
	});
});

/**
 * The series' own settings, where a fold has to choose: title, kind and
 * direction cannot be kept from both rows. A folder's series the owner renamed
 * no longer answers to its folder's name -- which is why a backup's row was
 * made beside it -- so that name goes to the survivor, with the kind and
 * direction set alongside it. One still named as its folder carries no edit,
 * and the survivor keeps its own (doc/IMPORT-MIHON.md, "Before the backup
 * knows it").
 */
describe('a renamed folder series a backup adopts', () => {
	const at = 1_800_005_000_000;
	const dirOf = (name: string) => join(tsundokuMihon, 'downloads', 'Weeb Central (EN)', name);
	const RENAMED_DIR = 'mihon-dir:Weeb Central (EN)/Renamed Tale';
	const RENAMED = `mihon:${WEEB}:/series/renamed-tale`;
	const PLAIN_DIR = 'mihon-dir:Weeb Central (EN)/Plain Tale';
	const PLAIN = `mihon:${WEEB}:/series/plain-tale`;
	let renamed: number;
	let plain: number;

	const one = <T>(sql: string, ...args: unknown[]) =>
		db()
			.prepare(sql)
			.get(...args) as T;
	const byKey = (key: string) =>
		one<{ id: number } | undefined>(`SELECT id FROM series WHERE origin_key = ?`, key)?.id;

	beforeAll(async () => {
		const rootId = ensureRoot(db(), 'Mihon', rootMihon, false);
		const tag = `INSERT OR IGNORE INTO tags (namespace, value) VALUES ('source', 'Weeb Central')`;
		db().prepare(tag).run();
		const tagId = one<{ id: number }>(
			`SELECT id FROM tags WHERE namespace = 'source' AND value = 'Weeb Central'`
		).id;
		// Two pairs as an earlier import left them: the series a backup's plan
		// made (the survivor, its chapters addressed by the backup's path), and
		// the folder's series beside it, its chapter downloaded.
		const seed = (key: string, title: string, kind: string, path: string) =>
			Number(
				db()
					.prepare(
						`INSERT INTO series (root_id, title, kind, rating, favourite, added_at, indexed_at,
							source, status, path, origin_key, in_library)
						VALUES (?, ?, ?, 0, 0, ?, ?, 'mihon', '', ?, ?, 1)`
					)
					.run(rootId, title, kind, at, at, path, key).lastInsertRowid
			);
		const entry = (series: number, web: string, available: number, file: string) =>
			db()
				.prepare(
					`INSERT INTO entries (series_id, position, label, added_at, source_url, available, file)
					VALUES (?, 1, 'Ch. 1', ?, ?, ?, ?)`
				)
				.run(series, at, web, available, file);

		renamed = seed(RENAMED, 'Renamed Tale', 'manga', '');
		plain = seed(PLAIN, 'Plain Tale', 'manga', '');
		for (const id of [renamed, plain])
			db().prepare(`INSERT INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(id, tagId);
		entry(renamed, '/chapters/RN1', 0, '');
		entry(plain, '/chapters/PL1', 0, '');

		// What tsundoku downloaded, keyed by its folder. The owner renamed the
		// first and set its kind and direction; the other is as its import left it.
		const folder = (name: string, title: string, kind: string, direction: string | null) => {
			const dir = dirOf(name);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, 'Chapter 1.cbz'),
				cbz(
					comicInfo({
						title: 'Chapter 1',
						series: name,
						number: 1,
						web: `https://weebcentral.com/chapters/${name === 'Plain Tale' ? 'PL1' : 'RN1'}`,
						source: 'Weeb Central'
					})
				)
			);
			const id = Number(
				db()
					.prepare(
						`INSERT INTO series (root_id, title, kind, direction, rating, favourite, added_at,
							indexed_at, source, path, origin_key, in_library)
						VALUES (?, ?, ?, ?, 0, 0, ?, ?, 'mihon', ?, ?, 1)`
					)
					.run(rootId, title, kind, direction, at, at, dir, `mihon-dir:Weeb Central (EN)/${name}`)
					.lastInsertRowid
			);
			entry(
				id,
				`https://weebcentral.com/chapters/${name === 'Plain Tale' ? 'PL1' : 'RN1'}`,
				1,
				'Chapter 1.cbz'
			);
			return id;
		};
		folder('Renamed Tale', 'My Own Name', 'manhwa', 'rtl');
		folder('Plain Tale', 'Plain Tale', 'manhwa', 'rtl');

		await runImport(library, { now: at });
	});

	it('carries the name the owner gave it, with the kind and direction', () => {
		expect(byKey(RENAMED_DIR)).toBeUndefined();
		expect(byKey(RENAMED)).toBe(renamed);
		expect(
			one<{ title: string; kind: string; direction: string | null }>(
				`SELECT title, kind, direction FROM series WHERE id = ?`,
				renamed
			)
		).toEqual({ title: 'My Own Name', kind: 'manhwa', direction: 'rtl' });
		// Its chapter still answers to the backup's path, with the folder's file.
		expect(
			one<{ source_url: string; available: number; file: string }>(
				`SELECT source_url, available, file FROM entries WHERE series_id = ?`,
				renamed
			)
		).toEqual({ source_url: '/chapters/RN1', available: 1, file: 'Chapter 1.cbz' });
	});

	it('keeps the survivor’s own where the folder is still named as its folder', () => {
		expect(byKey(PLAIN_DIR)).toBeUndefined();
		expect(byKey(PLAIN)).toBe(plain);
		expect(
			one<{ title: string; kind: string; direction: string | null }>(
				`SELECT title, kind, direction FROM series WHERE id = ?`,
				plain
			)
		).toEqual({ title: 'Plain Tale', kind: 'manga', direction: null });
	});

	it('settles: a rescan creates neither series again', async () => {
		const r = await runImport(library, { now: at + 20_000 });
		expect(r.sources.every((s) => s.seriesCreated === 0)).toBe(true);
		expect(byKey(RENAMED)).toBe(renamed);
		expect(byKey(PLAIN)).toBe(plain);
	});
});

/**
 * c389: an import's fold is a writer of `hidden` too, so it keeps the one rule
 * (doc/WORKS.md): a Work is hidden or shown whole. Each pair here is a folder's
 * series and the series the library's backup names, which could not be matched
 * while they shared no chapter (the backup counts from 5, the folder from 1),
 * so both exist, and the owner grouped and hid them while they did. Then
 * tsundoku downloads chapter 5, the folder's plan meets the backup's series by
 * it (`adoptNamed`), and the folder's series is folded into it.
 */
describe('a fold keeps a Work hidden or shown whole (c389)', () => {
	const at = 1_800_003_000_000;
	const works = () => import('$lib/server/works');
	const one = <T>(sql: string, ...args: unknown[]) =>
		db()
			.prepare(sql)
			.get(...args) as T;
	const byKey = (key: string) =>
		one<{ id: number } | undefined>(`SELECT id FROM series WHERE origin_key = ?`, key)?.id;
	const dirOf = (title: string) => join(tsundokuMihon, 'downloads', 'Weeb Central (EN)', title);
	const DIR = (title: string) => `mihon-dir:Weeb Central (EN)/${title}`;
	const URL = (slug: string) => `mihon:${WEEB}:/series/${slug}`;
	const chapter = (title: string, slug: string, n: number) => {
		mkdirSync(dirOf(title), { recursive: true });
		writeFileSync(
			join(dirOf(title), `Chapter ${n}.cbz`),
			cbz(
				comicInfo({
					title: `Chapter ${n}`,
					series: title,
					number: n,
					web: `https://weebcentral.com/chapters/${slug}-${n}`,
					source: 'Weeb Central'
				})
			)
		);
	};
	const visibility = async (workId: number) => {
		const parts = (await works()).workParts(workId, true);
		return parts.length === 0 ? 'none' : parts.map((p) => (p.hidden ? 'hidden' : 'visible'));
	};

	/** Folded pairs: [folder title, slug]. Partners are folders the backup never names. */
	const PAIRS = [
		['Fold Into Part', 'fold-into-part'],
		['Fold From Part', 'fold-from-part'],
		['Fold Both Parts', 'fold-both-parts']
	] as const;
	const PARTNERS = [
		'Fold Partner One',
		'Fold Partner Two',
		'Fold Partner Three',
		'Fold Partner Four'
	];
	const ids: Record<string, { folder: number; named: number }> = {};
	const partner: Record<string, number> = {};
	const made: Record<string, number> = {};
	/** What the run that folds the three pairs dropped, over its sources, and its job. */
	let folding: { dropped: import('$lib/server/import/fold').Dropped[]; jobId: number } | undefined;

	beforeAll(async () => {
		for (const [title, slug] of PAIRS) for (const n of [1, 2]) chapter(title, slug, n);
		for (const title of PARTNERS) chapter(title, title.toLowerCase().replace(/ /g, '-'), 1);
		writeFileSync(
			join(rootMihon, 'autobackup', 'app.mihon_2026-10-20_08-00.tachibk'),
			gzipSync(
				backup(
					[],
					PAIRS.map(([title, slug]) =>
						manga(WEEB, `/series/${slug}`, title, [
							{ n: 5, url: `/chapters/${slug}-5` },
							{ n: 6, url: `/chapters/${slug}-6` }
						])
					)
				)
			)
		);
		await runImport(library, { now: at });
		for (const [title, slug] of PAIRS) {
			ids[title] = { folder: byKey(DIR(title))!, named: byKey(URL(slug))! };
			expect(ids[title].folder && ids[title].named).toBeTruthy();
			expect(ids[title].folder).not.toBe(ids[title].named);
		}
		for (const title of PARTNERS) partner[title] = byKey(DIR(title))!;

		// What the owner did while both rows existed, through the app's own writes.
		const w = await works();
		// Shape 1: `into` (the backup's) a part of a visible Work; `from` hidden.
		const one1 = ids['Fold Into Part'];
		made.into = w.createWork({
			seriesIds: [one1.named, partner['Fold Partner One']],
			name: 'Into Work',
			now: at
		}).work.id;
		w.setHiddenWhole([one1.folder], true);
		// Shape 2: `from` (the folder's) a visible part; `into` hidden, in no Work.
		const two = ids['Fold From Part'];
		made.from = w.createWork({
			seriesIds: [two.folder, partner['Fold Partner Two']],
			name: 'From Work',
			now: at
		}).work.id;
		w.setHiddenWhole([two.named], true);
		// Shape 3: each in a Work of its own, `from`'s hidden, `into`'s visible.
		const three = ids['Fold Both Parts'];
		made.hiddenWork = w.createWork({
			seriesIds: [three.folder, partner['Fold Partner Three']],
			name: 'Hidden Work',
			now: at
		}).work.id;
		w.setHiddenWhole([three.folder], true);
		made.shownWork = w.createWork({
			seriesIds: [three.named, partner['Fold Partner Four']],
			name: 'Shown Work',
			now: at
		}).work.id;
		expect(await visibility(made.into)).toEqual(['visible', 'visible']);
		expect(await visibility(made.from)).toEqual(['visible', 'visible']);
		expect(await visibility(made.hiddenWork)).toEqual(['hidden', 'hidden']);

		// tsundoku downloads chapter 5 of each: the pair now shares one, and folds.
		for (const [title, slug] of PAIRS) chapter(title, slug, 5);
		// Every source's: the library's backup and tsundoku's downloads are two.
		const summary = await runImport(library, { now: at + 10_000 });
		folding = { dropped: summary.sources.flatMap((x) => x.dropped), jobId: summary.jobId };
		for (const [title] of PAIRS) expect(byKey(DIR(title))).toBeUndefined();
	});

	it('hides the Work `into` is a part of when `from` was hidden, rather than leave one part hidden', async () => {
		const { named } = ids['Fold Into Part'];
		expect((await works()).workOfSeries(named)?.id).toBe(made.into);
		// Before c389: `hidden = MAX(...)` made the backup's series a hidden part
		// of a visible Work -- ['hidden', 'visible'], the mixed state.
		expect(await visibility(made.into)).toEqual(['hidden', 'hidden']);
	});

	it('hides the Work `into` joins in `from`’s place when `into` was hidden', async () => {
		const { named } = ids['Fold From Part'];
		// The membership moved to the survivor, at the folder's own place.
		expect((await works()).workOfSeries(named)?.id).toBe(made.from);
		expect(await visibility(made.from)).toEqual(['hidden', 'hidden']);
	});

	it('keeps `into`’s own Work when both were parts: `from`’s Work ends, and the survivor’s goes whole', async () => {
		const { named } = ids['Fold Both Parts'];
		const w = await works();
		// A series is in one Work at most: `into` keeps its own, `from`'s row is
		// dropped with it, and the Work left with one ends (rung 61's trigger).
		expect(w.workOfSeries(named)?.id).toBe(made.shownWork);
		expect(w.workPage(made.hiddenWork, { reveal: true })).toBeNull();
		expect(w.workOfSeries(partner['Fold Partner Three'])).toBeNull();
		// `from` was hidden, so the survivor is, and its Work with it.
		expect(await visibility(made.shownWork)).toEqual(['hidden', 'hidden']);
	});

	it('names the Work the third shape dropped in the import’s summary, and only that one (c472)', async () => {
		const { droppedLine } = await import('$lib/server/import/fold');
		// Reached through the importer's own door: the scan that folded the
		// pairs. Shapes 1 and 2 kept every membership (one Work between them);
		// shape 3 lost Hidden Work, which then ended with one series.
		expect(folding?.dropped).toEqual([
			{
				work: 'Hidden Work',
				series: 'Fold Both Parts',
				ended: true,
				workId: made.hiddenWork,
				workAt: at,
				seriesId: ids['Fold Both Parts'].named,
				seriesAt: one<{ a: number }>(
					`SELECT added_at AS a FROM series WHERE id = ?`,
					ids['Fold Both Parts'].named
				).a
			}
		]);
		expect(folding!.dropped.map(droppedLine)).toEqual([
			'DROPPED FROM HIDDEN WORK · Fold Both Parts · THE WORK ENDED'
		]);
	});

	it('shows the dropped Work in IMPORT LOG, through the page’s own load, from that scan (c570)', async () => {
		const { load } = await import('../src/routes/import/log/+page.server');
		const { REVEAL_COOKIE, revealValue } = await import('$lib/server/prefs');
		const logOf = async (reveal: boolean) =>
			(await load({
				cookies: {
					get: (name: string) =>
						reveal && name === REVEAL_COOKIE ? revealValue(undefined) : undefined
				}
			} as never)) as {
				entries: { kind: string; id: number; dropped: { line: string; workId: number | null }[] }[];
			};
		// The scan's own entry, and only it, names the Work. It ended, so no link.
		const revealed = (await logOf(true)).entries;
		const scan = revealed.find((e) => e.kind === 'scan' && e.id === folding!.jobId);
		expect(scan?.dropped).toEqual([
			{ line: 'DROPPED FROM HIDDEN WORK · Fold Both Parts · THE WORK ENDED', workId: null }
		]);
		expect(revealed.filter((e) => e.dropped.length > 0).map((e) => e.id)).toEqual([folding!.jobId]);
		// The survivor is hidden (`from` was), and hidden means hidden: with
		// reveal off the line is not there, though the scan's entry is.
		const plain = (await logOf(false)).entries.find(
			(e) => e.kind === 'scan' && e.id === folding!.jobId
		);
		expect(plain).toBeDefined();
		expect(plain?.dropped).toEqual([]);
	});

	it('links a dropped Work only while that Work, by id and created_at, still exists (c570)', async () => {
		const w = await works();
		const { droppedOf } = await import('$lib/server/import/log');
		// Two visible series in no Work, from the library's first scans.
		const free = db()
			.prepare(
				`SELECT s.id, s.added_at FROM series s JOIN roots r ON r.id = s.root_id
				WHERE s.hidden = 0 AND r.hidden = 0 AND s.in_library = 1
					AND s.id NOT IN (SELECT series_id FROM work_series)
				ORDER BY s.id LIMIT 3`
			)
			.all() as { id: number; added_at: number }[];
		expect(free).toHaveLength(3);
		const kept = w.createWork({
			seriesIds: [free[0].id, free[1].id],
			name: 'Kept Work',
			now: at + 20_000
		}).work;
		const stored = (workId: number, workAt: number, ended = false) =>
			JSON.stringify([
				{
					work: 'Kept Work',
					series: 'Survivor',
					ended,
					workId,
					workAt,
					seriesId: free[2].id,
					seriesAt: free[2].added_at
				}
			]);
		const line = 'DROPPED FROM KEPT WORK · Survivor';
		// The Work is there: linked, reveal on or off (its parts are visible).
		expect(droppedOf(stored(kept.id, at + 20_000), false)).toEqual([{ line, workId: kept.id }]);
		expect(droppedOf(stored(kept.id, at + 20_000), true)).toEqual([{ line, workId: kept.id }]);
		// The same id with another created_at is another Work: no link.
		expect(droppedOf(stored(kept.id, at + 19_999), true)).toEqual([{ line, workId: null }]);
		// The Work ends, and a new one takes its id (the newest row went): still no link.
		w.ungroup(kept.id);
		expect(w.workPage(kept.id, { reveal: true })).toBeNull();
		const next = w.createWork({
			seriesIds: [free[0].id, free[1].id],
			name: 'Next Work',
			now: at + 30_000
		}).work;
		expect(next.id).toBe(kept.id);
		expect(droppedOf(stored(kept.id, at + 20_000), true)).toEqual([{ line, workId: null }]);
		w.ungroup(next.id);
		// A survivor whose id another series took is not read as visible.
		expect(
			droppedOf(
				JSON.stringify([
					{
						work: 'W',
						series: 'S',
						ended: true,
						workId: 0,
						workAt: 0,
						seriesId: free[2].id,
						seriesAt: 1
					}
				]),
				false
			)
		).toEqual([]);
		// Whatever is stored that is not a list of drops is no line.
		for (const bad of ['', 'null', '{}', '[1, null, {"work": 3}]'])
			expect(droppedOf(bad, true)).toEqual([]);
	});

	it('draws no dropped line, reveal off, once the Work it names is hidden after the fold (c570 r2)', async () => {
		const w = await works();
		const { droppedOf } = await import('$lib/server/import/log');
		const free = db()
			.prepare(
				`SELECT s.id, s.added_at FROM series s JOIN roots r ON r.id = s.root_id
				WHERE s.hidden = 0 AND r.hidden = 0 AND s.in_library = 1
					AND s.id NOT IN (SELECT series_id FROM work_series)
				ORDER BY s.id LIMIT 3`
			)
			.all() as { id: number; added_at: number }[];
		expect(free).toHaveLength(3);
		// The Work the fold left: still alive, with two other visible parts.
		const secret = w.createWork({
			seriesIds: [free[0].id, free[1].id],
			name: 'Secret Work',
			now: at + 40_000
		}).work;
		const stored = (ended: boolean) =>
			JSON.stringify([
				{
					work: 'Secret Work',
					series: 'Survivor',
					ended,
					workId: secret.id,
					workAt: at + 40_000,
					seriesId: free[2].id,
					seriesAt: free[2].added_at
				}
			]);
		const line = 'DROPPED FROM SECRET WORK · Survivor';
		try {
			// Visible survivor, visible Work: drawn and linked, reveal off.
			expect(droppedOf(stored(false), false)).toEqual([{ line, workId: secret.id }]);
			// HIDE ALL on that Work, through works' own door; the survivor stays shown.
			expect(w.hideWork(secret.id, true).changed).toBe(2);
			expect(
				one<{ hidden: number }>(`SELECT hidden FROM series WHERE id = ?`, free[2].id).hidden
			).toBe(0);
			// Reveal off: the hidden Work's name is not drawn.
			expect(droppedOf(stored(false), false)).toEqual([]);
			// Reveal on: drawn, and linked by the existing rule.
			expect(droppedOf(stored(false), true)).toEqual([{ line, workId: secret.id }]);
		} finally {
			w.hideWork(secret.id, false);
			w.ungroup(secret.id);
		}
		// A Work that ended adds no condition: a visible survivor's line is drawn, reveal off.
		expect(droppedOf(stored(true), false)).toEqual([
			{ line: `${line} · THE WORK ENDED`, workId: null }
		]);
	});

	it('keeps on the job’s row whether the survivor was hidden at its fold (c633)', () => {
		const kept = JSON.parse(
			one<{ dropped: string }>(`SELECT dropped FROM scan_jobs WHERE id = ?`, folding!.jobId).dropped
		) as { work: string; hiddenAtFold?: boolean }[];
		// Reached through the importer's own door: the scan that folded the pairs.
		expect(kept).toEqual([expect.objectContaining({ work: 'Hidden Work', hiddenAtFold: true })]);
	});

	describe('with reveal off, what belongs to hidden series is counted and never named (c633)', () => {
		type Entry = {
			kind: string;
			id: number;
			dropped: { line: string }[];
			hidden: {
				fresh: number;
				merged: number;
				noSource: number;
				dropped: number;
			} | null;
		};
		const logOf = async (reveal: boolean) => {
			const { load } = await import('../src/routes/import/log/+page.server');
			const { REVEAL_COOKIE, revealValue } = await import('$lib/server/prefs');
			return (
				(await load({
					cookies: {
						get: (name: string) =>
							reveal && name === REVEAL_COOKIE ? revealValue(undefined) : undefined
					}
				} as never)) as unknown as { entries: Entry[] }
			).entries;
		};
		const scanOf = (entries: Entry[]) =>
			entries.find((e) => e.kind === 'scan' && e.id === folding!.jobId)!;
		// Written with a name of the fold's own, as the report would have printed it.
		const SECRET = /HIDDEN WORK|Hidden Work|Fold Both Parts|Fold Partner/;

		it('counts the scan’s hidden fold and prints neither its Work nor its survivor', async () => {
			const entries = await logOf(false);
			const scan = scanOf(entries);
			expect(scan.dropped).toEqual([]);
			expect(scan.hidden?.dropped).toBe(1);
			expect(JSON.stringify(entries)).not.toMatch(SECRET);
		});

		it('keeps the ended Work’s line off the list when its survivor is unhidden alone (the card’s own state)', async () => {
			const w = await works();
			const survivor = ids['Fold Both Parts'].named;
			// Before c633 this one door printed the Work's name again.
			expect(w.setHiddenWhole([survivor], false)).toBeTruthy();
			try {
				expect(one<{ h: number }>(`SELECT hidden AS h FROM series WHERE id = ?`, survivor).h).toBe(
					0
				);
				// The Work's other part is still hidden.
				expect(
					one<{ h: number }>(
						`SELECT hidden AS h FROM series WHERE id = ?`,
						partner['Fold Partner Three']
					).h
				).toBe(1);
				const entries = await logOf(false);
				const scan = scanOf(entries);
				expect(scan.dropped).toEqual([]);
				expect(scan.hidden?.dropped).toBe(1);
				expect(JSON.stringify(entries)).not.toMatch(/HIDDEN WORK|Hidden Work/);
				// Reveal on, every line, where it always was, and nothing counted apart.
				const revealed = scanOf(await logOf(true));
				expect(revealed.dropped.map((d) => d.line)).toEqual([
					'DROPPED FROM HIDDEN WORK · Fold Both Parts · THE WORK ENDED'
				]);
				expect(revealed.hidden).toBeNull();
			} finally {
				w.setHiddenWhole([survivor], true);
			}
		});

		it('counts on every job exactly when it has something hidden, and is absent otherwise', async () => {
			const scans = (await logOf(false)).filter((e) => e.kind === 'scan');
			expect(scans.length).toBeGreaterThan(1);
			for (const e of scans) {
				const series = one<{ n: number }>(
					`SELECT COUNT(*) AS n FROM series s JOIN roots r ON r.id = s.root_id
					WHERE s.scan_job_id = ? AND (s.hidden = 1 OR (r.hidden = 1 AND s.public = 0))`,
					e.id
				).n;
				const kept = (
					JSON.parse(
						one<{ dropped: string }>(`SELECT dropped FROM scan_jobs WHERE id = ?`, e.id).dropped
					) as { hiddenAtFold?: boolean }[]
				).filter((d) => d.hiddenAtFold).length;
				expect({ id: e.id, hidden: e.hidden }).toEqual({
					id: e.id,
					hidden:
						series + kept === 0 ? null : { fresh: series, merged: 0, noSource: 0, dropped: kept }
				});
			}
			expect(scans.some((e) => e.hidden === null)).toBe(true);
			// With reveal on, nothing is counted apart, a job's hidden series included.
			const job = db()
				.prepare(
					`INSERT INTO scan_jobs (started_at, finished_at, source_label, dismissed_at)
					VALUES (?, ?, 'c633 scan', ?)`
				)
				.run(at, at, at).lastInsertRowid as number;
			const row = db()
				.prepare(
					`INSERT INTO series (root_id, title, kind, hidden, added_at, indexed_at, scan_job_id)
					VALUES ((SELECT id FROM roots WHERE hidden = 0 LIMIT 1), 'c633 Hidden Scan', 'manga', 1, ?, ?, ?)`
				)
				.run(at, at, job).lastInsertRowid;
			try {
				const of = (entries: Entry[]) => entries.find((e) => e.kind === 'scan' && e.id === job)!;
				expect(of(await logOf(false)).hidden).toMatchObject({ fresh: 1, dropped: 0 });
				expect(of(await logOf(true)).hidden).toBeNull();
			} finally {
				db().prepare(`DELETE FROM series WHERE id = ?`).run(row);
				db().prepare(`DELETE FROM scan_jobs WHERE id = ?`).run(job);
			}
		});

		it('a backup’s new and merged hidden series, and its hidden root’s, are counted; reveal on counts none', async () => {
			const { backupEntry } = await import('$lib/server/import/log');
			const { importRow } = await import('$lib/server/import/backup');
			const hid = db()
				.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Hentoid c633', '/c633/h', 1)`)
				.run().lastInsertRowid;
			const add = (title: string, hidden: number, root: number | bigint) =>
				db()
					.prepare(
						`INSERT INTO series (root_id, title, kind, hidden, added_at, indexed_at)
						VALUES (?, ?, 'manga', ?, ?, ?)`
					)
					.run(root, title, hidden, at, at).lastInsertRowid;
			const plainRoot = one<{ id: number }>(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).id;
			const shown = add('Report Shown', 0, plainRoot);
			const fresh = add('Report Hidden New', 1, plainRoot);
			const merged = add('Report Hidden Merged', 1, plainRoot);
			const hentoid = add('Report Hentoid', 0, hid);
			const made = db()
				.prepare(
					`INSERT INTO imports (created_at, app, file_name, state, finished_at)
					VALUES (?, 'mihon', 'r.tachibk', 'done', ?)`
				)
				.run(at, at).lastInsertRowid as number;
			const put = db().prepare(
				`INSERT INTO import_series (import_id, series_id, created) VALUES (?, ?, ?)`
			);
			put.run(made, shown, 1);
			put.run(made, fresh, 1);
			put.run(made, merged, 0);
			put.run(made, hentoid, 1);
			try {
				const row = importRow(made)!;
				const off = backupEntry(row, false);
				expect(off.counts).toMatchObject({ fresh: 1, merged: 0 });
				expect(off.hidden).toMatchObject({ fresh: 2, merged: 1, dropped: 0 });
				expect(JSON.stringify(off)).not.toMatch(/Report H/);
				const on = backupEntry(row, true);
				expect(on.counts).toMatchObject({ fresh: 3, merged: 1 });
				expect(on.hidden).toBeNull();
				// SETTINGS' last-import line reads the entry's counts and follows reveal.
				db().prepare(`UPDATE series SET hidden = 0 WHERE id IN (?, ?)`).run(fresh, merged);
				db().prepare(`UPDATE series SET public = 1 WHERE id = ?`).run(hentoid);
				expect(backupEntry(row, false).hidden).toBeNull();
			} finally {
				db().prepare(`DELETE FROM imports WHERE id = ?`).run(made);
				db()
					.prepare(`DELETE FROM series WHERE id IN (?, ?, ?, ?)`)
					.run(shown, fresh, merged, hentoid);
				db().prepare(`DELETE FROM roots WHERE id = ?`).run(hid);
			}
		});

		it('every path through the rule: drawn, counted or neither', async () => {
			const { droppedOf } = await import('$lib/server/import/log');
			const w = await works();
			const free = db()
				.prepare(
					`SELECT s.id, s.added_at FROM series s JOIN roots r ON r.id = s.root_id
					WHERE s.hidden = 0 AND r.hidden = 0 AND s.in_library = 1
						AND s.id NOT IN (SELECT series_id FROM work_series)
					ORDER BY s.id LIMIT 3`
				)
				.all() as { id: number; added_at: number }[];
			expect(free).toHaveLength(3);
			const live = w.createWork({
				seriesIds: [free[0].id, free[1].id],
				name: 'Rule Work',
				now: at + 50_000
			}).work;
			const line = (over: Record<string, unknown>) => ({
				work: 'Rule Work',
				series: 'Rule Survivor',
				ended: true,
				workId: 0,
				workAt: 0,
				seriesId: free[2].id,
				seriesAt: free[2].added_at,
				...over
			});
			const shape = (d: object) => droppedOf(JSON.stringify([d]), false);
			// The count, read as the page reads it: a job of its own holding this one line.
			const counted = async (d: object) => {
				const job = db()
					.prepare(
						`INSERT INTO scan_jobs (started_at, finished_at, source_label, dismissed_at, dropped)
						VALUES (?, ?, 'c633', ?, ?)`
					)
					.run(at, at, at, JSON.stringify([d])).lastInsertRowid as number;
				try {
					return (await logOf(false)).find((e) => e.kind === 'scan' && e.id === job)!.hidden
						?.dropped;
				} finally {
					db().prepare(`DELETE FROM scan_jobs WHERE id = ?`).run(job);
				}
			};
			try {
				// Ended, nothing hidden when it folded: an open line, as it always was.
				expect(shape(line({ hiddenAtFold: false }))).toHaveLength(1);
				expect(await counted(line({ hiddenAtFold: false }))).toBeUndefined();
				// From before c633, its survivor hidden now: off the list and counted.
				db().prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(free[2].id);
				try {
					expect(shape(line({}))).toEqual([]);
					expect(await counted(line({}))).toBe(1);
				} finally {
					db().prepare(`UPDATE series SET hidden = 0 WHERE id = ?`).run(free[2].id);
				}
				// A survivor gone and a Work gone, with no record: nothing can say. Neither.
				const lost = line({ seriesAt: 1 });
				expect(shape(lost)).toEqual([]);
				expect(await counted(lost)).toBeUndefined();
				// The same with the record: it was hidden, so it is counted.
				expect(await counted(line({ seriesAt: 1, hiddenAtFold: true }))).toBe(1);
				// Ended, and from before c633: nothing recorded it, so as it was.
				expect(shape(line({}))).toHaveLength(1);
				// Ended and hidden at its fold: off the list, whoever is shown today.
				expect(shape(line({ hiddenAtFold: true }))).toEqual([]);
				expect(await counted(line({ hiddenAtFold: true }))).toBe(1);
				// A Work alive and shown wins over the record: it can be asked.
				expect(
					shape(
						line({
							ended: false,
							workId: live.id,
							workAt: at + 50_000,
							hiddenAtFold: true
						})
					)
				).toHaveLength(1);
				// A Work alive and hidden is off the list, as c570 r2 made it, and counted.
				w.hideWork(live.id, true);
				const hiddenWork = line({
					ended: false,
					workId: live.id,
					workAt: at + 50_000,
					hiddenAtFold: false
				});
				expect(shape(hiddenWork)).toEqual([]);
				expect(await counted(hiddenWork)).toBe(1);
			} finally {
				w.hideWork(live.id, false);
				w.ungroup(live.id);
			}
		});
	});

	it('never leaves any Work in the library hidden in part', () => {
		expect(
			one<{ n: number }>(
				`SELECT COUNT(*) AS n FROM (
					SELECT ws.work_id FROM work_series ws JOIN series s ON s.id = ws.series_id
					JOIN roots r ON r.id = s.root_id
					GROUP BY ws.work_id
					HAVING COUNT(DISTINCT (s.hidden = 1 OR (r.hidden = 1 AND s.public = 0))) > 1
				)`
			).n
		).toBe(0);
	});
});

/**
 * A backup with no `sources` entry (c258; doc/IMPORT-MIHON.md, "A backup that
 * names no source"): the URL series it makes carries no `source:` tag and no
 * download folder, so the source cannot be read from it. Built first, as the
 * card asks, then tsundoku's downloads of the same manga arrive. The second
 * signal is the chapter's own address (ComicInfo's `Web` ending with the
 * backup's chapter path) under the exact title, or the engine's own name for
 * the key's source; a title and chapter numbers alone stay apart.
 */
describe('a backup that names no source (c258)', () => {
	const at = 1_800_004_000_000;
	const ADDRESSED = 9_300_000_000_000_000_001n;
	const ENGINE = 9_300_000_000_000_000_002n;
	const series = (title: string) =>
		db().prepare(`SELECT id, origin_key FROM series WHERE title = ? ORDER BY id`).all(title) as {
			id: number;
			origin_key: string;
		}[];
	const download = (sourceDir: string, title: string, n: number, web: string) => {
		const dir = join(tsundokuMihon, 'downloads', sourceDir, title);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, `Chapter ${n}.cbz`),
			cbz(
				comicInfo({
					title: `Chapter ${n}`,
					series: title,
					number: n,
					web,
					source: sourceDir.replace(/ \(.*\)$/, '')
				})
			)
		);
	};
	const keysOf = (title: string) => series(title).map((s) => s.origin_key);
	let folderFirstId = 0;
	/** The library's backup, with its manga and no source list at all; later with Folder First too. */
	const writeUntagged = async (folderFirst: boolean) => {
		const { encode } = await import('./helpers/protobuf-writer');
		const list: Msg[] = [
			manga(ADDRESSED, '/series/untagged-pair', 'Untagged Pair', [
				{ n: 1, url: '/chapters/untagged-1' },
				{ n: 2, url: '/chapters/untagged-2' }
			]),
			manga(ADDRESSED, '/series/numbers-only', 'Numbers Only', [
				{ n: 1, url: '/chapters/numbers-1' }
			]),
			manga(ENGINE, '/series/engine-named', 'Engine Named', [{ n: 1, url: '/chapters/engine-1' }]),
			...(folderFirst
				? [
						manga(ADDRESSED, '/series/folder-first', 'Folder First', [
							{ n: 1, url: '/chapters/first-1' }
						])
					]
				: [])
		];
		writeFileSync(
			join(rootMihon, 'autobackup', 'app.mihon_2026-11-05_09-00.tachibk'),
			gzipSync(encode(list.map((m): [number, Msg] => [1, m])))
		);
	};

	beforeAll(async () => {
		// A download that arrives before any backup names its manga: the other order.
		download('Untagged Scans (EN)', 'Folder First', 1, 'https://untagged.example/chapters/first-1');
		await writeUntagged(false);
		await runImport(library, { now: at });
		for (const t of ['Untagged Pair', 'Numbers Only', 'Engine Named'])
			expect(keysOf(t)).toHaveLength(1);
		const tagged = db()
			.prepare(
				`SELECT COUNT(*) AS n FROM series_tags st JOIN tags t ON t.id = st.tag_id JOIN series s ON s.id = st.series_id
				WHERE t.namespace = 'source' AND s.title IN ('Untagged Pair', 'Numbers Only', 'Engine Named')`
			)
			.get() as { n: number };
		expect(tagged.n).toBe(0);

		// The engine has one of the two sources installed, under its own name.
		db()
			.prepare(
				`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
				VALUES ('c258.named', 'Named Scans', 'manga', 1, '1', '1.5', 'h', ?, ?)`
			)
			.run(at, at);
		db()
			.prepare(
				`INSERT INTO engine_sources (id, pkg, name, lang) VALUES (?, 'c258.named', 'Named Scans', 'en')`
			)
			.run(String(ENGINE));

		// Then tsundoku downloads a chapter of each. Untagged Pair's ComicInfo
		// names the chapter's address; Numbers Only's names another site's, so
		// only its number matches; Engine Named's names another address too.
		download(
			'Untagged Scans (EN)',
			'Untagged Pair',
			1,
			'https://untagged.example/chapters/untagged-1'
		);
		download('Untagged Scans (EN)', 'Numbers Only', 1, 'https://elsewhere.example/read/77');
		download('Named Scans (EN)', 'Engine Named', 1, 'https://elsewhere.example/read/78');
		expect(keysOf('Folder First')).toEqual(['mihon-dir:Untagged Scans (EN)/Folder First']);
		folderFirstId = series('Folder First')[0].id;
		await writeUntagged(true);
		await runImport(library, { now: at + 10_000 });
	});

	it('folds the download into the series the backup named, by the chapter’s own address', () => {
		expect(keysOf('Untagged Pair')).toEqual([`mihon:${ADDRESSED}:/series/untagged-pair`]);
		const [{ id }] = series('Untagged Pair');
		expect(chapters(id)).toEqual([
			{ label: 'Ch. 1', available: 1, file: 'Chapter 1.cbz' },
			{ label: 'Ch. 2', available: 0, file: '' }
		]);
	});

	it('folds it by the engine’s name for the source, when only the number matches', () => {
		expect(keysOf('Engine Named')).toEqual([`mihon:${ENGINE}:/series/engine-named`]);
	});

	it('gives a folder’s series the backup’s key in the other order too, keeping its id', () => {
		expect(keysOf('Folder First')).toEqual([`mihon:${ADDRESSED}:/series/folder-first`]);
		expect(series('Folder First')[0].id).toBe(folderFirstId);
	});

	it('leaves a title and a chapter number alone apart: that is not a source', () => {
		expect(keysOf('Numbers Only').sort()).toEqual([
			'mihon-dir:Untagged Scans (EN)/Numbers Only',
			`mihon:${ADDRESSED}:/series/numbers-only`
		]);
	});

	it('settles: a rescan creates no series again', async () => {
		const before = snapshot();
		await runImport(library, { now: at + 20_000 });
		expect(snapshot()).toEqual(before);
	});
});

/**
 * c571 through the library's backup (doc/BROWSE.md, "ADDED HIDDEN at the
 * importer"): tsundoku's download arrives first and is created as a
 * `mihon-dir:` series, then the library's own backup names the manga and
 * `adoptFolder` re-keys that series rather than creating one. Its source is
 * installed with ADDED HIDDEN on, so the folder's series arrives hidden and
 * stays hidden once adopted; one from an installed source with the switch off
 * arrives and stays visible. (import-db.spec.ts holds the other orders, the
 * shared name and the language.)
 */
describe('ADDED HIDDEN reaches a download folder before the library’s backup names it (c571)', () => {
	const at = 1_800_005_000_000;
	const SWITCHED = 9_300_000_000_000_000_011n;
	const UNSWITCHED = 9_300_000_000_000_000_012n;
	const rows = (title: string) =>
		db()
			.prepare(`SELECT id, origin_key, hidden FROM series WHERE title = ? ORDER BY id`)
			.all(title) as { id: number; origin_key: string; hidden: number }[];
	const download = (sourceDir: string, title: string, slug: string) => {
		const dir = join(tsundokuMihon, 'downloads', sourceDir, title);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, 'Chapter 1.cbz'),
			cbz(
				comicInfo({
					title: 'Chapter 1',
					series: title,
					number: 1,
					web: `https://c571.example/chapters/${slug}-1`,
					source: sourceDir.replace(/ \(.*\)$/, '')
				})
			)
		);
	};
	const first: Record<string, number> = {};

	beforeAll(async () => {
		const { setSourceFlag } = await import('$lib/server/engine/source-flags');
		db()
			.prepare(
				`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
				VALUES ('c571.devices', 'C571', 'manga', 1, '1', '1.5', 'h571', ?, ?)`
			)
			.run(at, at);
		const add = db().prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang) VALUES (?, 'c571.devices', ?, 'en')`
		);
		add.run(String(SWITCHED), 'Switched Scans');
		add.run(String(UNSWITCHED), 'Unswitched Scans');
		setSourceFlag(String(SWITCHED), 'addedHidden', true, db());

		download('Switched Scans (EN)', 'Switched Folder', 'switched');
		download('Unswitched Scans (EN)', 'Unswitched Folder', 'unswitched');
		await runImport(library, { now: at });
		for (const t of ['Switched Folder', 'Unswitched Folder']) first[t] = rows(t)[0].id;
		expect(rows('Switched Folder')).toEqual([
			{
				id: first['Switched Folder'],
				origin_key: 'mihon-dir:Switched Scans (EN)/Switched Folder',
				hidden: 1
			}
		]);
		expect(rows('Unswitched Folder')[0].hidden).toBe(0);

		// Then the library's backup names both manga.
		const { encode } = await import('./helpers/protobuf-writer');
		writeFileSync(
			join(rootMihon, 'autobackup', 'app.mihon_2026-11-05_13-00.tachibk'),
			gzipSync(
				encode([
					[
						1,
						manga(SWITCHED, '/series/switched', 'Switched Folder', [
							{ n: 1, url: '/chapters/switched-1' }
						])
					],
					[
						1,
						manga(UNSWITCHED, '/series/unswitched', 'Unswitched Folder', [
							{ n: 1, url: '/chapters/unswitched-1' }
						])
					],
					[
						101,
						[
							[1, 'Switched Scans'],
							[2, SWITCHED]
						]
					],
					[
						101,
						[
							[1, 'Unswitched Scans'],
							[2, UNSWITCHED]
						]
					]
				])
			)
		);
		await runImport(library, { now: at + 10_000 });
	});

	it('the backup adopts the hidden folder series, which stays the one series and stays hidden', () => {
		expect(rows('Switched Folder')).toEqual([
			{ id: first['Switched Folder'], origin_key: `mihon:${SWITCHED}:/series/switched`, hidden: 1 }
		]);
	});

	it('a folder from a source with the switch off is adopted visible', () => {
		expect(rows('Unswitched Folder')).toEqual([
			{
				id: first['Unswitched Folder'],
				origin_key: `mihon:${UNSWITCHED}:/series/unswitched`,
				hidden: 0
			}
		]);
	});
});
