import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PlannedEntry, PlannedSeries } from '$lib/import/plan';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 't';
// ADD fetches the new series' cover: never into the library's own covers folder.
const covers = mkdtempSync(join(tmpdir(), 'tsundoku-backend-covers-'));
process.env.COVER_DIR = covers;
delete process.env.SUWAYOMI_URL;

const { getDb } = await import('$lib/server/db');
const { ensureRoot, writeSeries } = await import('$lib/server/import/write');
const downloads = await import('$lib/server/downloads');
const { parseSourceMangaId } = await import('$lib/server/engine/backend');

// The screens' backend on the engine (doc/DOWNLOADER.md, card c138): the same
// functions the screens call of Suwayomi's, through server/downloads.ts.

const SOURCE = '2131019126180322627';
let chapters = [3, 2, 1];
let server: Server;

beforeAll(async () => {
	server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			if (req.url?.startsWith('/image/'))
				return res
					.writeHead(200, { 'content-type': 'image/jpeg' })
					.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
			const b = JSON.parse(raw) as { method: string; mangaData?: { url: string }; search?: string };
			const json = (v: unknown) =>
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			const url = b.mangaData?.url ?? '';
			if (b.method === 'getSearchManga')
				return json({
					mangas: [
						{
							url: '/series/in-library',
							title: 'In Library Series',
							author: 'A',
							status: 1,
							thumbnail_url: 'http://127.0.0.1:8080/image/tok1'
						},
						{
							url: '/series/new|mangayomi-memo|eyJ9',
							title: 'A New One',
							status: 2,
							thumbnail_url: null
						}
					],
					hasNextPage: false
				});
			if (b.method === 'getDetailsManga')
				return json({
					url,
					// A 1.6 source that forgets its title (Mangahere).
					title: url.includes('blank')
						? ''
						: url.includes('new')
							? 'A New One'
							: 'In Library Series',
					author: 'A',
					genre: 'Action, Drama',
					status: 1,
					thumbnail_url: 'http://127.0.0.1:8080/image/tok2'
				});
			if (b.method === 'getChapterList')
				return json(
					(url.includes('new') ? [2, 1] : chapters).map((n) => ({
						url: url.includes('new') ? `/chapters/new-${n}` : `/chapters/c${n}`,
						name: `Chapter ${n}`,
						scanlator: null,
						chapter_number: -1
					}))
				);
			res.writeHead(404).end('{}');
		});
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	process.env.ENGINE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
	rmSync(covers, { recursive: true, force: true });
});

const db = getDb();
const root = ensureRoot(db, 'Mihon', '/nowhere/Mihon', false);
const entry = (n: number, o: Partial<PlannedEntry> = {}): PlannedEntry => ({
	position: n,
	label: `Ch. ${n}`,
	title: '',
	sourceUrl: `/chapters/c${n}`,
	scanlator: '',
	available: false,
	file: '',
	bytes: 0,
	pageCount: 0,
	addedAt: 1_700_000_000_000,
	readAt: null,
	lastPosition: null,
	lastOpenedAt: null,
	history: null,
	...o
});
const planned: PlannedSeries = {
	originKey: `mihon:${SOURCE}:/series/in-library`,
	source: 'mihon',
	title: 'In Library Series',
	kind: 'manga',
	rating: 0,
	favourite: false,
	hidden: false,
	shelves: [],
	tags: [{ namespace: 'source', value: 'Weeb Central' }],
	description: '',
	status: '',
	direction: null,
	addedAt: 1_700_000_000_000,
	sourceUrl: '/series/in-library',
	path: '',
	entries: [
		entry(1, { available: true, file: 'c1.cbz', readAt: 1_750_000_000_000 }),
		entry(2),
		entry(3)
	]
};
writeSeries(planned, { rootId: root, jobId: null, now: 1_700_000_000_000, markMissing: false }, db);
const seriesId = (
	db.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(planned.originKey) as { id: number }
).id;
const ids = () =>
	db
		.prepare(`SELECT id, position, available FROM entries WHERE series_id = ? ORDER BY position`)
		.all(seriesId) as {
		id: number;
		position: number;
		available: number;
	}[];
const entriesFor = () => ids().map((e) => ({ id: e.id, available: e.available === 1 }));
const [c1, c2, c3] = ids().map((e) => e.id);

db.prepare(
	`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
	VALUES ('eu.kanade.tachiyomi.extension.en.weebcentral', 'Weeb Central', 'manga', 1, '1.6.25', '1.6', ?, 0, 0)`
).run('b'.repeat(64));
db.prepare(
	`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, 'eu.kanade.tachiyomi.extension.en.weebcentral', 'Weeb Central', 'en', 'https://weebcentral.com')`
).run(SOURCE);

