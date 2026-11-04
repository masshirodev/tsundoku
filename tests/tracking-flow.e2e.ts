import { expect, test } from './fixtures';

/**
 * Tracking end to end (doc/TRACKING.md), as the e2e server has it: no
 * sign-ins, no app keys, no catalogue reachable. Read-only: what the series
 * screen's LISTS line (c424; TRACKING was its own row before) and SETTINGS
 * say when nothing is signed in. Signing in itself leaves
 * for the catalogue's own page, and is the db spec's to check.
 */
test('the LISTS line asks for a sign-in, and sends nothing', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'The Greatest Estate Developer' }).click();
	await page.waitForURL(/\/series\/\d+/);
	// LINK and TRACKING are one row now (c424): AniList's line, MAL folded into it.
	const row = page.locator('[data-row="lists"]');
	const line = row.locator('[data-line="anilist"]');
	await expect(line.locator('.tag')).toHaveText('ANILIST');
	await expect(line.locator('.s .l')).toHaveText(['ANILIST AND MAL · NOT SIGNED IN']);
	await expect(line.locator('.s .r')).toHaveText(['NOTHING SENT']);
	await expect(line.getByRole('link', { name: 'SIGN IN →' })).toHaveAttribute('href', '/settings');
	// EDIT opens the sheet signed out too: ENTRY's CHANGE and UNLINK live there now,
	// and STATUS says nothing is signed in rather than offering what can't be sent.
	await line.getByRole('button', { name: 'EDIT' }).click();
	const sheet = page.getByRole('dialog', { name: 'Tracking' });
	await expect(sheet.locator('.sl', { hasText: 'STATUS' })).toContainText('NOTHING SIGNED IN');
	await expect(sheet.locator('.sts')).toHaveCount(0);
	await expect(sheet.locator('.pr .k')).toHaveText(['ANILIST', 'MAL']);
	await sheet.getByRole('button', { name: 'DONE' }).click();
	await expect(sheet).toBeHidden();
});

test('SETTINGS lists both catalogues, not signed in, and why they can’t be yet', async ({
	page
}) => {
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: '06 — CATALOGUES' })).toBeVisible();
	// Only CATALOGUES' rows: SETTINGS > 05's IMPORT A BACKUP is drawn as an account row too (c438).
	const rows = page.getByRole('region', { name: '06 — CATALOGUES' }).locator('.acct');
	// Ranobe's row is there without a token too, saying so (Ranobe 3b; doc/RANOBE.md).
	await expect(rows.locator('.label')).toHaveText(['ANILIST', 'MAL', 'RANOBE']);
	await expect(rows.locator('.name')).toHaveText([
		'Not signed in',
		'Not signed in',
		'Not configured'
	]);
	await expect(rows.nth(2).locator('.meta')).toHaveText('NO TOKEN · RANOBE_TOKEN IN .ENV');
	// The e2e server has no app keys: no SIGN IN to offer.
	await expect(rows.first().locator('.meta')).toHaveText(
		'THE APP ISN’T REGISTERED · SEE DOC/SECRETS.MD'
	);
	await expect(page.getByRole('link', { name: 'SIGN IN →' })).toHaveCount(0);
});

test('a sign-in that came back refused says so, and changes nothing', async ({ page }) => {
	await page.goto('/settings?signin=refused&service=anilist');
	await expect(page.getByText('ANILIST SIGN-IN CANCELLED')).toBeVisible();
});
