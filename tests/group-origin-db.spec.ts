import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * A book's own origin (doc/BOOKS.md, "Where a book's origin lives").
 * Its one-offs are made by the app's own ADD from a fake engine's gallery
 * source, not hand-seeded with the key they should have (wave 37's lesson), and
 * its downloads go through the real worker, backup and importer.
 */

process.env.DATABASE_PATH = ':memory:';
const library = mkdtempSync(join(tmpdir(), 'tsundoku-origin-lib-'));
const store = mkdtempSync(join(tmpdir(), 'tsundoku-origin-store-'));
const covers = mkdtempSync(join(tmpdir(), 'tsundoku-origin-covers-'));
process.env.LIBRARY_ROOT = library;
process.env.ENGINE_STORE = store;
process.env.COVER_DIR = covers;
process.env.ENGINE_TOKEN = 't';

const { getDb, climb } = await import('$lib/server/db');
const engine = await import('$lib/server/engine/backend');
const downloads = await import('$lib/server/downloads');
const books = await import('$lib/server/books');
const { readsOnline } = await import('$lib/server/pages/online');
const { queueRows, enqueue: enqueueEntries } = await import('$lib/server/engine/queue');
const worker = await import('$lib/server/engine/worker');
const { attachWritten } = await import('$lib/server/import/index');
const { refreshMany, refreshSeries } = await import('$lib/server/refresh');
const { deleteBook, deleteSeries } = await import('$lib/server/delete');
const { forgetSourceUse, libraryIndex, seriesForKey, sourceUse } =
	await import('$lib/server/library-sources');
const flags = await import('$lib/server/engine/source-flags');
const { bookOrigin, bookOrigins, entryOrigin, seriesHolding, heldByOther } =
	await import('$lib/server/season-facts');
const { keyOf, downloadRow } = await import('$lib/library/downloads');
const { default: Database } = await import('better-sqlite3');
type FollowFacts = import('$lib/library/downloads').FollowFacts;

const NH = { id: '111', name: 'nhentai', pkg: 'e2e.nh' };
const HI = { id: '222', name: 'Hitomi', pkg: 'e2e.hi' };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

const asked: { method: string; url?: string; sourceId?: string }[] = [];
/** Source ids that answer a 500 to everything. */
const failing = new Set<string>();
/** Urls a source has since moved to another address. */
const moved = new Map<string, string>();
let server: Server;

beforeAll(async () => {
	server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			if (req.url?.startsWith('/image/')) {
				res.writeHead(200, { 'content-type': 'image/jpeg' }).end(JPEG);
				return;
			}
			const b = JSON.parse(raw) as {
				method: string;
				sourceId?: string;
				mangaData?: { url: string; title?: string };
			};
			const json = (v: unknown) =>
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			const url = b.mangaData?.url ?? '';
			asked.push({ method: b.method, url, sourceId: b.sourceId });
			if (b.sourceId && failing.has(b.sourceId)) return res.writeHead(500).end('{"code":500}');
			if (b.method === 'getDetailsManga')
				return json({
					url: moved.get(url) ?? url,
					title: `Gallery ${url.split('/').pop()}`,
					author: '',
					status: 2,
					thumbnail_url: null
				});
			if (b.method === 'getChapterList')
				// A gallery lists one chapter, under its own URL.
				return json([{ url: `${url}/read`, name: 'Chapter', scanlator: null, chapter_number: 1 }]);
			if (b.method === 'getPageList')
				return json(
					[1, 2].map((i) => ({
						index: i,
						url: '',
						imageUrl: `http://127.0.0.1:8080/image/p${i}`
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
	for (const dir of [library, store, covers]) rmSync(dir, { recursive: true, force: true });
});

const db = getDb();
for (const s of [NH, HI]) {
	const handle = s.pkg.padEnd(64, '0');
	writeFileSync(join(store, `${handle}.apk`), Buffer.from('apk'));
	db.prepare(
		`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
		VALUES (?, ?, 'manga', 1, '1', '1.6', ?, 0, 0)`
	).run(s.pkg, s.name, handle);
	db.prepare(
		`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://g.example')`
	).run(s.id, s.pkg, s.name);
}

const deps = { db, library, now: () => 1_800_000_000_000 };
const reset = () => {
	asked.length = 0;
	failing.clear();
	moved.clear();
	db.prepare(`DELETE FROM series`).run();
	db.prepare(`DELETE FROM tombstones`).run();
	db.prepare(`DELETE FROM settings WHERE key LIKE 'source_%' OR key LIKE 'source-%'`).run();
	forgetSourceUse();
};
beforeEach(reset);

let urlCounter = 0;
/** A one-off through the app's own ADD: what the owner's two books actually were. */
async function addOneOff(source = NH, url = `/g/${++urlCounter}`) {
	const id = await engine.addToLibrary(engine.sourceMangaId(source.id, url), deps.now());
	return { id, key: keyOf(source.id, url), url };
}
const entriesOf = (seriesId: number) =>
	db
		.prepare(`SELECT id, available, source_url, file, title FROM entries WHERE series_id = ?`)
		.all(seriesId) as {
		id: number;
		available: number;
		source_url: string;
		file: string;
		title: string;
	}[];
const row = (id: number) =>
	db.prepare(`SELECT origin_key, kind, path, title FROM series WHERE id = ?`).get(id) as {
		origin_key: string | null;
		kind: string;
		path: string;
		title: string;
	};
const engineRow = (id: number) =>
	db
		.prepare(
			`SELECT source_id, engine_url, title, resolved_at FROM engine_series WHERE series_id = ?`
		)
		.get(id);
const asEntries = (id: number) =>
	entriesOf(id).map((e) => ({ id: e.id, available: !!e.available }));
const group = (ids: number[]) => books.groupIntoSeries({ seriesIds: ids, name: 'A Pair' });
const tagLanguage = (id: number, language: string) => {
	db.prepare(`INSERT OR IGNORE INTO tags (namespace, value) VALUES ('language', ?)`).run(language);
	db.prepare(
		`INSERT INTO series_tags (series_id, tag_id) SELECT ?, id FROM tags WHERE namespace = 'language' AND value = ?`
	).run(id, language);
};

/** Two undownloaded one-offs, grouped: the card's state. */
async function pair(a = NH, b = NH) {
	const one = await addOneOff(a);
	const two = await addOneOff(b);
	const { seriesId, entryIds } = group([one.id, two.id]);
	return { one, two, seriesId, entryIds };
}

describe('grouping a one-off keeps its link', () => {
	it('starts from what ADD really writes: a doujin holding its source key', async () => {
		const o = await addOneOff();
		expect(row(o.id).origin_key).toBe(o.key);
		expect(row(o.id).kind).toBe('doujin');
		expect(entriesOf(o.id)).toHaveLength(1);
	});

	it('moves each key from the singleton onto its book, and the group has none', async () => {
		const { one, two, seriesId, entryIds } = await pair();
		expect(row(seriesId).origin_key).toBeNull();
		expect(bookOrigins(seriesId).map((b) => b.key)).toEqual([one.key, two.key]);
		expect(entryOrigin(entryIds[0])).toBe(one.key);
		expect(entryOrigin(entryIds[1])).toBe(two.key);
		expect(bookOrigin(entryIds[0])!.sourceTitle).toBe(`Gallery ${one.url.split('/').pop()}`);
	});

	it('names the group from its root, so a download cannot take its folder for the series', async () => {
		const { seriesId } = await pair();
		expect(row(seriesId).path).toBe(join(library, 'Mihon'));
	});

	it('widens a target held inside a device folder when a book joins it', async () => {
		// A series with its own key, downloaded: its path is inside the device folder.
		const own = await addOneOff();
		const folder = join(library, 'devices', 'tsundoku', 'Mihon', 'downloads', 'n (EN)', 'Own');
		db.prepare(`UPDATE series SET path = ? WHERE id = ?`).run(folder, own.id);
		db.prepare(`UPDATE entries SET file = 'c.cbz', available = 1 WHERE series_id = ?`).run(own.id);
		const other = await addOneOff();
		books.groupIntoSeries({ seriesIds: [other.id], into: own.id });
		const path = row(own.id).path;
		expect(path.startsWith(join(library, 'devices'))).toBe(false);
		// The series' own file still names the same place on disk.
		const [e] = entriesOf(own.id);
		expect(join(path, e.file)).toBe(join(folder, 'c.cbz'));
	});

	it('reads a season as nothing: a book of no season is not season 0 of a season row', async () => {
		const { one, seriesId, entryIds } = await pair();
		// A season row, however a series came to have one, must not answer for a book.
		db.prepare(
			`INSERT INTO series_season_facts (series_id, season, origin_key) VALUES (?, 0, ?)`
		).run(seriesId, 'mihon:999:/season');
		expect(entryOrigin(entryIds[0])).toBe(one.key);
	});
});

describe('the series screen, once grouped', () => {
	it('answers ok, each book queueable, and each reads online', async () => {
		const { seriesId, entryIds } = await pair();
		const d = engine.seriesDownloads(seriesId, asEntries(seriesId));
		expect(d.kind).toBe('ok');
		if (d.kind !== 'ok') return;
		for (const id of entryIds) {
			expect(d.states[id]).toEqual({ kind: 'none', chapterId: id });
			expect(readsOnline(id)).toBe(true);
		}
		// The screen's own wrapper goes the same way, and REFRESH is offered.
		const wrapped = await downloads.seriesDownloads(seriesId, asEntries(seriesId));
		expect(wrapped).toMatchObject({ kind: 'ok', refreshable: true });
	});

	it('answers none for a group of books from nowhere', async () => {
		const a = await addOneOff();
		const b = await addOneOff();
		db.prepare(`UPDATE series SET origin_key = NULL WHERE id IN (?, ?)`).run(a.id, b.id);
		const { seriesId } = group([a.id, b.id]);
		expect(engine.seriesDownloads(seriesId, asEntries(seriesId))).toEqual({ kind: 'none' });
	});

	it('books from two sources, one extension removed: the other still answers, the gone one is refused', async () => {
		const { seriesId, entryIds } = await pair(NH, HI);
		db.prepare(`UPDATE engine_extensions SET failed = 'x' WHERE pkg = ?`).run(HI.pkg);
		try {
			const d = engine.seriesDownloads(seriesId, asEntries(seriesId));
			expect(d.kind).toBe('ok');
			if (d.kind !== 'ok') return;
			expect(d.states[entryIds[0]]).toEqual({ kind: 'none', chapterId: entryIds[0] });
			expect(d.states[entryIds[1]]).toEqual({ kind: 'none', chapterId: null });
			expect(readsOnline(entryIds[0])).toBe(true);
			expect(readsOnline(entryIds[1])).toBe(false);
		} finally {
			db.prepare(`UPDATE engine_extensions SET failed = '' WHERE pkg = ?`).run(HI.pkg);
		}
	});

	it('every book’s extension removed: elsewhere, naming a source', async () => {
		const { seriesId } = await pair(NH, HI);
		db.prepare(`UPDATE engine_extensions SET failed = 'x'`).run();
		try {
			expect(engine.seriesDownloads(seriesId, asEntries(seriesId))).toMatchObject({
				kind: 'elsewhere'
			});
		} finally {
			db.prepare(`UPDATE engine_extensions SET failed = ''`).run();
		}
	});

	it('one book already downloaded and one not: each its own state', async () => {
		const { seriesId, entryIds } = await pair();
		db.prepare(`UPDATE entries SET available = 1, file = 'x.cbz' WHERE id = ?`).run(entryIds[0]);
		const d = engine.seriesDownloads(seriesId, asEntries(seriesId));
		expect(d.kind).toBe('ok');
		if (d.kind !== 'ok') return;
		expect(d.states[entryIds[0]]).toEqual({ kind: 'have' });
		expect(d.states[entryIds[1]]).toEqual({ kind: 'none', chapterId: entryIds[1] });
		expect(readsOnline(entryIds[0])).toBe(false);
	});

	it('a book the source no longer lists can’t be queued, once its source was asked', async () => {
		const { seriesId, entryIds } = await pair();
		await worker.resolveBook(entryIds[0], deps, true);
		// Asked, and listed: its chapter is there.
		expect(
			db.prepare(`SELECT 1 FROM engine_chapters WHERE entry_id = ?`).get(entryIds[0])
		).toBeTruthy();
		db.prepare(`DELETE FROM engine_chapters WHERE entry_id = ?`).run(entryIds[0]);
		const d = engine.seriesDownloads(seriesId, asEntries(seriesId));
		if (d.kind !== 'ok') throw new Error(d.kind);
		expect(d.states[entryIds[0]]).toEqual({ kind: 'none', chapterId: null });
		expect(d.states[entryIds[1]]).toEqual({ kind: 'none', chapterId: entryIds[1] });
	});

	it('resolves each book at its own address, and only every so often', async () => {
		const { entryIds, one } = await pair();
		await worker.resolveBook(entryIds[0], deps);
		expect(asked.filter((c) => c.method === 'getDetailsManga').map((c) => c.url)).toContain(
			one.url
		);
		const n = asked.length;
		await worker.resolveBook(entryIds[0], deps); // inside the TTL: not asked
		expect(asked.length).toBe(n);
		await worker.resolveBook(entryIds[0], deps, true); // forced: asked
		expect(asked.length).toBeGreaterThan(n);
	});

	it('asks at most a few unasked books at one look', async () => {
		const ids: number[] = [];
		for (let i = 0; i < 9; i++) ids.push((await addOneOff()).id);
		const { seriesId } = group(ids);
		// ADD asked each already (`rememberAtSource`): as a book whose ADD predates it.
		db.prepare(`UPDATE entry_origins SET resolved_at = NULL`).run();
		const before = asked.length;
		engine.seriesDownloads(seriesId, asEntries(seriesId));
		await expect.poll(() => asked.length - before).toBeGreaterThan(0);
		// Each ask is details then chapters; six books is at most twelve calls.
		await new Promise((ok) => setTimeout(ok, 150));
		expect(asked.slice(before).filter((c) => c.method === 'getDetailsManga').length).toBe(6);
	});

	it('keeps the source’s new address on the book, not the series', async () => {
		const { entryIds, one } = await pair();
		moved.set(one.url, '/moved/1');
		await worker.resolveBook(entryIds[0], deps, true);
		expect(bookOrigin(entryIds[0])!.engineUrl).toBe('/moved/1');
		// The key never moves.
		expect(bookOrigin(entryIds[0])!.key).toBe(one.key);
	});

	it('leaves FOLLOW off a group of one-offs: there is no one thing to follow', async () => {
		const { seriesId, entryIds } = await pair();
		const d = engine.seriesDownloads(seriesId, asEntries(seriesId));
		if (d.kind !== 'ok') throw new Error(d.kind);
		expect(d.follow).toEqual({ on: false, checked: null, askable: false });
		const entries = asEntries(seriesId).map((e) => ({
			...e,
			number: 1,
			readAt: null,
			bytes: 0,
			matter: '' as const
		}));
		const row2 = downloadRow(
			entries,
			{ kind: 'ok', states: new Map(Object.entries(d.states).map(([k, v]) => [Number(k), v])) },
			true,
			() => '',
			d.follow
		);
		expect(row2.cells.map((c) => c.which)).toEqual(['next']);
		expect(entryIds).toHaveLength(2);
		// And asking anyway is still the refusal it always was.
		expect(() => engine.setFollowed(seriesId, true, 1)).toThrow(/installed source/);
	});

	it('still follows a series that holds its own key, with a book in it', async () => {
		const own = await addOneOff();
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, source_url)
			SELECT ?, 2, 'Ch. 2', 1, '/own/2'`
		).run(own.id);
		const other = await addOneOff();
		books.groupIntoSeries({ seriesIds: [other.id], into: own.id });
		const d = engine.seriesDownloads(own.id, asEntries(own.id));
		if (d.kind !== 'ok') throw new Error(d.kind);
		expect((d.follow as FollowFacts).askable).toBe(true);
		// The series' own ask is its own chapters', never the book's, which keeps its address.
		const book = bookOrigins(own.id)[0];
		const bookUrl = () =>
			db
				.prepare(`SELECT engine_url AS u FROM engine_chapters WHERE entry_id = ?`)
				.get(book.entryId);
		const was = bookUrl();
		await worker.resolveSeries(own.id, deps, true);
		expect(bookUrl()).toEqual(was);
	});
});

describe('downloading a grouped book', () => {
	it('queues each book under its own key and source lane', async () => {
		const { seriesId, entryIds, one, two } = await pair(NH, HI);
		expect(engine.enqueue(seriesId, entryIds)).toEqual({ queued: 2, missing: 0 });
		const rows = new Map(queueRows().map((r) => [r.entryId, r]));
		expect(rows.get(entryIds[0])).toMatchObject({ sourceId: NH.id, kind: 'manga' });
		expect(rows.get(entryIds[1])).toMatchObject({ sourceId: HI.id, kind: 'manga' });
		const items = new Map(engine.engineQueue().items.map((i) => [i.chapterId, i]));
		expect(items.get(entryIds[0])!.key).toBe(one.key);
		expect(items.get(entryIds[1])!.key).toBe(two.key);
		expect(seriesForKey(one.key)).toMatchObject({ id: seriesId });
		// The queue groups by key, so a book goes by its own name there, not the group's.
		expect(seriesForKey(one.key)!.title).toBe(`Gallery ${one.url.split('/').pop()}`);
	});

	it('downloads both books, comes back as files on each, and neither is marked missing', async () => {
		const { seriesId, entryIds, one, two } = await pair();
		engine.enqueue(seriesId, entryIds);
		const written: string[] = [];
		const d = { ...deps, arrived: (f: string) => written.push(f) };
		expect(await worker.runOnce(d)).toBe(1);
		expect(await worker.runOnce(d)).toBe(1);
		expect(written).toHaveLength(2);
		// The first attach, then the second: the writer must not lose the first.
		expect(await attachWritten(library, [written[0]], deps.now())).toEqual([]);
		expect(await attachWritten(library, [written[1]], deps.now())).toEqual([]);
		const after = entriesOf(seriesId);
		expect(after.map((e) => e.available)).toEqual([1, 1]);
		for (const e of after) expect(existsSync(join(row(seriesId).path, e.file))).toBe(true);
		// A later scan-shaped re-attach changes nothing.
		await attachWritten(library, written, deps.now());
		expect(entriesOf(seriesId).map((e) => e.available)).toEqual([1, 1]);
		// Each book's backup entry names its own key, and two manga came of it.
		const manga = worker.deviceBackup(db).manga;
		expect(manga.map((m) => `mihon:${m.source}:${m.url}`).sort()).toEqual(
			[one.key, two.key].sort()
		);
	});
});

describe('UNGROUP and UNDO put the link back', () => {
	/** A row to compare, field by field. */
	const singleton = (id: number) => ({
		key: row(id).origin_key,
		kind: row(id).kind,
		engine: engineRow(id)
	});

	it('gives each book its key and its engine row back, exactly', async () => {
		const one = await addOneOff();
		const two = await addOneOff();
		await worker.resolveSeries(one.id, deps, true);
		await worker.resolveSeries(two.id, deps, true);
		const before = [singleton(one.id), singleton(two.id)];
		const titleBefore = [row(one.id).title, row(two.id).title];
		const { seriesId, entryIds } = group([one.id, two.id]);
		expect(bookOrigin(entryIds[0])!.engineUrl).not.toBeNull();
		const made = books.takeOut(seriesId, entryIds, deps.now());
		expect(made.map(singleton)).toEqual(before);
		expect(made.map((id) => row(id).title)).toEqual(titleBefore);
		// Nothing left beside it: the singleton holds the key alone.
		expect(bookOrigins(made[0])).toEqual([]);
	});

	it('holds through group, ungroup, group again', async () => {
		const { seriesId, entryIds, one, two } = await pair();
		const [a, b] = books.takeOut(seriesId, entryIds, deps.now());
		expect([row(a).origin_key, row(b).origin_key]).toEqual([one.key, two.key]);
		const again = group([a, b]);
		expect(bookOrigins(again.seriesId).map((o) => o.key)).toEqual([one.key, two.key]);
		const [c, d] = books.takeOut(again.seriesId, again.entryIds, deps.now());
		expect([row(c).origin_key, row(d).origin_key]).toEqual([one.key, two.key]);
	});

	it('a book taken out of a group of two ends the group, and the book left keeps its key', async () => {
		const { seriesId, entryIds, one, two } = await pair();
		const [single] = books.takeOut(seriesId, [entryIds[0]], deps.now());
		expect(row(single).origin_key).toBe(one.key);
		expect(entryOrigin(entryIds[1])).toBe(two.key);
		// Grouped into another series, the book left over still carries its own.
		const lone = await addOneOff();
		const { seriesId: next, entryIds: nextIds } = books.groupIntoSeries({
			seriesIds: [seriesId, lone.id],
			name: 'Second'
		});
		expect(entryOrigin(entryIds[1])).toBe(two.key);
		expect(row(next).origin_key).toBeNull();
		expect(bookOrigins(next).map((o) => o.key)).toEqual([two.key, lone.key]);
		expect(nextIds).toHaveLength(2);
	});

	it('UNDO of a take-out (group into it again) leaves its origin exact', async () => {
		const { seriesId, entryIds, one } = await pair();
		const [single] = books.takeOut(seriesId, [entryIds[0]], deps.now());
		const {
			entryIds: [back]
		} = books.groupIntoSeries({ seriesIds: [single], into: seriesId });
		expect(back).toBe(entryIds[0]);
		expect(entryOrigin(back)).toBe(one.key);
		expect(row(seriesId).origin_key).toBeNull();
	});

	it('finds the book by its entry across an UNDO, whose series row comes back with another id', async () => {
		const { seriesId, entryIds, one } = await pair();
		const [first] = books.takeOut(seriesId, [entryIds[0]], deps.now());
		books.groupIntoSeries({ seriesIds: [first], into: seriesId });
		// Something else takes the id the first singleton's row left free.
		await addOneOff(HI);
		const [second] = books.takeOut(seriesId, [entryIds[0]], deps.now());
		expect(second).not.toBe(first);
		expect(row(second).origin_key).toBe(one.key);
	});

	it('MOVE TO… out and back keeps each book’s key', async () => {
		const { seriesId, entryIds, one, two } = await pair();
		const other = await pair();
		books.moveBook(seriesId, entryIds[0], other.seriesId);
		expect(entryOrigin(entryIds[0])).toBe(one.key);
		books.moveBook(other.seriesId, entryIds[0], seriesId);
		expect(entryOrigin(entryIds[0])).toBe(one.key);
		expect(entryOrigin(entryIds[1])).toBe(two.key);
	});

	it('MOVE TO… of a singleton’s last book keeps the key its series would have taken with it', async () => {
		const one = await addOneOff();
		const { seriesId } = await pair();
		const [entry] = entriesOf(one.id);
		books.moveBook(one.id, entry.id, seriesId);
		expect(row(seriesId).origin_key).toBeNull();
		expect(entryOrigin(entry.id)).toBe(one.key);
	});

	it('does not give a chapter its series’ key when the series stays and holds it', async () => {
		const own = await addOneOff();
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, source_url)
			VALUES (?, 2, 'Ch. 2', 1, '/own/2')`
		).run(own.id);
		const { seriesId } = await pair();
		const [, second] = entriesOf(own.id);
		books.moveBook(own.id, second.id, seriesId);
		expect(row(own.id).origin_key).toBe(own.key);
		expect(bookOrigin(second.id)).toBeNull();
	});

	it('leaves the key on the book when something else holds it now', async () => {
		const { seriesId, entryIds, one } = await pair();
		db.prepare(`UPDATE series SET origin_key = ? WHERE id = ?`).run(one.key, seriesId);
		const [single] = books.takeOut(seriesId, [entryIds[0]], deps.now());
		expect(row(single).origin_key).toBeNull();
		expect(bookOrigin(entryIds[0])!.key).toBe(one.key);
	});

	it('FOLD and UNFOLD carry an edition’s key', async () => {
		const base = await addOneOff();
		const other = await addOneOff();
		const tag = (id: number, v: string) => {
			db.prepare(`INSERT OR IGNORE INTO tags (namespace, value) VALUES ('language', ?)`).run(v);
			db.prepare(
				`INSERT INTO series_tags (series_id, tag_id) SELECT ?, id FROM tags WHERE namespace = 'language' AND value = ?`
			).run(id, v);
		};
		tag(base.id, 'english');
		tag(other.id, 'japanese');
		const [entry] = books.foldEditions(base.id, [other.id], () => [], deps.now());
		expect(entryOrigin(entry)).toBe(other.key);
		const [single] = books.unfoldEditions(base.id, () => 0, deps.now());
		expect(row(single).origin_key).toBe(other.key);
		expect(bookOrigin(entry)).toBeNull();
	});

	it('a novel’s key comes back when it’s taken out of a group of volumes', async () => {
		const key = 'lnreader:plug:/novel-1';
		const n = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, hue, added_at, indexed_at, origin_key, path)
					VALUES ((SELECT id FROM roots LIMIT 1), 'Novel', 'novel', 1, 1, 1, ?, '/n/1')`
				)
				.run(key).lastInsertRowid
		);
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, file) VALUES (?, 1, 'Ch. 1', 1, 'n1.epub')`
		).run(n);
		const m = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, hue, added_at, indexed_at, path)
					VALUES ((SELECT id FROM roots LIMIT 1), 'Other', 'novel', 1, 1, 1, '/n/2')`
				)
				.run().lastInsertRowid
		);
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, file) VALUES (?, 1, 'Ch. 1', 1, 'n2.epub')`
		).run(m);
		const { seriesId } = books.groupIntoSeries({ seriesIds: [n, m], name: 'Vols' });
		expect(bookOrigins(seriesId).map((o) => o.key)).toEqual([key]);
		const made = books.takeOutVolumes(seriesId, undefined, deps.now());
		expect(made.map((id) => row(id).origin_key)).toEqual([key, null]);
	});
});

