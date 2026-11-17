import { expect, readerReady, test } from './fixtures';

/**
 * The vertical strip's ← and → on a TV (c527; doc/READER.md, "On a TV and on
 * a remote"): with the controls hidden a remote's → and ← nudge the strip as
 * a keyboard's do, since a remote has no Ctrl for Ctrl + ↓ / ↑; with them up
 * the arrows stay the focus layer's (`tv-reader.e2e.ts`). Runs in the
 * `tv` project, where the pad is the only input. Read-only: incognito, on the
 * series reader-layout and tv-reader read (Sousou no Frieren), switched to the
 * strip from READING, whose mode is session state that only REMEMBER stores.
 */

test.beforeEach(async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
});

test('with the controls hidden, a remote’s → and ← nudge the strip; with them up, they move focus', async ({
	page
}) => {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Sousou no Frieren' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.getByRole('link', { name: /▶/ }).first().click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');

	// OK, ↓ to READING, OK; along the MODE row to VERTICAL, OK; BACK.
	await page.keyboard.press('Enter');
	await page.keyboard.press('ArrowDown');
	const reading = page.locator('footer[aria-label="Reader controls"] .cell.grow');
	await expect(reading).toBeFocused();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await expect(sheet.getByRole('radio', { name: 'R→L' })).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	const vertical = sheet.getByRole('radio', { name: 'VERTICAL' });
	await expect(vertical).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(vertical).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await expect(page.locator('.reader')).toHaveClass(/vertical/);
	await expect(reading).toBeFocused();

	// Controls up: → moves along the row, and the strip stays where it is.
	// A chapter arriving above under load scrolls the strip with it to keep
	// the place (`keepPlaceBy`); that is taken away, as reader-flow's c192
	// case does.
	await page.evaluate(() => {
		const w = window as unknown as { kept: number };
		w.kept = 0;
		addEventListener('tsundoku:kept-place', (e) => (w.kept += (e as CustomEvent<number>).detail));
	});
	const y = () =>
		page.evaluate(() => Math.round(scrollY - ((window as unknown as { kept?: number }).kept ?? 0)));
	let before = await y();
	await expect
		.poll(
			async () => {
				const now = await y();
				const still = now === before;
				before = now;
				return still;
			},
			{ intervals: [1500], timeout: 30_000 }
		)
		.toBe(true);
	await page.keyboard.press('ArrowRight');
	await expect(reading).not.toBeFocused();
	await page.waitForTimeout(500);
	expect(await y()).toBe(before);

	// BACK hides them: now → and ← are the reader's, a nudge each way.
	await page.keyboard.press('Escape');
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
	const y0 = await y();
	await page.keyboard.press('ArrowRight');
	await expect.poll(async () => Math.abs((await y()) - y0 - 100)).toBeLessThanOrEqual(1);
	await page.keyboard.press('ArrowLeft');
	await expect.poll(async () => Math.abs((await y()) - y0)).toBeLessThanOrEqual(1);
});
