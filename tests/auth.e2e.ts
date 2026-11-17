import { expect, test } from './fixtures';
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

/**
 * The browser's own chrome (the status bar, the task switcher) takes its
 * colour from `<meta name="theme-color">`, and with two in the head the
 * first wins. The root layout writes the theme's own in the first byte, so
 * the page's shell must carry none ahead of it, or light mode draws a dark
 * bar over a light page. The sign-in page shows it with no session at all.
 */
test('the first byte carries one theme-color, the theme’s own', async ({ page, baseURL }) => {
	const metas = async () =>
		[
			...(await (await page.context().request.get('/login')).text()).matchAll(
				/<meta name="theme-color" content="([^"]*)"/g
			)
		].map((m) => m[1]);
	expect(await metas()).toEqual(['#0e0f10']);
	await page.context().addCookies([{ name: 'tsundoku_theme', value: 'light', url: baseURL! }]);
	expect(await metas()).toEqual(['#f5f4ef']);
});
