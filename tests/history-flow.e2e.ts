import { expect, test } from './fixtures';

/**
 * History end to end (doc/HISTORY.md). Serial, tablet-portrait only. This
 * file owns Mushoku Tensei's history rows, and restores any it removes.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = 'Mushoku Tensei';

test('CONTINUE leads to history, and a row opens its series with the way back', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('link', { name: /OPEN · HISTORY →/ }).click();
	await expect(page).toHaveURL(/\/history$/);
	await expect(page.getByRole('heading', { name: 'HISTORY' })).toBeVisible();
	await expect(page.getByText(/^01 — TODAY$/)).toBeVisible();

	await page
		.getByRole('link', { name: new RegExp(TITLE) })
		.first()
		.click();
	await expect(page).toHaveURL(/\/series\/\d+\?from=history/);
	await page.getByRole('link', { name: /HISTORY/ }).click();
	await expect(page).toHaveURL(/\/history$/);
});

test('a long press offers REMOVE, which removes only the row, and UNDO', async ({ page }) => {
	await page.goto('/history');
	const rows = page.locator('.row', { hasText: TITLE });
	const before = await rows.count();
	expect(before).toBeGreaterThan(0);

	await rows.first().getByRole('link').click({ button: 'right' });
	await expect(rows.first()).toContainText('REMOVES THIS ROW');
	await rows.first().getByRole('button', { name: 'REMOVE' }).click();
	await expect(page.getByText('REMOVED · PROGRESS KEPT')).toBeVisible();
	await expect(rows).toHaveCount(before - 1);

	// Progress is untouched: the series is still in CONTINUE.
	const res = await page.request.get('/');
	expect(await res.text()).toContain(TITLE);

	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(rows).toHaveCount(before);
});

test('✕ keeps the row', async ({ page }) => {
	await page.goto('/history');
	const row = page.locator('.row', { hasText: TITLE }).first();
	await row.getByRole('link').click({ button: 'right' });
	await row.getByRole('button', { name: 'Keep this row' }).click();
	await expect(row).not.toContainText('REMOVES THIS ROW');
});

test('hidden series have no history rows while reveal is off', async ({ page }) => {
	await page.goto('/history');
	await expect(page.getByText('Kaori Mama')).toHaveCount(0);
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
	await page.goto('/history');
	await expect(page.getByText(/Kaori Mama/).first()).toBeVisible();
});
