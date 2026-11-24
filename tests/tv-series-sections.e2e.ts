import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';
import { freePort } from './helpers/tag-world';

/**
 * The series screen's two columns as two sections, with the remote
 * (doc/FOCUS.md, "Sections"), at 960×540 with no pointer: ↑ ↓ stay in the column
 * they started in, scroll it to its real end and then stop, only ← → cross, and
 * crossing back lands on the row left. On a seeded database of its own, with
 * a 60-chapter series no other spec opens, so a long list and a long column
 * cannot be anyone else's state.
 */

let world: {
	base: string;
	id: number;
	other: number;
	worked: number;
	pages: number;
	book: number;
	short: number;
	six: number;
	seven: number;
	stop: () => Promise<void>;
};

function seed(dbPath: string): {
	id: number;
	other: number;
	worked: number;
	pages: number;
	book: number;
	short: number;
	six: number;
	seven: number;
} {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const now = Date.UTC(2026, 10, 8, 12);
		const description = Array.from({ length: 60 }, (_, i) => `Line ${i} of a long synopsis.`).join(
			' '
		);
		const series = (title: string, kind = 'manga') =>
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, in_library, description, status)
						VALUES (?, ?, ?, 'local', 210, ?, ?, 1, ?, 'ONGOING')`
					)
					.run(root, title, kind, now, now, description).lastInsertRowid
			);
		const id = series('Two Columns');
		const other = series('Two Others');
		// A Work's row opens its sheet from inside the details column: a scope nested in a section.
		const worked = series('Work One');
		const work = Number(
			db
				.prepare(`INSERT INTO works (name, created_at, order_mode) VALUES ('A Work', ?, 'hand')`)
				.run(now).lastInsertRowid
		);
		const member = db.prepare(
			`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, ?)`
		);
		member.run(work, worked, 1);
		member.run(work, series('Work Two'), 2);
		const entry = db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, file, bytes, page_count, available) VALUES (?, ?, ?, ?, '', 0, 12, 1)`
		);
		for (let i = 1; i <= 60; i++) {
			entry.run(id, i, `Chapter ${i}`, now);
			entry.run(other, i, `Part ${i}`, now);
			entry.run(worked, i, `Part ${i}`, now);
		}
		const tagId = (value: string) => {
			db.prepare(`INSERT OR IGNORE INTO tags (namespace, value) VALUES ('genre', ?)`).run(value);
			return (
				db.prepare(`SELECT id FROM tags WHERE namespace = 'genre' AND value = ?`).get(value) as {
					id: number;
				}
			).id;
		};
		for (let i = 0; i < 40; i++)
			db.prepare(`INSERT INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
				id,
				tagId(`Tag ${i}`)
			);
		// A series of books: `?book=` draws its pages, the one screen of a single column with no SELECT.
		const pages = series('Page Books', 'doujin');
		const book = db.prepare(
			`INSERT INTO entries (series_id, position, label, title, added_at, file, bytes, page_count, available) VALUES (?, ?, ?, ?, ?, '', 0, 200, 1)`
		);
		const first = Number(book.run(pages, 1, 'Book 1', 'First Book', now).lastInsertRowid);
		book.run(pages, 2, 'Book 2', 'Second Book', now);
		// A list that ends above a failed save's band, so nothing covers its last row.
		const short = series('Short Rows');
		for (let i = 1; i <= 3; i++) entry.run(short, i, `Chapter ${i}`, now);
		// Either side of the band's top: the last whose rows all clear it, and the first that doesn't.
		const six = series('Six Rows');
		for (let i = 1; i <= 6; i++) entry.run(six, i, `Chapter ${i}`, now);
		const seven = series('Seven Rows');
		for (let i = 1; i <= 7; i++) entry.run(seven, i, `Chapter ${i}`, now);
		return { id, other, worked, pages, book: first, short, six, seven };
	} finally {
		db.close();
	}
}

async function start() {
	const work = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-tv-series-sections-'));
	const dbPath = join(work, 'library.sqlite');
	const { id, other, worked, pages, book, short, six, seven } = seed(dbPath);
	const port = await freePort();
	const base = `http://localhost:${port}`;
	const preview: ChildProcess = spawn(
		'npx',
		['vite', 'preview', '--port', String(port), '--strictPort'],
		{
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				TSUNDOKU_ANILIST: 'off',
				TSUNDOKU_HOME: join(work, 'home'),
				LIBRARY_ROOT: join(work, 'library'),
				COVER_DIR: join(work, 'covers'),
				BACKUP_DIR: join(work, 'backups')
			},
			stdio: 'ignore'
		}
	);
	let up = false;
	for (let i = 0; i < 120 && !up; i++) {
		try {
			up = (await fetch(base, { redirect: 'manual' })).status > 0;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	if (!up) throw new Error('the tv-series-sections preview never answered');
	return {
		base,
		id,
		other,
		worked,
		pages,
		book,
		short,
		six,
		seven,
		stop: async () => {
			preview.kill();
			rmSync(work, { recursive: true, force: true });
		}
	};
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
	world = await start();
});
test.afterAll(async () => {
	await world?.stop();
});

