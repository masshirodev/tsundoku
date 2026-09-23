import { expect, test } from './fixtures';

/**
 * Installable (doc/INSTALL.md): Chromium's own verdict, not a checklist. Read-only.
 */
test('Chromium finds nothing stopping an install', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'installability is a Chromium question');
	await page.goto('/');
	await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
		timeout: 15000
	});
	const cdp = await page.context().newCDPSession(page);
	const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
	expect(installabilityErrors).toEqual([]);
	const manifest = await cdp.send('Page.getAppManifest');
	expect(manifest.errors).toEqual([]);
});

test('the manifest and icons load without a session, as the browser fetches them', async ({
	playwright,
	baseURL
}) => {
	const anonymous = await playwright.request.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] }
	});
	const m = await anonymous.get('/manifest.webmanifest');
	expect(m.status()).toBe(200);
	const manifest = await m.json();
	expect(manifest).toMatchObject({ display: 'fullscreen', start_url: '/' });
	for (const icon of manifest.icons as { src: string }[])
		expect((await anonymous.get(icon.src)).status()).toBe(200);
	await anonymous.dispose();
});
