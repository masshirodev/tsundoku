import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * GET STARTED (doc/ONBOARDING.md; card c208), end to end on an empty library:
 * its own preview of the build, on a database seeded and then emptied of
 * series and devices, so the checklist is what the library is. No engine:
 * the steps that need one are ticked by writing what they'd have written.
 */

// Not 4190: fetch refuses it (ManageSieve is on the browsers' bad-ports list).
const PORT = Number(process.env.PLAYWRIGHT_START_PORT ?? 4189);
const BASE = `http://localhost:${PORT}`;
const dbPath = join(tmpdir(), `tsundoku-e2e-start-${process.pid}.sqlite`);
const library = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-start-library-'));
let server: ChildProcess | null = null;

const sql = (q: string, ...args: unknown[]) => {
	const db = new Database(dbPath);
	try {
		db.prepare(q).run(...args);
	} finally {
		db.close();
	}
};

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: BASE });

test.beforeAll(async () => {
	// Seeding, emptying and a preview's start: more than the default 30 s under load.
	test.setTimeout(120_000);
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	db.exec(`DELETE FROM series; DELETE FROM devices; DELETE FROM paired_devices;
		DELETE FROM engine_repos; DELETE FROM novel_repos; DELETE FROM engine_extensions;
		DELETE FROM novel_plugins; DELETE FROM scan_jobs;`);
	db.close();
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			// Set up but not answering: EXTENSIONS and BROWSE exist, as on a friend's install.
			ENGINE_URL: 'http://127.0.0.1:1',
			ENGINE_TOKEN: 'e2e-engine-token',
			ENGINE_STORE: library,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: library,
			COVER_DIR: join(library, 'covers'),
			BACKUP_DIR: join(tmpdir(), 'tsundoku-e2e-backups')
		},
		stdio: 'ignore'
	});
	let last: unknown;
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(BASE, { redirect: 'manual' })).status) return;
		} catch (e) {
			last = e;
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw new Error(`the start preview never answered: ${String((last as Error)?.cause ?? last)}`);
});

test.afterAll(() => {
	server?.kill();
	rmSync(dbPath, { force: true });
	rmSync(library, { recursive: true, force: true });
});

/** A step by its number: the list's order never changes. */
const step = (page: import('@playwright/test').Page, n: string) =>
	page.locator('.step').nth(Number(n) - 1);

test('an empty library is the checklist: 01 open, 02 waiting on it (board 1)', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('region', { name: 'Get started' })).toBeVisible();
	await expect(page.getByText('00 — GET STARTED')).toBeVisible();
	await expect(page.getByText('0 OF 4 DONE · ANY ORDER')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Nothing here yet.' })).toBeVisible();
	const steps = page.locator('.step');
	await expect(steps).toHaveCount(4);
	await expect(steps.nth(0)).toHaveClass(/open/);
	await expect(steps.nth(1)).toHaveClass(/blocked/);
	await expect(steps.nth(1)).toContainText('After 01 · no repository, so nothing to install', {
		ignoreCase: true
	});
	// No repository is named; every kind tsundoku takes is.
	const body = steps.nth(0).locator('.st-body');
	await expect(body).toContainText('tsundoku doesn’t name one'.replace('’', "'"));
	await expect(body.locator('.holds')).toContainText('AN LNREADER PLUGIN REPOSITORY');
	await expect(body.getByRole('button', { name: /mihon extension repository/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /^https?:/ })).toHaveCount(0);
});

test('ASK hands the address to EXTENSIONS, with the way back (board 2)', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('REPOSITORY ADDRESS').fill('https://example.invalid/index.min.json');
	await page.getByRole('button', { name: 'ASK' }).click();
	await expect(page).toHaveURL(/\/browse\/extensions\?tab=repos&add=https/);
	const band = page.getByRole('navigation', { name: 'Get started' });
	await expect(band).toContainText('01 OF 04 · ADD A REPOSITORY');
	await expect(band).toContainText('TICKS ITSELF WHEN ONE IS ADDED');
	// A tab of the same screen keeps it; ✕ ends it.
	await page
		.getByRole('link', { name: /AVAILABLE/ })
		.first()
		.click();
	await expect(band).toBeVisible();
	await band.getByRole('button', { name: 'Close the trail' }).click();
	await expect(band).toHaveCount(0);
	// Opening EXTENSIONS on one's own never shows it.
	await page.goto('/browse/extensions?tab=repos');
	await expect(band).toHaveCount(0);
});