describe('a group’s path when the Mihon root is the device folder', () => {
	const home = join(library, 'Mihon');
	const deviceRoot = join(library, 'devices', 'tsundoku', 'Mihon');
	const rootAt = (path: string) =>
		db.prepare(`UPDATE roots SET path = ? WHERE name = 'Mihon'`).run(path);
	// `reset` keeps `roots`: every other case in this file wants the root back.
	afterEach(() => rootAt(home));

	const fetchAll = async (n: number) => {
		const written: string[] = [];
		const d = { ...deps, arrived: (f: string) => written.push(f) };
		for (let i = 0; i < n; i++) expect(await worker.runOnce(d)).toBe(1);
		expect(written).toHaveLength(n);
		return written;
	};

	it('attaches two downloads in turn and neither is marked missing', async () => {
		const first = await addOneOff();
		rootAt(deviceRoot);
		const second = await addOneOff();
		const { seriesId, entryIds } = group([first.id, second.id]);
		engine.enqueue(seriesId, entryIds);
		const written = await fetchAll(2);
		await attachWritten(library, [written[0]], deps.now());
		expect(entriesOf(seriesId).map((e) => e.available)).toEqual([1, 0]);
		await attachWritten(library, [written[1]], deps.now());
		const after = entriesOf(seriesId);
		expect(after.map((e) => e.available)).toEqual([1, 1]);
		for (const e of after) expect(existsSync(join(row(seriesId).path, e.file))).toBe(true);
	});

	it.each([
		['the device folder', join(library, 'devices', 'tsundoku', 'Mihon'), library],
		['another device’s', join(library, 'devices', 'phone', 'Mihon'), library],
		['the devices folder itself', join(library, 'devices'), library],
		['a folder only named like it', join(library, 'devices-old', 'Mihon'), null],
		['the library’s own Mihon', join(library, 'Mihon'), null]
	])('names the group from where the root allows: %s', async (_name, root, expected) => {
		const first = await addOneOff();
		rootAt(root);
		const second = await addOneOff();
		const { seriesId } = group([first.id, second.id]);
		expect(row(seriesId).path).toBe(expected ?? root);
	});

	it('widens a target inside the device folder to the library, and attaches beside its file', async () => {
		const own = await addOneOff();
		rootAt(deviceRoot);
		const folder = join(deviceRoot, 'downloads', 'n (EN)', 'Own');
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, 'c.cbz'), 'held');
		db.prepare(`UPDATE series SET path = ? WHERE id = ?`).run(folder, own.id);
		db.prepare(`UPDATE entries SET file = 'c.cbz', available = 1 WHERE series_id = ?`).run(own.id);
		const other = await addOneOff();
		const {
			entryIds: [book]
		} = books.groupIntoSeries({ seriesIds: [other.id], into: own.id });
		expect(row(own.id).path).toBe(library);
		const [held] = entriesOf(own.id);
		expect(join(row(own.id).path, held.file)).toBe(join(folder, 'c.cbz'));
		engine.enqueue(own.id, [book]);
		await attachWritten(library, await fetchAll(1), deps.now());
		const after = entriesOf(own.id);
		expect(after.map((e) => e.available)).toEqual([1, 1]);
		for (const e of after) expect(existsSync(join(row(own.id).path, e.file))).toBe(true);
	});

	it('MOVE TO… onto a target in the device folder leaves it outside', async () => {
		const own = await addOneOff();
		rootAt(deviceRoot);
		const folder = join(deviceRoot, 'downloads', 'n (EN)', 'Target');
		db.prepare(`UPDATE series SET path = ? WHERE id = ?`).run(folder, own.id);
		const other = await addOneOff();
		const [entry] = entriesOf(other.id);
		books.moveBook(other.id, entry.id, own.id);
		expect(row(own.id).path).toBe(library);
	});

	it('FOLD keeps a base out of the folder too: a queued edition and its base attach in turn', async () => {
		const base = await addOneOff();
		const other = await addOneOff();
		tagLanguage(base.id, 'english');
		tagLanguage(other.id, 'japanese');
		const [baseEntry] = entriesOf(base.id);
		const [otherEntry] = entriesOf(other.id);
		engine.enqueue(base.id, [baseEntry.id]);
		engine.enqueue(other.id, [otherEntry.id]);
		books.foldEditions(base.id, [other.id], () => [], deps.now());
		expect(row(base.id).path.startsWith(join(library, 'devices'))).toBe(false);
		expect(row(base.id).path).not.toBe('');
		const written = await fetchAll(2);
		await attachWritten(library, [written[0]], deps.now());
		await attachWritten(library, [written[1]], deps.now());
		const after = db
			.prepare(`SELECT available, file FROM entries WHERE series_id = ? ORDER BY id`)
			.all(base.id) as { available: number; file: string }[];
		expect(after.map((e) => e.available)).toEqual([1, 1]);
		for (const e of after) expect(existsSync(join(row(base.id).path, e.file))).toBe(true);
	});
});

