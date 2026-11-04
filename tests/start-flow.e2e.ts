import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * GET STARTED (doc/ONBOARDING.md; cards c208, c209), end to end on an empty
 * library: its own preview of the build, on a database seeded and then
 * emptied of series and devices, so the checklist is what the library is. No
 * engine: the steps that need one are ticked by writing what they'd have
 * written.
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

const IDS = {
	'01': 'repo',
	'02': 'ext',
	'03': 'library',
	'04': 'phone',
	'05': 'find',
	'06': 'add',
	'07': 'download'
} as const;
/** A step by its number; a finished part folds, so never by position. */
const step = (page: import('@playwright/test').Page, n: keyof typeof IDS) =>
	page.locator(`.step[data-step="${IDS[n]}"]`);

test('an empty library is the checklist in two parts: 01 open, 02 and FIRST READ waiting (board 1)', async ({
	page
}) => {
	await page.goto('/');
	await expect(page.getByRole('region', { name: 'Get started' })).toBeVisible();
	await expect(page.getByText('00 — GET STARTED')).toBeVisible();
	await expect(page.getByText('0 OF 7 DONE', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Nothing here yet.' })).toBeVisible();
	await expect(page.locator('.part')).toHaveText([
		/SET UP\s*0 OF 4 DONE · ANY ORDER/,
		/FIRST READ\s*AFTER 02/
	]);
	await expect(page.locator('.step')).toHaveCount(7);
	await expect(step(page, '01')).toHaveClass(/open/);
	await expect(step(page, '02')).toHaveClass(/blocked/);
	await expect(step(page, '02')).toContainText('After 01 · no repository, so nothing to install', {
		ignoreCase: true
	});
	for (const n of ['05', '06', '07'] as const) {
		await expect(step(page, n)).toHaveClass(/blocked/);
		await expect(step(page, n)).toContainText('After 02 · no source to search yet', {
			ignoreCase: true
		});
		// No SKIP while blocked: skipping 02 is the way to say no.
		await expect(step(page, n).getByRole('button')).toHaveCount(0);
	}
	// No repository is named; every kind tsundoku takes is.
	const body = step(page, '01').locator('.st-body');
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
	await expect(band).toContainText('01 OF 07 · ADD A REPOSITORY');
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
	await expect(band).toContainText('04 OF 07 · READ ON YOUR PHONE');
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
	await expect(step(page, '03').locator('.st-body')).toContainText('Mihon backup');
	await page.goto('/');
	await page.evaluate(() =>
		sessionStorage.setItem('tsundoku.start.trail', JSON.stringify({ step: 'phone' }))
	);
	await page.goto('/settings');
	await expect(page.getByRole('navigation', { name: 'Get started' })).toBeVisible();
	await page.goto('/history');
	await page.goto('/settings');
	await expect(page.getByRole('navigation', { name: 'Get started' })).toHaveCount(0);
});

test('03 offers IMPORT A BACKUP for Mihon, NOT YET for the other two, and the folder below (c438)', async ({
	page
}) => {
	await page.goto('/');
	await step(page, '03').getByRole('button', { name: 'OPEN ↓' }).click();
	const body = step(page, '03').locator('.st-body');
	// One live door: Aniyomi and LNReader stay NOT YET until their importers land.
	await expect(body.getByRole('link', { name: 'IMPORT A BACKUP →' })).toHaveCount(1);
	await expect(body).toContainText('ANIME · NOT YET');
	await expect(body).toContainText('NOVELS · NOT YET');
	await expect(body).toContainText('FILES INSTEAD · EPUBS, AND DOWNLOADED CHAPTERS');
	await expect(body.getByRole('button', { name: 'START SCAN' })).toBeVisible();
	await body.getByRole('link', { name: 'IMPORT A BACKUP →' }).click();
	await expect(page).toHaveURL(/\/import$/);
	await expect(page.getByRole('heading', { name: 'IMPORT A BACKUP' })).toBeVisible();
});

test('SKIP and UNDO: skipping 01 takes 02 and FIRST READ with it', async ({ page }) => {
	await page.goto('/');
	await step(page, '03').getByRole('button', { name: 'SKIP' }).click();
	await expect(step(page, '03')).toHaveClass(/skipped/);
	await step(page, '03').getByRole('button', { name: 'UNDO' }).click();
	await expect(step(page, '03')).not.toHaveClass(/skipped/);
	await step(page, '01').getByRole('button', { name: 'SKIP' }).click();
	for (const n of ['02', '05', '06', '07'] as const) {
		await expect(step(page, n)).toContainText('Skipped with 01', { ignoreCase: true });
		await expect(step(page, n).getByRole('button')).toHaveCount(0);
	}
	await expect(page.locator('.part').nth(1)).toHaveText(/3 SKIPPED WITH 01/);
});

test('the sidebar keeps the way back, and MORE does on a tablet', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'MORE' }).click();
	await expect(page.getByRole('link', { name: /GET STARTED\s*6 \/ 7/ })).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/history');
	await expect(page.getByRole('link', { name: /GET STARTED\s*6 \/ 7/ })).toHaveCount(0);
	await page.goto('/');
	const row = page.locator('.side-foot a.start');
	await expect(row).toHaveText(/GET STARTED\s*6 \/ 7/);
});

