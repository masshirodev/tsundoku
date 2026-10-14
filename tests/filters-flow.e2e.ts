import { expect, test, type Page } from '@playwright/test';

/**
 * The FILTER panel and + NEW (Library Filters turn 3, card c68;
 * doc/FILTERS.md), end to end on the seeded library.
 */

const filterCell = (page: Page) =>
	page.locator('summary', { hasText: 'FILTER' }).filter({ visible: true });
const panel = (page: Page) =>
	page.getByRole('group', { name: 'Filters' }).filter({ visible: true });
const rowOf = (page: Page, label: string) =>
	panel(page).locator('.row', { has: page.locator('.label', { hasText: label }) });

async function reveal(page: Page) {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
}

test('a filter narrows the shelf: the URL, the label, the tab’s count and the cell all say so', async ({
	page
}) => {
	await page.goto('/?shelf=k:manga&sort=title');
	const tab = page.getByRole('link', { name: /^MANGA/ }).filter({ visible: true });
	const total = Number((await tab.locator('.n').textContent())!.trim());
	await filterCell(page).click();
	await rowOf(page, 'FAV').getByRole('link', { name: 'NOT FAV' }).click();
	await expect(page).toHaveURL(/fav=0/);
	await expect(page.getByText('02 — MANGA · NOT FAV')).toBeVisible();
	await expect(filterCell(page)).toContainText('1');
	const shown = await page.locator('.grid .tile').count();
	await expect(tab).toContainText(`${shown} OF ${total}`);
	// No favourite is left on the grid.
	await expect(page.locator('.grid .tile', { hasText: 'FAV' })).toHaveCount(0);

	// Filters combine, and the panel stays open until DONE.
	await rowOf(page, 'DOWNLOADED').getByRole('link', { name: 'YES' }).click();
	await expect(page).toHaveURL(/fav=0.*dl=1|dl=1.*fav=0/);
	await expect(filterCell(page)).toContainText('2');
	await panel(page).getByRole('button', { name: 'DONE' }).click();
	await expect(panel(page)).toBeHidden();

	await filterCell(page).click();
	await panel(page).getByRole('link', { name: '✕ CLEAR ALL' }).click();
	await expect(page).not.toHaveURL(/fav=|dl=/);
	await expect(page).toHaveURL(/shelf=k%3Amanga|shelf=k:manga/);
});

test('RATING is one line: the blocks pick AT LEAST, UNRATED replaces it, ANY clears', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=title');
	await filterCell(page).click();
	const rating = rowOf(page, 'RATING');
	await rating.getByRole('link', { name: 'At least 3+' }).click();
	await expect(page).toHaveURL(/min=6/);
	await expect(page.getByText('· RATED 3+')).toBeVisible();
	await expect(rating.getByRole('link', { name: 'AT LEAST', exact: true })).toHaveAttribute(
		'aria-current',
		'true'
	);
	await rating.getByRole('link', { name: 'UNRATED', exact: true }).click();
	await expect(page).toHaveURL(/rated=0/);
	await expect(page).not.toHaveURL(/min=/);
	await rating.getByRole('link', { name: 'ANY', exact: true }).click();
	await expect(page).not.toHaveURL(/rated=|min=/);
});

test('the retired shelves’ old links land on the same books, as filters', async ({ page }) => {
	await page.goto('/?shelf=favourites&sort=title');
	await expect(page).toHaveURL(/shelf=all.*fav=1|fav=1.*shelf=all/);
	await page.goto('/?shelf=rated4&min=7');
	await expect(page).toHaveURL(/min=7/);
	await expect(page).not.toHaveURL(/rated4/);
	await page.goto('/?shelf=downloaded');
	await expect(page).toHaveURL(/dl=1/);
});

test('filters that leave nothing say so about the shelf, and one move clears them', async ({
	page
}) => {
	await page.goto('/?shelf=k:novel&min=10&fav=0');
	await expect(page.getByText('Nothing on Novels matches these filters.')).toBeVisible();
	await page.getByRole('link', { name: /^✕ CLEAR · SHOW \d+$/ }).click();
	await expect(page).not.toHaveURL(/min=|fav=/);
	await expect(page.locator('.grid .tile').first()).toBeVisible();
});

