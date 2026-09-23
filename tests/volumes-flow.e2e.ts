import { expect, test } from './fixtures';

/**
 * Volumes of a novel (doc/BOOKS.md): two novels grouped into one series from
 * the library, read across the join, and split again. This file owns
 * Villainess Level 99 and Tensei Shitara Ken Deshita, and puts them back.
 */
test.describe.configure({ mode: 'serial' });

const ONE = 'Villainess Level 99';
const TWO = 'Tensei Shitara Ken Deshita';

test('GROUP takes novels as volumes; CONTENTS heads each; the reader crosses; UNGROUP splits', async ({
	page
}) => {
	await page.goto('/?shelf=k:novel&sort=title');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const t of [TWO, ONE]) await page.locator('.grid .tile', { hasText: t }).click();
	await expect(page.getByText('2 SELECTED')).toBeVisible();
	await page.getByRole('button', { name: /GROUP/ }).click();

	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await expect(sheet.getByText('GROUP 2 VOLUMES')).toBeVisible();
	await sheet.getByRole('textbox', { name: 'Series name' }).fill('Two Isekai');
	// Title order: Tensei, then Villainess.
	await sheet.getByRole('button', { name: 'BY TITLE' }).click();
	await sheet.getByRole('button', { name: /CREATE SERIES · 2 VOLUMES/ }).click();

	await expect(page).toHaveURL(/\/series\/\d+\?created=2/);
	await expect(page.getByText('SERIES CREATED · 2 VOLUMES')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Two Isekai', exact: true })).toBeVisible();
	const list = page.getByRole('region', { name: 'Contents' });
	await expect(list.getByText(`VOL. 1 · ${TWO.toUpperCase()}`)).toBeVisible();
	await expect(list.getByText(`VOL. 2 · ${ONE.toUpperCase()}`)).toBeVisible();
	const series = page.url().replace(/\?.*$/, '');

	// The last chapter of the first volume, then onward into the second's first.
	await list.getByText('Vol. 15', { exact: true }).first().click();
	await page.waitForURL(/\/read\//);
	await expect(page.locator('.blocks h1').first()).toHaveText('Vol. 15', { timeout: 15000 });
	const books = page.waitForRequest((r) => /\/epub\?v=.*&f=/.test(r.url()));
	const v = page.viewportSize()!;
	for (
		let i = 0;
		i < 16 && (await page.locator('.blocks h1').first().textContent()) === 'Vol. 15';
		i++
	)
		await page.mouse.click(v.width - 8, v.height / 2);
	await books;
	// Villainess' own Vol. 1: the second book, opened from its own file.
	await expect(page.locator('.blocks h1').first()).toHaveText('Vol. 1', { timeout: 15000 });

	await page.goto(series);
	await page.getByRole('button', { name: 'UNGROUP' }).click();
	await page.waitForURL(/\/\?sort=added/);
	await page.goto('/?shelf=k:novel&sort=title');
	await expect(page.locator('.grid .tile', { hasText: ONE })).toBeVisible();
	await expect(page.locator('.grid .tile', { hasText: TWO })).toBeVisible();
	await expect(page.locator('.grid .tile', { hasText: 'Two Isekai' })).toHaveCount(0);
});
