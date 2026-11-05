import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { SOURCE, previewId, startTagWorld, type TagWorld } from './helpers/tag-world';

/**
 * A source's own switches (card c435; doc/BROWSE.md, "A source's own
 * switches"): HIDDEN SOURCE, ADDED HIDDEN and OFF HISTORY, set on the source's
 * settings page and followed to the screens each one changes. It runs in the
 * browse project (its name), but in a world of its own (tests/helpers/
 * tag-world.ts: a seeded database, a fake engine and a preview, each on a port
 * the OS hands out), because every case writes to the library or to the
 * source's switches, and the browse world's database is shared by the other
 * browse-* files. Serial: the cases share that one world, and each turns its
 * switch back off.
 */

let world: TagWorld;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
	world = await startTagWorld('flags');
});
test.afterAll(async () => {
	await world?.stop();
});

const url = (path: string) => `${world.base}${path}`;
const settings = `/browse/${SOURCE.id}/settings`;
const previewPath = `/downloads/source/${previewId}?from=${encodeURIComponent(`/browse/${SOURCE.id}`)}`;

async function reveal(context: BrowserContext, on: boolean) {
	if (on)
		await context.addCookies([
			{ name: 'tsundoku_reveal', value: '1', url: world.base, httpOnly: true }
		]);
	else await context.clearCookies({ name: 'tsundoku_reveal' });
}

/** The row of one of tsundoku's own switches on the settings page. */
const own = (page: Page, title: string) => page.locator('form.own', { hasText: title });

/** Turns a switch to `on` by tapping it, and waits for the save to answer. */
async function flip(page: Page, title: string, on: boolean) {
	await page.goto(url(settings));
	await page.waitForLoadState('networkidle');
	const sw = own(page, title).getByRole('switch');
	await expect(sw).toHaveAttribute('aria-checked', String(!on));
	await sw.click();
}

test('every source’s settings page has tsundoku’s three switches, above the extension’s own', async ({
	page
}) => {
	await page.goto(url(settings));
	await expect(page.locator('form.own .t')).toHaveText([
		'Hidden source',
		'Added hidden',
		'Off history'
	]);
	for (const s of await page.locator('form.own').getByRole('switch').all())
		await expect(s).toHaveAttribute('aria-checked', 'false');
	await expect(page.getByText('01 — IN TSUNDOKU')).toBeVisible();
	await expect(page.getByText(/^02 — TAG SOURCE · EN$/)).toBeVisible();
});

test('HIDDEN SOURCE: the source is gone outside reveal, at every door, and back inside it', async ({
	page,
	context
}) => {
	await page.goto(url('/browse'));
	await expect(page.locator('a.row', { hasText: SOURCE.name }).first()).toBeVisible();

	// With reveal off the switch lands on BROWSE, since the page it is on is no longer found.
	await flip(page, 'Hidden source', true);
	await expect(page).toHaveURL(url('/browse'));
	await expect(page.locator('a.row', { hasText: SOURCE.name })).toHaveCount(0);
	for (const path of [`/browse/${SOURCE.id}`, settings, previewPath]) {
		const res = await page.goto(url(path));
		expect(res?.status(), path).toBe(404);
	}
	await page.goto(url('/browse/extensions'));
	await expect(page.locator('body')).not.toContainText(SOURCE.name.toUpperCase());
	await expect(page.locator('body')).not.toContainText(SOURCE.name);

	// Inside reveal it is listed, marked HIDDEN, and its page and preview open.
	await reveal(context, true);
	await page.goto(url('/browse'));
	// In RECENT too, once its page was opened: every row of it says so.
	const rows = page.locator('a.row', { hasText: SOURCE.name });
	await expect(rows.first().locator('.hid')).toHaveText('HIDDEN');
	for (const r of await rows.all()) await expect(r.locator('.hid')).toHaveText('HIDDEN');
	expect((await page.goto(url(`/browse/${SOURCE.id}`)))?.status()).toBe(200);
	await page.goto(url(previewPath));
	await expect(page.getByRole('heading', { name: 'Preview Me Tagged' })).toBeVisible();

	// Off again, from inside reveal: the page stays, and outside reveal it is listed again.
	await flip(page, 'Hidden source', false);
	await expect(own(page, 'Hidden source').getByRole('switch')).toHaveAttribute(
		'aria-checked',
		'false'
	);
	await reveal(context, false);
	await page.goto(url('/browse'));
	await expect(page.locator('a.row', { hasText: SOURCE.name }).first()).toBeVisible();
	await expect(page.locator('a.row', { hasText: SOURCE.name }).locator('.hid')).toHaveCount(0);
});

