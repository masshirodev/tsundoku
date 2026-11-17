import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * The links review's own entry (doc/NAVIGATION.md, doc/LIBRARY.md): a
 * TO LINK row in the desktop's sidebar and in MORE while anything waits, so
 * the library's SERIES TO LINK band can be put away without hiding the
 * review. The band goes, and the review is still one press away; with nothing
 * left to link, the row goes too.
 *
 * Its own preview and seeded database, one per project that runs it, because
 * emptying the queue (NONE OF THESE, on the review itself) is a write the
 * shared server's links-flow counts. Desktop reaches it from the sidebar, the
 * phone from MORE; the tablets' MORE is the same sheet as
 * the phone's, so they skip rather than stand up two more servers. The port is
 * the OS's to give.
 */
test.describe.configure({ mode: 'serial' });

const RUNS = ['desktop', 'phone'];
const runs = () => RUNS.includes(test.info().project.name);

let work = '';
let preview: ChildProcess | null = null;
let BASE = '';

const freePort = () =>
	new Promise<number>((ok, fail) => {
		const s = createServer();
		s.once('error', fail);
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address() as AddressInfo;
			s.close(() => ok(port));
		});
	});

test.beforeAll(async () => {
	// This hook seeds a database and spawns a preview, then polls up to 60 s
	// for it: all inside the default 30 s hook budget, where `work-end-frame`'s
	// same shape ran past 30 s on a loaded box. Measured at 2 s here,
	// desktop at a load average of 20; it returns at once on the two tablets,
	// which skip this file. The house budget is 120 s so a loaded gate fails a
	// case, never the hook. In a hook, `test.setTimeout` sets the hook's
	// own budget (Playwright's test.d.ts).
	test.setTimeout(120_000);
	if (!runs()) return;
	work = mkdtempSync(
		join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-links-door-')
	);
	const db = join(work, 'library.sqlite');
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: {
			...process.env,
			DATABASE_PATH: db,
			LIBRARY_ROOT: join(work, 'library'),
			NODE_NO_WARNINGS: '1'
		},
		stdio: 'pipe'
	});
	const port = await freePort();
	BASE = `http://localhost:${port}`;
	preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: db,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(work, 'library'),
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
	throw new Error('the links-door preview never answered');
});

test.afterAll(() => {
	preview?.kill();
	preview = null;
	if (work) rmSync(work, { recursive: true, force: true });
});

test.beforeEach(() => {
	test.skip(!runs(), "the tablets' MORE is the phone's sheet");
});

const band = (page: Page) => page.locator('.band', { hasText: 'SERIES TO LINK' });
const putAway = (page: Page) =>
	page.getByRole('button', { name: 'Put away the series to link until the count grows' });
const desktop = () => test.info().project.name === 'desktop';

/** The row, where this device has it: the sidebar's foot, or MORE opened from the bar. */
async function door(page: Page) {
	if (desktop()) return page.locator('aside.sidebar .side-foot a', { hasText: 'TO LINK' });
	await page.locator('[data-focus-id="library-more"]').click();
	const sheet = page.getByRole('dialog', { name: 'More' });
	await expect(sheet).toBeVisible();
	return sheet.locator('a.row', { hasText: 'TO LINK' });
}

test('with the band put away, the review is still reached from the sidebar or MORE', async ({
	page
}) => {
	await page.goto(`${BASE}/`);
	await expect(band(page)).toContainText('02 SERIES TO LINK');
	await putAway(page).click();
	await expect(band(page)).toHaveCount(0);
	await page.reload();
	await expect(band(page)).toHaveCount(0);

	const row = await door(page);
	await expect(row).toBeVisible();
	await expect(row).toHaveText(desktop() ? /^TO LINK\s*2$/ : /^TO LINK →\s*2$/);
	await row.click();
	await page.waitForURL(/\/links$/);
	await expect(page.locator('.counter')).toHaveText('01 OF 02');
	if (desktop()) {
		// The sidebar says where you are, as its other rows do.
		await expect(
			page.locator('aside.sidebar .side-foot a', { hasText: 'TO LINK' })
		).toHaveAttribute('aria-current', 'page');
	}
});

test('with nothing left to link, there is no row', async ({ page }) => {
	await page.goto(`${BASE}/links`);
	// The review's own ways out of its queue, one series at a time: NONE OF
	// THESE for one with candidates, and for one AniList found nothing for,
	// SEARCH AGAIN, which (AniList being off) waits for the next cover pass,
	// out of the review until then (links-flow says so).
	const done = page.locator('.band', { has: page.getByRole('button', { name: 'UNDO' }) });
	for (let i = 0; i < 4; i++) {
		const none = page.getByRole('button', { name: 'NONE OF THESE' });
		const again = page.locator('.actions button', { hasText: 'SEARCH AGAIN' });
		await expect(none.or(again).or(page.locator('.counter')).first()).toBeVisible();
		if (await none.isVisible()) {
			await none.click();
			await expect(done.locator('.line').first()).toHaveText('NONE OF THESE · WON’T ASK AGAIN');
		} else if (await again.isVisible()) {
			await again.click();
			await page.getByLabel('Title to search on AniList').fill('Call of the Night');
			await page.getByRole('button', { name: 'SEARCH', exact: true }).click();
			await expect(done.locator('.line').first()).toHaveText('QUEUED · “Call of the Night”');
		} else break;
		await page.goto(`${BASE}/links`);
	}
	await page.goto(`${BASE}/`);
	await expect(band(page)).toHaveCount(0);
	if (desktop()) {
		await expect(page.locator('aside.sidebar .side-foot a').first()).toBeVisible();
		await expect(page.locator('aside.sidebar .side-foot a', { hasText: 'TO LINK' })).toHaveCount(0);
	} else {
		await page.locator('[data-focus-id="library-more"]').click();
		const sheet = page.getByRole('dialog', { name: 'More' });
		await expect(sheet.locator('a.row').first()).toBeVisible();
		await expect(sheet.locator('a.row', { hasText: 'TO LINK' })).toHaveCount(0);
	}
});
