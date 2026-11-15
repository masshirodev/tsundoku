import { expect, readerReady, test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * The page holds still under an open sheet (src/lib/scroll-lock.ts): the
 * owner could scroll the library behind MORE on a phone (2026-11-13). Every
 * sheet is the one Sheet component, so MORE stands for all of them. The
 * overlays that draw their own scrim take the same lock (c1033): FILTER stands
 * for the panels, READING over the strip for the readers' sheets. Read-only:
 * each cover is only opened and closed, the reader in incognito.
 */

const pageTop = (page: Page) => page.evaluate(() => window.scrollY);
const rootOverflow = (page: Page) =>
	page.evaluate(() => getComputedStyle(document.documentElement).overflowY);

test('the library does not scroll under MORE, and scrolls again once it closes', async ({
	page
}, info) => {
	test.skip(info.project.name === 'desktop', 'The desktop has the sidebar: no MORE cell');
	const width = page.viewportSize()!.width;
	await page.setViewportSize({ width, height: 600 });
	await page.goto('/');
	await expect(page.locator('.grid .tile').first()).toBeVisible();

	await page.locator('[data-focus-id="library-more"]').click();
	const sheet = page.getByRole('dialog', { name: 'More' });
	await expect(sheet).toBeVisible();
	const before = await pageTop(page);

	// Over the scrim, above the sheet: where the owner's finger was.
	await page.mouse.move(width / 2, 40);
	await page.mouse.wheel(0, 600);
	// The lock itself, since a wheel alone can't speak for a touch drag on the phone.
	expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe(
		'hidden'
	);
	await page.waitForTimeout(150);
	expect(await pageTop(page)).toBe(before);

	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(sheet).toBeHidden();
	expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
	await page.mouse.wheel(0, 600);
	await expect.poll(() => pageTop(page)).toBeGreaterThan(before);
});

test('the library does not scroll under FILTER, whose panel fits the screen and scrolls itself', async ({
	page
}) => {
	const width = page.viewportSize()!.width;
	await page.setViewportSize({ width, height: 600 });
	await page.goto('/');
	await expect(page.locator('.grid .tile').first()).toBeVisible();

	// Whichever FILTER this device draws: the KIND band's, or the desktop's top bar.
	const filter = page.locator('details.filter:visible').first();
	await filter.locator('summary').click();
	await expect(filter).toHaveAttribute('open', '');
	const panel = filter.getByRole('group', { name: 'Filters' });
	await expect(panel).toBeVisible();
	expect(await rootOverflow(page)).toBe('hidden');

	// Locked, the page can't bring the panel's foot into view, so the panel must
	// end on the screen and reach its foot by its own scroll.
	const box = (await panel.boundingBox())!;
	// A pixel's grace: opened low, the panel is brought into view to its foot,
	// which lands on a fraction (600.39 measured on the phone).
	expect(box.y + box.height).toBeLessThanOrEqual(601);
	const before = await pageTop(page);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
	await page.mouse.wheel(0, 2000);
	await page.waitForTimeout(150);
	expect(await pageTop(page)).toBe(before);
	await expect(panel.getByText('✕ CLEAR ALL')).toBeInViewport();

	await filter.locator('summary').click();
	await expect(filter).not.toHaveAttribute('open', '');
	expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
	await page.mouse.wheel(0, 600);
	await expect.poll(() => pageTop(page)).toBeGreaterThan(before);
});

test('the top bar’s FILTER, left open as the window narrows past it, lets go of the page', async ({
	page
}, info) => {
	test.skip(info.project.name !== 'desktop', 'Only the desktop draws FILTER in the top bar');
	await page.goto('/');
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	const desk = page.locator('.filter-desk details.filter');
	await desk.locator('summary').click();
	await expect(desk).toHaveAttribute('open', '');
	expect(await rootOverflow(page)).toBe('hidden');

	// Below 1024px the top bar's cell and panel are hidden, still open: the
	// page is covered by nothing, so it must scroll.
	await page.setViewportSize({ width: 900, height: 900 });
	await expect(desk).toBeHidden();
	await expect.poll(() => rootOverflow(page)).not.toBe('hidden');

	// Wide again, the open panel is drawn again, and holds the page again.
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(desk).toBeVisible();
	await expect.poll(() => rootOverflow(page)).toBe('hidden');
});

test('the strip does not scroll under READING, and scrolls again once it closes', async ({
	page
}) => {
	test.setTimeout(60_000);
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Sousou no Frieren' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.getByRole('link', { name: /▶/ }).first().click();
	await readerReady(page);

	// The strip (session state), from READING: the one mode that scrolls the page.
	await page.keyboard.press('Escape');
	await page.locator('footer[aria-label="Reader controls"] .cell.grow').click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	const vertical = sheet.getByRole('radio', { name: 'VERTICAL' });
	await vertical.click();
	await expect(vertical).toHaveAttribute('aria-checked', 'true');
	await expect(page.locator('.reader')).toHaveClass(/vertical/);
	await expect(sheet).toBeVisible();
	expect(await rootOverflow(page)).toBe('hidden');

	const before = await pageTop(page);
	await page.mouse.move(page.viewportSize()!.width / 2, 20);
	await page.mouse.wheel(0, 600);
	await page.waitForTimeout(150);
	expect(await pageTop(page)).toBe(before);

	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
	await page.mouse.wheel(0, 600);
	await expect.poll(() => pageTop(page)).toBeGreaterThan(before);
});
