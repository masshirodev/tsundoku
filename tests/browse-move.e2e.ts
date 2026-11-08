import { devices, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { engineCalls, engineDown, resetEngine } from './browse-world';

/**
 * MOVE end to end (doc/MOVE.md; card c139): a series moves to another entry on
 * its source, keeps what the new entry lacks, adds what only it has, and comes
 * back with MOVE BACK. The fake engine (tests/browse-setup.ts) gives any search
 * one result, whose chapter list is 1, 2 and 3; the seeded series has 1, 2 and
 * an extra at 2.5, with 2 and 2.5 queued.
 *
 * One pane here (800 × 1280, tablet portrait): picking a candidate swaps the
 * candidates for the comparison, as the design draws it.
 */

const TITLE = 'Movenberg Heir';

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
	await openSeries(page);

	// Board 1: a SOURCE row under LINK and COVER, with MOVE →.
	const panel = page.getByRole('region', { name: 'About this series' });
	await expect(panel.getByText('SOURCE', { exact: true })).toBeVisible();
	await expect(panel.getByText('Open Source', { exact: true })).toBeVisible();
	await panel.getByRole('link', { name: 'MOVE →' }).click();
	await expect(page).toHaveURL(/\/series\/\d+\/move/);

	// Board 2: the candidate as the source answers. The current entry is named,
	// not offered.
	const current = page.locator('.cand.now', { hasText: 'THIS SERIES NOW' });
	await expect(current).toBeVisible();
	await expect(current).toHaveAttribute('aria-disabled', 'true');
	const candidate = page.locator('a.cand', { hasText: 'Movenberg Heir (new)' });
	await expect(candidate).toBeVisible();
	await candidate.click();
	await expect(page).toHaveURL(/to=/);

	// Board 3: what the move does, in the series' own terms.
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
	// The kept chapter says whose it is (board 4, frame 3).
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
 * The move page's frame (doc/MOVE.md; HANDOFF.md, "Verify what eyes cannot"):
 * the candidates' 440px column beside the comparison at 1280, one column below
 * 1024 where the comparison is its own screen, and the hand-set heights the
 * mock draws. Asserted so a later tidy-up can't round them onto a ladder that
 * was never there.
 */
test('its frame is two panes at 1280 and one below 1024, at the handoff’s measurements', async ({
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
 * c488, the episode list's half: only the browse server's seed has an anime
 * with a season watched through (Tsukiakari no Ryokōsha's season 1), so the
 * episode fold's hover is checked here, in the one browse file this slot owns.
 * A hover needs a fine pointer; the browse project is a touch tablet, so this
 * describe is a desktop. series-layout.e2e.ts checks the chapter fold.
 */
test.describe('the episode fold under a fine pointer (c488)', () => {
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
 * c604: TRY AGAIN and TRY ALL AGAIN are links to the page's own URL, so under
 * app.html's hover preload a desktop pointer asks the source again just by
 * hovering them (DOWNLOADS' c538, fixed there). This measures it: the fake
 * engine records every source it was asked, and the engine is brought back up
 * after the page drew its DID NOT ANSWER fold, so a hover's preload would be
 * recorded rather than dropped.
 */
test.describe('TRY AGAIN under a hovering pointer (c604)', () => {
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
