import { type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { expect, readerReady, test } from './helpers/hydrated';

/**
 * Incognito and leaving the app end to end (doc/PRIVACY.md). Serial,
 * tablet-portrait only. This file owns Yofukashi no Uta, the one
 * series it sends reading events for. Its c680 cases read Mushoku Tensei in
 * the text reader, in incognito too: nothing is written there (history-flow's
 * rows are a different field), and no text case writes its progress.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = 'Yofukashi no Uta';
const NOVEL = 'Mushoku Tensei';

async function command(page: Page, text: string) {
	await page.goto('/search');
	await page.getByRole('searchbox').fill(text);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/$/);
}

/** Playwright can't put a page in the background, so say it was. */
async function visibility(page: Page, state: 'hidden' | 'visible') {
	// The listener is attached on hydration, which can trail the load event.
	await page.waitForLoadState('networkidle');
	await page.evaluate((s) => {
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
		document.dispatchEvent(new Event('visibilitychange'));
	}, state);
}

/** The series id, and an entry id read from the form SELECT fills in. */
async function seriesAndEntry(page: Page, title = TITLE) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: title }).click();
	await page.waitForURL(/\/series\/\d+/);
	const id = Number(page.url().match(/\/series\/(\d+)/)![1]);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.entry .entry-btn').first().click();
	const entry = Number(await page.locator('input[name="entry"]').first().inputValue());
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	return { id, entry };
}

/**
 * What this run's database holds for a series, read through its file (the
 * preview's own `PLAYWRIGHT_DATABASE_PATH`): how many reading events the log
 * has, and the newest `last_opened_at` any entry of it carries. Reading that
 * writes nothing leaves both where they were.
 */
function readingIn(seriesId: number) {
	const db = new Database(process.env.PLAYWRIGHT_DATABASE_PATH!, { readonly: true });
	const events = (
		db.prepare('SELECT COUNT(*) AS n FROM reading_events WHERE series_id = ?').get(seriesId) as {
			n: number;
		}
	).n;
	const opened = (
		db
			.prepare('SELECT MAX(last_opened_at) AS at FROM entries WHERE series_id = ?')
			.get(seriesId) as {
			at: number | null;
		}
	).at;
	db.close();
	return { events, opened };
}

test('/incognito shows the band, and END ends it', async ({ page }) => {
	await command(page, '/incognito');
	await expect(page.getByText('INCOGNITO · NOTHING SAVED')).toBeVisible();
	await page.getByRole('button', { name: 'END' }).click();
	await expect(page.getByText('INCOGNITO · NOTHING SAVED')).toHaveCount(0);
});

test('reading while incognito is never written', async ({ page }) => {
	const { id, entry } = await seriesAndEntry(page);
	expect(Number.isInteger(entry)).toBe(true);
	// Pages, not row counts, so a rerun against a reused preview still holds:
	// had the incognito page 5 been written, today's row would read P. 6.
	// No other file reads this series on the shared database: library-flow's
	// ← case, which opens the last series by title (this one), reads it in
	// incognito since c499, so today's row is this file's one chapter, "P. 6
	// OF …", not a day across several, "CH. 1 → 199 · P. 6"
	// (src/lib/library/history.ts), which the c439 tolerance used to accept.
	// The negative check below still matches P. 6 in either shape, so a written
	// incognito page is caught even on a day that does span chapters.
	const today = page.locator('.rows').first().locator('.row', { hasText: TITLE });

	await command(page, '/incognito');
	const off = await page.request.post('/api/reading', {
		data: { seriesId: id, entryId: entry, kind: 'page', page: 5 }
	});
	expect(await off.json()).toEqual({ saved: false });
	await page.goto('/history');
	await expect(page.locator('.row', { hasText: TITLE }).filter({ hasText: /P\. 6\b/ })).toHaveCount(
		0
	);

	await page.getByRole('button', { name: 'END' }).click();
	await expect(page.getByText('INCOGNITO · NOTHING SAVED')).toHaveCount(0);
	const on = await page.request.post('/api/reading', {
		data: { seriesId: id, entryId: entry, kind: 'page', page: 7 }
	});
	expect(await on.json()).toEqual({ saved: true });
	await page.goto('/history');
	await expect(today).toContainText('P. 8 OF');
});

