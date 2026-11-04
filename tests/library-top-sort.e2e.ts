import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * SORT is the house's own menu, not a native <select> (c432; doc/LIBRARY.md,
 * "Sort and direction"). Runs on every device project. Sorting only changes
 * the URL, so nothing here writes to the shared database.
 */

const cell = (page: Page) => page.getByRole('button', { name: /^Sort, / });
const menu = (page: Page) => page.getByRole('menu', { name: 'Sort' });
const titles = (page: Page) => page.locator('.grid .tile .title').allTextContents();
/**
 * `a` in the order of `b`, over the titles both hold. The flow files hide
 * and restore their own series on the same database meanwhile, so two reads
 * of a shelf can differ by a series without the order having changed.
 */
const sameOrder = (a: string[], b: string[]) => {
	const both = a.filter((t) => b.includes(t));
	return both.length > 4 && both.join('\n') === b.filter((t) => a.includes(t)).join('\n');
};

test('no native select is left on the library', async ({ page }) => {
	for (const url of ['/', '/?shelf=all&sort=title', '/?shelf=all&sort=random&seed=7']) {
		await page.goto(url);
		await expect(cell(page)).toBeVisible();
		await expect(page.locator('select')).toHaveCount(0);
	}
});

test('SORT opens a list of blocky choices, picks one, and the grid takes its order', async ({
	page
}) => {
	await page.goto('/?shelf=all');
	await expect(cell(page)).toHaveAccessibleName('Sort, RECENTLY READ');
	const before = await titles(page);
	// What the server orders by title, read straight from its URL.
	await page.goto('/?shelf=all&sort=title');
	const byTitle = await titles(page);
	expect(sameOrder(before, byTitle)).toBe(false);
	await page.goto('/?shelf=all');

	await cell(page).click();
	await expect(menu(page)).toBeVisible();
	await expect(cell(page)).toHaveAttribute('aria-expanded', 'true');
	// FILTER's rows, as a column: 52px cells in 14px mono, the full-ink rule on top.
	const opts = menu(page).getByRole('menuitemradio');
	await expect(opts).toHaveCount(6);
	for (const opt of await opts.all()) {
		expect((await opt.boundingBox())!.height).toBeGreaterThanOrEqual(52);
		await expect(opt).toHaveCSS('font-size', '14px');
	}
	await expect(menu(page)).toHaveCSS('border-top-width', '1px');
	// Text ink, read off a choice not in use (the open cell itself is inverted).
	const ink = await menu(page)
		.getByRole('menuitemradio', { checked: false })
		.first()
		.evaluate((n) => getComputedStyle(n).color);
	await expect(menu(page)).toHaveCSS('border-top-color', ink);
	// The choice in use is inverted, as FILTER's are.
	const on = menu(page).getByRole('menuitemradio', { checked: true });
	await expect(on).toHaveText('RECENTLY READ');
	const page_ = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	await expect(on).not.toHaveCSS('background-color', page_);
	// The list hangs under the SORT block, right edges together, inside the screen.
	const block = (await page.locator('.sort').boundingBox())!;
	const list = (await menu(page).boundingBox())!;
	expect(Math.abs(list.x + list.width - (block.x + block.width))).toBeLessThanOrEqual(1);
	expect(Math.abs(list.y - (block.y + block.height - 1))).toBeLessThanOrEqual(1);
	expect(list.x).toBeGreaterThanOrEqual(0);

	await menu(page).getByRole('menuitemradio', { name: 'TITLE' }).click();
	await expect(menu(page)).toBeHidden();
	await expect(page).toHaveURL(/sort=title/);
	await expect(cell(page)).toHaveAccessibleName('Sort, TITLE');
	await expect.poll(async () => sameOrder(await titles(page), byTitle)).toBe(true);
	// ↓ / ↑ is still beside it, unchanged.
	await expect(page.getByRole('button', { name: 'Reverse order' })).toHaveText('A–Z');
});

test('Escape and a tap outside close it without choosing', async ({ page }, info) => {
	await page.goto('/?shelf=all&sort=added');
	const url = page.url();

	await cell(page).click();
	await expect(menu(page)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menu(page)).toBeHidden();
	expect(page.url()).toBe(url);

	// A tap on a tile under the open list closes the list and opens nothing.
	await cell(page).click();
	await expect(menu(page)).toBeVisible();
	// The tap lands where a finger would; Playwright's own click would refuse,
	// seeing the scrim over the tile, which is the point.
	const tile = (await page.locator('.grid .tile').first().boundingBox())!;
	await page.mouse.click(tile.x + tile.width / 2, tile.y + tile.height / 2);
	await expect(menu(page)).toBeHidden();
	expect(page.url()).toBe(url);
	await expect(cell(page)).toHaveAccessibleName('Sort, RECENTLY ADDED');

	// And one on the top bar, whatever it opens over the page: FILTER beside
	// SELECT on the desktop, MORE elsewhere. The sort's list doesn't stay
	// open under it.
	await cell(page).click();
	await expect(menu(page)).toBeVisible();
	const desktop = info.project.name === 'desktop';
	const other = page
		.locator('header.bar[aria-label="Library"]')
		.locator(desktop ? 'summary' : '.more-cell');
	const at = (await other.boundingBox())!;
	await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
	await expect(menu(page)).toBeHidden();
	// The desktop's bar scrolls with the page and sits under the scrim, which
	// takes the tap; it is pinned above it from c433.
	if (desktop) return;
	await expect(
		desktop
			? page.getByRole('group', { name: 'Filters' }).filter({ visible: true })
			: page.getByRole('dialog')
	).toBeVisible();
});

test('on a keyboard: Enter opens it on the choice in use, the arrows walk, Enter picks, focus comes back', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=added');
	await cell(page).focus();
	await page.keyboard.press('Enter');
	await expect(menu(page)).toBeVisible();
	const focused = () =>
		page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim());
	await expect.poll(focused).toBe('RECENTLY ADDED');
	await page.keyboard.press('ArrowDown');
	await expect.poll(focused).toBe('PROGRESS');
	await page.keyboard.press('ArrowDown');
	await expect.poll(focused).toBe('TITLE');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/sort=title/);
	await expect(menu(page)).toBeHidden();
	await expect(cell(page)).toBeFocused();

	// Escape closes it, and focus goes back to the cell too.
	await page.keyboard.press('Enter');
	await expect(menu(page)).toBeVisible();
	await expect.poll(focused).toBe('TITLE');
	await page.keyboard.press('Escape');
	await expect(menu(page)).toBeHidden();
	await expect(cell(page)).toBeFocused();
	await expect(page).toHaveURL(/sort=title/);
});