test('hidden means hidden: no HIDDEN and no LANGUAGE while reveal is off', async ({ page }) => {
	await page.goto('/?shelf=all&hidden=1&lang=ja');
	// The language isn't on the visible shelf, so it drops; HIDDEN is never asked.
	await expect(page).not.toHaveURL(/lang=/);
	await filterCell(page).click();
	await expect(rowOf(page, 'HIDDEN')).toHaveCount(0);
	await expect(rowOf(page, 'LANGUAGE')).toHaveCount(0);
	await expect(page.locator('.grid .tile', { hasText: 'HIDDEN' })).toHaveCount(0);
});

test('with reveal on, LANGUAGE offers what the shelf holds and HIDDEN narrows to hidden', async ({
	page
}) => {
	await reveal(page);
	await page.goto('/?shelf=all&sort=title');
	await filterCell(page).click();
	await rowOf(page, 'LANGUAGE').getByRole('link', { name: 'JA' }).click();
	await expect(page).toHaveURL(/lang=ja/);
	await rowOf(page, 'HIDDEN').getByRole('link', { name: 'ONLY' }).click();
	await expect(page).toHaveURL(/hidden=1/);
	await expect(page.getByText('· JA · HIDDEN')).toBeVisible();
	const tiles = page.locator('.grid .tile');
	await expect(tiles.first()).toBeVisible();
	// A shelf without that language drops it rather than showing nothing.
	await page.goto('/?shelf=k:manhwa&lang=ja');
	await expect(page).not.toHaveURL(/lang=/);
});

test('+ NEW makes a shelf by name and lands on it, empty, with how to fill it', async ({
	page
}) => {
	await page.goto('/?shelf=all');
	await page.getByRole('link', { name: '+ NEW' }).filter({ visible: true }).click();
	await expect(page).toHaveURL(/new=shelf/);
	const sheet = page.getByRole('dialog', { name: 'New shelf' });
	const name = `Finished ${Date.now() % 100000}`;
	await sheet.getByLabel('Shelf name').fill(name);
	await sheet.getByRole('button', { name: `CREATE ${name.toUpperCase()}` }).click();
	await expect(page).toHaveURL(/shelf=c(%3A|:)\d+/);
	await expect(page.getByText(`Nothing on ${name} yet.`)).toBeVisible();
	// An empty shelf has nothing to filter.
	await expect(filterCell(page)).toHaveCount(0);
});

test('without script, the panel still opens and every choice is a link', async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto('/?shelf=k:manga');
	await filterCell(page).click();
	await rowOf(page, 'FAV').getByRole('link', { name: 'NOT FAV' }).click();
	await expect(page).toHaveURL(/fav=0/);
	await expect(page.getByText('02 — MANGA · NOT FAV')).toBeVisible();
	await context.close();
});

test('a person’s page filters on the device, LANGUAGE included', async ({ page }) => {
	await reveal(page);
	await page.goto('/?tag=circle:Hakka%20Kousha');
	await filterCell(page).click();
	await rowOf(page, 'FAV').getByRole('button', { name: 'NOT FAV' }).click();
	await expect(page.getByText(/— BOOKS · NOT FAV/)).toBeVisible();
	await expect(rowOf(page, 'LANGUAGE')).toBeVisible();
	await panel(page).getByRole('button', { name: '✕ CLEAR ALL' }).click();
	await expect(page.getByText(/— BOOKS · NOT FAV/)).toHaveCount(0);
});

test('READING narrows hidden series too: unread, then in progress', async ({ page }) => {
	await reveal(page);
	await page.goto('/?shelf=all&sort=title&hidden=1');
	const all = await page.locator('.grid .tile').count();
	await page.waitForLoadState('networkidle');
	await filterCell(page).click();
	const reading = rowOf(page, 'READING');
	await reading.getByRole('link', { name: 'UNREAD' }).click();
	await expect(page).toHaveURL(/progress=unread/);
	await expect(page.getByText('02 — ALL · UNREAD · HIDDEN')).toBeVisible();
	const unread = await page.locator('.grid .tile').count();
	await reading.getByRole('link', { name: 'IN PROGRESS' }).click();
	await expect(page).toHaveURL(/progress=reading/);
	const begun = await page.locator('.grid .tile').count();
	expect(unread + begun).toBeLessThanOrEqual(all);
	await reading.getByRole('link', { name: 'ANY' }).click();
	await expect(page).not.toHaveURL(/progress=/);
});
