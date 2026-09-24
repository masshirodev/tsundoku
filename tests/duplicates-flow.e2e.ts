import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Duplicate books end to end (doc/DUPLICATE-BOOKS.md), on the seed's hidden
 * pair: Rakugaki Collection Vol. 3 and its [Digital] twin. Serial,
 * tablet-portrait only. This file owns both books; it ends on KEEP BOTH, so
 * nothing of the seed is deleted.
 */
test.describe.configure({ mode: 'serial' });

async function command(page: Page, text: string) {
	await page.goto('/search');
	await page.getByRole('searchbox').fill(text);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/$/);
}

const band = (page: Page) => page.getByText(/POSSIBLE DUPLICATE/);
const tagOf = (page: Page, letter: 'A' | 'B') =>
	page.locator('.side', { has: page.locator('.letter', { hasText: letter }) }).locator('.tag');

test('a hidden pair has no band while reveal is off', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	await expect(band(page)).toHaveCount(0);
});

test('the pick comes selected with its reason; the other side can be chosen instead', async ({
	page
}) => {
	await command(page, '/reveal');
	await expect(band(page)).toContainText('01 POSSIBLE DUPLICATE');
	await page.getByRole('link', { name: 'REVIEW →' }).click();
	await page.waitForURL(/\/duplicates/);
	await expect(page.locator('.counter')).toHaveText('01 OF 01');
	await expect(page.locator('.conf')).toHaveText('LIKELY SAME');
	// Same pages, sharper [Digital]: rule 2 picks B.
	await expect(page.locator('.s2')).toContainText('PICK · B · SHARPER');
	await expect(page.locator('.s2')).toContainText('RULE 2 OF 4 · SHARPER');
	await expect(tagOf(page, 'B')).toHaveText('KEEP · PICK');
	await expect(tagOf(page, 'A')).toHaveText('TO TRASH');
	await expect(page.locator('.plabel')).toContainText(/\d+ MATCH · 0 ALONE/);

	await page.locator('.side', { has: page.locator('.letter', { hasText: 'A' }) }).click();
	await expect(tagOf(page, 'A')).toHaveText('KEEP · YOURS');
	await expect(page.locator('.s2')).toContainText('YOUR PICK · A · TSUNDOKU PICKED B');
	// What A would take over from B: B was rated, FAV'd and read.
	await expect(page.locator('.carry')).toContainText('TAKES OVER FROM B · RATING 4 · FAV · READ');
});

test('KEEP waits: UNDO brings the pair back, nothing deleted', async ({ page }) => {
	await command(page, '/reveal');
	await page.goto('/duplicates');
	await page.getByRole('button', { name: 'KEEP B', exact: true }).click();
	await expect(page.locator('.review .band')).toContainText('KEPT B · A TO THE TRASH');
	await expect(page.getByText('00 — NO DUPLICATES')).toBeVisible();
	await page.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.counter')).toHaveText('01 OF 01');
});

test('the series screen offers the pair too, and REVIEW opens on it', async ({ page }) => {
	await command(page, '/reveal');
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: '[Digital]' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.locator('.twin')).toContainText('SAME BOOK AS RAKUGAKI COLLECTION VOL. 3');
	await page.locator('.twin').getByRole('link', { name: 'REVIEW →' }).click();
	await page.waitForURL(/\/duplicates\?pair=/);
	await expect(page.locator('.counter')).toHaveText('01 OF 01');
});

test('the actions stay on screen under the reveal banner, however long the pair', async ({
	page
}) => {
	await command(page, '/reveal');
	await page.goto('/duplicates');
	const keep = page.getByRole('button', { name: 'KEEP BOTH', exact: true });
	const vh = page.viewportSize()!.height;
	const box = (await keep.boundingBox())!;
	expect(box.y + box.height).toBeLessThanOrEqual(vh);
	// Scrolled to the pages, they're still there.
	await page.locator('.plabel').scrollIntoViewIfNeeded();
	const after = (await keep.boundingBox())!;
	expect(after.y + after.height).toBeLessThanOrEqual(vh);
	expect(after.y).toBeGreaterThan(vh - 100);
});

test('side by side in landscape, one above the other in portrait', async ({ page }) => {
	await command(page, '/reveal');
	await page.goto('/duplicates');
	const [a, b] = [page.locator('.side').nth(0), page.locator('.side').nth(1)];
	expect((await b.boundingBox())!.y).toBeGreaterThan((await a.boundingBox())!.y);
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect
		.poll(async () => (await b.boundingBox())!.y === (await a.boundingBox())!.y)
		.toBe(true);
});

test('KEEP BOTH settles it for good: the band goes', async ({ page }) => {
	await command(page, '/reveal');
	await page.goto('/duplicates');
	await page.getByRole('button', { name: 'KEEP BOTH', exact: true }).click();
	await expect(page.locator('.review .band')).toContainText('KEPT BOTH · WON’T ASK AGAIN');
	await page.getByRole('link', { name: '← LIBRARY' }).click();
	await page.waitForURL(/\/$/);
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	await expect(band(page)).toHaveCount(0);
});