test('ADDED HIDDEN: + ADD TO LIBRARY from it adds the series hidden, and says so outside reveal', async ({
	page,
	context
}) => {
	await flip(page, 'Added hidden', true);
	await expect(own(page, 'Added hidden')).toHaveClass(/\bsaved\b/);

	await page.goto(url(previewPath));
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /ADD TO LIBRARY/ }).click();
	// The series is hidden and reveal is off, so ADD lands back on the source's page.
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}\\?.*added=hidden`));
	const band = page.locator('.band', { hasText: 'ADDED TO THE LIBRARY, AND HIDDEN' });
	await expect(band).toBeVisible();
	// What the series page's band would say (c505): its chapters, none downloading, and UNDO.
	await expect(band).toContainText(
		/TAG SOURCE ADDS ITS SERIES HIDDEN · \d+ CHAPTERS? · NONE DOWNLOADED · REVEAL SHOWS IT/
	);
	await expect(band.getByRole('button', { name: 'UNDO' })).toBeVisible();
	const bandUrl = page.url();
	// The band is its URL: a reload says the same.
	await page.reload();
	await expect(band.getByRole('button', { name: 'UNDO' })).toBeVisible();
	// Hidden means hidden: its preview is now the series, which isn't found.
	expect((await page.goto(url(previewPath)))?.status()).toBe(404);
	// Inside reveal the preview opens the series it became.
	await reveal(context, true);
	await page.goto(url(previewPath));
	await expect(page).toHaveURL(/\/series\/\d+/);
	await expect(page.getByRole('heading', { name: 'Preview Me Tagged' })).toBeVisible();
	await reveal(context, false);

	// UNDO, outside reveal, from the band: out of the library, and the preview again.
	await page.goto(bandUrl);
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(page).toHaveURL(new RegExp(`/downloads/source/${previewId}`));
	await expect(page.getByRole('button', { name: /ADD TO LIBRARY/ })).toBeVisible();
	// The band's URL again, after UNDO: nothing to say, and nothing to undo.
	await page.goto(bandUrl);
	await expect(page.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })).toHaveCount(0);
	// UNDO twice (the same form posted again): it undoes nothing, and opens the preview.
	const band2 = new URL(bandUrl);
	const again = await page.request.post(url(`/browse/${SOURCE.id}?/undoAdd`), {
		form: {
			series: band2.searchParams.get('series')!,
			preview: band2.searchParams.get('preview')!
		},
		headers: { origin: world.base }
	});
	expect(again.ok()).toBe(true);
	expect((await page.goto(url(previewPath)))?.status()).toBe(200);
	await expect(page.getByRole('button', { name: /ADD TO LIBRARY/ })).toBeVisible();
	await flip(page, 'Added hidden', false);
});

test('ADDED HIDDEN: ADD AND DOWNLOAD outside reveal says what it queued, and UNDO is refused once it is read (c505)', async ({
	page,
	context
}) => {
	await flip(page, 'Added hidden', true);
	await page.goto(url(previewPath));
	const dl = page.locator('.dl-row .lcs.inline');
	await dl
		.getByRole('button', { name: /^FIRST \d+$|^ALL \d+$/ })
		.first()
		.click();
	await page
		.getByRole('dialog', { name: 'DOWNLOADING ADDS IT TO YOUR LIBRARY' })
		.getByRole('button', { name: 'ADD AND DOWNLOAD' })
		.click();
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}\\?.*added=hidden`));
	const at = new URL(page.url());
	const queued = at.searchParams.get('queued');
	const series = Number(at.searchParams.get('series'));
	// The queue's answer is carried: the preview's one chapter, queued because
	// this ADD hid it (c435), and the band says so, as the series page's does.
	expect(queued).toBe('1');
	const band = page.locator('.band', { hasText: 'ADDED TO THE LIBRARY, AND HIDDEN' });
	await expect(band).toContainText('ADDS ITS SERIES HIDDEN · 1 CHAPTER · 1 DOWNLOADING');
	await expect(band.getByRole('button', { name: 'UNDO' })).toBeVisible();

	// Read meanwhile (inside reveal, through the series' own MARK READ): UNDO is
	// refused at the tap, and the band says why.
	await reveal(context, true);
	await page.goto(url(`/series/${series}`));
	const entry = Number(
		/\/read\/(\d+)/.exec(
			(await page.locator('a[href^="/read/"]').first().getAttribute('href'))!
		)![1]
	);
	const mark = (read: boolean) =>
		page.request.post(url(`/series/${series}?/mark`), {
			form: { read: read ? '1' : '0', entry: String(entry) },
			headers: { origin: world.base }
		});
	await reveal(context, false);
	await page.goto(at.href);
	await expect(band.getByRole('button', { name: 'UNDO' })).toBeVisible();
	await reveal(context, true);
	expect((await mark(true)).ok()).toBe(true);
	await reveal(context, false);
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(band).toContainText('NO UNDO: SOMETHING OF IT IS DOWNLOADED OR READ NOW');
	await expect(band.getByRole('button', { name: 'UNDO' })).toHaveCount(0);
	// Still in the library, still hidden: the preview is still not found.
	expect((await page.goto(url(previewPath)))?.status()).toBe(404);
	// A reload of the band says the same, without UNDO.
	await page.goto(at.href);
	await expect(band).toContainText('NO UNDO: SOMETHING OF IT IS DOWNLOADED OR READ NOW');
	await expect(band.getByRole('button', { name: 'UNDO' })).toHaveCount(0);

	// Put back: unread, then UNDO from the band takes it out of the library.
	await reveal(context, true);
	expect((await mark(false)).ok()).toBe(true);
	await reveal(context, false);
	await page.goto(at.href);
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(page).toHaveURL(new RegExp(`/downloads/source/${previewId}`));
	await expect(page.getByRole('button', { name: /ADD TO LIBRARY/ })).toBeVisible();
	await flip(page, 'Added hidden', false);
});