describe('a queued download goes where its entry goes', () => {
	const queued = (entryId: number) => queueRows().find((r) => r.entryId === entryId);
	const inQueue = (entryId: number) =>
		engine.engineQueue().items.find((i) => i.chapterId === entryId);

	it('UNGROUP of one queued book of three: its singleton, its own source and key', async () => {
		const a = await addOneOff();
		const b = await addOneOff(HI);
		const c = await addOneOff();
		const { seriesId, entryIds } = group([a.id, b.id, c.id]);
		engine.enqueue(seriesId, [entryIds[1]]);
		const before = queued(entryIds[1])!;
		expect(before).toMatchObject({ seriesId, sourceId: HI.id });
		const [single] = books.takeOut(seriesId, [entryIds[1]], deps.now());
		expect(queued(entryIds[1])).toEqual({ ...before, seriesId: single });
		expect(inQueue(entryIds[1])).toMatchObject({
			key: b.key,
			mangaId: single,
			mangaTitle: row(single).title
		});
		expect(row(single).title).not.toBe('A Pair');
		// And past the move: the worker still fetches it, as the singleton's.
		const written: string[] = [];
		expect(await worker.runOnce({ ...deps, arrived: (f: string) => written.push(f) })).toBe(1);
		await attachWritten(library, written, deps.now());
		expect(entriesOf(single).map((e) => e.available)).toEqual([1]);
	});

	it('GROUP of a queued one-off: the row follows it onto the group', async () => {
		const a = await addOneOff();
		const b = await addOneOff(HI);
		const [entry] = entriesOf(b.id);
		engine.enqueue(b.id, [entry.id]);
		const before = queued(entry.id)!;
		const { seriesId } = group([a.id, b.id]);
		expect(queued(entry.id)).toEqual({ ...before, seriesId });
		expect(inQueue(entry.id)).toMatchObject({ key: b.key, mangaId: seriesId });
	});

	it('GROUP into a series that already exists carries it too', async () => {
		const { seriesId } = await pair();
		const b = await addOneOff(HI);
		const [entry] = entriesOf(b.id);
		engine.enqueue(b.id, [entry.id]);
		books.groupIntoSeries({ seriesIds: [b.id], into: seriesId });
		expect(queued(entry.id)).toMatchObject({ seriesId, sourceId: HI.id });
	});

	it('a group of two, both taken out: the queued book survives the group going', async () => {
		const { seriesId, entryIds, two } = await pair(NH, HI);
		engine.enqueue(seriesId, [entryIds[1]]);
		const made = books.takeOut(seriesId, entryIds, deps.now());
		expect(row(seriesId)).toBeUndefined();
		expect(queued(entryIds[1])).toMatchObject({ seriesId: made[1], sourceId: HI.id });
		expect(inQueue(entryIds[1])).toMatchObject({ key: two.key, mangaId: made[1] });
	});

	it('a book mid-download goes with its state', async () => {
		const { seriesId, entryIds } = await pair();
		engine.enqueue(seriesId, [entryIds[0]]);
		db.prepare(`UPDATE download_queue SET state = 'downloading', done_pages = 1, pages = 2`).run();
		const [single] = books.takeOut(seriesId, [entryIds[0]], deps.now());
		expect(queued(entryIds[0])).toMatchObject({
			seriesId: single,
			state: 'downloading',
			donePages: 1,
			pages: 2
		});
	});

	it('MOVE TO… of a queued last book: the row survives on the target', async () => {
		const lone = await addOneOff(HI);
		const { seriesId } = await pair();
		const [entry] = entriesOf(lone.id);
		engine.enqueue(lone.id, [entry.id]);
		books.moveBook(lone.id, entry.id, seriesId);
		expect(row(lone.id)).toBeUndefined();
		expect(queued(entry.id)).toMatchObject({ seriesId, sourceId: HI.id });
		expect(inQueue(entry.id)).toMatchObject({ key: lone.key, mangaId: seriesId });
	});

	it('MOVE TO… of a queued book of a group: its own key and the target’s row', async () => {
		const from = await pair(NH, HI);
		const to = await pair();
		engine.enqueue(from.seriesId, [from.entryIds[1]]);
		books.moveBook(from.seriesId, from.entryIds[1], to.seriesId);
		expect(queued(from.entryIds[1])).toMatchObject({ seriesId: to.seriesId, sourceId: HI.id });
	});

	it('MOVE TO… of a queued chapter that keeps no key: on the target, and failed where it shows', async () => {
		const own = await addOneOff();
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, source_url, available)
			VALUES (?, 2, 'Ch. 2', 1, '/own/2', 0)`
		).run(own.id);
		const [, second] = entriesOf(own.id);
		expect(engine.enqueue(own.id, [second.id])).toEqual({ queued: 1, missing: 0 });
		const { seriesId } = await pair();
		books.moveBook(own.id, second.id, seriesId);
		expect(queued(second.id)).toMatchObject({ seriesId, sourceId: '', tries: 0 });
		// Nothing to ask: the worker tries it, refuses it, and it waits on the list.
		expect(await worker.runOnce(deps)).toBe(0);
		expect(queued(second.id)).toMatchObject({ seriesId, tries: 1, failure: 'not-found' });
	});

	it('FOLD and UNFOLD carry a queued edition', async () => {
		const base = await addOneOff();
		const other = await addOneOff(HI);
		tagLanguage(base.id, 'english');
		tagLanguage(other.id, 'japanese');
		const [otherEntry] = entriesOf(other.id);
		engine.enqueue(other.id, [otherEntry.id]);
		const [entry] = books.foldEditions(base.id, [other.id], () => [], deps.now());
		expect(queued(entry)).toMatchObject({ seriesId: base.id, sourceId: HI.id });
		const [single] = books.unfoldEditions(base.id, () => 0, deps.now());
		expect(queued(entry)).toMatchObject({ seriesId: single, sourceId: HI.id });
		expect(inQueue(entry)).toMatchObject({ key: other.key, mangaId: single });
	});

	it('volumes bound and taken out carry a queued chapter', async () => {
		const volume = (title: string, key: string | null, file: string) => {
			const id = Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, hue, added_at, indexed_at, origin_key, path)
						VALUES ((SELECT id FROM roots LIMIT 1), ?, 'novel', 1, 1, 1, ?, '/n/q')`
					)
					.run(title, key).lastInsertRowid
			);
			const entry = Number(
				db
					.prepare(
						`INSERT INTO entries (series_id, position, label, added_at, file, source_url, available)
						VALUES (?, 1, 'Ch. 1', 1, ?, '/c/1', 0)`
					)
					.run(id, file).lastInsertRowid
			);
			return { id, entry };
		};
		const key = 'lnreader:plug:/novel-q';
		const n = volume('Novel Q', key, 'q1.epub');
		const m = volume('Other Q', null, 'q2.epub');
		expect(enqueueEntries([n.entry])).toBe(1);
		const before = queued(n.entry)!;
		const { seriesId } = books.groupIntoSeries({ seriesIds: [n.id, m.id], name: 'Vols Q' });
		expect(queued(n.entry)).toEqual({ ...before, seriesId });
		const made = books.takeOutVolumes(seriesId, undefined, deps.now());
		expect(queued(n.entry)).toEqual({ ...before, seriesId: made[0] });
	});
});

