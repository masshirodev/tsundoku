import { expect, test } from './fixtures';

/**
 * Installable (doc/INSTALL.md): Chromium's own verdict, not a checklist. Read-only.
 */
test('Chromium finds nothing stopping an install', async ({ page, browserName }) => {
	// 90 s for the worker below, and the rest.
	test.setTimeout(120_000);
	test.skip(browserName !== 'chromium', 'installability is a Chromium question');
	await page.goto('/');
	// The worker precaches the whole build first (about 1,400 files), from the
	// preview every other test's context is precaching from: 10-16 s with six
	// contexts alone at a load average of 25, and past the old 30 s on one to
	// four device projects in every loaded whole run of waves 19 and 20. Slow,
	// not stuck, so it gets offline-flow's measured 90 s (c439, c477).
	const asked = Date.now();
	await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
		timeout: 90_000
	});
	// On the result, so every loaded run reports the figure the 90 s is set
	// against (c497; doc/TESTING.md, "Load"), not only the run that measured it.
	test.info().annotations.push({
		type: 'controlled after',
		description: `${Date.now() - asked} ms`
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
