import { expect, test } from './fixtures';

/**
 * The remote's keys (c235; doc/TV.md, "The remote"): OK held or MENU opens the
 * focused thing's long-press options, and BACK closes what is open before it
 * climbs out. The `tv` project has no pointer, so every press here is a key.
 *
 * Read-only but for the chapter row, whose hold marks it and the ones before it
 * read: the band's own UNDO puts that back inside the test (the flow files run
 * beside this one on the same database).
 */

/** Past the 450ms hold the layer and the pointer's long press share. */
async function holdOk(page: import('@playwright/test').Page): Promise<void> {
	await page.keyboard.down('Enter');
	await page.waitForTimeout(700);
	await page.keyboard.up('Enter');
}

const focusId = (page: import('@playwright/test').Page) =>
	page.evaluate(
		() =>
			document.activeElement?.closest<HTMLElement>('[data-focus-id]')?.dataset.focusId ??
			document.activeElement?.id ??
			''
	);

/** The library's first row of covers, the screen's start first. */
async function intoGrid(page: import('@playwright/test').Page): Promise<string> {
	await page.goto('/?sort=title');
	await page.keyboard.press('ArrowDown'); // the first CONTINUE card
	await page.keyboard.press('ArrowDown'); // the shelf tabs
	await page.keyboard.press('ArrowDown'); // the first cover
	return page.evaluate(
		() =>
			document.activeElement?.closest<HTMLElement>('[data-focus-line]')?.dataset.focusTitle ?? ''
	);
}

test('OK held opens the focused tile’s sheet; a short OK opens the series instead', async ({
	page
}) => {
	const title = await intoGrid(page);
	expect(title.length).toBeGreaterThan(0);

	await holdOk(page);
	const dialog = page.getByRole('dialog', { name: title });
	await expect(dialog).toBeVisible();
	// Every sheet is a 420px panel from the right on a TV (c238): the same
	// element, opened by a remote rather than a finger.
	const box = (await dialog.boundingBox())!;
	expect(Math.round(box.width)).toBe(420);

	// The release after a hold neither closes it nor opens the series.
	expect(page.url()).toContain('/?sort=title');

	// BACK closes the sheet and puts focus back on the tile.
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	expect(await focusId(page)).toMatch(/^series-\d+$/);

	// A short press is the click a keyboard would make: the series, not its sheet.
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/series\/\d+/);
});

test('MENU opens the same sheet at once', async ({ page }) => {
	const title = await intoGrid(page);
	await page.keyboard.press('ContextMenu');
	const dialog = page.getByRole('dialog', { name: title });
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
});

test('BACK climbs: a cover, the shelf’s tab, the first CONTINUE card, then it leaves', async ({
	page
}) => {
	await intoGrid(page);
	await page.keyboard.press('ArrowDown'); // a second row of covers
	const title = await page.evaluate(
		() =>
			document.activeElement?.closest<HTMLElement>('[data-focus-line]')?.dataset.focusTitle ?? ''
	);
	expect(title.length).toBeGreaterThan(0);

	// To the shelf's tab at the top of the shelf (TV Calls, "BACK climbs before it leaves").
	await page.keyboard.press('Escape');
	expect(await focusId(page)).toMatch(/^shelf-/);
	// Then the page's own top: the first CONTINUE card.
	await page.keyboard.press('Escape');
	expect(await focusId(page)).toMatch(/^continue-/);
	// And at the top there is nothing left in the page to take it.
	expect(await page.evaluate(() => window.tsundokuBack!())).toBe(false);
	expect(page.url()).toContain('/?sort=title');
});

test('window.tsundokuBack() closes an open sheet and says it did', async ({ page }) => {
	await intoGrid(page);
	await holdOk(page);
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	expect(await page.evaluate(() => window.tsundokuBack!())).toBe(true);
	await expect(dialog).toHaveCount(0);
});

test('OK held on a chapter row marks through, and its UNDO puts every chapter back', async ({
	page
}) => {
	// A series no flow spec writes: only its chapter list is read here, and the
	// hold marks its last chapter and everything before it.
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Boku no Kokoro no Yabai Yatsu' }).click();
	await page.waitForURL(/\/series\/\d+/);
	const rows = page.locator('.entry-btn');
	await rows.last().focus();
	await holdOk(page);
	const band = page.getByRole('status').filter({ hasText: 'MARKED READ THROUGH' });
	await expect(band).toBeVisible();
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.getByText(/MARKED READ THROUGH/)).toHaveCount(0);
});

test('OK held on a history row puts its REMOVE up, and BACK takes it down', async ({ page }) => {
	await page.goto('/history');
	const row = page.locator('.rows .row a.main').first();
	await row.focus();
	await holdOk(page);
	await expect(page.locator('.rows .row.pressed').first()).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.locator('.rows .row.pressed')).toHaveCount(0);
	expect(page.url()).toContain('/history');
});
