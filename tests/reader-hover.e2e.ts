import type { Page } from '@playwright/test';
import { expect, readerReady, test } from './fixtures';

/**
 * The readers' tap surfaces never tint under a mouse (doc/READER.md,
 * "Tap zones, shown as a chapter opens"; doc/MOTION.md, "Hovering"). The player's
 * tap zone was a `<button>` and tinted (tests/browse-player-hover.e2e.ts); the
 * image reader's stage and the text reader's page catch taps on a plain
 * element, which the hover rule never matches. This file holds that: hovering
 * the middle of a page finds no pressable under the pointer and no tint on
 * anything there, so a later change that makes a zone a button turns it red,
 * while a visible control of the same reader still tints, so the rule itself
 * is shown to be live. Hover only exists on a fine pointer, so it runs in the
 * `desktop` project alone and skips itself in the touch ones. Read-only: it
 * reads in incognito, and only series no flow file writes to (Sousou no
 * Frieren, as tests/reader-layout.e2e.ts; Mushoku Tensei, as
 * tests/text-reader-turn.e2e.ts).
 *
 * It also holds the sheets: READING scrolled to its bottom keeps its ✕ on
 * screen, in both readers, on every device project. Those two cases open a
 * 600px-tall window first, because the sheets are only long enough to scroll
 * on a short one, as on a real phone.
 */

test.beforeEach(async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
});

async function openSeries(page: Page, title: string) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: title }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	await page
		.getByRole('link', { name: /^(?!GET).*(READ AGAIN|CONTINUE|START|▶)/ })
		.first()
		.click();
	await page.waitForURL(/\/read\/\d+/);
}

/**
 * What lies under (x, y): whether any of it is pressable (press.ts's
 * PRESSABLE, the same list the hover rule tints), and every background-image
 * that is a tint.
 */
const under = (page: Page, x: number, y: number) =>
	page.evaluate(
		([x, y]) => {
			const pressable =
				'a[href], button, summary, [role="button"], [role="tab"], [role="option"], [role="menuitem"]';
			const els = document.elementsFromPoint(x, y);
			return {
				pressable: els.filter((e) => e.matches(pressable)).map((e) => e.outerHTML.slice(0, 80)),
				tinted: els
					.map((e) => getComputedStyle(e).backgroundImage)
					.filter((b) => b.includes('gradient'))
			};
		},
		[x, y]
	);

const tint = (page: Page, selector: string) =>
	page
		.locator(selector)
		.first()
		.evaluate((el) => getComputedStyle(el).backgroundImage);

test('the image reader: hovering the page tints nothing, its controls still tint', async ({
	page
}, info) => {
	test.skip(info.project.name !== 'desktop', 'hover exists only on a fine pointer');
	await openSeries(page, 'Sousou no Frieren');
	await readerReady(page);
	expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(
		true
	);
	const vp = page.viewportSize()!;
	for (const [fx, fy] of [
		[0.5, 0.5],
		[0.05, 0.5],
		[0.95, 0.5]
	]) {
		await page.mouse.move(vp.width * fx, vp.height * fy);
		expect(await under(page, vp.width * fx, vp.height * fy)).toEqual({
			pressable: [],
			tinted: []
		});
	}
	// The middle button raises the controls without turning (reader-layout.e2e.ts).
	await page.mouse.click(vp.width / 2, vp.height / 2, { button: 'middle' });
	await expect(page.getByRole('banner', { name: 'Reader' })).toBeVisible();
	const cell = page.locator('.cells button').first();
	await cell.hover();
	await expect.poll(() => tint(page, '.cells button')).toContain('linear-gradient');
});

test('the text reader: hovering the page tints nothing, its controls still tint', async ({
	page
}, info) => {
	test.skip(info.project.name !== 'desktop', 'hover exists only on a fine pointer');
	await openSeries(page, 'Mushoku Tensei');
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	const box = (await page.locator('.text-reader').boundingBox())!;
	for (const [fx, fy] of [
		[0.5, 0.5],
		[0.05, 0.5],
		[0.95, 0.5]
	]) {
		const x = box.x + box.width * fx;
		const y = box.y + box.height * fy;
		await page.mouse.move(x, y);
		expect(await under(page, x, y)).toEqual({ pressable: [], tinted: [] });
	}
	// A tap in the middle raises the controls (doc/TEXT-READER.md); a cell of
	// theirs keeps the hover.
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	const cell = page.locator('header.top .fav');
	await expect(cell).toBeVisible();
	await cell.hover();
	await expect
		.poll(() => cell.evaluate((el) => getComputedStyle(el).backgroundImage))
		.toContain('linear-gradient');
});

