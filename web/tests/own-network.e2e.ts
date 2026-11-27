/**
 * A repository on the reader's own network (c1156; handoff `fetcher-options`,
 * revision 1), through the web edition's own screens and the real fetcher:
 * the fetcher refuses it, REPOSITORIES offers ALLOW, the fetcher asks in its
 * own window, the reader allows it there, and the form looks again by itself
 * and finds the repository. Chromium only: Firefox's add-on window can't be
 * driven (doc/TESTING.md, "Asking the reader"). Needs no engine: finding a
 * repository is the server worker's request, relayed by the tab.
 */
import { expect, test } from '@playwright/test';
import { fetcherBrowser, startRepo } from './extension';

let repo: Awaited<ReturnType<typeof startRepo>>;
test.beforeAll(async () => {
	// 127.0.0.2: loopback all the same, but not one the development fetcher allows.
	repo = await startRepo('127.0.0.2');
});
test.afterAll(() => repo?.close());

test('a repository on the reader’s own network: refused, allowed in the fetcher’s window, then found', async ({
	baseURL,
	browserName
}) => {
	test.skip(browserName !== 'chromium', 'the fetcher’s window is driven in Chromium only');
	test.setTimeout(180_000);
	const browser = await fetcherBrowser(baseURL, 'own-network', browserName);
	try {
		const { context, page } = browser;
		await page.goto('/browse/extensions?tab=repos');
		await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'ready', {
			timeout: 60_000
		});
		const host = new URL(repo.base).host;
		await page.getByLabel('A repository’s address').fill(`${repo.base}/good/index.min.json`);
		await page.getByLabel('A repository’s address').press('Enter');

		const refused = page.getByRole('region', { name: 'ON YOUR OWN NETWORK' });
		await expect(refused).toContainText(host, { timeout: 60_000 });
		await expect(refused).toContainText('TSUNDOKU CAN ASK; ONLY YOU CAN ALLOW IT');

		const [window] = await Promise.all([
			context.waitForEvent('page'),
			refused.getByRole('button', { name: /ALLOW/ }).click()
		]);
		await expect(window.locator('#target')).toHaveText(host);
		await expect(refused.getByRole('button')).toHaveText("ANSWER IN THE FETCHER'S WINDOW");
		await Promise.all([
			window.waitForEvent('close'),
			window
				.locator('#allow')
				.click()
				.catch(() => {})
		]);

		// The form looked again by itself, and says what was allowed, once.
		await expect(page.locator('.found')).toContainText('FOUND · Fake Repo', { timeout: 60_000 });
		await expect(page.locator('.found')).toContainText(`ALLOWED IN THE FETCHER · ${host}`);
	} finally {
		if (test.info().status !== test.info().expectedStatus) console.log(browser.report());
		await browser.close();
	}
});