describe('every other reader of a key', () => {
	it('recognises a grouped book at its source: ADD answers the group and adds nothing', async () => {
		const { one, seriesId } = await pair();
		const count = db.prepare(`SELECT COUNT(*) AS n FROM series`).get() as { n: number };
		expect(await engine.addToLibrary(engine.sourceMangaId(NH.id, one.url), deps.now())).toBe(
			seriesId
		);
		expect(db.prepare(`SELECT COUNT(*) AS n FROM series`).get()).toEqual(count);
		expect(seriesHolding(one.key)).toMatchObject({ id: seriesId });
		expect(heldByOther(one.key, seriesId)).toBeNull();
		expect(heldByOther(one.key, seriesId + 1)).toMatchObject({ id: seriesId });
		expect(libraryIndex(true).byKey.get(one.key)).toMatchObject({ id: seriesId, total: 1 });
	});

	it('counts a group of books at their sources once each', async () => {
		await pair(NH, NH);
		await pair(HI, HI);
		forgetSourceUse();
		const use = sourceUse();
		expect(use.get(NH.id)?.series).toBe(1);
		expect(use.get(HI.id)?.series).toBe(1);
	});

	it('a source’s switch still reaches a book in a group', async () => {
		const { seriesId } = await pair(NH, HI);
		flags.setSourceFlag(NH.id, 'offHistory', true);
		const hit = db
			.prepare(`SELECT 1 FROM series s WHERE s.id = ? AND ${flags.sourceFlagSql('offHistory')}`)
			.get(seriesId);
		expect(hit).toBeTruthy();
		flags.setSourceFlag(NH.id, 'offHistory', false);
		expect(
			db
				.prepare(`SELECT 1 FROM series s WHERE s.id = ? AND ${flags.sourceFlagSql('offHistory')}`)
				.get(seriesId)
		).toBeUndefined();
		// CONCEAL counts it among the source's.
		expect(flags.concealable(NH.id).own).toContain(seriesId);
		expect(flags.ofSource([seriesId], HI.id)).toEqual([seriesId]);
	});

	it('hiddenByKey finds a grouped book, so ADD AND DOWNLOAD asks the right series', async () => {
		const { one, seriesId } = await pair();
		expect(flags.hiddenByKey(one.key)).toEqual({ id: seriesId, hidden: false });
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(seriesId);
		expect(flags.hiddenByKey(one.key)).toEqual({ id: seriesId, hidden: true });
	});

	it('deleting a group buries each book’s key: neither comes back by ADD', async () => {
		const { seriesId, one, two } = await pair();
		await deleteSeries([seriesId], true, deps.now());
		for (const o of [one, two]) {
			expect(db.prepare(`SELECT 1 FROM tombstones WHERE key = ?`).get(o.key)).toBeTruthy();
			await expect(
				engine.addToLibrary(engine.sourceMangaId(NH.id, o.url), deps.now())
			).rejects.toThrow(/deleted here/);
		}
		expect(db.prepare(`SELECT COUNT(*) AS n FROM entry_origins`).get()).toEqual({ n: 0 });
	});

	it('deleting one book of a group buries that book’s key alone', async () => {
		const { seriesId, entryIds, one, two } = await pair();
		await deleteBook(seriesId, entryIds[0], true, deps.now());
		expect(db.prepare(`SELECT 1 FROM tombstones WHERE key = ?`).get(one.key)).toBeTruthy();
		expect(db.prepare(`SELECT 1 FROM tombstones WHERE key = ?`).get(two.key)).toBeFalsy();
	});

	it('REFRESH asks each book and makes no new entries', async () => {
		const { seriesId, entryIds, one, two } = await pair(NH, HI);
		expect(await refreshSeries(seriesId, deps.now())).toEqual({ kind: 'manga', added: 0 });
		expect(asked.filter((c) => c.method === 'getDetailsManga').map((c) => c.url)).toEqual(
			expect.arrayContaining([one.url, two.url])
		);
		expect(entriesOf(seriesId)).toHaveLength(2);
		for (const id of entryIds) expect(bookOrigin(id)!.resolvedAt).toBe(deps.now());
		const run = await refreshMany([seriesId], { reveal: true, now: deps.now() });
		expect(run.asked).toBe(1);
		expect(run.skipped).toBe(0);
	});

	it('REFRESH goes on when one source fails, and fails when every one does', async () => {
		const { seriesId } = await pair(NH, HI);
		failing.add(HI.id);
		await expect(refreshSeries(seriesId, deps.now())).resolves.toMatchObject({ added: 0 });
		failing.add(NH.id);
		await expect(refreshSeries(seriesId, deps.now())).rejects.toThrow();
	});

	it('ranks a season over no book: a series with a season row still reads it, unmoved', async () => {
		const o = await addOneOff();
		const [e] = entriesOf(o.id);
		db.prepare(
			`INSERT INTO series_season_facts (series_id, season, origin_key) VALUES (?, 0, 'mihon:9:/s')`
		).run(o.id);
		expect(entryOrigin(e.id)).toBe('mihon:9:/s');
	});
});

