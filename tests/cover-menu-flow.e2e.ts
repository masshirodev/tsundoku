import { type Page } from '@playwright/test';
import { expect, readerReady, test } from './fixtures';

/**
 * The page menu end to end (Page Menu, card c26; doc/COVERS.md, "Chosen").
 * Serial, tablet-portrait only. This file owns Omniscient Reader's Viewpoint
 * (a manhwa, read in the vertical strip) and the covers of Rakugaki
 * Collection Vol. 3 (a hidden single), and puts both back to automatic.
 */
test.describe.configure({ mode: 'serial' });

/** Hold the left button 600ms without moving: the desktop long press. */
async function hold(page: Page, x: number, y: number) {
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.waitForTimeout(600);
	await page.mouse.up();
}

const menu = (page: Page) => page.getByRole('dialog', { name: /^Page \d+$/ });

test('a long press on a manhwa page: the series row only, then the band', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: "Omniscient Reader's Viewpoint" }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page
		.getByRole('link', { name: /▶ (CONTINUE|START|READ AGAIN)/ })
		.first()
		.click();
	await readerReady(page);
	await expect(page.locator('[data-role="page"] img:not(.hidden)').first()).toBeVisible();
	const vp = page.viewportSize()!;

	await hold(page, vp.width / 2, vp.height / 3);
	await expect(menu(page)).toBeVisible();
	// The release that ended the press didn't bring the controls up.
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
	await expect(menu(page)).toContainText(/PAGE · P\. \d+ OF \d+/);
	await expect(menu(page).locator('.label')).toHaveText(['SERIES']);
	await expect(menu(page)).toContainText('MANHWA ·');

	await menu(page)
		.getByRole('button', { name: /SET AS SERIES COVER/ })
		.click();
	await expect(menu(page)).toHaveCount(0);
	await expect(page.locator('.cover-band')).toContainText(/SERIES COVER · P\. \d+/);

	// Pressed again, the row says so and offers the way back.
	await hold(page, vp.width / 2, vp.height / 3);
	await expect(menu(page)).toContainText('✓ THIS PAGE');
	await menu(page)
		.getByRole('button', { name: /BACK TO AUTOMATIC/ })
		.click();
	await expect(page.locator('.cover-band')).toContainText('SERIES COVER · AUTOMATIC');
});

test('Esc and the scrim close the menu, and nothing reaches the page meanwhile', async ({
	page
}) => {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: "Omniscient Reader's Viewpoint" }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page
		.getByRole('link', { name: /▶ (CONTINUE|START|READ AGAIN)/ })
		.first()
		.click();
	await readerReady(page);
	const vp = page.viewportSize()!;
	await hold(page, vp.width / 2, vp.height / 3);
	await expect(menu(page)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menu(page)).toHaveCount(0);
	await hold(page, vp.width / 2, vp.height / 3);
	// Away from the top edge, where a resting mouse brings the controls up by design.
	await page.mouse.click(vp.width / 2, 200);
	await expect(menu(page)).toHaveCount(0);
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
});

test('the PAGES grid: long-press a cell, COVER, and the corner that marks it', async ({ page }) => {
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/reveal');
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/$/);
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Rakugaki Collection Vol. 3' }).first().click();
	await page.waitForURL(/\/series\/\d+/);
	const cell = page.locator('[data-cell="2"]');
	await cell.scrollIntoViewIfNeeded();
	const box = (await cell.boundingBox())!;
	await hold(page, box.x + box.width / 2, box.y + box.height / 2);
	await expect(menu(page)).toBeVisible();
	await expect(menu(page).locator('.label')).toHaveText(['COVER']);
	await expect(menu(page).getByRole('link', { name: '▶ READ FROM P. 3' })).toBeVisible();

	await menu(page)
		.getByRole('button', { name: /SET AS COVER/ })
		.click();
	await expect(page.getByText('COVER · P. 3')).toBeVisible();
	await expect(cell.locator('.is-cover')).toHaveText('COVER');
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(cell.locator('.is-cover')).toHaveCount(0);
});
