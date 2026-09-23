import type { Page } from '@playwright/test';
import { expect, readerReady, test } from './fixtures';

/**
 * The device cache and offline reading (doc/OFFLINE.md), with the service
 * worker of the production build. Serial, tablet-portrait only. This file
 * owns Drawing: Saikyou Mangaka (paged R→L, with chapters ahead) and its reading.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = 'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru';

async function seriesUrl(page: Page) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	return page.url().replace(/\?.*$/, '');
}

async function controlled(page: Page) {
	// The service worker has to be in charge before anything is cached. It
	// caches every asset first, which under a full parallel run passes 15s.
	await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
		timeout: 30000
	});
}

test('opening a chapter keeps it and the next two on the tablet, and they read offline', async ({
	page,
	context
}) => {
	const series = await seriesUrl(page);
	await controlled(page);
	await page.getByRole('link', { name: /▶/ }).first().click();
	await readerReady(page);
	const entry = Number(page.url().match(/\/read\/(\d+)/)![1]);

	// While the chapter is open, it and the next two are cached; each is
	// marked only once all its pages are in.
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					const keys = await (await caches.open('tsundoku-entries')).keys();
					return keys.filter((k) => k.url.includes('/__cache/')).length;
				}),
			{ timeout: 30000 }
		)
		.toBe(3);
	// And the series screen's ↓ column shows them.
	await page.goto(series);
	await expect(page.locator('.entry .cache', { hasText: '↓' })).toHaveCount(3);

	// Offline: the next chapter still opens, from the tablet.
	await context.setOffline(true);
	await page.goto(`/read/${entry + 1}?p=2`);
	await readerReady(page);
	await expect(page.locator('img[alt="Page 2"]')).toBeVisible();
	await expect
		.poll(() => page.locator('img[alt="Page 2"]').evaluate((i: HTMLImageElement) => i.naturalWidth))
		.toBeGreaterThan(0);

	// Reading offline: the open, and the page turned to once it settles,
	// are both kept on the tablet.
	await page.mouse.click(40, 640);
	await expect
		.poll(() =>
			page.evaluate(
				() => (JSON.parse(localStorage.getItem('tsundoku.pending') ?? '[]') as unknown[]).length
			)
		)
		.toBeGreaterThanOrEqual(2);

	// Back online: it reaches the workstation, at its own time.
	await context.setOffline(false);
	await page.evaluate(() => dispatchEvent(new Event('online')));
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('tsundoku.pending')), { timeout: 15000 })
		.toBeNull();
	await page.goto(`/read/${entry + 1}`);
	await readerReady(page);
	await page.mouse.click(400, 640);
	await expect(page.locator('header[aria-label="Reader"] .meta')).toContainText('P. 3 OF');
});

test('↓ CACHE and REMOVE CACHE act on the selection, with counts', async ({ page }) => {
	// Each test has its own browser, so its own empty cache.
	await seriesUrl(page);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const rows = page.locator('.entry .entry-btn');
	await rows.nth(0).click();
	await rows.nth(1).click();
	await expect(page.getByRole('button', { name: /↓ CACHE/ })).toContainText('2');
	await page.getByRole('button', { name: /↓ CACHE/ }).click();
	await expect(page.locator('.entry .cache', { hasText: '↓' })).toHaveCount(2, { timeout: 20000 });
	await expect(page.getByRole('button', { name: /REMOVE CACHE/ })).toContainText('2');
	await page.getByRole('button', { name: /REMOVE CACHE/ }).click();
	await expect(page.locator('.entry .cache', { hasText: '↓' })).toHaveCount(0);
});

test('nothing is kept while reveal is on', async ({ page, request }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
	const res = await page.request.get('/');
	expect(res.headers()['cache-control']).toBe('no-store');
	const plain = await request.get('/api/entries/999999/pages');
	expect(plain.status()).toBe(404);
});
