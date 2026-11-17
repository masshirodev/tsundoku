import { expect, test } from './fixtures';
import { revealOn } from './helpers/reveal';

/**
 * The TV's screens (doc/TV.md, "The design"). Read-only: nothing here
 * writes to the database the other projects share. The frame numbers are
 * pinned by library-layout, series-layout and the generated tv-*-frame specs;
 * these check what those cannot: the focus line, a sheet as a panel, search
 * above the keyboard, and reveal's frame drawn in from the overscan.
 */

test('the first arrow starts on CONTINUE; the second row of shelves names the cover in full', async ({
	page
}) => {
	await page.goto('/');
	// Nothing focused on arrival (doc/FOCUS.md); the first arrow puts it on the
	// screen's start, the first CONTINUE card.
	await expect(page.getByTestId('focus-line')).toHaveCount(0);
	await page.keyboard.press('ArrowDown');
	const start = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
	expect(start).toMatch(/^Resume /);

	// ↓ to the shelf's tabs, ↓ to the KIND band, ↓ into the grid: the
	// focus line appears under the pinned bar and names the focused cover.
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	const line = page.getByTestId('focus-line');
	await expect(line).toBeVisible();
	const title = await page.evaluate(() => {
		const el = document.activeElement?.closest<HTMLElement>('[data-focus-line]');
		return el?.dataset.focusTitle ?? '';
	});
	expect(title.length).toBeGreaterThan(0);
	await expect(line.locator('.name')).toHaveText(title);
	// Its kind, the counts, where you are -- the sheet's own line.
	await expect(line.locator('.meta')).toContainText('·');
	await expect(line).toContainText('HOLD OK');
	await expect(line).toContainText('OPEN');

	// It is pinned under the band, in the tabs' place (56px), at 64px tall.
	expect(await line.evaluate((n) => getComputedStyle(n).position)).toBe('sticky');
	expect(await line.evaluate((n) => getComputedStyle(n).top)).toBe('56px');
	expect((await line.boundingBox())!.height).toBe(64);
});

test('a sheet is a 420px panel from the right, not a bottom sheet', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'MORE' }).click();
	const panel = page.locator('.sheet');
	await expect(panel).toBeVisible();
	// It slides in from the right (doc/MOTION.md): measure where it comes to rest.
	await panel.evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished)));
	const box = (await panel.boundingBox())!;
	expect(box.width).toBe(420);
	expect(Math.round(box.x)).toBe(960 - 420);
	expect(Math.round(box.y)).toBe(0);
	expect(Math.round(box.height)).toBe(540);
	expect(await panel.evaluate((n) => getComputedStyle(n).borderLeftWidth)).toBe('1px');
	// The screen it opened over stays in view at the left.
	expect(box.x).toBeGreaterThan(0);
});

test('search results are three cards across, inside the safe margin, above the keyboard', async ({
	page
}) => {
	// A title that matches no tag or shelf, so the titles are the first block:
	// the tags block above them is the search screen's own existing order.
	await page.goto('/search?q=Frieren');
	const hits = page.locator('.hits');
	await expect(hits).toHaveCount(1);
	const tracks = (await hits.evaluate((n) => getComputedStyle(n).gridTemplateColumns)).split(' ');
	expect(tracks).toHaveLength(3);
	const box = (await hits.boundingBox())!;
	expect(Math.round(box.x)).toBe(48);
	expect(Math.round(box.width)).toBe(960 - 96);
	// One 114px row of results sits in the top half; Android's keyboard takes
	// the bottom 270px and tsundoku draws nothing there.
	expect((await page.locator('.hit').first().boundingBox())!.height).toBeGreaterThanOrEqual(114);
	expect(box.y).toBeLessThan(228);
});

test('/reveal says a TV cannot turn it on, instead of asking', async ({ page }) => {
	await page.goto('/search');
	await page.getByRole('searchbox', { name: 'Search' }).fill('/reveal');
	await page.keyboard.press('Enter');
	await expect(page.locator('.cmd')).toContainText('NOT ON A TV');
	await expect(page.locator('.cmd')).toContainText('COMPUTER');
	// No TRY AGAIN: there is nothing here to retry.
	await expect(page.getByRole('button', { name: 'TRY AGAIN' })).toHaveCount(0);
});

test("reveal's frame is drawn 20px in, for a TV that crops its edges", async ({ page }) => {
	// Turned on where it can be (the computer) and carried here: a TV cannot
	// turn reveal on itself. The cookie
	// is the server's whole memory of it, so the context can hold it.
	await revealOn(page.context());
	await page.goto('/');
	const frame = page.locator('.reveal-frame');
	await expect(frame).toBeVisible();
	const box = (await frame.boundingBox())!;
	expect(Math.round(box.x)).toBe(20);
	expect(Math.round(box.y)).toBe(14);
	expect(Math.round(box.width)).toBe(960 - 40);
	expect(Math.round(box.height)).toBe(540 - 28);
	// 6px of magenta, the TV's own width (TV Calls, "Reveal, and the overscan").
	await expect(frame).toHaveCSS('box-shadow', /6px/);
});
