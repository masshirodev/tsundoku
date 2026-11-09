import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The grid's next page on a TV (c858; doc/LIBRARY.md, "Pages", "The grid never
 * stalls with its end on screen"): the owner's own device, 960x540 with no
 * pointer, where one page of 120 tiles takes the main thread away for long
 * enough that a held ↓ reaches the end with no frame in between. Named `tv-`
 * so the `tv` project runs it; the plain `library-more` runs on the other
 * four. Read-only, on the shared database.
 */

const pageRequests = (page: Page) => {
	const offsets: number[] = [];
	page.on('request', (r) => {
		const u = new URL(r.url());
		if (r.method() === 'GET' && u.pathname === '/api/library' && !u.searchParams.has('ids'))
			offsets.push(Number(u.searchParams.get('offset')));
	});
	return offsets;
};

test('a page that lands with the bottom on screen in the same task still asks for the next', async ({
	page
}) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_grid_page', value: '9', url: 'http://localhost' }]);
	const offsets = pageRequests(page);
	await page.addInitScript(() => {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync('.grid .tile { height: 4000px; }');
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
	});
	await page.goto('/?sort=title');
	await expect(page.locator('.more')).toBeVisible();
	expect(offsets, 'nothing asked before the end comes near').toEqual([]);
	await page.evaluate(() => {
		const grid = document.querySelector('.grid')!;
		const mo = new MutationObserver(async () => {
			mo.disconnect();
			for (let i = 0; i < 20; i++) await Promise.resolve();
			scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
			(window as unknown as { landed: boolean }).landed = true;
		});
		mo.observe(grid, { childList: true });
	});
	await page.evaluate(() =>
		scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
	);
	await page.waitForFunction(() => (window as unknown as { landed?: boolean }).landed === true);
	expect(offsets, 'the page that landed').toEqual([9]);
	await expect
		.poll(() => offsets, {
			message: 'the next page was asked for with no further input',
			timeout: 8000
		})
		.toEqual([9, 18]);
});

/**
 * How far ahead a TV asks: 3,600 px, measured against a held ↓ (doc/LIBRARY.md,
 * "Pages"). Placed on either side of it, by the row's own position.
 */
for (const [ahead, asks] of [
	[3300, true],
	[3900, false]
] as const) {
	test(`with the end ${ahead} px below the screen, a TV ${asks ? 'asks' : 'does not ask yet'}`, async ({
		page
	}) => {
		await page
			.context()
			.addCookies([{ name: 'tsundoku_grid_page', value: '9', url: 'http://localhost' }]);
		const offsets = pageRequests(page);
		await page.addInitScript(() => {
			const sheet = new CSSStyleSheet();
			sheet.replaceSync('.grid .tile { height: 8000px; }');
			document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
		});
		await page.goto('/?sort=title');
		await expect(page.locator('.more')).toBeVisible();
		await page.evaluate((px) => {
			const top = document.querySelector('.more')!.getBoundingClientRect().top + scrollY;
			scrollTo({ top: top - innerHeight - px, behavior: 'instant' });
		}, ahead);
		await page.evaluate(() => new Promise(requestAnimationFrame));
		if (asks) await expect.poll(() => offsets, { timeout: 8000 }).toEqual([9]);
		else {
			await page.waitForTimeout(500);
			expect(offsets).toEqual([]);
			// Something did happen: one step nearer and it asks.
			await page.evaluate(() => scrollBy({ top: 800, behavior: 'instant' }));
			await expect.poll(() => offsets, { timeout: 8000 }).toEqual([9]);
		}
	});
}
