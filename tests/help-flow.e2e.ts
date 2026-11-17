import { test, expect } from './fixtures';

/**
 * HELP (doc/HELP.md, the HELP handoff): the list, a topic, a topic
 * that can't apply here, the ways in, and a "?" in SETTINGS opening its
 * sheet. The reader's "?" is reader-flow.e2e.ts's; a series' DOWNLOAD "?" is
 * downloads-flow.e2e.ts's (the only server with downloading on).
 */

test('HELP lists seven topics, each naming its parts', async ({ page }) => {
	await page.goto('/help');
	const topics = page.getByRole('navigation', { name: 'Topics' }).getByRole('link');
	await expect(topics).toHaveCount(7);
	await expect(topics.nth(2)).toContainText('Finding and downloading');
	await expect(topics.nth(2)).toContainText(
		'BROWSE · EXTENSIONS · ADD · DOWNLOAD · FOLLOW · QUEUE'
	);
	// The shared server has no updater: UPDATES says so, and still opens.
	await expect(topics.nth(4)).toContainText('NOT HERE');
	await expect(topics.nth(0)).toHaveAttribute('href', '/start');
	await expect(
		page.getByText('Save a report and send it to whoever gave you tsundoku.')
	).toBeVisible();
});

test('a topic: IN SHORT, its parts with their screens, ← and →, STILL STUCK (1A)', async ({
	page
}) => {
	await page.goto('/help/downloading');
	await expect(
		page.getByRole('heading', { level: 2, name: 'Finding and downloading' })
	).toBeVisible();
	const short = page.getByRole('region', { name: 'In short' });
	await expect(short.locator('p')).toHaveCount(3);
	await expect(page.getByRole('heading', { level: 3 })).toHaveText([
		'01 — EXTENSIONS AND REPOSITORIES',
		'02 — READING ONLINE',
		'03 — ADD, DOWNLOAD, FOLLOW',
		'04 — THE QUEUE'
	]);
	await expect(page.locator('#download .tw, .tw').first()).toHaveText('+ ADD');
	await expect(page.getByRole('link', { name: '← 02 READING' })).toBeVisible();
	await page.getByRole('link', { name: '04 YOUR →' }).click();
	await expect(page).toHaveURL(/\/help\/phone$/);
	await expect(page.locator('#tailscale')).toBeVisible();
	await expect(page.getByRole('link', { name: '07 — WHEN IT BREAKS →' })).toBeVisible();
});

test('a topic that can’t apply here says so in a dashed band (1E)', async ({ page }) => {
	await page.goto('/help/updates');
	const band = page.getByRole('note');
	await expect(band).toContainText('NOT ON THIS INSTALL · IT HAS NO UPDATER');
	await expect(band).toHaveCSS('border-top-style', 'dashed');
	await expect(page.getByRole('region', { name: 'In short' })).toBeVisible();
});

test('01 is the checklist; an unknown topic is not found', async ({ page }) => {
	await page.goto('/help/start');
	await expect(page).toHaveURL(/\/start$/);
	expect((await page.goto('/help/nope'))?.status()).toBe(404);
});

test('REPORT’s ? opens its In short in a sheet, and WHOLE TOPIC lands at the part', async ({
	page
}) => {
	await page.goto('/settings?section=library');
	const ask = page.getByRole('button', { name: 'Help: a report' });
	await ask.click();
	const sheet = page.getByRole('dialog', { name: 'Help' });
	await expect(sheet).toContainText('HELP · 07 — WHEN SOMETHING BREAKS');
	await expect(sheet.getByRole('region', { name: 'In short' }).locator('p')).toHaveCount(3);
	await expect(ask).toHaveAttribute('aria-expanded', 'true');
	await expect(sheet).toContainText('OPENS AT 01 — SAVE A REPORT');
	await sheet.getByRole('link', { name: /WHOLE TOPIC →/ }).click();
	await expect(page).toHaveURL(/\/help\/report#save$/);
});

test('the ways in: the sidebar’s last line, and MORE’s row', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'MORE' }).click();
	await expect(page.getByRole('link', { name: /HELP →\s*7 TOPICS/ })).toBeVisible();
	// The sidebar is a fine pointer's (this project is a touch tablet): read, not clicked.
	const side = page.locator('.side-foot a').last();
	await expect(side).toHaveText('HELP');
	await expect(side).toHaveAttribute('href', '/help');
	await page.goto('/help');
	await expect(page.locator('.side-foot a').last()).toHaveAttribute('aria-current', 'page');
});
