import { devices, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { engineCalls, engineDown, resetEngine } from './browse-world';

/**
 * MOVE end to end (doc/MOVE.md): a series moves to another entry on
 * its source, keeps what the new entry lacks, adds what only it has, and comes
 * back with MOVE BACK. The fake engine (tests/browse-setup.ts) gives any search
 * one result, whose chapter list is 1, 2 and 3; the seeded series has 1, 2 and
 * an extra at 2.5, with 2 and 2.5 queued.
 *
 * One pane here (800 × 1280, tablet portrait): picking a candidate swaps the
 * candidates for the comparison, as the design draws it.
 */

const TITLE = 'Movenberg Heir';

/**
 * The series as the browse world seeds it, its queue held: ch. 2 not
 * downloaded, and ch. 2 and 2.5 queued. Two things change it, neither of them
 * this case's subject:
 *
 * - **The world's own downloader.** The first page load of the browse preview
 *   starts the app's download worker (`+layout.server.ts` →
 *   `ensureEngineWorker()`; its first tick 1 s later, then every 3 s), and the
 *   fake engine serves ch. 2's pages, so it downloads the seeded queue.
 *   Measured (the world's rows logged at each step, alone): ch. 2 `queued` at
 *   the case's start, `downloading` 1.1 s later after the first `goto`,
 *   downloaded and out of the queue by what the move does (2.3 s), which then
 *   read "1 queued, ch. 2.5": red on a fresh world whenever the worker wins.
 *   So the rows are held off it by the queue's own backoff field, `next_at`
 *   ("not before this", which the worker's `nextUp()` respects), a day ahead:
 *   still queued for that screen, never picked during the case.
 * - **The case itself.** MOVE takes ch. 2.5 out of the queue ("has no
 *   partner"), and MOVE BACK does not put it back, by design (doc/MOVE.md,
 *   "The queue"), so a second pass in one world (`--repeat-each`, a retry)
 *   read "1 queued" and failed on its own leftover.
 *
 * Done at the start, not the end, so a copy that failed mid-way is repaired
 * for the next as well (a series left moved is not: its key is the move's,
 * and the next copy's red names it). Through the world's database, because
 * the app has no route for any of it: its one way into the queue, `enqueue()`
 * (src/lib/server/engine/queue.ts), takes only a chapter with no file, and
 * 2.5 is downloaded (the world's `Afterword.cbz`). A download in flight is
 * waited out first, so the worker cannot land ch. 2 after the reset. The
 * browse world's database is the one `tests/browse-setup.ts` makes in the
 * run's folder, named after the runner's pid; it exports no path, so it is
 * found there by that name. A file the worker wrote for ch. 2 stays in the
 * world's library folder, no longer named by any entry.
 */
async function asSeeded() {
	const dir = process.env.PLAYWRIGHT_RUN_DIR!;
	const files = readdirSync(dir).filter((n) => /^tsundoku-e2e-browse-\d+\.sqlite$/.test(n));
	expect(files, `the browse world's database in ${dir}`).toHaveLength(1);
	const db = new Database(join(dir, files[0]));
	try {
		db.pragma('busy_timeout = 5000');
		const ofSeries = `SELECT e.id, e.series_id, e.position FROM entries e JOIN series s ON s.id = e.series_id
			WHERE s.title = ? AND e.position IN (2, 2.5)`;
		await expect
			.poll(
				() =>
					db
						.prepare(
							`SELECT COUNT(*) AS n FROM download_queue WHERE state = 'downloading'
							AND entry_id IN (SELECT id FROM (${ofSeries}))`
						)
						.get(TITLE) as { n: number },
				{ message: 'a download of this series still in flight', timeout: 15_000 }
			)
			.toEqual({ n: 0 });
		const rows = db.prepare(ofSeries).all(TITLE) as {
			id: number;
			series_id: number;
			position: number;
		}[];
		expect(rows.map((r) => r.position).sort()).toEqual([2, 2.5]);
		const held = Date.now() + 24 * 60 * 60 * 1000;
		db.transaction(() => {
			for (const r of rows) {
				if (r.position === 2)
					db.prepare(`UPDATE entries SET available = 0, file = '' WHERE id = ?`).run(r.id);
				db.prepare(
					`INSERT INTO download_queue (entry_id, series_id, position, state, next_at, queued_at)
					VALUES (?, ?, ?, 'queued', ?, ?)
					ON CONFLICT (entry_id) DO UPDATE SET state = 'queued', tries = 0, failure = '',
						error = '', next_at = excluded.next_at, done_pages = 0`
				).run(r.id, r.series_id, r.position === 2 ? 1 : 2, held, Date.now());
			}
		})();
	} finally {
		db.close();
	}
}

async function openSeries(page: Page) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
}

