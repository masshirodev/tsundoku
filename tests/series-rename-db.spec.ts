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
const { WEEB, backup, cbz, comicInfo, writeMihonFolder } = await import('./helpers/mihon-fixture');

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
const titled = (title: string) =>
	one<{ n: number }>(`SELECT COUNT(*) AS n FROM series WHERE title = ?`, title).n;

/** A stand-in engine (doc/DOWNLOADER.md) whose source still calls the series by its own name. */
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
