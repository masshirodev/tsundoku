import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { type Locator, type Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * The ✕ on a band that reports something done (c493; doc/BANDS.md). There is
 * no component-test harness in this repo, so this flow is the cell's test too:
 * the label, the place after UNDO, and each way a band can be stored. Its own
 * preview and seeded database, because the stored band is a finished scan, and
 * a finished scan changes what the library's load shows every other flow. It
 * runs once, on the tablet, as every flow does; the TV's stop is in
 * `tests/tv-servers.e2e.ts`. The port is the OS's to give.
 */
test.describe.configure({ mode: 'serial' });

const DISMISS = 'Dismiss this band';

let work = '';
let dbPath = '';
let preview: ChildProcess | null = null;
let BASE = '';
let seriesId = 0;

function freePort(): Promise<number> {
	return new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as AddressInfo).port;
			s.close(() => ok(port));
		});
	});
}

test.beforeAll(async () => {
	test.setTimeout(120_000);
	work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-bands-'));
	dbPath = join(work, 'library.sqlite');
	mkdirSync(join(work, 'library'));
	const env = {
		...process.env,
		DATABASE_PATH: dbPath,
		LIBRARY_ROOT: join(work, 'library'),
		NODE_NO_WARNINGS: '1'
	};
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env,
		stdio: 'pipe'
	});
	const db = new Database(dbPath, { readonly: true });
	seriesId = (db.prepare(`SELECT id FROM series ORDER BY id LIMIT 1`).get() as { id: number }).id;
	db.close();
	const port = await freePort();
	BASE = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...env,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			COVER_DIR: join(work, 'covers'),
			TSUNDOKU_HOME: join(work, 'home'),
			BACKUP_DIR: join(work, 'backups')
		},
		stdio: 'ignore'
	});
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${BASE}/`, { redirect: 'manual' })).status) return;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw new Error('the bands preview never answered');
});

test.afterAll(() => {
	preview?.kill();
	if (work) rmSync(work, { recursive: true, force: true });
});

const band = (page: Page, text: string | RegExp) =>
	page.locator('.band:visible', { hasText: text });
const x = (b: Locator) => b.getByRole('button', { name: DISMISS });
const seriesUrl = (query: string) => `${BASE}/series/${seriesId}?${query}`;
const added = (page: Page) => band(page, 'ADDED TO THE LIBRARY');
const moved = (page: Page) => band(page, /^MOVED TO/);

test('ADDED TO THE LIBRARY: ✕ clears it and its URL, a reload keeps it gone, the series stays (c493)', async ({
	page
}) => {
	const before = new Database(dbPath, { readonly: true });
	const count = () => (before.prepare(`SELECT COUNT(*) AS n FROM series`).get() as { n: number }).n;
	const series = count();

	await page.goto(seriesUrl('added=source~e2e&queued=3&keep=1'));
	await expect(added(page)).toBeVisible();
	// The cell comes after UNDO, last in the band.
	await expect(x(added(page))).toHaveText('✕');
	const order = await added(page).evaluate((el) =>
		[...el.querySelectorAll('button')].map((b) => b.textContent?.trim())
	);
	expect(order).toEqual(['UNDO', '✕']);

	await x(added(page)).click();
	await expect(added(page)).toHaveCount(0);
	await expect(page).toHaveURL(/\?keep=1$/);
	await page.reload();
	await expect(added(page)).toHaveCount(0);
	await expect(page.locator('h1').first()).toBeVisible();
	expect(count()).toBe(series);
	before.close();
});

test('a dismissed band is not in Back: the entry was replaced (c493)', async ({ page }) => {
	await page.goto(`${BASE}/`);
	await page.goto(seriesUrl('added=source~e2e'));
	await x(added(page)).click();
	await expect(added(page)).toHaveCount(0);
	await page.goBack();
	await expect(page).toHaveURL(`${BASE}/`);
	await page.goForward();
	await expect(page).toHaveURL(new RegExp(`/series/${seriesId}$`));
	await expect(added(page)).toHaveCount(0);
});

test('clearing the URL keeps the place and, when focus is elsewhere, the focus (c493)', async ({
	page
}) => {
	// Short enough that losing the band and its chips cannot clamp the scroll.
	await page.setViewportSize({ width: 800, height: 300 });
	await page.goto(seriesUrl('added=source~e2e&moved=1'));
	await expect(moved(page)).toBeVisible();
	await page.evaluate(() => window.scrollTo(0, 200));
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
	// What stays still is what the owner sees; the browser's scroll anchoring
	// is what keeps it there when a band above goes, so scrollY itself moves.
	const list = page.locator('.list-col').first();
	const before = (await list.boundingBox())!.y;

	// A programmatic press does not move focus, as a keyboard's ✕ would.
	const undo = moved(page).getByRole('button', { name: 'UNDO' });
	await undo.focus();
	await x(added(page)).evaluate((el) => (el as HTMLElement).click());
	await expect(added(page)).toHaveCount(0);
	await expect(page).toHaveURL(/moved=1/);
	// 5 px measured; a scroll to the top would move it by about 200.
	expect(Math.abs((await list.boundingBox())!.y - before)).toBeLessThanOrEqual(16);
	await expect(undo).toBeFocused();
});

test('bands stacked: hit areas do not overlap, and a double press takes only one (c493)', async ({
	page
}) => {
	await page.goto(seriesUrl('added=source~e2e&moved=1'));
	await expect(added(page)).toBeVisible();
	await expect(moved(page)).toBeVisible();
	const first = (await x(added(page)).boundingBox())!;
	const second = (await x(moved(page)).boundingBox())!;
	const nextBand = (await moved(page).boundingBox())!;
	const firstBand = (await added(page).boundingBox())!;
	expect(first.y + first.height).toBeLessThanOrEqual(nextBand.y + 0.5);
	expect(firstBand.y + firstBand.height).toBeLessThanOrEqual(second.y + 0.5);

	// The second press of a double tap: on the place the first ✕ was, the
	// moment that band has gone and the next has moved up there.
	const secondPress = page.evaluate(
		([px, py, title]) =>
			new Promise<boolean>((done) => {
				const gone = () =>
					![...document.querySelectorAll('.band')].some((b) => b.textContent?.includes(title));
				const seen = new MutationObserver(() => {
					if (!gone()) return;
					seen.disconnect();
					const at = document.elementFromPoint(px, py) as HTMLElement | null;
					const hitsNext = at?.getAttribute('aria-label') === 'Dismiss this band';
					at?.click();
					done(hitsNext);
				});
				seen.observe(document.body, { childList: true, subtree: true });
			}),
		[first.x + first.width / 2, first.y + first.height / 2, 'ADDED TO THE LIBRARY'] as const
	);
	await x(added(page)).click();
	expect(await secondPress).toBe(true);
	await expect(added(page)).toHaveCount(0);
	await expect(moved(page)).toBeVisible();
	await page.waitForTimeout(150);
	await expect(moved(page)).toBeVisible();
	await expect(page).toHaveURL(/moved=1/);
});

test('a form answer: ✕ clears it, and the next answer draws a new band (c493)', async ({
	page
}) => {
	await page.goto(seriesUrl('moved=1'));
	const undo = moved(page).getByRole('button', { name: 'UNDO' });
	const refusal = band(page, 'THE WAY BACK HAS CLOSED');

	await undo.click();
	await expect(refusal).toBeVisible();
	await expect(moved(page)).toHaveCount(0);

	await x(refusal).click();
	await expect(refusal).toHaveCount(0);
	// The refusal hid the URL's band; with it gone, the URL's band is back.
	await expect(moved(page)).toBeVisible();

	await undo.click();
	await expect(refusal).toBeVisible();
});

test('✕ while UNDO is mid-flight: the band goes, and UNDO still answers (c493)', async ({
	page
}) => {
	let release = () => undefined as void;
	const held = new Promise<void>((done) => (release = done));
	await page.route('**/*', async (route) => {
		if (route.request().method() === 'POST' && route.request().url().includes('undoMove'))
			await held;
		await route.continue();
	});
	await page.goto(seriesUrl('moved=1'));
	const answered = page.waitForResponse((r) => r.url().includes('undoMove'));
	await moved(page).getByRole('button', { name: 'UNDO' }).click();
	await x(moved(page)).click();
	await expect(moved(page)).toHaveCount(0);
	await expect(page).not.toHaveURL(/moved=1/);

	release();
	await answered;
	await expect(band(page, 'THE WAY BACK HAS CLOSED')).toBeVisible();
	await expect(x(band(page, 'THE WAY BACK HAS CLOSED'))).toBeVisible();
});

test('the stored band: two tabs, one row, and a new import brings a new band (c493)', async ({
	browser
}) => {
	const stage = () => {
		const db = new Database(dbPath);
		const now = Date.now();
		const id = Number(
			db
				.prepare(
					`INSERT INTO scan_jobs (started_at, finished_at, source_label, series_found) VALUES (?, ?, 'MIHON', 3)`
				)
				.run(now - 60_000, now - 1_000).lastInsertRowid
		);
		db.close();
		return id;
	};
	const stamp = (id: number) => {
		const db = new Database(dbPath, { readonly: true });
		const row = db.prepare(`SELECT dismissed_at FROM scan_jobs WHERE id = ?`).get(id) as {
			dismissed_at: number | null;
		};
		db.close();
		return row.dismissed_at;
	};
	const id = stage();
	const context = await browser.newContext();
	try {
		const a = await context.newPage();
		const b = await context.newPage();
		const finished = (p: Page) => p.locator('.band.act:visible', { hasText: 'IMPORT FINISHED' });
		await a.goto(`${BASE}/`);
		await b.goto(`${BASE}/`);
		await expect(finished(a)).toBeVisible();
		await expect(finished(b)).toBeVisible();

		await x(finished(a)).click();
		await expect(finished(a)).toHaveCount(0);
		// ✕ stays here: only TIDY NEW goes on to the NEW shelf.
		await expect(a).toHaveURL(`${BASE}/`);
		const first = stamp(id);
		expect(first).not.toBeNull();

		// The other tab drew it before: its ✕ is the same row again.
		await x(finished(b)).click();
		await expect(finished(b)).toHaveCount(0);
		await expect(b.locator('.band', { hasText: 'NOTHING CHANGED' })).toHaveCount(0);

		await a.reload();
		await b.reload();
		await expect(finished(a)).toHaveCount(0);
		await expect(finished(b)).toHaveCount(0);

		stage();
		await a.reload();
		await expect(finished(a)).toBeVisible();
	} finally {
		await context.close();
	}
});

test('a band that says what is true now has no ✕ (c493)', async ({ context, page }) => {
	await context.addCookies([{ name: 'tsundoku_incognito', value: '1', url: BASE }]);
	await page.goto(`${BASE}/`);
	const incognito = page.locator('.band.dashed');
	await expect(incognito).toBeVisible();
	await expect(x(incognito)).toHaveCount(0);
});

test('the library band from the URL leaves the rest of its URL alone (c493)', async ({ page }) => {
	await page.goto(`${BASE}/?sort=title&band=ungrouped&facts=%7B%7D&name=Kaze`);
	const gone = band(page, 'UNGROUPED');
	await expect(gone).toBeVisible();
	await x(gone).click();
	await expect(gone).toHaveCount(0);
	await expect(page).toHaveURL(`${BASE}/?sort=title`);
});

test.describe('a browser that speaks Portuguese', () => {
	test.use({ locale: 'pt-BR' });

	test('the ✕ is named in Portuguese (c493)', async ({ page }) => {
		await page.goto(seriesUrl('added=source~e2e'));
		await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
		await expect(page.getByRole('button', { name: 'Dispensar este aviso' })).toBeVisible();
	});
});
