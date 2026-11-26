import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { countCommits } from './helpers/commits';

// How many SQLite commits the paths a reader walks make (c1148). In the web
// edition each commit is a write to the tab's storage, about 30 ms: READ on a
// 1,199-chapter series took 3.5 minutes while it committed per chapter
// (doc/WEB-EDITION.md, "Measuring"). The rule held here: a path's commits do
// not grow with the number of rows it writes.

process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 't';
const covers = mkdtempSync(join(tmpdir(), 'tsundoku-commits-covers-'));
process.env.COVER_DIR = covers;

const { getDb } = await import('$lib/server/db');
const downloads = await import('$lib/server/downloads');
const { sourceMangaId } = await import('$lib/server/engine/backend');
const { syncDevice } = await import('$lib/server/devices');

const SOURCE = '2131019126180322627';
let server: Server;

/** `/series/n<count>` has that many chapters. */
const countOf = (url: string) => Number(/\/series\/n(\d+)/.exec(url)?.[1] ?? 0);

beforeAll(async () => {
	server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const json = (v: unknown) =>
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
			if (req.url?.startsWith('/image/')) return res.writeHead(404).end();
			const b = JSON.parse(raw) as { method: string; mangaData?: { url: string } };
			const url = b.mangaData?.url ?? '';
			if (b.method === 'getDetailsManga')
				return json({ url, title: `Fake Series ${countOf(url)}`, status: 1, thumbnail_url: null });
			if (b.method === 'getChapterList')
				return json(
					Array.from({ length: countOf(url) }, (_, i) => ({
						url: `${url}/c${i + 1}`,
						name: `Chapter ${i + 1}`,
						scanlator: null,
						chapter_number: i + 1
					})).reverse()
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
db.prepare(
	`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
	VALUES ('eu.kanade.tachiyomi.extension.en.fake', 'Fake Source', 'manga', 1, '1.6.1', '1.6', ?, 0, 0)`
).run('c'.repeat(64));
db.prepare(
	`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, 'eu.kanade.tachiyomi.extension.en.fake', 'Fake Source', 'en', 'https://example.org')`
).run(SOURCE);

describe('opening a series from a source (READ without ADD)', () => {
	it('commits as often for 400 chapters as for 10', async () => {
		// The first one also makes the library's Mihon folder: not what is counted.
		await downloads.openFromSource(sourceMangaId(SOURCE, '/series/n5'), '/series/n5/c1');
		const few = await countCommits(() =>
			downloads.openFromSource(sourceMangaId(SOURCE, '/series/n10'), '/series/n10/c1')
		);
		const many = await countCommits(() =>
			downloads.openFromSource(sourceMangaId(SOURCE, '/series/n400'), '/series/n400/c1')
		);
		expect(db.prepare(`SELECT COUNT(*) AS n FROM engine_chapters`).get() as { n: number }).toEqual({
			n: 415
		});
		expect(many).toBe(few);
		expect(few).toBeLessThanOrEqual(3);
	});

	it('and ADD after it, the same', async () => {
		const few = await countCommits(() =>
			downloads.addToLibrary(sourceMangaId(SOURCE, '/series/n12'))
		);
		const many = await countCommits(() =>
			downloads.addToLibrary(sourceMangaId(SOURCE, '/series/n300'))
		);
		expect(many).toBe(few);
	});
});

describe('a browser checking in', () => {
	// On every page a browser opens: one commit, not one per statement.
	it('is one commit', async () => {
		const id = 'd'.repeat(32);
		const commits = await countCommits(() =>
			syncDevice({ id, kind: 'desktop', label: 'A browser', settings: {}, register: true })
		);
		expect(commits).toBe(1);
	});
});
