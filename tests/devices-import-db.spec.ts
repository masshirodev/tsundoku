import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * Two devices syncing into one library (doc/SYNC.md, "Two devices"): the
 * tablet's copy in the library folder, the phone's under devices/phone/.
 * The phone has the same library, but downloaded Ch. 1 where the tablet has
 * Ch. 3.
 */
const library = mkdtempSync(join(tmpdir(), 'tsundoku-devices-'));
writeMihonFolder(library);
writeHentoidFolder(library);
const phone = join(library, 'devices', 'phone');
const phoneMihon = writeMihonFolder(phone);
const phoneHentoid = writeHentoidFolder(phone);
// A book only the phone downloaded.
book(
	phoneHentoid,
	'nhentai/Aoi Rin - Phone Only - [999]',
	content({ title: 'Phone Only', site: 'NHENTAI', url: '/g/999/', pages: [{ name: '0001' }] }),
	['0001.jpg']
);
const phoneWeeb = join(phoneMihon, 'downloads', 'Weeb Central (EN)', 'Drawing_ Saikyou Mangaka');
rmSync(join(phoneWeeb, 'Unknown_Chapter 3_abc3.cbz'));
writeFileSync(
	join(phoneWeeb, 'Unknown_Chapter 1_abc1.cbz'),
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
// The phone's backup is newer and knows a Ch. 4 nobody downloaded.
writeFileSync(
	join(phoneMihon, 'autobackup', 'app.mihon_2026-09-23_08-00.tachibk'),
	gzipSync(backup([4]))
);

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

describe('two devices', () => {
	it('reads the phone as sources of its own', () => {
		expect(sourcesIn(library).map((s) => [s.name, s.device])).toEqual([
			['Mihon', null],
			['Mihon local', null],
			['Hentoid', null],
			['Mihon', 'phone'],
			['Mihon local', 'phone'],
			['Hentoid', 'phone']
		]);
	});

	it('makes one series of what both devices have, with no second root', () => {
		const dupes = db()
			.prepare(`SELECT title FROM series GROUP BY title, root_id HAVING COUNT(*) > 1`)
			.all();
		expect(dupes).toEqual([]);
		expect(db().prepare(`SELECT name FROM roots ORDER BY id`).all()).toEqual([
			{ name: 'Mihon' },
			{ name: 'Mihon local' },
			{ name: 'Hentoid' }
		]);
		expect(drawing()).toHaveLength(1);
	});

	it('takes each chapter from whichever device has it, every file where it says', () => {
		const [d] = drawing();
		expect(d.path).toBe(library);
		expect(chapters(d.id).map((c) => [c.label, c.available])).toEqual([
			['Ch. 1', 1],
			['Ch. 2', 1],
			['Ch. 3', 1],
			['Ch. 4', 0]
		]);
		// Not downloaded: no file, not the folder of the device that knew of it.
		expect(chapters(d.id)[3].file).toBe('');
		const files = chapters(d.id).map((c) => c.file);
		// Ch. 1 only the phone has; Ch. 2 both, and the copy already there stays.
		expect(files[0]).toMatch(/^devices\/phone\/Mihon\//);
		expect(files[1]).toMatch(/^Mihon\//);
		const all = db()
			.prepare(
				`SELECT s.path, e.file FROM entries e JOIN series s ON s.id = e.series_id
				WHERE e.available = 1 AND e.file != ''`
			)
			.all() as { path: string; file: string }[];
		for (const e of all) expect(existsSync(join(e.path, e.file)), e.file).toBe(true);
	});

	it('changes nothing on a rescan', async () => {
		const before = snapshot();
		const r = await runImport(library, { now: 1_800_000_100_000 });
		expect(r.sources.every((s) => s.seriesCreated === 0)).toBe(true);
		expect(snapshot()).toEqual(before);
	});

	it('marks missing only what left the device that had it', async () => {
		rmSync(join(phoneWeeb, 'Unknown_Chapter 1_abc1.cbz'));
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
 * The tablet's two folders are named by the phone's backup; the phone's one is
 * named by the tablet's, so both orders are covered.
 */
describe('a folder the other device’s backup names', () => {
	const at = 1_800_000_300_000;
	const tablet = join(library, 'Mihon');
	const flowersDir = join(tablet, 'downloads', 'Weeb Central (EN)', 'The Flowers of Evil');
	const sluggedDir = join(tablet, 'downloads', 'Asura Scans (EN)', 'Slugged Tale');
	const reverseDir = join(phoneMihon, 'downloads', 'Weeb Central (EN)', 'Reverse Tale');
	const FLOWERS_DIR = 'mihon-dir:Weeb Central (EN)/The Flowers of Evil';
	const SLUGGED_DIR = 'mihon-dir:Asura Scans (EN)/Slugged Tale';
	const REVERSE_DIR = 'mihon-dir:Weeb Central (EN)/Reverse Tale';
	const FLOWERS = `mihon:${WEEB}:/series/flowers-of-evil`;

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
	let reverse: number;

	beforeAll(async () => {
		// What each device downloaded before any backup named it.
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
		chapter(
			reverseDir,
			'Chapter 1.cbz',
			'Reverse Tale',
			'Weeb Central',
			1,
			'https://weebcentral.com/chapters/RVT1'
		);

		await runImport(library, { now: at });
		flowers = byKey(FLOWERS_DIR)!;
		slugged = byKey(SLUGGED_DIR)!;
		reverse = byKey(REVERSE_DIR)!;
		expect(flowers && slugged && reverse).toBeTruthy();

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
		// The phone's folder, the other way round: the tablet's backup names it.
		db()
			.prepare(`UPDATE entries SET read_at = ? WHERE series_id = ?`)
			.run(at + 3_000, reverse);
		db().prepare(`UPDATE series SET rating = 2 WHERE id = ?`).run(reverse);

		// A backup from each device, naming what the other downloaded.
		writeFileSync(
			join(tablet, 'autobackup', 'app.mihon_2026-09-22_19-06.tachibk'),
			gzipSync(
				backup(
					[],
					[manga(WEEB, '/series/reverse-tale', 'Reverse Tale', [{ n: 1, url: '/chapters/RVT1' }])]
				)
			)
		);
		writeFileSync(
			join(phoneMihon, 'autobackup', 'app.mihon_2026-09-23_08-00.tachibk'),
			gzipSync(
				backup(
					[4],
					[
						manga(WEEB, '/series/flowers-of-evil', 'The Flowers of Evil', [
							{ n: 1, url: '/chapters/FLO1' },
							{ n: 2, url: '/chapters/FLO2' }
						]),
						manga(ASURA, '/series/slugged-tale', 'Slugged Tale', [
							{ n: 1, url: '/series/slugged-tale/chapter/1' }
						])
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

	it('folds a folder into the series the backup named, the other way round', () => {
		expect(byKey(REVERSE_DIR)).toBeUndefined();
		expect(byKey(`mihon:${WEEB}:/series/reverse-tale`)).toBeDefined();
		expect(
			one<{ rating: number }>(
				`SELECT rating FROM series WHERE origin_key = ?`,
				`mihon:${WEEB}:/series/reverse-tale`
			)
		).toEqual({ rating: 2 });
		expect(
			all<{ read_at: number | null; available: number; file: string }>(
				`SELECT read_at, available, file FROM entries WHERE series_id = ?`,
				byKey(`mihon:${WEEB}:/series/reverse-tale`)!
			)
		).toEqual([{ read_at: at + 3_000, available: 1, file: 'Chapter 1.cbz' }]);
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
	const tablet = join(library, 'Mihon');
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

		// The phone's backup names all three; the tablet's folder has them.
		writeFileSync(
			join(phoneMihon, 'autobackup', 'app.mihon_2026-09-29_08-00.tachibk'),
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
	const l = mkdtempSync(join(tmpdir(), 'tsundoku-record-former-'));
	const root = writeMihonFolder(l);
	const seriesDir = join(root, 'downloads', 'Asura Scans (EN)', 'Adopted Tale');
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
		await runImport(l, { now: at });
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
			join(root, 'autobackup', 'app.mihon_2026-10-05_08-00.tachibk'),
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
		await runImport(l, { now: at + 10_000 });
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
		const r = await runImport(l, { now: at + 20_000 });
		expect(r.sources.every((s) => s.seriesCreated === 0)).toBe(true);
		expect(byKey(URL)).toBe(folder);
		expect(byKey(DIR)).toBeUndefined();
		expect(
			all<{ n: number }>(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ?`, folder)
		).toEqual([{ n: 1 }]);
	});
});

/**
 * One chapter number, two files: two scanlators of it, downloaded by the
 * tablet while the phone's backup knows one chapter. The tablet's folder plan
 * meets the series the backup made, and its label fallback must not let the
 * second planned chapter take the first one's entry -- or the first file is
 * left on disk with nothing pointing at it.
 */
describe('two files of one chapter number', () => {
	const tablet = join(library, 'Mihon');
	const seriesDir = join(tablet, 'downloads', 'Asura Scans (EN)', 'Twin Scan');
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
		// The phone's backup names it first, and the tablet has downloaded nothing.
		writeFileSync(
			join(phoneMihon, 'autobackup', 'app.mihon_2026-10-06_08-00.tachibk'),
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
 * The card's own case: the backup is all this library reads. The folder was
 * imported by its key before the backup knew the manga, and no scan sees that
 * folder any more -- so the adoption has to come from the backup's source and
 * title, not from a scanned plan (doc/IMPORT-MIHON.md, "Before the backup
 * knows it").
 */
describe('a backup adopts a folder nothing scans any more', () => {
	const l = mkdtempSync(join(tmpdir(), 'tsundoku-backup-only-'));
	const root = writeMihonFolder(l);
	const sourceDir = join(root, 'downloads', 'Weeb Central (EN)', 'Kept Tale');
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
		for (const n of [1, 2]) {
			mkdirSync(sourceDir, { recursive: true });
			writeFileSync(
				join(sourceDir, `Chapter ${n}.cbz`),
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
		}
		await runImport(l, { now: at });
		folder = byKey(DIR)!;
		expect(folder).toBeTruthy();

		const entry = one<{ id: number }>(
			`SELECT id FROM entries WHERE series_id = ? AND label = 'Ch. 1'`,
			folder
		).id;
		db()
			.prepare(`UPDATE entries SET read_at = ?, last_opened_at = ?, last_position = 4 WHERE id = ?`)
			.run(at + 1_000, at + 2_000, entry);

		// Nothing scans the folder any more: the only thing left to read is a backup.
		renameSync(join(root, 'downloads'), join(root, 'downloads-copied-elsewhere'));
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
