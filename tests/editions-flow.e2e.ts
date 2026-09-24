import { type Page } from '@playwright/test';
import { expect, readerReady, test } from './fixtures';

/**
 * Editions end to end (doc/EDITIONS.md), on the seed's folded book: Harbour
 * Lights in English, with its Japanese download 港の灯 folded in. Hidden, as
 * Hentoid books are. Serial, tablet-portrait only. This file owns the book
 * and the OPENS IN setting, puts the setting back, and ends on UNFOLD.
 */
test.describe.configure({ mode: 'serial' });

const EN = 'Harbour Lights';
const JA = '港の灯';

async function command(page: Page, text: string) {
	await page.goto('/search');
	await page.getByRole('searchbox').fill(text);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/$/);
}

async function openBook(page: Page) {
	await command(page, '/reveal');
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: EN }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
}

const panel = (page: Page) => page.locator('section.panel');

test('one tile, saying its languages', async ({ page }) => {
	await command(page, '/reveal');
	await page.goto('/?sort=title');
	const tile = page.locator('.grid .tile', { hasText: EN });
	await expect(tile).toHaveCount(1);
	await expect(tile).toContainText('EN · JA');
	await expect(page.locator('.grid .tile', { hasText: JA })).toHaveCount(0);
});

test('the book screen: its language, its editions, and where it opens', async ({ page }) => {
	await openBook(page);
	await expect(panel(page).locator('.meta').first()).toHaveText('DOUJIN · 2 LANGUAGES');
	await expect(panel(page).locator('h1')).toHaveText(EN);
	await expect(panel(page).locator('.ed-alt')).toContainText(JA);
	const language = panel(page).locator('form[action="?/language"]').first();
	await expect(language.getByRole('button', { pressed: true })).toContainText('EN · ENGLISH');
	await expect(panel(page).locator('.ed')).toHaveCount(2);
	await expect(panel(page).locator('.ed-note').first()).toHaveText('EVERY PAGE MATCHED');
	await expect(page.locator('.cta')).toContainText('READ FROM P. 13');
	await expect(page.locator('.cta')).toContainText('EN · 30 PAGES');
	await expect(page.locator('section[aria-label="Pages"] .head')).toContainText(
		'30 · EN · AT P. 13'
	);

	// This book in Japanese: the title follows, and the note says it's this book's own.
	await language.getByRole('button', { name: /JA/ }).click();
	await expect(panel(page).locator('h1')).toHaveText(JA);
	await expect(panel(page).locator('.ov')).toHaveText(
		'THIS BOOK OPENS IN JAPANESE · OTHERS IN ENGLISH'
	);
	await panel(page).getByRole('button', { name: 'RESET' }).click();
	await expect(panel(page).locator('h1')).toHaveText(EN);
	await expect(panel(page).locator('.ov')).toHaveCount(0);
});

test('the reader switches language on the same page, and says so', async ({ page }) => {
	await openBook(page);
	await page.locator('.cta').click();
	await readerReady(page);
	const vp = page.viewportSize()!;
	await page.touchscreen.tap(vp.width / 2, vp.height / 2);
	const bar = page.getByRole('banner', { name: 'Reader' });
	await expect(bar.locator('.meta')).toContainText('DOUJIN · EN · P. 13 OF 30');
	await expect(bar.getByRole('button', { name: 'Read in EN' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await bar.getByRole('button', { name: 'Read in JA' }).click();
	await expect(page.locator('.switched')).toContainText('JA P. 13 · THE SAME PAGE AS EN P. 13');
	await expect(page.locator('.switched')).toContainText('SHOWN UNTIL THE NEXT PAGE TURN');
	// The controls stay up across the switch: the bar names the Japanese edition now.
	await expect(bar.locator('.title')).toHaveText(JA);
	await expect(bar.locator('.meta')).toContainText('DOUJIN · JA · P. 13 OF 30');
});

test('SETTINGS: the language folded books open in', async ({ page }) => {
	await command(page, '/reveal');
	await page.goto('/settings');
	await expect(page.getByText('01 — BOOKS IN SEVERAL LANGUAGES')).toBeVisible();
	await expect(page.getByText('1 FOLDED')).toBeVisible();
	await expect(page.getByRole('button', { name: 'ENGLISH' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: 'JAPANESE' }).click();
	await expect(page.getByRole('button', { name: 'JAPANESE' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.goto('/?sort=title');
	await expect(page.locator('.grid .tile', { hasText: JA })).toContainText('JA · EN');
	await page.goto('/settings');
	await page.getByRole('button', { name: 'ENGLISH' }).click();
	await expect(page.getByRole('button', { name: 'ENGLISH' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('UNFOLD makes two books again', async ({ page }) => {
	await openBook(page);
	await panel(page).getByRole('button', { name: 'UNFOLD' }).click();
	const sheet = page.getByRole('dialog', { name: 'Unfold into 2 books' });
	await expect(sheet).toContainText('UNFOLD INTO 2 BOOKS');
	await expect(sheet).toContainText('P. 13 OF 30 · RATING 3');
	await expect(sheet).toContainText('THE DUPLICATES REVIEW WON’T OFFER THEM AGAIN');
	await sheet.getByRole('button', { name: 'UNFOLD' }).click();
	await expect(panel(page).locator('form[action="?/language"]')).toHaveCount(0);
	await page.goto('/?sort=title');
	await expect(page.locator('.grid .tile', { hasText: EN })).toHaveCount(1);
	await expect(page.locator('.grid .tile', { hasText: JA })).toHaveCount(1);
});