test('OFF HISTORY: a read from it is logged, but never in HISTORY, inside reveal too', async ({
	page,
	context
}) => {
	// A real read of the source's series, through the reader's own call.
	await page.goto(url(`/series/${world.ids.tagged}`));
	const start = page.locator('a[href^="/read/"]').first();
	const entryId = Number(/\/read\/(\d+)/.exec((await start.getAttribute('href'))!)![1]);
	for (const [kind, extra] of [
		['open', { page: 0, total: 1 }],
		['page', { page: 0, total: 1, durationMs: 90_000 }]
	] as const) {
		const res = await page.request.post(url('/api/reading'), {
			data: { seriesId: world.ids.tagged, entryId, kind, ...extra }
		});
		expect(await res.json()).toEqual({ saved: true });
	}
	const rows = page.locator('.row', { hasText: 'Tagbearer Heir' });
	await page.goto(url('/history'));
	await expect(rows).toHaveCount(1);

	await flip(page, 'Off history', true);
	await expect(own(page, 'Off history')).toHaveClass(/\bsaved\b/);
	for (const on of [false, true]) {
		await reveal(context, on);
		await page.goto(url('/history'));
		await expect(page.getByRole('heading', { name: 'HISTORY' })).toBeVisible();
		await expect(rows, `reveal ${on}`).toHaveCount(0);
	}
	await reveal(context, false);
	// Still logged: the series keeps its place, and the switch off brings the row back.
	await flip(page, 'Off history', false);
	await page.goto(url('/history'));
	await expect(rows).toHaveCount(1);
});
