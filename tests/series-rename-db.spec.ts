import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Msg } from './helpers/protobuf-writer';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 't';
delete process.env.SUWAYOMI_URL;
const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'tsundoku-rename-'));
process.env.COVER_DIR = join(scratch, 'covers');

/**
 * RENAME sticks (c526; doc/SERIES.md, "RENAME"). `series.title` is written at
 * the series' INSERT and, by `rg`, at one more place: `carryEdit`
 * (src/lib/server/import/fold.ts), which carries an owner's name *onto* the
 * survivor of a fold. So a rename needs no column of its own if every door
 * that meets a series again finds it by its key, its files or its entries,
 * never by its title. This spec renames through the screen's own function and
 * then walks those doors on one real-shaped library: a Mihon device folder
 * (its backup and its downloads) and two EPUB volumes grouped into a novel.
 */
const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { renameSeries, undoRenameSeries, RenameError, seriesPage } =
	await import('$lib/server/series');
const { groupIntoSeries } = await import('$lib/server/books');
const { refreshCovers } = await import('$lib/server/covers');
const { sampleEpub } = await import('$lib/server/pages/sample-epub');
const { ASURA, WEEB, backup, cbz, comicInfo, writeMihonFolder } =
	await import('./helpers/mihon-fixture');
const { search } = await import('$lib/server/library');
const { libraryIndex } = await import('$lib/server/library-sources');
const { resolveSeries } = await import('$lib/server/engine/worker');

const library = join(scratch, 'library');
const mihon = writeMihonFolder(join(library, 'devices', 'tsundoku'));
process.env.LIBRARY_ROOT = library;
const novels = join(library, 'Library', 'Light novels');
mkdirSync(novels, { recursive: true });
for (const v of [1, 2])
	writeFileSync(
		join(novels, `Lantern Vol ${v}.epub`),
		sampleEpub({ title: `Lantern: Volume ${v}`, hue: 40, chapters: [`Chapter ${v}`] })
	);

const db = getDb();
const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;
const DRAWING_KEY = `mihon:${WEEB}:/series/01J76/Drawing`;
const DRAWING = 'Drawing: Saikyou Mangaka';
const row = (id: number) =>
	one<{ title: string; alt_titles: string; hue: number; origin_key: string | null }>(
		`SELECT title, alt_titles, hue, origin_key FROM series WHERE id = ?`,
		id
	);
/** A title with a number in it, which a source's chapter names repeat (c555). */
const SQUAD = 'Squad 100';
/** Another source's series, called what Drawing is called now (c555). */
const TWIN_KEY = `mihon:${ASURA}:/series/TW/Twin`;
/** A key of no source in the library, of the manga family: what browse asks `sameTitle` with. */
const ELSEWHERE = 'mihon:999:/series/elsewhere';
/** What the readers of a title answered before the rename (c555). */
let before: { search: { id: number; why: string }[]; sameTitle: string | undefined };
const found = (q: string) => search(q, false).titles.map((t) => ({ id: t.id, why: t.why }));
const titled = (title: string) =>
	one<{ n: number }>(`SELECT COUNT(*) AS n FROM series WHERE title = ?`, title).n;

/** A stand-in engine (doc/DOWNLOADS.md) whose source still calls the series by its own name. */
let engine: Server;
/** What the stand-in was asked, by method: REFRESH must really have asked it. */
const asked: string[] = [];
let drawing = 0;
let lantern = 0;
let hues: { drawing: number; lantern: number };

