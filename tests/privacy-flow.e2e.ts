import { expect, test, type Page } from '@playwright/test';

/**
 * Incognito and leaving the app end to end (doc/PRIVACY.md). Serial,
 * tablet-portrait only. This file owns Yofukashi no Uta, the one
 * series it sends reading events for.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = 'Yofukashi no Uta';

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
async function seriesAndEntry(page: Page) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	const id = Number(page.url().match(/\/series\/(\d+)/)![1]);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.entry .entry-btn').first().click();
	const entry = Number(await page.locator('input[name="entry"]').first().inputValue());
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	return { id, entry };
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
	const today = page.locator('.rows').first().locator('.row', { hasText: TITLE });

	await command(page, '/incognito');
	const off = await page.request.post('/api/reading', {
		data: { seriesId: id, entryId: entry, kind: 'page', page: 5 }
	});
	expect(await off.json()).toEqual({ saved: false });
	await page.goto('/history');
	await expect(page.getByText(/P\. 6 OF/)).toHaveCount(0);

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