/**
 * The head that closes the sheet stays at the sheet's top while its rows
 * scroll under it. A 600px window makes every row list longer than its 90dvh
 * (the image reader's) or `100dvh - 64px` (the text reader's), as a real
 * phone had it; the head is asserted at the sheet's own top after the scroll,
 * not merely visible somewhere.
 */
test.describe('the sheets keep their ✕ while their rows scroll', () => {
	async function opened(page: Page, title: string, text = false) {
		await openSeries(page, title);
		if (text) await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
		else await readerReady(page);
		await page.setViewportSize({ width: 800, height: 600 });
		// Escape shows the controls whatever the pointer (doc/READER.md, "Mouse").
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: /SETTINGS ↑/ }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await expect(sheet).toBeVisible();
		// Measure once it has come to rest: the sheet rises in, and a box read
		// mid-animation is a moving one (doc/TESTING.md, "Measure a screen only
		// once it has come to rest").
		await sheet.evaluate((el) =>
			Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished))
		);
		return sheet;
	}

	async function openedAndScrolled(page: Page, title: string, text = false) {
		const sheet = await opened(page, title, text);
		const moved = await sheet.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
			return el.scrollTop;
		});
		expect(moved).toBeGreaterThan(0);
		const head = (await sheet.locator('.head').boundingBox())!;
		const box = (await sheet.boundingBox())!;
		// At the sheet's own top, within its 1px rule: a scrolled-away head is
		// hundreds of pixels above it, which `<= 1` alone would accept.
		expect(Math.abs(head.y - box.y)).toBeLessThanOrEqual(1);
		return sheet;
	}

	test('the image reader’s READING', async ({ page }) => {
		const sheet = await openedAndScrolled(page, 'Sousou no Frieren');
		const close = sheet.getByRole('button', { name: 'Close' });
		await expect(close).toBeVisible();
		await close.click();
		await expect(sheet).toHaveCount(0);
	});

	test('the text reader’s READING', async ({ page }) => {
		const sheet = await openedAndScrolled(page, 'Mushoku Tensei', true);
		const close = sheet.getByRole('button', { name: 'Close' });
		await expect(close).toBeVisible();
		await close.click();
		await expect(sheet).toHaveCount(0);
	});

	test('a focused row lands under the head, not behind it', async ({ page }) => {
		// The sheet's `scroll-padding-top` is what keeps a keyboard's or a
		// remote's focus walk from stopping beneath the sticky head. The walk
		// has to come from below: a row scrolled to the top edge is the one that
		// would hide under it, so the sheet goes to its bottom first. The scroll
		// is the focus layer's own call (src/lib/focus/layer.ts).
		const sheet = await opened(page, 'Sousou no Frieren');
		await sheet.evaluate((el) => (el.scrollTop = el.scrollHeight));
		await expect.poll(() => sheet.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
		const first = sheet.getByRole('radio', { name: 'R→L' });
		await first.evaluate((el) =>
			el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
		);
		const row = (await first.boundingBox())!;
		const head = (await sheet.locator('.head').boundingBox())!;
		expect(row.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
	});
});

/**
 * CURSOR in the READING sheet, off on both readers. With it on, the
 * cursor goes after three seconds without the mouse moving, and a move or a
 * press brings it back at once; a key and the wheel do not, so reading by
 * arrows stays clean. It never hides while a bar, a sheet, the page menu or
 * the end page is open. Only a mouse has a cursor, so the row is left out on a
 * phone and a tablet (and on a TV, where `pointer: none`; the `tv` project does
 * not collect this file, and `tv-reader`/`tv-text-reader` walk the sheets).
 */