const where = (page: Page) =>
	page.evaluate(() => {
		const a = document.activeElement as HTMLElement | null;
		const m = (s: string) => {
			const e = document.querySelector(s) as HTMLElement;
			return { top: Math.round(e.scrollTop), client: e.clientHeight, scroll: e.scrollHeight };
		};
		return {
			col: a?.closest('.panel-col')
				? 'panel'
				: a?.closest('.list-col')
					? 'list'
					: a?.closest('.bar')
						? 'bar'
						: (a?.tagName ?? ''),
			text: a?.innerText?.trim().replace(/\s+/g, ' ').slice(0, 30) ?? '',
			panel: m('.panel-col'),
			list: m('.list-col'),
			y: Math.round(window.scrollY)
		};
	});

const row = (page: Page) =>
	page.evaluate(() =>
		(document.activeElement as HTMLElement | null)?.innerText?.trim().replace(/\s+/g, ' ')
	);

/**
 * Whether the focused thing can really be seen: what is drawn at its top edge,
 * its middle and its bottom edge is the thing itself. A rect on the viewport
 * says nothing about a pinned head or a column's clip over it.
 */
const seen = (page: Page) =>
	page.evaluate(() => {
		const el = document.activeElement as HTMLElement;
		const r = el.getBoundingClientRect();
		const x = r.left + r.width / 2;
		const drawn = (y: number) => {
			const hit = document.elementFromPoint(x, y);
			return !!hit && el.contains(hit);
		};
		return {
			whole: drawn(r.top + 2) && drawn(r.top + r.height / 2) && drawn(r.bottom - 2),
			text: el.innerText?.trim().replace(/\s+/g, ' ').slice(0, 24) ?? '',
			top: Math.round(r.top),
			bottom: Math.round(r.bottom)
		};
	});

async function open(page: Page, id = world.id) {
	await page.goto(`${world.base}/series/${id}`);
	await expect(page.locator('.panel-col').first()).toBeVisible();
	await expect(page.locator('.list-col .entry').first()).toBeVisible();
}

/** The pad on the panel's EDIT, the second stop down from its start. */
async function padToEdit(page: Page) {
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => row(page)).toContain('EDIT');
}

/**
 * Prose taller than the column under the last stop, as a long ABOUT or a row of
 * labels is on a real series. Nothing here can land on it, so only a
 * scroll can show it.
 */
const addProse = (page: Page) =>
	page.evaluate(() => {
		const prose = document.createElement('div');
		prose.id = 'prose';
		prose.style.height = '900px';
		document.querySelector('.panel-col')?.append(prose);
	});

test('↓ brings the whole details column on screen, and at its end does nothing', async ({
	page
}) => {
	await open(page);
	await addProse(page);
	await padToEdit(page);
	const columns: string[] = [];
	let last = await where(page);
	for (let i = 0; i < 60; i++) {
		await page.keyboard.press('ArrowDown');
		last = await where(page);
		columns.push(last.col);
		if (last.panel.top + last.panel.client >= last.panel.scroll - 1) break;
	}
	expect(new Set(columns), 'the column keeps ↓').toEqual(new Set(['panel']));
	expect(last.panel.top + last.panel.client).toBeGreaterThanOrEqual(last.panel.scroll - 1);
	expect(last.panel.top, 'the column really moved').toBeGreaterThan(0);

	const before = last;
	await page.keyboard.press('ArrowDown');
	const after = await where(page);
	expect(after, 'at the very end ↓ does nothing, here or in the other column').toEqual(before);
	expect(after.list.top, 'the chapter list did not move').toBe(0);
	expect(after.y, 'the page did not move').toBe(0);
});

test('↑ walks the details column back to its top, then the bar, never the list', async ({
	page
}) => {
	await open(page);
	await addProse(page);
	await padToEdit(page);
	for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowDown');
	const down = await where(page);
	expect(down.panel.top, 'started from the end').toBeGreaterThan(0);

	const columnsUp: string[] = [];
	for (let i = 0; i < 100; i++) {
		await page.keyboard.press('ArrowUp');
		const w = await where(page);
		columnsUp.push(w.col);
		if (w.col === 'bar') break;
	}
	const stops = new Set(columnsUp);
	expect(stops.has('list'), 'the list took no ↑').toBe(false);
	expect(columnsUp.at(-1), '↑ at the real top reaches the bar').toBe('bar');
	expect((await where(page)).panel.top, 'the column came all the way up').toBe(0);
});

