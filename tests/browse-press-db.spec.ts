import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 't';
// ADD fetches the new series' cover: never into the library's own covers folder.
const covers = mkdtempSync(join(tmpdir(), 'tsundoku-press-covers-'));
process.env.COVER_DIR = covers;

const { getDb } = await import('$lib/server/db');
const { ensureRoot } = await import('$lib/server/import/write');
const { sourceMangaId } = await import('$lib/server/engine/backend');
const { setSourceFlag } = await import('$lib/server/engine/source-flags');
const { browseSource } = await import('$lib/server/engine/browse');
const { createCollection } = await import('$lib/server/library');
const { isAdding } = await import('$lib/server/engine/adding');
const press = await import('$lib/server/browse-press');

/**
 * A SELECT press, the server's half (doc/BROWSE.md, "The press"),
 * on an in-memory library through the real writers and a fake engine: one
 * series added and queued as a preview's ADD AND DOWNLOAD would, a stale tick
 * skipped, a series being added skipped, failures in a word, ADDED HIDDEN for
 * many, and UNDO and the shelves for the whole press.
 */

const OPEN = '7001';
const SHUT = '7002';
const ADDS_HIDDEN = '7003';
let server: Server;
/** How long each details call takes: long enough for a second press of the same series to arrive first. */
let detailsMs = 0;

