import { test, expect, hydrated } from './fixtures';
import { bumpWebtoons, NOVEL_REPO, REPO, resetEngine } from './browse-world';

/**
 * EXTENSIONS (Index-Extensions; doc/BROWSE.md, "Extensions and
 * repositories"; card c144), end to end, against tests/browse-setup.ts's
 * fake engine and its repositories over https. The APKs are real and really
 * signed (tests/fixtures/apk), so a signature that doesn't hold is caught as
 * it would be. One test, in order: each step stands on the last.
 */

/**
 * This page's writes still waiting for their answer (every request but a
 * GET), so the afterEach can wait for them before it puts anything back:
 * a HIDDEN SOURCE or an INSTALL a timed-out case left on the server would
 * otherwise land after the put-back and undo it (c569).
 */
let writes = new Set<import('@playwright/test').Request>();

/** Webtoons.com, the extension the first case installs and updates: a failed copy can leave it. */
const WEBTOONS = 'eu.kanade.tachiyomi.extension.all.webtoons';

test.beforeEach(async ({ page, baseURL }) => {
	await resetEngine();
	// A copy that failed before its own REMOVE still has Webtoons.com installed,
	// and the copy after it would find 1.6.3 already here instead of installing
	// 1.6.2 (c607 (b), c636). REMOVE is idempotent and keeps a source's switches,
	// which this case never turns on.
	const origin = new URL(baseURL!).origin;
	await page.request.post(`${origin}/browse/extensions?/remove`, {
		form: { pkg: WEBTOONS },
		headers: { origin },
		maxRedirects: 0
	});
	writes = new Set();
	const own = writes;
	page.on('request', (r) => {
		if (r.method() !== 'GET') own.add(r);
	});
	page.on('requestfinished', (r) => own.delete(r));
	page.on('requestfailed', (r) => own.delete(r));
});

const revealCookie = (origin: string) => ({
	name: 'tsundoku_reveal',
	value: '1',
	url: origin,
	httpOnly: true
});

/** Set by an LNReader case once it is about to INSTALL; the afterEach puts back what it left. */
let lnPluginInstalled = false;

const SWITCHES = ['hidden', 'addedHidden', 'offHistory'] as const;

