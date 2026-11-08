import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test } from './fixtures';

/**
 * Where ▶ CONTINUE opens a chapter (c622, c652, c666; doc/TEXT-READER.md,
 * doc/SERIES.md): a chapter left midway resumes, in both readers. Runs in
 * tablet-portrait on a seeded database and an OS port of its own, the
 * `works-flow` arrangement, because every case here writes reading and marks
 * that a shared series' CONTINUE row, progress line and history would show.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.use({ serviceWorkers: 'block' });

const PORT = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once('error', reject);
	probe.listen(0, '127.0.0.1', () => {
		const { port } = probe.address() as AddressInfo;
		probe.close(() => resolve(port));
	});
});
const base = `http://localhost:${PORT}`;
const dbPath = join(tmpdir(), `tsundoku-e2e-resume-${process.pid}.sqlite`);
const wipe = () => {
	for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
};
let server: ChildProcess | null = null;
let db: Database.Database;

test.use({ baseURL: base });

test.beforeAll(async () => {
	// Seed, spawn and first answer: past the default 30 s on a loaded box.
	test.setTimeout(120_000);
	wipe();
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(tmpdir(), `tsundoku-e2e-resume-empty-${process.pid}`),
			TSUNDOKU_HOME: join(tmpdir(), `tsundoku-e2e-resume-home-${process.pid}`)
		},
		stdio: 'ignore'
	});
	for (let i = 0; i < 240; i++) {
		try {
			if ((await fetch(`${base}/login`)).ok) break;
		} catch {
			// Not listening yet.
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	db = new Database(dbPath, { readonly: true });
});

test.afterAll(() => {
	db?.close();
	server?.kill();
	wipe();
});

const row = (title: string, number: number) =>
	db
		.prepare(
			`SELECT e.id AS entry, s.id AS series, e.read_at AS readAt,
				e.last_position AS place, e.last_offset AS offset
			FROM entries e JOIN series s ON s.id = e.series_id
			WHERE s.title = ? AND e.position = ? AND e.shadowed = 0`
		)
		.get(title, number) as {
		entry: number;
		series: number;
		readAt: number | null;
		place: number | null;
		offset: number | null;
	};

const atOf = (page: Page) => new URL(page.url()).searchParams.get('at') ?? '';
const continueLink = (page: Page) => page.getByRole('link', { name: /▶ CONTINUE/ }).first();

async function openSeries(page: Page, series: number) {
	await page.goto(`/series/${series}`);
	await expect(continueLink(page)).toBeVisible();
}

/** ▶ CONTINUE, by the app's own door, from a document that holds nothing of the reader's. */
async function continueText(page: Page, series: number) {
	await openSeries(page, series);
	await continueLink(page).click();
	await page.waitForURL(/\/read\//);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
}

/** The character `?at=b.o` names is on screen, inside the page's box. */
const onScreen = (page: Page, b: number) =>
	page.evaluate((b) => {
		const block = document.querySelector<HTMLElement>(`.blocks:not(.next) [data-b="${b}"]`);
		if (!block) return 'no block';
		const r = document.createRange();
		r.selectNodeContents(block);
		const c = r.getClientRects()[0];
		const box = document.querySelector('.page')!.getBoundingClientRect();
		return c.left + 1 >= box.left && c.left <= box.right && c.top >= box.top && c.top <= box.bottom
			? 'on screen'
			: `off screen at ${Math.round(c.left)},${Math.round(c.top)}`;
	}, b);

/** The top margin: always the controls, never a word. */
const middle = async (page: Page) => {
	const v = page.viewportSize()!;
	await page.mouse.click(v.width / 2, 30);
};

/** Larger type and half the page, the app's own settings: a seeded chapter of several pages. */
async function severalPages(page: Page) {
	await middle(page);
	await page.getByRole('button', { name: /^(PAGED|SCROLL) · / }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await sheet.getByRole('radio', { name: 'PAGED' }).click();
	for (let i = 0; i < 14; i++) {
		const larger = sheet.getByRole('button', { name: 'Larger' });
		if (await larger.isDisabled()) break;
		await larger.click();
	}
	await sheet
		.getByRole('radiogroup', { name: 'Width' })
		.getByRole('radio', { name: '50%', exact: true })
		.click();
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('.text-reader')).not.toHaveClass(/scroll/);
}

/** How many pages the open chapter's flow lays out to, from the flow itself. */
const pagesNow = (page: Page) =>
	page.locator('.flow').evaluate((el: HTMLElement) => {
		const box = el.parentElement!;
		const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
		return Math.round((el.scrollWidth + gap) / (box.clientWidth + gap));
	});

async function turnForward(page: Page) {
	const where = () =>
		page.evaluate(() => document.querySelector<HTMLElement>('.flow')?.style.transform ?? '');
	const before = await where();
	const v = page.viewportSize()!;
	await page.mouse.click(v.width - 40, v.height / 2);
	await expect.poll(where).not.toBe(before);
}

/** The `?at=` the reader has settled on: unchanged for a moment past its own 800 ms wait. */
async function settledAt(page: Page) {
	await expect
		.poll(
			async () => {
				const first = atOf(page);
				await page.waitForTimeout(1000);
				return first !== '' && first === atOf(page);
			},
			{ timeout: 20_000 }
		)
		.toBe(true);
	return atOf(page);
}

test.describe('the text reader resumes the saved place (c622, c653)', () => {
	test("the seed's novel in progress opens at its saved block, from a fresh context (c622, c653)", async ({
		page
	}) => {
		const { series, place } = row('Mushoku Tensei', 13);
		expect(place).toBe(7);
		await continueText(page, series);
		await expect.poll(() => atOf(page), { timeout: 10_000 }).toBe('7.0');
		await expect.poll(() => onScreen(page, 7)).toBe('on screen');
	});

	test('a place the reader saved midway is the one ▶ CONTINUE comes back to (c622)', async ({
		page
	}) => {
		const { entry } = row('Villainess Level 99', 2);
		// From its top: one turn from the seed's block 7 can land on the last
		// page, which finishes the chapter.
		await page.goto(`/read/${entry}?at=0.0`);
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
		await severalPages(page);
		await expect.poll(() => pagesNow(page)).toBeGreaterThan(2);
		const before = await settledAt(page);
		await turnForward(page);
		await expect.poll(() => atOf(page), { timeout: 10_000 }).not.toBe(before);
		const left = await settledAt(page);
		expect(left).not.toBe('0.0');
		await middle(page);
		await page.getByRole('link', { name: 'Back to the series' }).click();
		await expect(continueLink(page)).toBeVisible();
		// A fresh document: the place can come only from the server.
		await page.reload();
		await continueLink(page).click();
		await page.waitForURL(new RegExp(`/read/${entry}`));
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
		await expect.poll(() => atOf(page), { timeout: 10_000 }).toBe(left);
	});

	test('an explicit ?at=0.0 is a place: the top, whatever the server saved (c622)', async ({
		page
	}) => {
		const { series, entry } = row('Tensei Shitara Ken Deshita', 2);
		await page.request.post(`${base}/api/reading`, {
			data: { seriesId: series, entryId: entry, kind: 'page', page: 7, offset: 0, total: 15 },
			headers: { origin: base }
		});
		expect(row('Tensei Shitara Ken Deshita', 2).place).toBe(7);
		await page.goto(`/read/${entry}?at=0.0`);
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
		await expect.poll(() => atOf(page), { timeout: 10_000 }).toBe('0.0');
		await expect.poll(() => onScreen(page, 0)).toBe('on screen');
	});

	test("a saved block past the chapter's end opens at the top and settles there (c622)", async ({
		page
	}) => {
		const { series, entry } = row('Tensei Shitara Ken Deshita', 1);
		await page.request.post(`${base}/api/reading`, {
			data: { seriesId: series, entryId: entry, kind: 'page', page: 999, offset: 0, total: 1 },
			headers: { origin: base }
		});
		expect(row('Tensei Shitara Ken Deshita', 1).place).toBe(999);
		await continueText(page, series);
		await expect.poll(() => atOf(page), { timeout: 10_000 }).toBe('0.0');
		await expect.poll(() => onScreen(page, 0)).toBe('on screen');
		await expect.poll(() => row('Tensei Shitara Ken Deshita', 1).place).toBe(0);
	});
});