test('a long chapter list keeps ↓ to its last row and ↑ back up to its first', async ({ page }) => {
	await open(page);
	await padToEdit(page);
	await page.keyboard.press('ArrowRight');
	expect((await where(page)).col, '→ crossed into the list').toBe('list');

	const columns: string[] = [];
	for (let i = 0; i < 80; i++) {
		await page.keyboard.press('ArrowDown');
		columns.push((await where(page)).col);
	}
	expect(new Set(columns), '↓ stayed in the list to its end').toEqual(new Set(['list']));
	const end = await where(page);
	expect(end.text).toContain('Chapter 60');
	expect(end.list.top + end.list.client).toBeGreaterThanOrEqual(end.list.scroll - 1);
	const fit = await page.evaluate(() => {
		const r = (document.activeElement as HTMLElement).getBoundingClientRect();
		const c = (document.querySelector('.list-col') as HTMLElement).getBoundingClientRect();
		return { rowBottom: r.bottom, columnBottom: c.bottom };
	});
	expect(fit.rowBottom, 'the last row is whole on screen').toBeLessThanOrEqual(
		fit.columnBottom + 0.5
	);

	await page.keyboard.press('ArrowDown');
	expect(await where(page), 'at its end ↓ does nothing').toEqual(end);

	const up: string[] = [];
	const hidden: string[] = [];
	const chapters: number[] = [];
	for (let i = 0; i < 90; i++) {
		await page.keyboard.press('ArrowUp');
		const w = await where(page);
		up.push(w.col);
		if (w.col === 'bar') break;
		const shown = await seen(page);
		if (!shown.whole) hidden.push(`${shown.text} at ${shown.top}-${shown.bottom}`);
		const chapter = /^\d+ Chapter (\d+)/.exec(w.text);
		if (chapter) chapters.push(Number(chapter[1]));
	}
	expect(hidden, 'every row ↑ lands on is drawn whole').toEqual([]);
	expect(chapters, '↑ takes the rows one at a time').toEqual(
		Array.from({ length: 59 }, (_, i) => 59 - i)
	);
	expect(new Set(up).has('panel'), 'the panel took no ↑').toBe(false);
	expect(up.at(-1), '↑ at the very top reaches the bar').toBe('bar');
	// The head sits 1 px lower unpinned than pinned, so the first row is whole, flush under it,
	// at scrollTop 1: the column's end by `SCROLL_SLACK` (geometry.ts).
	expect((await where(page)).list.top, 'the list came all the way up').toBeLessThanOrEqual(1);
});

test('← and → cross, and crossing back lands on the row left', async ({ page }) => {
	await open(page);
	await padToEdit(page);
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	const left = await row(page);
	expect((await where(page)).col).toBe('list');

	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => row(page), 'back to the row left in the panel').toContain('EDIT');
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => row(page), 'and back to the row left in the list').toBe(left);
});

test('← then ← again at a panel row with nothing left of it keeps the way back', async ({
	page
}) => {
	await open(page);
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => row(page)).toContain('START');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	const left = await row(page);
	expect((await where(page)).col).toBe('list');

	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => row(page)).toContain('START');
	await page.keyboard.press('ArrowLeft');
	expect(await where(page), 'the second ← has nowhere to go').toMatchObject({ col: 'panel' });
	await expect.poll(() => row(page)).toContain('START');
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => row(page), 'still the row left').toBe(left);
});

test('a row that is gone is forgotten: the way back takes the nearest', async ({ page }) => {
	await open(page);
	await padToEdit(page);
	await page.keyboard.press('ArrowRight');
	for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
	const left = await row(page);
	await page.keyboard.press('ArrowLeft');
	// The chapters' `invalidate` is what really replaces a row; the element is what the layer holds.
	await page.evaluate((text) => {
		for (const el of document.querySelectorAll<HTMLElement>('.list-col .entry-btn'))
			if (el.innerText.trim().replace(/\s+/g, ' ') === text) el.remove();
	}, left);
	await page.keyboard.press('ArrowRight');
	const now = await where(page);
	expect(now.col, 'the pad still lands in the list').toBe('list');
	expect(now.text, 'on a row that exists').not.toBe(left);
});

test('a row in a closed fold is forgotten', async ({ page }) => {
	await open(page);
	await padToEdit(page);
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => row(page)).toContain('DETAILS');
	await page.keyboard.press('Enter');
	await expect(page.locator('[data-row="details"]')).toHaveAttribute('aria-expanded', 'true');
	await page.keyboard.press('ArrowDown');
	const inFold = await page.evaluate(
		() => !!document.activeElement?.closest('.details') && document.activeElement?.tagName
	);
	expect(inFold, 'the pad is on a row inside the fold').toBeTruthy();
	// A row of the fold can hold two controls; the row left is the last one → stopped on.
	let left = await row(page);
	for (let i = 0; i < 4 && (await where(page)).col !== 'list'; i++) {
		left = await row(page);
		await page.keyboard.press('ArrowRight');
	}
	expect((await where(page)).col, '→ crossed out of the fold').toBe('list');
	// The pad cannot close it from here; a finger or a script can, which is why it is checked.
	await page.evaluate(() => document.querySelector<HTMLElement>('[data-row="details"]')?.click());
	await expect(page.locator('[data-row="details"]')).toHaveAttribute('aria-expanded', 'false');
	await page.keyboard.press('ArrowLeft');
	const now = await where(page);
	expect(now.col).toBe('panel');
	expect(now.text, 'not the row inside the closed fold').not.toBe(left);
});

test('a sheet owns ↑ ↓ over a section, and leaves the memory alone', async ({ page }) => {
	await open(page);
	await padToEdit(page);
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowDown');
	const left = await row(page);
	expect((await where(page)).col).toBe('list');
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => row(page)).toContain('EDIT');

	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog').last();
	await expect(sheet).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
		.toBe(true);
	const first = await row(page);
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	expect(
		await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
		'↓ stayed in the sheet'
	).toBe(true);
	expect(await row(page), 'and moved inside it').not.toBe(first);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect.poll(() => row(page), 'the sheet gave focus back').toContain('EDIT');
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => row(page), 'the row left is still remembered').toBe(left);
});

