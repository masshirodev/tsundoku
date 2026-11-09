import { expect, test } from './fixtures';
import { resetEngine } from './browse-world';

/**
 * EXTENSIONS' SELECT (card c696; doc/BROWSE.md, "Extensions and
 * repositories"): INSTALLED's ticks, the bulk bar and its one press. It runs in
 * the browse project (its name), against tests/browse-setup.ts's fake engine:
 * the rows are the few sources the world seeds, and the presses write
 * tsundoku's own switches, which are a database the other browse-* files share.
 * Every case puts back the switches it set and removes what it installed.
 */

const OPEN = 'e2e.open';
const SHELF = 'ln:shelf';
const WEBTOONS = 'eu.kanade.tachiyomi.extension.all.webtoons';
const FLAGS = ['hidden', 'addedHidden', 'offHistory', 'neverTracked'] as const;

test.beforeEach(async ({ page }) => {
	await resetEngine();
	await page.goto('/browse/extensions');
});

test.afterEach(async ({ page, baseURL }) => {
	const origin = new URL(baseURL!).origin;
	// Every switch this file sets goes back off, for the two seeded packages it
	// ticks; REMOVE keeps a switch the way it keeps its settings (c569).
	for (const pkg of [OPEN, SHELF]) {
		for (const flag of FLAGS)
			await page.request.post(`${origin}/browse/extensions?/flags`, {
				form: { pkg, flag, value: 'false' },
				headers: { origin, accept: 'text/html' },
				maxRedirects: 0
			});
	}
	// A copy that failed half-way leaves Webtoons.com installed; REMOVE is
	// idempotent, and the row's own REMOVE would need the page.
	await page.request.post(`${origin}/browse/extensions?/remove`, {
		form: { pkg: WEBTOONS },
		headers: { origin, accept: 'text/html' },
		maxRedirects: 0
	});
});

const row = (page: import('@playwright/test').Page, name: string) =>
	page.locator('.rows .row', { hasText: name });

/** The bar's cell for one switch. */
const cell = (page: import('@playwright/test').Page, name: string) =>
	page.locator('.bulk .swc', { hasText: name });

test('SELECT is INSTALLED’s, and ✕, Escape and Back each end it', async ({ page }) => {
	await page.goto('/browse/extensions');
	const select = page.locator('.cell.sel');
	await expect(select).toHaveText('SELECT');
	await select.click();
	await expect(page).toHaveURL(/select=1/);
	await expect(page.locator('.bulk')).toBeVisible();
	await expect(page.locator('.cell.count')).toHaveText('0 SELECTED');
	// Leaving the tab would drop the selection without a word.
	await expect(page.locator('.tabs .tab.off')).toHaveCount(2);
	await expect(page.locator('.tabs a.tab', { hasText: 'AVAILABLE' })).toHaveCount(0);

	// A tap ticks the row; a switch press keeps SELECT on, so the cells read back.
	await row(page, 'Open Source').click();
	await expect(page.locator('.cell.count')).toHaveText('1 SELECTED');
	await expect(row(page, 'Open Source').getByRole('checkbox')).toBeChecked();

	// Escape takes SELECT down, without leaving the screen.
	await page.keyboard.press('Escape');
	await expect(page).not.toHaveURL(/select=1/);
	await expect(page.locator('.bulk')).toHaveCount(0);
	await expect(page.locator('.cell.sel')).toBeVisible();

	// ✕ too.
	await page.locator('.cell.sel').click();
	await expect(page.locator('.bulk')).toBeVisible();
	await page.getByRole('link', { name: 'Stop selecting' }).click();
	await expect(page).not.toHaveURL(/select=1/);
	await expect(page.locator('.bulk')).toHaveCount(0);

	// And the browser's Back, which comes back to the plain list.
	await page.locator('.cell.sel').click();
	await expect(page.locator('.bulk')).toBeVisible();
	await page.goBack();
	await expect(page).not.toHaveURL(/select=1/);
	await expect(page.locator('.bulk')).toHaveCount(0);
});

test('SELECT ALL ticks every drawn row, and the count is the drawn rows', async ({ page }) => {
	await page.goto('/browse/extensions');
	const drawn = await page.locator('.rows .row').count();
	await page.locator('.cell.sel').click();
	await page.getByRole('button', { name: 'SELECT ALL' }).click();
	await expect(page.locator('.cell.count')).toHaveText(`${drawn} SELECTED`);
	await expect(page.locator('.rows .row input[type=checkbox]:checked')).toHaveCount(drawn);
	// A section's own TICK / UNTICK, on its label's line.
	const section = page.locator('.label', { hasText: 'NEEDS A HAND' });
	await expect(section.getByRole('link', { name: /^UNTICK/ })).toBeVisible();
	// Every seeded row is in NEEDS A HAND (none has a repository listing any
	// more), so UNTICK takes all of them off and TICK puts them back.
	await section.getByRole('link', { name: /^UNTICK/ }).click();
	await expect(page.locator('.cell.count')).toHaveText('0 SELECTED');
	await section.getByRole('link', { name: /^TICK/ }).click();
	await expect(page.locator('.cell.count')).toHaveText(`${drawn} SELECTED`);
});

test('a mixed selection reads MIXED, and one press sets every source of each', async ({ page }) => {
	// Open Source carries NEVER TRACKED from its own settings page: one of two.
	await page.goto('/browse/100/settings');
	const own = page.locator('form.own', { hasText: 'Never tracked' }).getByRole('switch');
	await own.click();
	await expect(own).toHaveAttribute('aria-checked', 'true');

	await page.goto('/browse/extensions');
	await page.locator('.cell.sel').click();
	await row(page, 'Open Source').click();
	await row(page, 'Shelf Novels').click();
	await expect(page.locator('.cell.count')).toHaveText('2 SELECTED');

	const never = cell(page, 'NEVER TRACKED');
	await expect(never).toHaveAttribute('aria-checked', 'mixed');
	await expect(never).toContainText('MIXED · 1 OF 2');
	// Every cell's second line says what the next press does.
	await expect(never).toContainText('TAP: ALL ON');
	await never.click();

	// The press set both sources, and SELECT stayed on to read it back.
	await expect(never).toHaveAttribute('aria-checked', 'true');
	await expect(never).toContainText('2 OF 2 · TAP: ALL OFF');
	await expect(row(page, 'Open Source')).toContainText('NEVER TRACKED');
	await expect(row(page, 'Shelf Novels')).toContainText('NEVER TRACKED');

	// The plugin's own source was written too: its settings page says so.
	await page.goto('/browse/ln:shelf/settings');
	await expect(
		page.locator('form.own', { hasText: 'Never tracked' }).getByRole('switch')
	).toHaveAttribute('aria-checked', 'true');
});

test('the bar counts UPDATE and OBSOLETE apart, and does not offer what it cannot do', async ({
	page
}) => {
	await page.goto('/browse/extensions');
	await page.locator('.cell.sel').click();
	// Nothing ticked: the switches and UPDATE have nothing to change.
	await expect(page.locator('.bulk .swc', { hasText: 'UPDATE' })).toBeDisabled();
	await expect(page.locator('.bulk .swc', { hasText: 'REMOVE' })).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	// The failed row's sources are known to this world, so it ticks and counts.
	await row(page, 'Broken Source').click();
	await expect(cell(page, 'NEVER TRACKED')).toBeEnabled();
	await expect(cell(page, 'NEVER TRACKED')).toContainText('TAP: ALL ON');
	await expect(page.locator('.bulk .swc', { hasText: 'UPDATE' })).toContainText('UPDATE 0');
});
