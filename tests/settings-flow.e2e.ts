import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * SETTINGS, one page (doc/SETTINGS.md; card c171, Settings.dc.html). The
 * e2e server is shared by parallel workers, so this sets only what no other
 * spec reads: WATCHING's defaults, DOWNLOADING, and this browser's own
 * values (each context has its own storage). MODE's per-kind defaults would
 * change how other specs' series open; settings-db.spec.ts covers them.
 */

const row = (page: Page, label: string) =>
	page.locator('.row', { has: page.locator('.label', { hasText: new RegExp(`^${label}$`) }) });
const section = (page: Page, name: string) => page.getByRole('region', { name: new RegExp(name) });

test('every section in the handoff’s order, each row saying where it’s kept', async ({ page }) => {
	await page.goto('/settings');
	await expect(page.locator('section .sec-head h2')).toHaveText([
		'01 — READING · MANGA AND MANHWA',
		'02 — READING · NOVELS',
		'03 — WATCHING',
		'04 — DOWNLOADING',
		'05 — LIBRARY',
		'06 — CATALOGUES',
		'08 — DEVICES'
	]);
	await expect(page.locator('.legend .lg-a')).toHaveText(['ALL DEVICES', 'THIS TABLET', 'DEFAULT']);
	await expect(row(page, 'FIT').locator('.scope .sa')).toHaveText('THIS TABLET');
	await expect(row(page, 'ZOOM').locator('.scope .sa')).toHaveText('THIS TABLET · PER SCREEN');
	await expect(row(page, 'MODE').locator('.scope .sa')).toHaveText('DEFAULT · EVERY DEVICE');
	await expect(row(page, 'EPISODES AT').locator('.scope .sa')).toHaveText('ALL DEVICES');
	await expect(row(page, 'SPEED').locator('.scope .sa')).toHaveText('EACH EPISODE');
	// What only the reader sets is shown with its value, and no control.
	await expect(row(page, 'DIM').first().locator('.info')).toHaveText('0%');
	await expect(row(page, 'DIM').first().locator('button')).toHaveCount(0);
});

test('a device value: the rule and RESET, kept in this browser, and RESET SECTION with UNDO', async ({
	page
}) => {
	await page.goto('/settings');
	const fit = row(page, 'FIT');
	await expect(fit).not.toHaveClass(/changed/);
	await fit.getByRole('button', { name: 'HEIGHT' }).click();
	await expect(fit.getByRole('button', { name: 'HEIGHT' })).toHaveAttribute('aria-pressed', 'true');
	await expect(fit).toHaveClass(/changed/);
	await expect(fit).toHaveCSS('box-shadow', /inset/);
	expect(await page.evaluate(() => localStorage.getItem('tsundoku.reader.fit'))).toBe('"height"');
	// The reader starts from it: it's the same key.
	await row(page, 'CROP BORDERS').getByRole('button', { name: 'ON' }).click();
	await row(page, 'ZOOM')
		.locator('.zoom', { hasText: 'PAGED · WIDER' })
		.getByLabel('Larger')
		.click();
	const images = section(page, '01 — READING');
	await expect(images.locator('.sec-right')).toContainText('3 CHANGED');
	await expect(page.locator('.index')).toHaveCount(0);

	await images.getByRole('button', { name: 'RESET SECTION' }).click();
	const band = images.locator('.secband');
	await expect(band).toContainText('SECTION RESET · 3 SETTINGS');
	await expect(band).toContainText(
		'FIT HEIGHT → SCREEN · ZOOM 125% → 100% · CROP BORDERS ON → OFF'
	);
	await expect(fit.getByRole('button', { name: 'SCREEN' })).toHaveAttribute('aria-pressed', 'true');
	expect(await page.evaluate(() => localStorage.getItem('tsundoku.reader.fit'))).toBeNull();
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(fit.getByRole('button', { name: 'HEIGHT' })).toHaveAttribute('aria-pressed', 'true');
	await expect(images.locator('.secband')).toHaveCount(0);

	// A single row's RESET says what it goes back to, and its band is the row's.
	await row(page, 'ZOOM').getByRole('button', { name: 'RESET TO 100%' }).click();
	await expect(images.locator('.secband')).toContainText('ZOOM RESET');
	await row(page, 'FIT').getByRole('button', { name: 'RESET', exact: true }).click();
	await row(page, 'CROP BORDERS').getByRole('button', { name: 'RESET', exact: true }).click();
	await expect(images.locator('.sec-right')).not.toContainText('CHANGED');
});

