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

test('going to the background blanks the page, and comes back to it with reveal still on', async ({
	page
}) => {
	await command(page, '/reveal');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await page.goto('/history');

	await visibility(page, 'hidden');
	await expect(page.getByTestId('privacy-blank')).toBeVisible();
	await visibility(page, 'visible');

	await expect(page.getByTestId('privacy-blank')).toHaveCount(0);
	await expect(page).toHaveURL(/\/history$/);
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	const names = (await page.context().cookies()).map((c) => c.name);
	expect(names).toContain('tsundoku_reveal');
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
});

test('incognito survives the background too', async ({ page }) => {
	await command(page, '/incognito');
	await page.goto('/history');

	await visibility(page, 'hidden');
	await expect(page.getByTestId('privacy-blank')).toBeVisible();
	await visibility(page, 'visible');

	await expect(page.getByTestId('privacy-blank')).toHaveCount(0);
	await expect(page.getByText('INCOGNITO · NOTHING SAVED')).toBeVisible();
	const names = (await page.context().cookies()).map((c) => c.name);
	expect(names).toContain('tsundoku_incognito');
	await page.getByRole('button', { name: 'END' }).click();
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

// ---- c680: a reader opened incognito sends nothing after the mode ends it ----------------
//
// END pressed elsewhere -- another tab, while the reader stays open -- ends the
// cookie, and the reader's own `data.incognito` stays true: `/api/reading`
// reads the cookie at the moment of each post, so anything the reader sends
// after it would be saved as ordinary reading. What each case pins is a writer
// the reader still has after that. (Before 2026-11-12 the shield's hide ended
// incognito; it no longer does, doc/PRIVACY.md.)

/** END in the incognito band, pressed from another tab, as a person with two tabs would. */
async function endIncognito(page: Page) {
	const other = await page.context().newPage();
	await other.goto('/');
	const end = other.getByRole('button', { name: 'END' });
	await expect(end).toBeVisible();
	await end.click();
	await expect(other.getByText('INCOGNITO · NOTHING SAVED')).toHaveCount(0);
	await other.close();
	const names = (await page.context().cookies()).map((c) => c.name);
	expect(names).not.toContain('tsundoku_incognito');
}

test('image reader: a page still to come when the app is left writes nothing incognito', async ({
	page
}) => {
	const { id, entry } = await seriesAndEntry(page);
	await command(page, '/incognito');
	const before = readingIn(id);
	await page.goto(`/read/${entry}?p=3`);
	await readerReady(page);
	// A turn leaves the reader's 800 ms settle behind; the mode ends inside it,
	// as another tab's END does, and the report fires on its own.
	await page.keyboard.press('ArrowRight');
	await endIncognito(page);
	await page.waitForTimeout(1500);
	expect(readingIn(id)).toEqual(before);
});

test('image reader: closing on the way back writes nothing incognito', async ({ page }) => {
	const { id, entry } = await seriesAndEntry(page);
	await command(page, '/incognito');
	const before = readingIn(id);
	await page.goto(`/read/${entry}?p=3`);
	await readerReady(page);
	await endIncognito(page);
	// The reader taken away by hand, whose pagehide sends its `close`.
	await page.goto('/');
	expect(readingIn(id)).toEqual(before);
	await page.goto('/history');
	await expect(page.locator('.row', { hasText: TITLE }).filter({ hasText: /P\. 4\b/ })).toHaveCount(
		0
	);
});

test('text reader: a page still to come when the app is left writes nothing incognito', async ({
	page
}) => {
	const { id, entry } = await seriesAndEntry(page, NOVEL);
	await command(page, '/incognito');
	const before = readingIn(id);
	await page.goto(`/read/${entry}`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	// A turn schedules the paragraph report; the mode ends inside its settle.
	await page.keyboard.press('ArrowRight');
	await endIncognito(page);
	await page.waitForTimeout(1500);
	expect(readingIn(id)).toEqual(before);
});

test('text reader: closing on the way back writes nothing incognito', async ({ page }) => {
	const { id, entry } = await seriesAndEntry(page, NOVEL);
	await command(page, '/incognito');
	const before = readingIn(id);
	await page.goto(`/read/${entry}`);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15_000 });
	await endIncognito(page);
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

test('a hidden series read under /reveal offers UNHIDE, not HIDE again', async ({ page }) => {
	await command(page, '/reveal');
	// Hidden before this page is drawn, so `hidden` is the series', not this
	// page's answer. A row of its own: this hid Isekai Ojisan, and `library-flow`
	// reads that tile beside it (insertHiddenSeries).
	const [own] = insertHiddenSeries('Qx673 Gimel');
	const endAgain = async () => {
		await page.goto(`/read/${own.entry}?p=last`);
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
	// The row goes, shown or hidden, whatever the body did.
	expect.soft(removeOwnSeries([own.id])).toBe(0);
	if (failed) throw failed;
});

test('a refused library row says why, in the row', async ({ page }) => {
	const { end } = await openSeriesEnd(page, 'Isekai Ojisan');
	// A failure from any form but UNHIDE's is not the stale Work (c714's case,
	// below), even carrying that refusal's own words, which hold HIDE and HIDE
	// ALL: the row says its own sentence and never the action's.
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

/**
 * Hidden manga of a case's own, written through the preview's database file.
 * A case that hides or groups a series holds it for every file running beside
 * it, and every manga in the seed has a reader in some other spec: hidden,
 * `library-layout`'s rating bars and `library-flow`'s bystander lose their tile.
 * These rows are hidden from their first moment, so with reveal off no other
 * file can see them, and no spec names their titles. A `sample:` path is what
 * makes the reader draw generated pages for them.
 */
function insertHiddenSeries(...titles: string[]) {
	const db = new Database(process.env.PLAYWRIGHT_DATABASE_PATH!, { timeout: 30_000 });
	try {
		const now = Date.now();
		return db.transaction(() =>
			titles.map((title) => {
				const id = Number(
					db
						.prepare(
							`INSERT INTO series (root_id, title, kind, hidden, path, added_at, indexed_at)
								VALUES ((SELECT id FROM roots WHERE path = 'sample:library'), ?, 'manga', 1, ?, ?, ?)`
						)
						.run(title, `sample:library/${title}`, now, now).lastInsertRowid
				);
				const entry = Number(
					db
						.prepare(
							`INSERT INTO entries (series_id, position, label, page_count, file, added_at)
								VALUES (?, 1, 'Ch. 1', 24, 'Chapter 1.cbz', ?)`
						)
						.run(id, now).lastInsertRowid
				);
				return { id, entry };
			})
		)();
	} finally {
		db.close();
	}
}

/**
 * Those rows gone, with any Work they made, whatever the page was left doing:
 * the database, not a form that needs a live page. Answers how many of their
 * entries are left, or the error, rather than throwing, so a failure here is
 * reported beside the body's and cannot replace it. Everything that
 * hangs off a series or an entry cascades, or is `SET NULL`.
 */
function removeOwnSeries(ids: number[]): unknown {
	let db: Database.Database | undefined;
	try {
		db = new Database(process.env.PLAYWRIGHT_DATABASE_PATH!, { timeout: 30_000 });
		const open = db;
		const marks = ids.map(() => '?').join(',');
		open.transaction(() => {
			open
				.prepare(
					`DELETE FROM works WHERE id IN (SELECT work_id FROM work_series WHERE series_id IN (${marks}))`
				)
				.run(...ids);
			open.prepare(`DELETE FROM series WHERE id IN (${marks})`).run(...ids);
		})();
		return (
			open
				.prepare(`SELECT COUNT(*) AS n FROM entries WHERE series_id IN (${marks})`)
				.get(...ids) as {
				n: number;
			}
		).n;
	} catch (e) {
		return String(e);
	} finally {
		db?.close();
	}
}

/**
 * COULD NOT SAVE's and the end page's words (doc/handoff-notes/reader.md, wave
 * 31 round 2, and c655's). Not SERIES, which the page draws in ← SERIES and
 * which c714's sentence holds: no row control is named that (`rowRefusal`).
 */
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

test('UNHIDE refused because the series joined a Work says so, and no other refusal does', async ({
	page
}) => {
	const SENTENCE = 'THE SERIES CHANGED · RELOAD';
	await command(page, '/reveal');
	// Both hidden: hidden and visible series can't share a Work (the GROUP below).
	const [own, partner] = insertHiddenSeries('Qx714 Alef', 'Qx714 Bet');
	const here = `/read/${own.entry}`;
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
		const form = new URLSearchParams({ name: 'Qx714 Run' });
		form.append('series', String(own.id));
		form.append('series', String(partner.id));
		const made = await post('/?/work', form);
		expect(made, JSON.stringify(made)).toMatchObject({ type: 'success' });

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
	// The library as this file found it, whatever the body did.
	expect.soft(removeOwnSeries([own.id, partner.id])).toBe(0);
	if (failed) throw failed;
});
