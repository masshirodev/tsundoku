import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The KIND band on a TV (doc/LIBRARY.md, "The KIND band"): a 56px focus row
 * of its own under the shelf tabs, where moving along it moves focus only and
 * OK chooses, and which pins at the safe top in the tabs' place once the grid
 * scrolls, `ALL ▴` first, back to the tabs. Runs in the `tv` project, which
 * has no pointer, so every press is a key. It only changes the URL: nothing
 * here writes to the database the flow files share.
 */

const focused = (page: Page) =>
	page.evaluate(() => {
		const a = document.activeElement as HTMLElement | null;
		return (a?.getAttribute('aria-label') ?? a?.textContent ?? '').replace(/\s+/g, ' ').trim();
	});
const kinds = (page: Page) => page.getByRole('group', { name: 'Kind' });
const firstTitle = (page: Page) => page.locator('.grid .tile .title').first().textContent();

test('↓ from the tabs is the band; → moves focus only, and OK chooses', async ({ page }) => {
	await page.goto('/?shelf=all&sort=title');
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	expect((await kinds(page).boundingBox())!.height).toBe(56);
	const before = await firstTitle(page);

	await page.keyboard.press('ArrowDown'); // the screen's start
	await page.keyboard.press('ArrowDown'); // the shelf tabs
	await page.keyboard.press('ArrowDown'); // the band, on the chosen cell's row
	await expect.poll(() => focused(page)).toMatch(/^ALL ?\d+$/);
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => focused(page)).toMatch(/^MANGA ?\d+$/);
	const manga = Number(/\d+$/.exec(await focused(page))![0]);
	// Moving along it changed nothing: the URL and the grid are ALL's still.
	await page.waitForTimeout(400);
	expect(page.url()).not.toMatch(/kind=/);
	expect(await firstTitle(page)).toBe(before);
	// The focus line says what OK will do.
	const line = page.getByTestId('focus-line');
	await expect(line).toContainText(`MANGA · ${manga} ON ALL`);
	await expect(line).toContainText('OK SHOWS THEM · THE GRID WAITS');

	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/kind=manga/);
	await expect(kinds(page).getByRole('link', { name: /^MANGA/ })).toHaveAttribute(
		'aria-current',
		'true'
	);
	// Focus stays on the band, on what was chosen.
	await expect.poll(() => focused(page)).toMatch(/^MANGA ?\d+$/);
	await expect(page.locator('.grid .tile')).toHaveCount(manga);
});

test('into the grid the band pins at the safe top, ALL ▴ first, and OK on it brings the tabs back', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=title');
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); // start, tabs, band
	await expect.poll(() => focused(page)).toMatch(/^ALL ?\d+$/);
	for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); // three rows into the grid
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
	// Pinned in the tabs' place, at the top, with the shelf's cell first.
	await expect.poll(() => kinds(page).evaluate((b) => b.getBoundingClientRect().top)).toBe(0);
	const shelf = kinds(page).getByRole('button', { name: /^ALL/ });
	await expect(shelf).toBeVisible();
	const tabs = page.locator('.library div.tabs');
	expect(await tabs.evaluate((t) => t.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
	// Still 56px, and the focus line pinned under it: the pinned rows are 56 + 64.
	expect((await kinds(page).boundingBox())!.height).toBe(56);
	await expect
		.poll(() => page.getByTestId('focus-line').evaluate((l) => l.getBoundingClientRect().top))
		.toBe(56);

	// OK on the shelf's cell: the tabs come back, the mark on the shelf showing.
	await shelf.focus();
	await page.keyboard.press('Enter');
	await expect(tabs.locator('.tab.on')).toBeFocused();
	await expect
		.poll(() => tabs.evaluate((t) => t.getBoundingClientRect().top))
		.toBeGreaterThanOrEqual(0);
	await expect(shelf).toHaveCount(0);
	expect(page.url()).not.toMatch(/kind=/);
});

test('OK on a pinned cell opens that kind at its start, focus kept on the cell, and ↓ is its first tile', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=title');
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); // start, tabs, band
	await expect.poll(() => focused(page)).toMatch(/^ALL ?\d+$/);
	for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); // three rows into the grid
	await expect(kinds(page).getByRole('button', { name: /^ALL/ })).toBeVisible();

	// A pinned cell other than the chosen one, taken from the band.
	const other = kinds(page).locator('.kscroll a:not([aria-current])').first();
	const kind = new URL((await other.getAttribute('href'))!, 'http://x').searchParams.get('kind')!;
	// Held by its id: once chosen it is not the first unchosen cell.
	const cell = kinds(page).locator(`a[data-focus-id="kind-${kind}"]`);
	await cell.focus();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(new RegExp(`kind=${kind}`));
	await expect(cell).toHaveAttribute('aria-current', 'true');
	await expect(cell).toBeFocused();

	// The first tile directly under the band, or under the focus line pinned
	// between them where it is drawn.
	const tile = page.locator('.grid .tile').first();
	await expect
		.poll(async () => {
			const band = await kinds(page).evaluate((b) => b.getBoundingClientRect().bottom);
			const line = page.getByTestId('focus-line');
			const lineH = (await line.isVisible())
				? await line.evaluate((l) => l.getBoundingClientRect().height)
				: 0;
			const top = await tile.evaluate((t) => t.getBoundingClientRect().top);
			return Math.min(Math.abs(top - band), Math.abs(top - band - lineH));
		})
		.toBeLessThanOrEqual(1);

	// The first tile, not the one under the cell: the kind opens at its start.
	await page.keyboard.press('ArrowDown');
	await expect(tile.locator('button.open')).toBeFocused();
});
