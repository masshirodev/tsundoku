import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads these once.
process.env.DATABASE_PATH = ':memory:';
const work = mkdtempSync(join(tmpdir(), 'tsundoku-highlight-pages-'));
process.env.HIGHLIGHTS_DIR = join(work, 'highlights');
process.env.LIBRARY_ROOT = join(work, 'library');
process.env.TRASH_DIR = join(work, 'trash');
process.env.COVER_DIR = join(work, 'covers');

const { getDb } = await import('$lib/server/db');
const hl = await import('$lib/server/highlights');
const { keepPage, KeepError, pageHighlights } = await import('$lib/server/highlights/pages');
const { deleteSeries } = await import('$lib/server/delete');

/**
 * Highlights H3, the store's half (card c703; doc/HIGHLIGHTS.md, "Pages"): a
 * page kept from the image reader through `keepPage`, with the reader's own
 * door to a page's bytes (`readPage`, a downloaded chapter's folder here),
 * and stand-ins for a page read online that answer as the engine's proxy
 * does: a throw when the source sends nothing (`readOnlinePage` rethrows on
 * its second, fresh try), or an answer that arrives late.
 */

const NOW = Date.UTC(2026, 10, 7, 12);
const db = getDb();
let root = 0;
const pagesDir = join(work, 'highlights', 'pages');

afterAll(() => rmSync(work, { recursive: true, force: true }));

beforeAll(() => {
	root = Number(
		db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Library', '/l', 0)`).run()
			.lastInsertRowid
	);
});

/** A page of one colour at a size of its own. */
const png = (width: number, height: number, rgb: [number, number, number]) =>
	sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
		.png()
		.toBuffer();

const RED: [number, number, number] = [220, 20, 20];
const BLUE: [number, number, number] = [20, 20, 220];

/** A downloaded chapter: a folder of pages, as readPage finds them. */
async function downloaded(
	title: string,
	o: { kind?: string; hidden?: number; sizes?: [number, number][] } = {}
): Promise<{ series: number; entry: number }> {
	const dir = join(work, 'library', title);
	const ch = join(dir, 'ch1');
	mkdirSync(ch, { recursive: true });
	const sizes = o.sizes ?? [
		[600, 900],
		[620, 880],
		[640, 960]
	];
	for (const [i, [w, h]] of sizes.entries())
		writeFileSync(
			join(ch, `${String(i + 1).padStart(3, '0')}.png`),
			await png(w, h, i % 2 ? BLUE : RED)
		);
	const series = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, source, path, added_at, indexed_at, origin_key, hidden, in_library)
				VALUES (?, ?, ?, 'mihon', ?, ?, ?, ?, ?, 1)`
			)
			.run(root, title, o.kind ?? 'manga', dir, NOW, NOW, `mihon:100:/${title}`, o.hidden ?? 0)
			.lastInsertRowid
	);
	const entry = Number(
		db
			.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, available, file, page_count)
				VALUES (?, 1, 'Ch. 1', 'The Tower', ?, 1, 'ch1', ?)`
			)
			.run(series, NOW, sizes.length).lastInsertRowid
	);
	return { series, entry };
}

const copies = () => (existsSync(pagesDir) ? readdirSync(pagesDir).sort() : []);
const rows = (entry: number) =>
	db.prepare(`SELECT * FROM highlights WHERE entry_id = ? ORDER BY id`).all(entry) as Record<
		string,
		unknown
	>[];

