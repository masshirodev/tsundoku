import { expect, test } from './fixtures';

/**
 * Tracking end to end (doc/TRACKING.md), as the e2e server has it: no
 * sign-ins, no app keys, no catalogue reachable. Read-only: what the TRACKING
 * row and SETTINGS say when nothing is signed in. Signing in itself leaves
 * for the catalogue's own page, and is the db spec's to check.
 */
test('the TRACKING row asks for a sign-in, and sends nothing', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'The Greatest Estate Developer' }).click();
	await page.waitForURL(/\/series\/\d+/);
	const row = page.locator('.track-row');
	await expect(row.locator('.label')).toHaveText('TRACKING');
	await expect(row.locator('.tl-l')).toHaveText(['ANILIST · NOT SIGNED IN', 'MAL · NOT SIGNED IN']);
	await expect(row.locator('.tl-r').first()).toHaveText('NOTHING SENT');
	await expect(row.getByRole('link', { name: 'SIGN IN →' })).toHaveAttribute('href', '/settings');
	// Nothing to edit until a catalogue is signed in.
	await expect(row.getByRole('button', { name: 'EDIT' })).toHaveCount(0);
});

test('SETTINGS lists both catalogues, not signed in, and why they can’t be yet', async ({
	page
}) => {
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: '06 — CATALOGUES' })).toBeVisible();
	const rows = page.locator('.acct');
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
