import { devices, type Locator, type Page, type Request, type Response } from '@playwright/test';
import { expect, hydrated, test } from './fixtures';
import { NOVEL_REPO } from './browse-world';

/**
 * A source page's TRY AGAIN really asks the server: a plain
 * one is a link to the page's own URL, which SvelteKit would not load again,
 * so it reloads the document. Runs in the browse project, against an LNReader
 * plugin installed in the browse world's shared database and put back after
 * every case; its band is the plain one, and the refused-check one is that
 * same answer with the check's phrase put in on its way to the browser.
 */

const PLUGIN = 'ln:goodnovels';
const SOURCE = `/browse/${PLUGIN}`;

/** This page's asks of the source page: every document and every `__data.json`. */
type Ask = { how: 'document' | 'data'; url: string; response: Promise<Response | null> };
let asked: Ask[] = [];
/** This page's writes still unanswered, so a timed-out INSTALL can't land after the put-back. */
let writes = new Set<Request>();

const band = (page: Page) => page.locator('.band', { hasText: 'GOOD NOVELS DID NOT ANSWER' });
const again = (page: Page) => band(page).getByRole('link', { name: 'TRY AGAIN', exact: true });
const row = (page: Page, name: string) => page.locator('.rows .row', { hasText: name });

function watch(page: Page) {
	asked = [];
	writes = new Set();
	const own = writes;
	page.on('request', (r) => {
		if (r.method() !== 'GET') own.add(r);
		const u = new URL(r.url());
		if (u.pathname === SOURCE && r.isNavigationRequest())
			asked.push({ how: 'document', url: u.pathname + u.search, response: r.response() });
		else if (u.pathname === `${SOURCE}/__data.json`)
			asked.push({ how: 'data', url: u.pathname + u.search, response: r.response() });
	});
	page.on('requestfinished', (r) => own.delete(r));
	page.on('requestfailed', (r) => own.delete(r));
}

/** Good Novels and its repository, through the app's own forms (browse-extensions' LNReader case). */
async function install(page: Page) {
	await page.goto(`/browse/extensions?tab=repos&add=${encodeURIComponent(NOVEL_REPO)}`);
	await expect(page.locator('.found')).toContainText('1 NOVEL PLUGIN');
	await page.locator('.found button').click();
	await expect(row(page, '127.0.0.1').filter({ hasText: 'NOVELS' })).toContainText('1 PLUGIN');
	await page.goto('/browse/extensions?tab=available&kind=novels');
	await row(page, 'Good Novels').getByRole('button', { name: 'INSTALL' }).click();
	// With no script the form's answer is the INSTALLED list, whose row has REMOVE….
	await expect(row(page, 'Good Novels')).toContainText(/INSTALLED ✓|REMOVE…/);
}

/** The source page, its band drawn; every ask after this is the tap's own. */
async function plainBand(page: Page) {
	await page.goto(SOURCE);
	await expect(band(page)).toContainText('IS NOT ON THE INTERNET');
	await expect(band(page)).not.toContainText('SOLVES THE CHECK AFRESH');
	await expect(again(page)).not.toHaveAttribute('href', /again=/);
	asked = [];
}

/**
 * The band of a check that could not be passed. The browse world has no site
 * that refuses (its plugin's address is loopback, which the host never
 * fetches), so the one answer on its way to the browser says the check's
 * phrase instead, and the page draws its own `again=1` link from it.
 */
async function refusedBand(page: Page) {
	let once = true;
	await page.route(
		(u) => u.pathname === SOURCE && !u.search,
		async (route) => {
			if (!once) return route.continue();
			once = false;
			const response = await route.fetch();
			const body = (await response.text()).replace(
				/is not on the internet/,
				'answered 403 (its check could not be passed)'
			);
			await route.fulfill({ response, body });
		}
	);
	await page.goto(SOURCE);
	await expect(band(page)).toContainText('SOLVES THE CHECK AFRESH');
	await expect(again(page)).toHaveAttribute('href', `${SOURCE}?again=1`);
	asked = [];
}

/**
 * Marks this document, and after `tap` waits until another has replaced it:
 * only a new document lacks the mark, so a hydrated old page can't pass for it.
 */
async function tapAndReload(page: Page, tap: () => Promise<void>) {
	await page.evaluate(() => {
		document.documentElement.dataset.beforeTap = '1';
	});
	await tap();
	await expect.poll(() => asked.length, { message: 'the server was asked' }).toBeGreaterThan(0);
	await expect(page.locator('html[data-before-tap]')).toHaveCount(0);
	await hydrated(page);
}

/** The tap's one document, answered from the server with the band's sentence in it. */
async function expectFreshAnswer(ask: Ask) {
	expect(ask.how).toBe('document');
	const response = await ask.response;
	expect(response?.status()).toBe(200);
	expect((await response!.text()).toLowerCase()).toContain('is not on the internet');
}

test.beforeEach(async ({ page }) => {
	watch(page);
	await install(page);
});