beforeAll(async () => {
	server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			if (req.url?.startsWith('/image/'))
				return res.writeHead(200, { 'content-type': 'image/jpeg' }).end(Buffer.from([0xff, 0xd8]));
			const b = JSON.parse(raw || '{}') as { method: string; mangaData?: { url: string } };
			const json = (status: number, v: unknown) =>
				res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			const url = b.mangaData?.url ?? '';
			if (b.method === 'getDetailsManga') {
				if (url.includes('refuse')) return json(500, { error: 'Forbidden', code: 403 });
				if (url.includes('vanished')) return json(500, { error: 'Not found', code: 404 });
				if (url.includes('broken')) return json(500, { error: 'NullPointerException' });
				return setTimeout(
					() => json(200, { url, title: `Title of ${url}`, author: 'A', status: 1 }),
					detailsMs
				);
			}
			if (b.method === 'getChapterList')
				return json(
					200,
					Array.from({ length: 12 }, (_, i) => ({
						url: `${url}/c${i + 1}`,
						name: `Chapter ${i + 1}`,
						scanlator: null,
						chapter_number: i + 1
					}))
				);
			json(404, { error: 'unknown', code: 404 });
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
ensureRoot(db, 'Mihon', '/nowhere/Mihon', false);
for (const [id, name] of [
	[OPEN, 'Open Press'],
	[SHUT, 'Shut Press'],
	[ADDS_HIDDEN, 'Hidden Press']
]) {
	db.prepare(
		`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
		VALUES (?, ?, 'manga', 1, '1', '1.6', ?, 0, 0)`
	).run(`e.${id}`, name, id.padEnd(64, '0'));
	db.prepare(
		`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://x.example')`
	).run(id, `e.${id}`, name);
}

const result = (source: string, url: string) => sourceMangaId(source, url);
const seriesOf = (source: string, url: string) =>
	db
		.prepare(`SELECT id, hidden, in_library AS inLibrary FROM series WHERE origin_key = ?`)
		.get(`mihon:${source}:${url}`) as { id: number; hidden: number; inLibrary: number } | undefined;
const queuedOf = (seriesId: number) =>
	(
		db.prepare(`SELECT COUNT(*) AS n FROM download_queue WHERE series_id = ?`).get(seriesId) as {
			n: number;
		}
	).n;

describe('one series of a press', () => {
	it('adds and queues FIRST 10 as ADD AND DOWNLOAD does, then reads as in the library', async () => {
		const id = result(OPEN, '/m/first');
		const a = await press.pressOne(id, 'first', false);
		expect(a).toMatchObject({ status: 'added', hidden: false, sourceHidden: false, queued: 10 });
		const s = seriesOf(OPEN, '/m/first')!;
		expect(a.status === 'added' && a.seriesId).toBe(s.id);
		expect(s).toMatchObject({ hidden: 0, inLibrary: 1 });
		expect(queuedOf(s.id)).toBe(10);
		// Ticked in another tab too: by its press it is in the library.
		expect(await press.pressOne(id, 'first', false)).toEqual({
			status: 'skipped',
			reason: 'in-library'
		});
	});

	it('queues every chapter for ALL, and nothing for ADD TO LIBRARY', async () => {
		const all = await press.pressOne(result(OPEN, '/m/all'), 'all', false);
		expect(all).toMatchObject({ status: 'added', queued: 12 });
		const none = await press.pressOne(result(OPEN, '/m/none'), 'none', false);
		expect(none).toMatchObject({ status: 'added', queued: null });
		expect(queuedOf(seriesOf(OPEN, '/m/none')!.id)).toBe(0);
	});

	it('skips a series being added by another request, and adds it once', async () => {
		detailsMs = 150;
		try {
			const id = result(OPEN, '/m/twice');
			const first = press.pressOne(id, 'none', false);
			await new Promise((r) => setTimeout(r, 30));
			expect(isAdding(id)).toBe(true);
			expect(await press.pressOne(id, 'none', false)).toEqual({
				status: 'skipped',
				reason: 'adding'
			});
			expect(await first).toMatchObject({ status: 'added' });
			expect(isAdding(id)).toBe(false);
		} finally {
			detailsMs = 0;
		}
	});

	it('says why a series was not added, in a word', async () => {
		expect(await press.pressOne(result(OPEN, '/m/refuse'), 'first', false)).toEqual({
			status: 'failed',
			reason: 'refused'
		});
		db.prepare(`INSERT INTO tombstones (key, title, deleted_at) VALUES (?, 'x', 1)`).run(
			`mihon:${OPEN}:/m/buried`
		);
		expect(await press.pressOne(result(OPEN, '/m/buried'), 'none', false)).toEqual({
			status: 'failed',
			reason: 'deleted'
		});
		expect(await press.pressOne(result(OPEN, '/m/vanished'), 'none', false)).toEqual({
			status: 'failed',
			reason: 'gone'
		});
		expect(await press.pressOne(result(OPEN, '/m/broken'), 'none', false)).toEqual({
			status: 'failed',
			reason: 'failed'
		});
		expect(await press.pressOne('not-a-result', 'none', false)).toEqual({
			status: 'failed',
			reason: 'gone'
		});
	});

	it('adds nothing from a hidden source outside reveal, and does inside it', async () => {
		setSourceFlag(SHUT, 'hidden', true);
		expect(await press.pressOne(result(SHUT, '/m/s'), 'none', false)).toEqual({
			status: 'failed',
			reason: 'gone'
		});
		expect(seriesOf(SHUT, '/m/s')).toBeUndefined();
		expect(await press.pressOne(result(SHUT, '/m/s'), 'none', true)).toMatchObject({
			status: 'added'
		});
	});

	it('ADDED HIDDEN: each arrives hidden, is queued, and the press goes on once the source is mostly hidden', async () => {
		setSourceFlag(ADDS_HIDDEN, 'addedHidden', true);
		const a = await press.pressOne(result(ADDS_HIDDEN, '/m/h1'), 'first', false);
		expect(a).toMatchObject({ status: 'added', hidden: true, queued: 10 });
		// Its only series is hidden: the source is not found outside reveal now.
		expect(a.status === 'added' && a.sourceHidden).toBe(true);
		expect(browseSource(ADDS_HIDDEN, false)).toBeNull();
		const b = await press.pressOne(result(ADDS_HIDDEN, '/m/h2'), 'first', false);
		expect(b).toMatchObject({ status: 'added', hidden: true, sourceHidden: true, queued: 10 });
		expect(seriesOf(ADDS_HIDDEN, '/m/h2')).toMatchObject({ hidden: 1, inLibrary: 1 });
	});
});

describe('the press as a whole', () => {
	const added: { series: number; preview: string }[] = [];
	beforeAll(async () => {
		for (const url of ['/w/1', '/w/2', '/w/3']) {
			const preview = result(OPEN, url);
			const a = await press.pressOne(preview, 'first', false);
			if (a.status === 'added') added.push({ series: a.seriesId, preview });
		}
	});

	it('puts every series of the press on a shelf, and takes them off', async () => {
		const later = createCollection('Later');
		expect(await press.shelvePress(added, later, true)).toEqual({ shelved: 3 });
		const on = () =>
			(
				db
					.prepare(`SELECT COUNT(*) AS n FROM collection_series WHERE collection_id = ?`)
					.get(later) as {
					n: number;
				}
			).n;
		expect(on()).toBe(3);
		await press.shelvePress(added.slice(0, 1), later, false);
		expect(on()).toBe(2);
		expect(await press.shelvePress(added, 99999, true)).toEqual({
			status: 400,
			message: 'no such shelf'
		});
	});

	it('says what UNDO leaves, then takes out the rest with their queued chapters', async () => {
		const [one] = added;
		db.prepare(
			`UPDATE entries SET available = 1 WHERE id = (SELECT MIN(id) FROM entries WHERE series_id = ?)`
		).run(one.series);
		expect(await press.touchedOf(added)).toEqual([one.series]);
		expect(await press.undoPress(added)).toEqual({ out: 2, stayed: 1, gone: 0, queuedOut: 20 });
		expect(db.prepare(`SELECT 1 FROM series WHERE id = ?`).get(added[1].series)).toBeUndefined();
		expect(queuedOf(added[1].series)).toBe(0);
		expect(db.prepare(`SELECT 1 FROM series WHERE id = ?`).get(one.series)).toBeDefined();
		// Twice: what went is gone, and nothing more is taken out.
		expect(await press.undoPress(added)).toEqual({ out: 0, stayed: 1, gone: 2, queuedOut: 0 });
		// A shelf after UNDO reaches only what is still the press's.
		expect(await press.shelvePress(added, createCollection('Tonight'), true)).toEqual({
			shelved: 1
		});
	});

	it('never trusts an id alone: a series the press did not add is not undone', async () => {
		const other = await press.pressOne(result(OPEN, '/w/other'), 'none', false);
		const id = other.status === 'added' ? other.seriesId : 0;
		expect(await press.undoPress([{ series: id, preview: result(OPEN, '/w/1') }])).toEqual({
			out: 0,
			stayed: 0,
			gone: 1,
			queuedOut: 0
		});
		expect(db.prepare(`SELECT 1 FROM series WHERE id = ?`).get(id)).toBeDefined();
	});

	it('reads a body, junk dropped and capped', () => {
		const p = result(OPEN, '/w/1');
		expect(
			press.readPressSeries({
				items: [
					{ series: 3, preview: p },
					{ series: 'x', preview: p },
					{ series: 4, preview: 'nope' },
					null
				]
			})
		).toEqual([{ series: 3, preview: p }]);
		expect(press.readPressSeries(null)).toEqual([]);
		expect(
			press.readPressSeries({
				items: Array.from({ length: 900 }, () => ({ series: 1, preview: p }))
			})
		).toHaveLength(press.PRESS_MAX);
	});
});
