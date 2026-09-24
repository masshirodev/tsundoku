import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Series of books, person pages, grouping and suggestions end to end
 * (doc/BOOKS.md). Serial, tablet-portrait only, and each test restores what
 * it changed.
 *
 * This file owns every Kaori Mama title -- the series of four books and the
 * two single books beside it -- and the Hakka Kousha / Aoi Rin people. They
 * sit in the hidden Hentoid root, so every test turns reveal on first.
 */
test.describe.configure({ mode: 'serial' });

const CIRCLE = '/?tag=' + encodeURIComponent('circle:Hakka Kousha');

async function reveal(page: Page) {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
}

async function openBooks(page: Page) {
	await page.goto('/?shelf=all&sort=title');
	await page.waitForLoadState('networkidle');
	await page
		.locator('.grid .tile', { hasText: 'Kaori Mama' })
		.filter({ hasNotText: /Duty|Illustrations/ })
		.click();
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.getByRole('heading', { name: 'Kaori Mama', exact: true })).toBeVisible();
}

async function longPress(page: Page, locator: ReturnType<Page['locator']>) {
	await locator.click({ button: 'right' });
}

test('a person page is a 404 while reveal is off, and a grid of their books with it', async ({
	page
}) => {
	const res = await page.goto(CIRCLE);
	expect(res?.status()).toBe(404);

	await reveal(page);
	await page.goto(CIRCLE);
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: 'Hakka Kousha' })).toBeVisible();
	// Four books in the series, two single books: six in all.
	await expect(page.getByRole('tab', { name: /^ALL 6/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /Kaori Mama.*4 BOOKS|4 BOOKS/ })).toBeVisible();
});

test('FAV on a person adds the PEOPLE shelf, and taking it back removes it', async ({ page }) => {
	await reveal(page);
	await page.goto(CIRCLE);
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'FAV', exact: true }).click();
	await expect(page.getByRole('button', { name: 'FAV ✓' })).toBeVisible();

	await page.goto('/?shelf=people');
	await expect(page.getByRole('link', { name: /Hakka Kousha/ })).toBeVisible();

	await page.goto(CIRCLE);
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'FAV ✓' }).click();
	await expect(page.getByRole('button', { name: 'FAV', exact: true })).toBeVisible();
	await page.goto('/');
	await expect(page.getByRole('link', { name: /^PEOPLE/ })).toHaveCount(0);
});