test('the reading call refuses a hidden series while reveal is off', async ({ page }) => {
	const res = await page.request.post('/api/reading', {
		data: { seriesId: 999_999, entryId: 1, kind: 'open' }
	});
	expect(res.status()).toBe(404);
	const bad = await page.request.post('/api/reading', {
		data: { seriesId: 1, entryId: 1, kind: 'skim' }
	});
	expect(bad.status()).toBe(400);
});

test('going to the background blanks the page, ends reveal, and comes back to the library', async ({
	page
}) => {
	await command(page, '/reveal');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await page.goto('/history');

	await visibility(page, 'hidden');
	await expect(page.getByTestId('privacy-blank')).toBeVisible();
	await visibility(page, 'visible');

	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('privacy-blank')).toHaveCount(0);
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
	const names = (await page.context().cookies()).map((c) => c.name);
	expect(names).not.toContain('tsundoku_reveal');
});

test('a reload is not leaving: reveal survives it', async ({ page }) => {
	await command(page, '/reveal');
	await page.reload();
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
});

test('without reveal or incognito, coming back stays where it was', async ({ page }) => {
	await page.goto('/history');
	await visibility(page, 'hidden');
	await visibility(page, 'visible');
	await expect(page.getByTestId('privacy-blank')).toHaveCount(0);
	await expect(page).toHaveURL(/\/history$/);
});

// ---- c680: a reader opened incognito sends nothing after the hide ends it ----------------
//
// The app's hide ends incognito in a beacon (doc/PRIVACY.md, step 2) while the
// reader's own `data.incognito` stays true: `/api/reading` reads the cookie at
// the moment of each post, so anything the reader sends after it is saved as
// ordinary reading. Chromium cannot be put in the background headless (a
// second page brought to the front leaves `visibilityState` visible; see the
// notes), so the two things the shield does are done as the shield does them:
// the step-2 beacon as a POST to `/leave`, and the step-3 landing as the
// `goto('/')` that takes the reader away. What each case pins is a writer the
// reader still has after that.

/** The shield's step 2: the beacon that ends incognito (204, `x-ended: 1`). */
async function leave(page: Page) {
	const res = await page.request.post('/leave');
	expect(res.status()).toBe(204);
	expect(res.headers()['x-ended']).toBe('1');
}

test('image reader: a page still to come when the app is left writes nothing incognito (c680)', async ({
	page
}) => {
	const { id, entry } = await seriesAndEntry(page);
	await command(page, '/incognito');
	const before = readingIn(id);
	await page.goto(`/read/${entry}?p=3`);
	await readerReady(page);
	// A turn leaves the reader's 800 ms settle behind; the app goes away inside
	// it, as a person's thumb does, and the report fires on its own.
	await page.keyboard.press('ArrowRight');
	await leave(page);
	await page.waitForTimeout(1500);
	expect(readingIn(id)).toEqual(before);
});

test('image reader: closing on the way back writes nothing incognito (c680)', async ({ page }) => {
	const { id, entry } = await seriesAndEntry(page);
	await command(page, '/incognito');
	const before = readingIn(id);
	await page.goto(`/read/${entry}?p=3`);
	await readerReady(page);
	await leave(page);
	// The shield's step 3: the fresh landing that takes the reader away, whose
	// pagehide sends its `close`.
	await page.goto('/');
	expect(readingIn(id)).toEqual(before);
	await page.goto('/history');
	await expect(page.locator('.row', { hasText: TITLE }).filter({ hasText: /P\. 4\b/ })).toHaveCount(
		0
	);
});

test('text reader: a page still to come when the app is left writes nothing incognito (c680)', async ({
	page
}) => {
	const { id, entry } = await seriesAndEntry(page, NOVEL);
	await command(page, '/incognito');
	const before = readingIn(id);
	await page.goto(`/read/${entry}`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	// A turn schedules the paragraph report; the app is left inside its settle.
	await page.keyboard.press('ArrowRight');
	await leave(page);
	await page.waitForTimeout(1500);
	expect(readingIn(id)).toEqual(before);
});

test('text reader: closing on the way back writes nothing incognito (c680)', async ({ page }) => {
	const { id, entry } = await seriesAndEntry(page, NOVEL);
	await command(page, '/incognito');
	const before = readingIn(id);
	await page.goto(`/read/${entry}`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await leave(page);
	await page.goto('/');
	expect(readingIn(id)).toEqual(before);
});
