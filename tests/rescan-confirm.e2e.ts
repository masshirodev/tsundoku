import Database from 'better-sqlite3';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { type Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * RESCAN asks first (c525; doc/LIBRARY.md, "RESCAN"): the sidebar's RESCAN
 * opens the house's ConfirmSheet, CANCEL the default, and no scan starts
 * until its own RESCAN is pressed; Esc and the scrim cancel; a scan already
 * running is joined without the question; without script the form still
 * posts. Its own preview and seeded database, because one case stages a
 * running scan, which every screen of the shared server would then show. The
 * sidebar is the desktop's, so most cases run there; the phone and the
 * tablets reach the same form through MORE's RESCAN (c561), and no
 * scan starts there until it is confirmed either. The port is the OS's to
 * give.
 */
test.describe.configure({ mode: 'serial' });

let work = '';
let dbPath = '';
let preview: ChildProcess | null = null;
let BASE = '';

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
	work = mkdtempSync(join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-rescan-'));
	dbPath = join(work, 'library.sqlite');
	// An empty library folder: a scan finds nothing, and says so, never importing.
	mkdirSync(join(work, 'library'));
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
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
			DATABASE_PATH: dbPath,
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
	throw new Error('the library preview never answered');
});

test.afterAll(() => {
	preview?.kill();
	if (work) rmSync(work, { recursive: true, force: true });
});

/** Every POST of the scan action this page makes: a scan asked of the workstation. */
function scans(page: Page): string[] {
	const seen: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && new URL(r.url()).search === '?/scan') seen.push(r.url());
	});
	return seen;
}

const sidebar = (page: Page) => page.locator('aside.sidebar');
const sheet = (page: Page) => page.getByRole('dialog', { name: 'RESCAN THE LIBRARY FOLDER?' });
const desktopOnly = (name: string) =>
	test.skip(name !== 'desktop', 'RESCAN is the desktop sidebar’s');

test('RESCAN asks first, CANCEL is where it opens, and CANCEL starts nothing', async ({
	page
}, info) => {
	desktopOnly(info.project.name);
	const posted = scans(page);
	await page.goto(`${BASE}/`);
	await sidebar(page).getByRole('button', { name: 'RESCAN' }).click();
	await expect(sheet(page)).toBeVisible();
	// It says what will happen, in the app's words.
	await expect(sheet(page)).toContainText('READS THE LIBRARY FOLDER ON THE WORKSTATION AGAIN.');
	await expect(sheet(page)).toContainText('NEW SERIES APPEAR ON NEW AS THEY ARE FOUND.');
	await expect(sheet(page)).toContainText('NOTHING IS REMOVED');
	// The safe answer is the one focused: Enter now cancels.
	await expect(sheet(page).getByRole('button', { name: 'CANCEL' })).toBeFocused();
	await page.waitForTimeout(300);
	expect(posted).toEqual([]);
	await page.keyboard.press('Enter');
	await expect(sheet(page)).toBeHidden();
	await page.waitForTimeout(300);
	expect(posted).toEqual([]);
	await expect(sidebar(page).getByRole('status')).toHaveCount(0);
});