test('a sheet inside the column keeps its keys, and the column behind it stays', async ({
	page
}) => {
	await open(page, world.worked);
	await addProse(page);
	for (let i = 0; i < 12; i++) {
		await page.keyboard.press('ArrowDown');
		if ((await row(page))?.includes('A Work')) break;
	}
	expect(await row(page), 'the pad is on the WORK row').toContain('A Work');
	// Scrolled, so a sheet's first row, high on the screen, could pull the column back with it.
	await page.evaluate(() => {
		(document.querySelector('.panel-col') as HTMLElement).scrollTop = 120;
	});
	await page.keyboard.press('ContextMenu');
	const sheet = page.locator('.panel-col [role="dialog"]');
	await expect(sheet, 'the sheet is drawn inside the column').toBeVisible();
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
		.toBe(true);
	expect((await where(page)).panel.top, 'opening the sheet left the column').toBe(120);
	for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
	const atEnd = await where(page);
	expect(atEnd.panel.top, 'and so did walking it').toBe(120);

	// A longer sheet, scrolled so ↑ lands on a row above the column's own top edge: the
	// column's clip means nothing to a `position: fixed` box drawn inside it.
	await page.evaluate(() => {
		const d = document.querySelector('.panel-col [role="dialog"]') as HTMLElement;
		d.append(Object.assign(document.createElement('div'), { style: 'height:900px;flex:none' }));
	});
	for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowDown');
	const landed = await page.evaluate(() => {
		const d = document.querySelector('.panel-col [role="dialog"]') as HTMLElement;
		d.scrollTop += (document.activeElement as HTMLElement).getBoundingClientRect().top - 100;
		const stops = [...d.querySelectorAll<HTMLElement>('a, button')];
		return { above: Math.min(...stops.map((e) => Math.round(e.getBoundingClientRect().top))) };
	});
	expect(landed.above, 'the row above is over the column’s top').toBeLessThan(84);
	await page.keyboard.press('ArrowUp');
	expect((await where(page)).panel.top, 'a row high in the sheet left the column').toBe(120);
	for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	const after = await where(page);
	expect(
		await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
		'↓ at the sheet’s end stayed in it'
	).toBe(true);
	expect(after.panel.top, 'the column behind the sheet did not scroll').toBe(atEnd.panel.top);
	expect(atEnd.panel.scroll, 'the column could have scrolled').toBeGreaterThan(
		atEnd.panel.top + atEnd.panel.client
	);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
});

test('a reload, and the next series, start with no row remembered', async ({ page }) => {
	await open(page);
	await padToEdit(page);
	await page.keyboard.press('ArrowRight');
	const nearest = await row(page);
	for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
	const deep = await row(page);
	expect(deep, 'the row left is not the nearest one').not.toBe(nearest);
	await page.keyboard.press('ArrowLeft');
	await page.reload();
	await expect(page.locator('.list-col .entry').first()).toBeVisible();
	await padToEdit(page);
	await page.keyboard.press('ArrowRight');
	expect(await row(page), 'a reload forgot it').not.toBe(deep);

	// The next series, on the same route: Svelte keeps the same elements.
	for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowLeft');
	const other = `${world.base}/series/${world.other}`;
	await page.evaluate((href) => {
		const a = Object.assign(document.createElement('a'), { href });
		document.body.append(a);
		a.click();
	}, other);
	await page.waitForURL(other);
	await expect(page.getByRole('heading', { name: 'Two Others' })).toBeVisible();
	await page.waitForLoadState('networkidle');
	// The column keeps its scroll across the route, so a stale row is what shows: put it at the top.
	await page.evaluate(() => {
		(document.querySelector('.list-col') as HTMLElement).scrollTop = 0;
	});
	await page.locator('.panel-col a, .panel-col button').first().focus();
	await padToEdit(page);
	await page.keyboard.press('ArrowRight');
	const landed = await page.evaluate(() => {
		const rows = [...document.querySelectorAll('.list-col .entry-btn')];
		return rows.indexOf(document.activeElement as Element);
	});
	expect(landed, 'the nearest row of the new list, not the old row’s place').toBeLessThan(10);
});

/** Scrolls `scroller` so `target`'s top sits at `at`, in the viewport's terms. */
const placeAt = (page: Page, scroller: string, target: string, text: string, at: number) =>
	page.evaluate(
		({ scroller, target, text, at }) => {
			const box = document.querySelector(scroller) as HTMLElement;
			const el = [...document.querySelectorAll<HTMLElement>(target)].find((e) =>
				e.innerText.trim().replace(/\s+/g, ' ').startsWith(text)
			) as HTMLElement;
			box.scrollTop += el.getBoundingClientRect().top - at;
			const r = el.getBoundingClientRect();
			const c = box.getBoundingClientRect();
			return { top: Math.round(r.top), bottom: Math.round(r.bottom), columnTop: c.top };
		},
		{ scroller, target, text, at }
	);

for (const [name, offset] of [
	['clipped by the column, on the viewport behind the bar', -20],
	['scrolled off the screen above', -700],
	['scrolled off the screen below', 900]
] as const) {
	test(`crossing back to a list row ${name} brings it whole on screen`, async ({ page }) => {
		await open(page);
		await padToEdit(page);
		await page.keyboard.press('ArrowRight');
		for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
		const left = await row(page);
		expect(left).toMatch(/^\d+ Chapter /);
		await page.keyboard.press('ArrowLeft');
		await expect.poll(() => row(page)).toContain('EDIT');

		const columnTop = await page.evaluate(
			() => (document.querySelector('.list-col') as HTMLElement).getBoundingClientRect().top
		);
		const placed = await placeAt(
			page,
			'.list-col',
			'.entry-btn',
			left as string,
			columnTop + offset
		);
		expect(placed.top, 'the row really is where the case says').toBeCloseTo(columnTop + offset, 0);

		await page.keyboard.press('ArrowRight');
		await expect.poll(() => row(page), 'back to the row left').toBe(left);
		const shown = await seen(page);
		expect(shown, 'the row left is drawn whole').toMatchObject({ whole: true });
	});
}

