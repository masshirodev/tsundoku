import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
const work = mkdtempSync(join(tmpdir(), 'tsundoku-novel-download-'));
const library = join(work, 'library');
process.env.NOVEL_STORE = join(work, 'store');
process.env.LIBRARY_ROOT = library;
process.env.COVER_DIR = join(work, 'covers');
afterAll(() => rmSync(work, { recursive: true, force: true }));

// The novel downloader (doc/NOVELS.md, "Downloading"; card c150), on a fake
// host whose answers are LNReader's shapes: chapters off the shared queue,
// into the novel's EPUB in tsundoku's device folder, which the scan imports
// onto the series ADD made.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let chapterCalls: string[] = [];
/** What the source lists past the five ADD saw: FOLLOW's tests add to it. */
let extra: { name: string; path: string }[] = [];
let novelFails = false;
const fakeHost = {
	info: async () => ({ id: 'good', name: 'Good Novels', site: 'https://good.example/' }),
	call: async (_file: string, method: string, args: unknown[]) => {
		if (method === 'parseNovel') {
			if (novelFails) throw new Error('www.good.example answered 503');
			return {
				name: 'The Long One',
				path: args[0],
				author: 'Guiltythree',
				genres: 'Fantasy',
				status: 'Ongoing',
				summary: 'A long one.',
				chapters: [
					{ name: 'Chapter 1 - Start', path: '/c/1' },
					{ name: 'Chapter 2', path: '/c/2' },
					{ name: 'Chapter 3', path: '/c/3' },
					{ name: 'Chapter 4', path: '/c/broken' },
					{ name: 'Chapter 5', path: '/c/empty' },
					...extra
				]
			};
		}
		if (method === 'parseChapter') {
			const path = args[0] as string;
			chapterCalls.push(path);
			if (path === '/c/broken') throw new Error('www.good.example answered 503');
			if (path === '/c/empty') return '<div><script>shell()</script></div>';
			return `<p>Text of ${path}.</p>${path === '/c/1' ? '<img src="/i/plate.png"><script>x()</script>' : ''}`;
		}
		if (method === 'resolveUrl') return null;
		throw new Error(`no ${method}`);
	}
};
vi.mock('$lib/server/novels/plugins', async (original) => ({
	...(await original<typeof import('$lib/server/novels/plugins')>()),
	novelHost: () => fakeHost
}));
vi.mock('node:dns/promises', () => ({
	lookup: async () => [{ address: '93.184.215.14', family: 4 }]
}));
vi.stubGlobal(
	'fetch',
	vi.fn(async () => new Response('no', { status: 404 }))
);

const { getDb } = await import('$lib/server/db');
const { attachWritten, runImport } = await import('$lib/server/import/index');
const { readEpub } = await import('$lib/server/import/epub');
const { entryDocs, planEntries } = await import('$lib/epub/epub');
const queue = await import('$lib/server/engine/queue');
const source = await import('$lib/server/novels/source');
const downloads = await import('$lib/server/downloads');
const { runNovelOnce } = await import('$lib/server/novels/downloader');
const { checkNovel, followNovels } = await import('$lib/server/novels/follow');

const db = getDb();
let now = 1_000_000;
const imagesAsked: string[] = [];
const deps = () => ({
	db,
	library,
	now: () => now,
	fetchImage: async (url: string) => {
		imagesAsked.push(url);
		return url.endsWith('/i/plate.png') ? PNG : null;
	},
	pause: async () => {}
});
const BOOK = join(library, 'devices/tsundoku/Library/Novels/Good Novels/The Long One.epub');

let seriesId = 0;
const entry = (path: string) =>
	db
		.prepare(
			`SELECT id, available, file, locator, position, label FROM entries WHERE series_id = ? AND source_url = ?`
		)
		.get(seriesId, path) as {
		id: number;
		available: number;
		file: string;
		locator: string;
		position: number;
		label: string;
	};
const states = async () => {
	const s = db.prepare(`SELECT id, available FROM entries WHERE series_id = ?`).all(seriesId) as {
		id: number;
		available: number;
	}[];
	const d = await downloads.seriesDownloads(
		seriesId,
		s.map((e) => ({ id: e.id, available: e.available === 1 }))
	);
	if (d.kind !== 'ok') throw new Error(d.kind);
	return d;
};

beforeAll(async () => {
	db.prepare(
		`INSERT INTO novel_plugins (id, name, site, lang, version, hash, installed_at, updated_at, failed)
		VALUES ('good', 'Good Novels', 'https://good.example/', 'en', '1.0.0', 'h1', 0, 0, '')`
	).run();
	seriesId = await source.addNovel(
		`ln:good~${Buffer.from('/novel/long').toString('base64url')}`,
		now
	);
});

