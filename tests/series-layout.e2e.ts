import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, screenSettled, test } from './fixtures';
import { DETAILS_FOLDS } from './helpers/details-folds';
import { E2E_TOKEN } from '../playwright.config';

/**
 * The series frame per device, from Index Series.dc.html: metadata is a header
 * above the list in portrait and a 440px panel beside it in landscape; rows
 * are 60px (52px on a phone); the rail is 56px (44px on a phone).
 */
type Frame = { side: boolean; row: number; rail: number; panel?: number; gap?: number };
const FRAMES: Record<string, Frame> = {
	'tablet-portrait': { side: false, row: 60, rail: 56 },
	'tablet-landscape': { side: true, row: 60, rail: 56 },
	phone: { side: false, row: 52, rail: 44 },
	desktop: { side: true, row: 60, rail: 56 },
	// TV-Series: a 352px column, 32px away from a list whose rows are 56 tall.
	tv: { side: true, row: 56, rail: 56, panel: 352, gap: 32 }
};

test('the series frame matches the design for this device', async ({ page }, info) => {
	const frame = FRAMES[info.project.name];
	test.skip(!frame, 'no frame drawn for this project');
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Tower of God' }).click();
	// The title shows at once from the tile (doc/WAITING.md): wait for the screen itself.
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.getByRole('heading', { name: 'Tower of God' })).toBeVisible();
	await screenSettled(page);

	const panel = (await page.locator('.panel-col').boundingBox())!;
	const list = (await page.locator('.list-col').boundingBox())!;
	if (frame.side) {
		expect(panel.width).toBe(frame.panel ?? 440);
		expect(Math.round(list.x)).toBe(Math.round(panel.x + panel.width + (frame.gap ?? 0)));
		// Each column scrolls on its own.
		expect(await page.locator('.panel-col').evaluate((n) => getComputedStyle(n).overflowY)).toBe(
			'auto'
		);
		expect(await page.locator('.list-col').evaluate((n) => getComputedStyle(n).overflowY)).toBe(
			'auto'
		);
	} else {
		expect(list.y).toBeGreaterThanOrEqual(panel.y + panel.height - 1);
	}

	const row = (await page.locator('.entry-btn').first().boundingBox())!;
	expect(row.height).toBe(frame.row);
	// The fold is a row like the others, the full width of the list. It lost
	// its shared rule once (0ae283a) and shrank to a bordered button.
	const fold = (await page.locator('.fold button').boundingBox())!;
	expect(fold.height).toBe(frame.row);
	expect(fold.width).toBeCloseTo(row.width, 0);
	const rail = (await page.locator('.rail').boundingBox())!;
	expect(rail.width).toBe(frame.rail);
});

// c488: the hover tint (motion.css) is a background-image, so it replaces a
// picture drawn by the element's own stylesheet unless the element says
// `data-picture`. The fold's stripes are that picture. A hover needs a fine
// pointer, which only the desktop project has.
test('ABOUT and TAGS stand under the DOWNLOAD row, where the fold is not in the way (c837)', async ({
	page
}, info) => {
	const tv = info.project.name === 'tv';
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Tower of God' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.getByRole('heading', { name: 'Tower of God' })).toBeVisible();
	await screenSettled(page);
	const details = page.locator('[data-row="details"]');
	const at = (label: string) =>
		page
			.locator('.panel .label:visible', { hasText: new RegExp(`^${label}`) })
			.first()
			.evaluate((n) => n.getBoundingClientRect().top + window.scrollY);
	if (await details.isVisible()) {
		// The phone's and the TV's 1A and 1C hold: ABOUT above the line, TAGS inside it.
		expect(['phone', 'tv']).toContain(info.project.name);
		expect(await at('ABOUT')).toBeLessThan(
			(await details.boundingBox())!.y + (await page.evaluate(() => window.scrollY))
		);
		await expect(page.locator('.panel .tags:visible')).toHaveCount(0);
		return;
	}
	expect(tv).toBe(false);
	const about = await at('ABOUT');
	const tags = await at('TAGS');
	expect(about).toBeLessThan(tags);
	expect(tags).toBeLessThan(await at('SHELVES'));
	expect(tags).toBeLessThan(await at('DIRECTION'));
	const download = page.locator('.panel .dl-row:visible');
	if (await download.isVisible()) expect((await download.boundingBox())!.y).toBeLessThan(about);
});

