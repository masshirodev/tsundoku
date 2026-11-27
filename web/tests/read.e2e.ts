/**
 * The web edition's thin path, end to end (c1122, c1123; doc/READING-ONLINE.md):
 * a series opened from a source, ▶ READ, its pages through the engine and the
 * fetcher into the image reader, read to the chapter's end. The browsing
 * record keeps it across a reload and HISTORY lists it, as the self-hosted
 * app does (tests/browse-online.e2e.ts there); then + ADD TO LIBRARY, the
 * browser asked to keep the library, and after a reload the library has the
 * series with CONTINUE on the next chapter.
 *
 * The extension and its made-up site are browse.e2e.ts's
 * (web/tests/extension.ts): nothing reaches the real webtoons.com. Chromium and
 * Firefox, with the engine's jar, as install.e2e.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import {
	EPISODES,
	PAGES,
	fakeWebtoons,
	fetcherBrowser,
	installWebtoons,
	ready,
	startRepo
} from './extension';

test.skip(
	process.env.TSUNDOKU_ENGINE_JAR === undefined,
	'needs the engine: build the web edition with TSUNDOKU_ENGINE_JAR (doc/TESTING.md, "The web edition")'
);

let repo: Awaited<ReturnType<typeof startRepo>>;
test.beforeAll(async () => {
	repo = await startRepo();
});
test.afterAll(() => repo?.close());

/**
 * A page of the chapter, once its image has arrived from the engine: by its
 * name, which the paged reader and the vertical strip (a webtoon opens in
 * the strip) both give it. Only the chapter in the address counts: near a
 * chapter's end the strip already holds the next chapter's first pages
 * (doc/READER.md, "Preloading"), named the same, and these chapters are
 * three pages long, so that is from their first page.
 */
const shown = (page: Page, n = 1) => {
	const entry = new URL(page.url()).pathname.split('/')[2];
	return page
		.getByRole('img', { name: `Page ${n}`, exact: true })
		.and(page.locator(`img:not([data-entry]:not([data-entry="${entry}"]) img)`));
};

test('the thin path: a chapter read online to its end, kept, listed in HISTORY, then added and found in the library', async ({
	baseURL,
	browserName
}) => {
	test.setTimeout(900_000);
	const site = await fakeWebtoons();
	const browser = await fetcherBrowser(baseURL, 'read', browserName, site);
	try {
		const { page } = browser;
		// A step that cannot happen fails in minutes, not at the test's end.
		page.setDefaultTimeout(180_000);
		const { asked } = site;
		await ready(page);
		await installWebtoons(page, repo.base);

		// The series, from the source.
		await page.goto('/browse');
		await page
			.getByRole('link', { name: /Webtoons\.com/ })
			.first()
			.click();
		const tile = page.locator('a[href^="/downloads/source/"]', { hasText: 'Fake Strip One' });
		await expect(tile).toBeVisible({ timeout: 180_000 });
		await tile.click();
		const cta = page.locator('.cta-go .cta');
		await expect(cta).toContainText('▶ READ', { timeout: 180_000 });
		const preview = page.url();

		// ▶ READ: the first page, its bytes through the engine and the fetcher.
		await cta.click();
		await expect(page).toHaveURL(/\/read\/\d+/, { timeout: 180_000 });
		await expect(shown(page)).toBeVisible({ timeout: 180_000 });
		// Its bytes arrived: the made-up page is 400 px wide.
		await expect
			.poll(
				() =>
					shown(page).evaluate((i) =>
						(i as HTMLImageElement).complete ? (i as HTMLImageElement).naturalWidth : 0
					),
				{ timeout: 180_000 }
			)
			.toBe(400);
		expect(asked.some((a) => /\/episode-1\/viewer$/.test(a))).toBe(true);
		expect(asked.some((a) => /\/page-1-1\.png$/.test(a))).toBe(true);

		// To the chapter's end, by the reader's own keys: its last page, then
		// the end of the chapter.
		const chapter = new URL(page.url()).pathname;
		await page.goto(`${chapter}?p=last`);
		await expect(shown(page, PAGES)).toBeVisible({ timeout: 180_000 });
		expect(asked.some((a) => a.endsWith(`/page-1-${PAGES}.png`))).toBe(true);
		const end = page.getByText(/^END · /);
		for (let i = 0; i < 6 && !(await end.isVisible()); i++) {
			for (const key of ['PageDown', 'ArrowLeft']) {
				if (await end.isVisible()) break;
				await page.keyboard.press(key);
				await page.waitForTimeout(500);
			}
		}
		await expect(end).toBeVisible({ timeout: 30_000 });

		// The browsing record keeps it, and a reload keeps the record.
		await page.goto(preview);
		const record = page.locator('.row.record');
		await expect(record).toContainText(`1 of ${EPISODES} read`, { timeout: 180_000 });
		await page.reload();
		await expect(record).toContainText(`1 of ${EPISODES} read`, { timeout: 180_000 });

		// HISTORY lists it.
		await page.goto('/history');
		await expect(page.locator('.row', { hasText: 'Fake Strip One' }).first()).toBeVisible({
			timeout: 60_000
		});

		// + ADD TO LIBRARY: the record becomes the library's series (c1123).
		await page.goto(preview);
		// "+ ADD TO LIBRARY", or "+ ADD" where the bar is narrow.
		await page.getByRole('button', { name: /^\+ ADD( TO LIBRARY)?$/ }).click();
		await expect(page).toHaveURL(/\/series\/\d+/, { timeout: 180_000 });
		await expect(page.getByText('ADDED TO THE LIBRARY')).toBeVisible();
		// Keeping the library: Firefox asks the visitor, so a band offers it;
		// Chromium decides by itself, asked at once with no band (Keep-Ask).
		const band = page.getByText(/^KEEP THIS LIBRARY/);
		if (browserName === 'firefox') {
			await expect(band).toHaveText('KEEP THIS LIBRARY IN FIREFOX');
			await page.getByRole('button', { name: 'ASK FIREFOX →' }).click();
		}
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('tsundoku-keep-asked')))
			.not.toBeNull();
		await expect(band).toHaveCount(0);

		// After a reload, the library has it, and CONTINUE says how far it was read.
		await page.reload();
		await page.goto('/');
		await expect(page.locator('.cont', { hasText: 'Fake Strip One' })).toBeVisible({
			timeout: 60_000
		});
		await expect(page.locator('.cont', { hasText: 'Fake Strip One' })).toContainText(
			`1 of ${EPISODES}`
		);
	} finally {
		// What the made-up site was asked, and the page's console: the first things to read.
		if (test.info().status !== test.info().expectedStatus) console.log(browser.report());
		await browser.close();
		site.close();
	}
});