test('a series moves to another entry, keeps what it lacks and adds what it has, then comes back', async ({
	page
}) => {
	await asSeeded();
	await openSeries(page);

	// A SOURCE row under LINK and COVER, with MOVE →.
	const panel = page.getByRole('region', { name: 'About this series' });
	await expect(panel.getByText('SOURCE', { exact: true })).toBeVisible();
	await expect(panel.getByText('Open Source', { exact: true })).toBeVisible();
	await panel.getByRole('link', { name: 'MOVE →' }).click();
	await expect(page).toHaveURL(/\/series\/\d+\/move/);

	// The candidate as the source answers. The current entry is named,
	// not offered.
	const current = page.locator('.cand.now', { hasText: 'THIS SERIES NOW' });
	await expect(current).toBeVisible();
	await expect(current).toHaveAttribute('aria-disabled', 'true');
	const candidate = page.locator('a.cand', { hasText: 'Movenberg Heir (new)' });
	await expect(candidate).toBeVisible();
	await candidate.click();
	await expect(page).toHaveURL(/to=/);

	// What the move does, in the series' own terms.
	await expect(
		page.getByText(/2 match by number · 1 kept from Open Source · 1 added/)
	).toBeVisible();
	await expect(page.getByText(/1 HAS NO PARTNER · LEAVES THE QUEUE/)).toBeVisible();
	await expect(page.getByText(/2 queued, ch\. 2 and 2\.5/)).toBeVisible();
	await expect(page.getByText('NOTHING DOWNLOADS ON MOVE')).toBeVisible();

	// The number map draws the kept extra and the added chapter apart.
	const map = page.locator('.blk.map');
	await expect(map.locator('.mr.run', { hasText: 'KEPT FROM OPEN SOURCE' }).first()).toBeVisible();
	await expect(map.locator('.mr.run', { hasText: 'ADDED · UNREAD' }).first()).toBeVisible();

	await page.getByRole('button', { name: 'MOVE TO OPEN SOURCE →' }).click();

	// The same series, its new entry, the band and the way back.
	await expect(page).toHaveURL(/\/series\/\d+\?moved=1/);
	await expect(page.getByText('MOVED TO OPEN SOURCE')).toBeVisible();
	await expect(
		page.getByText(/1 CHAPTER ADDED, NOT DOWNLOADED · 1 KEPT FROM OPEN SOURCE/)
	).toBeVisible();
	await expect(panel.getByText('WAS OPEN SOURCE · UNTIL')).toBeVisible();
	await expect(panel.getByRole('button', { name: 'MOVE BACK' })).toBeVisible();
	// The kept chapter says whose it is.
	await expect(page.locator('.entry .src', { hasText: 'OPEN SOURCE' })).toBeVisible();
	// The chapter only the new entry has is listed; MOVE downloaded none of it.
	await expect(page.locator('.entry', { has: page.locator('.num:text-is("3")') })).toBeVisible();

	await panel.getByRole('button', { name: 'MOVE BACK' }).click();
	await expect(page).toHaveURL(/\/series\/\d+\?moved=1/);
	await expect(page.getByText('MOVED TO OPEN SOURCE')).toBeVisible();
	// Back: the chapter the new entry added has no file, so it is not in the
	// series again; the extra kept from the old entry is.
	await expect(page.locator('.entry', { has: page.locator('.num:text-is("3")') })).toHaveCount(0);
	await expect(page.locator('.entry', { has: page.locator('.num:text-is("2.5")') })).toBeVisible();
	await expect(panel.getByText('SOURCE', { exact: true })).toBeVisible();
});

/**
 * The move page's frame (doc/MOVE.md):
 * the candidates' 440px column beside the comparison at 1280, one column below
 * 1024 where the comparison is its own screen, and the hand-set heights the
 * mock draws. Asserted so a later tidy-up can't round them onto a ladder that
 * was never there.
 */
test('its frame is two panes at 1280 and one below 1024, at the design’s measurements', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await openSeries(page);
	await page
		.getByRole('region', { name: 'About this series' })
		.getByRole('link', { name: 'MOVE →' })
		.click();
	await expect(page).toHaveURL(/\/series\/\d+\/move/);
	await page.locator('a.cand', { hasText: 'Movenberg Heir (new)' }).click();
	await expect(page.locator('.confirm')).toBeVisible();

	const style = (selector: string, prop: string) =>
		page
			.locator(selector)
			.first()
			.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
	expect(await style('.cands', 'width')).toBe('440px');
	expect(await style('.mv', 'flex-direction')).toBe('row');
	expect(await style('.box', 'height')).toBe('52px');
	expect(await style('.confirm', 'height')).toBe('72px');
	expect(await style('.what .lb', 'width')).toBe('112px');
	// The number map's rows are 48px at least, the mock's own height.
	const mapRow = await page
		.locator('.blk.map .mr')
		.first()
		.evaluate((el) => el.getBoundingClientRect().height);
	expect(mapRow).toBeGreaterThanOrEqual(48);

	// The tablet portrait and the phone: one pane, the comparison its own screen.
	await page.setViewportSize({ width: 800, height: 1280 });
	expect(await style('.mv', 'flex-direction')).toBe('column');
	await expect(page.locator('.cmp')).toBeVisible();
	await expect(page.locator('.cands')).toBeHidden();
});

