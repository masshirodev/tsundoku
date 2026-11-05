import { expect, test } from './fixtures';

/**
 * Installable (doc/INSTALL.md): Chromium's own verdict, not a checklist. Read-only.
 */

/**
 * When the service worker's wait began and ended, for the annotation the
 * `afterEach` below writes. Only the first case sets it.
 */
let wait: { asked: number; controlled?: number } | null = null;

// The figure the 90 s is set against goes on every result, red ones above all
// (c497; doc/TESTING.md, "Load"). It is written here, not in the case: a
// case's own code stops at its first throw, and after a timeout nothing more
// of it runs at all, where an `afterEach` runs on every outcome with a budget
// of its own (c507's lesson, c563). Until c563 a red run recorded nothing.
test.afterEach(() => {
	if (!wait) return;
	const { asked, controlled } = wait;
	wait = null;
	test.info().annotations.push({
		type: 'controlled after',
		description:
			controlled === undefined ? `not within ${Date.now() - asked} ms` : `${controlled - asked} ms`
	});
});

test('Chromium finds nothing stopping an install', async ({ page, browserName }) => {
	// The wait's own 90 s, plus the steps around it, so the wait can run to
	// the end and fail as itself rather than be cut short by the test's
	// budget (c563). Before it, the fixtures' `goto` (network quiet, then
	// hydration): 11.5 s at worst, measured at a load of about 55
	// (`tv-library-top`, wave 21; doc/TESTING.md, "Load"), given 30 s. After it, two CDP calls: well under a second, given 30 s.
	test.setTimeout(150_000);
	test.skip(browserName !== 'chromium', 'installability is a Chromium question');
	await page.goto('/');
	// The worker precaches the whole build first (about 1,400 files), from the
	// preview every other test's context is precaching from: 10-16 s with six
	// contexts alone at a load average of 25, and past the old 30 s on one to
	// four device projects in every loaded whole run of waves 19 and 20. Slow,
	// not stuck, so it gets offline-flow's measured 90 s (c439, c477). Wave 22
	// (c497): 3.4-8.7 s alone, 5 runs per device project at a load of 20-25;
	// the 90 s is for a whole run's contexts all precaching at once.
	const timing: { asked: number; controlled?: number } = { asked: Date.now() };
	wait = timing;
	await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
		timeout: 90_000
	});
	timing.controlled = Date.now();
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
