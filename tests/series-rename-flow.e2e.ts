import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';
import { DETAILS_FOLDS } from './helpers/details-folds';

/**
 * RENAME on the series screen's FILE row (doc/SERIES.md, "RENAME"), on
 * a real case: a novel grouped from thirteen EPUBs, whose FILE row
 * read `13 EPUB · 6.8 MB` a word a line beside UNGROUP, HIDE and DELETE, and
 * whose name could not be changed. The row is measured at 390 and at the
 * 440 panel, then the series is renamed, reloaded, UNDOne, refused an empty
 * name, and refused an UNDO a second tab's rename has overtaken. A rename
 * writes the database, so the file runs once (a `-flow`, tablet-portrait), on
 * a seeded database of its own, against its own preview on a port the OS
 * hands out. The grouped series is written as rows, the shape the GROUP
 * sheet leaves (books-flow walks that sheet); the scan, REFRESH and import
 * keeping a renamed name are tests/series-rename-db.spec.ts'.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = 'Lantern Keeper';
const work = mkdtempSync(
	join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-rename-')
);
const dbPath = join(work, 'rename.sqlite');
let preview: ChildProcess | null = null;
let BASE = '';
let id = 0;

function freePort(): Promise<number> {
	return new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});
}

/** The sample library, then a novel of thirteen volumes, as GROUP leaves one. */
function seed(): number {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			LIBRARY_ROOT: join(work, 'library'),
			NODE_NO_WARNINGS: '1'
		},
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const now = Date.UTC(2026, 10, 4, 12, 0);
		const series = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, in_library, cover_key, path)
					VALUES (?, ?, 'novel', 'epub', 40, ?, ?, 1, '', 'Light novels')`
				)
				.run(root, TITLE, now, now).lastInsertRowid
		);
		const put = db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, file, bytes, page_count, available, locator, volume)
			VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
		);
		let position = 0;
		for (let v = 1; v <= 13; v++)
			for (let c = 1; c <= 2; c++) {
				position += 1;
				// Two chapters a volume, 6.8 MB in all, as the real case read.
				put.run(
					series,
					position,
					`Chapter ${position}`,
					now,
					`Lantern Keeper Vol ${v}.epub`,
					c === 1 ? 523_000 : 0,
					`OEBPS/ch${c}.xhtml`,
					`Volume ${v}`
				);
			}
		return series;
	} finally {
		db.close();
	}
}

id = seed();

test.beforeAll(async () => {
	// The hook seeds thirteen volumes and waits up to 60 s for its own preview:
	// 2.0 s alone at this commit, past the default 30 s once the box is loaded
	//. In a hook, test.setTimeout sets the hook's own budget
	// (Playwright's test.d.ts, "Changing timeout for a beforeAll").
	test.setTimeout(120_000);
	const port = await freePort();
	BASE = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			LIBRARY_ROOT: join(work, 'library'),
			COVER_DIR: join(work, 'covers'),
			TSUNDOKU_HOME: join(work, 'home'),
			BACKUP_DIR: join(work, 'backups'),
			TSUNDOKU_ANILIST: 'off'
		},
		stdio: 'ignore'
	});
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(BASE, { redirect: 'manual' })).status) return;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw new Error('the rename preview never answered');
});

test.afterAll(() => {
	preview?.kill();
	rmSync(work, { recursive: true, force: true });
});

/**
 * DETAILS folds FILE on a phone and a TV: open it the way the user
 * does, by its line, and wait for the answer, which comes once the page runs.
 */
async function openDetails(page: Page) {
	const line = page.locator('[data-row="details"]');
	// Whether DETAILS folds rows here is SeriesPanel.svelte's media query (a
	// phone's width, or a TV), known before the panel draws; the query lives
	// once, in tests/helpers/details-folds.ts. Read once with `isVisible()`, a
	// line not drawn yet reads as "no fold", and FILE stays folded away
	// (series-layout's copy: 2 runs of 20 on a loaded phone and TV).
	const folds = await page.evaluate((query) => matchMedia(query).matches, DETAILS_FOLDS);
	if (!folds) return;
	await expect(line).toBeVisible();
	await expect(async () => {
		if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
		await expect(line).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
	}).toPass();
}

const fileRow = (page: Page) => page.locator('.file-row');
const heading = (page: Page) => page.locator('.panel h1');

async function rename(page: Page, name: string) {
	await fileRow(page).getByRole('button', { name: 'RENAME' }).click();
	const field = page.getByLabel("The series' name");
	await expect(field).toBeFocused();
	await field.fill(name);
	await page.locator('[data-row="rename"]').getByRole('button', { name: 'DONE' }).click();
}

for (const at of [
	{ width: 390, height: 844, row: 390 },
	{ width: 1280, height: 800, row: 440 }
]) {
	test(`the thirteen volumes' FILE row keeps its text whole at ${at.row} px`, async ({ page }) => {
		await page.setViewportSize({ width: at.width, height: at.height });
		await page.goto(`${BASE}/series/${id}`);
		await openDetails(page);
		const row = fileRow(page);
		await expect(row.locator('.file-meta')).toHaveText('13 EPUB · 6.8 MB');
		await row.scrollIntoViewIfNeeded();
		const box = (await row.boundingBox())!;
		const text = (await row.locator('.file').boundingBox())!;
		const cells = await row
			.locator('.cells .edit')
			.evaluateAll((ns) => ns.map((n) => [n.textContent?.trim(), n.getBoundingClientRect().width]));
		expect(cells.map((c) => c[0])).toEqual(['RENAME', 'UNGROUP', 'HIDE', 'DELETE']);
		expect(box.width).toBeGreaterThanOrEqual(at.row - 1);
		expect(box.width).toBeLessThanOrEqual(at.row);
		// Wider than its cells, and one line, not a word a line.
		expect(text.width).toBeGreaterThan(Math.max(...cells.map((c) => Number(c[1]))));
		const lines = await row
			.locator('.file-meta')
			.evaluate((n) => n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).fontSize));
		expect(lines).toBeLessThan(1.8);
	});
}

