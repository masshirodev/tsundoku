import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PlannedEntry, PlannedSeries } from '$lib/import/plan';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
const library = mkdtempSync(join(tmpdir(), 'tsundoku-worker-lib-'));
const store = mkdtempSync(join(tmpdir(), 'tsundoku-worker-store-'));
process.env.ENGINE_STORE = store;
process.env.ENGINE_TOKEN = 't';

const { getDb } = await import('$lib/server/db');
const { ensureRoot, writeSeries } = await import('$lib/server/import/write');
const { attachWritten, runImport } = await import('$lib/server/import/index');
const { enqueue, queueRows, MAX_TRIES } = await import('$lib/server/engine/queue');
const { runOnce, deviceBackup } = await import('$lib/server/engine/worker');
const { decodeBackup } = await import('$lib/import/mihon-backup');
const { listZip, readMember } = await import('$lib/server/zip');
const { parseComicInfo } = await import('$lib/import/comicinfo');

// A Toonily-shaped source (doc/DOWNLOADER.md, "Keys"): the library keys the
// series and its chapters by the old URLs, the extension answers with new ones.
const SOURCE = '5190569675461947007';
const OLD_SERIES = '/webtoon/a-series/';
const OLD_CH = (n: number) => `https://toonily.com/serie/a-series/chapter-${n}/?style=list`;
const NEW_SERIES = '5871|mangayomi-memo|eyJwYXRoIjoiL3NlcmllL2Etc2VyaWVzLyJ9';
const NEW_CH = (n: number) => `chapter-${n}|mangayomi-memo|eyJjaCI6${n}fQ`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

let server: Server;
let pageReply: (path: string) => { type: string; body: Buffer } = () => ({
	type: 'image/png',
	body: JPEG
});
const asked: Record<string, unknown>[] = [];

