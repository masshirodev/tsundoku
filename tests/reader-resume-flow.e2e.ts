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

test.describe('the text reader resumes the saved place', () => {
	test("the seed's novel in progress opens at its saved block, from a fresh context", async ({
		page
	}) => {
		const { series, place } = row('Mushoku Tensei', 13);
		expect(place).toBe(7);
		await continueText(page, series);
		await expect.poll(() => atOf(page), { timeout: 10_000 }).toBe('7.0');
		await expect.poll(() => onScreen(page, 7)).toBe('on screen');
	});

	test('a place the reader saved midway is the one ▶ CONTINUE comes back to', async ({ page }) => {
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

	test('an explicit ?at=0.0 is a place: the top, whatever the server saved', async ({ page }) => {
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

	test("a saved block past the chapter's end opens at the top and settles there", async ({
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

// ---- MARK UNREAD starts a read chapter from the top; UNDO of MARK READ THROUGH keeps the place -----

// A manga's row prints its number; a novel's row prints its label instead.
const rowOf = (page: Page, n: number) =>
	page.locator(
		`.entry:has(.num:text-is("${n}")) .entry-btn, .entry:has(:text-is("Vol. ${n}")) .entry-btn`
	);
const imageMeta = (page: Page) => page.locator('header[aria-label="Reader"] .meta');

/** A finished chapter folds with the ones before it: # opens the fold, the app's own door. */
async function showRow(page: Page, n: number) {
	if ((await rowOf(page, n).count()) > 0) return;
	await page.getByRole('button', { name: 'Go to chapter number' }).click();
	await page.getByLabel('GO TO #').fill(String(n));
	await page.getByLabel('GO TO #').press('Enter');
	await expect(rowOf(page, n)).toBeVisible();
}

/** The bulk bar's MARK UNREAD on one chapter, the app's own door. */
async function markUnread(page: Page, series: number, n: number) {
	await page.goto(`/series/${series}`);
	await showRow(page, n);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await rowOf(page, n).click();
	await page.getByRole('button', { name: /MARK UNREAD/ }).click();
	await expect
		.poll(() =>
			db
				.prepare(
					`SELECT read_at FROM entries e WHERE e.series_id = ? AND e.position = ? AND e.shadowed = 0`
				)
				.get(series, n)
		)
		.toEqual({ read_at: null });
}

/** The long press on a chapter row: its context menu, as tests/series-flow.e2e.ts presses it. */
async function markThrough(page: Page, series: number, n: number, label: string) {
	await page.goto(`/series/${series}`);
	await showRow(page, n);
	await rowOf(page, n).click({ button: 'right' });
	await expect(page.getByText(`MARKED READ THROUGH ${label}`)).toBeVisible();
}

/** The last page, which is what finishes an image chapter: `markFinished` on settling there. */
async function finishImage(page: Page, entry: number) {
	const finished = page.waitForRequest(
		(r) => r.url().endsWith('/api/reading') && r.postDataJSON()?.kind === 'finish'
	);
	await page.goto(`/read/${entry}?p=last`);
	await finished;
}

/** The scrubber's last page: arriving there is what sends a novel's `finish`. */
async function finishText(page: Page, entry: number) {
	const finished = page.waitForRequest(
		(r) => r.url().endsWith('/api/reading') && r.postDataJSON()?.kind === 'finish'
	);
	await page.goto(`/read/${entry}?at=0.0`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await severalPages(page);
	await expect.poll(() => pagesNow(page)).toBeGreaterThan(2);
	// severalPages left the controls up: the scrubber is there.
	const track = page.locator('[role="slider"][aria-label="Page in chapter"]');
	const box = (await track.boundingBox())!;
	await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
	await finished;
	await expect.poll(() => row('Mushoku Tensei', 13).readAt).not.toBeNull();
}

test.describe('MARK UNREAD starts a finished chapter from the top, in both readers', () => {
	test('an image chapter finished, then MARK UNREAD: ▶ CONTINUE opens page 1', async ({ page }) => {
		const { series, entry } = row('Hikaru ga Shinda Natsu', 29);
		await finishImage(page, entry);
		await expect.poll(() => row('Hikaru ga Shinda Natsu', 29).readAt).not.toBeNull();
		expect(row('Hikaru ga Shinda Natsu', 29).place).toBeGreaterThan(0);
		await markUnread(page, series, 29);
		await expect.poll(() => row('Hikaru ga Shinda Natsu', 29).place).toBeNull();
		await page.goto(`/series/${series}`);
		await continueLink(page).click();
		await page.waitForURL(new RegExp(`/read/${entry}`));
		await page.keyboard.press('Escape');
		await expect(imageMeta(page)).toContainText('P. 1 OF');
	});

	test('an image chapter finished, MARK READ, then MARK UNREAD: ▶ CONTINUE opens page 1', async ({
		page
	}) => {
		const { series, entry } = row('Hikaru ga Shinda Natsu', 30);
		await finishImage(page, entry);
		await expect.poll(() => row('Hikaru ga Shinda Natsu', 30).readAt).not.toBeNull();
		// c666's own walk: MARK READ over a chapter already read changes nothing.
		const post = await page.request.post(`${base}/series/${series}?/mark`, {
			headers: { origin: base, 'x-sveltekit-action': 'true' },
			form: { read: '1', entry: String(entry) }
		});
		expect(post.ok()).toBe(true);
		expect(row('Hikaru ga Shinda Natsu', 30).place).toBeGreaterThan(0);
		await markUnread(page, series, 30);
		await expect.poll(() => row('Hikaru ga Shinda Natsu', 30).place).toBeNull();
		await page.goto(`/series/${series}`);
		await continueLink(page).click();
		await page.waitForURL(new RegExp(`/read/${entry}`));
		await page.keyboard.press('Escape');
		await expect(imageMeta(page)).toContainText('P. 1 OF');
	});

	test('a novel finished, then MARK UNREAD: ▶ CONTINUE opens at its top', async ({ page }) => {
		const { series, entry } = row('Mushoku Tensei', 13);
		await finishText(page, entry);
		expect(row('Mushoku Tensei', 13).place).toBeGreaterThan(0);
		await markUnread(page, series, 13);
		await expect.poll(() => row('Mushoku Tensei', 13).place).toBeNull();
		await continueText(page, series);
		expect(new URL(page.url()).pathname).toBe(`/read/${entry}`);
		await expect.poll(() => atOf(page), { timeout: 10_000 }).toBe('0.0');
		await expect.poll(() => onScreen(page, 0)).toBe('on screen');
	});
});

test.describe('UNDO of a long-press MARK READ THROUGH resumes the chapter', () => {
	test('an image chapter read halfway: UNDO, then ▶ CONTINUE opens the page it was left on', async ({
		page
	}) => {
		const { series, entry, place } = row('Lookism', 481);
		// The seed's in-progress chapter, on a page of its own.
		expect(place).toBe(11);
		await markThrough(page, series, 481, 'CH. 481');
		await expect.poll(() => row('Lookism', 481).readAt).not.toBeNull();
		await page.getByRole('button', { name: 'UNDO' }).click();
		await expect(page.getByText('MARKED READ THROUGH CH. 481')).toHaveCount(0);
		await expect.poll(() => row('Lookism', 481).readAt).toBeNull();
		await expect.poll(() => row('Lookism', 481).place).toBe(11);
		await page.reload();
		await continueLink(page).click();
		await page.waitForURL(new RegExp(`/read/${entry}`));
		await page.keyboard.press('Escape');
		await expect(imageMeta(page)).toContainText('P. 12 OF');
	});

	test('a novel read halfway: UNDO, then ▶ CONTINUE resumes its block and character', async ({
		page
	}) => {
		const { series, entry, place, offset } = row('Villainess Level 99', 2);
		// Case 2 left it midway through the reader's own door.
		expect(place).toBeGreaterThan(0);
		await markThrough(page, series, 2, 'VOL. 2');
		await expect.poll(() => row('Villainess Level 99', 2).readAt).not.toBeNull();
		await page.getByRole('button', { name: 'UNDO' }).click();
		await expect.poll(() => row('Villainess Level 99', 2).readAt).toBeNull();
		await continueText(page, series);
		expect(new URL(page.url()).pathname).toBe(`/read/${entry}`);
		await expect.poll(() => atOf(page), { timeout: 10_000 }).toBe(`${place}.${offset ?? 0}`);
	});

	test('UNDO after a chapter was read on elsewhere leaves it, and says so', async ({ page }) => {
		const { series, entry } = row('Isekai Yakkyoku', 1);
		const posted = await page.request.post(`${base}/api/reading`, {
			data: { seriesId: series, entryId: entry, kind: 'page', page: 3, total: 24 },
			headers: { origin: base }
		});
		expect(posted.ok()).toBe(true);
		await markThrough(page, series, 1, 'CH. 1');
		await expect.poll(() => row('Isekai Yakkyoku', 1).readAt).not.toBeNull();
		// Another tab's reader, still open on it, posts a new place after the press.
		const later = await page.request.post(`${base}/api/reading`, {
			data: { seriesId: series, entryId: entry, kind: 'page', page: 9, total: 24 },
			headers: { origin: base }
		});
		expect(later.ok()).toBe(true);
		await page.getByRole('button', { name: 'UNDO' }).click();
		await expect(page.getByText('1 READ OR MARKED SINCE · LEFT AS IT IS')).toBeVisible();
		expect(row('Isekai Yakkyoku', 1).readAt).not.toBeNull();
		expect(row('Isekai Yakkyoku', 1).place).toBe(9);
	});
});
