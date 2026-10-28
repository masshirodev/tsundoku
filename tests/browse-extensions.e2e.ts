import { test, expect } from './fixtures';
import { bumpWebtoons, REPO, resetEngine } from './browse-world';

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