describe('a chapter read online (c167)', () => {
	it('is a book of one chapter from its plugin, where a download would put it, and nothing is written', async () => {
		const online = await import('$lib/server/novels/online');
		const { readEpubFile, epubMember } = await import('$lib/server/epub');
		const { chapterHref } = await import('$lib/server/novels/downloader');
		const { Zip } = await import('$lib/epub/unzip');
		expect(online.novelReadsOnline(seriesId)).toBe(true);
		const two = entry('/c/2');
		expect(online.onlineChapters(seriesId).get(two.id)).toEqual({
			file: `online:${two.id}`,
			locator: chapterHref('/c/2')
		});
		const book = (await readEpubFile(seriesId, true, `online:${two.id}`))!;
		expect(book.version).toBe('online');
		const z = new Zip(new Uint8Array(book.body as Buffer));
		const doc = new TextDecoder().decode(await z.bytesOf(chapterHref('/c/2')));
		expect(doc).toContain('Text of /c/2.');
		// Member by member, as the reader asks.
		const m = (await epubMember(seriesId, true, chapterHref('/c/2'), `online:${two.id}`))!;
		expect(m.body.toString()).toContain('Text of /c/2.');
		expect(entry('/c/2')).toMatchObject({ available: 0, file: '' });
		expect(existsSync(library)).toBe(false);
		// Another series' entry, or a source that fails, opens nothing.
		expect(await readEpubFile(seriesId + 99, true, `online:${two.id}`)).toBeNull();
		online.forgetOnlineBooks();
		await expect(readEpubFile(seriesId, true, `online:${entry('/c/broken').id}`)).rejects.toThrow();
		chapterCalls = [];
	});
});

