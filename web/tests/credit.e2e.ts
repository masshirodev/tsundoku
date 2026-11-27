/**
 * The "Built with CheerpJ" credit (doc/WEB-EDITION.md, "The engine"; c1135).
 * The web edition's engine runs on CheerpJ, whose free Community licence asks
 * for the credit "in your application": a row in SETTINGS' 07 — BROWSE,
 * under EXTENSIONS. The self-hosted app's absence of it is settings-flow's.
 */
import { expect, test } from '@playwright/test';

test('SETTINGS › BROWSE credits CheerpJ, linking to its site', async ({ page }) => {
	await page.goto('/settings?section=browse');
	await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'ready', { timeout: 30_000 });
	const browse = page.getByRole('region', { name: /07 — BROWSE/ });
	await expect(browse).toBeVisible({ timeout: 30_000 });
	const credit = browse.locator('.row.cheerpj');
	await expect(credit).toContainText('ENGINE');
	await expect(credit).toContainText('BUILT WITH CHEERPJ');
	const link = credit.getByRole('link');
	await expect(link).toHaveAttribute('href', 'https://cheerpj.com/');
	await expect(link).toHaveAttribute('target', '_blank');
});