test.describe('CURSOR', () => {
	const cursor = (page: Page) =>
		page
			.locator('.reader, .text-reader')
			.first()
			.evaluate((el) => getComputedStyle(el).cursor);

	async function toggleOnInReading(page: Page) {
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: /SETTINGS ↑/ }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		const row = sheet.locator('.row', { hasText: 'CURSOR' });
		const toggle = row.getByRole('switch');
		await expect(toggle).toHaveAttribute('aria-checked', 'false');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-checked', 'true');
		await sheet.getByRole('button', { name: 'Close' }).click();
		await expect(sheet).toHaveCount(0);
	}

	test('the image reader hides it after the wait; a move, a press and the overlays bring it back', async ({
		page
	}, info) => {
		test.skip(info.project.name !== 'desktop', 'a cursor exists only under a fine pointer');
		test.setTimeout(90_000);
		await openSeries(page, 'Sousou no Frieren');
		await readerReady(page);
		await toggleOnInReading(page);
		// The bars the sheet was opened from are still up, and the cursor never
		// hides while they are: put them away, as reading does.
		await page.keyboard.press('Escape');
		await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
		// Turned on, the timer starts: the cursor goes by itself.
		await expect.poll(() => cursor(page), { timeout: 8000 }).toBe('none');
		// A move brings it back at once.
		await page.mouse.move(400, 300);
		await page.mouse.move(720, 450);
		await expect.poll(() => cursor(page)).toBe('auto');
		// Still again, it goes again.
		await expect.poll(() => cursor(page), { timeout: 8000 }).toBe('none');
		// A key and the wheel are reading, not the mouse: neither brings it back.
		await page.keyboard.press('ArrowRight');
		expect(await cursor(page)).toBe('none');
		await page.mouse.wheel(0, 120);
		expect(await cursor(page)).toBe('none');
		// A button does, at once.
		await page.mouse.down();
		await expect.poll(() => cursor(page)).toBe('auto');
		await page.mouse.up();
		// The bars and the sheet are open over the reader: it stays shown.
		await page.keyboard.press('Escape');
		await expect(page.getByRole('banner', { name: 'Reader' })).toBeVisible();
		expect(await cursor(page)).toBe('auto');
		await page.getByRole('button', { name: /SETTINGS ↑/ }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await expect(sheet).toBeVisible();
		await page.waitForTimeout(3500);
		expect(await cursor(page)).toBe('auto');
		await sheet.getByRole('button', { name: 'Close' }).click();
		await expect(sheet).toHaveCount(0);
		await expect(page.getByRole('banner', { name: 'Reader' })).toBeVisible();
		// The page menu over a bare page: the press wakes it, and the menu keeps
		// it up past the wait it would otherwise hide by.
		await page.keyboard.press('Escape');
		await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
		await expect.poll(() => cursor(page), { timeout: 8000 }).toBe('none');
		await page.mouse.move(720, 450);
		await page.mouse.down();
		await page.waitForTimeout(700);
		await page.mouse.up();
		const menu = page.getByRole('dialog', { name: /page|cover/i });
		await expect(menu).toBeVisible();
		await page.waitForTimeout(3500);
		expect(await cursor(page)).toBe('auto');
		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		// The end page is open: still shown, even though a key is what got there.
		await page.goto(`${page.url().replace(/\?.*$/, '')}?p=last`);
		await readerReady(page);
		await page.mouse.move(720, 450);
		await expect.poll(() => cursor(page), { timeout: 8000 }).toBe('none');
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('[data-end-page]')).toBeVisible();
		// Past the wait it would hide by: the end page keeps it shown.
		await page.waitForTimeout(3500);
		expect(await cursor(page)).toBe('auto');
	});

	test('the text reader hides it after the wait, and the sheet keeps it shown', async ({
		page
	}, info) => {
		test.skip(info.project.name !== 'desktop', 'a cursor exists only under a fine pointer');
		test.setTimeout(60_000);
		await openSeries(page, 'Mushoku Tensei');
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
		await toggleOnInReading(page);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
		await expect.poll(() => cursor(page), { timeout: 8000 }).toBe('none');
		await page.mouse.move(400, 300);
		await page.mouse.move(720, 450);
		await expect.poll(() => cursor(page)).toBe('auto');
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: /SETTINGS ↑/ }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await expect(sheet).toBeVisible();
		await page.waitForTimeout(3500);
		expect(await cursor(page)).toBe('auto');
	});

	test('the row is left out where there is no mouse', async ({ page }, info) => {
		test.skip(info.project.name === 'desktop', 'the fine pointer has its own cases above');
		await openSeries(page, 'Sousou no Frieren');
		await readerReady(page);
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: /SETTINGS ↑/ }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await expect(sheet).toBeVisible();
		await expect(sheet.getByText('CURSOR', { exact: true })).toHaveCount(0);
	});
});
