/**
 * Keeping the library in the web edition (doc/WEB-EDITION.md, "Keeping the
 * library"): SETTINGS' 05 — LIBRARY says where the library lives and who can
 * clear it, and asking the browser to keep it gives the browser's own answer.
 * Each test is a first visit in a fresh context.
 */
import { expect, test, type Page } from '@playwright/test';

async function openSettings(page: Page) {
	await page.goto('/settings?section=library');
	await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'ready', { timeout: 30_000 });
	await expect(page.locator('#svelte-announcer')).toBeAttached({ timeout: 30_000 });
}

test('05 — LIBRARY says the library is in this browser, not kept for sure, not asked yet', async ({
	page
}) => {
	await openSettings(page);
	const kept = page.locator('[data-row="kept"]');
	await expect(kept).toContainText('KEPT');
	await expect(kept).toContainText(/In this browser, on this (desktop|computer|tablet|phone)/i);
	await expect(kept).toContainText('NOT KEPT FOR SURE · NOT ASKED YET');
	await expect(page.locator('[data-row="cleared"]')).toContainText(
		'NOTHING IS UPLOADED · NO OTHER COPY'
	);
	// Never asked: no band yet (asking waits for the first series added).
	await expect(page.getByText('THIS BROWSER CAN CLEAR THE LIBRARY')).toHaveCount(0);
});

test('ASK gives the browser’s own answer, and SETTINGS says it', async ({ page }) => {
	await openSettings(page);
	await page.locator('[data-row="kept"]').getByRole('button', { name: 'ASK' }).click();
	// Headless browsers answer without a prompt; whichever answer, the page
	// must say what the browser now reports.
	await expect
		.poll(() => page.locator('[data-row="kept"]').innerText())
		.not.toContain('NOT ASKED YET');
	const persisted = await page.evaluate(() => navigator.storage.persisted());
	if (persisted) {
		await expect(page.locator('[data-row="kept"]')).toContainText("WON'T CLEAR IT BY ITSELF");
		await expect(page.getByText('THIS BROWSER CAN CLEAR THE LIBRARY')).toHaveCount(0);
	} else {
		await expect(page.locator('[data-row="kept"]')).toContainText('SAID NO');
		await expect(page.getByText('THIS BROWSER CAN CLEAR THE LIBRARY')).toBeVisible();
		await expect(page.getByRole('button', { name: 'ASK AGAIN' }).first()).toBeVisible();
	}
});
