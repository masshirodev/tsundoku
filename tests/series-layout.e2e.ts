import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, screenSettled, test } from './fixtures';
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
	await expect(page.getByText('LAYOUT', { exact: true })).toBeVisible();
	await expect(page.locator('.entry .num')).toHaveCount(0);
});

/**
 * c422: on a one-season anime with Ranobe configured, Ranobe's line sits
 * under AniList's block in LINK and TRACKING, never beside it (c240's rule:
 * one line in each row, never in AniList's place). As a sibling in the row's
 * flex line it took half the width, and LINK's meta went one word a line at
 * the owner's ~460 px panel.
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

	for (const width of [390, 460, 1280])
		test(`LINK and TRACKING keep AniList's block whole, the RNB line under it, at ${width} px`, async ({
			page
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(`${base}/series/${seriesId}`);
			await expect(page.getByRole('heading', { name: 'Ranma ½ (2024)' })).toBeVisible();
			await screenSettled(page);
			for (const [row, block] of [
				['.link-row:not(.dl-row):not(.source-row)', '.lk'],
				['.track-row', '.tk']
			] as const) {
				const r = page.locator(row);
				await r.scrollIntoViewIfNeeded();
				const own = (await r.locator(block).boundingBox())!;
				const line = (await r.locator('.ranobe-line').boundingBox())!;
				// Under it, not beside it, and as wide as it.
				expect(line.y).toBeGreaterThanOrEqual(own.y + own.height - 1);
				expect(Math.round(line.x)).toBe(Math.round(own.x));
				expect(Math.round(line.width)).toBe(Math.round(own.width));
				if (width < 600) {
					const whole = (await r.boundingBox())!;
					const meta = (await r
						.locator(block === '.lk' ? '.lk-b' : '.tl')
						.first()
						.boundingBox())!;
					expect(meta.width / whole.width).toBeGreaterThanOrEqual(0.6);
				}
			}
		});
});