describe('the series row', () => {
	it('is set up, and offers every chapter with a URL before the source is asked', async () => {
		expect(downloads.configured()).toBe(true);
		const d = await downloads.seriesDownloads(seriesId, entriesFor());
		expect(d).toMatchObject({ kind: 'ok', queuedElsewhere: 0, follow: { on: false } });
		if (d.kind !== 'ok') return;
		expect(d.states[c1]).toEqual({ kind: 'have' });
		expect(d.states[c2]).toEqual({ kind: 'none', chapterId: c2 });
	});

	it('draws queued, downloading, failed and importing from tsundoku’s own queue', async () => {
		expect(await downloads.enqueue(seriesId, [c2, c3])).toEqual({ queued: 2, missing: 0 });
		db.prepare(
			`UPDATE download_queue SET state = 'downloading', pages = 20, done_pages = 5 WHERE entry_id = ?`
		).run(c2);
		let d = await downloads.seriesDownloads(seriesId, entriesFor());
		if (d.kind !== 'ok') throw new Error(d.kind);
		expect(d.states[c2]).toEqual({
			kind: 'downloading',
			chapterId: c2,
			page: 5,
			pages: 20,
			fraction: 0.25
		});
		expect(d.states[c3]).toEqual({ kind: 'queued', chapterId: c3 });

		db.prepare(`UPDATE download_queue SET state = 'failed', tries = 3 WHERE entry_id = ?`).run(c3);
		db.prepare(`DELETE FROM download_queue WHERE entry_id = ?`).run(c2);
		db.prepare(
			`INSERT OR REPLACE INTO engine_chapters (entry_id, engine_url, name, downloaded_at) VALUES (?, '/chapters/c2', 'Chapter 2', 1)`
		).run(c2);
		d = await downloads.seriesDownloads(seriesId, entriesFor());
		if (d.kind !== 'ok') throw new Error(d.kind);
		expect(d.states[c3]).toEqual({ kind: 'failed', chapterId: c3, tries: 3 });
		expect(d.states[c2]).toEqual({ kind: 'importing' });

		// Imported: HAVE, and the mark goes, so a later delete isn't IMPORTING.
		db.prepare(`UPDATE entries SET available = 1 WHERE id = ?`).run(c2);
		d = await downloads.seriesDownloads(seriesId, entriesFor());
		if (d.kind !== 'ok') throw new Error(d.kind);
		expect(d.states[c2]).toEqual({ kind: 'have' });
		expect(
			db.prepare(`SELECT downloaded_at FROM engine_chapters WHERE entry_id = ?`).get(c2)
		).toEqual({ downloaded_at: null });
		db.prepare(`UPDATE entries SET available = 0 WHERE id = ?`).run(c2);
	});

	it('says a source no extension has downloads elsewhere', async () => {
		const other = {
			...planned,
			originKey: 'mihon:999:/x',
			sourceUrl: '/x',
			tags: [{ namespace: 'source', value: 'XBatCat' }],
			entries: [entry(1, { sourceUrl: '/x/1' })]
		};
		writeSeries(other, { rootId: root, jobId: null, now: 1, markMissing: false }, db);
		const id = (
			db.prepare(`SELECT id FROM series WHERE origin_key = 'mihon:999:/x'`).get() as { id: number }
		).id;
		expect(await downloads.seriesDownloads(id, [])).toEqual({
			kind: 'elsewhere',
			source: 'XBatCat'
		});
	});
});

describe('the queue', () => {
	it('answers as Suwayomi’s queue does, for the queue screen and the QUEUE cell', async () => {
		const q = await downloads.queue();
		expect(q.running).toBe(true);
		expect(q.items).toEqual([
			expect.objectContaining({
				chapterId: c3,
				state: 'ERROR',
				tries: 3,
				mangaId: seriesId,
				mangaTitle: 'In Library Series',
				key: planned.originKey,
				name: 'Ch. 3'
			})
		]);
		expect(await downloads.queueSummary(false)).toEqual({
			queued: 0,
			failed: 1,
			failedSeries: ['In Library Series'],
			stale: false
		});
	});

	it('retries, pauses, puts a series on top and cancels, by entry', async () => {
		await downloads.retry([c3]);
		await downloads.enqueue(seriesId, [c2]);
		expect((await downloads.queue()).items.map((i) => [i.chapterId, i.state])).toEqual([
			[c3, 'QUEUED'],
			[c2, 'QUEUED']
		]);
		await downloads.toTheTop([c2]);
		expect((await downloads.queue()).items.map((i) => i.chapterId)).toEqual([c2, c3]);
		await downloads.setPaused(true);
		expect((await downloads.queue()).running).toBe(false);
		expect(downloads.pausedAt()).toBeTypeOf('number');
		await downloads.setPaused(false);
		await downloads.dequeue([c2, c3]);
		expect((await downloads.queue()).items).toEqual([]);
	});
});

