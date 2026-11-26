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
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

test.skip(
	process.env.TSUNDOKU_ENGINE_JAR === undefined,
	'needs the engine: build the web edition with TSUNDOKU_ENGINE_JAR (doc/TESTING.md, "The web edition")'
);
test.skip(
	({ browserName }) => browserName !== 'chromium',
	'Playwright’s Firefox cannot load the fetcher'
);

const KEIYOUSHI = '9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2';
const PKG = 'eu.kanade.tachiyomi.extension.all.webtoons';
const FETCHER = join(process.cwd(), 'build-fetcher', 'development');

let repo: Server;
let base = '';

/** The test's repository, as Mihon's index v2 shapes one. */
function repoAnswer(path: string): { type: string; body: Buffer | string } | null {
	if (path === '/good/repo.json')
		return {
			type: 'application/json',
			body: JSON.stringify({ meta: { name: 'Fake Repo', signingKeyFingerprint: KEIYOUSHI } })
		};
	// The older index only (`parseIndexLegacy`): `index.json` answers 404, and the
	// app falls back to `index.min.json`, files beside it under apk/.
	if (path === '/good/index.min.json')
		return {
			type: 'application/json',
			body: JSON.stringify([
				{
					name: 'Webtoons.com',
					pkg: PKG,
					apk: 'webtoons.apk',
					lang: 'all',
					code: 2,
					version: '1.6.2',
					nsfw: 0,
					sources: [{ id: '1', name: 'Webtoons.com', lang: 'en', baseUrl: 'https://example.org' }]
				}
			])
		};
	if (path === '/good/apk/webtoons.apk')
		return {
			type: 'application/vnd.android.package-archive',
			body: readFileSync('tests/fixtures/apk/tachiyomi-all.webtoons-v1.6.2.apk')
		};
	return null;
}

test.beforeAll(async () => {
	repo = createServer((req, res) => {
		const answer = repoAnswer(new URL(req.url ?? '/', 'http://x').pathname);
		if (!answer) return void res.writeHead(404).end();
		res.writeHead(200, { 'content-type': answer.type }).end(answer.body);
	});
	await new Promise<void>((resolve) => repo.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${(repo.address() as AddressInfo).port}`;
});
test.afterAll(() => repo?.close());

test('a repository added and an extension installed, kept across a reload and loaded by the engine', async ({
	baseURL
}) => {
	// Installing converts the APK in CheerpJ (dex2jar): tens of seconds on a runner.
	test.setTimeout(600_000);
	const profile = mkdtempSync(join(process.cwd(), 'test-results', 'install-profile-'));
	let context: BrowserContext | undefined;
	try {
		context = await chromium.launchPersistentContext(profile, {
			channel: 'chromium',
			headless: true,
			baseURL,
			viewport: { width: 1440, height: 900 },
			args: [`--disable-extensions-except=${FETCHER}`, `--load-extension=${FETCHER}`]
		});
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'ready', {
			timeout: 60_000
		});
		// The engine starts once the fetcher answers: CheerpJ from its CDN, then the jar.
		await expect(page.locator('html')).toHaveAttribute('data-web-engine', 'ready', {
			timeout: 180_000
		});

		const row = (name: string) => page.locator('.rows .row', { hasText: name });
		await page.goto(
			`/browse/extensions?tab=repos&add=${encodeURIComponent(`${base}/good/index.min.json`)}`
		);
		await expect(page.locator('.found')).toContainText('FOUND · Fake Repo', { timeout: 60_000 });
		await page.getByRole('button', { name: 'ADD Fake Repo' }).click();
		await expect(row('Fake Repo')).toBeVisible();

		await page.goto('/browse/extensions?tab=available');
		await row('Webtoons.com').getByRole('button', { name: 'INSTALL' }).click();
		await expect(row('Webtoons.com')).toContainText('INSTALLED ✓', { timeout: 300_000 });

		// Kept: the files database, the library's row, and the engine's converted jar.
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'ready', {
			timeout: 60_000
		});
		await page.goto('/browse/extensions');
		await expect(row('Webtoons.com')).toContainText('1.6.2', { timeout: 60_000 });
		await expect(row('Webtoons.com')).not.toContainText('FAILED TO LOAD');
	} finally {
		await context?.close();
		rmSync(profile, { recursive: true, force: true });
	}
});