test('crossing back to a panel row the column clips brings it whole on screen', async ({
	page
}) => {
	await open(page);
	await addProse(page);
	await padToEdit(page);
	await page.keyboard.press('ArrowRight');
	expect((await where(page)).col).toBe('list');

	const columnTop = await page.evaluate(
		() => (document.querySelector('.panel-col') as HTMLElement).getBoundingClientRect().top
	);
	// Nothing is pinned in this column, so only the column's own clip hides the row.
	const placed = await placeAt(
		page,
		'.panel-col',
		'.panel-col a, .panel-col button',
		'EDIT',
		columnTop - 12
	);
	expect(placed.top, 'clipped at the column, not off the screen').toBeGreaterThan(0);
	expect(placed.top).toBeLessThan(columnTop);

	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => row(page), 'back to the row left').toContain('EDIT');
	expect(await seen(page), 'the row left is drawn whole').toMatchObject({ whole: true });
});

test('a sheet is a scroller too: ↑ inside it keeps the row drawn, and the page stays', async ({
	page
}) => {
	await open(page);
	await padToEdit(page);
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog').last();
	await expect(sheet).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
		.toBe(true);
	const metrics = () =>
		page.evaluate(() => {
			const s = document.querySelector('[role="dialog"]') as HTMLElement;
			return {
				sheet: Math.round(s.scrollTop),
				room: s.scrollHeight - s.clientHeight,
				y: Math.round(window.scrollY),
				panel: Math.round((document.querySelector('.panel-col') as HTMLElement).scrollTop)
			};
		});
	for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
	const deep = await metrics();
	expect(deep.room, 'the sheet has somewhere to scroll').toBeGreaterThan(0);
	expect(deep.sheet, 'and it scrolled').toBeGreaterThan(0);

	const hidden: string[] = [];
	for (let i = 0; i < 30; i++) {
		await page.keyboard.press('ArrowUp');
		const shown = await seen(page);
		if (!shown.whole) hidden.push(`${shown.text} at ${shown.top}-${shown.bottom}`);
	}
	expect(hidden, 'every row ↑ lands on is drawn whole').toEqual([]);
	const after = await metrics();
	expect(after.sheet, 'the sheet came back up').toBeLessThan(deep.sheet);
	expect({ y: after.y, panel: after.panel }, 'nothing behind the sheet moved').toEqual({
		y: 0,
		panel: 0
	});
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
});

test('a row the column clips at its bottom, with no bar over it, is brought whole on screen', async ({
	page
}) => {
	await open(page);
	await padToEdit(page);
	await page.keyboard.press('ArrowRight');
	for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown');
	const left = await row(page);
	expect(left).toMatch(/^\d+ Chapter /);
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => row(page)).toContain('EDIT');

	// A band's height is what shortens the column: below it, nothing is pinned to find.
	await page.evaluate(() =>
		(document.querySelector('.series') as HTMLElement).style.setProperty('--banner-h', '80px')
	);
	const bottom = await page.evaluate(
		() => (document.querySelector('.list-col') as HTMLElement).getBoundingClientRect().bottom
	);
	expect(bottom, 'the column ends above the screen’s edge').toBeLessThan(500);
	const placed = await placeAt(page, '.list-col', '.entry-btn', left as string, bottom - 20);
	expect(placed.bottom, 'the column clips the row, on the viewport').toBeGreaterThan(bottom);
	expect(placed.bottom).toBeLessThan(540);

	await page.keyboard.press('ArrowRight');
	await expect.poll(() => row(page), 'back to the row left').toBe(left);
	const shown = await seen(page);
	expect(shown, 'the row left is drawn whole').toMatchObject({ whole: true });
	expect(shown.bottom, 'above the column’s end').toBeLessThanOrEqual(bottom);
});

/** From the screen's start into SELECT by its own button, with a row picked by OK. */
async function selectOneRow(page: Page) {
	await open(page);
	await padToEdit(page);
	await page.keyboard.press('ArrowRight');
	// ↑ along the rows to the list's head, then → along its tools.
	for (let i = 0; i < 12 && /^\d+ Chapter /.test((await row(page)) ?? ''); i++)
		await page.keyboard.press('ArrowUp');
	for (let i = 0; i < 4 && (await row(page)) !== 'SELECT'; i++)
		await page.keyboard.press('ArrowRight');
	expect(await row(page), 'the pad is on SELECT').toBe('SELECT');
	await page.keyboard.press('Enter');
	await expect(page.locator('.series.selecting')).toBeVisible();
	await expect(page.locator('.panel-col')).toHaveCount(0);
	for (let i = 0; i < 6; i++) {
		if (await page.evaluate(() => !!document.activeElement?.closest('.entry-btn'))) break;
		await page.keyboard.press('ArrowDown');
	}
	expect(await row(page), 'the pad is on a row').toMatch(/^\d+ Chapter /);
	await page.keyboard.press('Enter');
	await expect(page.getByText('1 SELECTED')).toBeVisible();
}