describe('downloading a novel', () => {
	it('queues its chapters in the one queue, which the engine’s worker leaves alone', async () => {
		const d = await states();
		expect(d.follow).toEqual({ on: false, checked: null });
		expect(d.states[entry('/c/1').id]).toEqual({ kind: 'none', chapterId: entry('/c/1').id });
		const r = await downloads.enqueue(seriesId, [entry('/c/1').id, entry('/c/2').id]);
		expect(r).toEqual({ queued: 2, missing: 0 });
		expect(queue.queueRows(db).map((q) => q.sourceId)).toEqual(['ln:good', 'ln:good']);
		expect(queue.nextUp(3, now, db, 'manga')).toEqual([]);
		expect(queue.nextUp(3, now, db, 'novel').map((q) => q.entryId)).toEqual([entry('/c/1').id]);
		expect((await states()).states[entry('/c/2').id].kind).toBe('queued');
	});

	it('writes them into the novel’s EPUB, a batch at once, IMPORTING until the scan', async () => {
		chapterCalls = [];
		expect(await runNovelOnce(deps())).toBe(2);
		expect(chapterCalls).toEqual(['/c/1', '/c/2']);
		expect(queue.queueRows(db)).toEqual([]);
		expect(existsSync(BOOK)).toBe(true);
		expect(existsSync(`${BOOK}.partial`)).toBe(false);
		expect((await states()).states[entry('/c/1').id]).toEqual({ kind: 'importing' });

		const book = await readEpub(BOOK);
		expect(book.novel?.plugin).toBe('good');
		expect(book.novel?.chapters.map((c) => [c.path, c.href !== null])).toEqual([
			['/c/1', true],
			['/c/2', true],
			['/c/3', false],
			['/c/broken', false],
			['/c/empty', false]
		]);
		expect(book.toc.map((t) => t.label)).toEqual(['Ch. 1: Start', 'Ch. 2']);
		// The chapter's picture is in the book, fetched by the server; the page's script isn't.
		expect(imagesAsked).toEqual(['https://good.example/i/plate.png']);
		const pic = [...book.sizes.keys()].find((n) => n.startsWith('OEBPS/Images/'));
		expect(pic).toMatch(/^OEBPS\/Images\/i-[0-9a-f]{16}\.png$/);
		const raw = readFileSync(BOOK);
		expect(raw.subarray(30, 38).toString()).toBe('mimetype');
	});

	it('attaches onto the series ADD made as it is written, entry by entry, no second series', async () => {
		const before = (db.prepare(`SELECT COUNT(*) AS n FROM series`).get() as { n: number }).n;
		expect(await attachWritten(library, [BOOK], (now += 1000))).toEqual([]);
		expect((db.prepare(`SELECT COUNT(*) AS n FROM series`).get() as { n: number }).n).toBe(before);
		const s = db.prepare(`SELECT path, origin_key FROM series WHERE id = ?`).get(seriesId) as {
			path: string;
			origin_key: string;
		};
		expect(s.path).toBe(join(library, 'devices/tsundoku/Library/Novels/Good Novels'));
		expect(entry('/c/1')).toMatchObject({
			available: 1,
			file: 'The Long One.epub',
			label: 'Ch. 1'
		});
		expect(entry('/c/1').locator).toMatch(/^OEBPS\/Text\/c-[0-9a-f]{16}\.xhtml$/);
		expect(entry('/c/3')).toMatchObject({ available: 0, file: '' });
		expect((await states()).states[entry('/c/1').id]).toEqual({ kind: 'have' });
		// The reader's view: each chapter is its own document.
		const book = await readEpub(BOOK);
		const locators = [entry('/c/1').locator, entry('/c/2').locator];
		expect(entryDocs(book.pkg!.spine, locators, 0).map((d) => d.href)).toEqual([locators[0]]);
		expect(planEntries(book.toc, book.pkg!.spine).map((e) => e.locator)).toEqual(locators);
	});

	// The scan stays the cross-check (c170): it reads the same book and agrees.
	it('is left exactly as it was by the scan that follows', async () => {
		const before = snapshot(seriesId);
		await runImport(library, { now: (now += 1000) });
		expect(snapshot(seriesId)).toEqual(before);
	});

	it('rewrites the book with each new chapter, keeping what it held, and a failure counts a try', async () => {
		const positions = () =>
			(
				db
					.prepare(`SELECT source_url, position FROM entries WHERE series_id = ? ORDER BY position`)
					.all(seriesId) as { source_url: string; position: number }[]
			).map((r) => `${r.source_url}@${r.position}`);
		const was = positions();
		const first = (await readEpub(BOOK)).sizes.get(entry('/c/1').locator);
		// A rename in tsundoku doesn't move the book.
		db.prepare(`UPDATE series SET title = 'Renamed' WHERE id = ?`).run(seriesId);
		await downloads.enqueue(seriesId, [
			entry('/c/broken').id,
			entry('/c/3').id,
			entry('/c/empty').id
		]);
		chapterCalls = [];
		expect(await runNovelOnce(deps())).toBe(1);
		expect(chapterCalls).toEqual(['/c/broken', '/c/3', '/c/empty']);
		const left = queue.queueRows(db);
		expect(left.map((q) => [q.entryId, q.state, q.tries, q.failure])).toEqual([
			[entry('/c/broken').id, 'queued', 1, 'source'],
			[entry('/c/empty').id, 'queued', 1, 'source']
		]);
		expect(left[0].nextAt).toBeGreaterThan(now);
		expect(
			db.prepare(`SELECT error FROM download_queue WHERE entry_id = ?`).get(entry('/c/empty').id)
		).toEqual({
			error: 'The chapter came back empty'
		});
		const book = await readEpub(BOOK);
		expect(book.toc.map((t) => t.label)).toEqual(['Ch. 1: Start', 'Ch. 2', 'Ch. 3']);
		expect(book.sizes.get(entry('/c/1').locator)).toBe(first);
		expect(existsSync(BOOK.replace('The Long One', 'Renamed'))).toBe(false);

		await runImport(library, { now: (now += 1000) });
		expect(entry('/c/3')).toMatchObject({ available: 1, file: 'The Long One.epub' });
		expect(entry('/c/broken').available).toBe(0);
		expect(positions()).toEqual(was);
		const d = await states();
		expect(d.states[entry('/c/broken').id].kind).toBe('queued');
		// The owner's rename stands: the book's title doesn't overwrite it.
		expect(
			(db.prepare(`SELECT title FROM series WHERE id = ?`).get(seriesId) as { title: string }).title
		).toBe('Renamed');
	});

	it('waits while the queue is paused, and gives a stuck chapter back to its own worker only', async () => {
		queue.setPaused(true);
		const mtime = statSync(BOOK).mtimeMs;
		now += 60 * 60 * 1000;
		expect(await runNovelOnce(deps())).toBe(0);
		expect(statSync(BOOK).mtimeMs).toBe(mtime);
		queue.setPaused(false);
		db.prepare(`UPDATE download_queue SET state = 'downloading'`).run();
		expect(queue.recover(db, 'manga')).toBe(0);
		expect(queue.recover(db, 'novel')).toBe(2);
	});
});