test('RENAME names the series in place, says so with UNDO, and UNDO puts the old name back', async ({
	page
}) => {
	await page.goto(`${BASE}/series/${id}`);
	await expect(heading(page)).toHaveText(TITLE);
	// CANCEL leaves it as it was.
	await fileRow(page).getByRole('button', { name: 'RENAME' }).click();
	await page.getByLabel("The series' name").fill('Not This');
	await page.locator('[data-row="rename"]').getByRole('button', { name: 'CANCEL' }).click();
	await expect(page.locator('[data-row="rename"]')).toHaveCount(0);
	await expect(heading(page)).toHaveText(TITLE);

	await rename(page, '  The Lantern   Keeper Chronicles ');
	await expect(page.getByText('RENAMED · THE LANTERN KEEPER CHRONICLES')).toBeVisible();
	await expect(page.getByText(`WAS ${TITLE.toUpperCase()}`)).toBeVisible();
	// The field closes on the answer, and the screen reads the new name.
	await expect(page.locator('[data-row="rename"]')).toHaveCount(0);
	await expect(heading(page)).toHaveText('The Lantern Keeper Chronicles');

	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(heading(page)).toHaveText(TITLE);
	await expect(page.getByText(/^RENAMED · /)).toHaveCount(0);
	await page.reload();
	await expect(heading(page)).toHaveText(TITLE);
});

test('a rename holds through a reload, and the library knows it by its new name', async ({
	page
}) => {
	await page.goto(`${BASE}/series/${id}`);
	await rename(page, 'Lantern Keeper: Complete');
	await expect(heading(page)).toHaveText('Lantern Keeper: Complete');
	await page.reload();
	await expect(heading(page)).toHaveText('Lantern Keeper: Complete');
	// The band was the answer to the rename, not a state: a reload leaves it.
	await expect(page.getByText(/^RENAMED · /)).toHaveCount(0);
	await page.goto(`${BASE}/?sort=title`);
	await expect(page.locator('.grid .tile', { hasText: 'Lantern Keeper: Complete' })).toHaveCount(1);
	// Its colour was picked from the name it came with, and stays.
	const db = new Database(dbPath, { readonly: true });
	try {
		expect(db.prepare(`SELECT hue, alt_titles FROM series WHERE id = ?`).get(id)).toEqual({
			hue: 40,
			alt_titles: JSON.stringify([TITLE])
		});
	} finally {
		db.close();
	}
});

test('an empty name is refused and changes nothing', async ({ page }) => {
	await page.goto(`${BASE}/series/${id}`);
	await rename(page, '   ');
	await expect(page.getByText('A SERIES NEEDS A NAME')).toBeVisible();
	await expect(page.getByText('NOTHING CHANGED')).toBeVisible();
	await expect(heading(page)).toHaveText('Lantern Keeper: Complete');
});

test('an UNDO that a later rename has overtaken is refused, and the later name stays', async ({
	page,
	context
}) => {
	await page.goto(`${BASE}/series/${id}`);
	await rename(page, 'Lantern Keeper (2nd)');
	await expect(page.getByText('RENAMED · LANTERN KEEPER (2ND)')).toBeVisible();
	const other = await context.newPage();
	await other.goto(`${BASE}/series/${id}`);
	await rename(other, 'Lantern Keeper (3rd)');
	await expect(heading(other)).toHaveText('Lantern Keeper (3rd)');
	await other.close();

	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.getByText('RENAMED AGAIN SINCE')).toBeVisible();
	await page.reload();
	await expect(heading(page)).toHaveText('Lantern Keeper (3rd)');
});