const inBulk = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('.bulk'));

test('in SELECT ↓ alone reaches the bulk bar, past the last row, and ↑ comes back', async ({
	page
}) => {
	await selectOneRow(page);
	const hidden: string[] = [];
	let reached = false;
	let lastRow = '';
	for (let i = 0; i < 75; i++) {
		await page.keyboard.press('ArrowDown');
		if (await inBulk(page)) {
			reached = true;
			break;
		}
		const shown = await seen(page);
		lastRow = shown.text;
		if (!shown.whole) hidden.push(`${shown.text} at ${shown.top}-${shown.bottom}`);
	}
	expect(reached, '↓ reached the bar').toBe(true);
	expect(await row(page), 'on the first action the selection can take').toContain('MARK READ');
	expect(lastRow, 'it passed the last row').toContain('Chapter 60');
	// On a TV the bar is 385 px at the right (`--sheet-left: auto`), so a row's middle stays drawn.
	expect(hidden, 'every row’s middle stayed drawn on the way').toEqual([]);
	await expect(page.locator('.list-col'), 'one column is not two sections').not.toHaveAttribute(
		'data-focus-section'
	);

	await page.keyboard.press('ArrowUp');
	expect(await inBulk(page), '↑ leaves the bar').toBe(false);
	expect(await row(page), 'for the last row').toContain('Chapter 60');
});

test('when SELECT ends the columns are two sections again', async ({ page }) => {
	await selectOneRow(page);
	// ✕ is SELECT's way out: nothing on this screen's BACK ends it.
	await page.getByRole('button', { name: 'Stop selecting' }).focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('.series.selecting')).toHaveCount(0);
	await expect(page.locator('.panel-col')).toHaveAttribute('data-focus-section', 'details');
	await expect(page.locator('.list-col')).toHaveAttribute('data-focus-section', 'list');

	await page.locator('.panel-col a, .panel-col button').first().focus();
	await padToEdit(page);
	await page.keyboard.press('ArrowRight');
	expect((await where(page)).col, '→ crossed into the list').toBe('list');
	for (let i = 0; i < 80; i++) await page.keyboard.press('ArrowDown');
	const end = await where(page);
	expect(end.text).toContain('Chapter 60');
	expect(end.list.top, 'the list scrolled to reach it').toBeGreaterThan(0);
	await page.keyboard.press('ArrowDown');
	expect(await where(page), 'at the end of the list ↓ does nothing again').toEqual(end);
	await page.keyboard.press('ArrowUp');
	expect((await where(page)).text, '↑ still walks the list').toContain('Chapter 59');
});

test('a book’s page grid is one column: no section, and ↓ walks it to its end', async ({
	page
}) => {
	await page.goto(`${world.base}/series/${world.pages}?book=${world.book}`);
	await expect(page.locator('.page .open').first()).toBeVisible();
	await expect(page.locator('.panel-col')).toHaveCount(0);
	await expect(page.locator('.list-col')).not.toHaveAttribute('data-focus-section');

	await page.keyboard.press('ArrowDown');
	const hidden: string[] = [];
	const cells: number[] = [];
	const cell = () =>
		page.evaluate(() =>
			Number(document.activeElement?.closest('[data-cell]')?.getAttribute('data-cell') ?? -1)
		);
	for (let i = 0; i < 60; i++) {
		await page.keyboard.press('ArrowDown');
		const at = await cell();
		if (at === -1) continue;
		cells.push(at);
		const shown = await page.evaluate(() => {
			const el = document.activeElement as HTMLElement;
			const r = el.getBoundingClientRect();
			const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			return { whole: !!hit && el.contains(hit), top: Math.round(r.top) };
		});
		if (!shown.whole) hidden.push(`cell ${at} at ${shown.top}`);
	}
	expect(Math.max(...cells), '↓ alone reached the last row of pages').toBeGreaterThanOrEqual(190);
	expect(hidden, 'every page ↓ lands on is drawn').toEqual([]);
	await page.keyboard.press('ArrowRight');
	expect(await cell(), 'the grid still takes →').toBeGreaterThan(0);
});

test('off a TV the columns are not sections: ↓ runs on into the list', async ({ page }) => {
	await page.setViewportSize({ width: 800, height: 540 });
	await open(page);
	const seen: string[] = [];
	for (let i = 0; i < 12; i++) {
		await page.keyboard.press('ArrowDown');
		seen.push((await where(page)).col);
	}
	expect(seen, 'the stacked panel hands ↓ on to the list').toContain('list');
});

/**
 * A failed save's band (`SaveBand`, from the layout on every screen) is pinned
 * over the columns' bottom edge while both are drawn. It is what FAV's refused
 * POST really raises: the panel's own save, aborted as series-flow's two failed saves are.
 */
const lostFav = (u: URL) => /^\/series\/\d+$/.test(u.pathname) && u.search === '?/favourite';
const inBand = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('.stack'));
const favOf = (page: Page) =>
	page.getByRole('region', { name: 'About this series' }).getByRole('button', {
		name: /^FAV( ✓)?$/
	});

