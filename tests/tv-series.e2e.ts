import { expect, test } from './fixtures';

/**
 * The series screen on a TV (c238; TV-Series). It opens Boku no Kokoro no
 * Yabai Yatsu, which no flow file writes: the flow files run beside the `tv`
 * project on the shared preview's one database (doc/TESTING.md, "The readers
 * beside the flows"). It used to open Tower of God, whose reader series-flow
 * opens from the cover (series-flow hides Ame no Hi no Toshokan, not Tower of
 * God, as this comment once said). The RATING test moves the rating one
 * half-bar down and back, so the series ends where it started (8).
 */

const TITLE = 'Boku no Kokoro no Yabai Yatsu';

async function open(page: import('@playwright/test').Page) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
}

test('the first arrow lands on ▶ CONTINUE', async ({ page }) => {
	await open(page);
	await page.keyboard.press('ArrowDown');
	const onContinue = await page.evaluate(() => document.activeElement?.closest('.cta') !== null);
	expect(onContinue).toBe(true);
});

test('RATING keeps ← →: the value moves, the mark does not walk the halves', async ({ page }) => {
	await open(page);
	// Which half-cell is the chosen one: its index is the value, in half-bars.
	const chosen = () =>
		page
			.locator('.rs .half')
			.evaluateAll((cells) => cells.findIndex((c) => c.getAttribute('aria-pressed') === 'true'));
	const before = await chosen();
	expect(before).toBeGreaterThan(0);
	const first = page.locator('.rs .half').first();
	await first.focus();
	// The row says it owns ← → (src/lib/focus/dom.ts, keepsArrow).
	expect(
		await page.locator('.rs .track').evaluate((n) => n.hasAttribute('data-focus-adjust'))
	).toBe(true);

	await page.keyboard.press('ArrowLeft');
	// One half-bar down, and focus stayed on the half-cell it was on.
	await expect.poll(chosen).toBe(before - 1);
	expect(await first.evaluate((n) => n === document.activeElement)).toBe(true);

	await page.keyboard.press('ArrowRight');
	// And back: the series is as it was.
	await expect.poll(chosen).toBe(before);
	expect(await first.evaluate((n) => n === document.activeElement)).toBe(true);
});

test('every row of the panel fits its 352px column, and nothing sits over ▶ CONTINUE', async ({
	page
}) => {
	await open(page);
	// On the first real TV (2026-11-02) the rows took the tablet's full-width
	// layout: cells ran past the column and over CONTINUE, labels were cut.
	const report = await page.evaluate(() => {
		const panel = document.querySelector('section.panel')!.getBoundingClientRect();
		const cta = document.querySelector('.panel .cta')!.getBoundingClientRect();
		const out: string[] = [];
		for (const el of document.querySelectorAll<HTMLElement>(
			'.panel .row, .panel .lc, .panel .label, .panel .lcs, .panel [data-row="lists"], .panel [data-row="lists"] .c, .panel [data-row="lists"] .tag'
		)) {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || getComputedStyle(el).display === 'none') continue;
			const name = `${el.className} "${el.textContent?.trim().slice(0, 20)}"`;
			if (r.left < panel.left - 1 || r.right > panel.right + 1) out.push(`outside: ${name}`);
			if (!el.closest('.cta') && r.bottom > cta.top + 1 && r.top < cta.bottom - 1)
				out.push(`over CONTINUE: ${name}`);
			if (
				el.scrollWidth > el.clientWidth + 1 &&
				(el.classList.contains('label') || el.classList.contains('tag'))
			)
				out.push(`cut: ${name}`);
		}
		return out;
	});
	expect(report).toEqual([]);
});

test('LISTS on the TV: a strip, 56px lines with no meta, and ← → between a line’s cells (c424)', async ({
	page
}) => {
	await open(page);
	// The handoff's 1D: the label is a 36px strip, the tag 56, the line 56, the
	// title 16 and the cells 15; a line drops its meta (one OK away, in EDIT).
	const row = page.locator('[data-row="lists"]');
	const line = row.locator('[data-line="anilist"]');
	await expect(row.locator('.strip')).toBeVisible();
	expect((await row.locator('.strip').boundingBox())!.height).toBe(36);
	expect((await line.locator('.tag').boundingBox())!.width).toBe(56);
	expect((await line.locator('.ln').boundingBox())!.height).toBeGreaterThanOrEqual(56);
	await expect(line.locator('.t')).toHaveCSS('font-size', '16px');
	await expect(line.locator('.m')).toBeHidden();
	// Not linked here: FIND and PASTE A LINK, dropped under the line in equal columns.
	const cells = line.locator('.drop .c');
	await expect(cells).toHaveText(['FIND', 'PASTE A LINK']);
	await expect(cells.first()).toHaveCSS('font-size', '15px');
	// The house's inset focus mark, never the accent (focus.css, data-focus-mark="in").
	await expect(cells.first()).toHaveAttribute('data-focus-mark', 'in');
	const active = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
	await cells.first().focus();
	await page.keyboard.press('ArrowRight');
	await expect.poll(active).toBe('PASTE A LINK');
	await page.keyboard.press('ArrowLeft');
	await expect.poll(active).toBe('FIND');
	// ↓ leaves the line for the next row, never sideways inside it.
	await page.keyboard.press('ArrowDown');
	await expect
		.poll(() => page.evaluate(() => !document.activeElement?.closest('[data-line="anilist"]')))
		.toBe(true);
});
