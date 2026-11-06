import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * tsundoku's Android app updating itself (c614; doc/UPDATES.md, "The Android
 * apps"), against a stand-in for the app's bridge: the page only says what the
 * bridge tells it, and the real one is covered by the app's JVM tests.
 */
const release = { version: '2099.01.01', date: '2099-01-01', notes: 'Something new.', size: 1000 };
const running = { running: '2026.11.05', checkedAt: 1 };

async function asApp(page: Page, state: object | null) {
	await page.addInitScript((s) => {
		const w = window as unknown as Record<string, unknown>;
		w.appCalls = [];
		w.TsundokuTV = {
			appUpdate: () => (s ? JSON.stringify(s) : ''),
			appCheck: () => (w.appCalls as string[]).push('check'),
			appDownload: () => (w.appCalls as string[]).push('download')
		};
	}, state);
}

const tell = (page: Page, state: object) =>
	page.evaluate((s) => {
		(window as unknown as { tsundokuAppUpdate: (s: object) => void }).tsundokuAppUpdate(s);
	}, state);
const calls = (page: Page) =>
	page.evaluate(() => (window as unknown as { appCalls: string[] }).appCalls);
const offerModal = (page: Page) => page.getByRole('dialog', { name: 'A new version' });

test('a browser has no THIS APP row and no offer', async ({ page }) => {
	await page.goto('/settings');
	await expect(page.getByText('DEVICES').first()).toBeVisible();
	await expect(page.getByText('THIS APP')).toHaveCount(0);
});

test('an app with no updater draws nothing either', async ({ page }) => {
	await asApp(page, null);
	await page.goto('/settings');
	await expect(page.getByText('DEVICES').first()).toBeVisible();
	await expect(page.getByText('THIS APP')).toHaveCount(0);
});

test('THIS APP says the version running, CHECK asks the app, and UPDATE starts it', async ({
	page
}) => {
	await asApp(page, { ...running, phase: 'current' });
	await page.goto('/settings');
	const row = page.locator('.row.device', { hasText: 'THIS APP' });
	await expect(row).toContainText('2026.11.05');
	await expect(row).toContainText('UP TO DATE');
	await expect(row.getByRole('button', { name: 'UPDATE' })).toHaveCount(0);
	await row.getByRole('button', { name: 'CHECK' }).click();
	expect(await calls(page)).toEqual(['check']);

	await tell(page, { ...running, ...release, phase: 'available' });
	await expect(row).toContainText('2099.01.01 IS OUT');
	await expect(page.getByText('Something new.')).toBeVisible();
	await row.getByRole('button', { name: 'UPDATE' }).click();
	expect(await calls(page)).toEqual(['check', 'download']);

	await tell(page, { ...running, ...release, phase: 'downloading', got: 500 });
	await expect(row).toContainText('DOWNLOADING 50%');
	await expect(row.getByRole('button', { name: 'CHECK' })).toBeDisabled();
});

test('the library offers the app its release, and LATER waits a day', async ({ page }) => {
	await asApp(page, { ...running, ...release, phase: 'available' });
	await page.goto('/');
	await expect(offerModal(page)).toContainText('2099.01.01');
	await expect(offerModal(page)).toContainText('RUNNING 2026.11.05');
	await offerModal(page).getByRole('button', { name: 'LATER' }).click();
	await expect(offerModal(page)).toHaveCount(0);
	await page.reload();
	await expect(page.locator('.grid, .tile').first()).toBeVisible();
	await expect(offerModal(page)).toHaveCount(0);
});

test('UPDATE follows the download through HIDE, its band, and on to Android', async ({ page }) => {
	await asApp(page, { ...running, ...release, phase: 'available' });
	await page.goto('/');
	await offerModal(page).getByRole('button', { name: 'UPDATE' }).click();
	expect(await calls(page)).toEqual(['download']);

	await tell(page, { ...running, ...release, phase: 'downloading', got: 500 });
	const updating = page.getByRole('dialog', { name: 'Updating' });
	await expect(updating).toContainText('Downloading');
	await updating.getByRole('button', { name: 'HIDE' }).click();
	await expect(updating).toHaveCount(0);
	await expect(page.getByText(/50%/)).toBeVisible();

	// A finished download passes through `ready` on its way to installing.
	await tell(page, { ...running, ...release, phase: 'ready' });
	await tell(page, { ...running, ...release, phase: 'installing' });
	await expect(page.getByText(/INSTALLING/i).first()).toBeVisible();
});

test('a failed update says why and tries again; a cancelled prompt offers it again', async ({
	page
}) => {
	await asApp(page, { ...running, ...release, phase: 'available' });
	await page.goto('/');
	await offerModal(page).getByRole('button', { name: 'UPDATE' }).click();
	await tell(page, { ...running, ...release, phase: 'error', error: 'THE DOWNLOAD STOPPED' });
	const failed = page.getByRole('dialog', { name: 'Update failed' });
	await expect(failed).toContainText('THE DOWNLOAD STOPPED');
	await failed.getByRole('button', { name: 'TRY AGAIN' }).click();
	expect(await calls(page)).toEqual(['download', 'download']);

	await tell(page, { ...running, ...release, phase: 'installing' });
	await expect(page.getByRole('dialog', { name: 'Updating' })).toContainText('Installing');
	await tell(page, { ...running, ...release, phase: 'ready' });
	await expect(offerModal(page)).toContainText('2099.01.01');
});

test('a failed check is not a failed update', async ({ page }) => {
	await asApp(page, { ...running, ...release, phase: 'current' });
	await page.goto('/');
	await tell(page, { ...running, ...release, phase: 'error', error: 'NO ANSWER' });
	await expect(page.getByRole('dialog', { name: 'Update failed' })).toHaveCount(0);
	await expect(offerModal(page)).toHaveCount(0);
});
