import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 't';
const work = mkdtempSync(join(tmpdir(), 'tsundoku-browsing-'));
process.env.LIBRARY_ROOT = join(work, 'library');
process.env.ENGINE_STORE = join(work, 'store');
process.env.COVER_DIR = join(work, 'covers');
afterAll(() => rmSync(work, { recursive: true, force: true }));

const { getDb } = await import('$lib/server/db');
const downloads = await import('$lib/server/downloads');
const lib = await import('$lib/server/library');
const sources = await import('$lib/server/library-sources');
const { historyDays } = await import('$lib/server/history');
const { recordReading, seriesPage } = await import('$lib/server/series');
const { historyMeta } = await import('$lib/library/history');
const { sourceMangaId } = await import('$lib/server/engine/backend');

// The browsing record (doc/BROWSING.md; card c161): an episode played from a
// source's preview without ADD. A series all the same, so the player works on
// it, but on no shelf, in no count, never searched or queued; HISTORY has it,
// and ADD makes it the library's with its progress.
const ANIME = '7000';
let server: Server;

beforeAll(async () => {
	server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as { method: string; animeData?: { url: string } };
			const json = (v: unknown) =>
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			if (b.method === 'getDetailsAnime')
				return json({ url: b.animeData!.url, title: 'Hoshi no Wataridori', status: 1 });
			if (b.method === 'getEpisodeList')
				return json([
					{ url: '/e/2', name: 'Episode 2', episode_number: 2 },
					{ url: '/e/1', name: 'Episode 1', episode_number: 1 }
				]);
			res.writeHead(404).end('{"error":"no","code":404}');
		});
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	process.env.ENGINE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
});

const db = getDb();
db.prepare(
	`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
	VALUES ('e2e.anime', 'AnimePahe', 'anime', 1, '1.0', '16', ?, 0, 0, '')`
).run('e2e.anime'.padEnd(64, '0'));
db.prepare(
	`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, 'e2e.anime', 'AnimePahe', 'en', 'https://example.org')`
).run(ANIME);

const id = sourceMangaId(ANIME, '/anime/wataridori');
const row = (seriesId: number) =>
	db.prepare(`SELECT in_library, browsed_at FROM series WHERE id = ?`).get(seriesId) as {
		in_library: number;
		browsed_at: number | null;
	};
let seriesId = 0;
let ep1 = 0;

describe('an episode played without ADD', () => {
	it('opens in a browsing record, written on the first open', async () => {
		ep1 = (await downloads.openFromSource(id, '/e/1'))!;
		expect(ep1).toBeGreaterThan(0);
		seriesId = (
			db.prepare(`SELECT series_id FROM entries WHERE id = ?`).get(ep1) as { series_id: number }
		).series_id;
		expect(row(seriesId)).toMatchObject({ in_library: 0 });
		expect(row(seriesId).browsed_at).not.toBeNull();
		// The same series the second time, and the other episode in it.
		const ep2 = await downloads.openFromSource(id, '/e/2');
		expect(
			(db.prepare(`SELECT series_id FROM entries WHERE id = ?`).get(ep2) as { series_id: number })
				.series_id
		).toBe(seriesId);
		expect((db.prepare(`SELECT COUNT(*) AS n FROM series`).get() as { n: number }).n).toBe(1);
		expect(downloads.previewIdOf(`aniyomi:${ANIME}:/anime/wataridori`)).toBe(id);
		// Asked by id it's found: the player runs on it.
		expect(seriesPage(seriesId, false)?.entries.map((e) => e.id)).toContain(ep1);
	});

	it('is on no shelf, in no count and no search, and not IN LIBRARY at its source', () => {
		for (const reveal of [false, true]) {
			expect(lib.listSeries({ reveal }).map((c) => c.id)).not.toContain(seriesId);
			expect(lib.countListed({ reveal })).toBe(0);
			expect(lib.listSeries({ reveal, shelf: 'k:anime' })).toEqual([]);
			expect(lib.listShelves({ reveal, withNew: false }).find((s) => s.key === 'k:anime')).toBe(
				undefined
			);
			expect(lib.search('Wataridori', reveal).titles).toEqual([]);
		}
		expect(sources.seriesForKey(`aniyomi:${ANIME}:/anime/wataridori`)).toBeNull();
		expect(sources.libraryIndex(true).byKey.has(`aniyomi:${ANIME}:/anime/wataridori`)).toBe(false);
	});

	it('downloads nothing and follows nothing until it is added', async () => {
		expect(await downloads.enqueue(seriesId, [ep1])).toEqual({ queued: 0, missing: 1 });
		expect((db.prepare(`SELECT COUNT(*) AS n FROM download_queue`).get() as { n: number }).n).toBe(
			0
		);
		await expect(downloads.setFollowed(seriesId, true)).rejects.toThrow(/in the library/);
	});

	it('is in HISTORY, said NOT IN LIBRARY', () => {
		recordReading({ seriesId, entryId: ep1, kind: 'open', page: 0 });
		recordReading({ seriesId, entryId: ep1, kind: 'page', page: 250, lengthS: 1440 });
		const [day] = historyDays(false).rows;
		expect(day).toMatchObject({ seriesId, inLibrary: false });
		expect(historyMeta(day)).toMatch(/^ANIME · NOT IN LIBRARY · /);
	});

	it('becomes the library’s series on ADD, the same one, its place kept', async () => {
		expect(await downloads.addToLibrary(id)).toBe(seriesId);
		expect(row(seriesId)).toEqual({ in_library: 1, browsed_at: null });
		expect(
			(
				db.prepare(`SELECT last_position FROM entries WHERE id = ?`).get(ep1) as {
					last_position: number;
				}
			).last_position
		).toBe(250);
		expect(lib.listSeries({ reveal: false, shelf: 'k:anime' }).map((c) => c.id)).toEqual([
			seriesId
		]);
		expect(sources.seriesForKey(`aniyomi:${ANIME}:/anime/wataridori`)?.id).toBe(seriesId);
		expect(historyDays(false).rows[0].inLibrary).toBe(true);
		// Opening it from its source again plays the library's series, never a second record.
		expect(await downloads.openFromSource(id, '/e/1')).toBe(ep1);
		expect(row(seriesId).in_library).toBe(1);
	});
});
