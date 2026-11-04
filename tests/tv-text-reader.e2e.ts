import { expect, test } from './fixtures';

/**
 * The text reader on a TV: its chrome (c241) -- OK brings it up as a focus row,
 * the pad reaches READING, and LAYOUT changes by keys alone -- and its end page,
 * which takes the pad as the image reader's does (c280: a novel's last volume
 * is EndPage, so its cells are the Work's block, the rating and the foot).
 * Read-only: it reads in incognito, so no progress is written (the LAYOUT it
 * changes is put back).
 *
 * It reads Mushoku Tensei, which no flow file removes from the library:
 * history-flow removes one of its history rows and undoes it, and series-layout
 * reads its series frame; neither groups or ungroups it. Villainess Level 99
 * would not do: volumes-flow groups it away mid-run, in a project that runs
 * beside `tv` on the same database.
 */

test.beforeEach(async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
});

async function open(page: import('@playwright/test').Page) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Mushoku Tensei' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page
		.getByRole('link', { name: /READ AGAIN|CONTINUE|START|▶/ })
		.first()
		.click();
	await page.waitForURL(/\/read\/\d+/);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
}

test('OK brings the chrome as a focus row, and READING changes LAYOUT by keys', async ({
	page
}) => {
	await open(page);
	const reader = page.locator('.text-reader');
	const chromeUp = () => reader.evaluate((n) => !n.hasAttribute('data-focus-off'));

	expect(await chromeUp()).toBe(false);

	// OK shows the chrome and puts the pad on the scrubber.
	await page.keyboard.press('Enter');
	const scrub = page.locator('.text-reader footer .track');
	await expect(scrub).toBeVisible();
	await expect(scrub).toBeFocused();
	expect(await chromeUp()).toBe(true);

	// ↓ reaches the cells, and READING is the widest of them.
	await page.keyboard.press('ArrowDown');
	const reading = page.locator('.text-reader footer .cell.grow');
	await expect(reading).toBeFocused();

	// OK opens READING, where the pad lands on the layout in use.
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await expect(sheet).toBeVisible();
	// The panel keeps the TV's 48px right side (Sheet.svelte): its ✕ ends there,
	// not at the screen edge inside the overscan.
	const panel = (await sheet.boundingBox())!;
	const close = (await sheet.getByRole('button', { name: 'Close' }).boundingBox())!;
	expect(panel.x + panel.width - (close.x + close.width)).toBeGreaterThanOrEqual(47);
	const paged = sheet.getByRole('radio', { name: 'PAGED' });
	const scroll = sheet.getByRole('radio', { name: 'SCROLL' });
	const started = (await paged.getAttribute('aria-checked')) === 'true' ? paged : scroll;
	await expect(started).toBeFocused();
	const other = started === paged ? scroll : paged;
	const label = other === paged ? 'PAGED' : 'SCROLL';

	// ← → move along the row, and OK takes the other layout.
	await page.keyboard.press(started === paged ? 'ArrowRight' : 'ArrowLeft');
	await expect(other).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(other).toHaveAttribute('aria-checked', 'true');

	// BACK closes READING; the footer comes back with the pad on its scrubber,
	// and the chrome says what the layout now is.
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await expect(scrub).toBeFocused();
	await expect(reading).toContainText(label);

	// BACK again hides the chrome, and the reader has its own keys back.
	await page.keyboard.press('Escape');
	await expect(page.locator('.text-reader header.top')).toHaveCount(0);
	expect(await chromeUp()).toBe(false);

	// Put it back the way it was found, by keys alone.
	await page.keyboard.press('Enter');
	await page.keyboard.press('ArrowDown');
	await expect(reading).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(sheet).toBeVisible();
	await expect(other).toBeFocused();
	await page.keyboard.press(other === paged ? 'ArrowRight' : 'ArrowLeft');
	await expect(started).toBeFocused();
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await expect(reading).toContainText(started === paged ? 'PAGED' : 'SCROLL');
});

test('a sheet on its way out keeps no keys: ↓ at once after BACK reaches the cells (c445)', async ({
	page
}) => {
	await open(page);
	await page.keyboard.press('Enter');
	const scrub = page.locator('.text-reader footer .track');
	await expect(scrub).toBeFocused();
	await page.keyboard.press('ArrowDown');
	const reading = page.locator('.text-reader footer .cell.grow');
	await expect(reading).toBeFocused();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await expect(sheet).toBeVisible();
	await sheet.evaluate((el) =>
		Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)))
	);
	// BACK and ↓ in one go, inside the sheet's 180 ms exit: while it leaves it
	// is inert, and an inert sheet that kept the scope swallowed the arrow.
	await page.evaluate(() => {
		const key = (k: string) => {
			const init = { key: k, bubbles: true, cancelable: true };
			document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', init));
			document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', init));
		};
		key('Escape');
		return new Promise<void>((r) =>
			requestAnimationFrame(() => requestAnimationFrame(() => (key('ArrowDown'), r())))
		);
	});
	await expect(sheet).toHaveCount(0);
	await expect(reading).toBeFocused();
});

test('the end of the book takes the pad: its cells are reachable, as the image reader’s are', async ({
	page
}) => {
	await open(page);
	const reader = page.locator('.text-reader');
	const end = page.locator('[data-end-page]');
	// L→R: → turns forward, and past the last page it is the end page (a novel's
	// last volume is EndPage, so the Work's block and the rating are cells there).
	for (let i = 0; i < 500 && (await end.count()) === 0; i++) {
		await page.keyboard.press('ArrowRight');
		await page.waitForTimeout(20);
	}
	await expect(end).toBeVisible({ timeout: 15_000 });
	// The end page lifts the reader's opt-out, as the image reader's has since
	// c235: before it, every arrow was the reader's.
	expect(await reader.evaluate((n) => n.hasAttribute('data-focus-off'))).toBe(false);
	await page.keyboard.press('ArrowDown');
	const cell = await page.evaluate(
		() => document.activeElement?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
	);
	expect(cell).toMatch(/SERIES|LIBRARY|RATE|FAV/i);
});