test('a step ticks itself, and the band says so with the way back', async ({ page }) => {
	await page.goto('/');
	await step(page, '04').getByRole('button', { name: 'OPEN ↓' }).click();
	await page.getByRole('link', { name: 'SETTINGS › 08 — DEVICES →' }).click();
	await expect(page).toHaveURL(/\/settings/);
	const band = page.getByRole('navigation', { name: 'Get started' });
	await expect(band).toContainText('04 OF 04 · READ ON YOUR PHONE');
	// A phone pairs: the band asks again by itself.
	sql(
		`INSERT INTO paired_devices (token_hash, label, address, paired_at, seen_at)
		VALUES ('e2e', 'Phone', '192.168.1.20', ?, ?)`,
		Date.now(),
		Date.now()
	);
	await expect(band).toContainText('✓ 04 DONE · A PHONE PAIRED', { timeout: 12_000 });
	await expect(band).toContainText('STILL OPEN · 01 ADD A REPOSITORY');
	await band.getByRole('link', { name: 'BACK TO GET STARTED →' }).click();
	await expect(page).toHaveURL(/\/start$/);
	await expect(step(page, '04')).toContainText('Done · a phone or tablet reads here', {
		ignoreCase: true
	});
});

test('leaving the screen any other way ends the trip', async ({ page }) => {
	await page.goto('/');
	await step(page, '03').getByRole('button', { name: 'OPEN ↓' }).click();
	await expect(step(page, '03').locator('.st-body')).toContainText('Mihon/autobackup');
	await page.goto('/');
	await page.evaluate(() => sessionStorage.setItem('tsundoku.start.trail', 'phone'));
	await page.goto('/settings');
	await expect(page.getByRole('navigation', { name: 'Get started' })).toBeVisible();
	await page.goto('/history');
	await page.goto('/settings');
	await expect(page.getByRole('navigation', { name: 'Get started' })).toHaveCount(0);
});

test('SKIP and UNDO: skipping 01 takes 02 with it', async ({ page }) => {
	await page.goto('/');
	await step(page, '03').getByRole('button', { name: 'SKIP' }).click();
	await expect(step(page, '03')).toHaveClass(/skipped/);
	await step(page, '03').getByRole('button', { name: 'UNDO' }).click();
	await expect(step(page, '03')).not.toHaveClass(/skipped/);
	await step(page, '01').getByRole('button', { name: 'SKIP' }).click();
	await expect(page.locator('.step').nth(1)).toContainText('Skipped with 01', {
		ignoreCase: true
	});
	await expect(page.locator('.step').nth(1).getByRole('button')).toHaveCount(0);
});

test('the sidebar keeps the way back, and MORE does on a tablet', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'MORE' }).click();
	await expect(page.getByRole('link', { name: /GET STARTED\s*3 \/ 4/ })).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/history');
	await expect(page.getByRole('link', { name: /GET STARTED\s*3 \/ 4/ })).toHaveCount(0);
	await page.goto('/');
	const row = page.locator('.side-foot a.start');
	await expect(row).toHaveText(/GET STARTED\s*3 \/ 4/);
});

test('every step done or skipped: the first day, and the list stays on /start (board 3)', async ({
	page
}) => {
	await page.goto('/');
	await step(page, '03').getByRole('button', { name: 'SKIP' }).click();
	await expect(page.getByRole('region', { name: 'Nothing added yet' })).toBeVisible();
	await expect(page.getByText('00 — NOTHING ADDED YET')).toBeVisible();
	await expect(page.getByRole('button', { name: 'START SCAN' })).toBeVisible();
	await page.goto('/start');
	await expect(page.getByText('1 OF 4 DONE · 3 SKIPPED')).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'Everything is set up, or skipped.' })
	).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(page.locator('.side-foot a.start')).toHaveCount(0);
});
