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

/**
 * A plain POST of a command to /search, from the preview's own origin: the
 * project's `baseURL`, which follows PLAYWRIGHT_PORT. A fixed
 * `http://localhost:4183` here was refused by SvelteKit's CSRF check (403) on
 * any other port before the gate was ever asked, so "refused" passed with no
 * gate at all. A POST that doesn't ask for a document gets the action's
 * own result as JSON: the redirect to the library, either way, and the reveal
 * cookie only when the command ran.
 */
async function plainPost(page: Page, q: string) {
	const origin = new URL(test.info().project.use.baseURL!).origin;
	const res = await page.request.post('/search', { headers: { origin }, form: { q } });
	return {
		status: res.status(),
		result: await res.json().catch(() => res.text()),
		reveals: res
			.headersArray()
			.some(
				(h) =>
					h.name.toLowerCase() === 'set-cookie' &&
					/^tsundoku_reveal=v1\.\d+\.[\w-]{43};/.test(h.value)
			)
	};
}

/** The action's answer to a command: back to the library (src/routes/search/+page.server.ts). */
const toLibrary = { type: 'redirect', status: 303, location: '/' };

test('lock, reveal with the fingerprint, refuse without it, and unlock', async ({ page }) => {
	const { cdp, id } = await authenticator(page);

	// No gate yet: a plain POST of /reveal reaches the action and reveals, so
	// the same POST below is refused by the gate, not before it.
	expect(await plainPost(page, '/reveal')).toEqual({
		status: 200,
		result: toLibrary,
		reveals: true
	});
	await plainPost(page, '/hide');

	// /lock enrols this device.
	await command(page, '/lock');
	await expect(page.getByText('LOCKED · /reveal NOW ASKS THIS DEVICE')).toBeVisible();

	// A plain POST of /reveal reveals nothing: the action still answers, and
	// sets no reveal cookie (runCommand, src/lib/server/prefs.ts).
	expect(await plainPost(page, '/reveal')).toEqual({
		status: 200,
		result: toLibrary,
		reveals: false
	});
	await page.goto('/');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);

	// Nor does a reveal cookie written by hand, as a browser's devtools or a
	// paired TV could: only a value the server signed reveals (prefs.ts).
	await page
		.context()
		.addCookies([
			{ name: 'tsundoku_reveal', value: '1', url: new URL(test.info().project.use.baseURL!).origin }
		]);
	await page.goto('/');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
	await expect(page.getByText('Kaori Mama')).toHaveCount(0);
	await page.context().clearCookies({ name: 'tsundoku_reveal' });

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
