import { type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { expect, readerReady, test } from './helpers/hydrated';

/**
 * Incognito and leaving the app end to end (doc/PRIVACY.md). Serial,
 * tablet-portrait only. This file owns Yofukashi no Uta, the one
 * series it sends reading events for. Its c680 cases read Mushoku Tensei in
 * the text reader, in incognito too: nothing is written there (history-flow's
 * rows are a different field), and no text case writes its progress.
 */
test.describe.configure({ mode: 'serial' });

const TITLE = 'Yofukashi no Uta';
const NOVEL = 'Mushoku Tensei';

async function command(page: Page, text: string) {
	await page.goto('/search');
	await page.getByRole('searchbox').fill(text);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/$/);
}

/** Playwright can't put a page in the background, so say it was. */
async function visibility(page: Page, state: 'hidden' | 'visible') {
	// The listener is attached on hydration, which can trail the load event.
	await page.waitForLoadState('networkidle');
	await page.evaluate((s) => {
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
		document.dispatchEvent(new Event('visibilitychange'));
	}, state);
}

/** The series id, and an entry id read from the form SELECT fills in. */
async function seriesAndEntry(page: Page, title = TITLE) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: title }).click();
	await page.waitForURL(/\/series\/\d+/);
	const id = Number(page.url().match(/\/series\/(\d+)/)![1]);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.locator('.entry .entry-btn').first().click();
	const entry = Number(await page.locator('input[name="entry"]').first().inputValue());
	await page.getByRole('button', { name: 'Stop selecting' }).click();
	return { id, entry };
}

/**
 * What this run's database holds for a series, read through its file (the
 * preview's own `PLAYWRIGHT_DATABASE_PATH`): how many reading events the log
 * has, and the newest `last_opened_at` any entry of it carries. Reading that
 * writes nothing leaves both where they were.
 */
function readingIn(seriesId: number) {
	const db = new Database(process.env.PLAYWRIGHT_DATABASE_PATH!, { readonly: true });
	const events = (
		db.prepare('SELECT COUNT(*) AS n FROM reading_events WHERE series_id = ?').get(seriesId) as {
			n: number;
		}
	).n;
	const opened = (
		db
			.prepare('SELECT MAX(last_opened_at) AS at FROM entries WHERE series_id = ?')
			.get(seriesId) as {
			at: number | null;
		}
	).at;
	db.close();
	return { events, opened };
}

test('/incognito shows the band, and END ends it', async ({ page }) => {
	await command(page, '/incognito');
	await expect(page.getByText('INCOGNITO · NOTHING SAVED')).toBeVisible();
	await page.getByRole('button', { name: 'END' }).click();
	await expect(page.getByText('INCOGNITO · NOTHING SAVED')).toHaveCount(0);
});

test('reading while incognito is never written', async ({ page }) => {
	const { id, entry } = await seriesAndEntry(page);
	expect(Number.isInteger(entry)).toBe(true);
	// Pages, not row counts, so a rerun against a reused preview still holds:
	// had the incognito page 5 been written, today's row would read P. 6.
	// No other file reads this series on the shared database: library-flow's
	// ← case, which opens the last series by title (this one), reads it in
	// incognito since c499, so today's row is this file's one chapter, "P. 6
	// OF …", not a day across several, "CH. 1 → 199 · P. 6"
	// (src/lib/library/history.ts), which the c439 tolerance used to accept.
	// The negative check below still matches P. 6 in either shape, so a written
	// incognito page is caught even on a day that does span chapters.
	const today = page.locator('.rows').first().locator('.row', { hasText: TITLE });

	await command(page, '/incognito');
	const off = await page.request.post('/api/reading', {
		data: { seriesId: id, entryId: entry, kind: 'page', page: 5 }
	});
	expect(await off.json()).toEqual({ saved: false });
	await page.goto('/history');
	await expect(page.locator('.row', { hasText: TITLE }).filter({ hasText: /P\. 6\b/ })).toHaveCount(
		0
	);

	await page.getByRole('button', { name: 'END' }).click();
	await expect(page.getByText('INCOGNITO · NOTHING SAVED')).toHaveCount(0);
	const on = await page.request.post('/api/reading', {
		data: { seriesId: id, entryId: entry, kind: 'page', page: 7 }
	});
	expect(await on.json()).toEqual({ saved: true });
	await page.goto('/history');
	await expect(today).toContainText('P. 8 OF');
});