describe('rung 76', () => {
	it('adds the table and repairs nothing it cannot read', () => {
		const conn = new Database(':memory:');
		climb(conn, 75);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Mihon', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES (1, 1, 'Old Group', 'doujin', 1);
			INSERT INTO entries (id, series_id, position, label, added_at, source_url)
				VALUES (1, 1, 1, 'Ch. 1', 1, '/g/1/read'), (2, 1, 2, 'Ch. 2', 1, '/g/2/read');
		`);
		climb(conn, 76);
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM entry_origins`).get()).toEqual({ n: 0 });
		expect(conn.prepare(`SELECT origin_key FROM series WHERE id = 1`).get()).toEqual({
			origin_key: null
		});
		// A group that held nothing reads nothing, as it did: none, no book.
		expect(conn.prepare(`SELECT source_url FROM entries ORDER BY id`).all()).toHaveLength(2);
	});

	it('goes with its entry', () => {
		const conn = new Database(':memory:');
		climb(conn);
		conn.pragma('foreign_keys = ON');
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Mihon', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES (1, 1, 'G', 'doujin', 1);
			INSERT INTO entries (id, series_id, position, label, added_at) VALUES (1, 1, 1, 'Ch. 1', 1);
			INSERT INTO entry_origins (entry_id, origin_key) VALUES (1, 'mihon:1:/x');
			DELETE FROM entries WHERE id = 1;
		`);
		expect(conn.prepare(`SELECT COUNT(*) AS n FROM entry_origins`).get()).toEqual({ n: 0 });
	});
});