// Teardown has its own budget, so this runs and reaches the server even when
// the case timed out (c507; a finally in the body does not: its requests throw
// "Test timeout exceeded" before they are sent). A failed put-back is soft,
// so the body's own error stays the one reported.
//
// REMOVE keeps a source's switches (c569, the owner's (b)), so a switch left
// on outlives the plugin and the next INSTALL comes back with it: every
// switch goes off **before** REMOVE, read back from the server, and a switch
// can only be reached while the plugin is installed. And it waits first for
// the page's own writes to be answered (`writes`): a HIDDEN SOURCE or an
// INSTALL still on the server when the case timed out would otherwise land
// after the put-back (c569's test side).
test.afterEach(async ({ page }, testInfo) => {
	if (!lnPluginInstalled) return;
	lnPluginInstalled = false;
	const origin = new URL(testInfo.project.use.baseURL!).origin;
	const settings = `${origin}/browse/ln:goodnovels/settings`;
	// Each pending write's own answer, or 10 s for one that never comes.
	await Promise.race([
		Promise.allSettled([...writes].map((r) => r.response())),
		new Promise((r) => setTimeout(r, 10_000))
	]);
	// Reveal on, so the hidden source's settings page is found at all.
	await page.context().addCookies([revealCookie(origin)]);
	const post = (path: string, form: Record<string, string>) =>
		page.request.post(`${origin}${path}`, { form, headers: { origin }, maxRedirects: 0 });
	// Only tsundoku's own three switches (`form.own`), not a plugin preference
	// the page also draws; NaN when the page does not draw exactly those three.
	const switchesOn = async () => {
		const r = await page.request.get(settings);
		if (!r.ok()) return -1;
		const own = (await r.text()).match(/<form[^>]*\bclass="own[\s"][\s\S]*?<\/form>/g) ?? [];
		if (own.length !== SWITCHES.length) return NaN;
		return own.filter((f) => /aria-checked="true"/.test(f)).length;
	};
	// Removed already with a switch maybe on: installed again, so the
	// switches can be reached (the settings page answers 404 without it).
	if ((await switchesOn()) === -1)
		await post('/browse/extensions?/install', { pkg: 'ln:goodnovels' });
	let on = -1;
	for (let i = 0; i < 3 && on !== 0; i++) {
		for (const flag of SWITCHES)
			await post('/browse/ln:goodnovels/settings?/flag', { flag, value: 'false' });
		on = await switchesOn();
	}
	// Past the longest hold the world allows (`test-hold.server.ts`'s
	// HOLD_MAX_MS, 5 s): a write that outlived the put-back lands inside this
	// wait, and the switches read back on. The c636 case's evidence is here, in
	// the teardown that holds it, not in the case that runs next (review 2).
	await new Promise((r) => setTimeout(r, 5_200));
	const late = await switchesOn();
	const removed = await post('/browse/extensions?/remove', { pkg: 'ln:goodnovels' });
	await page.context().clearCookies({ name: 'tsundoku_reveal' });
	expect.soft(on, 'Good Novels’ switches read back off before REMOVE').toBe(0);
	expect.soft(late, 'nothing landed after the put-back').toBe(0);
	expect
		.soft(removed.status() === 303 || removed.ok(), `Good Novels removed: ${removed.status()}`)
		.toBe(true);
	expect.soft((await page.request.get(settings)).status(), 'Good Novels gone').toBe(404);
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

// A page of the context's own, not the fixture's: that one's goto waits for
// hydration, which is exactly what this case must beat (library-top-bar's
// FILTER case, c105).
test('AVAILABLE’s FILTER tapped before the page hydrates stays open (c473)', async ({
	context
}) => {
	const page = await context.newPage();
	// Hold the app's scripts back, so the server's markup is all there is.
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	await page.route('**/_app/immutable/**/*.js', async (route) => {
		await held;
		await route.continue();
	});
	await page.goto('/browse/extensions?tab=available', { waitUntil: 'commit' });
	const cell = page.locator('summary', { hasText: 'FILTER' });
	await cell.click();
	const panel = page.getByRole('group', { name: 'Filters' });
	await expect(panel).toBeVisible();
	expect(await page.evaluate(() => document.cookie.includes('tsundoku_js=1'))).toBe(false);

	release();
	await page.waitForFunction(() => document.cookie.includes('tsundoku_js=1'));
	await hydrated(page);
	// Hydrated, the panel is still open, and the page knows it is (the caret).
	await expect(panel).toBeVisible();
	await expect(cell).toContainText('▴');
	// And it still closes the way it always did, by DONE and by the scrim.
	await panel.getByRole('button', { name: 'DONE' }).click();
	await expect(panel).toBeHidden();
	await expect(cell).toContainText('▾');
	await cell.click();
	await expect(panel).toBeVisible();
	await expect(cell).toContainText('▴');
	// The scrim covers the page; its bottom edge is below the panel (70dvh at most).
	const { height } = page.viewportSize()!;
	await page
		.getByRole('button', { name: 'Close filters' })
		.click({ position: { x: 10, y: height - 10 } });
	await expect(panel).toBeHidden();
	await expect(cell).toContainText('▾');
	await page.close();
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

test('a switch still being written when the case ends is put back after it (c636)', async ({
	page
}) => {
	const row = (name: string) => page.locator('.rows .row', { hasText: name });
	const own = (title: string) => page.locator('form.own', { hasText: title }).getByRole('switch');
	// The plugin, so the afterEach's put-back has switches to reach at all
	// (it returns early for a case that never installed one).
	await page.goto(`/browse/extensions?tab=repos&add=${encodeURIComponent(NOVEL_REPO)}`);
	await expect(page.locator('.found')).toContainText('1 NOVEL PLUGIN');
	if (await page.locator('.found button').count()) await page.locator('.found button').click();
	await expect(row('127.0.0.1').filter({ hasText: 'NOVELS' })).toContainText('1 PLUGIN');
	lnPluginInstalled = true;
	await page.goto('/browse/extensions?tab=available&kind=novels');
	await row('Good Novels').getByRole('button', { name: 'INSTALL' }).click();
	await expect(row('Good Novels')).toContainText('INSTALLED ✓');
	await page.goto('/browse/ln:goodnovels/settings');
	await expect(own('Off history')).toHaveAttribute('aria-checked', 'false');

	// HIDDEN SOURCE, sent as the page's own write and left in flight when this
	// case ends: the browse world holds the action's write on the server
	// (tests/browse-setup.ts's TSUNDOKU_TEST_HOLD, `x-tsundoku-hold`). The
	// afterEach must wait for it before its put-back, or the write lands after
	// the switches were turned off and leaves HIDDEN SOURCE on for the next
	// case -- whose last assertion says it is off (c569, below).
	await page.evaluate(() => {
		void fetch('/browse/ln:goodnovels/settings?/flag', {
			method: 'POST',
			headers: { 'x-tsundoku-hold': 'flag:3000' },
			body: new URLSearchParams({ flag: 'hidden', value: 'true' })
		});
	});
	// Nothing read here: the write is the next thing to happen, and it is the
	// afterEach's job to wait for it (`writes`), not this case's.
});

test('REMOVE keeps a source’s switches: a reinstalled plugin comes back with them (c569, the owner’s (b))', async ({
	page
}) => {
	const row = (name: string) => page.locator('.rows .row', { hasText: name });
	const own = (title: string) => page.locator('form.own', { hasText: title }).getByRole('switch');
	// The novel repository, as the LNReader case adds it (kept if it is there).
	await page.goto(`/browse/extensions?tab=repos&add=${encodeURIComponent(NOVEL_REPO)}`);
	await expect(page.locator('.found')).toContainText('1 NOVEL PLUGIN');
	if (await page.locator('.found button').count()) {
		await page.locator('.found button').click();
		await expect(row('127.0.0.1').filter({ hasText: 'NOVELS' })).toContainText('1 PLUGIN');
	}
	lnPluginInstalled = true;
	const install = async () => {
		await page.goto('/browse/extensions?tab=available&kind=novels');
		await row('Good Novels').getByRole('button', { name: 'INSTALL' }).click();
		await expect(row('Good Novels')).toContainText('INSTALLED ✓');
	};
	await install();

	// Two switches on, each read back from the server's own answer.
	await page.goto('/browse/ln:goodnovels/settings');
	for (const t of ['Added hidden', 'Off history']) {
		await expect(own(t)).toHaveAttribute('aria-checked', 'false');
		await own(t).click();
		await expect(own(t)).toHaveAttribute('aria-checked', 'true');
	}
	await page.reload();
	await expect(own('Added hidden')).toHaveAttribute('aria-checked', 'true');

	// REMOVE, as EXTENSIONS does it: the sheet says the settings stay.
	await page.goto('/browse/extensions');
	await row('Good Novels').getByRole('link', { name: 'REMOVE…' }).click();
	const sheet = page.getByRole('dialog');
	await expect(sheet).toContainText('ITS SETTINGS ARE KEPT');
	await sheet.getByRole('button', { name: 'REMOVE GOOD NOVELS' }).click();
	await expect(row('Good Novels')).toHaveCount(0);

	// Installed again: the owner's switches are as they were left.
	await install();
	await page.goto('/browse/ln:goodnovels/settings');
	await expect(own('Added hidden')).toHaveAttribute('aria-checked', 'true');
	await expect(own('Off history')).toHaveAttribute('aria-checked', 'true');
	await expect(own('Hidden source')).toHaveAttribute('aria-checked', 'false');
	// The afterEach turns them off, reads them back, and removes it again.
});
