import { type Locator, type Page } from '@playwright/test';
import { expect, readerReady, test } from './fixtures';

/**
 * The page menu end to end (Page Menu, card c26; doc/COVERS.md, "Chosen").
 * Serial, tablet-portrait only. This file owns Omniscient Reader's Viewpoint
 * (a manhwa, read in the vertical strip) and the covers of Kōhai no Himitsu
 * Nikki (a hidden single), and puts both back to automatic. Not Rakugaki
 * Collection Vol. 3: duplicates-flow owns it and sends it to the trash
 * mid-test, which failed this file whenever the two ran together.
 */
test.describe.configure({ mode: 'serial' });

const menu = (page: Page) => page.getByRole('dialog', { name: /^Page \d+$/ });

/**
 * Hold the left button without moving until the menu shows, then let go: the
 * desktop long press. The release waits on the page's own state, not on the
 * runner's clock (c498): the reader opens the menu from a 450 ms timer started
 * on pointerdown and cancelled on pointerup (`HOLD_MS`, ImageReader.svelte),
 * and a starved page handled a release sent after 600 ms of the runner's time
 * before that timer's task, so the menu never opened. Every caller expects the
 * menu, so a press that should open none must not use this.
 */
async function hold(page: Page, x: number, y: number) {
	await page.mouse.move(x, y);
	await page.mouse.down();
	await expect(menu(page)).toBeVisible();
	await page.mouse.up();
}

/** The strip's page slot under a point of the screen, found by its chapter and index. */
async function slotAt(page: Page, x: number, y: number) {
	const at = await page.evaluate(
		([x, y]) => {
			const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-role="page"]');
			return el ? { entry: el.dataset.entry!, index: el.dataset.index! } : null;
		},
		[x, y]
	);
	expect(at, 'a page slot under the press').not.toBeNull();
	return page.locator(`[data-role="page"][data-entry="${at!.entry}"][data-index="${at!.index}"]`);
}

/** `hold()` on the middle of the part of `slot` that is on the screen. */
async function holdOn(page: Page, slot: Locator) {
	await slot.scrollIntoViewIfNeeded();
	const box = (await slot.boundingBox())!;
	const vp = page.viewportSize()!;
	const top = Math.max(box.y, 0);
	const bottom = Math.min(box.y + box.height, vp.height);
	await hold(page, box.x + box.width / 2, (top + bottom) / 2);
}

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

	// The strip's slot under this point, pressed both times, so the second
	// press below is on the page the first chose: the strip grows and shifts
	// as its chapters' images arrive, and under load a second press at the
	// same point of the screen landed on Ch. 213's P. 12 after the first had
	// chosen Ch. 214's (wave 23, beside six burners: c439).
	const slot = await slotAt(page, vp.width / 2, vp.height / 3);
	await holdOn(page, slot);
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

	// Pressed again, on the same page, the row says so and offers the way back.
	await holdOn(page, slot);
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
	await page.locator('.grid .tile', { hasText: 'Kōhai no Himitsu Nikki' }).first().click();
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