/** FAV, by the remote, with its POST refused: the band is up and the pad on FAV. */
async function failFav(page: Page) {
	await page.route(lostFav, (route) => route.abort());
	await favOf(page).focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('.stack .band')).toBeVisible();
}

/** ↓ until the pad is in the band, or `presses` have gone by; the rows it passed. */
async function downToBand(page: Page, presses = 12) {
	const rows: string[] = [];
	for (let i = 0; i < presses; i++) {
		await page.keyboard.press('ArrowDown');
		if (await inBand(page)) return { reached: true, rows };
		rows.push((await where(page)).text);
	}
	return { reached: false, rows };
}

test('a failed save’s band is reached from the end of a short list, and ↑ comes back', async ({
	page
}) => {
	await open(page, world.short);
	await failFav(page);
	await page.keyboard.press('ArrowRight');
	expect((await where(page)).col, '→ crossed into the list').toBe('list');

	const walk = await downToBand(page);
	expect(walk.reached, `↓ alone reached the band, past ${walk.rows.join(' | ')}`).toBe(true);
	expect(walk.rows.at(-1), 'after the last row').toContain('Chapter 3');
	expect(await row(page), 'on its first button').toMatch(/^PUT BACK/);
	await page.keyboard.press('ArrowUp');
	expect(await inBand(page), '↑ leaves the band').toBe(false);
	expect(await row(page), 'for the row it came from').toContain('Chapter 3');
});

/** The pad on the short list's last row, with the band still up. */
async function padToLastRow(page: Page) {
	await page.keyboard.press('ArrowRight');
	for (let i = 0; i < 12; i++) {
		if ((await row(page))?.includes('Chapter 3')) return;
		await page.keyboard.press('ArrowDown');
	}
	throw new Error(`never reached the last row: ${await row(page)}`);
}

test('with the band gone, ↓ at that list’s end does nothing', async ({ page }) => {
	await open(page, world.short);
	await failFav(page);
	await page.keyboard.press('ArrowRight');
	expect((await downToBand(page)).reached, 'the band took ↓ while it was up').toBe(true);
	await page.keyboard.press('ArrowUp');
	expect(await row(page)).toContain('Chapter 3');

	await page.unroute(lostFav);
	// The band's own handler, by script: a click would take focus off the row this is about.
	await page.locator('.stack .retry').evaluate((b: HTMLElement) => b.click());
	await expect(page.locator('.stack .band')).toHaveCount(0);
	const before = await where(page);
	expect(before.text, 'the pad never left the last row').toContain('Chapter 3');

	await page.keyboard.press('ArrowDown');
	expect(await where(page), 'nothing below it now, and the panel takes nothing').toEqual(before);
	await page.keyboard.press('ArrowUp');
	expect(await row(page), 'and the keys still work: ↑ walks the list').toContain('Chapter 2');
	await page.keyboard.press('ArrowDown');
	expect(await row(page), 'as ↓ does, up to that end').toContain('Chapter 3');
});

test('a list that ends exactly at the band reaches it; one that runs under it does not', async ({
	page
}) => {
	await open(page, world.short);
	await failFav(page);
	await padToLastRow(page);
	// Rows are the height they are, so the first row's margin puts the list's end on the band's
	// top, measured with the column at its real end (it has 2 px to scroll even at three rows).
	const place = (past: number) =>
		page.evaluate((past) => {
			const first = document.querySelector('.list-col .entry') as HTMLElement;
			const list = document.querySelector('.list-col') as HTMLElement;
			const gap = () =>
				document.querySelector('.stack .put')!.getBoundingClientRect().top -
				document.activeElement!.getBoundingClientRect().bottom;
			const toEnd = () => list.scrollTo(0, list.scrollHeight);
			first.style.marginTop = '0px';
			toEnd();
			first.style.marginTop = `${gap() + past}px`;
			toEnd();
			return gap();
		}, past);

	expect(Math.abs(await place(0)), 'the last row ends on the band’s top').toBeLessThan(0.25);
	await page.keyboard.press('ArrowDown');
	expect(await inBand(page), 'touching counts as below').toBe(true);
	await page.keyboard.press('ArrowUp');
	expect(await row(page)).toContain('Chapter 3');

	expect(await place(8), 'the band covers the row’s last 8 px').toBeCloseTo(-8, 0);
	const before = await where(page);
	await page.keyboard.press('ArrowDown');
	expect(await where(page), 'a row the band covers has nothing below it').toEqual(before);
	expect(await inBand(page)).toBe(false);
});

test('the band arriving while the pad is mid-column changes nothing until the list’s end', async ({
	page
}) => {
	await open(page, world.short);
	let release = () => {};
	const held = new Promise<void>((r) => (release = r));
	await page.route(lostFav, async (route) => {
		await held;
		await route.abort();
	});
	await favOf(page).focus();
	await page.keyboard.press('Enter');
	await page.keyboard.press('ArrowRight');
	// → lands on the row nearest FAV, which is not the first.
	for (let i = 0; i < 4 && !/Chapter 1$/.test((await row(page)) ?? ''); i++)
		await page.keyboard.press('ArrowUp');
	expect(await row(page), 'the pad is on the list’s first row').toMatch(/Chapter 1$/);
	await expect(page.locator('.stack .band')).toHaveCount(0);

	release();
	await expect(page.locator('.stack .band')).toBeVisible();
	expect(await row(page), 'it took nothing from the pad').toContain('Chapter 1');

	await page.keyboard.press('ArrowDown');
	expect(await row(page), 'the list’s own rows come first').toContain('Chapter 2');
	await page.keyboard.press('ArrowDown');
	expect(await row(page)).toContain('Chapter 3');
	// The column has its 2 px to scroll first, then the band.
	expect((await downToBand(page, 3)).reached, 'and then the band').toBe(true);
});