test('hovering the fold keeps its stripes (c488)', async ({ page }, info) => {
	test.skip(info.project.name !== 'desktop', 'a hover needs a fine pointer');
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Tower of God' }).click();
	await page.waitForURL(/\/series\/\d+/);
	const fold = page.locator('.fold button');
	await expect(fold).toBeVisible();
	const image = () => fold.evaluate((n) => getComputedStyle(n).backgroundImage);
	expect(await image()).toMatch(/^repeating-linear-gradient/);
	await fold.hover();
	// Under the pointer, and still the stripes, not the flat 9% tint.
	expect(await fold.evaluate((n) => n.matches(':hover'))).toBe(true);
	expect(await image()).toMatch(/^repeating-linear-gradient/);
});

/**
 * DETAILS (c425) folds FILE on a phone and a TV: open it the way the owner
 * does, by its line, and wait for the answer, which comes once the page runs.
 */
async function openDetails(page: import('@playwright/test').Page) {
	const line = page.locator('[data-row="details"]');
	// Whether DETAILS folds rows here is SeriesPanel.svelte's media query (a
	// phone's width, or a TV), known before the panel draws; the query lives
	// once, in tests/helpers/details-folds.ts, so it cannot drift from the
	// app's. Read once with `isVisible()`, a line not drawn yet read as "no
	// fold" on a loaded phone and TV, and LAYOUT stayed folded away (c439,
	// wave 24: 2 of 20).
	const folds = await page.evaluate((query) => matchMedia(query).matches, DETAILS_FOLDS);
	if (!folds) return;
	await expect(line).toBeVisible();
	await expect(async () => {
		if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
		await expect(line).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
	}).toPass();
}

/*
 * c526: FILE's row was its text at `flex: 1` beside three cells (UNGROUP,
 * HIDE, DELETE), so at the 440 panel `13 EPUB · 6.8 MB` read a word a line.
 * LISTS' rule (doc/handoffs/series-lists/): two or more cells drop under the
 * line in equal columns on the phone (390), the 440 panel and the TV's 352
 * column; the tablet in portrait has the width and keeps them inline.
 */
test('FILE keeps its text whole, and its cells drop under it where the panel is narrow (c526)', async ({
	page
}, info) => {
	const name = info.project.name;
	test.skip(!FRAMES[name], 'no frame drawn for this project');
	if (name === 'phone') await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Tower of God' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await openDetails(page);
	const row = page.locator('.file-row');
	await row.scrollIntoViewIfNeeded();
	const box = (await row.boundingBox())!;
	const label = (await row.locator('.label').boundingBox())!;
	const text = (await row.locator('.file').boundingBox())!;
	const cells = await row
		.locator('.cells .edit')
		.evaluateAll((ns) => ns.map((n) => n.getBoundingClientRect().toJSON() as DOMRect));
	expect(cells.map((c) => c.width > 0)).toEqual([true, true, true]);
	// The text is wider than any of its cells, wherever it is drawn.
	expect(text.width).toBeGreaterThan(Math.max(...cells.map((c) => c.width)));
	if (name === 'tablet-portrait') {
		// Inline: one line, the cells at its end.
		for (const c of cells) expect(Math.round(c.y)).toBe(Math.round(box.y));
		expect(Math.round(cells[cells.length - 1].right)).toBe(Math.round(box.x + box.width));
		return;
	}
	// The 440 panel's own right rule takes a pixel from its rows.
	const panel = name === 'phone' ? 390 : (FRAMES[name].panel ?? 440);
	expect(box.width).toBeGreaterThanOrEqual(panel - 1);
	expect(box.width).toBeLessThanOrEqual(panel);
	// The text has the whole line after the label.
	expect(Math.round(text.width)).toBe(Math.round(box.width - label.width));
	// The cells are a line of their own under it, in equal columns, edge to edge.
	for (const c of cells) expect(c.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
	const w = cells[0].width;
	for (const c of cells) expect(c.width).toBeCloseTo(w, 0);
	expect(Math.round(cells[0].left)).toBe(Math.round(box.x));
	expect(Math.round(cells[cells.length - 1].right)).toBe(Math.round(box.x + box.width));
	// The meta line is one line, not a word a line.
	// (`line-height` is `normal`, so the measure is the font size: two lines are 2.3 of it.)
	const lines = await row
		.locator('.file-meta')
		.evaluate((n) => n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).fontSize));
	expect(lines).toBeLessThan(1.8);
});

