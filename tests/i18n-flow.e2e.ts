import { expect, test, type Page } from '@playwright/test';

/**
 * The languages (doc/I18N.md; card c210), end to end: the browser's language
 * decides until the device chooses, the choice is a cookie the server reads
 * on the first byte, and AUTO hands it back to the browser.
 */

const languageRow = (page: Page) =>
	page.locator('.row', { has: page.locator('.label', { hasText: /^APP LANGUAGE$/ }) });

test.describe('a browser that speaks Portuguese', () => {
	test.use({ locale: 'pt-BR' });

	test('reads tsundoku in Portuguese, from the first byte', async ({ page, request }) => {
		const html = await (
			await request.get('/start', { headers: { 'accept-language': 'pt-BR' } })
		).text();
		expect(html).toMatch(/<html [^>]*lang="pt-BR"/);
		await page.goto('/start');
		await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
		await expect(page.getByRole('heading', { level: 1, name: 'PRIMEIROS PASSOS' })).toBeVisible();
	});

	test('ENGLISH in SETTINGS wins over the browser, and AUTO gives it back', async ({ page }) => {
		await page.goto('/settings#s-devices');
		const row = languageRow(page);
		await expect(row.getByRole('button', { name: 'AUTO' })).toHaveAttribute('aria-pressed', 'true');
		await Promise.all([
			page.waitForEvent('load'),
			row.getByRole('button', { name: 'ENGLISH' }).click()
		]);
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		const cookies = await page.context().cookies();
		expect(cookies.find((c) => c.name === 'tsundoku_lang')?.value).toBe('en');
		await page.goto('/start');
		await expect(page.getByRole('heading', { level: 1, name: 'GET STARTED' })).toBeVisible();

		await page.goto('/settings#s-devices');
		await expect(languageRow(page).getByRole('button', { name: 'ENGLISH' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await Promise.all([
			page.waitForEvent('load'),
			languageRow(page).getByRole('button', { name: 'AUTO' }).click()
		]);
		await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
		expect((await page.context().cookies()).some((c) => c.name === 'tsundoku_lang')).toBe(false);
	});
});

test('an English browser can choose Portuguese', async ({ page }) => {
	await page.goto('/settings#s-devices');
	await Promise.all([
		page.waitForEvent('load'),
		languageRow(page).getByRole('button', { name: 'PORTUGUÊS (BRASIL)' }).click()
	]);
	await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
	await page.goto('/start');
	await expect(page.getByText('00 — PRIMEIROS PASSOS')).toBeVisible();
	// Paraglide's own cookie is never written: AUTO must stay AUTO (doc/I18N.md).
	expect((await page.context().cookies()).some((c) => c.name === 'PARAGLIDE_LOCALE')).toBe(false);
});