describe('following a novel', () => {
	const HOUR = 60 * 60 * 1000;
	const checked = () =>
		(
			db.prepare(`SELECT checked_at FROM novel_checks WHERE series_id = ?`).get(seriesId) as
				{ checked_at: number } | undefined
		)?.checked_at ?? null;

	it('asks the plugin at once, and every six hours after', async () => {
		db.exec(`DELETE FROM download_queue`);
		await downloads.setFollowed(seriesId, true);
		await expect.poll(checked).not.toBeNull();
		const first = checked()!;
		expect((await states()).follow).toEqual({ on: true, checked: first });
		// Not due yet: nothing asked.
		expect(await followNovels(first + HOUR, db)).toEqual({ series: 0, queued: 0 });
		expect((await followNovels(first + 7 * HOUR, db)).series).toBe(1);
		expect(checked()).toBe(first + 7 * HOUR);
	});

	it('makes entries of what’s new and queues them, oldest first', async () => {
		now = (checked() ?? now) + 7 * HOUR;
		extra = [
			{ name: 'Chapter 6', path: '/c/6' },
			{ name: 'Chapter 7', path: '/c/7' }
		];
		const before = (db.prepare(`SELECT COUNT(*) AS n FROM series`).get() as { n: number }).n;
		expect(await followNovels(now, db)).toEqual({ series: 1, queued: 2 });
		expect((db.prepare(`SELECT COUNT(*) AS n FROM series`).get() as { n: number }).n).toBe(before);
		expect(entry('/c/6')).toMatchObject({ available: 0, position: 6, label: 'Ch. 6' });
		expect(queue.queueRows(db).map((q) => q.entryId)).toEqual([entry('/c/6').id, entry('/c/7').id]);
		// Asked again: nothing new, nothing queued twice.
		expect(await checkNovel(seriesId, now + 1, db)).toEqual({ added: 0, queued: 0 });
		expect(queue.queueRows(db)).toHaveLength(2);
		expect(await runNovelOnce(deps())).toBe(2);
		await runImport(library, { now: (now += 1000) });
		expect(entry('/c/7').available).toBe(1);
	});

	it('moves a chapter the source pushed along, in the book too, so a rescan keeps it', async () => {
		extra.push({ name: 'Interlude', path: '/c/inter' });
		await checkNovel(seriesId, (now += 1000), db);
		// Unnumbered, after Ch. 7: Mihon's numbering, as ADD's (chapter-number.ts).
		expect(entry('/c/inter').position).toBe(7.5);
		// A side story before it: the two share the gap after Ch. 7, and the interlude moves.
		extra.splice(2, 0, { name: 'Aside', path: '/c/aside' });
		db.exec(`DELETE FROM download_queue`);
		await checkNovel(seriesId, (now += 1000), db);
		expect(entry('/c/aside').position).toBeCloseTo(7.001);
		expect(entry('/c/inter').position).toBeCloseTo(7.002);
		const book = await readEpub(BOOK);
		expect(book.novel?.chapters.find((c) => c.path === '/c/inter')?.position).toBeCloseTo(7.002);
		await runImport(library, { now: (now += 1000) });
		expect(entry('/c/inter').position).toBeCloseTo(7.002);
	});

	it('asks again next time when the plugin fails, and leaves an unfollowed novel alone', async () => {
		const was = checked();
		novelFails = true;
		expect(await followNovels(now + 7 * HOUR, db)).toEqual({ series: 1, queued: 0 });
		expect(checked()).toBe(was);
		novelFails = false;
		await downloads.setFollowed(seriesId, false);
		expect((await states()).follow.on).toBe(false);
		expect(await followNovels(now + 14 * HOUR, db)).toEqual({ series: 0, queued: 0 });
	});

	it('is refreshed without following: a new chapter becomes an entry, and nothing is queued (c220)', async () => {
		db.exec(`DELETE FROM download_queue`);
		extra.push({ name: 'Chapter 8', path: '/c/8' });
		const { refreshSeries } = await import('$lib/server/refresh');
		expect(await refreshSeries(seriesId, (now += 1000))).toEqual({ kind: 'novel', added: 1 });
		expect(entry('/c/8')).toMatchObject({ position: 8, label: 'Ch. 8', available: 0 });
		// A look, not a fetch: FOLLOW stays the only thing that queues.
		expect(queue.queueRows(db)).toEqual([]);
		const d = await states();
		expect(d.refreshable).toBe(true);
		expect(d.follow.on).toBe(false);
		expect(await refreshSeries(seriesId, (now += 1000))).toEqual({ kind: 'novel', added: 0 });
	});
});

/** A series and its entries as rows, for a scan to leave alone. */
function snapshot(id: number) {
	return {
		series: db.prepare(`SELECT * FROM series WHERE id = ?`).get(id),
		entries: db.prepare(`SELECT * FROM entries WHERE series_id = ? ORDER BY id`).all(id)
	};
}