/*
 * Only the browse server's seed has an anime with a season watched through
 * (Tsukiakari no Ryokōsha's season 1), so the episode fold's hover is checked
 * here.
 * A hover needs a fine pointer; the browse project is a touch tablet, so this
 * describe is a desktop. series-layout.e2e.ts checks the chapter fold.
 */
test.describe('the episode fold under a fine pointer', () => {
	const { defaultBrowserType: _b, ...desktop } = devices['Desktop Chrome'];
	void _b;
	test.use({ ...desktop, viewport: { width: 1440, height: 900 } });

	test('hovering the episode fold keeps its stripes', async ({ page }) => {
		await page.goto('/?sort=title');
		await page.locator('.grid .tile', { hasText: 'Tsukiakari no Ryokōsha' }).click();
		await page.waitForURL(/\/series\/\d+/);
		const fold = page.getByRole('region', { name: 'Episodes' }).locator('.fold button');
		await expect(fold).toContainText('WATCHED · SHOW');
		const image = () => fold.evaluate((n) => getComputedStyle(n).backgroundImage);
		expect(await image()).toMatch(/^repeating-linear-gradient/);
		await fold.hover();
		expect(await fold.evaluate((n) => n.matches(':hover'))).toBe(true);
		expect(await image()).toMatch(/^repeating-linear-gradient/);
	});
});

/*
 * TRY AGAIN and TRY ALL AGAIN are links to the page's own URL, so under
 * app.html's hover preload a desktop pointer asks the source again just by
 * hovering them (DOWNLOADS had the same fault). This measures it: the fake
 * engine records every source it was asked, and the engine is brought back up
 * after the page drew its DID NOT ANSWER fold, so a hover's preload would be
 * recorded rather than dropped.
 */
test.describe('TRY AGAIN under a hovering pointer', () => {
	const { defaultBrowserType: _b, ...desktop } = devices['Desktop Chrome'];
	void _b;
	test.use({ ...desktop, viewport: { width: 1440, height: 900 } });

	/** How many times the page asked the source for this series' own title. */
	const asks = async () =>
		(await engineCalls()).filter((c) => c.method === 'getSearchManga' && c.search === TITLE).length;

	/**
	 * The move page with its one source's search failed, drawn, and the engine
	 * up and counting again: every call after this is the page's own.
	 */
	async function failedFold(page: Page) {
		await engineDown();
		try {
			await openSeries(page);
			await page
				.getByRole('region', { name: 'About this series' })
				.getByRole('link', { name: 'MOVE →' })
				.click();
			await expect(page).toHaveURL(/\/series\/\d+\/move/);
			const fold = page.locator('details.fold.unanswered');
			await expect(fold.locator('summary')).toContainText('DID NOT ANSWER');
			await fold.locator('summary').click();
			await expect(fold).toContainText('OPEN SOURCE · EN · DID NOT ANSWER IN 20 S');
			return fold;
		} finally {
			await resetEngine();
		}
	}

	/**
	 * The pointer comes to rest on the link and then does it again, with the
	 * mouse moved away between, as a person's does. The first hover can land
	 * with the pointer already where it starts, so only the second proves the
	 * page heard a `mousemove` at all: seen on the candidate beside it, which
	 * preloads on exactly the second hover.
	 */
	const restOn = async (page: Page, link: ReturnType<Page['locator']>) => {
		await link.hover();
		await page.mouse.move(0, 0);
		await link.hover();
	};

	test('hovering TRY AGAIN asks nothing, and one tap asks once', async ({ page }) => {
		const fold = await failedFold(page);
		const tryAgain = fold.getByRole('link', { name: 'TRY AGAIN', exact: true });
		expect(await asks()).toBe(0);
		// Nothing may be asked until the tap. A wait is the assertion here, and
		// nothing else.
		await restOn(page, tryAgain);
		await page.waitForTimeout(1500);
		expect(await asks()).toBe(0);

		const answered = page.waitForResponse((r) => r.url().includes('/move/ask?'));
		await tryAgain.click();
		expect((await answered).status()).toBe(200);
		await expect(page.locator('a.cand', { hasText: 'Movenberg Heir (new)' })).toBeVisible();
		expect(await asks()).toBe(1);
	});

	test('hovering TRY ALL AGAIN asks nothing, and one tap asks once', async ({ page }) => {
		const fold = await failedFold(page);
		const all = fold.getByRole('link', { name: 'TRY ALL AGAIN' });
		expect(await asks()).toBe(0);
		await restOn(page, all);
		await page.waitForTimeout(1500);
		expect(await asks()).toBe(0);

		const answered = page.waitForResponse((r) => r.url().includes('/move/ask?'));
		await all.click();
		expect((await answered).status()).toBe(200);
		await expect(page.locator('a.cand', { hasText: 'Movenberg Heir (new)' })).toBeVisible();
		expect(await asks()).toBe(1);
	});
});