describe('keeping a downloaded page (c703)', () => {
	it('copies the page at its own size as WebP, with the snapshot, and kind page', async () => {
		const s = await downloaded('Kaze no Tou');
		const { highlight, made } = await keepPage({ entryId: s.entry, page: 1 }, false, {
			now: () => NOW
		});
		expect(made).toBe(true);
		const [r] = rows(s.entry);
		expect(r).toMatchObject({
			kind: 'page',
			series_id: s.series,
			entry_id: s.entry,
			origin_key: 'mihon:100:/Kaze no Tou',
			number: 1,
			page: 1,
			page_end: null,
			series_title: 'Kaze no Tou',
			series_kind: 'manga',
			entry_label: 'Ch. 1',
			entry_title: 'The Tower',
			hidden: 0,
			colour: null,
			state: 'ok',
			made_at: NOW,
			copy_path: `pages/${highlight.id}.webp`,
			copy_width: 620,
			copy_height: 880
		});
		const meta = await sharp(join(work, 'highlights', `pages/${highlight.id}.webp`)).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual(['webp', 620, 880]);
		expect(r.copy_bytes).toBeGreaterThan(0);
		expect(copies()).toEqual([`${highlight.id}.webp`]);
		expect(highlight).toMatchObject({ page: 1, pageEnd: null, note: '', madeAt: NOW });
	});

	it("is a page whatever the series' kind: a manhwa's page is kind page, the series' kind kept as the snapshot", async () => {
		const s = await downloaded('Haneul', { kind: 'manhwa' });
		await keepPage({ entryId: s.entry, page: 0 }, false);
		expect(rows(s.entry).map((r) => [r.kind, r.series_kind])).toEqual([['page', 'manhwa']]);
	});

	it('keeps the same page once: a second ask answers the first, and leaves no second copy', async () => {
		const s = await downloaded('Twice');
		const first = await keepPage({ entryId: s.entry, page: 2 }, false);
		const again = await keepPage({ entryId: s.entry, page: 2 }, false);
		expect(again).toEqual({ highlight: first.highlight, made: false });
		expect(rows(s.entry)).toHaveLength(1);
		expect(copies().filter((f) => f.startsWith('.keeping'))).toEqual([]);
	});

	it('keeps the same page once when two asks race, and the copy on disk is the row’s', async () => {
		const s = await downloaded('Race');
		const before = copies().length;
		const [a, b] = await Promise.all([
			keepPage({ entryId: s.entry, page: 0 }, false),
			keepPage({ entryId: s.entry, page: 0 }, false)
		]);
		expect(a.highlight.id).toBe(b.highlight.id);
		expect([a.made, b.made].sort()).toEqual([false, true]);
		expect(rows(s.entry)).toHaveLength(1);
		expect(copies().length).toBe(before + 1);
	});

	it('a page deleted (in its UNDO window) and kept again is a new highlight', async () => {
		const s = await downloaded('Again');
		const first = await keepPage({ entryId: s.entry, page: 0 }, false);
		hl.deleteHighlight(first.highlight.id, false);
		const second = await keepPage({ entryId: s.entry, page: 0 }, false);
		expect(second.made).toBe(true);
		expect(second.highlight.id).not.toBe(first.highlight.id);
		expect(pageHighlights(s.entry, false).map((k) => k.id)).toEqual([second.highlight.id]);
	});

	it('keeps a page taller than WebP allows, scaled to fit 16383 px with its aspect (round 2)', async () => {
		const s = await downloaded('Long Strip', { kind: 'manhwa', sizes: [[720, 20000]] });
		const { highlight, made } = await keepPage({ entryId: s.entry, page: 0 }, false);
		expect(made).toBe(true);
		const [r] = rows(s.entry);
		const scale = 16383 / 20000;
		expect(r.copy_height).toBe(16383);
		expect(Math.abs((r.copy_width as number) - 720 * scale)).toBeLessThanOrEqual(1);
		const meta = await sharp(join(work, 'highlights', `pages/${highlight.id}.webp`)).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual(['webp', r.copy_width, r.copy_height]);
	});

	it('refuses a page that is not there, and stores nothing', async () => {
		const s = await downloaded('Short');
		await expect(keepPage({ entryId: s.entry, page: 9 }, false)).rejects.toMatchObject({
			why: 'not_found'
		});
		await expect(keepPage({ entryId: s.entry, page: -1 }, false)).rejects.toBeInstanceOf(KeepError);
		await expect(keepPage({ entryId: 999_999, page: 0 }, false)).rejects.toMatchObject({
			why: 'not_found'
		});
		expect(rows(s.entry)).toEqual([]);
	});
});