test('the reading call refuses a hidden series while reveal is off', async ({ page }) => {
	const res = await page.request.post('/api/reading', {
		data: { seriesId: 999_999, entryId: 1, kind: 'open' }
	});
	expect(res.status()).toBe(404);
	const bad = await page.request.post('/api/reading', {
		data: { seriesId: 1, entryId: 1, kind: 'skim' }
	});
	expect(bad.status()).toBe(400);
});

test('going to the background blanks the page, ends reveal, and comes back to the library', async ({
	page
}) => {
	await command(page, '/reveal');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await page.goto('/history');

	await visibility(page, 'hidden');
	await expect(page.getByTestId('privacy-blank')).toBeVisible();
	await visibility(page, 'visible');

	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('privacy-blank')).toHaveCount(0);
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
	const names = (await page.context().cookies()).map((c) => c.name);
	expect(names).not.toContain('tsundoku_reveal');
});

test('a reload is not leaving: reveal survives it', async ({ page }) => {
	await command(page, '/reveal');
	await page.reload();
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
});

test('without reveal or incognito, coming back stays where it was', async ({ page }) => {
	await page.goto('/history');
	await visibility(page, 'hidden');
	await visibility(page, 'visible');
	await expect(page.getByTestId('privacy-blank')).toHaveCount(0);
	await expect(page).toHaveURL(/\/history$/);
});

// ---- c680: a reader opened incognito sends nothing after the hide ends it ----------------
//
// The app's hide ends incognito in a beacon (doc/PRIVACY.md, step 2) while the
// reader's own `data.incognito` stays true: `/api/reading` reads the cookie at
// the moment of each post, so anything the reader sends after it is saved as
// ordinary reading. Chromium cannot be put in the background headless (a
// second page brought to the front leaves `visibilityState` visible; see the
// notes), so the two things the shield does are done as the shield does them:
// the step-2 beacon as a POST to `/leave`, and the step-3 landing as the
// `goto('/')` that takes the reader away. What each case pins is a writer the
// reader still has after that.

/** The shield's step 2: the beacon that ends incognito (204, `x-ended: 1`). */
async function leave(page: Page) {
	const res = await page.request.post('/leave');
	expect(res.status()).toBe(204);
	expect(res.headers()['x-ended']).toBe('1');
}

test('image reader: a page still to come when the app is left writes nothing incognito (c680)', async ({
	page
}) => {
	const { id, entry } = await seriesAndEntry(page);
	await command(page, '/incognito');
	const before = readingIn(id);
	await page.goto(`/read/${entry}?p=3`);
	await readerReady(page);
	// A turn leaves the reader's 800 ms settle behind; the app goes away inside
	// it, as a person's thumb does, and the report fires on its own.
	await page.keyboard.press('ArrowRight');
	await leave(page);
	await page.waitForTimeout(1500);
	expect(readingIn(id)).toEqual(before);
});

test('image reader: closing on the way back writes nothing incognito (c680)', async ({ page }) => {
	const { id, entry } = await seriesAndEntry(page);
	await command(page, '/incognito');
	const before = readingIn(id);
	await page.goto(`/read/${entry}?p=3`);
	await readerReady(page);
	await leave(page);
	// The shield's step 3: the fresh landing that takes the reader away, whose
	// pagehide sends its `close`.
	await page.goto('/');
	expect(readingIn(id)).toEqual(before);
	await page.goto('/history');
	await expect(page.locator('.row', { hasText: TITLE }).filter({ hasText: /P\. 4\b/ })).toHaveCount(
		0
	);
});

