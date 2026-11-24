import { expect, test } from './fixtures';
import { engineDown, resetEngine, SOURCES } from './browse-world';

/**
 * A manga read online (doc/READING-ONLINE.md, "Manga online"): from a source's
 * preview without ADD, its pages
 * straight from the fake engine's /image/ proxy and never kept; then, added,
 * its chapters read online from the series screen, ↓ downloading apart.
 */

test('a chapter opens online from the preview, a record keeps the place, the series reads online', async ({
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
	// The pages come from the source, through tsundoku, and are never kept:
	// the reader holds them in memory only, as blob: URLs.
	const first = page.waitForResponse((r) => /\/api\/entries\/\d+\/pages\/0\?/.test(r.url()));
	await page.locator('.cta-go .cta').click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	const img = page.locator('.stage .screen:not([aria-hidden]) img').first();
	await expect(img).toBeVisible({ timeout: 20_000 });
	await expect(img).toHaveAttribute('src', /^blob:/);
	const res = await first;
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
	// ← goes back to the source it was added from, not the library.
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
	// preview again — and its ← still goes back to BROWSE.
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
 * Tall pages: a source never says how big its pages are, and in a manga
 * page's box a manhwa's tall slice comes out a narrow column with black either
 * side, whatever the zoom. The box takes the image's own shape once it
 * arrives. The fake's second page
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

/**
 * Reading on down the strip, a chapter read online crosses into the next
 * without anything moving on screen. Its data arrives in more than one step,
 * and the reader took the step for the chapter being left as a jump from the
 * controls: at each band the next chapter's first page snapped to the top of
 * the screen, mid-read (561 px here). Watched every frame: whatever page was
 * under the middle must move by about one wheel step, never more.
 */
test('the strip reads on across chapters read online, and nothing jumps at a band', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.locator('.grid .tile', { hasText: 'Open Source 1-5' }).click();
	await page.locator('.cta-go .cta').click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
		timeout: 20_000
	});
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: /R→L ·/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await sheet.getByRole('radio', { name: 'VERTICAL' }).click();
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('.strip')).toBeVisible();
	const first = new URL(page.url()).pathname;
	await page.evaluate(() => {
		const w = window as unknown as { jumps: string[] };
		w.jumps = [];
		let prev: { el: HTMLElement; top: number } | null = null;
		const frame = () => {
			const el =
				document
					.elementFromPoint(innerWidth / 2, innerHeight / 2)
					?.closest<HTMLElement>('[data-role]') ?? null;
			if (prev?.el.isConnected) {
				const moved = prev.el.getBoundingClientRect().top - prev.top;
				if (Math.abs(moved) > 150)
					w.jumps.push(
						`${Math.round(moved)}px: ${prev.el.dataset.entry}/${prev.el.dataset.index} at ${location.pathname}`
					);
			}
			prev = el ? { el, top: el.getBoundingClientRect().top } : null;
			requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
	});
	for (let i = 0; i < 160; i++) {
		await page.mouse.wheel(0, 80);
		await page.waitForTimeout(40);
	}
	await page.waitForTimeout(1500);
	// It read on into another chapter, and nothing on screen jumped.
	expect(new URL(page.url()).pathname).not.toBe(first);
	expect(await page.evaluate(() => (window as unknown as { jumps: string[] }).jumps)).toEqual([]);
});

/**
 * Turning back: a page read online is `no-store`, and a turn mounts a new
 * element for the page turned to, so the browser would ask the workstation,
 * and the workstation the source, for a page that had just been on screen; on
 * a bad connection the loading box stays. The reader holds the pages near the
 * one being read in memory
 * ($lib/reader/online-pages): forward and back again asks for each page once,
 * and a page drawn before is never drawn as its loading box again.
 */
test('turning back and forth on a chapter read online asks for each page once and never redraws its loading box', async ({
	page
}) => {
	test.setTimeout(90_000);
	const asked = new Map<string, number>();
	page.on('request', (r) => {
		const m = new URL(r.url()).pathname.match(/^\/api\/entries\/(\d+)\/pages\/(\d+)$/);
		if (m) asked.set(`${m[1]}/${m[2]}`, (asked.get(`${m[1]}/${m[2]}`) ?? 0) + 1);
	});
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.locator('.grid .tile', { hasText: 'Open Source 1-6' }).click();
	await page.locator('.cta-go .cta').click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	const entry = new URL(page.url()).pathname.split('/').pop()!;
	const main = (n: number) =>
		page.locator(`.stage .screen:not([aria-hidden]) .page[data-page="${n}"] img:not(.hidden)`);
	await expect(main(1)).toBeVisible({ timeout: 20_000 });
	// Online pages draw from the reader's own copy.
	await expect(main(1)).toHaveAttribute('src', /^blob:/);

	// Every frame from here: a page drawn once must never show its loading box again.
	await page.evaluate(() => {
		const w = window as unknown as { __flashes: string[] };
		w.__flashes = [];
		const drawn = new Set<string>();
		const look = () => {
			for (const p of document.querySelectorAll<HTMLElement>('.stage .screen .page')) {
				const n = p.dataset.page!;
				const img = p.querySelector('img');
				if (img && !img.classList.contains('hidden')) drawn.add(n);
				else if (drawn.has(n) && p.querySelector('.loading')) w.__flashes.push(`p. ${n}`);
			}
			requestAnimationFrame(look);
		};
		requestAnimationFrame(look);
	});
	// R→L: ← is forward.
	for (const [key, to] of [
		['ArrowLeft', 2],
		['ArrowRight', 1],
		['ArrowLeft', 2],
		['ArrowRight', 1]
	] as const) {
		await page.keyboard.press(key);
		await expect(main(to)).toBeVisible({ timeout: 20_000 });
		// Settled past the slide, so the next turn starts from rest.
		await page.waitForTimeout(400);
	}
	expect(
		await page.evaluate(() => (window as unknown as { __flashes: string[] }).__flashes)
	).toEqual([]);
	// Each page of the chapter was asked for once, however many turns reached it.
	const mine = [...asked].filter(([k]) => k.startsWith(`${entry}/`));
	expect(mine.length).toBeGreaterThanOrEqual(2);
	expect(mine.filter(([, n]) => n !== 1)).toEqual([]);
});
