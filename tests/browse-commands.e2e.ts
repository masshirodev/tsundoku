import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Commands in every top search bar (card c697), in BROWSE's world so the
 * source and EXTENSIONS bars can be driven with their fake engine. A leading
 * `/` runs the library's own command (`/api/command`, the same `runCommand`
 * its `?/command` action calls) and the screen stays where it was; anything
 * else is still the bar's own filter. The gated case enrols Chromium's virtual
 * authenticator through `/search`'s own `/lock`, as `unlock-gate.e2e.ts` does,
 * and takes the gate away again in `afterEach` whatever happened: the browse
 * database is shared by every `browse-*` file.
 */

/** This test's virtual authenticator, kept so the teardown answers for the credential it enrolled. */
let session: { cdp: CDPSession; id: string } | null = null;

test.beforeEach(() => {
	session = null;
});

// Two gotos and a WebAuthn prompt per gate case, and a teardown that puts the
// gate away even after a failure: more than a default case's 30 seconds.
test.describe.configure({ timeout: 120_000 });

async function authenticator(page: Page): Promise<{ cdp: CDPSession; id: string }> {
	if (session) return session;
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	session = { cdp, id: authenticatorId };
	return session;
}

/** A search box's own answer to a command: Enter, exactly as a keyboard does. */
async function enter(page: Page, box: ReturnType<Page['getByRole']>, text: string) {
	await box.fill(text);
	await box.press('Enter');
}

/** `/lock` gates this database, so the teardown always tries to open it. */
test.afterEach(async ({ page }) => {
	await authenticator(page);
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/unlock');
	await page.keyboard.press('Enter');
	// With no gate it says NO LOCK; with one it asks this device (which answers).
	await expect(page.getByText(/UNLOCKED · \/reveal ASKS NOTHING|NO LOCK · \/reveal ASKS NOTHING/))
		.toBeVisible({ timeout: 8_000 })
		.catch(() => undefined);
});

test('EXTENSIONS: /reveal runs from its bar and the list stays where it was', async ({ page }) => {
	await page.goto('/browse/extensions?tab=available');
	const box = page.getByRole('searchbox', { name: 'Search the available extensions' });
	await enter(page, box, '/reveal');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await expect(page).toHaveURL(/\/browse\/extensions\?tab=available$/);

	await enter(page, box, '/hide');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
	await expect(page).toHaveURL(/\/browse\/extensions\?tab=available$/);
});

test("BROWSE's search: /reveal runs there too", async ({ page }) => {
	await page.goto('/downloads/search');
	const box = page.getByRole('searchbox', { name: 'Search' });
	await enter(page, box, '/reveal');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await expect(page).toHaveURL(/\/downloads\/search$/);

	await enter(page, box, '/hide');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
});

test("a source's bar: /reveal runs and the source stays open", async ({ page }) => {
	await page.goto('/browse/100');
	const box = page.getByRole('searchbox', { name: 'Search Open Source' });
	await enter(page, box, '/reveal');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	// The screen's own path is kept; `pages` may grow under it as it scrolls on.
	expect(new URL(page.url()).pathname).toBe('/browse/100');

	await enter(page, box, '/hide');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
});

test('an unknown command says so, and a query still filters the bar', async ({ page }) => {
	await page.goto('/browse/extensions?tab=available');
	const box = page.getByRole('searchbox', { name: 'Search the available extensions' });
	await enter(page, box, '/rev');
	await expect(page.getByText('UNKNOWN COMMAND · /REV · NOTHING CHANGED')).toBeVisible();
	await expect(page).toHaveURL(/\/browse\/extensions\?tab=available$/);

	// Not a command: the bar's own list, as before.
	await enter(page, box, 'webtoons');
	await expect(page).toHaveURL(/tab=available.*q=webtoons|q=webtoons.*tab=available/);
});

test('/settings opens the page from a bar', async ({ page }) => {
	await page.goto('/browse/extensions?tab=available');
	await enter(
		page,
		page.getByRole('searchbox', { name: 'Search the available extensions' }),
		'/settings'
	);
	await expect(page).toHaveURL(/\/settings$/);
});

test('a gated box refuses /reveal from EXTENSIONS, as the library does', async ({ page }) => {
	await authenticator(page);
	// /lock's rule: only an unlocked session adds a device (doc/PRIVACY.md).
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/reveal');
	await page.keyboard.press('Enter');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();

	// As unlock-gate.e2e.ts drives it: a fresh /search, then the command.
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/lock');
	await page.keyboard.press('Enter');
	await expect(page.getByText('LOCKED · /reveal NOW ASKS THIS DEVICE')).toBeVisible();

	// Reveal off, but the gate stays on.
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/hide');
	await page.keyboard.press('Enter');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);

	await page.goto('/browse/extensions?tab=available');
	await enter(
		page,
		page.getByRole('searchbox', { name: 'Search the available extensions' }),
		'/reveal'
	);
	await expect(page.getByText('/REVEAL ASKS FOR THIS DEVICE · OPEN SEARCH')).toBeVisible();
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);

	// The gate goes away here, not only in the teardown: the database is shared.
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/unlock');
	await page.keyboard.press('Enter');
	await expect(page.getByText('UNLOCKED · /reveal ASKS NOTHING')).toBeVisible();
});

test('/lock from a bar opens the device prompt on search', async ({ page }) => {
	await authenticator(page);
	await page.goto('/browse/extensions?tab=available');
	await enter(
		page,
		page.getByRole('searchbox', { name: 'Search the available extensions' }),
		'/lock'
	);
	// `go=1` is taken off the URL before the prompt runs.
	await expect(page).toHaveURL(/\/search\?q=%2Flock$/);
	await expect(page.getByText('LOCKED · /reveal NOW ASKS THIS DEVICE')).toBeVisible();
});
