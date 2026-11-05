import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * DETAILS, the fold above the list (c425; doc/SERIES.md "DETAILS";
 * doc/handoffs/series-phone/). On a phone the settings-like rows fold behind
 * one 64px line, closed by default and remembered for the device; SHELVES
 * and ABOUT stay above it, and ABOUT clamps to three lines. Everywhere else
 * these projects run (the tablet in both orientations, the desktop) nothing
 * folds and every row keeps today's order. A plain `*.e2e.ts`, so it runs on
 * the four device projects; the TV's stop is tv-series-details.e2e.ts'.
 *
 * It only reads the shared seed: Tower of God (series-layout's, unlinked, so
 * its line carries LISTS' NOT LINKED mark in ink) and Hoshi no Umi no
 * Tabibito, a doujin with no lists at all (the quiet line). Opening DETAILS
 * writes the browser's localStorage, which is the test's own context.
 */

const KEY = 'tsundoku:series-details';

async function openSeries(page: Page, title: string) {
	await page.goto('/?sort=title');
	// A tile tapped before the library has hydrated does nothing (this base's
	// goto does not wait for hydration yet): tap again until the URL moves.
	await expect(async () => {
		await page.locator('.grid .tile', { hasText: title }).first().click();
		await page.waitForURL(/\/series\/\d+/, { timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

const line = (page: Page) => page.locator('[data-row="details"]');
/** The label of every row drawn inside the fold, in the screen's order. */
const labelsInside = (page: Page) =>
	page.locator('[data-details]').evaluate((n) =>
		// LISTS' label is its strip on a phone (ListsRow's `.strip-l`), its `.lab` on a tablet.
		[...n.querySelectorAll<HTMLElement>('.label, [data-row="lists"] .strip-l')]
			.filter((l) => l.getBoundingClientRect().height > 0)
			.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
			.map((l) => l.textContent?.replace(/\?/g, '').trim() ?? '')
	);
const top = (page: Page, label: string) =>
	(label === 'LISTS'
		? page.locator('[data-row="lists"]')
		: page.locator('.panel .label', { hasText: new RegExp(`^${label}`) }).first()
	).evaluate((n) => n.getBoundingClientRect().top + window.scrollY);

/** Open it as the owner does, once the page runs (the server draws it closed). */
async function toggle(page: Page, to: boolean) {
	await expect(async () => {
		if ((await line(page).getAttribute('aria-expanded')) !== String(to)) await line(page).click();
		await expect(line(page)).toHaveAttribute('aria-expanded', String(to), { timeout: 1_000 });
	}).toPass();
}

test.describe('on a phone', () => {
	test.beforeEach(({ page }, info) => {
		void page;
		test.skip(info.project.name !== 'phone', 'the fold is the phone’s (and the TV’s)');
	});

	test('closed by default: SHELVES and ABOUT, then one 64px line, then the list', async ({
		page
	}) => {
		await openSeries(page, 'Tower of God');
		const d = line(page);
		await expect(d).toBeVisible();
		await expect(d).toHaveAttribute('aria-expanded', 'false');
		// 64px at the least (1C); a long mark wraps and the line grows, never cuts.
		await expect(d).toHaveCSS('min-height', '64px');
		expect((await d.boundingBox())!.height).toBeGreaterThanOrEqual(64);
		await expect(page.locator('[data-details]')).toBeHidden();
		await expect(page.locator('.file-row')).toBeHidden();
		// The order above the list (1A, B): SHELVES, ABOUT, DETAILS, then 01 — CHAPTERS.
		const shelves = await top(page, 'SHELVES');
		const about = await top(page, 'ABOUT');
		const at = (await d.boundingBox())!.y + (await page.evaluate(() => window.scrollY));
		const list = await page
			.locator('.list-col')
			.evaluate((n) => n.getBoundingClientRect().top + window.scrollY);
		expect(shelves).toBeLessThan(about);
		expect(about).toBeLessThan(at);
		expect(at).toBeLessThan(list);
		await expect(d.locator('.dt-go')).toHaveText('SHOW ↓', { useInnerText: true });
		await expect(d.locator('.dt-go')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
	});

	test('its names are the rows inside, in their order, and a mark in ink names who', async ({
		page
	}) => {
		await openSeries(page, 'Tower of God');
		const d = line(page);
		// Not linked to AniList (FIND on its line): LISTS' mark, ink and 500.
		await expect(d.locator('.dt-state')).toHaveText('ANILIST NOT LINKED · NOTHING IS SENT');
		await expect(d.locator('.dt-state')).toHaveCSS('font-weight', '500');
		const ink = await page.evaluate(
			() => getComputedStyle(document.querySelector('.panel h1')!).color
		);
		await expect(d.locator('.dt-state')).toHaveCSS('color', ink);
		// The name says the state, never SHOW or HIDE: no other control's locator finds it.
		await expect(d).toHaveAttribute('aria-label', 'DETAILS · ANILIST NOT LINKED · NOTHING IS SENT');
		const names = (await d.locator('.dt-all').textContent())!.split(' · ');
		await toggle(page, true);
		expect(await labelsInside(page)).toEqual(names);
		// The line it opened is the line that names it, in LISTS, inside.
		await expect(page.locator('[data-row="lists"] [data-line="anilist"] .t')).toHaveText(
			'Not linked'
		);
	});

	test('quiet, when nothing needs the owner: text-2, 400', async ({ page }) => {
		await openSeries(page, 'Hoshi no Umi no Tabibito');
		const state = line(page).locator('.dt-state');
		// A doujin has no lists: its quiet word is its reading direction.
		const chosen = await page.evaluate(() => {
			const d = document.querySelector('[data-details]')!;
			return d.querySelector('.seg button[aria-pressed="true"]')?.textContent?.trim() ?? '';
		});
		expect(chosen).not.toBe('');
		await expect(state).toHaveText(chosen);
		await expect(state).toHaveCSS('font-weight', '400');
		const muted = await page.evaluate(
			() => getComputedStyle(document.querySelector('.panel .label')!).color
		);
		await expect(state).toHaveCSS('color', muted);
		await expect(line(page)).toHaveAttribute('aria-label', `DETAILS · ${chosen}`);
	});

	test('open, the cell inverts to HIDE ↑ and the rule goes ink; remembered for the device, not the series', async ({
		page
	}) => {
		await openSeries(page, 'Tower of God');
		await toggle(page, true);
		const d = line(page);
		await expect(page.locator('.file-row')).toBeVisible();
		await expect(d.locator('.dt-go')).toHaveText('HIDE ↑', { useInnerText: true });
		// Open, the state line goes: the rows say it themselves (1C, G).
		await expect(d.locator('.dt-state')).toHaveCount(0);
		await expect(d).toHaveAttribute('aria-label', 'DETAILS');
		const ink = await page.evaluate(
			() => getComputedStyle(document.querySelector('.panel h1')!).color
		);
		await expect(d.locator('.dt-go')).toHaveCSS('background-color', ink);
		await expect(d).toHaveCSS('border-bottom-color', ink);
		expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('1');

		// A reload, and another series: still open, one key for the device.
		await page.reload();
		await expect(line(page)).toHaveAttribute('aria-expanded', 'true');
		await expect(page.locator('.file-row')).toBeVisible();
		await openSeries(page, 'Hoshi no Umi no Tabibito');
		await expect(line(page)).toHaveAttribute('aria-expanded', 'true');

		// Closed again, and that is remembered too: the key goes.
		await toggle(page, false);
		expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
		await page.reload();
		await expect(line(page)).toBeVisible();
		await page.waitForLoadState('networkidle');
		await expect(line(page)).toHaveAttribute('aria-expanded', 'false');
		await expect(page.locator('.file-row')).toBeHidden();
	});

	test('the server draws it closed, so a first paint never flashes it open', async ({
		page,
		context
	}) => {
		await openSeries(page, 'Tower of God');
		await toggle(page, true);
		const url = page.url();
		// What the server sends, with the device remembering it open.
		const html = await (await context.request.get(url)).text();
		expect(html).toMatch(
			/aria-expanded="false"[^>]*data-row="details"|data-row="details"[^>]*aria-expanded="false"/
		);
		expect(html).not.toMatch(/class="details[^"]*\bopen\b/);
	});

	test('ABOUT clamps to three lines; MORE ↓ shows it whole, LESS ↑ folds it, and nothing is remembered', async ({
		page
	}) => {
		await openSeries(page, 'Tower of God');
		const p = page.locator('.panel .about p');
		const lines = () =>
			p.evaluate((n) =>
				Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight))
			);
		expect(await lines()).toBe(3);
		const more = page.locator('.panel .about .more');
		await expect(more).toHaveText('MORE ↓');
		await expect(async () => {
			await more.click();
			await expect(more).toHaveText('LESS ↑', { timeout: 1_000 });
		}).toPass();
		expect(await lines()).toBeGreaterThan(3);
		await more.click();
		await expect(more).toHaveText('MORE ↓');
		expect(await lines()).toBe(3);
		await more.click();
		await expect(more).toHaveText('LESS ↑');
		await page.reload();
		await expect(page.locator('.panel .about .more')).toHaveText('MORE ↓');
	});

	test('without script nothing folds, since nothing could open it', async ({
		browser,
		context,
		baseURL
	}) => {
		const js = await context.newPage();
		await openSeries(js, 'Tower of God');
		const url = js.url();
		await js.close();
		const ctx = await browser.newContext({
			...test.info().project.use,
			baseURL,
			storageState: await context.storageState(),
			javaScriptEnabled: false
		});
		try {
			const page = await ctx.newPage();
			await page.goto(url);
			await expect(page.getByRole('heading', { name: 'Tower of God' })).toBeVisible();
			await expect(page.locator('[data-row="details"]')).toBeHidden();
			await expect(page.locator('.file-row')).toBeVisible();
			await expect(page.locator('[data-row="lists"]')).toBeVisible();
		} finally {
			await ctx.close();
		}
	});
});

test.describe('where nothing folds', () => {
	test.beforeEach(({ page }, info) => {
		void page;
		test.skip(
			info.project.name === 'phone' || info.project.name === 'tv',
			'the phone and the TV fold'
		);
	});

	test('no DETAILS line, and every row in today’s order', async ({ page }) => {
		await openSeries(page, 'Tower of God');
		await expect(line(page)).toBeHidden();
		await expect(page.locator('.file-row')).toBeVisible();
		// Today's order (doc/SERIES.md, "The frame"): DIRECTION, SHELVES, LISTS,
		// COVER, TAGS, ABOUT, FILE.
		const order = ['DIRECTION', 'SHELVES', 'LISTS', 'COVER', 'TAGS', 'ABOUT', 'FILE'];
		const tops = [];
		for (const l of order) tops.push(await top(page, l));
		expect([...tops].sort((a, b) => a - b)).toEqual(tops);
		// ABOUT keeps its two lines here.
		const lines = await page
			.locator('.panel .about p')
			.evaluate((n) =>
				Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight))
			);
		expect(lines).toBe(2);
		// The DETAILS key changes nothing here.
		await page.evaluate((k) => localStorage.setItem(k, '1'), KEY);
		await page.reload();
		await expect(line(page)).toBeHidden();
		await page.evaluate((k) => localStorage.removeItem(k), KEY);
	});
});