describe('a spread kept as BOTH (c703, Manga M2)', () => {
	it('is one image, the two pages as drawn: R→L puts the later page on the left', async () => {
		const s = await downloaded('Spread', {
			sizes: [
				[400, 600],
				[400, 600],
				[300, 450]
			]
		});
		const { highlight } = await keepPage(
			{ entryId: s.entry, page: 0, pageEnd: 1, rtl: true },
			false
		);
		const [r] = rows(s.entry);
		expect([r.page, r.page_end, r.copy_width, r.copy_height]).toEqual([0, 1, 800, 600]);
		const img = sharp(join(work, 'highlights', `pages/${highlight.id}.webp`));
		const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
		const at = (x: number) => [
			...data.subarray((300 * info.width + x) * 3, (300 * info.width + x) * 3 + 3)
		];
		// Page 2 (index 1) is blue and drawn on the left in R→L; page 1 red on the right.
		expect(at(100)[2]).toBeGreaterThan(150);
		expect(at(700)[0]).toBeGreaterThan(150);
	});

	it('L→R puts the first page on the left, and scales the shorter page to the taller one', async () => {
		const s = await downloaded('Spread LTR', {
			sizes: [
				[400, 600],
				[200, 300]
			]
		});
		const { highlight } = await keepPage({ entryId: s.entry, page: 0, pageEnd: 1 }, false);
		const [r] = rows(s.entry);
		expect([r.copy_width, r.copy_height]).toEqual([800, 600]);
		const { data, info } = await sharp(join(work, 'highlights', `pages/${highlight.id}.webp`))
			.raw()
			.toBuffer({ resolveWithObject: true });
		const at = (x: number) => [
			...data.subarray((300 * info.width + x) * 3, (300 * info.width + x) * 3 + 3)
		];
		expect(at(100)[0]).toBeGreaterThan(150);
		expect(at(700)[2]).toBeGreaterThan(150);
	});

	it('BOTH and one of its pages alone are two highlights; BOTH twice is one', async () => {
		const s = await downloaded('Spread twice');
		await keepPage({ entryId: s.entry, page: 0, pageEnd: 1 }, false);
		await keepPage({ entryId: s.entry, page: 0 }, false);
		const again = await keepPage({ entryId: s.entry, page: 0, pageEnd: 1 }, false);
		expect(again.made).toBe(false);
		expect(rows(s.entry).map((r) => [r.page, r.page_end])).toEqual([
			[0, 1],
			[0, null]
		]);
		await expect(keepPage({ entryId: s.entry, page: 0, pageEnd: 0 }, false)).rejects.toMatchObject({
			why: 'not_found'
		});
	});

	it('a BOTH wider than WebP allows is scaled to fit 16383 px with its aspect (round 2)', async () => {
		const s = await downloaded('Wide Spread', {
			sizes: [
				[9000, 400],
				[9000, 400]
			]
		});
		const { highlight } = await keepPage({ entryId: s.entry, page: 0, pageEnd: 1 }, false);
		const [r] = rows(s.entry);
		expect(r.copy_width).toBe(16383);
		expect(Math.abs((r.copy_height as number) - 400 * (16383 / 18000))).toBeLessThanOrEqual(1);
		const meta = await sharp(join(work, 'highlights', `pages/${highlight.id}.webp`)).metadata();
		expect([meta.width, meta.height]).toEqual([r.copy_width, r.copy_height]);
	});
});

