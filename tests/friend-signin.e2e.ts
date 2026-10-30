import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { FRIEND_HOME, FRIEND_PORT } from './friend-world';

/**
 * A friend's sign-in (doc/SIGN-IN.md; card c189), on the friend project's own
 * server (tests/friend-setup.ts): SET UP on first open, a password or none,
 * changing and removing it in SETTINGS, and the reset the launcher does.
 * One login.json for the server, so these run in order.
 */
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'first-password';
const NEXT = 'second-password';
const LOGIN_FILE = join(FRIEND_HOME, 'login.json');

test('the first open is SET UP, and nothing else answers until it’s done', async ({
	page,
	request
}) => {
	rmSync(LOGIN_FILE, { force: true });
	await page.goto('/series/1');
	await expect(page).toHaveURL('/setup');
	await expect(page.getByText('00 — SET UP')).toBeVisible();
	// The library's sidebar isn't drawn around it.
	await expect(page.getByRole('complementary', { name: 'Shelves' })).toHaveCount(0);
	expect((await request.get('/api/series/1', { maxRedirects: 0 })).status()).toBe(401);
	// The sign-in page has nothing to sign in to yet.
	await page.goto('/login');
	await expect(page).toHaveURL('/setup');
});

test('NO PASSWORD asks first, and BACK goes back', async ({ page }) => {
	await page.goto('/setup');
	await page.getByRole('button', { name: 'NO PASSWORD' }).click();
	await expect(page.getByText('00 — NO PASSWORD?')).toBeVisible();
	await expect(page.getByText(/Anyone who uses this computer can open tsundoku/)).toBeVisible();
	await page.getByRole('button', { name: 'BACK' }).click();
	await expect(page.getByText('00 — SET UP')).toBeVisible();
});

test('a password is set twice alike, and signs this browser in', async ({ page }) => {
	await page.goto('/setup');
	await page.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
	await page.getByLabel('AGAIN').fill('something-else');
	await page.getByRole('button', { name: 'SET PASSWORD' }).click();
	await expect(page.getByText('THE TWO PASSWORDS ARE DIFFERENT')).toBeVisible();

	await page.getByLabel('PASSWORD', { exact: true }).fill(PASSWORD);
	await page.getByLabel('AGAIN').fill(PASSWORD);
	await page.getByRole('button', { name: 'SET PASSWORD' }).click();
	await expect(page).toHaveURL('/');
	await expect(page.getByRole('complementary', { name: 'Shelves' })).toBeVisible();
	// Set once: SET UP is gone.
	await page.goto('/setup');
	await expect(page).toHaveURL('/');
});

test('another browser signs in with it, and only with it', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login/);
	await page.getByLabel('PASSWORD').fill('wrong-password');
	await page.getByRole('button', { name: 'UNLOCK' }).click();
	await expect(page.getByText('THAT PASSWORD IS NOT RIGHT')).toBeVisible();
	await expect(page.getByText(/Forgot it\?/)).toBeVisible();

	await page.getByLabel('PASSWORD').fill(PASSWORD);
	await page.getByRole('button', { name: 'UNLOCK' }).click();
	await expect(page).toHaveURL('/');
	await expect(page.getByRole('complementary', { name: 'Shelves' })).toBeVisible();
});

test('SETTINGS changes it, and the old one stops working', async ({ page, browser }) => {
	await page.goto('/login');
	await page.getByLabel('PASSWORD').fill(PASSWORD);
	await page.getByRole('button', { name: 'UNLOCK' }).click();
	await expect(page).toHaveURL('/');

	await page.goto('/settings#s-devices');
	await page.getByRole('button', { name: 'CHANGE', exact: true }).click();
	await page.getByLabel('CURRENT PASSWORD').fill(PASSWORD);
	await page.getByLabel('NEW PASSWORD').fill(NEXT);
	await page.getByLabel('AGAIN').fill(NEXT);
	await page.getByRole('button', { name: 'CHANGE PASSWORD' }).click();
	await expect(page.getByText('PASSWORD CHANGED')).toBeVisible();
	// This browser stays in.
	await page.goto('/');
	await expect(page.getByRole('complementary', { name: 'Shelves' })).toBeVisible();

	const other = await browser.newPage({ storageState: { cookies: [], origins: [] } });
	await other.goto('/login');
	await other.getByLabel('PASSWORD').fill(PASSWORD);
	await other.getByRole('button', { name: 'UNLOCK' }).click();
	await expect(other.getByText('THAT PASSWORD IS NOT RIGHT')).toBeVisible();
	await other.getByLabel('PASSWORD').fill(NEXT);
	await other.getByRole('button', { name: 'UNLOCK' }).click();
	await expect(other).toHaveURL('/');
	await other.close();
});

test('SETTINGS removes it, after asking, and then nobody signs in', async ({ page, browser }) => {
	await page.goto('/login');
	await page.getByLabel('PASSWORD').fill(NEXT);
	await page.getByRole('button', { name: 'UNLOCK' }).click();
	await expect(page).toHaveURL('/');

	await page.goto('/settings#s-devices');
	await page.getByRole('button', { name: 'REMOVE', exact: true }).click();
	await expect(page.getByRole('button', { name: 'YES, REMOVE THE PASSWORD' })).toBeVisible();
	await page.getByLabel('CURRENT PASSWORD').fill(NEXT);
	await page.getByRole('button', { name: 'YES, REMOVE THE PASSWORD' }).click();
	await expect(page.getByText('PASSWORD REMOVED')).toBeVisible();

	const other = await browser.newPage({ storageState: { cookies: [], origins: [] } });
	await other.goto('/');
	await expect(other).toHaveURL('/');
	await expect(other.getByRole('complementary', { name: 'Shelves' })).toBeVisible();
	await other.close();
});

test('the launcher’s reset brings SET UP back, and NO PASSWORD goes straight in', async ({
	page
}) => {
	// What `tsundoku --reset-password` does: the file goes, the library stays.
	rmSync(LOGIN_FILE, { force: true });
	await page.goto('/');
	await expect(page).toHaveURL('/setup');
	await page.getByRole('button', { name: 'NO PASSWORD' }).click();
	await page.getByRole('button', { name: 'YES, NO PASSWORD' }).click();
	await expect(page).toHaveURL('/');
	await expect(page.getByRole('complementary', { name: 'Shelves' })).toBeVisible();
});

test('another site’s name pointed at this computer is refused', async ({ request }) => {
	const r = await request.get('/', {
		headers: { host: `evil.example:${FRIEND_PORT}` },
		maxRedirects: 0
	});
	expect(r.status()).toBe(403);
});
