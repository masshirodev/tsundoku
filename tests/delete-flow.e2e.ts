import { expect, test } from './fixtures';

/**
 * Deleting (doc/DELETING.md), on the seed library, whose sample series have
 * no files: the rows go, the tombstone stays. This file owns Sekai no Owari no
 * Kissaten and Natsu no Owari ni Kimi to, which it deletes; nothing else uses
 * them, and the suite's database is seeded fresh each run.
 */
test.describe.configure({ mode: 'serial' });

const SEKAI = 'Sekai no Owari no Kissaten';
const NATSU = 'Natsu no Owari ni Kimi to';

test('DELETE on the series screen asks first; CANCEL keeps it, DELETE goes back to the shelf', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: SEKAI }).click();
	await page.waitForURL(/\/series\/\d+/);
	const url = page.url();

	await page.getByRole('button', { name: 'DELETE', exact: true }).click();
	const ask = page.getByRole('dialog', { name: `DELETE ${SEKAI.toUpperCase()}?` });
	await expect(ask).toBeVisible();
	await expect(ask.getByText('A SCAN OR A SYNC WON’T BRING IT BACK.')).toBeVisible();
	await ask.getByRole('button', { name: 'CANCEL' }).click();
	await expect(ask).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole('heading', { name: SEKAI })).toBeVisible();

	await page.getByRole('button', { name: 'DELETE', exact: true }).click();
	await ask.getByRole('button', { name: 'DELETE', exact: true }).click();
	// Back where it was opened from, the shelf and order as they were.
	await page.waitForURL(/\/\?shelf=all&sort=title/);
	await expect(page.locator('.grid .tile', { hasText: SEKAI })).toHaveCount(0);
	const res = await page.request.get(url);
	expect(res.status()).toBe(404);
});

test('DELETE in the bulk bar asks with what it names, and deletes the selection', async ({
	page
}) => {
	await page.goto('/?shelf=all&sort=title');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.grid .tile', { hasText: NATSU }).click();
	await page.getByRole('button', { name: 'DELETE', exact: true }).click();
	const ask = page.getByRole('dialog', { name: 'DELETE 1 SERIES?' });
	await expect(ask.getByText(new RegExp(NATSU.toUpperCase()))).toBeVisible();
	await ask.getByRole('button', { name: 'DELETE 1' }).click();
	await expect(ask).toHaveCount(0);
	await expect(page.locator('.grid .tile', { hasText: NATSU })).toHaveCount(0);
	await page.reload();
	await expect(page.locator('.grid .tile', { hasText: NATSU })).toHaveCount(0);
});
