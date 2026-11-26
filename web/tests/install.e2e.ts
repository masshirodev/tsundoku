/**
 * Installing an extension in the web edition (doc/WEB-EDITION.md, "Installing
 * an extension"), the whole chain: the repository's index and the APK fetched
 * by the server through the fetcher extension, the APK's signature checked
 * (WebCrypto), kept in the browser's files database, and loaded by the engine
 * running in CheerpJ in the tab. Then a reload, and it is still installed.
 *
 * It needs the real engine (`TSUNDOKU_ENGINE_JAR` when the web build is made,
 * tsundoku-engine's `:browser:slimJar`) and the development fetcher
 * (`yarn run build:fetcher --dev`), and runs in Chromium only: Playwright's
 * Firefox cannot load an extension. GitHub's `browsers` workflow runs it with
 * both; without the jar it is skipped, and says why.
 *
 * The repository is this test's own, on a loopback port, listing a real
 * extension signed by Keiyoushi's key (tests/fixtures/apk/README.md).
 */
import { expect, test } from '@playwright/test';
import { extensionRow, fetcherBrowser, installWebtoons, ready, startRepo } from './extension';

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

test('a repository added and an extension installed, kept across a reload and loaded by the engine', async ({
	baseURL
}) => {
	// Installing converts the APK in CheerpJ (dex2jar): tens of seconds on a runner.
	test.setTimeout(600_000);
	const browser = await fetcherBrowser(baseURL, 'install');
	try {
		const { page } = browser;
		await ready(page);
		await installWebtoons(page, repo.base);

		// Kept: the files database, the library's row, and the engine's converted jar.
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'ready', {
			timeout: 60_000
		});
		await page.goto('/browse/extensions');
		await expect(extensionRow(page, 'Webtoons.com')).toContainText('1.6.2', { timeout: 60_000 });
		await expect(extensionRow(page, 'Webtoons.com')).not.toContainText('FAILED TO LOAD');
	} finally {
		await browser.close();
	}
});
