/**
 * The web edition in a real browser (doc/WEB-EDITION.md, "Testing"): the
 * built `build-web/` served as static files, with the app's server running
 * in the tab and the library in the browser's own storage. Each test is a
 * fresh browser context, so a fresh service worker and an empty OPFS: every
 * test is a first visit. Run in Chromium and Firefox (playwright.web.config.ts).
 *
 * Shelf names are invented; nothing here is a real library.
 */
import { expect, test, type Page } from '@playwright/test';

/**
 * Opens the app: web/boot.js has handed over to it, and it has hydrated
 * (SvelteKit's route announcer, drawn once every component has mounted, the
 * main suite's `hydrated()`). `ready` alone is only the start: the app then
 * still loads its first screen's data through the relay.
 */
async function open(page: Page, path = '/') {
	await page.goto(path);
	await started(page);
}

async function started(page: Page) {
	await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'ready', { timeout: 30_000 });
	await expect(page.locator('#svelte-announcer')).toBeAttached({ timeout: 30_000 });
}

/** The desktop sidebar's + NEW SHELF, a real form (now `use:enhance`). */
async function newShelf(page: Page, name: string) {
	await page.getByRole('link', { name: '+ NEW SHELF' }).click();
	const field = page.getByRole('textbox', { name: 'New shelf name' });
	await field.fill(name);
	await field.press('Enter');
	await expect(page).toHaveURL(/[?&]shelf=/);
}

const shelfTab = (page: Page, name: string) =>
	page.getByRole('link', { name: new RegExp(name, 'i') }).first();

test('opens on an empty library, its server and database in the tab', async ({ page }) => {
	await open(page);
	// The app's own service worker controls the tab: it is the relay now.
	expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '')).toMatch(
		/\/service-worker\.js$/
	);
	// Read from tsundoku's own loaders, on a database that climbed every
	// migration in this browser a moment ago.
	await expect(page.getByText('GET STARTED').first()).toBeVisible();
	await expect(page.getByRole('link', { name: '+ NEW SHELF' })).toBeVisible();
});

test('writes through a form and keeps it across a reload', async ({ page }) => {
	await open(page);
	await newShelf(page, 'Invented Shelf');
	await expect(shelfTab(page, 'Invented Shelf')).toBeVisible();

	await page.reload();
	await started(page);
	await expect(shelfTab(page, 'Invented Shelf')).toBeVisible();
});

test('a second tab uses the first one’s server, and takes over when it closes', async ({
	context
}) => {
	const first = await context.newPage();
	await open(first);
	await newShelf(first, 'From The First Tab');

	// The second tab does not lead: it shows the same library, served by the first.
	const second = await context.newPage();
	await open(second);
	await expect(shelfTab(second, 'From The First Tab')).toBeVisible();

	// The leader closes; the second tab takes the lock, starts its own server
	// on the same database, and writes.
	await first.close();
	await open(second);
	await expect(shelfTab(second, 'From The First Tab')).toBeVisible({ timeout: 30_000 });
	await newShelf(second, 'After The Takeover');
	await second.reload();
	await started(second);
	await expect(shelfTab(second, 'After The Takeover')).toBeVisible();
	await expect(shelfTab(second, 'From The First Tab')).toBeVisible();
});

test('static files stay static: the server answers only the app’s own requests', async ({
	page
}) => {
	await open(page);
	// A file of static/ that is never kept for offline use goes to the
	// network, not to the in-tab server (which serves no files).
	const manifest = await page.evaluate(async () => {
		const r = await fetch('/manifest.webmanifest');
		return { status: r.status, type: r.headers.get('content-type') };
	});
	expect(manifest).toEqual({ status: 200, type: 'application/manifest+json' });
	// An endpoint is the server's, and answers as the self-hosted one would.
	const api = await page.evaluate(async () => (await fetch('/api/does-not-exist')).status);
	expect(api).toBe(404);
});

test('with no engine in the build, the tab says so and the library works without it', async ({
	page
}) => {
	test.skip(
		!!process.env.TSUNDOKU_ENGINE_JAR,
		'this build has an engine (web/tests/install.e2e.ts)'
	);
	await open(page);
	// test:web builds without TSUNDOKU_ENGINE_JAR (doc/WEB-EDITION.md, "The engine").
	await expect(page.locator('html')).toHaveAttribute('data-web-engine', 'off');
	await expect(page.getByRole('link', { name: '+ NEW SHELF' })).toBeVisible();
	// And the jar's address is not answered with the app's page, nor kept as a jar.
	const jar = await page.evaluate(async () => {
		const r = await fetch('/engine/engine-browser.jar', { headers: { range: 'bytes=0-0' } });
		return r.status;
	});
	expect(jar).toBe(404);
});
