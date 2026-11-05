import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * DETAILS on a TV (c425; doc/SERIES.md "DETAILS"; series-phone 1D, B and C):
 * the settings-like rows fold, because on a D-pad every row is a stop.
 * DETAILS is one stop between ABOUT and the list; OK opens or closes it in
 * place and the focus stays on it; ↓ then goes into the first opened row. The
 * state is the device's, as on a phone. Runs in the `tv` project (960x540, no
 * pointer), on Boku no Kokoro no Yabai Yatsu, which no flow file writes; the
 * fold writes only this context's localStorage.
 */

const TITLE = 'Boku no Kokoro no Yabai Yatsu';

async function open(page: Page) {
	await page.goto('/?sort=title');
	// A tile tapped before the library has hydrated does nothing (this base's
	// goto does not wait for hydration yet): tap again until the URL moves.
	await expect(async () => {
		await page.locator('.grid .tile', { hasText: TITLE }).first().click();
		await page.waitForURL(/\/series\/\d+/, { timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
	await page.waitForLoadState('networkidle');
}

const details = (page: Page) => page.locator('[data-row="details"]');
const onDetails = (page: Page) =>
	page.evaluate(() => document.activeElement?.matches('[data-row="details"]') ?? false);
const where = (page: Page) =>
	page.evaluate(() => {
		const a = document.activeElement as HTMLElement | null;
		return {
			inPanel: !!a?.closest('section.panel'),
			row: a?.closest('.row, [data-row]')?.querySelector('.label')?.textContent?.trim() ?? '',
			text: a?.innerText?.trim().slice(0, 24) ?? ''
		};
	});

/** ↓ from the top of the screen, as a remote does, until DETAILS has the focus. */
async function padToDetails(page: Page) {
	const path: string[] = [];
	for (let i = 0; i < 30; i++) {
		if (await onDetails(page)) return path;
		await page.keyboard.press('ArrowDown');
		const w = await where(page);
		path.push(`${w.row}:${w.text}`);
	}
	throw new Error(`↓ never reached DETAILS: ${path.join(' > ')}`);
}

test.beforeEach(({ page }, info) => {
	void page;
	test.skip(info.project.name !== 'tv', 'the TV’s stop');
});

test('↓ reaches DETAILS under ABOUT; folded, no row under it is a stop, and → is the list', async ({
	page
}) => {
	await open(page);
	const path = await padToDetails(page);
	// The stop before it is above the fold (SHELVES' EDIT on the right, or
	// ABOUT's MORE on the left), and it sits under ABOUT, the last row there.
	expect(path.at(-2)).toMatch(/^(SHELVES|ABOUT):/);
	const about = await page
		.locator('.panel .about')
		.evaluate((n) => n.getBoundingClientRect().bottom);
	expect((await details(page).boundingBox())!.y).toBeGreaterThanOrEqual(about);
	await expect(details(page)).toHaveAttribute('aria-expanded', 'false');
	// Folded, nothing under it is a stop: ↓ has nowhere to go in the column,
	// and → is the list beside it.
	await page.keyboard.press('ArrowDown');
	expect(await onDetails(page)).toBe(true);
	await page.keyboard.press('ArrowRight');
	expect((await where(page)).inPanel).toBe(false);
});

test('OK opens it in place and keeps the focus on it; ↓ goes into the first row; OK closes it', async ({
	page
}) => {
	await open(page);
	await padToDetails(page);
	await page.keyboard.press('Enter');
	await expect(details(page)).toHaveAttribute('aria-expanded', 'true');
	expect(await onDetails(page)).toBe(true);
	await expect(details(page).locator('.dt-go')).toHaveText('OK · HIDE ↑', { useInnerText: true });
	// The first row inside is the next stop down.
	const first = await page
		.locator('[data-details]')
		.evaluate(
			(n) =>
				[...n.querySelectorAll<HTMLElement>('.label')].find(
					(l) => l.getBoundingClientRect().height > 0
				)?.textContent ?? ''
		);
	await page.keyboard.press('ArrowDown');
	const w = await where(page);
	expect(w.inPanel).toBe(true);
	expect(w.row).toBe(first.trim());

	// Back up to it, and OK folds it again, the focus still on it.
	await page.keyboard.press('ArrowUp');
	expect(await onDetails(page)).toBe(true);
	await page.keyboard.press('Enter');
	await expect(details(page)).toHaveAttribute('aria-expanded', 'false');
	expect(await onDetails(page)).toBe(true);
	await expect(details(page).locator('.dt-go')).toHaveText('OK · SHOW ↓', { useInnerText: true });
});

test('remembered for the device: a reload comes back open', async ({ page }) => {
	await open(page);
	await padToDetails(page);
	await page.keyboard.press('Enter');
	await expect(details(page)).toHaveAttribute('aria-expanded', 'true');
	await page.reload();
	await expect(details(page)).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator('.file-row')).toBeVisible();
});

test('the board’s measurements: 64px, its text a size up, the names cut to four and a count', async ({
	page
}) => {
	await open(page);
	const d = details(page);
	await expect(d).toHaveCSS('min-height', '64px');
	await expect(d.locator('.dt-state')).toHaveCSS('font-size', '14px');
	await expect(d.locator('.dt-names').filter({ visible: true })).toHaveCSS('font-size', '12px');
	await expect(d.locator('.dt-go')).toHaveCSS('font-size', '14px');
	await expect(d.locator('.dt-go')).toHaveCSS('padding-left', '18px');
	await expect(d.locator('.dt-go')).toHaveCSS('padding-right', '18px');
	await expect(d.locator('.dt-all')).toBeHidden();
	// The TV's names: the first four rows inside, then how many more.
	await d.focus();
	await page.keyboard.press('Enter');
	await expect(d).toHaveAttribute('aria-expanded', 'true');
	const labels = await page.locator('[data-details]').evaluate((n) =>
		[...n.querySelectorAll<HTMLElement>('.label, [data-row="lists"] .strip-l')]
			.filter((l) => l.getBoundingClientRect().height > 0)
			.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
			.map((l) => l.textContent?.replace(/\?/g, '').trim() ?? '')
	);
	expect(labels.length).toBeGreaterThan(4);
	await expect(d.locator('.dt-tv')).toHaveText(
		[...labels.slice(0, 4), `${labels.length - 4} MORE`].join(' · ')
	);
	// ABOUT is the board's two lines on a TV.
	const lines = await page
		.locator('.panel .about p')
		.evaluate((n) =>
			Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight))
		);
	expect(lines).toBe(2);
});