beforeAll(async () => {
	engine = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as { method: string; mangaData?: { url: string } };
			asked.push(b.method);
			const json = (v: unknown) =>
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			// c555: Squad 100's source names its chapters after the title it
			// gave the series, gives no numbers (as a 1.6 source gives -1) and
			// has moved their URLs, so only the names can say which is which.
			if (b.mangaData?.url?.includes('/series/SQ/')) {
				if (b.method === 'getDetailsManga')
					return json({ url: b.mangaData.url, title: SQUAD, author: 'A', status: 1 });
				if (b.method === 'getChapterList')
					return json(
						[2, 1].map((n) => ({
							url: `/moved/SQ${n}`,
							name: `${SQUAD} ${n}`,
							scanlator: null,
							chapter_number: -1
						}))
					);
			}
			if (b.method === 'getDetailsManga')
				return json({ url: b.mangaData?.url ?? '', title: DRAWING, author: 'A', status: 1 });
			if (b.method === 'getChapterList')
				return json(
					[5, 4, 3, 2, 1].map((n) => ({
						url: `/chapters/AAA${n}`,
						name: `Chapter ${n}`,
						scanlator: null,
						chapter_number: n
					}))
				);
			res.writeHead(404).end('{}');
		});
	});
	await new Promise<void>((ok) => engine.listen(0, '127.0.0.1', ok));
	// Weeb Central installed, as engine-backend-db installs it: REFRESH asks it.
	db.prepare(
		`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
		VALUES ('eu.kanade.tachiyomi.extension.en.weebcentral', 'Weeb Central', 'manga', 1, '1.6.25', '1.6', ?, 0, 0)`
	).run('b'.repeat(64));
	db.prepare(
		`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, 'eu.kanade.tachiyomi.extension.en.weebcentral', 'Weeb Central', 'en', 'https://weebcentral.com')`
	).run(String(WEEB));
	process.env.ENGINE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;

	await runImport(library, { now: 1_800_000_000_000, covers: false });
	drawing = one<{ id: number }>(`SELECT id FROM series WHERE origin_key = ?`, DRAWING_KEY).id;
	const vols = ['Lantern: Volume 1', 'Lantern: Volume 2'].map(
		(t) => one<{ id: number }>(`SELECT id FROM series WHERE title = ?`, t).id
	);
	lantern = groupIntoSeries({ seriesIds: vols, name: 'Lantern', now: 1_800_000_001_000 }).seriesId;
	hues = { drawing: row(drawing).hue, lantern: row(lantern).hue };
	before = {
		search: found('Saikyou'),
		sameTitle: libraryIndex(false).sameTitle(ELSEWHERE, DRAWING)
	};
	renameSeries(drawing, 'Drawing (my name)');
	renameSeries(lantern, '  The   Lantern Books ');
});

afterAll(async () => {
	engine.closeAllConnections();
	await new Promise((ok) => engine.close(ok));
	rmSync(scratch, { recursive: true, force: true });
});

describe('a rename', () => {
	it('writes the new name, keeps the old in the alternative titles, and keeps the colour', () => {
		expect(row(drawing)).toMatchObject({ title: 'Drawing (my name)', hue: hues.drawing });
		expect(JSON.parse(row(drawing).alt_titles)).toContain(DRAWING);
		// Spaces fold as a typed name's would; the hue was the old name's, once.
		expect(row(lantern)).toMatchObject({
			title: 'The Lantern Books',
			alt_titles: JSON.stringify(['Lantern']),
			hue: hues.lantern
		});
		expect(seriesPage(lantern, false)!.altTitles).toEqual(['Lantern']);
	});

	it('refuses an empty name and a series that is not there', () => {
		expect(() => renameSeries(lantern, '   ')).toThrow(RenameError);
		expect(() => renameSeries(999_999, 'X')).toThrow(RenameError);
		expect(row(lantern).title).toBe('The Lantern Books');
	});

	it('to the name it already has writes nothing', () => {
		const before = row(lantern);
		const facts = renameSeries(lantern, 'The Lantern Books');
		expect(facts).toMatchObject({ title: 'The Lantern Books', name: 'The Lantern Books' });
		expect(row(lantern)).toEqual(before);
	});
});