test('WATCHING follows the player until a default is set, and says what that means', async ({
	page
}) => {
	await page.goto('/settings');
	const audio = row(page, 'AUDIO');
	await expect(audio.getByRole('button', { name: 'FOLLOW THE PLAYER' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(audio.locator('.meta')).toHaveText("NONE SET · THE SOURCE'S ORIGINAL PLAYS FIRST");
	await audio.getByRole('button', { name: 'JA', exact: true }).click();
	await expect(audio.locator('.meta')).toHaveText(
		'EVERY ANIME STARTS IN JAPANESE, UNLESS A SERIES DIFFERS'
	);
	await expect(audio).toHaveClass(/changed/);
	// Kept on the workstation: another visit sees it.
	await page.reload();
	await expect(row(page, 'AUDIO').getByRole('button', { name: 'JA', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await row(page, 'AUDIO').getByRole('button', { name: 'RESET · FOLLOW' }).click();
	await expect(row(page, 'AUDIO').locator('.meta')).toHaveText(
		"NONE SET · THE SOURCE'S ORIGINAL PLAYS FIRST"
	);
});

test('AUDIO KEPT (c160): the original always, a choice of the rest, and back to all', async ({
	page
}) => {
	await page.goto('/settings');
	const kept = row(page, 'AUDIO KEPT');
	await expect(kept.getByRole('button', { name: '✓ ORIGINAL · ALWAYS' })).toBeDisabled();
	await expect(kept.locator('.meta')).toContainText('EVERY TRACK THE SOURCE HAS');
	for (const l of ['ES', 'PT', 'FR', 'DE', 'IT', 'AR']) {
		await kept.getByRole('button', { name: `✓ ${l}` }).click();
		await expect(kept.getByRole('button', { name: l, exact: true })).toHaveAttribute(
			'aria-pressed',
			'false'
		);
	}
	await expect(kept.getByRole('button', { name: '✓ EN' })).toHaveAttribute('aria-pressed', 'true');
	await expect(kept.locator('.meta')).toHaveText(
		'A DOWNLOAD KEEPS THE ORIGINAL AND THESE · NEW DOWNLOADS ONLY'
	);
	// The last one off is the original alone, not every track again (reported 2026-10-29).
	await kept.getByRole('button', { name: '✓ EN' }).click();
	await expect(kept.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	await expect(kept.locator('.meta')).toHaveText(
		'A DOWNLOAD KEEPS THE ORIGINAL ALONE · NEW DOWNLOADS ONLY'
	);
	await page.reload();
	await expect(
		row(page, 'AUDIO KEPT').getByRole('button', { name: 'ES', exact: true })
	).toHaveAttribute('aria-pressed', 'false');
	await kept.getByRole('button', { name: 'RESET · ALL KEPT' }).click();
	await expect(kept.getByRole('button', { name: '✓ AR' })).toHaveAttribute('aria-pressed', 'true');
	// SUBTITLES KEPT starts on ALL (question 4).
	await expect(
		row(page, 'SUBTITLES KEPT').getByRole('button', { name: 'ALL', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
});

test('DEVICES lists this one once it has checked in, kept on the workstation', async ({ page }) => {
	await page.goto('/settings');
	const devices = section(page, '08 — DEVICES');
	await expect(devices.locator('.row.device .label').first()).toHaveText('THIS');
	await expect(devices.locator('.row.device').first()).toContainText('OPEN NOW');
	await expect(
		devices.locator('.row.device').first().getByRole('button', { name: 'SHOWING' })
	).toBeVisible();
	await expect(devices.locator('.row.device .scope').first()).toHaveText('KEPT ON THE WORKSTATION');
});

test('05 — LIBRARY: IMPORT A BACKUP, for a later import (c438, Import-Doors C)', async ({
	page
}) => {
	await page.goto('/settings');
	const r = row(page, 'IMPORT A BACKUP');
	// The shared seed has never imported a backup.
	await expect(r).toContainText('NO IMPORT YET');
	await expect(r).toContainText(
		'A SECOND BACKUP OF THE SAME APP ADDS AND UPDATES · NOTHING IS REMOVED'
	);
	await r.getByRole('link', { name: 'CHOOSE A FILE →' }).click();
	await expect(page).toHaveURL(/\/import$/);
});

test('/settings?section=watching lands on its section', async ({ page }) => {
	await page.goto('/settings?section=watching');
	await expect(section(page, '03 — WATCHING')).toBeInViewport();
});

test.describe('landscape (1B)', () => {
	test.use({ viewport: { width: 1280, height: 800 } });
	test('a 260px index of the sections, counting what changed', async ({ page }) => {
		await page.goto('/settings');
		const index = page.getByRole('navigation', { name: 'Sections' });
		await expect(index).toHaveCSS('width', '260px');
		await expect(index.locator('a').first()).toContainText('01 READING · IMAGES');
		await expect(page.locator('.legend')).toHaveCount(0);
	});
});

test.describe('the phone (3A)', () => {
	test.use({ viewport: { width: 360, height: 780 } });
	test('the scope drops under the control, segments shorten, RESET SECTION is RESET', async ({
		page
	}) => {
		await page.goto('/settings');
		await expect(page.locator('section .sec-head h2').first()).toHaveText('01 — READING · IMAGES');
		await expect(row(page, 'FIT').locator('.scope.inline')).toBeVisible();
		await expect(row(page, 'AUDIO').getByRole('button', { name: 'PLAYER' })).toBeVisible();
		await expect(row(page, 'FIT').locator('.label')).toHaveCSS('width', '84px');
	});
});

test('another device’s settings, shown and changed from here (2C)', async ({ page }) => {
	const desk = '7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f';
	await page.goto('/settings');
	const res = await page.request.post('/api/devices/sync', {
		data: {
			id: desk,
			kind: 'desktop',
			settings: { 'tsundoku.reader.fit': { v: 'height', at: Date.now() } }
		},
		headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Firefox/131.0' }
	});
	expect(res.ok()).toBe(true);
	await page.reload();
	const devices = section(page, '08 — DEVICES');
	const deskRow = devices.locator('.row.device', { hasText: 'Linux desktop · Firefox' });
	await expect(deskRow).toContainText('1 SETTING CHANGED');
	await deskRow.getByRole('button', { name: 'SHOW' }).click();
	await expect(page.locator('.bar .dev')).toHaveText('SHOWING: DESKTOP');
	await expect(page.locator('.topband')).toContainText("SHOWING THE DESKTOP'S SETTINGS");
	await expect(row(page, 'FIT').getByRole('button', { name: 'HEIGHT' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(row(page, 'FIT').locator('.scope .sa')).toHaveText('THE DESKTOP');
	// Changed here, kept for the desktop to take when it next opens; this tablet keeps its own.
	await row(page, 'SIDES').getByRole('button', { name: '20%' }).click();
	await expect(row(page, 'SIDES').getByRole('button', { name: '20%' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	expect(await page.evaluate(() => localStorage.getItem('tsundoku.reader.sides'))).toBeNull();
	const back = await page.request.post('/api/devices/sync', {
		data: { id: desk, kind: 'desktop', settings: {} }
	});
	expect((await back.json()).newer['tsundoku.reader.sides']).toMatchObject({ v: 20 });
	await page.getByRole('button', { name: 'BACK TO THIS TABLET' }).click();
	await expect(page.locator('.bar .dev')).toHaveText('THIS TABLET');
	await expect(row(page, 'SIDES').getByRole('button', { name: 'NONE' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('offline: what the workstation keeps dims and says so; this device’s rows still change (2D)', async ({
	page,
	context
}) => {
	await page.goto('/settings');
	// Hydrated and checked in, so the page is listening when the network goes.
	await expect(section(page, '08 — DEVICES').locator('.row.device .label').first()).toHaveText(
		'THIS'
	);
	await context.setOffline(true);
	try {
		await expect(page.locator('.topband')).toContainText('○ OFFLINE');
		await expect(row(page, 'EPISODES AT')).toHaveClass(/dim/);
		await expect(row(page, 'EPISODES AT').locator('.scope .sa')).toHaveText(
			'○ ALL DEVICES · NEEDS THE WORKSTATION'
		);
		await expect(row(page, 'AUDIO').locator('.scope .sa')).toHaveText(
			'○ DEFAULT · NEEDS THE WORKSTATION'
		);
		await expect(row(page, 'EPISODES AT').getByRole('button', { name: '720P' })).toBeDisabled();
		await row(page, 'SPREADS').getByRole('button', { name: 'ON' }).click();
		expect(await page.evaluate(() => localStorage.getItem('tsundoku.reader.spreads'))).toBe('true');
	} finally {
		await context.setOffline(false);
	}
});

test('/settings in search is offered as a result, and opens the page at a section', async ({
	page
}) => {
	await page.goto('/search');
	await page.getByRole('searchbox').fill('/settings watching');
	const cmd = page.locator('.page-cmd');
	await expect(cmd).toHaveText(/SETTINGS · WATCHING\s*ENTER →/);
	await page.getByRole('searchbox').press('Enter');
	await expect(page).toHaveURL(/\/settings\?section=watching/);
	await expect(section(page, '03 — WATCHING')).toBeInViewport();
});

test('MORE in the library’s bar: the sidebar’s foot as a sheet', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'MORE' }).click();
	const sheet = page.getByRole('dialog', { name: 'More' });
	// The seeded library has no repository, so GET STARTED isn't finished and leads (doc/ONBOARDING.md).
	await expect(sheet.locator('.row')).toHaveText([
		/GET STARTED\s*\d \/ 7 →/,
		/HISTORY →/,
		/DOWNLOADS →/,
		/SETTINGS →/,
		/HELP →\s*7 TOPICS/,
		// Live since c438: a link to the log, dated once a backup has come in.
		/IMPORT LOG →/
	]);
	await expect(sheet.getByRole('link', { name: /IMPORT LOG →/ })).toHaveAttribute(
		'href',
		'/import/log'
	);
	await sheet.getByRole('link', { name: /SETTINGS →/ }).click();
	await expect(page).toHaveURL(/\/settings$/);
});

test.describe('MORE on the phone (Reach, phoneMore)', () => {
	test.use({ viewport: { width: 360, height: 780 } });
	test('fits beside / and SELECT at 360px, with nothing scrolling sideways', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('button', { name: 'MORE' })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
		// The handoff's phone bar: the brand, /, SELECT and MORE; the word goes, the name stays.
		await expect(page.locator('.search-hint .word')).toBeHidden();
		await expect(page.getByRole('link', { name: 'Search' })).toBeVisible();
		const hint = await page
			.locator('.search-hint')
			.evaluate((el) => el.scrollWidth <= el.clientWidth);
		expect(hint).toBe(true);
	});
});
