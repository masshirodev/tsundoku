import { test, expect } from './fixtures';
import { bumpWebtoons, NOVEL_REPO, REPO, resetEngine } from './browse-world';

/**
 * EXTENSIONS (Index-Extensions; doc/BROWSE.md, "Extensions and
 * repositories"; card c144), end to end, against tests/browse-setup.ts's
 * fake engine and its repositories over https. The APKs are real and really
 * signed (tests/fixtures/apk), so a signature that doesn't hold is caught as
 * it would be. One test, in order: each step stands on the last.
 */

test.beforeEach(async () => {
	await resetEngine();
});

const revealCookie = (origin: string) => ({
	name: 'tsundoku_reveal',
	value: '1',
	url: origin,
	httpOnly: true
});

/** Set by the LNReader case once it is about to INSTALL; the afterEach puts back what it left. */
let lnPluginInstalled = false;

// Teardown has its own budget, so this runs and reaches the server even when
// the case timed out (c507; a finally in the body does not: its requests throw
// "Test timeout exceeded" before they are sent). Both requests are harmless
// when there is nothing to undo: off deletes the switch's row, and REMOVE of a
// plugin that isn't there does nothing. A failed put-back is soft, so the
// body's own error stays the one reported.
test.afterEach(async ({ page }, testInfo) => {
	if (!lnPluginInstalled) return;
	lnPluginInstalled = false;
	const origin = new URL(testInfo.project.use.baseURL!).origin;
	// Reveal on, so the hidden source's settings page is found at all.
	await page.context().addCookies([revealCookie(origin)]);
	const off = await page.request.post(`${origin}/browse/ln:goodnovels/settings?/flag`, {
		form: { flag: 'hidden', value: 'false' },
		headers: { origin }
	});
	const removed = await page.request.post(`${origin}/browse/extensions?/remove`, {
		form: { pkg: 'ln:goodnovels' },
		headers: { origin }
	});
	await page.context().clearCookies({ name: 'tsundoku_reveal' });
	// 404 once REMOVE has run: no such source, and so no switch to put back.
	expect
		.soft(off.ok() || off.status() === 404, `HIDDEN SOURCE put back off: ${off.status()}`)
		.toBe(true);
	expect.soft(removed.ok(), `Good Novels removed: ${removed.status()}`).toBe(true);
});

test('a repository is added, an extension installed, updated, taken back and removed', async ({
	page
}) => {
	const row = (name: string) => page.locator('.rows .row', { hasText: name });

	// Not a repository: it says so, and nothing is added.
	await page.goto('/browse/extensions?tab=repos');
	await page.getByRole('textbox', { name: /repository’s address/ }).fill(REPO('notrepo'));
	await page.getByRole('button', { name: 'ASK' }).click();
	await expect(page.locator('.found')).toContainText('NOT A REPOSITORY');
	await expect(page.locator('.found button')).toHaveCount(0);

	// A repository: what it holds, before anything is added.
	await page.goto(`/browse/extensions?tab=repos&add=${encodeURIComponent(REPO('good'))}`);
	await expect(page.locator('.found')).toContainText('FOUND · Fake Repo · 2 MANGA EXTENSIONS');
	await page.getByRole('button', { name: 'ADD Fake Repo' }).click();
	await expect(row('Fake Repo')).toContainText('2 EXTENSIONS');

	// Available: the 18+ one is listed for everyone, marked (doc/BROWSE.md, "Filters";
	// the owner, 2026-10-31: Keiyoushi flags Weeb Central, which a friend couldn't find).
	await page.goto('/browse/extensions?tab=available');
	await expect(row('Webtoons.com')).toBeVisible();
	await expect(row('Adult Place')).toContainText('18+');
	// The search ignores case and spacing.
	await page
		.getByRole('searchbox', { name: 'Search the available extensions' })
		.fill('WEBTOONSCOM');
	await page.keyboard.press('Enter');
	await expect(page.locator('.label.first')).toContainText('01 — 1 FOUND');
	await expect(row('Webtoons.com')).toBeVisible();
	// FILTER: 18+ ONLY, then CLEAR ALL; ALL is gone.
	await page.goto('/browse/extensions?tab=available');
	await expect(page.getByRole('link', { name: 'ALL', exact: true })).toHaveCount(0);
	await page.locator('summary', { hasText: 'FILTER' }).click();
	const panel = page.getByRole('group', { name: 'Filters' });
	await expect(panel).toContainText('FILTER MANGA EXTENSIONS');
	await panel.locator('.row', { hasText: '18+' }).getByRole('link', { name: 'ONLY' }).click();
	await expect(page).toHaveURL(/adult=only/);
	await expect(page.locator('.label.first')).toContainText('01 — 1 FOUND');
	await expect(row('Adult Place')).toBeVisible();
	await page.getByRole('link', { name: '✕ CLEAR ALL' }).click();
	await expect(page).not.toHaveURL(/adult=/);
	// Choosing keeps the panel open to choose more, as the library's does; DONE closes it.
	await panel.getByRole('button', { name: 'DONE' }).click();
	await expect(panel).toBeHidden();
	await row('Webtoons.com').getByRole('button', { name: 'INSTALL' }).click();
	await expect(row('Webtoons.com')).toContainText('INSTALLED ✓');

	// Installed, up to date; then the repository lists a newer version.
	await page.goto('/browse/extensions');
	await expect(row('Webtoons.com')).toContainText('1.6.2');
	await bumpWebtoons();
	await page.getByRole('button', { name: 'CHECK NOW' }).click();
	await expect(page.locator('.label', { hasText: 'UPDATES' })).toContainText('UPDATE ALL 1');
	await expect(row('Webtoons.com')).toContainText('1.6.2 → 1.6.3');
	await row('Webtoons.com').getByRole('button', { name: 'UPDATE' }).click();
	// Updated, and the old version kept a week: BACK TO.
	await expect(row('Webtoons.com').getByRole('button', { name: 'BACK TO 1.6.2' })).toBeVisible();
	await expect(row('Webtoons.com')).toContainText('1.6.3');
	await row('Webtoons.com').getByRole('button', { name: 'BACK TO 1.6.2' }).click();
	await expect(row('Webtoons.com')).toContainText('1.6.2');

	// REMOVE says what stays and what stops, then removes.
	await row('Webtoons.com').getByRole('link', { name: 'REMOVE…' }).click();
	const sheet = page.getByRole('dialog');
	await expect(sheet).toContainText('REMOVE WEBTOONS.COM?');
	await expect(sheet).toContainText('ITS SETTINGS ARE KEPT');
	await sheet.getByRole('button', { name: 'REMOVE WEBTOONS.COM' }).click();
	await expect(page).toHaveURL(/\/browse\/extensions$/);
	await expect(row('Webtoons.com')).toHaveCount(0);
});

