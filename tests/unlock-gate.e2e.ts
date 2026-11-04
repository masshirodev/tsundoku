import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from './helpers/hydrated';

/**
 * The fingerprint gate for /reveal (doc/PRIVACY.md), with Chromium's virtual
 * authenticator standing in for the tablet's fingerprint sensor. Enrolling
 * gates /reveal for the whole shared database, which other specs use, so
 * this file is its own Playwright project that runs after all the others
 * (playwright.config.ts), and it removes the gate before it ends.
 */
test.describe.configure({ mode: 'serial' });

async function authenticator(page: Page): Promise<{ cdp: CDPSession; id: string }> {
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
	return { cdp, id: authenticatorId };
}

async function command(page: Page, text: string) {
	await page.goto('/search');
	await page.getByRole('searchbox').fill(text);
	await page.keyboard.press('Enter');
}

test('lock, reveal with the fingerprint, refuse without it, and unlock', async ({ page }) => {
	const { cdp, id } = await authenticator(page);

	// No gate yet: /reveal is the plain command, and /lock enrols this device.
	await command(page, '/lock');
	await expect(page.getByText('LOCKED · /reveal NOW ASKS THIS DEVICE')).toBeVisible();

	// A plain POST of /reveal no longer reveals anything.
	await page.request.post('/search', {
		headers: { origin: 'http://localhost:4183' },
		form: { q: '/reveal' }
	});
	await page.goto('/');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);

	// With the fingerprint, it does.
	await command(page, '/reveal');
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();

	// A fingerprint not accepted: NOT UNLOCKED, nothing shown, TRY AGAIN.
	await cdp.send('WebAuthn.setUserVerified', { authenticatorId: id, isUserVerified: false });
	await command(page, '/reveal');
	await expect(page.getByText('NOT UNLOCKED')).toBeVisible();
	await expect(page.getByText('FINGERPRINT NOT ACCEPTED · NOTHING SHOWN')).toBeVisible();
	await page.goto('/');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);

	// Removing the gate takes the fingerprint too.
	await cdp.send('WebAuthn.setUserVerified', { authenticatorId: id, isUserVerified: true });
	await command(page, '/unlock');
	await expect(page.getByText('UNLOCKED · /reveal ASKS NOTHING')).toBeVisible();

	// And /reveal is plain again.
	await command(page, '/reveal');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
});