describe('a page read online (c703, Manga M7: MAKING)', () => {
	const fakeEntry = async (title: string) => (await downloaded(title)).entry;
	const answer = async () => {
		const body = await png(500, 700, RED);
		return { body, type: 'image/png', size: body.length };
	};

	it('a fetch that fails stores nothing, and asking again keeps one', async () => {
		const entry = await fakeEntry('Online fail');
		const before = copies();
		let calls = 0;
		const failing = async () => {
			calls += 1;
			throw new Error('fetch failed');
		};
		await expect(
			keepPage({ entryId: entry, page: 0 }, false, { read: failing })
		).rejects.toMatchObject({
			why: 'source'
		});
		expect(rows(entry)).toEqual([]);
		expect(copies()).toEqual(before);
		const kept = await keepPage({ entryId: entry, page: 0 }, false, { read: answer });
		expect(kept.made).toBe(true);
		expect(rows(entry)).toHaveLength(1);
		expect(calls).toBe(1);
	});

	it('a late answer and a retry while it is coming are one fetch, one row and one copy', async () => {
		const entry = await fakeEntry('Online late');
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		let calls = 0;
		const late = async () => {
			calls += 1;
			await held;
			return answer();
		};
		const before = copies().length;
		const first = keepPage({ entryId: entry, page: 0 }, false, { read: late });
		const retry = keepPage({ entryId: entry, page: 0 }, false, { read: late });
		// Nothing is kept while the source has not answered.
		await new Promise((r) => setTimeout(r, 20));
		expect(rows(entry)).toEqual([]);
		release();
		const [a, b] = await Promise.all([first, retry]);
		expect(a.highlight.id).toBe(b.highlight.id);
		expect(calls).toBe(1);
		expect(rows(entry)).toHaveLength(1);
		expect(copies().length).toBe(before + 1);
	});

	it('a page another writer kept while this fetch was out stands, and this copy is not left behind', async () => {
		const s = await downloaded('Online other');
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		const late = async () => {
			await held;
			return answer();
		};
		const asked = keepPage({ entryId: s.entry, page: 0 }, false, { read: late });
		await new Promise((r) => setTimeout(r, 20));
		// Another process (a second install on the same database) kept it meanwhile.
		const other = Number(
			db
				.prepare(
					`INSERT INTO highlights (kind, series_id, entry_id, page, series_title, series_kind, made_at, copy_path)
					VALUES ('page', ?, ?, 0, 'Online other', 'manga', ?, 'pages/other.webp')`
				)
				.run(s.series, s.entry, NOW).lastInsertRowid
		);
		const before = copies();
		release();
		const { highlight, made } = await asked;
		expect([highlight.id, made]).toEqual([other, false]);
		expect(rows(s.entry)).toHaveLength(1);
		expect(copies()).toEqual(before);
	});

	it('an answer that is not an image stores nothing', async () => {
		const entry = await fakeEntry('Online junk');
		const junk = async () => ({ body: Buffer.from('<html>'), type: 'text/html', size: 6 });
		await expect(
			keepPage({ entryId: entry, page: 0 }, false, { read: junk })
		).rejects.toMatchObject({
			why: 'not_an_image'
		});
		expect(rows(entry)).toEqual([]);
		expect(copies().filter((f) => f.startsWith('.keeping'))).toEqual([]);
	});
});

describe('hidden, and the pointer’s life after (c703)', () => {
	it('a hidden series’ page is not found without reveal, and kept hidden with it', async () => {
		const s = await downloaded('Hidden one', { hidden: 1 });
		await expect(keepPage({ entryId: s.entry, page: 0 }, false)).rejects.toMatchObject({
			why: 'not_found'
		});
		const { highlight } = await keepPage({ entryId: s.entry, page: 0 }, true);
		expect(rows(s.entry)[0].hidden).toBe(1);
		expect(pageHighlights(s.entry, false)).toEqual([]);
		expect(pageHighlights(s.entry, true).map((k) => k.id)).toEqual([highlight.id]);
	});

	it('the series deleted: the kept page is ORPHAN with its copy, and DELETE’s line counts it', async () => {
		const s = await downloaded('Deleted after');
		const { highlight } = await keepPage({ entryId: s.entry, page: 0 }, false);
		expect(hl.heldBy([s.series], false)).toMatchObject({ n: 1, series: 1 });
		const gone = await deleteSeries([s.series], false, { now: NOW, highlights: false });
		expect(gone.series).toBe(1);
		const r = db.prepare(`SELECT * FROM highlights WHERE id = ?`).get(highlight.id) as Record<
			string,
			unknown
		>;
		expect([r.state, r.series_id, r.entry_id]).toEqual(['orphan_series', null, null]);
		expect(existsSync(join(work, 'highlights', String(r.copy_path)))).toBe(true);
	});

	it('MOVE’s line counts a kept page: it follows a matched chapter, and is named on one the move takes away', async () => {
		const s = await downloaded('Moved after');
		await keepPage({ entryId: s.entry, page: 2 }, false);
		const follows = hl.moveHighlights(
			s.series,
			{ matches: [{ entry: { id: s.entry } }], kept: [] },
			{ from: 'MangaDex', to: 'Weeb Central' }
		);
		expect(follows).toEqual({ follow: 1, lose: 0, named: [] });
		const lost = hl.moveHighlights(
			s.series,
			{ matches: [], kept: [] },
			{ gone: new Set([s.entry]), from: 'MangaDex', to: 'Weeb Central' }
		);
		expect(lost.lose).toBe(1);
		expect(lost.named.map((n) => n.place)).toEqual(['CH. 1 · P. 3']);
	});
});
