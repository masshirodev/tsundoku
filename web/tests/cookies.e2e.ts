/**
 * Cookies in the web edition (web/cookies.js, doc/WEB-EDITION.md, "Cookies"):
 * the server's Set-Cookie reaches the browser's own jar through the leading
 * tab, and the jar's cookies reach the server with every request, though a
 * browser forbids script both. The theme is the visible one.
 */
import { expect, test, type Page } from '@playwright/test';

async function started(page: Page) {
	await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'ready', { timeout: 30_000 });
	await expect(page.locator('#svelte-announcer')).toBeAttached({ timeout: 30_000 });
}

test('/light reaches the server and back: the jar keeps it, and a reload is still light', async ({
	page,
	context
}) => {
	await page.goto('/search');
	await started(page);
	const html = page.locator('html');
	await expect(html).toHaveAttribute('data-theme', 'dark');

	await page.getByRole('searchbox').fill('/light');
	await page.getByRole('searchbox').press('Enter');
	await expect(html).toHaveAttribute('data-theme', 'light');
	// The server's Set-Cookie is in the browser's own jar (HttpOnly dropped).
	const jar = await context.cookies();
	expect(jar.find((c) => c.name === 'tsundoku_theme')?.value).toBe('light');

	// A reload is a new start: the server reads the theme from the jar's cookie.
	await page.reload();
	await started(page);
	await expect(html).toHaveAttribute('data-theme', 'light');

	await page.goto('/search');
	await started(page);
	await page.getByRole('searchbox').fill('/dark');
	await page.getByRole('searchbox').press('Enter');
	await expect(html).toHaveAttribute('data-theme', 'dark');
	expect((await context.cookies()).find((c) => c.name === 'tsundoku_theme')?.value).toBe('dark');
});
