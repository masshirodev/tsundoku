import { expect, test } from '@playwright/test';
import { engineDown, resetEngine, SOURCES } from './browse-world';

/**
 * A manga read online (doc/BROWSING.md, "Manga online"; card c166; Online
 * Calls 1A, 1B and board 2): from a source's preview without ADD, its pages
 * straight from the fake engine's /image/ proxy and never kept; then, added,
 * its chapters read online from the series screen, ↓ downloading apart.
 */

test('a chapter opens online from the preview, a record keeps the place, the series reads online (c166)', async ({
	page
}) => {
	test.setTimeout(90_000);
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.locator('.grid .tile', { hasText: 'Open Source 1-4' }).click();
	await expect(page).toHaveURL(/\/downloads\/source\//);
	const preview = page.url();
	// Reading first, adding beside it.
	await expect(page.locator('.cta-go .cta')).toContainText('▶ READ CH. 1');
	await expect(page.locator('.cta-go .cta')).toContainText('ONLINE');
	await expect(page.getByRole('region', { name: 'Chapters' }).locator('.head')).toContainText(
		'3 · ALL ONLINE'
	);
	await page.locator('.cta-go .cta').click();
	await expect(page).toHaveURL(/\/read\/\d+/);

	// The pages come from the source, through tsundoku, and are never kept.
	const img = page.locator('.stage .screen:not([aria-hidden]) img').first();
	await expect(img).toBeVisible({ timeout: 20_000 });
	const src = await img.getAttribute('src');
	const res = await page.request.get(src!);
	expect(res.headers()['content-type']).toBe('image/png');
	expect(res.headers()['cache-control']).toBe('private, no-store');
	// Esc shows the controls (a click turns the page, as a mouse does).
	await page.keyboard.press('Escape');
	await expect(page.locator('header[aria-label="Reader"] .meta')).toContainText('ONLINE');
	// A record: + ADD where the rating and FAV are, and the meta line says so.
	await expect(page.locator('header[aria-label="Reader"] .meta')).toContainText('NOT IN LIBRARY');
	await expect(
		page.getByRole('banner', { name: 'Reader' }).getByRole('button', { name: '+ ADD' })
	).toBeVisible();

	// Back at the preview: a record, ▶ CONTINUE, and + ADD beside it.
	await page.goto(preview);
	await expect(page.locator('.row.record')).toContainText('Not in library · 0 of 3 read');
	await expect(page.locator('.cta-go .cta')).toContainText('▶ CONTINUE');

	// Added: the series screen reads each chapter online, and ↓ downloads apart.
	await page.getByRole('button', { name: /ADD TO LIBRARY/ }).click();
	await expect(page).toHaveURL(/\/series\/\d+/);
	const list = page.getByRole('region', { name: /Chapters/ });
	const row = list.locator('.entry', { hasText: 'Chapter 2' });
	await expect(row.locator('.status')).toContainText('ONLINE');
	await expect(row.getByRole('button', { name: 'Download Chapter 2' })).toHaveText('↓');
	await row.locator('.entry-btn').click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
		timeout: 20_000
	});

	// The source stops answering: a chapter not yet asked for waits on the
	// reader's interstitial page, says so, and opens once it answers again.
	const third = list.locator('.entry', { hasText: 'Chapter 3' });
	await page.goBack();
	await engineDown();
	try {
		await third.locator('.entry-btn').click();
		await expect(page.getByRole('status')).toContainText('SOURCES NOT ANSWERING', {
			timeout: 20_000
		});
	} finally {
		await resetEngine();
	}
	await page.getByRole('button', { name: 'TRY AGAIN' }).click();
	await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
		timeout: 20_000
	});
});
