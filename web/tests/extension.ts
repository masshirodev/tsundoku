/**
 * What the web edition's browser tests with a real extension share: a
 * repository of their own on a loopback port, listing Keiyoushi's Webtoons.com
 * extension (tests/fixtures/apk/README.md), a Chromium with the development
 * fetcher, and the steps that install it (doc/WEB-EDITION.md, "Installing an
 * extension"). Used by install.e2e.ts and browse.e2e.ts.
 */
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

export const KEIYOUSHI = '9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2';
export const PKG = 'eu.kanade.tachiyomi.extension.all.webtoons';
export const FETCHER = join(process.cwd(), 'build-fetcher', 'development');

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

/** Starts the repository; `base` is its address. */
export async function startRepo(): Promise<{ base: string; close: () => void }> {
	const repo: Server = createServer((req, res) => {
		const answer = repoAnswer(new URL(req.url ?? '/', 'http://x').pathname);
		if (!answer) return void res.writeHead(404).end();
		res.writeHead(200, { 'content-type': answer.type }).end(answer.body);
	});
	await new Promise<void>((resolve) => repo.listen(0, '127.0.0.1', resolve));
	return {
		base: `http://127.0.0.1:${(repo.address() as AddressInfo).port}`,
		close: () => void repo.close()
	};
}

/**
 * A Chromium with the development fetcher, on a profile of its own (an
 * extension needs a persistent context), removed by `close`.
 */
export async function fetcherBrowser(
	baseURL: string | undefined,
	name: string
): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
	const profile = mkdtempSync(join(process.cwd(), 'test-results', `${name}-profile-`));
	const context = await chromium.launchPersistentContext(profile, {
		channel: 'chromium',
		headless: true,
		baseURL,
		viewport: { width: 1440, height: 900 },
		args: [`--disable-extensions-except=${FETCHER}`, `--load-extension=${FETCHER}`]
	});
	const page = context.pages()[0] ?? (await context.newPage());
	return {
		context,
		page,
		close: async () => {
			await context.close();
			rmSync(profile, { recursive: true, force: true });
		}
	};
}

/** The app up, and the engine started (CheerpJ from its CDN, then the jar). */
export async function ready(page: Page, path = '/'): Promise<void> {
	await page.goto(path);
	await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'ready', { timeout: 60_000 });
	await expect(page.locator('html')).toHaveAttribute('data-web-engine', 'ready', {
		timeout: 180_000
	});
}

/** A row of BROWSE › EXTENSIONS. */
export const extensionRow = (page: Page, name: string) =>
	page.locator('.rows .row', { hasText: name });

/** The repository added and Webtoons.com installed, through the app's own screens. */
export async function installWebtoons(page: Page, base: string): Promise<void> {
	await page.goto(
		`/browse/extensions?tab=repos&add=${encodeURIComponent(`${base}/good/index.min.json`)}`
	);
	await expect(page.locator('.found')).toContainText('FOUND · Fake Repo', { timeout: 60_000 });
	await page.getByRole('button', { name: 'ADD Fake Repo' }).click();
	await expect(extensionRow(page, 'Fake Repo')).toBeVisible();
	await page.goto('/browse/extensions?tab=available');
	await extensionRow(page, 'Webtoons.com').getByRole('button', { name: 'INSTALL' }).click();
	await expect(extensionRow(page, 'Webtoons.com')).toContainText('INSTALLED ✓', {
		timeout: 300_000
	});
}
