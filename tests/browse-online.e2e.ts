import { expect, test } from './fixtures';
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
	// ← goes back to the source it was added from, not the library (c262).
	const back = page.getByRole('banner', { name: 'Series' }).locator('a.back');
	await expect(back.locator('.back-label')).toHaveText('BROWSE');
	// Its pages too (?pages=), so the source's results come back as they were left.
	await expect(back).toHaveAttribute('href', new RegExp(`^/browse/${SOURCES.open.id}(\\?|$)`));
	const series = new URL(page.url()).pathname;
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

	// Opened again from BROWSE, an in-library series is its series, not a
	// preview again — and its ← still goes back to BROWSE (c262).
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.locator('.grid .tile', { hasText: 'Open Source 1-4' }).click();
	await expect(page).toHaveURL(new RegExp(`${series}\\?from=`));
	await expect(back.locator('.back-label')).toHaveText('BROWSE');
	await back.click();
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCES.open.id}(\\?|$)`));
	// A from that isn't an in-app BROWSE or search is ignored: ← LIBRARY.
	for (const from of ['https://evil.example/browse/1', '//evil.example/browse/1', '/settings']) {
		await page.goto(`${series}?from=${encodeURIComponent(from)}`);
		await expect(back.locator('.back-label')).toHaveText('LIBRARY');
		await expect(back).toHaveAttribute('href', '/');
	}
});

/**
 * Tall pages (2026-10-29): a source never says how big its pages are, and the
 * reader drew each one online in a manga page's box, so a manhwa's tall slice
 * came out a narrow column with black either side, whatever the zoom. The
 * box now takes the image's own shape once it arrives. The fake's second page
 * is 600 × 3000.
 */
test('a page read online takes its own shape once it arrives, paged and vertical', async ({
	page
}) => {
	test.setTimeout(90_000);
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.locator('.grid .tile', { hasText: 'Open Source 1-5' }).click();
	await page.locator('.cta-go .cta').click();
	await expect(page).toHaveURL(/\/read\/\d+/);

	const shapeOf = (box: import('@playwright/test').Locator) =>
		box.evaluate((el) => {
			const r = el.getBoundingClientRect();
			return { w: r.width, h: r.height };
		});

	// Paged: the second page's box is as tall as its image, five times its width.
	await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
		timeout: 20_000
	});
	await page.keyboard.press('ArrowLeft');
	const paged = page.locator('.stage .screen:not([aria-hidden]) .page[data-page="2"]');
	await expect(paged.locator('img')).toBeVisible({ timeout: 20_000 });
	await expect
		.poll(async () => {
			const s = await shapeOf(paged);
			return Math.round((s.h / s.w) * 10) / 10;
		})
		.toBe(5);

	// Vertical: every page as wide as the strip, the tall one included.
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: /R→L ·/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await sheet.getByRole('radio', { name: 'VERTICAL' }).click();
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	const strip = page.locator('.strip');
	await expect(strip).toBeVisible();
	// The chapter being read: the strip holds the next one too.
	const entry = new URL(page.url()).pathname.split('/').pop();
	const tall = strip.locator(`[data-role="page"][data-entry="${entry}"][data-index="1"] .page`);
	await tall.scrollIntoViewIfNeeded();
	await expect(tall.locator('img')).toBeVisible({ timeout: 20_000 });
	const width = (await shapeOf(strip)).w;
	await expect
		.poll(async () => {
			const s = await shapeOf(tall);
			return { full: Math.abs(s.w - width) < 1, ratio: Math.round((s.h / s.w) * 10) / 10 };
		})
		.toEqual({ full: true, ratio: 5 });
	// What's drawn fills the box: no column with black either side.
	const drawn = await tall.locator('img').evaluate((img) => {
		const i = img as HTMLImageElement;
		const r = i.getBoundingClientRect();
		return (i.naturalHeight / i.naturalWidth) * r.width <= r.height + 1;
	});
	expect(drawn).toBe(true);
});