test('every step done or skipped: the first day, and the list stays on /start, folded (board 3)', async ({
	page
}) => {
	await page.goto('/');
	await step(page, '03').getByRole('button', { name: 'SKIP' }).click();
	await expect(page.getByRole('region', { name: 'Nothing added yet' })).toBeVisible();
	await expect(page.getByText('00 — NOTHING ADDED YET')).toBeVisible();
	await expect(page.getByRole('button', { name: 'START SCAN' })).toBeVisible();
	await page.goto('/start');
	await expect(page.getByText('1 OF 7 DONE · 6 SKIPPED')).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'Everything is set up, or skipped.' })
	).toBeVisible();
	// SET UP folds to one row, SHOW ↓ unfolds it; FIRST READ, gone with 01, keeps its rows.
	await expect(page.locator('.sum')).toHaveCount(1);
	await expect(step(page, '05')).toContainText('Skipped with 01', { ignoreCase: true });
	await expect(page.locator('.sum[data-part="setup"]')).toContainText(
		'1 done · 3 skipped · phone',
		{ ignoreCase: true }
	);
	await page.locator('.sum[data-part="setup"]').getByRole('button', { name: 'SHOW ↓' }).click();
	await expect(step(page, '01')).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(page.locator('.side-foot a.start')).toHaveCount(0);
});