test('an extension not signed by its repository’s key is never installed, and both keys are shown', async ({
	page
}) => {
	await page.goto(`/browse/extensions?tab=repos&add=${encodeURIComponent(REPO('bad'))}`);
	await page.getByRole('button', { name: 'ADD Bad Repo' }).click();
	// Added before going on: a navigation started first would abandon the post.
	await expect(page.locator('.rows .row', { hasText: 'Bad Repo' })).toBeVisible();
	await page.goto('/browse/extensions?tab=available');
	const night = page.locator('.rows .row', { hasText: 'Night Scans' });
	await night.getByRole('button', { name: 'INSTALL' }).click();
	const alert = page.getByRole('alert');
	await expect(alert).toContainText('UNTRUSTED · NOTHING WAS INSTALLED');
	// The fixture's real signer, beside the key the repository lists.
	await expect(alert).toContainText(
		'9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2'
	);
	await expect(alert).toContainText('f'.repeat(64));
	await expect(night).toContainText('NOT INSTALLED');
	await page.goto('/browse/extensions');
	await expect(page.locator('.rows .row', { hasText: 'Night Scans' })).toHaveCount(0);
});

test('BROWSE’s languages are set once in SETTINGS, and one always stays', async ({ page }) => {
	await page.goto('/settings');
	const row = page.locator('section', { hasText: '07 — BROWSE' });
	await expect(row.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
	await expect(row.getByRole('button', { name: 'JA' })).toHaveAttribute('aria-pressed', 'true');
	await row.getByRole('button', { name: 'JA' }).click();
	await expect(row.getByRole('button', { name: 'JA' })).toHaveAttribute('aria-pressed', 'false');
	await expect(row.locator('.sec-right span')).toHaveText('EN');
	// The last one can't go: BROWSE would list nothing.
	await row.getByRole('button', { name: 'EN' }).click();
	await expect(row.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
	await row.getByRole('button', { name: 'JA' }).click();
	await expect(row.getByRole('button', { name: 'JA' })).toHaveAttribute('aria-pressed', 'true');
});

test('an LNReader repository is asked, added, a novel plugin installed in the host, browsed and removed (c148, c149)', async ({
	page
}) => {
	const row = (name: string) => page.locator('.rows .row', { hasText: name });
	await page.goto(`/browse/extensions?tab=repos&add=${encodeURIComponent(NOVEL_REPO)}`);
	await expect(page.locator('.found')).toContainText('1 NOVEL PLUGIN');
	await expect(page.locator('.found')).toContainText('PINNED BY ITS HASH');
	await page.locator('.found button').click();
	await expect(row('127.0.0.1').filter({ hasText: 'NOVELS' })).toContainText('1 PLUGIN');

	// The plugin, and its HIDDEN SOURCE switch below, live in the browse
	// world's one database, which every browse-* file shares, and the case puts
	// both back only at its end. A red before then left Good Novels installed
	// and hidden: this case's REMOVE, a rerun's INSTALL and every later reader
	// of BROWSE's sources went red behind it, one red becoming several (c507).
	// So the afterEach below puts both back whatever happened, timeouts
	// included: a finally in the body shares the test's budget, and after a
	// timeout its requests throw before they are sent (review, wave 23).
	lnPluginInstalled = true;
	const origin = new URL(test.info().project.use.baseURL!).origin;
	const reveal = () => page.context().addCookies([revealCookie(origin)]);
	await page.goto('/browse/extensions?tab=available&kind=novels');
	await row('Good Novels').getByRole('button', { name: 'INSTALL' }).click();
	await expect(row('Good Novels')).toContainText('INSTALLED ✓');

	// It loaded in the plugin host: its own name and version, not just the index's.
	await page.goto('/browse/extensions');
	await expect(row('Good Novels')).toContainText('NOVELS · EN');
	await expect(row('Good Novels')).toContainText('1.0.0');
	await expect(row('Good Novels')).not.toContainText('FAILED');

	// BROWSE lists it under NOVELS, and its page is a novel source's. Its SETTINGS
	// holds only tsundoku's own switches (c435): the plugin keeps none of its own.
	await page.goto('/browse');
	const novels = page.locator('.label', { hasText: 'NOVELS' });
	await expect(novels).toBeVisible();
	await page
		.getByRole('link', { name: /Good Novels/ })
		.first()
		.click();
	await expect(page).toHaveURL(/\/browse\/ln:goodnovels$/);
	await expect(page.locator('.title .sub')).toHaveText('NOVEL · EN');
	await expect(page.getByRole('link', { name: 'SETTINGS', exact: true })).toHaveAttribute(
		'href',
		'/browse/ln:goodnovels/settings'
	);
	await expect(page.getByRole('searchbox', { name: 'Search Good Novels' })).toHaveAttribute(
		'placeholder',
		'/ search Good Novels'
	);
	// Its site is this test's loopback server, which the host never fetches
	// (doc/NOVELS.md, "The plugin host"): the source says so, and nothing else breaks.
	await expect(page.locator('.band')).toContainText('GOOD NOVELS DID NOT ANSWER');
	await expect(page.locator('.band')).toContainText('IS NOT ON THE INTERNET');
	await expect(page.locator('.band')).toContainText('TRY AGAIN');
	// Not a site's check, so TRY AGAIN has nothing to forget and doesn't say it
	// will (c294); `again` itself is never kept in the URL.
	await expect(page.locator('.band')).not.toContainText('SOLVES THE CHECK AFRESH');
	await expect(page.locator('.band a.again')).not.toHaveAttribute('href', /again=/);
	await page.goto('/browse/ln:goodnovels?again=1');
	await expect(page).toHaveURL(/\/browse\/ln:goodnovels$/);
	await expect(page.locator('.band')).toContainText('GOOD NOVELS DID NOT ANSWER');
	await page.goto('/browse/ln:goodnovels/settings');
	await expect(page.locator('form.own .t')).toHaveText([
		'Hidden source',
		'Added hidden',
		'Off history'
	]);
	await expect(page.locator('form.set')).toHaveCount(0);
	await expect(page.getByText(/only tsundoku's switches above/)).toBeVisible();

	// HIDDEN SOURCE hides the plugin in EXTENSIONS too (c435, round 2): neither
	// INSTALLED nor AVAILABLE's NOVELS names it outside reveal; inside reveal both do.
	const hiddenSource = page.locator('form.own', { hasText: 'Hidden source' }).getByRole('switch');
	await page.waitForLoadState('networkidle');
	await hiddenSource.click();
	await expect(page).toHaveURL(/\/browse$/);
	for (const path of ['/browse/extensions', '/browse/extensions?tab=available&kind=novels']) {
		await page.goto(path);
		await expect(page.locator('body'), path).not.toContainText(/good novels/i);
	}
	await reveal();
	for (const path of ['/browse/extensions', '/browse/extensions?tab=available&kind=novels']) {
		await page.goto(path);
		await expect(row('Good Novels'), path).toBeVisible();
	}
	await page.goto('/browse/ln:goodnovels/settings');
	await page.waitForLoadState('networkidle');
	await expect(hiddenSource).toHaveAttribute('aria-checked', 'true');
	await hiddenSource.click();
	await expect(hiddenSource).toHaveAttribute('aria-checked', 'false');
	await page.context().clearCookies({ name: 'tsundoku_reveal' });

	await page.goto('/browse/extensions');
	await row('Good Novels').getByRole('link', { name: 'REMOVE…' }).click();
	const sheet = page.getByRole('dialog');
	await expect(sheet).toContainText('REMOVE GOOD NOVELS?');
	await sheet.getByRole('button', { name: 'REMOVE GOOD NOVELS' }).click();
	await expect(row('Good Novels')).toHaveCount(0);
});