describe('finding and adding a series', () => {
	it('searches the library’s sources, telling what’s here already', async () => {
		expect(await downloads.searchSources(false)).toEqual([{ id: SOURCE, name: 'Weeb Central' }]);
		const hits = await downloads.searchSource(SOURCE, 'series', false);
		expect(hits.map((h) => [h.title, h.match.kind])).toEqual([
			['In Library Series', 'in-library'],
			['A New One', 'new']
		]);
		expect(hits[0].cover).toBe('/api/downloads/engine-image/tok1');
		expect(parseSourceMangaId(hits[1].mangaId)).toEqual({
			sourceId: SOURCE,
			url: '/series/new|mangayomi-memo|eyJ9'
		});
	});

	it('previews one with its chapters numbered, and opens the series for one that’s here', async () => {
		const hits = await downloads.searchSource(SOURCE, 'series', false);
		expect(await downloads.mangaKey(hits[0].mangaId)).toBe(planned.originKey);
		const m = (await downloads.sourceManga(hits[1].mangaId))!;
		expect(m).toMatchObject({
			title: 'A New One',
			genres: ['Action', 'Drama'],
			source: 'Weeb Central',
			lang: 'EN',
			cover: '/api/downloads/engine-image/tok2'
		});
		expect(m.chapters.map((c) => c.number)).toEqual([2, 1]);
		expect(downloads.isSourceMangaId('12')).toBe(false);
		// Details with no title: the address's words, never a series with no name.
		const { sourceMangaId } = await import('$lib/server/engine/backend');
		const blank = (await downloads.sourceManga(
			sourceMangaId(SOURCE, '/manga/love_junkies-blank/')
		))!;
		expect(blank.title).toBe('Love Junkies Blank');
	});

	it('adds one, keyed without its memo, every chapter NOT DOWNLOADED, and undoes it', async () => {
		const hits = await downloads.searchSource(SOURCE, 'series', false);
		const id = await downloads.addToLibrary(hits[1].mangaId);
		const s = db.prepare(`SELECT origin_key, title FROM series WHERE id = ?`).get(id);
		expect(s).toEqual({ origin_key: `mihon:${SOURCE}:/series/new`, title: 'A New One' });
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND available = 0`).get(id)
		).toEqual({ n: 2 });
		// The worker needn't ask the source again: it already knows what the source calls them.
		expect(db.prepare(`SELECT engine_url FROM engine_series WHERE series_id = ?`).get(id)).toEqual({
			engine_url: '/series/new|mangayomi-memo|eyJ9'
		});
		expect(
			db
				.prepare(
					`SELECT COUNT(*) AS n FROM engine_chapters c JOIN entries e ON e.id = c.entry_id WHERE e.series_id = ?`
				)
				.get(id)
		).toEqual({ n: 2 });
		// Added again: the same series, not a second one.
		expect(await downloads.addToLibrary(hits[1].mangaId)).toBe(id);
		expect(await downloads.undoAdd(id)).toBe(true);
		expect(db.prepare(`SELECT 1 FROM series WHERE id = ?`).get(id)).toBeUndefined();
	});
});

describe('ADD on a library with no Mihon folder yet', () => {
	it('makes the Mihon root, where a scan of Mihon/ would, instead of refusing (a friend, 2026-10-30)', async () => {
		// Undone at the end: the rest of the file keeps its library.
		db.exec('SAVEPOINT fresh');
		try {
			db.exec(`DELETE FROM series; DELETE FROM roots`);
			const hits = await downloads.searchSource(SOURCE, 'series', false);
			const id = await downloads.addToLibrary(hits[1].mangaId);
			const root = db
				.prepare(
					`SELECT r.name, r.path FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ?`
				)
				.get(id) as { name: string; path: string };
			expect(root.name).toBe('Mihon');
			expect(root.path.endsWith('/Mihon')).toBe(true);
		} finally {
			db.exec('ROLLBACK TO fresh; RELEASE fresh');
		}
	});
});

describe('FOLLOW', () => {
	it('makes a chapter that appeared after the follow an entry, and queues it', async () => {
		await downloads.setFollowed(seriesId, true);
		db.prepare(`UPDATE series SET followed_at = ? WHERE id = ?`).run(1000, seriesId);
		// Six hours on, the source lists a fourth chapter.
		db.prepare(`UPDATE engine_series SET resolved_at = 0 WHERE series_id = ?`).run(seriesId);
		chapters = [4, 3, 2, 1];
		const r = await downloads.followNew();
		expect(r).toEqual({ series: 1, queued: 1 });
		const ch4 = db
			.prepare(`SELECT id, label, available FROM entries WHERE series_id = ? AND position = 4`)
			.get(seriesId) as {
			id: number;
			label: string;
			available: number;
		};
		expect(ch4).toMatchObject({ label: 'Ch. 4', available: 0 });
		expect((await downloads.queue()).items.map((i) => i.chapterId)).toEqual([ch4.id]);
		// Asked again within six hours: not asked at all.
		expect(await downloads.followNew()).toEqual({ series: 0, queued: 0 });
	});

	it('is refreshed without following: a new chapter becomes an entry, and nothing is queued (c220)', async () => {
		db.exec(`DELETE FROM download_queue`);
		db.prepare(`UPDATE series SET followed_at = NULL WHERE id = ?`).run(seriesId);
		chapters = [5, 4, 3, 2, 1];
		const { refreshSeries } = await import('$lib/server/refresh');
		expect(await refreshSeries(seriesId)).toEqual({ kind: 'manga', added: 1 });
		const ch5 = db
			.prepare(`SELECT id, label, available FROM entries WHERE series_id = ? AND position = 5`)
			.get(seriesId) as { id: number; label: string };
		expect(ch5).toMatchObject({ label: 'Ch. 5' });
		// A look, not a fetch: FOLLOW stays the only thing that queues.
		expect((await downloads.queue()).items).toEqual([]);
		const d = await downloads.seriesDownloads(seriesId, entriesFor());
		expect(d.kind === 'ok' && d.refreshable).toBe(true);
		expect(d.kind === 'ok' && d.follow.on).toBe(false);
		// Asked again: nothing new.
		expect(await refreshSeries(seriesId)).toEqual({ kind: 'manga', added: 0 });
	});
});

describe('a Hentoid book, which is no source family (K3, c303)', () => {
	/**
	 * Hentoid's keys are not a `SourceFamily` (doc/KINDS.md; `keyFamily` says
	 * null), and that is a case every door handles, not an undefined that
	 * falls through. Planned by Hentoid's own importer, written by the
	 * importers' writer, then asked through the download doors the screens
	 * use: no downloader takes it, nothing queues, FOLLOW refuses it.
	 */
	it('has no downloader, queues nothing and cannot be followed, by either key', async () => {
		const { planHentoidBook, parseContent } = await import('$lib/import/hentoid-plan');
		const { content } = await import('./helpers/hentoid-fixture');
		const { keyFamily } = await import('$lib/library/downloads');
		const { queueKindOf } = await import('$lib/server/engine/queue');
		const hentoidRoot = ensureRoot(db, 'Hentoid', '/h/.Hentoid', false);
		const json = content({
			title: 'A Hentoid Book',
			site: 'NHENTAI',
			url: '/g/k3/',
			pages: [{ name: '0001' }]
		});
		const books = [
			planHentoidBook(
				{ folder: 'nhentai/k3', files: ['0001.jpg'], bytes: 1, content: parseContent(json) },
				'/h/.Hentoid',
				1
			),
			planHentoidBook(
				{ folder: 'nhentai/k3-loose', files: ['0001.jpg'], bytes: 1, content: null },
				'/h/.Hentoid',
				1
			)
		];
		expect(books.map((b) => b.originKey)).toEqual([
			'hentoid:NHENTAI:/g/k3/',
			'hentoid-dir:nhentai/k3-loose'
		]);
		for (const book of books) {
			expect(keyFamily(book.originKey)).toBeNull();
			writeSeries(book, { rootId: hentoidRoot, jobId: null, now: 1, markMissing: false }, db);
			const id = (
				db.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(book.originKey) as {
					id: number;
				}
			).id;
			const entries = (
				db.prepare(`SELECT id FROM entries WHERE series_id = ?`).all(id) as { id: number }[]
			).map((e) => ({ id: e.id, available: false }));
			expect(entries.length).toBeGreaterThan(0);
			expect(await downloads.seriesDownloads(id, entries)).toEqual({ kind: 'none' });
			expect(
				await downloads.enqueue(
					id,
					entries.map((e) => e.id)
				)
			).toEqual({ queued: 0, missing: entries.length });
			await expect(downloads.setFollowed(id, true)).rejects.toThrow(/can be followed/);
			// Were one ever queued (a key changed after queueing), it is the engine's lane.
			expect(queueKindOf(book.originKey)).toBe('manga');
		}
	});
});
