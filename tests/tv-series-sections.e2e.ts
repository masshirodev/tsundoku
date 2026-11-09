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
 * The series screen's two columns as two sections, with the remote (card c861;
 * doc/FOCUS.md, "Sections"), at 960×540 with no pointer: ↑ ↓ stay in the column
 * they started in, scroll it to its real end and then stop, only ← → cross, and
 * crossing back lands on the row left. On a seeded database of its own, with
 * a 60-chapter series no other spec opens, so a long list and a long column
 * cannot be anyone else's state.
 */

let world: { base: string; id: number; other: number; worked: number; stop: () => Promise<void> };

function seed(dbPath: string): { id: number; other: number; worked: number } {
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
		const series = (title: string) =>
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, in_library, description, status)
						VALUES (?, ?, 'manga', 'local', 210, ?, ?, 1, ?, 'ONGOING')`
					)
					.run(root, title, now, now, description).lastInsertRowid
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
		return { id, other, worked };
	} finally {
		db.close();
	}
}

async function start() {
	const work = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-tv-series-sections-'));
	const dbPath = join(work, 'library.sqlite');
	const { id, other, worked } = seed(dbPath);
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
 * labels is on the owner's series. Nothing here can land on it, so only a
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
	const seen: string[] = [];
	let last = await where(page);
	for (let i = 0; i < 60; i++) {
		await page.keyboard.press('ArrowDown');
		last = await where(page);
		seen.push(last.col);
		if (last.panel.top + last.panel.client >= last.panel.scroll - 1) break;
	}
	expect(new Set(seen), 'the column keeps ↓').toEqual(new Set(['panel']));
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

	const seen: string[] = [];
	for (let i = 0; i < 100; i++) {
		await page.keyboard.press('ArrowUp');
		const w = await where(page);
		seen.push(w.col);
		if (w.col === 'bar') break;
	}
	const stops = new Set(seen);
	expect(stops.has('list'), 'the list took no ↑').toBe(false);
	expect(seen.at(-1), '↑ at the real top reaches the bar').toBe('bar');
	expect((await where(page)).panel.top, 'the column came all the way up').toBe(0);
});

test('a long chapter list keeps ↓ to its last row and ↑ back up to its first', async ({ page }) => {
	await open(page);
	await padToEdit(page);
	await page.keyboard.press('ArrowRight');
	expect((await where(page)).col, '→ crossed into the list').toBe('list');

	const seen: string[] = [];
	for (let i = 0; i < 80; i++) {
		await page.keyboard.press('ArrowDown');
		seen.push((await where(page)).col);
	}
	expect(new Set(seen), '↓ stayed in the list to its end').toEqual(new Set(['list']));
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
	for (let i = 0; i < 90; i++) {
		await page.keyboard.press('ArrowUp');
		const w = await where(page);
		up.push(w.col);
		if (w.col === 'bar') break;
	}
	expect(new Set(up).has('panel'), 'the panel took no ↑').toBe(false);
	expect(up.at(-1), '↑ at the very top reaches the bar').toBe('bar');
	expect((await where(page)).list.top, 'the list came all the way up').toBe(0);
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
	await page.keyboard.press('ContextMenu');
	const sheet = page.locator('.panel-col [role="dialog"]');
	await expect(sheet, 'the sheet is drawn inside the column').toBeVisible();
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
		.toBe(true);
	for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
	const atEnd = await where(page);
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