test('the band leaving under the pad does not strand it, and the columns are sections again', async ({
	page
}) => {
	await open(page, world.short);
	await failFav(page);
	await page.keyboard.press('ArrowRight');
	expect((await downToBand(page)).reached).toBe(true);
	expect(await row(page)).toMatch(/^PUT BACK/);

	await page.keyboard.press('Enter');
	await expect(page.locator('.stack .band')).toHaveCount(0);
	// What had focus is gone, as for anything removed under it: the next arrow finds the screen.
	expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
	await page.keyboard.press('ArrowDown');
	const landed = await where(page);
	expect(['panel', 'list'], `the first arrow put the pad on ${landed.text}`).toContain(landed.col);

	await page.locator('.list-col a, .list-col button').last().focus();
	const end = await where(page);
	expect(end.col).toBe('list');
	await page.keyboard.press('ArrowDown');
	expect(await where(page), 'nothing below the list’s end again').toEqual(end);
});

test('a long list keeps ↓ with a band up, and at its end stays on its last row', async ({
	page
}) => {
	await open(page);
	await failFav(page);
	await page.keyboard.press('ArrowRight');
	const columns: string[] = [];
	for (let i = 0; i < 80; i++) {
		await page.keyboard.press('ArrowDown');
		columns.push((await where(page)).col);
	}
	expect(new Set(columns), '↓ stayed in the list').toEqual(new Set(['list']));
	const end = await where(page);
	expect(end.text).toContain('Chapter 60');
	expect(end.list.top, 'the list scrolled to reach it').toBeGreaterThan(0);
	await expect(page.locator('.stack .band')).toBeVisible();
	// The last row sits under the band at the column's real end: not above it, so not "that way".
	await page.keyboard.press('ArrowDown');
	expect(await where(page), 'it stays, and falls into nothing').toEqual(end);
});

test('the band covers the details column’s last stop: ↓ there takes nothing, and never the list', async ({
	page
}) => {
	await open(page, world.short);
	await failFav(page);
	const columns: string[] = [];
	for (let i = 0; i < 12; i++) {
		await page.keyboard.press('ArrowDown');
		columns.push((await where(page)).col);
	}
	expect(new Set(columns), 'through the panel alone, never the list').toEqual(new Set(['panel']));
	const end = await where(page);
	expect(end.text, 'on the column’s last stop').toContain('DETAILS');
	expect(end.panel.top, 'having read the column first').toBeGreaterThan(0);
	expect(end.panel.top + end.panel.client).toBeGreaterThanOrEqual(end.panel.scroll - 1);
	const covered = await page.evaluate(
		() =>
			document.activeElement!.getBoundingClientRect().bottom >
			document.querySelector('.stack .put')!.getBoundingClientRect().top
	);
	expect(covered, 'the band covers its end: that is why nothing lies below it').toBe(true);
	await page.keyboard.press('ArrowDown');
	expect(await where(page), 'a covered stop has nothing below it').toEqual(end);
	expect(await inBand(page)).toBe(false);
});

for (const [rows, reached] of [
	[6, true],
	[7, false]
] as const)
	test(`a list of ${rows} rows ${reached ? 'ends above the band and reaches it' : 'runs under the band, so ↓ stays on its last row'}`, async ({
		page
	}) => {
		await open(page, reached ? world.six : world.seven);
		await failFav(page);
		await page.keyboard.press('ArrowRight');
		const walk = await downToBand(page);
		expect(walk.reached, walk.rows.join(' | ')).toBe(reached);
		if (reached) expect(await row(page)).toMatch(/^PUT BACK/);
		else expect(await row(page), 'the last row kept the pad').toContain(`Chapter ${rows}`);
	});

test('two failed saves: ↓ reaches the upper band first, then the lower', async ({ page }) => {
	await open(page, world.short);
	const lostRate = (u: URL) => /^\/series\/\d+$/.test(u.pathname) && u.search === '?/rate';
	await page.route(lostRate, (route) => route.abort());
	await failFav(page);
	await page
		.getByRole('region', { name: 'About this series' })
		.getByRole('button', { name: 'Rate 3 of 10' })
		.focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('.stack .band')).toHaveCount(2);
	// → from a rating walks the rating's own cells, so the pad crosses from FAV.
	await favOf(page).focus();
	await page.keyboard.press('ArrowRight');
	expect((await where(page)).col, '→ crossed into the list').toBe('list');
	expect((await downToBand(page)).reached).toBe(true);
	const band = () =>
		page.evaluate(() => {
			const a = document.activeElement as HTMLElement;
			return [...document.querySelectorAll('.stack .band')].indexOf(a.closest('.band')!);
		});
	expect(await band(), 'the upper one').toBe(0);
	expect(await row(page)).toMatch(/^PUT BACK/);
	await page.keyboard.press('ArrowDown');
	expect(await band(), 'then the lower one').toBe(1);
	expect(await row(page)).toMatch(/^PUT BACK/);
});
