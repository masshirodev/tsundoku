/**
 * The library's SELECT outlives the shelf, the kind and the filter it was
 * made on (c698): a series ticked out of sight stays ticked, SHOW lists the
 * whole selection to review or untick, and GROUP takes what SHOW lists, not
 * only the tiles on screen. A flow file, so it runs once, in
 * tablet-portrait; it only opens sheets and cancels them, so the shared seed
 * is left as it was.
 */
import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

const tiles = (page: Page) => page.locator('.grid .tile');
const titleOf = async (tile: Locator) => (await tile.locator('.title').textContent())!.trim();
const kindCell = (page: Page, word: string) =>
	page.locator('.kinds .kc').filter({ hasText: new RegExp(`^${word}\\d`) });
const count = (page: Page) => page.locator('.selected-count');

/** Opens the library sorted by title and starts SELECT. */
async function startSelecting(page: Page) {
	await page.goto('/?sort=title');
	await expect(tiles(page).first()).toBeVisible();
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(count(page)).toHaveText('0 SELECTED');
}

/** A kind cell's own navigation, waited on by its URL and the grid it brings. */
async function toKind(page: Page, word: string, param: string) {
	await kindCell(page, word).click();
	await page.waitForURL(new RegExp(`kind=${param}`));
	await expect(kindCell(page, word)).toHaveAttribute('aria-current', 'true');
}

test('a series ticked on one kind stays ticked on another, SHOW lists both, and GROUP takes what SHOW keeps (c698)', async ({
	page
}) => {
	await startSelecting(page);
	await toKind(page, 'MANGA', 'manga');
	const a = await titleOf(tiles(page).first());
	await tiles(page).first().click();
	await expect(count(page)).toHaveText('1 SELECTED');

	// Another kind: A is not on screen, and the selection is still 1.
	await toKind(page, 'MANHWA', 'manhwa');
	await expect(tiles(page).filter({ hasText: a })).toHaveCount(0);
	await expect(count(page)).toHaveText('1 SELECTED');
	const b = await titleOf(tiles(page).nth(0));
	const c = await titleOf(tiles(page).nth(1));
	await tiles(page).nth(0).click();
	await tiles(page).nth(1).click();
	await expect(count(page)).toHaveText('3 SELECTED');

	// SHOW lists all three, in the order they were ticked, A out of sight included.
	await page.getByRole('button', { name: 'SHOW', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'The selection' });
	await expect(sheet).toBeVisible();
	await expect(sheet.locator('.show-title')).toHaveText('THE SELECTION · 3 SERIES');
	await expect(sheet.locator('.show-row .a')).toHaveText([a, b, c]);

	// Untick B there: the row stays, dimmed, until the sheet closes.
	await sheet.getByRole('checkbox', { name: `Keep ${b}` }).click();
	await expect(sheet.getByRole('checkbox', { name: `Keep ${b}` })).toHaveAttribute(
		'aria-checked',
		'false'
	);
	await expect(count(page)).toHaveText('2 SELECTED');
	await expect(sheet.locator('.show-row')).toHaveCount(3);
	await sheet.getByRole('button', { name: 'DONE' }).click();
	await expect(sheet).toHaveCount(0);
	await expect(tiles(page).filter({ hasText: b }).first().locator('.open')).toHaveAttribute(
		'aria-pressed',
		'false'
	);

	// GROUP takes the two SHOW kept: its rows are what it posts (GroupSheet's
	// `series` fields are its ticked rows), and A is among them though off screen.
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const group = page.getByRole('dialog', { name: 'Group into a series' });
	await expect(group.locator('.h-title')).toHaveText(/^GROUP 2 /);
	await expect(group.locator('.rows .row').filter({ hasText: a })).toHaveCount(1);
	await expect(group.locator('.rows .row').filter({ hasText: c })).toHaveCount(1);
	await expect(group.locator('.rows .row').filter({ hasText: b })).toHaveCount(0);
	await group.getByRole('button', { name: 'CANCEL' }).click();
	await expect(group).toHaveCount(0);

	// ✕ ends SELECT and drops it: SELECT again starts from none.
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	await expect(count(page)).toHaveCount(0);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await expect(count(page)).toHaveText('0 SELECTED');
});

test('a shelf switch keeps the selection, and SHOW still lists what is off the shelf (c698)', async ({
	page
}) => {
	await startSelecting(page);
	const a = await titleOf(tiles(page).first());
	await tiles(page).first().click();
	await expect(count(page)).toHaveText('1 SELECTED');

	const shelves = page.locator('nav[aria-label="Shelves"]').filter({ visible: true });
	// A shelf the first series is not on: the seed's empty RAWS (JP) shelf.
	await shelves.getByRole('link', { name: /^RAWS \(JP\)/ }).click();
	await page.waitForURL(/shelf=/);
	await expect(tiles(page).filter({ hasText: a })).toHaveCount(0);
	await expect(count(page)).toHaveText('1 SELECTED');
	await page.getByRole('button', { name: 'SHOW', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'The selection' });
	await expect(sheet.locator('.show-row .a')).toHaveText([a]);
	await sheet.getByRole('button', { name: 'DONE' }).click();

	// DELETE's question names it too, off the shelf as it is; CANCEL deletes nothing.
	await page.getByRole('toolbar').getByRole('button', { name: 'DELETE' }).click();
	const ask = page.getByRole('dialog', { name: /DELETE 1 SERIES/ });
	await expect(ask.getByText(`1 SELECTED · ${a.toUpperCase()}`)).toBeVisible();
	await ask.getByRole('button', { name: 'CANCEL' }).click();
	await expect(ask).toHaveCount(0);

	// BACK to ALL is the same page: the selection and the tick are still there.
	await page.goBack();
	await expect(page).not.toHaveURL(/shelf=/);
	await expect(count(page)).toHaveText('1 SELECTED');
	await expect(tiles(page).filter({ hasText: a }).first().locator('.open')).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('leaving the library ends SELECT, as a reload does (c698)', async ({ page }) => {
	// The selection lives in the library page, which a navigation to another
	// screen or a reload makes again from nothing (doc/LIBRARY.md).
	await startSelecting(page);
	await tiles(page).first().click();
	await expect(count(page)).toHaveText('1 SELECTED');
	await page.reload();
	await expect(tiles(page).first()).toBeVisible();
	await expect(count(page)).toHaveCount(0);

	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await tiles(page).first().click();
	await expect(count(page)).toHaveText('1 SELECTED');
	await page.goto('/search');
	await page.getByRole('link', { name: 'Back to library' }).click();
	await expect(tiles(page).first()).toBeVisible();
	await expect(count(page)).toHaveCount(0);
});
