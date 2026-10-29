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

	// Available: the adult one isn't there with reveal off, nor counted.
	await page.goto('/browse/extensions?tab=available');
	await expect(row('Webtoons.com')).toBeVisible();
	await expect(page.locator('body')).not.toContainText('Adult Place');
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
	const row = page.locator('section', { hasText: '03 — BROWSE' });
	await expect(row.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
	await expect(row.getByRole('button', { name: 'JA' })).toHaveAttribute('aria-pressed', 'true');
	await row.getByRole('button', { name: 'JA' }).click();
	await expect(row.getByRole('button', { name: 'JA' })).toHaveAttribute('aria-pressed', 'false');
	await expect(row.locator('.section span')).toHaveText('EN');
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

	await page.goto('/browse/extensions?tab=available&kind=novels');
	await row('Good Novels').getByRole('button', { name: 'INSTALL' }).click();
	await expect(row('Good Novels')).toContainText('INSTALLED ✓');

	// It loaded in the plugin host: its own name and version, not just the index's.
	await page.goto('/browse/extensions');
	await expect(row('Good Novels')).toContainText('NOVELS · EN');
	await expect(row('Good Novels')).toContainText('1.0.0');
	await expect(row('Good Novels')).not.toContainText('FAILED');

	// BROWSE lists it under NOVELS, and its page is a novel source's: no SETTINGS.
	await page.goto('/browse');
	const novels = page.locator('.label', { hasText: 'NOVELS' });
	await expect(novels).toBeVisible();
	await page
		.getByRole('link', { name: /Good Novels/ })
		.first()
		.click();
	await expect(page).toHaveURL(/\/browse\/ln:goodnovels$/);
	await expect(page.locator('.title .sub')).toHaveText('NOVEL · EN');
	await expect(page.getByRole('link', { name: 'SETTINGS' })).toHaveCount(0);
	await expect(page.getByRole('searchbox', { name: 'Search Good Novels' })).toHaveAttribute(
		'placeholder',
		'/ search Good Novels'
	);
	// Its site is this test's loopback server, which the host never fetches
	// (doc/NOVELS.md, "The plugin host"): the source says so, and nothing else breaks.
	await expect(page.locator('.band')).toContainText('GOOD NOVELS DID NOT ANSWER');
	await expect(page.locator('.band')).toContainText('IS NOT ON THE INTERNET');
	await expect(page.locator('.band')).toContainText('TRY AGAIN');
	expect((await page.request.get('/browse/ln:goodnovels/settings')).status()).toBe(404);

	await page.goto('/browse/extensions');
	await row('Good Novels').getByRole('link', { name: 'REMOVE…' }).click();
	const sheet = page.getByRole('dialog');
	await expect(sheet).toContainText('REMOVE GOOD NOVELS?');
	await sheet.getByRole('button', { name: 'REMOVE GOOD NOVELS' }).click();
	await expect(row('Good Novels')).toHaveCount(0);
});