test('a doujin reads as a book: pages, not a chapter list', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Hoshi no Umi no Tabibito' }).click();
	await expect(page.getByText('01 — PAGES')).toBeVisible();
	await expect(page.locator('.entry')).toHaveCount(0);
	await expect(page.locator('.page')).toHaveCount(30);
	await expect(page.locator('.page[aria-current="page"]')).toContainText('18');
	await expect(page.getByRole('link', { name: /READ FROM P\. 18/ })).toBeVisible();
	// Each page shows its thumbnail, made on the workstation.
	const thumb = page.locator('.page img.thumb').first();
	// Lazy: only a cell near the screen asks, and on a phone the grid is below the panel.
	await thumb.scrollIntoViewIfNeeded();
	await expect
		.poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth))
		.toBeGreaterThan(0);
});

test('a novel shows its contents without numbers, and a typeset cover', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Mushoku Tensei' }).click();
	await expect(page.getByText('01 — CONTENTS')).toBeVisible();
	await expect(page.getByText('NO COVER · EPUB')).toBeVisible();
	// LAYOUT is a row DETAILS folds on a phone and a TV (c425).
	await openDetails(page);
	await expect(page.getByText('LAYOUT', { exact: true })).toBeVisible();
	await expect(page.locator('.entry .num')).toHaveCount(0);
});

/**
 * c422, rewritten for LISTS (c424): on a one-season anime with Ranobe
 * configured, Ranobe's line sits under AniList's, the full width of the row,
 * never beside it. c422 fixed LINK and TRACKING crushing to one word a line at
 * the owner's ~460 px panel; LISTS replaced both rows, so the same widths now
 * check the 36 px label strip above the lines and the equal-column cells that
 * drop under a line with two (the handoff's 1B and 1D), and the tablet in
 * portrait keeping its label column and both cells inline.
 *
 * Ranobe needs a token, and turning it on for the shared server would redraw
 * every novel's series screen under the specs that pin them, so this is the
 * Ranobe review's arrangement (tests/ranobe-flow.e2e.ts): a seeded database
 * of this block's own, a dummy token with Ranobe switched off, and a preview
 * of the same build on a port the OS hands out. Only tablet-portrait starts
 * it: the widths are set per case, so the other projects would only repeat it.
 */
