import type { Page } from '@playwright/test';
import { expect, readerReady, test } from './helpers/hydrated';
import { revealOn } from './helpers/reveal';

/**
 * The device cache and offline reading (doc/OFFLINE.md), with the service
 * worker of the production build. Serial, tablet-portrait only. This file
 * owns Drawing: Saikyou Mangaka (paged R→L, with chapters ahead) and its reading.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = 'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru';

async function seriesUrl(page: Page) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	return page.url().replace(/\?.*$/, '');
}

async function controlled(page: Page) {
	// The service worker has to be in charge before anything is cached. It
	// precaches the whole build first (about 1,400 files), from the preview
	// every other test's context is also precaching from. Measured: 10-16 s
	// with six fresh contexts
	// and nothing else at a load average of 25, and past 30 s in two of three
	// whole loaded runs. The step is slow, not stuck, so it gets 90 s.
	await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
		timeout: 90_000
	});
}

test('opening a chapter keeps it and the next two on the tablet, and they read offline', async ({
	page,
	context
}) => {
	// 90 s for the worker, 60 s for three chapters' pages, and the reading.
	test.setTimeout(180_000);
	const series = await seriesUrl(page);
	await controlled(page);
	await page.getByRole('link', { name: /▶/ }).first().click();
	await readerReady(page);
	const entry = Number(page.url().match(/\/read\/(\d+)/)![1]);

	// While the chapter is open, it and the next two are cached; each is
	// marked only once all its pages (and its OCR text) are in. Three whole
	// chapters take a while under the full parallel run.
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					const keys = await (await caches.open('tsundoku-entries')).keys();
					return keys.filter((k) => k.url.includes('/__cache/')).length;
				}),
			{ timeout: 60000 }
		)
		.toBe(3);
	// And the series screen's ↓ column shows them.
	await page.goto(series);
	await expect(page.locator('.entry .cache', { hasText: '↓' })).toHaveCount(3);

	// Offline: the next chapter still opens, from the tablet.
	await context.setOffline(true);
	await page.goto(`/read/${entry + 1}?p=2`);
	await readerReady(page);
	await expect(page.locator('img[alt="Page 2"]')).toBeVisible();
	await expect
		.poll(() => page.locator('img[alt="Page 2"]').evaluate((i: HTMLImageElement) => i.naturalWidth))
		.toBeGreaterThan(0);

	// Reading offline: the open, and the page turned to once it settles,
	// are both kept on the tablet. Waited for by P. 3's own record, not a
	// count: under the full run, the open and P. 2's settle made two before
	// the turn had settled, and the replay left the chapter on P. 2.
	await page.mouse.click(40, 640);
	await expect
		.poll(() =>
			page.evaluate(() =>
				(JSON.parse(localStorage.getItem('tsundoku.pending') ?? '[]') as string[]).map((b) => {
					const r = JSON.parse(b) as { kind: string; page: number };
					return `${r.kind}:${r.page}`;
				})
			)
		)
		.toEqual(expect.arrayContaining(['open:1', 'page:2']));

	// Back online: it reaches the workstation, at its own time.
	await context.setOffline(false);
	await page.evaluate(() => dispatchEvent(new Event('online')));
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('tsundoku.pending')), { timeout: 15000 })
		.toBeNull();
	await page.goto(`/read/${entry + 1}`);
	await readerReady(page);
	await page.mouse.click(400, 640, { button: 'middle' });
	await expect(page.locator('header[aria-label="Reader"] .meta')).toContainText('P. 3 OF');
});

test('↓ CACHE and REMOVE CACHE act on the selection, with counts', async ({ page }) => {
	// Each test has its own browser, so its own empty cache.
	await seriesUrl(page);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const rows = page.locator('.entry .entry-btn');
	await rows.nth(0).click();
	await rows.nth(1).click();
	await expect(page.getByRole('button', { name: /↓ CACHE/ })).toContainText('2');
	await page.getByRole('button', { name: /↓ CACHE/ }).click();
	await expect(page.locator('.entry .cache', { hasText: '↓' })).toHaveCount(2, { timeout: 20000 });
	await expect(page.getByRole('button', { name: /REMOVE CACHE/ })).toContainText('2');
	await page.getByRole('button', { name: /REMOVE CACHE/ }).click();
	await expect(page.locator('.entry .cache', { hasText: '↓' })).toHaveCount(0);
});

test('hiding a series takes what the tablet kept of it off the tablet', async ({ page }) => {
	// 90 s for the worker, then two chapters and the sweep.
	test.setTimeout(180_000);
	const series = await seriesUrl(page);
	const id = Number(series.match(/\/series\/(\d+)/)![1]);
	const origin = new URL(series).origin;
	await controlled(page);
	// The service worker keeps this screen's copy once it is in charge.
	await page.goto(series);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const rows = page.locator('.entry .entry-btn');
	await rows.nth(0).click();
	await rows.nth(1).click();
	await page.getByRole('button', { name: /↓ CACHE/ }).click();
	await expect(page.locator('.entry .cache', { hasText: '↓' })).toHaveCount(2, { timeout: 20000 });

	const held = () =>
		page.evaluate(async (id) => {
			const of = async (name: string) =>
				(await caches.has(name))
					? (await (await caches.open(name)).keys()).map((k) => new URL(k.url).pathname)
					: [];
			const entries = await of('tsundoku-entries');
			return {
				markers: entries.filter((p) => p.startsWith(`/__cache/series/${id}/`)).length,
				pages: entries.filter((p) => /^\/api\/entries\/\d+\/pages\/\d+$/.test(p)).length,
				screen: (await of('tsundoku-screens')).some((p) => p.startsWith(`/series/${id}`))
			};
		}, id);
	expect(await held()).toMatchObject({ markers: 2, screen: true });
	expect((await held()).pages).toBeGreaterThan(0);

	const hide = (on: boolean) =>
		page.request.post(`${series}?/hide`, {
			headers: { origin, 'x-sveltekit-action': 'true' },
			form: { on: on ? '1' : '0' }
		});
	try {
		expect((await hide(true)).ok()).toBe(true);
		// The library, as the series screen's own HIDE ends with reveal off.
		await page.goto('/');
		await expect.poll(held, { timeout: 15000 }).toEqual({ markers: 0, pages: 0, screen: false });
	} finally {
		await revealOn(page.context());
		expect((await hide(false)).ok()).toBe(true);
		await page.context().clearCookies({ name: 'tsundoku_reveal' });
	}
});

test('nothing is kept while reveal is on', async ({ page, request }) => {
	await revealOn(page.context());
	const res = await page.request.get('/');
	expect(res.headers()['cache-control']).toBe('no-store');
	const plain = await request.get('/api/entries/999999/pages');
	expect(plain.status()).toBe(404);
});