test('a book keeps its own rating, and the series its own', async ({ page }) => {
	await reveal(page);
	await openBooks(page);
	const books = page.getByRole('region', { name: 'Books' });
	await longPress(page, books.getByRole('button', { name: /Laundry Duty/ }));
	const sheet = page.getByRole('dialog', { name: /Laundry Duty/ });
	await sheet.getByRole('button', { name: 'Rate 4' }).click();
	await expect(sheet.getByRole('button', { name: 'Rate 4' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	await page.reload();
	await longPress(page, books.getByRole('button', { name: /Laundry Duty/ }));
	await expect(sheet.getByRole('button', { name: 'Rate 4' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// The series is not rated by its book.
	const panel = page.getByRole('region', { name: 'About this series' });
	await expect(panel.getByText('UNRATED', { exact: true })).toBeVisible();

	await sheet.getByRole('button', { name: 'Unrated' }).click();
	await expect(sheet.getByText('UNRATED', { exact: true })).toBeVisible();
});

test('TAKE OUT makes a single book again, and UNDO puts it back in its place', async ({ page }) => {
	await reveal(page);
	await openBooks(page);
	const books = page.getByRole('region', { name: 'Books' });
	await longPress(page, books.getByRole('button', { name: /Night Duty/ }));
	await page.getByRole('button', { name: 'TAKE OUT' }).click();
	await expect(page.getByText(/TAKEN OUT · KAORI MAMA ON NIGHT DUTY/)).toBeVisible();
	await expect(books.getByRole('button', { name: /Night Duty/ })).toHaveCount(0);

	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(books.getByRole('button', { name: /Night Duty/ })).toBeVisible();
	await expect(books.getByRole('button', { name: /Night Duty/ })).toContainText('03');
});

test('grouping two single books from the person page, then UNDO', async ({ page }) => {
	await reveal(page);
	await page.goto(CIRCLE);
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.grid li', { hasText: 'Holiday Duty' }).getByRole('button').click();
	await page.locator('.grid li', { hasText: 'Illustrations 2024' }).getByRole('button').click();
	await page.getByRole('button', { name: /GROUP/ }).click();

	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await expect(sheet.getByRole('textbox', { name: 'Series name' })).toHaveValue('Kaori Mama');
	await sheet.getByRole('textbox', { name: 'Series name' }).fill('Kaori Mama Extras');
	await sheet.getByRole('button', { name: /CREATE SERIES · 2 BOOKS/ }).click();

	await expect(page).toHaveURL(/\/series\/\d+\?created=2/);
	await expect(page.getByText(/SERIES CREATED/)).toBeVisible();
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page).toHaveURL(/\/($|\?)/);

	await page.goto(CIRCLE);
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('tab', { name: /^ALL 6/ })).toBeVisible();
	await expect(page.locator('.grid li', { hasText: 'Holiday Duty' })).toBeVisible();
});

test('a single book with look-alikes is offered as one series, and NOT A SERIES can be undone', async ({
	page
}) => {
	await reveal(page);
	await page.goto(CIRCLE);
	await page.waitForLoadState('networkidle');
	await page.locator('.grid li', { hasText: 'Holiday Duty' }).getByRole('button').click();
	await expect(page.getByText('MIGHT BE ONE SERIES')).toBeVisible();

	// That it stays dismissed across visits is books-db.spec.ts's to prove.
	await page.getByRole('button', { name: 'NOT A SERIES' }).click();
	await expect(page.getByText('MIGHT BE ONE SERIES')).toHaveCount(0);
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.getByText('MIGHT BE ONE SERIES')).toBeVisible();
});

test('every book in a series shows its own cover, made from its pages', async ({ page }) => {
	await reveal(page);
	const covers: number[] = [];
	page.on('response', (r) => {
		if (/\/api\/entries\/\d+\/cover\?v=/.test(r.url()))
			covers.push(r.headers()['content-type'] === 'image/webp' ? r.status() : -1);
	});
	await openBooks(page);
	await expect.poll(() => covers.length).toBeGreaterThanOrEqual(4);
	expect(covers.every((s) => s === 200)).toBe(true);
});

test('a tap on a book opens its pages on the series screen, and ← goes back to the books', async ({
	page
}) => {
	await reveal(page);
	await openBooks(page);
	const series = page.url().replace(/\?.*$/, '');
	const books = page.getByRole('region', { name: 'Books' });
	await books.getByRole('button', { name: /Laundry Duty/ }).click();
	await expect(page).toHaveURL(new RegExp(`^${series}\\?(.*&)?book=\\d+`));
	await expect(page.getByText('01 — PAGES')).toBeVisible();
	await page.locator('a.cell.back').click();
	await expect(page).toHaveURL(new RegExp(`^${series}(\\?(?!.*book=).*)?$`));
	await expect(books).toBeVisible();
});

test('a group that can’t be made says why, and the sheet stays open', async ({ page }) => {
	await reveal(page);
	await page.goto('/?shelf=all&sort=title');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	// A hidden book and a visible one: they can't share a series.
	for (const t of ['Onsen Ryokan no Yoru', 'Hoshi no Umi no Tabibito'])
		await page.locator('.grid .tile', { hasText: t }).click();
	await page.getByRole('button', { name: /GROUP/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await sheet.getByRole('textbox', { name: 'Series name' }).fill('Mixed');
	await sheet.getByRole('button', { name: /CREATE SERIES/ }).click();
	await expect(sheet.getByRole('alert')).toHaveText(
		/HIDDEN AND VISIBLE BOOKS CAN.T SHARE A SERIES/
	);
	await expect(sheet).toBeVisible();
});

test('TAGS on a book’s sheet edits that book’s tags, and the series follows', async ({ page }) => {
	await reveal(page);
	await openBooks(page);
	const books = page.getByRole('region', { name: 'Books' });
	await longPress(page, books.getByRole('button', { name: /Laundry Duty/ }));
	const sheet = page.getByRole('dialog', { name: /Laundry Duty/ });
	await sheet.getByRole('button', { name: 'TAGS' }).click();
	const tags = page.getByRole('dialog', { name: 'Book tags' });
	await expect(tags).toContainText('TAGS · KAORI MAMA ON LAUNDRY DUTY');
	// The book's own tags, and no shelves: those belong to the series.
	await expect(tags.getByText('SHELVES', { exact: true })).toHaveCount(0);
	await tags.getByRole('textbox', { name: /Add a tag/ }).fill('tag:e2e-beach');
	await tags.getByRole('textbox', { name: /Add a tag/ }).press('Enter');
	await expect(tags.locator('.chip', { hasText: 'e2e-beach' })).toBeVisible();

	// Taken off again: gone from the book, and from the series with it.
	await tags.getByRole('button', { name: 'Remove tag:e2e-beach' }).click();
	await expect(tags.locator('.chip', { hasText: 'e2e-beach' })).toHaveCount(0);
	await tags.getByRole('button', { name: 'DONE' }).click();
	await page.goto('/?tag=' + encodeURIComponent('tag:e2e-beach'));
	await expect(page.locator('.grid .tile', { hasText: 'Kaori Mama' })).toHaveCount(0);
});