test.describe('a one-season anime with Ranobe (c422)', () => {
	test.describe.configure({ mode: 'serial' });
	const dbPath = join(tmpdir(), `tsundoku-e2e-series-ranobe-${process.pid}.sqlite`);
	let server: ChildProcess | null = null;
	let base = '';
	let seriesId = 0;

	test.beforeAll(async () => {
		// The hook seeds one anime and waits up to 60 s for its own preview:
		// 1.6 s alone at this commit, past the default 30 s once the box is
		// loaded (c599). In a hook, test.setTimeout sets the hook's own budget
		// (Playwright's test.d.ts, "Changing timeout for a beforeAll").
		test.setTimeout(120_000);
		test.skip(
			test.info().project.name !== 'tablet-portrait',
			'widths are set per case; one project is enough'
		);
		rmSync(dbPath, { force: true });
		execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
			env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
			stdio: 'pipe'
		});
		const db = new Database(dbPath);
		try {
			const root = (
				db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number }
			).id;
			const now = Date.UTC(2026, 10, 3, 12, 0);
			// The owner's screenshot: Ranma ½ (2024), one season, linked on AniList.
			seriesId = Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, cover_key)
						VALUES (?, 'Ranma ½ (2024)', 'anime', 'aniyomi', 210, ?, ?, 'aniyomi:1:/ranma-2024', 1, '')`
					)
					.run(root, now, now).lastInsertRowid
			);
			const put = db.prepare(
				`INSERT INTO entries (series_id, position, label, episode_number, added_at, file, bytes, page_count, available, source_url)
				VALUES (?, ?, ?, ?, ?, '', 0, 0, 0, ?)`
			);
			for (let i = 1; i <= 12; i++) put.run(seriesId, i, `Episode ${i}`, i, now, `/ep-${i}`);
			db.prepare(
				`INSERT INTO series_links (series_id, anilist_id, mal_id, via, title, linked_at, resolved_at)
				VALUES (?, 178533, 23, 'review', 'Ranma1/2 (2024)', ?, ?)`
			).run(seriesId, now, now);
		} finally {
			db.close();
		}
		const port = await new Promise<number>((resolve, reject) => {
			const probe = createServer();
			probe.once('error', reject);
			probe.listen(0, '127.0.0.1', () => {
				const { port } = probe.address() as AddressInfo;
				probe.close(() => resolve(port));
			});
		});
		base = `http://localhost:${port}`;
		server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				RANOBE_TOKEN: 'rb_e2e_not_a_token',
				TSUNDOKU_RANOBE: 'off',
				TSUNDOKU_ANILIST: 'off',
				LIBRARY_ROOT: join(tmpdir(), `tsundoku-e2e-series-ranobe-empty-${process.pid}`),
				TSUNDOKU_HOME: join(tmpdir(), `tsundoku-e2e-series-ranobe-home-${process.pid}`),
				BACKUP_DIR: join(tmpdir(), `tsundoku-e2e-series-ranobe-backups-${process.pid}`)
			},
			stdio: 'ignore'
		});
		for (let i = 0; i < 120; i++) {
			try {
				if ((await fetch(base, { redirect: 'manual' })).status) return;
			} catch {
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		throw new Error('the series Ranobe preview never answered');
	});

	test.afterAll(() => {
		server?.kill();
		server = null;
		rmSync(dbPath, { force: true });
	});

	for (const width of [390, 460, 800, 1280])
		test(`LISTS keeps AniList's line whole, the RNB line under it, at ${width} px`, async ({
			page
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(`${base}/series/${seriesId}`);
			// At 390 the panel is a phone's, and DETAILS folds LISTS (c425).
			await openDetails(page);
			await expect(page.getByRole('heading', { name: 'Ranma ½ (2024)' })).toBeVisible();
			await screenSettled(page);
			const row = page.locator('[data-row="lists"]');
			await row.scrollIntoViewIfNeeded();
			const whole = (await row.boundingBox())!;
			const anilist = row.locator('[data-line="anilist"]');
			const rnb = row.locator('[data-line="ranobe"]');
			// A one-season anime is drawn as one entry: a service tag, no S tag (1C, 12).
			await expect(row.locator('.tag')).toHaveText(['ANILIST', 'RNB']);
			const a = (await anilist.locator('.ln').boundingBox())!;
			const r = (await rnb.locator('.ln').boundingBox())!;
			// Under it, not beside it, and as wide as it.
			expect(r.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
			expect(Math.round(r.x)).toBe(Math.round(a.x));
			expect(Math.round(r.width)).toBe(Math.round(a.width));
			const portrait = width >= 600 && width < 1024;
			if (portrait) {
				// Room for the label column: LISTS at the left, cells inline even two.
				await expect(row.locator('.lab')).toBeVisible();
				await expect(row.locator('.strip')).toBeHidden();
				await expect(anilist.locator('.drop')).toBeHidden();
				await expect(anilist.locator('.cs .c')).toHaveText(['SIGN IN →', 'EDIT']);
				return;
			}
			// The label is a 36 px strip above the lines, so each line has the full width.
			await expect(row.locator('.lab')).toBeHidden();
			const strip = (await row.locator('.strip').boundingBox())!;
			expect(strip.height).toBe(36);
			expect(Math.round(a.width)).toBe(Math.round(whole.width));
			// Two cells drop under the line in equal columns; one stays at its end.
			await expect(anilist.locator('.cs')).toBeHidden();
			const cells = anilist.locator('.drop .c');
			await expect(cells).toHaveText(['SIGN IN →', 'EDIT']);
			const [c1, c2] = [(await cells.nth(0).boundingBox())!, (await cells.nth(1).boundingBox())!];
			expect(Math.abs(c1.width - c2.width)).toBeLessThanOrEqual(1);
			expect(c2.y).toBe(c1.y);
			expect(c1.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
			await expect(rnb.locator('.drop')).toHaveCount(0);
			await expect(rnb.locator('.cs .c')).toHaveText(['FIND']);
			if (width < 600) {
				const meta = (await anilist.locator('.m').boundingBox())!;
				expect(meta.width / whole.width).toBeGreaterThanOrEqual(0.6);
			}
		});
});