test('Esc and the scrim cancel too', async ({ page }, info) => {
	desktopOnly(info.project.name);
	const posted = scans(page);
	await page.goto(`${BASE}/`);
	const rescan = sidebar(page).getByRole('button', { name: 'RESCAN' });
	await rescan.click();
	await expect(sheet(page)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(sheet(page)).toBeHidden();
	await rescan.click();
	await expect(sheet(page)).toBeVisible();
	// The scrim: the screen's top, well clear of the sheet at the bottom.
	await page.mouse.click(700, 20);
	await expect(sheet(page)).toBeHidden();
	await page.waitForTimeout(300);
	expect(posted).toEqual([]);
});

test('the sheet’s RESCAN starts the scan, and the sidebar says what it found', async ({
	page
}, info) => {
	desktopOnly(info.project.name);
	const posted = scans(page);
	await page.goto(`${BASE}/`);
	await sidebar(page).getByRole('button', { name: 'RESCAN' }).click();
	await sheet(page).getByRole('button', { name: 'RESCAN' }).click();
	await expect(sheet(page)).toBeHidden();
	expect(posted).toHaveLength(1);
	// The library folder is empty: the same note RESCAN always gave.
	await expect(sidebar(page).getByRole('status')).toContainText('NOTHING TO IMPORT');
});

test('the question says how long the last scan took, when one has finished', async ({
	page
}, info) => {
	desktopOnly(info.project.name);
	const db = new Database(dbPath);
	const now = Date.now();
	const id = Number(
		db
			.prepare(
				`INSERT INTO scan_jobs (started_at, finished_at, source_label, dismissed_at) VALUES (?, ?, 'MIHON', ?)`
			)
			.run(now - 3 * 60_000 - 10_000, now - 10_000, now).lastInsertRowid
	);
	try {
		await page.goto(`${BASE}/`);
		await sidebar(page).getByRole('button', { name: 'RESCAN' }).click();
		await expect(sheet(page)).toContainText('THE LAST SCAN TOOK ABOUT 3 MIN.');
		await sheet(page).getByRole('button', { name: 'CANCEL' }).click();
	} finally {
		db.prepare(`DELETE FROM scan_jobs WHERE id = ?`).run(id);
		db.close();
	}
});

test('a scan already running is joined at once, without the question', async ({ page }, info) => {
	desktopOnly(info.project.name);
	const db = new Database(dbPath);
	const id = Number(
		db
			.prepare(`INSERT INTO scan_jobs (started_at, source_label) VALUES (?, 'MIHON')`)
			.run(Date.now()).lastInsertRowid
	);
	try {
		const posted = scans(page);
		await page.goto(`${BASE}/?shelf=all`);
		await sidebar(page).getByRole('button', { name: 'RESCAN' }).click();
		await expect.poll(() => posted.length).toBe(1);
		await expect(sheet(page)).toHaveCount(0);
	} finally {
		db.prepare(`DELETE FROM scan_jobs WHERE id = ?`).run(id);
		db.close();
	}
});

test('without script, RESCAN is the plain form it was: it posts, and the scan is asked', async ({
	browser
}, info) => {
	desktopOnly(info.project.name);
	const context = await browser.newContext({
		javaScriptEnabled: false,
		viewport: { width: 1440, height: 900 }
	});
	const session = createHash('sha256').update(`tsundoku/v1:${E2E_TOKEN}`).digest('hex');
	await context.addCookies([{ name: 'tsundoku_session', value: session, url: BASE }]);
	try {
		const page = await context.newPage();
		await page.goto(`${BASE}/`);
		const answer = page.waitForResponse(
			(r) => r.request().method() === 'POST' && new URL(r.url()).search === '?/scan'
		);
		await sidebar(page).getByRole('button', { name: 'RESCAN' }).click();
		// Nothing to import in an empty folder: the action's refusal, as before.
		expect((await answer).status()).toBe(400);
	} finally {
		await context.close();
	}
});

/*
 * MORE's RESCAN (c561, the owner's yes, 2026-11-05): where there is no
 * sidebar (a phone, a tablet), MORE has a RESCAN row, and it presses the
 * sidebar's own form, so the question, CANCEL focused, joining a running scan
 * and the action's answer are the sidebar's. MORE closes first, so the
 * question is the only sheet open. Its answer has no row to sit under, so a
 * refusal is a band at the top of the screen.
 */
const noSidebar = (name: string) =>
	test.skip(name === 'desktop', 'the desktop has the sidebar’s RESCAN, and MORE is not in its bar');
const more = (page: Page) => page.getByRole('dialog', { name: 'More' });
async function rescanFromMore(page: Page) {
	await page.getByRole('button', { name: 'MORE' }).click();
	await expect(more(page)).toBeVisible();
	await more(page).getByRole('button', { name: 'RESCAN' }).click();
}
const band = (page: Page) => page.locator('.rescan-band');

test('on a phone or tablet, MORE’s RESCAN asks the same question, and nothing starts until it is confirmed (c561)', async ({
	page
}, info) => {
	noSidebar(info.project.name);
	const posted = scans(page);
	await page.goto(`${BASE}/`);
	await expect(sidebar(page)).toBeHidden();
	await rescanFromMore(page);
	// The question, alone: MORE has closed.
	await expect(sheet(page)).toBeVisible();
	await expect(more(page)).toHaveCount(0);
	await expect(sheet(page)).toContainText('READS THE LIBRARY FOLDER ON THE WORKSTATION AGAIN.');
	await expect(sheet(page).getByRole('button', { name: 'CANCEL' })).toBeFocused();
	await page.waitForTimeout(300);
	expect(posted).toEqual([]);
	// CANCEL starts nothing, and says nothing.
	await sheet(page).getByRole('button', { name: 'CANCEL' }).click();
	await expect(sheet(page)).toBeHidden();
	await page.waitForTimeout(300);
	expect(posted).toEqual([]);
	await expect(band(page)).toHaveCount(0);
	// The second time asks again: CANCEL left nothing armed.
	await rescanFromMore(page);
	await expect(sheet(page)).toBeVisible();
	await page.waitForTimeout(300);
	expect(posted).toEqual([]);
	await sheet(page).getByRole('button', { name: 'CANCEL' }).click();
	await expect(sheet(page)).toBeHidden();
	expect(posted).toEqual([]);
});

test('MORE’s RESCAN, confirmed, posts the scan once, and its refusal is a band the ✕ puts away (c561)', async ({
	page
}, info) => {
	noSidebar(info.project.name);
	const posted = scans(page);
	await page.goto(`${BASE}/`);
	await rescanFromMore(page);
	await sheet(page).getByRole('button', { name: 'RESCAN' }).click();
	await expect(sheet(page)).toBeHidden();
	expect(posted).toHaveLength(1);
	// The library folder is empty: the sidebar's note, where a phone can see it, whole.
	await expect(band(page)).toBeVisible();
	await expect(band(page)).toContainText('NOTHING TO IMPORT');
	await expect(band(page)).toContainText('library');
	const box = await band(page).boundingBox();
	expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5);
	await band(page).getByRole('button', { name: 'Close' }).click();
	await expect(band(page)).toHaveCount(0);
	expect(posted).toHaveLength(1);
});

test('MORE’s RESCAN joins a scan already running at once, without the question (c561)', async ({
	page
}, info) => {
	noSidebar(info.project.name);
	const db = new Database(dbPath);
	const id = Number(
		db
			.prepare(`INSERT INTO scan_jobs (started_at, source_label) VALUES (?, 'MIHON')`)
			.run(Date.now()).lastInsertRowid
	);
	try {
		const posted = scans(page);
		await page.goto(`${BASE}/?shelf=all`);
		await rescanFromMore(page);
		await expect.poll(() => posted.length).toBe(1);
		await expect(sheet(page)).toHaveCount(0);
	} finally {
		db.prepare(`DELETE FROM scan_jobs WHERE id = ?`).run(id);
		db.close();
	}
});
