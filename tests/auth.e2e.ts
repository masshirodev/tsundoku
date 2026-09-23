import { expect, test } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';

// Start signed out: this spec is about the door, not the room.
test.use({ storageState: { cookies: [], origins: [] } });

test('everything but the login form is behind the token', async ({ page, request }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login\?next=%2F/);
	const api = await request.get('/api/series/1', { maxRedirects: 0 });
	expect(api.status()).toBe(401);
});

test('a wrong token is refused and the right one lets you in', async ({ page }) => {
	await page.goto('/login');
	await page.getByLabel('TOKEN').fill('nope');
	await page.getByRole('button', { name: 'UNLOCK' }).click();
	await expect(page.getByText('THAT TOKEN IS NOT RIGHT')).toBeVisible();

	await page.getByLabel('TOKEN').fill(E2E_TOKEN);
	await page.getByRole('button', { name: 'UNLOCK' }).click();
	await expect(page).toHaveURL('/');
	await expect(page.getByText('01 — CONTINUE')).toBeVisible();
});