describe('the doors that meet a renamed series again', () => {
	it('a rescan of the same files, its backup included, keeps both names and makes no twin', async () => {
		await runImport(library, { now: 1_800_000_100_000, covers: false });
		expect(row(drawing).title).toBe('Drawing (my name)');
		expect(row(lantern).title).toBe('The Lantern Books');
		expect(titled(DRAWING)).toBe(0);
		expect(titled('Lantern: Volume 1') + titled('Lantern: Volume 2')).toBe(0);
		// Still the one grouped novel, both volumes in it.
		const files = db
			.prepare(`SELECT DISTINCT file FROM entries WHERE series_id = ? ORDER BY file`)
			.all(lantern) as { file: string }[];
		expect(files.map((f) => f.file)).toEqual(['Lantern Vol 1.epub', 'Lantern Vol 2.epub']);
	});

	it('a newer backup that still names the manga by its source’s title keeps the owner’s', async () => {
		const drawingAgain: Msg = [
			[1, WEEB],
			[2, '/series/01J76/Drawing'],
			[3, DRAWING],
			[
				16,
				[
					[1, '/chapters/AAA1'],
					[2, 'Chapter 1'],
					[9, { f32: 1 }]
				]
			],
			[17, 1]
		];
		writeFileSync(
			join(mihon, 'autobackup', 'app.mihon_2026-11-04_08-00.tachibk'),
			gzipSync(backup([], [drawingAgain]))
		);
		await runImport(library, { now: 1_800_000_200_000, covers: false });
		expect(row(drawing)).toMatchObject({ title: 'Drawing (my name)', origin_key: DRAWING_KEY });
		expect(titled(DRAWING)).toBe(0);
	});

	it('REFRESH from the source, which answers its own title, adds the chapter and keeps the name', async () => {
		const { refreshSeries } = await import('$lib/server/refresh');
		const before = one<{ n: number }>(
			`SELECT COUNT(*) AS n FROM entries WHERE series_id = ?`,
			drawing
		).n;
		const r = await refreshSeries(drawing);
		expect(asked).toEqual(['getDetailsManga', 'getChapterList']);
		// Chapters 4 and 5 are new to the series.
		expect(r).toEqual({ kind: 'manga', added: 2 });
		expect(
			one<{ n: number }>(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ?`, drawing).n
		).toBe(before + r!.added);
		expect(row(drawing).title).toBe('Drawing (my name)');
	});

	it('a cover pass keeps the name', async () => {
		await refreshCovers({ ids: [drawing, lantern], remote: false });
		expect(row(drawing).title).toBe('Drawing (my name)');
		expect(row(lantern).title).toBe('The Lantern Books');
	});

	/*
	 * The one door that recognises a series by its name (`adoptNamed`,
	 * fold.ts): a folder plan meets the series a backup names, by title. Since
	 * c191 the only folders a scan plans are tsundoku's own downloads
	 * (devices/tsundoku/Mihon), and the engine names a new download's folder
	 * and its ComicInfo after the series' title *now* (engine/worker.ts), so
	 * after a rename the next chapter lands in a folder under the new name.
	 * It must join the renamed series, not start one.
	 */
	it('tsundoku’s own next download, filed under the new name, joins the renamed series', async () => {
		const dir = join(mihon, 'downloads', 'Weeb Central (EN)', 'Drawing (my name)');
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, 'Chapter 5.cbz'),
			cbz(
				comicInfo({
					title: 'Chapter 5',
					series: 'Drawing (my name)',
					number: 5,
					web: 'https://weebcentral.com/chapters/AAA5',
					source: 'Weeb Central'
				})
			)
		);
		const before = one<{ n: number }>(`SELECT COUNT(*) AS n FROM series`).n;
		await runImport(library, { now: 1_800_000_300_000, covers: false });
		expect(row(drawing).title).toBe('Drawing (my name)');
		expect(one<{ n: number }>(`SELECT COUNT(*) AS n FROM series`).n).toBe(before);
		expect(
			one<{ series_id: number; available: number }>(
				`SELECT series_id, available FROM entries WHERE file LIKE '%Chapter 5.cbz'`
			)
		).toEqual({ series_id: drawing, available: 1 });
	});
});

describe('UNDO', () => {
	it('puts back the name and the alternative titles exactly', () => {
		const before = row(lantern);
		const facts = renameSeries(lantern, 'Lantern, Renamed Twice');
		expect(JSON.parse(row(lantern).alt_titles)).toEqual(['Lantern', 'The Lantern Books']);
		undoRenameSeries(facts);
		expect(row(lantern)).toEqual(before);
	});

	it('refuses once a later rename has overtaken it, and leaves the later name', () => {
		const first = renameSeries(lantern, 'First');
		renameSeries(lantern, 'Second');
		expect(() => undoRenameSeries(first)).toThrow('RENAMED AGAIN SINCE');
		expect(row(lantern).title).toBe('Second');
	});

	it('refuses a blank name, and writes alternative titles only as a list of strings', () => {
		const facts = renameSeries(lantern, 'Posted Back');
		expect(() => undoRenameSeries({ ...facts, title: '   ' })).toThrow('A SERIES NEEDS A NAME');
		expect(row(lantern).title).toBe('Posted Back');
		undoRenameSeries({ ...facts, title: 'Second', altTitles: 'not json' });
		expect(row(lantern).title).toBe('Second');
		expect(JSON.parse(row(lantern).alt_titles)).toEqual([]);
		const again = renameSeries(lantern, 'Posted Twice');
		undoRenameSeries({ ...again, altTitles: JSON.stringify(['Kept', 7, null]) });
		expect(JSON.parse(row(lantern).alt_titles)).toEqual(['Kept']);
	});
});

describe('a renamed series is still found by the name it had (c555)', () => {
	it('the library’s search finds it by its old name, and says that is why', () => {
		// Before: found by its title. After: the same series, by the old name.
		expect(before.search).toEqual([{ id: drawing, why: 'TITLE' }]);
		expect(found('Saikyou')).toEqual([{ id: drawing, why: `ALSO ${DRAWING}` }]);
		// The new name finds it as its title, and a query spanning two names
		// or the list's own JSON finds nothing: each name is matched alone.
		expect(found('my name')).toEqual([{ id: drawing, why: 'TITLE' }]);
		expect(found('Mangaka","')).toEqual([]);
		expect(found('["')).toEqual([]);
	});

	it('browse’s IN LIBRARY hint still knows the old name as this source’s', () => {
		expect(before.sameTitle).toBe(String(WEEB));
		expect(libraryIndex(false).sameTitle(ELSEWHERE, DRAWING)).toBe(String(WEEB));
		// And the new one.
		expect(libraryIndex(false).sameTitle(ELSEWHERE, 'Drawing (my name)')).toBe(String(WEEB));
	});

	it('a source whose chapter names carry the old title matches and numbers them as before', async () => {
		// Squad 100 from Weeb Central, with its first chapter, and a twin from
		// Asura Scans that an import calls by Drawing's new name.
		const squad: Msg = [
			[1, WEEB],
			[2, '/series/SQ/Squad'],
			[3, SQUAD],
			[
				16,
				[
					[1, '/chapters/SQ1'],
					[2, `${SQUAD} 1`],
					[9, { f32: 1 }]
				]
			],
			[17, 1]
		];
		const twin: Msg = [
			[1, ASURA],
			[2, '/series/TW/Twin'],
			[3, 'Drawing (my name)'],
			[17, 1]
		];
		writeFileSync(
			join(mihon, 'autobackup', 'app.mihon_2026-11-05_08-00.tachibk'),
			gzipSync(backup([], [squad, twin]))
		);
		await runImport(library, { now: 1_800_000_400_000, covers: false });
		const sq = one<{ id: number }>(
			`SELECT id FROM series WHERE origin_key = ?`,
			`mihon:${WEEB}:/series/SQ/Squad`
		).id;
		const deps = { db, now: () => 1_800_000_500_000 };
		const links = () =>
			db
				.prepare(
					`SELECT e.position, c.engine_url FROM engine_chapters c JOIN entries e ON e.id = c.entry_id
					WHERE e.series_id = ? ORDER BY e.position`
				)
				.all(sq);

		// Before the rename: chapter 1 is the entry; chapter 2 is new.
		const was = (await resolveSeries(sq, deps, true)).map((c) => c.url);
		const wasLinks = links();
		expect(wasLinks).toEqual([{ position: 1, engine_url: '/moved/SQ1' }]);
		expect(was).toEqual(['/moved/SQ2']);

		db.prepare(
			`DELETE FROM engine_chapters WHERE entry_id IN (SELECT id FROM entries WHERE series_id = ?)`
		).run(sq);
		renameSeries(sq, 'My Squad');
		// The source still says "Squad 100 2": the 100 is not the chapter.
		expect((await resolveSeries(sq, deps, true)).map((c) => c.url)).toEqual(was);
		expect(links()).toEqual(wasLinks);

		// REFRESH adds the new one as chapter 2, not chapter 100.
		const { refreshSeries } = await import('$lib/server/refresh');
		expect(await refreshSeries(sq, 1_800_000_600_000)).toEqual({ kind: 'manga', added: 1 });
		const positions = db
			.prepare(`SELECT position FROM entries WHERE series_id = ? ORDER BY position`)
			.all(sq);
		expect(positions).toEqual([{ position: 1 }, { position: 2 }]);
		expect(row(sq).title).toBe('My Squad');
	});

	it('a title that is another series’ old name: the hint names the titled one’s source', () => {
		const tw = one<{ id: number }>(`SELECT id FROM series WHERE origin_key = ?`, TWIN_KEY).id;
		// Asura's twin is renamed after Drawing was: its old name, Drawing's
		// title, now sits in its alternatives, later in the library than
		// Drawing's own title.
		renameSeries(tw, 'Twin Renamed');
		expect(tw).toBeGreaterThan(drawing);
		expect(libraryIndex(false).sameTitle(ELSEWHERE, 'Drawing (my name)')).toBe(String(WEEB));
		// Search: the one titled so first, then the one that was.
		expect(found('Drawing (my name)')).toEqual([
			{ id: drawing, why: 'TITLE' },
			{ id: tw, why: 'ALSO Drawing (my name)' }
		]);
	});

	it('renamed twice it answers to both old names; UNDO makes the old name a title again, not also an alternative', () => {
		const sq = one<{ id: number }>(
			`SELECT id FROM series WHERE origin_key = ?`,
			`mihon:${WEEB}:/series/SQ/Squad`
		).id;
		const facts = renameSeries(sq, 'Squad Again');
		expect(JSON.parse(row(sq).alt_titles)).toEqual([SQUAD, 'My Squad']);
		expect(found(SQUAD)).toEqual([{ id: sq, why: `ALSO ${SQUAD}` }]);
		expect(found('My Squad')).toEqual([{ id: sq, why: 'ALSO My Squad' }]);
		expect(libraryIndex(false).sameTitle(ELSEWHERE, 'My Squad')).toBe(String(WEEB));
		undoRenameSeries(facts);
		expect(row(sq).title).toBe('My Squad');
		expect(JSON.parse(row(sq).alt_titles)).toEqual([SQUAD]);
		expect(found('My Squad')).toEqual([{ id: sq, why: 'TITLE' }]);
		expect(found('Squad Again')).toEqual([]);
	});

	it('a column that is not a list of names is no names, and never breaks the search', () => {
		const before = row(lantern).alt_titles;
		for (const bad of ['not json', '{"old":"Zephyr Lantern"}', '"Zephyr Lantern"', '[7, null]']) {
			db.prepare(`UPDATE series SET alt_titles = ? WHERE id = ?`).run(bad, lantern);
			expect(found('Zephyr')).toEqual([]);
			expect(libraryIndex(false).sameTitle(ELSEWHERE, 'Zephyr Lantern')).toBeUndefined();
		}
		db.prepare(`UPDATE series SET alt_titles = ? WHERE id = ?`).run(before, lantern);
	});

	it('UNDO puts the old name back exactly as it was stored, spaces included', () => {
		db.prepare(`UPDATE series SET title = ? WHERE id = ?`).run('  Spaced  Name ', lantern);
		const facts = renameSeries(lantern, 'Tidy');
		undoRenameSeries(facts);
		expect(row(lantern).title).toBe('  Spaced  Name ');
		expect(() => undoRenameSeries({ ...renameSeries(lantern, 'X'), title: ' \t ' })).toThrow(
			'A SERIES NEEDS A NAME'
		);
	});
});
