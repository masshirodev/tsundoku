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
	const { id } = await openSeriesEnd(page, 'Isekai Ojisan');
	// Hide it through the row's own door, then read it again fresh: `hidden` is
	// now the series', not this page's answer.
	const hid = await page.request.post(`/series/${id}?/hide`, {
		headers: {
			origin: new URL(test.info().project.use.baseURL!).origin,
			'x-sveltekit-action': 'true'
		},
		form: { on: '1' }
	});
	expect(hid.ok()).toBe(true);
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
		await expect(fresh.getByRole('button', { name: 'DELETE', exact: true })).toBeVisible();
		const unhide = fresh.getByRole('button', { name: 'UNHIDE', exact: true });
		await expect(unhide).toBeVisible();
		await unhide.click();
		await expect(fresh.getByRole('button', { name: 'UNHIDDEN ✓' })).toBeVisible();
		// Shown again, so a fresh page offers DELETE alone.
		const shown = await endAgain();
		await expect(shown.getByRole('button', { name: 'UNHIDE', exact: true })).toHaveCount(0);
		await expect(shown.getByRole('button', { name: 'DELETE', exact: true })).toBeVisible();
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
	// A failure from any form but UNHIDE's is not the stale Work (c714's case,
	// below), even carrying that refusal's own words, which hold HIDE and HIDE
	// ALL: the row says its own sentence and never the action's (round 2).
	const refusal = 'A WORK IS HIDDEN WHOLE · HIDE ALL OR TAKE OUT';
	await page.route(/\/series\/\d+\?\/delete$/, (route) =>
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
	await end.getByRole('button', { name: 'DELETE', exact: true }).click();
	await page
		.getByRole('dialog', { name: /^DELETE / })
		.getByRole('button', { name: 'DELETE', exact: true })
		.click();
	await expect(end.getByRole('alert')).toHaveText('COULD NOT SAVE');
	// The refusal line holds no control's word, so a substring locator for the
	// row's own button still finds just that button.
	await expect(end.getByText('DELETE')).toHaveCount(1);
	// The button is a button again, not a row that silently reset.
	await expect(end.getByRole('button', { name: 'DELETE', exact: true })).toBeEnabled();
	await page.unroute(/\/series\/\d+\?\/delete$/);
});

/** COULD NOT SAVE's and the end page's words (doc/handoff-notes/reader.md, wave 31 round 2, and c655's). */
const ROW_WORDS = [
	'MORE',
	'BACK',
	'LINK',
	'EDIT',
	'OPEN',
	'OK',
	'HIDE',
	'UNDO',
	'DONE',
	'SERVERS',
	'TRY AGAIN',
	'SHOW',
	'ALL',
	'DETAILS',
	'RENAME',
	'HIDDEN',
	'UNHIDE',
	'UNHIDDEN',
	'DELETE',
	'ADD TO LIBRARY',
	'IN LIBRARY',
	'LIBRARY',
	'START',
	'WORK',
	'FAV',
	'FORGET',
	'DOWNLOAD FIRST 10',
	'NOT QUEUED',
	'ANOTHER SOURCE',
	'REVIEW',
	'MEANWHILE',
	'WORDS'
];

test('UNHIDE refused because the series joined a Work says so, and no other refusal does (c714)', async ({
	page
}) => {
	const SENTENCE = 'THE SERIES CHANGED · RELOAD';
	await command(page, '/reveal');
	const { id } = await openSeriesEnd(page, 'Isekai Ojisan');
	const here = page.url().replace(/\?.*$/, '');
	const origin = new URL(test.info().project.use.baseURL!).origin;
	// An action's answer is 200 even when it refuses: the outcome is the body's `type`.
	const post = async (path: string, form: URLSearchParams) => {
		const r = await page.request.post(path, {
			data: form.toString(),
			headers: {
				origin,
				'x-sveltekit-action': 'true',
				'content-type': 'application/x-www-form-urlencoded'
			}
		});
		return (await r.json()) as { type: string; data?: string };
	};
	const inDb = <T>(sql: string, ...args: unknown[]) => {
		const db = new Database(process.env.PLAYWRIGHT_DATABASE_PATH!, { readonly: true });
		try {
			return db.prepare(sql).get(...args) as T;
		} finally {
			db.close();
		}
	};
	const other = inDb<{ id: number }>('SELECT id FROM series WHERE title = ?', TITLE).id;
	// Both hidden: hidden and visible series can't share a Work (the GROUP below).
	const setHidden = (series: number, on: '0' | '1') =>
		post(`/series/${series}?/hide`, new URLSearchParams({ on }));
	for (const series of [id, other]) expect((await setHidden(series, '1')).type).toBe('success');
	let grouped = false;
	let failed: unknown;
	try {
		// Drawn while the series is hidden and in no Work, so the row has UNHIDE.
		await page.goto(`${here}?p=last`);
		await readerReady(page);
		await page.waitForLoadState('networkidle');
		await page.keyboard.press('ArrowLeft');
		const end = page.locator('[data-end-page]');
		await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();
		const unhide = end.getByRole('button', { name: 'UNHIDE', exact: true });
		await expect(unhide).toBeVisible();

		// An `error` from the same form is no stale Work: its usual sentence.
		await page.route(/\/series\/\d+\?\/hide$/, (route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ type: 'error', error: { message: 'boom' } })
			})
		);
		await unhide.click();
		await expect(end.getByRole('alert')).toHaveText('COULD NOT SAVE');
		await page.unroute(/\/series\/\d+\?\/hide$/);

		// The series goes into a Work behind this page, through the library's
		// own GROUP, so the refusal below is the real action's.
		const form = new URLSearchParams({ name: 'Refused Row' });
		form.append('series', String(id));
		form.append('series', String(other));
		const made = await post('/?/work', form);
		expect(made, JSON.stringify(made)).toMatchObject({ type: 'success' });
		grouped = true;

		await unhide.click();
		await expect(end.getByRole('alert')).toHaveText(SENTENCE);
		for (const word of ROW_WORDS) expect(SENTENCE.toUpperCase()).not.toContain(word);
		// A substring locator for each of the row's buttons finds just that button.
		await expect(end.getByText('UNHIDE')).toHaveCount(1);
		await expect(end.getByText('DELETE')).toHaveCount(1);
		await expect(unhide).toBeEnabled();

		// The second press answers the same, and is one line, not two.
		await unhide.click();
		await expect(end.getByRole('alert')).toHaveCount(1);
		await expect(end.getByRole('alert')).toHaveText(SENTENCE);

		// The sentence is true: drawn again, the Work's series offers no UNHIDE.
		await page.reload();
		await readerReady(page);
		await page.waitForLoadState('networkidle');
		await page.keyboard.press('ArrowLeft');
		await expect(end.getByText(/^END ·/)).toBeVisible();
		await expect(end.getByRole('button', { name: 'UNHIDE', exact: true })).toHaveCount(0);
	} catch (e) {
		failed = e;
	}
	// The library as this file found it, whatever the body did (c649).
	if (grouped) {
		const work = inDb<{ id: number; made: number }>(
			`SELECT w.id, w.created_at AS made FROM works w
				JOIN work_series s ON s.work_id = w.id WHERE s.series_id = ?`,
			id
		);
		const gone = await post(
			`/work/${work.id}?/ungroup`,
			new URLSearchParams({ made: String(work.made) })
		);
		expect.soft(gone.type).toBe('redirect');
	}
	for (const series of [id, other])
		expect.soft((await setHidden(series, '0')).type).toBe('success');
	if (failed) throw failed;
});
