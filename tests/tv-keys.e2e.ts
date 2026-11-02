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

/** Whether the focused element is wholly on screen, with nothing pinned over it. */
const focusedInSight = (page: import('@playwright/test').Page) =>
	page.evaluate(() => {
		const el = document.activeElement as HTMLElement;
		const r = el.getBoundingClientRect();
		// A fraction of a pixel over is a rounding, not a row out of sight.
		if (r.top < -1 || r.bottom > innerHeight + 1) return false;
		const x = r.left + r.width / 2;
		return [r.top + 2, Math.min(r.bottom, innerHeight) - 2].every((y) => {
			const hit = document.elementFromPoint(x, y);
			return !!hit && (el.contains(hit) || hit.contains(el));
		});
	});

/**
 * The seeded shelf is about five rows deep: three ↓ from the first stays off
 * the last, where a ↓ with nothing under it is the browser's own smooth
 * scroll (still running when the next key lands). Then the page is let settle.
 */
async function downThroughGrid(page: import('@playwright/test').Page): Promise<void> {
	for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
	await expect
		.poll(async () => {
			const a = await page.evaluate(() => scrollY);
			await page.waitForTimeout(100);
			return a === (await page.evaluate(() => scrollY)) ? a : -1;
		})
		.toBeGreaterThan(0);
}

test('↑ through the grid keeps each row in sight, out from under the pinned tabs', async ({
	page
}) => {
	await intoGrid(page);
	await downThroughGrid(page);
	expect(await focusedInSight(page)).toBe(true);
	for (let i = 0; i < 3; i++) {
		await page.keyboard.press('ArrowUp');
		// Before 2026-11-02 the row went under the tabs and stayed there.
		expect(await focusedInSight(page)).toBe(true);
	}
});

test('BACK climbs only to what is out of sight: scrolled, to the top; at the top, it leaves', async ({
	page
}) => {
	await intoGrid(page);
	// The first row, CONTINUE still in full view: nothing to climb to.
	expect(await page.evaluate(() => window.tsundokuBack!())).toBe(false);

	await downThroughGrid(page);
	// Scrolled: BACK goes back up to the page's own top, the first CONTINUE
	// card (the pinned shelf tab is in sight, so it isn't a stop).
	await page.keyboard.press('Escape');
	expect(await focusId(page)).toMatch(/^continue-/);
	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	// And at the top there is nothing left in the page to take it.
	expect(await page.evaluate(() => window.tsundokuBack!())).toBe(false);
	expect(page.url()).toContain('/?sort=title');
});

test('OK held as a stream of fresh keydowns, as Android TV sends it, opens the sheet', async ({
	page
}) => {
	const title = await intoGrid(page);
	await page.evaluate(async () => {
		const send = (type: string) =>
			document.activeElement!.dispatchEvent(
				new KeyboardEvent(type, { key: 'Enter', bubbles: true, cancelable: true })
			);
		send('keydown');
		for (let i = 0; i < 12; i++) {
			await new Promise((r) => setTimeout(r, 50));
			send('keydown');
		}
		send('keyup');
	});
	await expect(page.getByRole('dialog', { name: title })).toBeVisible();
	expect(page.url()).toContain('/?sort=title');
	await page.keyboard.press('Escape');
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
	// A series no other spec reads its CONTINUE from: the hold marks its last
	// chapter and everything before it, and the band's UNDO puts it back.
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Isekai Yakkyoku' }).click();
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

test('▶❚❚ on a focused CONTINUE card resumes it, without the series screen', async ({ page }) => {
	// Incognito, so resuming writes nothing to the shared database.
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
	await page.goto('/?sort=title');
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => focusId(page)).toMatch(/^continue-/);
	await page.evaluate(() =>
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'MediaPlayPause', cancelable: true }))
	);
	await page.waitForURL(/\/read\/\d+/);
});
