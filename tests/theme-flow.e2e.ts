/**
 * `/light` and `/dark` in SEARCH (src/lib/server/prefs.ts, setTheme): the page
 * takes the theme at once, though the bar posts with `use:enhance` and keeps
 * the page, and it is still the theme after a reload (the server's cookie).
 * Before the layout followed `data.theme`, the switch showed only after a
 * reload.
 */
import { expect, test } from './fixtures';

test('/light and /dark switch the theme at once, and it stays after a reload', async ({ page }) => {
	await page.goto('/search');
	const html = page.locator('html');
	await expect(html).toHaveAttribute('data-theme', 'dark');

	await page.getByRole('searchbox').fill('/light');
	await page.getByRole('searchbox').press('Enter');
	await expect(page).toHaveURL(/\/$/);
	await expect(html).toHaveAttribute('data-theme', 'light');
	await page.reload();
	await expect(html).toHaveAttribute('data-theme', 'light');

	await page.goto('/search');
	await page.getByRole('searchbox').fill('/dark');
	await page.getByRole('searchbox').press('Enter');
	await expect(html).toHaveAttribute('data-theme', 'dark');
	await page.reload();
	await expect(html).toHaveAttribute('data-theme', 'dark');
});
