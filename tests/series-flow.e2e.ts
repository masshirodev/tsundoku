import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The series screen end to end, on the seeded library. Writes run serially on
 * the tablet project only (the others ignore `*-flow.e2e.ts`), and each test
 * restores what it changed.
 */
test.describe.configure({ mode: 'serial' });

// Flow files run in parallel with each other against one database, so each
// owns its series: this file touches Mount Hua, Tower of God, Ame no Hi and
// Lookism, and nothing else. See doc/TESTING.md.

async function open(page: Page, title: string, shelf = 'all') {
	await page.goto(
		shelf === 'all' ? '/?sort=title' : `/?shelf=${encodeURIComponent(shelf)}&sort=title`
	);
	// Under the full parallel run hydration can trail the load event.
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: title }).click();
	// The title shows at once from the tile (doc/WAITING.md): wait for the
	// screen itself, which is there once the URL has moved.
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

test('a tap on a tile opens the series, and back returns to the shelf it came from', async ({
	page
}) => {
	await page.goto('/?sort=title');
	await page.getByRole('link', { name: /^TO FINISH/ }).click();
	await expect(page).toHaveURL(/shelf=c%3A\d+/);
	await page.locator('.grid .tile', { hasText: 'Return of the Mount Hua Sect' }).click();
	await expect(page).toHaveURL(/\/series\/\d+\?from=c%3A\d+/);
	await expect(page.getByRole('link', { name: /TO FINISH/ })).toBeVisible();
	await page.getByRole('link', { name: /TO FINISH/ }).click();
	await expect(page).toHaveURL(/\?shelf=c%3A\d+/);
});

