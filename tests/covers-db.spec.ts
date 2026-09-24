import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const work = mkdtempSync(join(tmpdir(), 'tsundoku-covers-'));
// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.COVER_DIR = join(work, 'covers');

const { getDb } = await import('$lib/server/db');
const { readBookCover, readCover, readPageThumb, refreshCovers } =
	await import('$lib/server/covers');
const { samplePage } = await import('$lib/server/pages/sample');
const { zip } = await import('./helpers/zip-writer');

const png = samplePage(40, 1);
const db = getDb();
db.exec(
	`INSERT INTO roots (id, name, path, hidden) VALUES (1, 'Mihon', '${work}', 0), (2, 'Hentoid', '${work}/h', 1)`
);

/** A series with one entry; returns its id. */
function series(o: {
	title: string;
	root?: number;
	path?: string;
	file?: string;
	coverFile?: string | null;
	coverUrl?: string;
	available?: boolean;
}): number {
	const id = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, path, cover_url) VALUES (?, ?, 'manga', 0, ?, ?)`
			)
			.run(o.root ?? 1, o.title, o.path ?? '', o.coverUrl ?? '').lastInsertRowid
	);
	db.prepare(
		`INSERT INTO entries (series_id, position, label, added_at, file, available, cover_file) VALUES (?, 1, 'Ch. 1', 0, ?, ?, ?)`
	).run(id, o.file ?? '', o.available === false ? 0 : 1, o.coverFile ?? null);
	return id;
}
const row = (id: number) =>
	db.prepare(`SELECT cover_key, cover_at, cover_failed_at FROM series WHERE id = ?`).get(id) as {
		cover_key: string;
		cover_at: number | null;
		cover_failed_at: number | null;
	};

// A local book with its own cover.jpg beside the chapter folder.
mkdirSync(join(work, 'Local Book', 'chapter_1'), { recursive: true });
writeFileSync(join(work, 'Local Book', 'cover.jpg'), png);
writeFileSync(join(work, 'Local Book', 'chapter_1', '001.png'), png);
const local = series({
	title: 'Local Book',
	path: work,
	file: 'Local Book/chapter_1',
	coverFile: '../cover.jpg'
});
// A downloaded chapter, and the site's cover URL too.
mkdirSync(join(work, 'Downloaded'), { recursive: true });
writeFileSync(join(work, 'Downloaded', 'Chapter 1.cbz'), zip([{ name: '001.png', data: png }]));
const downloaded = series({
	title: 'Downloaded',
	path: join(work, 'Downloaded'),
	file: 'Chapter 1.cbz',
	coverUrl: 'https://site.example/covers/downloaded.jpg'
});
// Read online only: nothing on disk, just the URL.
const online = series({
	title: 'Online',
	available: false,
	coverUrl: 'https://site.example/covers/online.jpg#image-request'
});
const bare = series({ title: 'Nothing', available: false });

afterEach(() => vi.unstubAllGlobals());

describe('covers', () => {
	it('come from the files first, and never ask a site without leave', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const counts = await refreshCovers({ remote: false, now: 1000 });
		expect(fetch).not.toHaveBeenCalled();
		expect(row(local).cover_key).toMatch(/^file:.*cover\.jpg$/);
		// Without the site, a downloaded chapter's first page stands in.
		expect(row(downloaded).cover_key).toMatch(/^page:/);
		expect(row(online).cover_at).toBeNull();
		expect(row(bare).cover_at).toBeNull();
		expect(counts.made).toBe(2);
		expect(existsSync(join(work, 'covers', `${local}.webp`))).toBe(true);
	});

	it('prefer the site’s cover to a first page, and change nothing on a second run', async () => {
		const fetch = vi.fn(async () => new Response(new Uint8Array(png), { status: 200 }));
		vi.stubGlobal('fetch', fetch);
		await refreshCovers({ remote: true, now: 2000 });
		expect(row(downloaded).cover_key).toBe('url:https://site.example/covers/downloaded.jpg');
		expect(row(online).cover_key).toBe('url:https://site.example/covers/online.jpg');
		// It asked as a browser on the site's own pages would.
		const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
		expect((init.headers as Record<string, string>).referer).toBe('https://site.example/');
		fetch.mockClear();
		const again = await refreshCovers({ remote: true, now: 3000 });
		expect(fetch).not.toHaveBeenCalled();
		expect(again.made).toBe(0);
	});

	it('remember a refusing site for a week, and keep a page meanwhile', async () => {
		db.prepare(`UPDATE series SET cover_url = 'https://site.example/gone.jpg' WHERE id = ?`).run(
			downloaded
		);
		const fetch = vi.fn(async () => new Response('no', { status: 403 }));
		vi.stubGlobal('fetch', fetch);
		await refreshCovers({ ids: [downloaded], remote: true, now: 10_000 });
		expect(row(downloaded).cover_failed_at).toBe(10_000);
		expect(row(downloaded).cover_key).toMatch(/^page:/);
		fetch.mockClear();
		await refreshCovers({ ids: [downloaded], remote: true, now: 20_000 });
		expect(fetch).not.toHaveBeenCalled();
		await refreshCovers({ ids: [downloaded], remote: true, now: 10_000 + 8 * 24 * 3600_000 });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('are hidden with their series', async () => {
		const hidden = series({
			title: 'Hidden',
			root: 2,
			path: work,
			file: 'Local Book/chapter_1',
			coverFile: '../cover.jpg'
		});
		await refreshCovers({ ids: [hidden], remote: false, now: 5000 });
		expect(await readCover(hidden, false)).toBeNull();
		expect((await readCover(hidden, true))?.at).toBe(5000);
		expect(await readCover(local, false)).not.toBeNull();
	});
});

describe('book covers', () => {
	const entryOf = (seriesId: number) =>
		(db.prepare(`SELECT id FROM entries WHERE series_id = ?`).get(seriesId) as { id: number }).id;
	const made = (entryId: number) =>
		readdirSync(join(work, 'covers', 'books')).filter((f) => f.startsWith(`${entryId}-`));

	it('come from the first page, as a thumbnail kept on the library disk', async () => {
		const e = entryOf(downloaded);
		const c = await readBookCover(e, false);
		expect(c?.version).toBe('first');
		expect(c!.body.subarray(8, 12).toString()).toBe('WEBP');
		expect(made(e)).toHaveLength(1);
	});

	it('follow the page the owner chose, replacing the one made before', async () => {
		const e = entryOf(downloaded);
		const before = made(e);
		db.prepare(`UPDATE entries SET cover_page = 0 WHERE id = ?`).run(e);
		expect((await readBookCover(e, false))?.version).toBe('p0');
		expect(made(e)).toHaveLength(1);
		expect(made(e)).not.toEqual(before);
	});

	it('use the cover file a folder carries', async () => {
		const e = entryOf(local);
		expect((await readBookCover(e, false))?.body.length).toBeGreaterThan(0);
	});

	it('are nothing for a book not on disk, and hidden with their series', async () => {
		expect(await readBookCover(entryOf(bare), false)).toBeNull();
		mkdirSync(join(work, 'h', 'Hidden Book'), { recursive: true });
		writeFileSync(
			join(work, 'h', 'Hidden Book', 'Chapter 1.cbz'),
			zip([{ name: '001.png', data: png }])
		);
		const hidden = series({
			title: 'Hidden Book',
			root: 2,
			path: join(work, 'h', 'Hidden Book'),
			file: 'Chapter 1.cbz'
		});
		expect(await readBookCover(entryOf(hidden), false)).toBeNull();
		expect(await readBookCover(entryOf(hidden), true)).not.toBeNull();
	});
});

describe('page thumbnails', () => {
	const entryOf = (seriesId: number) =>
		(db.prepare(`SELECT id FROM entries WHERE series_id = ?`).get(seriesId) as { id: number }).id;

	it('are small WebPs of the page, made once and kept', async () => {
		const e = entryOf(downloaded);
		const t = await readPageThumb(e, 0, false);
		expect(t!.subarray(8, 12).toString()).toBe('WEBP');
		const kept = readdirSync(join(work, 'covers', 'pages', String(e)));
		expect(kept).toHaveLength(1);
		expect(await readPageThumb(e, 0, false)).toEqual(t);
		expect(readdirSync(join(work, 'covers', 'pages', String(e)))).toEqual(kept);
	});

	it("are nothing for a page that isn't there", async () => {
		expect(await readPageThumb(entryOf(downloaded), 99, false)).toBeNull();
		expect(await readPageThumb(entryOf(bare), 0, false)).toBeNull();
	});
});
