/**
 * Reading a chapter online in the web edition (c1122, doc/READING-ONLINE.md):
 * a series opened from a source, ▶ READ, its pages through the engine and the
 * fetcher into the image reader, read to the chapter's end. The browsing
 * record keeps it across a reload, and HISTORY lists it, as the self-hosted
 * app does (tests/browse-online.e2e.ts there).
 *
 * The extension and its made-up site are browse.e2e.ts's
 * (web/tests/extension.ts): nothing reaches the real webtoons.com. Chromium
 * only, with the engine's jar, as install.e2e.ts.
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
test.skip(
	({ browserName }) => browserName !== 'chromium',
	'Playwright’s Firefox cannot load the fetcher'
);

let repo: Awaited<ReturnType<typeof startRepo>>;
test.beforeAll(async () => {
	repo = await startRepo();
});
test.afterAll(() => repo?.close());

/**
 * A page of the chapter, once its image has arrived from the engine: by its
 * name, which the paged reader and the vertical strip (a webtoon opens in
 * the strip) both give it.
 */
const shown = (page: Page, n = 1) => page.getByRole('img', { name: `Page ${n}`, exact: true });

test('a chapter read online to its end, kept across a reload, and listed in HISTORY', async ({
	baseURL
}) => {
	test.setTimeout(900_000);
	const browser = await fetcherBrowser(baseURL, 'read');
	try {
		const { page, context } = browser;
		const asked = await fakeWebtoons(context);
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
	} finally {
		await browser.close();
	}
});