// Teardown has its own budget, so this reaches the server even when the case
// timed out, and the browse database is every browse-* file's. Each
// failure is soft, so the body's own error stays the one reported.
test.afterEach(async ({ page }, testInfo) => {
	await Promise.race([
		Promise.allSettled([...writes].map((r) => r.response())),
		new Promise((r) => setTimeout(r, 10_000))
	]);
	await page.unrouteAll({ behavior: 'ignoreErrors' });
	const origin = new URL(testInfo.project.use.baseURL!).origin;
	const post = (path: string, form: Record<string, string>) =>
		// Without `accept: text/html` SvelteKit answers an action 200, not its 303.
		page.request.post(`${origin}${path}`, {
			form,
			headers: { origin, accept: 'text/html' },
			maxRedirects: 0
		});
	const removed = await post('/browse/extensions?/remove', { pkg: PLUGIN });
	expect.soft(removed.status(), 'Good Novels removed').toBe(303);
	expect.soft((await page.request.get(`${origin}${SOURCE}/settings`)).status()).toBe(404);

	// Asked once the plugin is gone: only then does a repository's row carry its
	// id in a form, not a REMOVE… sheet. NOVEL_REPO is the world's one LNReader
	// repository.
	const repos = async () =>
		(await (await page.request.get(`${origin}/browse/extensions?tab=repos`)).text()).matchAll(
			/name="id"\s+value="(\d+)"[^>]*>\s*<input[^>]*name="kind"\s+value="novels"/g
		);
	for (const [, id] of await repos()) {
		const gone = await post('/browse/extensions?/removeRepo', { id, kind: 'novels' });
		expect.soft(gone.status(), `repository ${id} removed`).toBe(303);
	}
	expect.soft([...(await repos())], 'no LNReader repository left').toEqual([]);
});

test('a plain TRY AGAIN asks the server, and the band is drawn from the new answer', async ({
	page
}) => {
	await plainBand(page);
	await tapAndReload(page, () => again(page).click());
	expect(asked.map((a) => a.url)).toEqual([SOURCE]);
	await expectFreshAnswer(asked[0]);
	await expect(band(page)).toContainText('IS NOT ON THE INTERNET');
	expect(new URL(page.url()).search).toBe('');
});

test('a second tap asks again, one document each, with no parameter left behind', async ({
	page
}) => {
	await plainBand(page);
	await tapAndReload(page, () => again(page).click());
	await expect(band(page)).toContainText('IS NOT ON THE INTERNET');
	await expectFreshAnswer(asked[0]);
	asked = [];
	await tapAndReload(page, () => again(page).click());
	expect(asked.map((a) => a.url)).toEqual([SOURCE]);
	await expectFreshAnswer(asked[0]);
	await expect(band(page)).toContainText('IS NOT ON THE INTERNET');
	expect(new URL(page.url()).search).toBe('');
});

test.describe('a refused check', () => {
	// The route that puts the phrase in sees no document a service worker fetches
	// (doc/TESTING.md); the plain cases keep the worker, which is the real path.
	test.use({ serviceWorkers: 'block' });

	test('TRY AGAIN on a refused check still forgets, and lands on the page’s clean URL', async ({
		page
	}) => {
		await refusedBand(page);
		await tapAndReload(page, () => again(page).click());
		// `load` redirects only after `forgetSiteCheck` has answered.
		await expect.poll(() => asked.map((a) => a.url)).toEqual([`${SOURCE}?again=1`, SOURCE]);
		expect(asked.map((a) => a.how)).toEqual(['document', 'document']);
		expect((await asked[0].response)?.status()).toBe(303);
		await expect(page).toHaveURL(new RegExp(`${SOURCE}$`));
		// The route rewrote one answer only: this one is the server's own.
		await expect(band(page)).toContainText('IS NOT ON THE INTERNET');
		await expect(band(page)).not.toContainText('SOLVES THE CHECK AFRESH');
	});
});

test.describe('under a hovering pointer', () => {
	const { defaultBrowserType: _b, ...desktop } = devices['Desktop Chrome'];
	void _b;
	test.use({ ...desktop, viewport: { width: 1440, height: 900 } });

	/** The second rest is the one a page hears as a `mousemove` for certain. */
	const restOn = async (page: Page, link: Locator) => {
		await link.hover();
		await page.mouse.move(0, 0);
		await link.hover();
		// Nothing may be asked until a tap. A wait is the assertion here.
		await page.waitForTimeout(1500);
	};

	test('resting on a plain TRY AGAIN asks nothing, and one tap asks once', async ({ page }) => {
		await plainBand(page);
		await restOn(page, again(page));
		expect(asked).toEqual([]);
		await tapAndReload(page, () => again(page).click());
		expect(asked.map((a) => a.url)).toEqual([SOURCE]);
	});

	test.describe('on a refused check', () => {
		test.use({ serviceWorkers: 'block' });

		test('resting on its TRY AGAIN forgets nothing', async ({ page }) => {
			await refusedBand(page);
			await restOn(page, again(page));
			expect(asked).toEqual([]);
		});
	});
});

test.describe('with no script', () => {
	test.use({ javaScriptEnabled: false });

	test('a plain TRY AGAIN loads the page again', async ({ page }) => {
		await plainBand(page);
		await again(page).click();
		await expect.poll(() => asked.length, { message: 'the server was asked' }).toBe(1);
		await expectFreshAnswer(asked[0]);
		await expect(band(page)).toContainText('IS NOT ON THE INTERNET');
		expect(new URL(page.url()).search).toBe('');
	});
});