test('FIRST READ: SET UP done leads to it, and one band follows the trip from the search to DOWNLOADS (c209)', async ({
	page
}) => {
	test.setTimeout(90_000);
	// UNDO 01 brings 02 and FIRST READ back; a repository and an extension tick both.
	await page.goto('/start');
	await page.locator('.sum[data-part="setup"]').getByRole('button', { name: 'SHOW ↓' }).click();
	await step(page, '01').getByRole('button', { name: 'UNDO' }).click();
	await expect(step(page, '02')).toHaveClass(/blocked/);
	sql(
		`INSERT INTO engine_repos (base, name, fingerprint, added_at) VALUES ('https://r.invalid', 'R', 'f', ?)`,
		Date.now()
	);
	sql(
		`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
		VALUES ('eu.e2e.hoshi', 'Hoshi Scans', 'manga', 1, '1.0', '1.5', 'h', ?, ?)`,
		Date.now(),
		Date.now()
	);
	await page.goto('/');
	// SET UP is finished (03 skipped): it folds, and the head turns to FIRST READ.
	await expect(page.getByText('00 — GET STARTED · FIRST READ')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Set up. Now something to read.' })).toBeVisible();
	await expect(page.locator('.sum[data-part="setup"]')).toBeVisible();
	await expect(page.locator('.part').nth(1)).toHaveText(/FIRST READ\s*0 OF 3 · IN ORDER/);
	// 05 opens by itself.
	await expect(step(page, '05')).toHaveClass(/open/);
	await expect(step(page, '05')).toContainText(
		'TICKS ITSELF WHEN A CHAPTER OR AN EPISODE IS OPENED'
	);

	// Its search starts the trip; the band names 05.
	await page.goto('/start');
	await page.evaluate(() =>
		sessionStorage.setItem('tsundoku.start.trail', JSON.stringify({ step: 'find', before: [] }))
	);
	await page.goto('/downloads/search?q=frieren');
	const band = page.getByRole('navigation', { name: 'Get started' });
	await expect(band).toContainText('FIRST READ · 05 OF 07 · FIND SOMETHING TO READ');
	await expect(band).toContainText('OPEN A RESULT, THEN ▶ READ');

	// A chapter opened online: a browsing record. The band moves on by itself.
	sql(`INSERT INTO roots (name, path) VALUES ('Mihon', ?)`, join(library, 'Mihon'));
	sql(
		`INSERT INTO series (root_id, title, kind, added_at, indexed_at, origin_key, in_library, browsed_at)
		VALUES ((SELECT id FROM roots WHERE name = 'Mihon'), 'Sousou no Frieren', 'manga', 0, 0, 'mihon:1:/frieren', 0, ?)`,
		Date.now()
	);
	await expect(band).toContainText('✓ 05 DONE · READ ONLINE', { timeout: 12_000 });
	await expect(band).toContainText('NOW 06 OF 07 · + ADD TO LIBRARY, BELOW');

	// + ADD: the record becomes the library's. On the series, 07 is next.
	sql(`UPDATE series SET in_library = 1, browsed_at = NULL WHERE origin_key = 'mihon:1:/frieren'`);
	sql(
		`INSERT INTO entries (series_id, position, label, added_at)
		VALUES ((SELECT id FROM series WHERE origin_key = 'mihon:1:/frieren'), 1, 'Chapter 1', 0)`
	);
	await page.goto('/start');
	await expect(step(page, '06')).toContainText('Done · 1 series added', { ignoreCase: true });
	await expect(step(page, '05')).toContainText('Done · with 06', { ignoreCase: true });
	// 07's body leads to the series; its OPEN → keeps the trip going.
	await page.evaluate(() =>
		sessionStorage.setItem(
			'tsundoku.start.trail',
			JSON.stringify({ step: 'download', before: ['find', 'add'] })
		)
	);
	await step(page, '07').getByRole('link', { name: 'OPEN →' }).click();
	await expect(page).toHaveURL(/\/series\/\d+/);
	await expect(band).toContainText('FIRST READ · 07 OF 07 · DOWNLOAD CHAPTERS');

	// A chapter queued: FIRST READ is done, and the band says what's still open.
	sql(
		`INSERT INTO download_queue (entry_id, series_id, position, queued_at)
		SELECT e.id, e.series_id, 1, 0 FROM entries e JOIN series s ON s.id = e.series_id
		WHERE s.origin_key = 'mihon:1:/frieren'`
	);
	await expect(band).toContainText('✓ 07 DONE · 1 CHAPTER QUEUED · FIRST READ DONE', {
		timeout: 12_000
	});
	// 03 was skipped earlier: nothing is left.
	await expect(band).toContainText('EVERY STEP DONE OR SKIPPED');
	await expect(band.getByRole('link', { name: 'DOWNLOADS →' })).toBeVisible();
	await band.getByRole('link', { name: 'BACK TO GET STARTED →' }).click();
	await expect(page).toHaveURL(/\/start$/);
	await expect(page.locator('.sum[data-part="read"]')).toContainText('3 done', {
		ignoreCase: true
	});
});