test('rating fills up to the choice, 0 clears it, and FAV toggles', async ({ page }) => {
	await open(page, 'Return of the Mount Hua Sect');
	const panel = page.getByRole('region', { name: 'About this series' });
	await expect(panel.getByText('UNRATED', { exact: true })).toBeVisible();

	await panel.getByRole('button', { name: 'Rate 3' }).click();
	await expect(panel.getByText('RATING', { exact: true })).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Rate 3' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.reload();
	await expect(panel.getByRole('button', { name: 'Rate 3' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	await panel.getByRole('button', { name: 'Unrated' }).click();
	await expect(panel.getByText('UNRATED', { exact: true })).toBeVisible();

	await panel.getByRole('button', { name: 'FAV', exact: true }).click();
	await expect(panel.getByRole('button', { name: 'FAV ✓' })).toBeVisible();
	await panel.getByRole('button', { name: 'FAV ✓' }).click();
	await expect(panel.getByRole('button', { name: 'FAV', exact: true })).toBeVisible();
});

test('direction is stored per series', async ({ page }) => {
	await open(page, 'Return of the Mount Hua Sect');
	const ltr = page.getByRole('button', { name: 'L→R' });
	await ltr.click();
	await expect(ltr).toHaveAttribute('aria-pressed', 'true');
	await page.reload();
	await expect(page.getByRole('button', { name: 'L→R' })).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: '↓ SCROLL' }).click();
	await expect(page.getByRole('button', { name: '↓ SCROLL' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('tags are added from a suggestion and removed with ✕', async ({ page }) => {
	await open(page, 'Return of the Mount Hua Sect');
	await page.getByRole('button', { name: 'EDIT' }).nth(1).click();
	const sheet = page.getByRole('dialog', { name: 'Shelves and tags' });
	await sheet.getByRole('textbox', { name: /Add a tag/ }).fill('genre:ise');
	await sheet.getByRole('button', { name: /genre\s+isekai/ }).click();
	await expect(sheet.getByRole('button', { name: 'Remove genre:isekai' })).toBeVisible();
	await sheet.getByRole('button', { name: 'DONE' }).click();
	await expect(
		page.getByRole('region', { name: 'About this series' }).getByText('isekai')
	).toBeVisible();

	await page.getByRole('button', { name: 'EDIT' }).nth(1).click();
	await sheet.getByRole('button', { name: 'Remove genre:isekai' }).click();
	await expect(sheet.getByRole('button', { name: 'Remove genre:isekai' })).toHaveCount(0);
});

test('multi-select marks a range read, counting what it will change', async ({ page }) => {
	await open(page, 'Return of the Mount Hua Sect');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const row = (n: number) => page.locator(`.entry:has(.num:text-is("${n}")) .entry-btn`);
	await row(90).click();
	await page.getByRole('button', { name: 'RANGE' }).click();
	await row(93).click();
	await expect(page.getByText('4 SELECTED')).toBeVisible();
	const markRead = page.getByRole('button', { name: /MARK READ/ });
	await expect(markRead).toContainText('4');
	await markRead.click();
	await expect(page.getByRole('button', { name: /MARK UNREAD/ })).toContainText('4');
	await page.getByRole('button', { name: /MARK UNREAD/ }).click();
	await expect(markRead).toContainText('4');
});

test('a long press on a chapter reads everything up to it, and UNDO puts it back', async ({
	page
}) => {
	await open(page, 'Return of the Mount Hua Sect');
	const row = (n: number) => page.locator(`.entry:has(.num:text-is("${n}")) .entry-btn`);
	const unread = await page.locator('.entry.unread').count();
	await row(95).click({ button: 'right' }); // the context menu is the long press
	await expect(page.getByText('MARKED READ THROUGH CH. 95')).toBeVisible();
	await expect(page).toHaveURL(/\/series\/\d+/);
	await expect(page.locator('.entry:has(.num:text-is("95"))')).not.toHaveClass(/unread/);
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.getByText('MARKED READ THROUGH CH. 95')).toHaveCount(0);
	await expect(page.locator('.entry.unread')).toHaveCount(unread);
});

test('# jumps into the fold and opens it', async ({ page }) => {
	await open(page, 'Tower of God');
	await expect(page.getByRole('button', { name: /↑ 1 – 591/ })).toBeVisible();
	await page.getByRole('button', { name: 'Go to chapter number' }).click();
	await page.getByLabel('GO TO #').fill('540');
	await page.getByLabel('GO TO #').press('Enter');
	await expect(page.locator('#entry-' + (await entryId(page, 540)))).toBeInViewport();
	await expect(page.getByRole('button', { name: /↑ 1 – 591/ })).toHaveCount(0);
});

async function entryId(page: Page, n: number) {
	return page
		.locator(`.entry:has(.num:text-is("${n}"))`)
		.evaluate((el) => el.id.replace('entry-', ''));
}

test('hiding a series with reveal off leaves it, and it is then unreachable', async ({ page }) => {
	await open(page, 'Ame no Hi no Toshokan');
	const url = page.url();
	await page.getByRole('button', { name: 'HIDE', exact: true }).click();
	await expect(page).toHaveURL('/');
	const res = await page.request.get(url);
	expect(res.status()).toBe(404);

	// Restore: reveal, unhide from the series screen, end reveal.
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/reveal');
	await page.getByRole('searchbox').press('Enter');
	// /reveal asks the server whether a fingerprint is needed before it goes.
	await page.waitForURL(/\/$/);
	await page.goto(url);
	await page.getByRole('button', { name: 'UNHIDE' }).click();
	await expect(page.getByRole('button', { name: 'HIDE', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	expect((await page.request.get(url)).status()).toBe(200);
});

test('a tapped suggestion wins over the half-typed text beside it', async ({ page }) => {
	await open(page, 'Lookism');
	await page.getByRole('button', { name: 'EDIT' }).nth(1).click();
	const sheet = page.getByRole('dialog', { name: 'Shelves and tags' });
	await sheet.getByRole('textbox', { name: /Add a tag/ }).fill('genre:ise');
	await sheet.getByRole('button', { name: /genre\s+isekai/ }).click();
	await expect(sheet.getByRole('button', { name: 'Remove genre:isekai' })).toBeVisible();
	await expect(sheet.getByRole('button', { name: 'Remove genre:ise', exact: true })).toHaveCount(0);
	await sheet.getByRole('button', { name: 'Remove genre:isekai' }).click();
	await expect(sheet.getByRole('button', { name: 'Remove genre:isekai' })).toHaveCount(0);
});

test('the cover resumes, as ▶ CONTINUE does', async ({ page }) => {
	await open(page, 'Tower of God');
	const cta = await page
		.getByRole('link', { name: /▶ (CONTINUE|START|READ)/ })
		.first()
		.getAttribute('href');
	const cover = page.locator('.panel a.cover');
	await expect(cover).toHaveAttribute('href', cta!);
	await cover.click();
	await page.waitForURL(/\/read\/\d+/);
});