beforeAll(async () => {
	server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			if (req.url?.startsWith('/image/')) {
				const r = pageReply(req.url);
				res.writeHead(200, { 'content-type': r.type }).end(r.body);
				return;
			}
			const b = JSON.parse(raw) as Record<string, unknown>;
			asked.push(b);
			const json = (v: unknown) =>
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			const manga = b.mangaData as { url: string } | undefined;
			if (b.method === 'getDetailsManga') return json({ url: NEW_SERIES, title: 'A Series' });
			if (b.method === 'getChapterList') {
				// Only the new URL works: the stuck guard the spike found on legacy ones.
				if (manga?.url !== NEW_SERIES)
					return res.writeHead(500).end('{"error":"concurrent","code":500}');
				return json(
					[3, 2, 1].map((n) => ({
						url: NEW_CH(n),
						name: `Chapter ${n}`,
						scanlator: null,
						chapter_number: -1
					}))
				);
			}
			if (b.method === 'getPageList')
				return json(
					[1, 2, 3].map((i) => ({
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
	await new Promise((ok) => server.close(ok));
	rmSync(library, { recursive: true, force: true });
	rmSync(store, { recursive: true, force: true });
});

const db = getDb();
const d = { db, library, now: () => 1_800_000_000_000 };

// The library as the tablet left it: chapter 1 downloaded there, 2 and 3 not.
const tablet = join(library, 'devices', 'tablet', 'Mihon', 'downloads', 'Toonily (EN)', 'A Series');
mkdirSync(tablet, { recursive: true });
writeFileSync(join(tablet, 'c1.cbz'), Buffer.from('not read in this spec'));
const root = ensureRoot(db, 'Mihon', join(library, 'Mihon'), false);
const entry = (n: number, o: Partial<PlannedEntry> = {}): PlannedEntry => ({
	position: n,
	label: `Ch. ${n}`,
	title: '',
	sourceUrl: OLD_CH(n),
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
	originKey: `mihon:${SOURCE}:${OLD_SERIES}`,
	source: 'mihon',
	title: 'A Series',
	kind: 'manhwa',
	rating: 0,
	favourite: false,
	hidden: false,
	shelves: [],
	tags: [{ namespace: 'source', value: 'Toonily' }],
	description: '',
	status: '',
	direction: null,
	addedAt: 1_700_000_000_000,
	sourceUrl: OLD_SERIES,
	path: tablet,
	entries: [
		entry(1, {
			available: true,
			file: 'c1.cbz',
			bytes: 21,
			pageCount: 0,
			readAt: 1_750_000_000_000
		}),
		entry(2),
		entry(3)
	]
};
writeSeries(planned, { rootId: root, jobId: null, now: 1_700_000_000_000, markMissing: false }, db);
const seriesId = (
	db.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(planned.originKey) as { id: number }
).id;
const entryId = (n: number) =>
	(
		db.prepare(`SELECT id FROM entries WHERE series_id = ? AND position = ?`).get(seriesId, n) as {
			id: number;
		}
	).id;

// Toonily, installed: its extension and source, an APK the fake engine never checks.
writeFileSync(join(store, `${'a'.repeat(64)}.apk`), Buffer.from('apk'));
db.prepare(
	`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
	VALUES ('eu.kanade.tachiyomi.extension.en.toonily', 'Toonily', 'manga', 1, '1.6.72', '1.6', ?, 0, 0)`
).run('a'.repeat(64));
db.prepare(
	`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, 'eu.kanade.tachiyomi.extension.en.toonily', 'Toonily', 'en', 'https://toonily.com')`
).run(SOURCE);

describe('downloading a chapter', () => {
	it('queues only what has no file', () => {
		expect(enqueue([entryId(1), entryId(2)], 1000)).toBe(1);
		expect(enqueue([entryId(2)], 1000)).toBe(0);
		expect(queueRows().map((r) => r.entryId)).toEqual([entryId(2)]);
	});

	it('writes it as Mihon would into devices/tsundoku, under the library’s own URLs', async () => {
		expect(await runOnce(d)).toBe(1);
		expect(queueRows()).toEqual([]);

		// Called with the new URLs, found from the details call.
		expect(asked.find((a) => a.method === 'getChapterList')!.mangaData).toMatchObject({
			url: NEW_SERIES
		});
		expect(asked.find((a) => a.method === 'getPageList')!.chapterData).toMatchObject({
			url: NEW_CH(2)
		});

		const dir = join(
			library,
			'devices',
			'tsundoku',
			'Mihon',
			'downloads',
			'Toonily (EN)',
			'A Series'
		);
		expect(readdirSync(dir)).toEqual(['Ch. 2.cbz']);
		const fh = await open(join(dir, 'Ch. 2.cbz'));
		try {
			const members = await listZip(fh, (await fh.stat()).size);
			// Labelled PNG by the site, JPEG by its bytes.
			expect(members.map((m) => m.name)).toEqual([
				'001.jpg',
				'002.jpg',
				'003.jpg',
				'ComicInfo.xml'
			]);
			const info = parseComicInfo((await readMember(fh, members[3])).toString('utf8'));
			// Web is the library's chapter URL, which is what the importer matches by.
			expect(info).toMatchObject({
				title: 'Ch. 2',
				series: 'A Series',
				number: 2,
				web: [OLD_CH(2)],
				source: 'Toonily'
			});
		} finally {
			await fh.close();
		}

		// The backup names the series and chapters by the library's keys, never the source's new ones.
		const [m] = deviceBackup(db).manga;
		expect(m).toMatchObject({ source: SOURCE, url: OLD_SERIES, title: 'A Series' });
		expect(m.chapters.map((c) => c.url)).toEqual([OLD_CH(3), OLD_CH(2), OLD_CH(1)]);
		const folder = join(library, 'devices', 'tsundoku', 'Mihon', 'autobackup');
		const backups = readdirSync(folder);
		expect(backups).toHaveLength(1);
		expect(backups[0]).toMatch(/^tsundoku_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.tachibk$/);
		const written = decodeBackup(
			new Uint8Array(gunzipSync(readFileSync(join(folder, backups[0]))))
		);
		expect(written.manga[0].url).toBe(OLD_SERIES);
		expect(written.sources.get(SOURCE)).toBe('Toonily');
	});

	// The whole point: the file lands on the entry it is, in the series it is,
	// attached as it's written (c170). No twin, and no IMPORTING between.
	it('attaches onto its own entry, in its own series, the moment it is written', async () => {
		const before = (db.prepare(`SELECT COUNT(*) AS n FROM series`).get() as { n: number }).n;
		const file = join(
			library,
			'devices',
			'tsundoku',
			'Mihon',
			'downloads',
			'Toonily (EN)',
			'A Series',
			'Ch. 2.cbz'
		);
		expect(await attachWritten(library, [file], 1_800_000_100_000)).toEqual([]);
		const after = (db.prepare(`SELECT COUNT(*) AS n FROM series`).get() as { n: number }).n;
		expect(after).toBe(before);
		const rows = db
			.prepare(
				`SELECT position, available, file, read_at FROM entries WHERE series_id = ? ORDER BY position`
			)
			.all(seriesId) as {
			position: number;
			available: number;
			file: string;
			read_at: number | null;
		}[];
		expect(rows.map((r) => [r.position, r.available])).toEqual([
			[1, 1],
			[2, 1],
			[3, 0]
		]);
		// A file is relative to the series' path, which the writer widened to hold both devices.
		const { path } = db.prepare(`SELECT path FROM series WHERE id = ?`).get(seriesId) as {
			path: string;
		};
		expect(join(path, rows[1].file)).toBe(
			join(
				library,
				'devices',
				'tsundoku',
				'Mihon',
				'downloads',
				'Toonily (EN)',
				'A Series',
				'Ch. 2.cbz'
			)
		);
		// The tablet's chapter and its read state are as they were.
		expect(join(path, rows[0].file)).toBe(join(tablet, 'c1.cbz'));
		expect(rows[0].read_at).toBe(1_750_000_000_000);
	});

	// The scan stays the cross-check: it reads the same files and agrees.
	it('is left exactly as it was by the scan that follows', async () => {
		const before = snapshot(db, seriesId);
		await runImport(library, { now: 1_800_000_200_000 });
		expect(snapshot(db, seriesId)).toEqual(before);
	});

	it('gives back a file no source holds, for a scan to find', async () => {
		const stray = join(library, 'elsewhere', 'Ch. 9.cbz');
		expect(await attachWritten(library, [stray])).toEqual([stray]);
	});
});

describe('a chapter that fails', () => {
	it('counts its tries with a backoff, then waits for RETRY', async () => {
		// A site's error page passed off as an image.
		pageReply = () => ({
			type: 'image/jpeg',
			body: Buffer.from('<!DOCTYPE html><title>Just a moment...</title>')
		});
		enqueue([entryId(3)], 1000);
		let now = 1_800_000_000_000;
		const failing = { ...d, now: () => now };
		for (let i = 1; i <= MAX_TRIES; i++) {
			expect(await runOnce(failing)).toBe(0);
			const [r] = queueRows();
			expect(r.tries).toBe(i);
			if (i < MAX_TRIES) {
				expect(r.state).toBe('queued');
				expect(r.nextAt).toBeGreaterThan(now);
				// Not before its backoff.
				expect(await runOnce(failing)).toBe(0);
				expect(queueRows()[0].tries).toBe(i);
				now = r.nextAt;
			} else {
				expect(r).toMatchObject({
					state: 'failed',
					error: expect.stringMatching(/other than an image/)
				});
			}
		}
		const files = readdirSync(
			join(library, 'devices', 'tsundoku', 'Mihon', 'downloads', 'Toonily (EN)', 'A Series')
		);
		expect(files).toEqual(['Ch. 2.cbz']);
		expect(
			existsSync(
				join(
					library,
					'devices',
					'tsundoku',
					'Mihon',
					'downloads',
					'Toonily (EN)',
					'A Series',
					'Ch. 3.cbz.partial'
				)
			)
		).toBe(false);
	});
});

describe('a chapter read online (c166)', () => {
	// Whichever chapter the tests above left without a file.
	const missing = () =>
		(
			db
				.prepare(`SELECT id FROM entries WHERE series_id = ? AND available = 0 ORDER BY position`)
				.get(seriesId) as { id: number }
		).id;

	it('is its pages at the source, sizes unknown, a version that is never kept', async () => {
		const { manifest } = await import('$lib/server/pages');
		const { readsOnline, isOnlineVersion } = await import('$lib/server/pages/online');
		expect(readsOnline(entryId(1))).toBe(false);
		expect(readsOnline(missing())).toBe(true);
		const m = (await manifest(missing(), true))!;
		expect(m.online).toBe(true);
		expect(m.pages).toEqual([
			{ w: 0, h: 0 },
			{ w: 0, h: 0 },
			{ w: 0, h: 0 }
		]);
		expect(isOnlineVersion(m.version)).toBe(true);
		expect(isOnlineVersion('1700000000-123')).toBe(false);
	});

	it('serves each page through the engine and writes nothing', async () => {
		const { readPage } = await import('$lib/server/pages');
		const seen: string[] = [];
		const before = pageReply;
		pageReply = (path) => (seen.push(path), { type: 'image/png', body: JPEG });
		try {
			const page = (await readPage(missing(), 1, true))!;
			expect(Buffer.isBuffer(page.body) && page.body.equals(JPEG)).toBe(true);
			// Sniffed, not the content type the site claims.
			expect(page.type).toBe('image/jpeg');
			expect(seen).toEqual(['/image/p2']);
			expect(await readPage(missing(), 9, true)).toBeNull();
		} finally {
			pageReply = before;
		}
		expect(db.prepare(`SELECT available, file FROM entries WHERE id = ?`).get(missing())).toEqual({
			available: 0,
			file: ''
		});
		expect(readdirSync(tablet)).toEqual(['c1.cbz']);
	});
});

/** A series and its entries as rows, for a scan to leave alone. */
function snapshot(db: ReturnType<typeof getDb>, id: number) {
	return {
		series: db.prepare(`SELECT * FROM series WHERE id = ?`).get(id),
		entries: db.prepare(`SELECT * FROM entries WHERE series_id = ? ORDER BY id`).all(id)
	};
}
