import { expect, test } from './fixtures';

/**
 * The app's update offer on a TV (c614; doc/UPDATES.md, "The Android apps"):
 * the computer's modal never reaches a TV, so this is the one place a remote
 * has to work it. A stand-in for the app's bridge, as in app-update.e2e.ts.
 */
test('a remote reaches UPDATE in the offer and starts it', async ({ page }) => {
	await page.addInitScript(() => {
		const w = window as unknown as Record<string, unknown>;
		w.appCalls = [];
		w.TsundokuTV = {
			appUpdate: () =>
				JSON.stringify({
					running: '2026.11.05',
					checkedAt: 1,
					phase: 'available',
					version: '2099.01.01',
					date: '2099-01-01',
					notes: 'Something new.',
					size: 1000
				}),
			appDownload: () => (w.appCalls as string[]).push('download')
		};
	});
	await page.goto('/');
	const dialog = page.getByRole('dialog', { name: 'A new version' });
	await expect(dialog).toBeVisible();
	const update = dialog.getByRole('button', { name: 'UPDATE' });
	for (let i = 0; i < 6; i++) {
		if (await update.evaluate((b) => b === document.activeElement)) break;
		await page.keyboard.press('ArrowRight');
	}
	await expect(update).toBeFocused();
	await page.keyboard.press('Enter');
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { appCalls: string[] }).appCalls))
		.toEqual(['download']);
});

test('BACK puts the offer away, as LATER does', async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as Record<string, unknown>).TsundokuTV = {
			appUpdate: () =>
				JSON.stringify({
					running: '2026.11.05',
					checkedAt: 1,
					phase: 'available',
					version: '2099.01.01',
					date: '2099-01-01',
					notes: '',
					size: 1000
				})
		};
	});
	await page.goto('/');
	const dialog = page.getByRole('dialog', { name: 'A new version' });
	await expect(dialog.getByRole('button', { name: 'UPDATE' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
});