test('text reader: a page still to come when the app is left writes nothing incognito (c680)', async ({
	page
}) => {
	const { id, entry } = await seriesAndEntry(page, NOVEL);
	await command(page, '/incognito');
	const before = readingIn(id);
	await page.goto(`/read/${entry}`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	// A turn schedules the paragraph report; the app is left inside its settle.
	await page.keyboard.press('ArrowRight');
	await leave(page);
	await page.waitForTimeout(1500);
	expect(readingIn(id)).toEqual(before);
});

test('text reader: closing on the way back writes nothing incognito (c680)', async ({ page }) => {
	const { id, entry } = await seriesAndEntry(page, NOVEL);
	await command(page, '/incognito');
	const before = readingIn(id);
	await page.goto(`/read/${entry}`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await leave(page);
	await page.goto('/');
	expect(readingIn(id)).toEqual(before);
});

// ---- c673: the end page's library row knows a hidden series, and says why a press failed ----

/** The series' own screen, at its last chapter, then the reader's series end page. */
async function openSeriesEnd(page: Page, title: string) {
	const { id } = await seriesAndEntry(page, title);
	await page.goto(`/series/${id}`);
	await page.locator('.entry .entry-btn').last().click();
	await readerReady(page);
	const entry = Number(page.url().match(/\/read\/(\d+)/)![1]);
	// `?p=last` plus one turn forward (left: the seed's manga read R→L) is the
	// paged end page's door, as c655's case does it.
	await page.goto(`/read/${entry}?p=last`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	await page.keyboard.press('ArrowLeft');
	const end = page.locator('[data-end-page]');
	await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();
	return { id, end };
}

test('a hidden series read under /reveal offers UNHIDE, not HIDE again (c673)', async ({
	page
}) => {
	await command(page, '/reveal');
	const { id, end } = await openSeriesEnd(page, 'Isekai Ojisan');
	// Hide it through the row's own door, then read it again fresh: `hidden` is
	// now the series', not this page's answer.
	await end.getByRole('button', { name: 'HIDE', exact: true }).click();
	await expect(end.getByRole('button', { name: 'HIDDEN ✓' })).toBeVisible();
	const here = page.url().replace(/\?.*$/, '');
	const endAgain = async () => {
		await page.goto(`${here}?p=last`);
		await readerReady(page);
		await page.waitForLoadState('networkidle');
		await page.keyboard.press('ArrowLeft');
		const fresh = page.locator('[data-end-page]');
		await expect(fresh.getByText('END · LAST AVAILABLE')).toBeVisible();
		return fresh;
	};
	let failed: unknown;
	try {
		const fresh = await endAgain();
		await expect(fresh.getByRole('button', { name: 'HIDE', exact: true })).toHaveCount(0);
		const unhide = fresh.getByRole('button', { name: 'UNHIDE', exact: true });
		await expect(unhide).toBeVisible();
		await unhide.click();
		await expect(fresh.getByRole('button', { name: 'UNHIDDEN ✓' })).toBeVisible();
		// Shown again, so a fresh page offers HIDE rather than UNHIDE.
		const shown = await endAgain();
		await expect(shown.getByRole('button', { name: 'HIDE', exact: true })).toBeVisible();
	} catch (e) {
		failed = e;
	}
	// Shown again if the body left it hidden (c649: soft, so it cannot hide the body's own).
	await page
		.context()
		.addCookies([{ name: 'tsundoku_reveal', value: '1', url: 'http://localhost' }]);
	const putBack = await page.request.post(`/series/${id}?/hide`, {
		headers: {
			origin: new URL(test.info().project.use.baseURL!).origin,
			'x-sveltekit-action': 'true'
		},
		form: { on: '0' }
	});
	expect.soft(putBack.ok()).toBe(true);
	if (failed) throw failed;
});

test('a refused library row says why, in the row (c673)', async ({ page }) => {
	const { end } = await openSeriesEnd(page, 'Isekai Ojisan');
	// The action's own refusal for a stale page (the series was taken into a
	// Work meanwhile) holds HIDE and HIDE ALL, so the row must not repeat it:
	// it says its own sentence instead (round 2). The real action cannot be
	// made to refuse for a plain library series, so the refusal is answered
	// here with the server's own words (series/[id]/+page.server.ts, `hide`).
	const refusal = 'A WORK IS HIDDEN WHOLE · HIDE ALL OR TAKE OUT';
	await page.route(/\/series\/\d+\?\/hide$/, (route) =>
		route.fulfill({
			status: 400,
			contentType: 'application/json',
			// A failure's `data` is devalue-encoded on the wire, which is what
			// `$app/forms`'s `deserialize` decodes before `use:enhance` sees it.
			body: JSON.stringify({
				type: 'failure',
				status: 400,
				data: `[{"message":1},${JSON.stringify(refusal)}]`
			})
		})
	);
	await end.getByRole('button', { name: 'HIDE', exact: true }).click();
	await expect(end.getByRole('alert')).toHaveText('COULD NOT SAVE');
	// The refusal line holds no control's word, so a substring locator for the
	// row's own button still finds just that button.
	await expect(end.getByText('HIDE')).toHaveCount(1);
	// The button is a button again, not a row that silently reset.
	await expect(end.getByRole('button', { name: 'HIDE', exact: true })).toBeEnabled();
	await page.unroute(/\/series\/\d+\?\/hide$/);
});
