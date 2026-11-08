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

	it('a page deleted (in its UNDO window) and kept again is the same highlight brought back, and its UNDO restores nothing (round 2)', async () => {
		const s = await downloaded('Again');
		const before = copies().length;
		const first = await keepPage({ entryId: s.entry, page: 0 }, false);
		hl.deleteHighlight(first.highlight.id, false);
		const second = await keepPage({ entryId: s.entry, page: 0 }, false);
		expect(second).toEqual({ highlight: first.highlight, made: false });
		// The band's UNDO on the deleted row: nothing left to put back.
		expect(hl.undoDeleteHighlight(first.highlight.id, false)).toBe(false);
		const live = db
			.prepare(
				`SELECT id FROM highlights WHERE kind = 'page' AND entry_id = ? AND page = 0
					AND page_end IS NULL AND deleted_at IS NULL`
			)
			.all(s.entry);
		expect(live).toEqual([{ id: first.highlight.id }]);
		expect(rows(s.entry)).toHaveLength(1);
		expect(copies().length).toBe(before + 1);
		expect(pageHighlights(s.entry, false).map((k) => k.id)).toEqual([first.highlight.id]);
	});

	it('a page purged after its UNDO window and kept again is a new highlight', async () => {
		const s = await downloaded('Again later');
		const first = await keepPage({ entryId: s.entry, page: 0 }, false);
		hl.deleteHighlight(first.highlight.id, false, NOW);
		hl.purgeDeleted(NOW + hl.UNDO_MS + 1, db);
		const second = await keepPage({ entryId: s.entry, page: 0 }, false);
		// Made anew (the rowid may be reused: the table has no AUTOINCREMENT), and live.
		expect(second.made).toBe(true);
		expect(first.highlight.madeAt).toBeLessThanOrEqual(second.highlight.madeAt);
		expect(rows(s.entry).map((r) => [r.id, r.deleted_at])).toEqual([[second.highlight.id, null]]);
		expect(existsSync(join(pagesDir, `${second.highlight.id}.webp`))).toBe(true);
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

/**
 * Round 3 (reviews/manga-r2.json): a page deleted and kept again inside its
 * UNDO window is the same highlight brought back; after the window it is a
 * new one, whether or not anything purged in between. `/highlights` is the
 * only other door to the purge, and none of these cases list it. The window's
 * edge is `purgeDeleted`'s (`deleted_at < now - UNDO_MS` is gone), so a row
 * deleted exactly `UNDO_MS` ago is still inside it.
 */
describe('the UNDO window, kept again (c703, round 3)', () => {
	const T = NOW + 3_600_000;
	const keepAt = (entryId: number, at: number, a: { page?: number; pageEnd?: number } = {}) =>
		keepPage({ entryId, page: a.page ?? 0, pageEnd: a.pageEnd }, false, { now: () => at });
	const live = (entry: number) =>
		db
			.prepare(
				`SELECT id, page, page_end, note, made_at FROM highlights WHERE entry_id = ?
					AND deleted_at IS NULL ORDER BY id`
			)
			.all(entry) as { id: number; page: number; page_end: number | null; note: string }[];
	const copyOf = (id: number) => existsSync(join(pagesDir, `${id}.webp`));

	it('kept again past the window with no purge run: a new highlight, no old note, made now, one row and one copy', async () => {
		const s = await downloaded('Round three');
		const first = await keepAt(s.entry, T);
		hl.setNote(first.highlight.id, 'bad scan', false);
		hl.deleteHighlight(first.highlight.id, false, T);
		const before = copies().length;
		const at = T + hl.UNDO_MS + 1;
		const second = await keepAt(s.entry, at);
		expect(second.made).toBe(true);
		expect(second.highlight.note).toBe('');
		expect(second.highlight.madeAt).toBe(at);
		expect(live(s.entry)).toHaveLength(1);
		// The old row went with the purge, and with it its copy: one row, one file.
		expect(rows(s.entry).map((r) => r.id)).toEqual([second.highlight.id]);
		expect(copies().length).toBe(before);
		expect(copyOf(second.highlight.id)).toBe(true);
		expect(copies().filter((f) => f.startsWith('.keeping'))).toEqual([]);
	});

	it('exactly UNDO_MS after DELETE it is still inside: the same highlight, its note and made_at back', async () => {
		const s = await downloaded('Round three edge');
		const first = await keepAt(s.entry, T);
		hl.setNote(first.highlight.id, 'keep me', false);
		hl.deleteHighlight(first.highlight.id, false, T);
		const second = await keepAt(s.entry, T + hl.UNDO_MS);
		expect(second.made).toBe(false);
		expect(second.highlight).toMatchObject({ id: first.highlight.id, note: 'keep me', madeAt: T });
		expect(rows(s.entry)).toHaveLength(1);
	});

	it('one ms inside the window is the same highlight; one ms past it is a new one', async () => {
		const a = await downloaded('Round three inside');
		const fa = await keepAt(a.entry, T);
		hl.deleteHighlight(fa.highlight.id, false, T);
		const ra = await keepAt(a.entry, T + hl.UNDO_MS - 1);
		expect([ra.made, ra.highlight.id]).toEqual([false, fa.highlight.id]);

		const b = await downloaded('Round three past');
		const fb = await keepAt(b.entry, T);
		hl.deleteHighlight(fb.highlight.id, false, T);
		const rb = await keepAt(b.entry, T + hl.UNDO_MS + 1);
		expect(rb.made).toBe(true);
		expect(rb.highlight.madeAt).toBe(T + hl.UNDO_MS + 1);
		expect(rows(b.entry).map((r) => r.deleted_at)).toEqual([null]);
	});

	it('the window is the last DELETE’s: deleted, brought back, deleted again, it counts from the second', async () => {
		const s = await downloaded('Round three twice');
		const first = await keepAt(s.entry, T);
		hl.deleteHighlight(first.highlight.id, false, T);
		expect((await keepAt(s.entry, T + 1000)).made).toBe(false);
		const second = T + hl.UNDO_MS - 1000;
		hl.deleteHighlight(first.highlight.id, false, second);
		// Past the first DELETE's window, inside the second's: still the same one.
		const again = await keepAt(s.entry, T + hl.UNDO_MS + 5000);
		expect([again.made, again.highlight.id]).toEqual([false, first.highlight.id]);
		hl.deleteHighlight(first.highlight.id, false, second + 2 * hl.UNDO_MS);
		const late = await keepAt(s.entry, second + 3 * hl.UNDO_MS + 1);
		expect(late.made).toBe(true);
		expect(rows(s.entry).map((r) => r.id)).toEqual([late.highlight.id]);
	});

	it('a page made anew past the window and deleted in turn brings back the newer row, never the old one', async () => {
		const s = await downloaded('Round three older');
		const old = await keepAt(s.entry, T);
		hl.setNote(old.highlight.id, 'old', false);
		hl.deleteHighlight(old.highlight.id, false, T);
		const fresh = await keepAt(s.entry, T + hl.UNDO_MS + 1);
		expect(fresh.made).toBe(true);
		hl.deleteHighlight(fresh.highlight.id, false, T + hl.UNDO_MS + 2);
		const back = await keepAt(s.entry, T + hl.UNDO_MS + 3);
		expect(back).toMatchObject({ made: false, highlight: { id: fresh.highlight.id, note: '' } });
		expect(rows(s.entry)).toHaveLength(1);
	});

	it('DELETE, then UNDO, then HIGHLIGHT: the live one answers, at any time after', async () => {
		const s = await downloaded('Round three undo');
		const first = await keepAt(s.entry, T);
		hl.deleteHighlight(first.highlight.id, false, T);
		expect(hl.undoDeleteHighlight(first.highlight.id, false)).toBe(true);
		const again = await keepAt(s.entry, T + 5 * hl.UNDO_MS);
		expect(again).toMatchObject({ made: false, highlight: { id: first.highlight.id, madeAt: T } });
		expect(rows(s.entry).map((r) => r.deleted_at)).toEqual([null]);
		expect(copyOf(first.highlight.id)).toBe(true);
	});

	it('a BOTH whose one page was deleted alone: the BOTH stands, and the page alone follows its own window', async () => {
		const s = await downloaded('Round three both');
		const both = await keepAt(s.entry, T, { page: 0, pageEnd: 1 });
		const alone = await keepAt(s.entry, T, { page: 0 });
		hl.deleteHighlight(alone.highlight.id, false, T);
		// The BOTH is its own highlight: kept again, it answers itself, untouched by the page's DELETE.
		const bothAgain = await keepAt(s.entry, T + hl.UNDO_MS + 1, { page: 0, pageEnd: 1 });
		expect(bothAgain).toMatchObject({ made: false, highlight: { id: both.highlight.id } });
		// That keep purged the page alone (past its window), never the BOTH.
		expect(rows(s.entry).map((r) => [r.page, r.page_end, r.deleted_at])).toEqual([[0, 1, null]]);
		expect(copyOf(both.highlight.id)).toBe(true);
		const aloneAgain = await keepAt(s.entry, T + hl.UNDO_MS + 2, { page: 0 });
		expect(aloneAgain.made).toBe(true);
		expect(live(s.entry).map((r) => [r.page, r.page_end])).toEqual([
			[0, 1],
			[0, null]
		]);
		// And the BOTH deleted inside its window comes back as the BOTH, not as page 0.
		hl.deleteHighlight(both.highlight.id, false, T + hl.UNDO_MS + 3);
		const pageAlone = await keepAt(s.entry, T + hl.UNDO_MS + 4, { page: 0 });
		expect(pageAlone).toMatchObject({ made: false, highlight: { id: aloneAgain.highlight.id } });
		const bothBack = await keepAt(s.entry, T + hl.UNDO_MS + 5, { page: 1, pageEnd: 0 });
		expect(bothBack).toMatchObject({ made: false, highlight: { id: both.highlight.id } });
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

	it('a spread is its two pages in index order, and only two side by side (round 2)', async () => {
		const s = await downloaded('Spread order', {
			sizes: [
				[400, 600],
				[400, 600],
				[400, 600],
				[400, 600]
			]
		});
		const a = await keepPage({ entryId: s.entry, page: 2, pageEnd: 1 }, false);
		const b = await keepPage({ entryId: s.entry, page: 1, pageEnd: 2 }, false);
		expect(b).toEqual({ highlight: a.highlight, made: false });
		expect(a.highlight).toMatchObject({ page: 1, pageEnd: 2 });
		await expect(keepPage({ entryId: s.entry, page: 0, pageEnd: 3 }, false)).rejects.toMatchObject({
			why: 'not_found'
		});
		expect(rows(s.entry).map((r) => [r.page, r.page_end])).toEqual([[1, 2]]);
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

	/**
	 * The insert's own re-check (round 3). A row another writer set aside
	 * while this fetch was out: inside its window it is brought back; past it
	 * (a second install whose purge has not run, or whose clock is behind) it
	 * is never revived, and this keep is a new highlight beside it. Only the
	 * re-check's bound sees it: the purge ran before the row was there.
	 */
	for (const [label, ago, revived] of [
		['inside its window is brought back', 1000, true],
		['past its window is not, and this keep is made anew', 0, false]
	] as const)
		it(`a page another writer set aside while this fetch was out: ${label} (round 3)`, async () => {
			const s = await downloaded(`Online set aside ${revived}`);
			const at = NOW + 7_200_000;
			let release!: () => void;
			const held = new Promise<void>((r) => (release = r));
			const asked = keepPage({ entryId: s.entry, page: 0 }, false, {
				read: async () => {
					await held;
					return answer();
				},
				now: () => at
			});
			await new Promise((r) => setTimeout(r, 20));
			const deletedAt = revived ? at - ago : at - hl.UNDO_MS - 1;
			const other = Number(
				db
					.prepare(
						`INSERT INTO highlights (kind, series_id, entry_id, page, series_title, series_kind, made_at,
							copy_path, deleted_at)
						VALUES ('page', ?, ?, 0, 'Online set aside', 'manga', ?, 'pages/other.webp', ?)`
					)
					.run(s.series, s.entry, NOW, deletedAt).lastInsertRowid
			);
			release();
			const { highlight, made } = await asked;
			if (revived) {
				expect([highlight.id, made]).toEqual([other, false]);
				expect(rows(s.entry).map((r) => r.deleted_at)).toEqual([null]);
			} else {
				expect(made).toBe(true);
				expect(highlight.id).not.toBe(other);
				expect(highlight.madeAt).toBe(at);
				expect(rows(s.entry).map((r) => [r.id, r.deleted_at])).toEqual([
					[other, deletedAt],
					[highlight.id, null]
				]);
			}
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
