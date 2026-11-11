import { expect, test } from './fixtures';
import { ANIME_SOURCE, engineCalls, resetEngine, SOURCES } from './browse-world';

/**
 * + ADD TO LIBRARY and ADD AND DOWNLOAD from a preview replace the preview's
 * history entry instead of pushing one (c932, stage 1; doc/BROWSE.md,
 * doc/NAVIGATION.md): one swipe back from the new series lands on the catalog
 * the entry was found in, at the place it was left (c930), not on the preview
 * a second time. It counts history steps, and the source's own calls on the
 * way back. Runs in the `browse` project against its fake engine; the TV's
 * BACK is in `tests/tv-browse-focus.e2e.ts`, the project with a remote.
 */

const OPEN = `/browse/${SOURCES.open.id}`;

/** A tile on the source's page, by its title. */
const tile = (page: import('@playwright/test').Page, title: string) =>
	page.locator('.grid a.tile', { hasText: title }).first();

/** The preview's add, and the sheet's confirm: both name ADD in their own words. */
const addButton = (page: import('@playwright/test').Page) =>
	page.getByRole('button', { name: /ADD TO LIBRARY/ });

/** Where the list is: the scroll, and the tile at the top of the viewport. */
const place = (page: import('@playwright/test').Page) =>
	page.evaluate(() => {
		const tiles = [...document.querySelectorAll<HTMLElement>('.grid a.tile')];
		const top = tiles
			.filter((t) => t.getBoundingClientRect().bottom > 0)
			.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
		return { y: Math.round(scrollY), top: top?.querySelector('.t')?.textContent ?? null };
	});

/** The source's page-list calls: what a way back must not ask for again. */
const pageCalls = async () =>
	(await engineCalls()).filter((c) => /^get(Popular|Latest|Search)Manga$/.test(c.method));

/**
 * The source's kept answers forgotten, as its settings page's own `set` does
 * (`settings/+page.server.ts`, `forgetSource`): the way back asks the source
 * again, so its answer is cold and this visit's tiles cannot be the kept list's.
 */
async function forgetKept(page: import('@playwright/test').Page) {
	// The settings page's load is what keeps the source's preferences, and the
	// action reads them; asked without navigating, so history is left alone.
	await page.request.get(`${OPEN}/settings`);
	const set = await page.request.post(`${OPEN}/settings?/set`, {
		form: { key: 'quality', value: '1' },
		headers: { origin: new URL(page.url()).origin }
	});
	expect(set.ok(), 'the setting was saved').toBe(true);
}

/**
 * Record every tile title the document attaches from here on: a kept list drawn
 * for a frame leaves no other trace, and a count that settles cannot see it.
 */
async function watchTiles(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		const seen: string[] = [];
		const w = window as unknown as { __tiles: string[]; __mutations: number };
		w.__tiles = seen;
		w.__mutations = 0;
		const note = (node: Node) => {
			if (!(node instanceof Element)) return;
			const tiles = [
				...(node.matches('.grid a.tile') ? [node] : []),
				...node.querySelectorAll('.grid a.tile')
			];
			for (const t of tiles) seen.push(t.querySelector('.t')?.textContent ?? '');
		};
		new MutationObserver((records) => {
			w.__mutations += records.length;
			for (const r of records) for (const n of r.addedNodes) note(n);
		}).observe(document.body, { childList: true, subtree: true });
	});
}

/** What the observer watched: mutations seen, and every tile title the document took. */
const watched = (page: import('@playwright/test').Page) =>
	page.evaluate(() => {
		const w = window as unknown as { __tiles?: string[]; __mutations?: number };
		return { tiles: w.__tiles ?? [], mutations: w.__mutations ?? 0 };
	});

/** Scroll into the list, at a place a return has to come back to. */
async function scrollInto(page: import('@playwright/test').Page, y: number) {
	await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
}

/** The source's page at a place, and the catalog back from it is where it was. */
async function openListAt(page: import('@playwright/test').Page) {
	await page.goto(`${OPEN}?pages=2`);
	await expect(page.locator('.grid a.tile').first()).toContainText('Lindenborough Heir');
	await expect.poll(() => page.locator('.grid a.tile').count()).toBe(26);
	// Not the very end: the add changes the tile it adds (IN LIBRARY, and a
	// downloaded line), which can move the list's end by a few pixels.
	await scrollInto(page, 100);
	return place(page);
}

/**
 * Open a tile wholly in view, the [n]th of those drawn last: a click on a tile
 * cut by the viewport's edge is scrolled into view first, which moves the very
 * place the return has to come back to. The last ones are page 2's, which no
 * other spec opens.
 */
async function openVisible(page: import('@playwright/test').Page, n = 0) {
	const title = await page.evaluate((i) => {
		const whole = [...document.querySelectorAll<HTMLElement>('.grid a.tile')].filter((el) => {
			const r = el.getBoundingClientRect();
			return r.top >= 0 && r.bottom <= innerHeight;
		});
		const pick = whole[whole.length - 1 - i];
		return pick?.querySelector('.t')?.textContent ?? null;
	}, n);
	expect(title, 'a tile is whole in the viewport').toBeTruthy();
	await tile(page, title!).click();
	return title!;
}

/** The place a way back landed on: the same scroll (within a couple of pixels), the same tile. */
async function expectBackAt(
	page: import('@playwright/test').Page,
	before: { y: number; top: string | null },
	/** The tiles the list has now: one fewer when the add hid a result of it (the c435 landing). */
	count = 26
) {
	await expect.poll(() => new URL(page.url()).pathname).toBe(OPEN);
	await expect.poll(() => page.locator('.grid a.tile').count()).toBe(count);
	await expect
		.poll(async () => (await place(page)).y, { timeout: 10_000 })
		.toBeGreaterThanOrEqual(before.y - 2);
	const after = await place(page);
	expect(after.top, 'the same tile is at the top').toBe(before.top);
	expect(Math.abs(after.y - before.y), 'the same scroll').toBeLessThanOrEqual(2);
}

/** The preview's ← cell, whose word says where the entry was found. */
const previewBack = (page: import('@playwright/test').Page) =>
	page.locator('.preview a.back').first();

/**
 * UNDO on the new series' band (c932): the preview it was added from replaces
 * the series' history entry, so one swipe back is the catalog, and the
 * preview's ← still names that catalog rather than SOURCES (c262).
 */
async function undoOntoThePreview(page: import('@playwright/test').Page) {
	const stepsOnSeries = await page.evaluate(() => history.length);
	const undo = page
		.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })
		.getByRole('button', { name: 'UNDO' });
	await expect(undo).toBeVisible();
	await undo.click();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/downloads\/source\//);
	expect(
		await page.evaluate(() => history.length),
		'UNDO replaced the series’ entry, rather than pushing over it'
	).toBe(stepsOnSeries);
	expect(
		decodeURIComponent(new URL(page.url()).searchParams.get('from') ?? ''),
		'the preview’s origin survived UNDO'
	).toMatch(new RegExp(`^${OPEN}`));
	await expect(previewBack(page)).toContainText('BROWSE');
}

/** UNDO on the new series' band, forward in history: it puts the library back. */
async function undoFromTheSeries(page: import('@playwright/test').Page) {
	await page.goForward();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/series\/\d+$/);
	await undoOntoThePreview(page);
	await expect(addButton(page)).toBeVisible();
}

test.beforeEach(async () => {
	await resetEngine();
});

test.afterEach(async ({ page }) => {
	// The ADDED HIDDEN switch one case sets, off again whether it passed or not.
	await page.request.post(`${OPEN}/settings?/flag`, {
		form: { flag: 'addedHidden', value: 'false' },
		headers: { origin: new URL(page.url()).origin }
	});
});

test('ADD replaces the preview’s entry: one swipe back lands on the catalog, at its place', async ({
	page
}) => {
	const before = await openListAt(page);
	await openVisible(page);
	await expect(addButton(page)).toBeVisible();
	const stepsOnPreview = await page.evaluate(() => history.length);

	await addButton(page).click();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/series\/\d+$/);
	expect(new URL(page.url()).searchParams.get('added')).toBeTruthy();
	await expect(page.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })).toBeVisible();
	expect(await page.evaluate(() => history.length), 'the add replaced the preview’s entry').toBe(
		stepsOnPreview
	);

	// What the way back asks the source: nothing it had drawn.
	await resetEngine();
	await page.goBack();
	await expectBackAt(page, before);
	expect(await pageCalls(), 'no page already drawn is asked again').toEqual([]);

	await undoFromTheSeries(page);
});

test('UNDO after ADD: no entry of its own, the preview’s ← names the catalog, and one swipe back is the catalog', async ({
	page
}) => {
	const before = await openListAt(page);
	await openVisible(page);
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/downloads\/source\//);
	// The preview knows the catalog it was opened from, and ← says so (c262).
	expect(
		decodeURIComponent(new URL(page.url()).searchParams.get('from') ?? ''),
		'the preview carries its origin'
	).toMatch(new RegExp(`^${OPEN}`));
	await expect(previewBack(page)).toContainText('BROWSE');

	await addButton(page).click();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/series\/\d+$/);

	await undoOntoThePreview(page);
	// The whole point: one swipe back from the preview lands on the catalog, at
	// its kept place — not on the series UNDO deleted (a 404), and not on the
	// preview twice.
	await page.goBack();
	await expectBackAt(page, before);
});

test('UNDO in incognito: the same one swipe, and the visit keeps nothing', async ({
	page,
	baseURL
}) => {
	await page.context().addCookies([{ name: 'tsundoku_incognito', value: '1', url: baseURL! }]);
	await openListAt(page);
	await openVisible(page);
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/downloads\/source\//);
	await addButton(page).click();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/series\/\d+$/);
	await undoOntoThePreview(page);
	// One swipe back is the catalog, not the 404 of the series UNDO deleted. The
	// place is the browser's own restore, not a kept list: c930's snapshot
	// refuses incognito, so nothing of this visit outlives it.
	await page.goBack();
	await expect.poll(() => new URL(page.url()).pathname).toBe(OPEN);
	await expect.poll(() => page.locator('.grid a.tile').count()).toBe(26);
	expect(
		await page.evaluate(() => sessionStorage.getItem('sveltekit:snapshot')),
		'incognito kept no list'
	).toBeNull();
});

test('ADD AND DOWNLOAD: the same one swipe, with what it queued on the band', async ({
	page
}, testInfo) => {
	// A tile no other spec opens, and a different one per repeat: its queued
	// chapters really download here, so a second press of this case must not
	// find the first one's series already in the library.
	const before = await openListAt(page);
	await openVisible(page, 1 + (testInfo.repeatEachIndex % 6));
	await expect(addButton(page)).toBeVisible();
	await page.getByRole('button', { name: 'FIRST 3' }).click();
	// Ours, asking first (card c205), and on top.
	await expect(page.getByText('DOWNLOADING ADDS IT TO YOUR LIBRARY')).toBeVisible();
	const stepsOnPreview = await page.evaluate(() => history.length);
	await page.getByRole('button', { name: 'ADD AND DOWNLOAD' }).click();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/series\/\d+$/);
	expect(new URL(page.url()).searchParams.get('queued')).toBeTruthy();
	await expect(page.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })).toContainText(
		/DOWNLOAD/
	);
	expect(await page.evaluate(() => history.length), 'the add replaced the preview’s entry').toBe(
		stepsOnPreview
	);

	await resetEngine();
	await page.goBack();
	await expectBackAt(page, before);
	expect(await pageCalls(), 'no page already drawn is asked again').toEqual([]);

	// The library back as it was, usually: the queued chapters download at once,
	// and once one has the band rightly offers no UNDO (c505's rule), so the
	// series stays for a repeat that opens another tile. When it is offered, it
	// is the same action as + ADD's, and it replaces the series' entry too.
	await page.goForward();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/series\/\d+$/);
	const undo = page
		.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })
		.getByRole('button', { name: 'UNDO' });
	if (await undo.count()) {
		await undoOntoThePreview(page);
		await expect(addButton(page)).toBeVisible();
	}
});

test('an ADD that hid the series lands on the source’s page, and one swipe back still reaches the list', async ({
	page
}) => {
	// ADDED HIDDEN on this source, with reveal off: the new series isn't found,
	// so the band is drawn on the source's page instead of the series (c435,
	// c505), and the add still replaces the preview's entry.
	const before = await openListAt(page);
	const on = await page.request.post(`${OPEN}/settings?/flag`, {
		form: { flag: 'addedHidden', value: 'true' },
		headers: { origin: new URL(page.url()).origin }
	});
	expect(on.ok()).toBe(true);
	const added = 'Open Source 1-5';
	await tile(page, added).click();
	await expect(addButton(page)).toBeVisible();
	const stepsOnPreview = await page.evaluate(() => history.length);
	await addButton(page).click();
	await expect.poll(() => new URL(page.url()).pathname).toBe(OPEN);
	expect(new URL(page.url()).searchParams.get('added')).toBe('hidden');
	await expect(
		page.locator('.band', { hasText: 'ADDED TO THE LIBRARY, AND HIDDEN' })
	).toBeVisible();
	expect(await page.evaluate(() => history.length), 'the add replaced the preview’s entry').toBe(
		stepsOnPreview
	);

	// The way back asks the source again (its kept answers forgotten), so its
	// answer is cold: a kept list would be on screen for as long as it takes.
	await forgetKept(page);
	await watchTiles(page);
	await page.goBack();
	// The series the add hid is one of the source's own results, so the list is
	// one shorter outside reveal: the place is still the same.
	await expectBackAt(page, before, 25);
	// Not once, not for a frame: the observer saw every tile the document took.
	// This back is the same route as the landing, so the drawn tiles are the ones
	// already there (SvelteKit reuses them by mangaId) and nothing is attached —
	// measured, and why the flash this pins is in `browse-catalog-back.e2e.ts`,
	// where the way back remounts the list. The record count says the observer
	// was watching through the popstate.
	const seen = await watched(page);
	expect(seen.mutations, 'the observer watched the popstate').toBeGreaterThan(0);
	expect(seen.tiles, 'the added-and-hidden result was never attached').not.toContain(added);

	// The library back as it was: forward to the band's page, UNDO it there. The
	// band's UNDO is the same one the series' band has (wave 46): it replaces the
	// landing's entry rather than pushing over it, and it hands the preview the
	// catalog it was found in, so ← says BROWSE rather than SOURCES and one swipe
	// back is the list at its place (c932's UNDO line, the hidden band).
	await page.goForward();
	await expect.poll(() => new URL(page.url()).searchParams.get('added')).toBe('hidden');
	await undoOntoThePreview(page);
	await expect(addButton(page)).toBeVisible();
	// One swipe back: the catalog, not the band's own landing page, and the list
	// is drawn under today's rules — the series UNDO took out is not hidden any
	// more, so its result is one of 26 again, and no band is left behind it.
	await page.goBack();
	await expectBackAt(page, before, 26);
	expect(
		await page.locator('.band', { hasText: 'ADDED TO THE LIBRARY' }).count(),
		'nothing of the band stays on the catalog'
	).toBe(0);

	// The source's own setting back as it was, for the specs beside this one.
	await page.request.post(`${OPEN}/settings?/set`, {
		form: { key: 'quality', value: '0' },
		headers: { origin: new URL(page.url()).origin }
	});
});

/**
 * A shared link to a preview (c932's UNDO line, round 2): `/downloads/source/<id>`
 * opened in a fresh page, with no catalog behind it. ADD replaces the preview's
 * entry and UNDO replaces the series', so neither grows history; UNDO lands on
 * the preview with no `from=` invented -- its ← says SOURCES, which is true,
 * because there is nothing in the app behind the link -- and one swipe back
 * leaves the app for the blank page the fresh tab started on.
 */
test('a shared link to a preview: ADD and UNDO neither grows history, and the landing invents no origin', async ({
	page
}) => {
	// The anime source's one search hit (c735): no other spec adds it.
	const shared = `/downloads/source/${ANIME_SOURCE.id}~${Buffer.from('/show/search-hit').toString('base64url')}`;
	const fresh = await page.context().newPage();
	try {
		await fresh.goto(shared);
		await expect.poll(() => new URL(fresh.url()).pathname).toBe(shared);
		expect(
			new URL(fresh.url()).searchParams.get('from'),
			'a shared link has no origin of its own'
		).toBeNull();
		await expect(previewBack(fresh)).toContainText('SOURCES');
		await expect(addButton(fresh)).toBeVisible();
		const onPreview = await fresh.evaluate(() => history.length);
		// The tab's own blank page, then the link: nothing in the app behind it.
		expect(onPreview, 'a fresh tab has only its blank page behind the link').toBe(2);

		await addButton(fresh).click();
		await expect.poll(() => new URL(fresh.url()).pathname).toMatch(/^\/series\/\d+$/);
		expect(await fresh.evaluate(() => history.length), 'the add replaced the preview’s entry').toBe(
			onPreview
		);

		const undo = fresh
			.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })
			.getByRole('button', { name: 'UNDO' });
		await expect(undo).toBeVisible();
		await undo.click();
		await expect.poll(() => new URL(fresh.url()).pathname).toBe(shared);
		expect(
			await fresh.evaluate(() => history.length),
			'UNDO replaced the series’ entry, rather than pushing over it'
		).toBe(onPreview);
		expect(
			new URL(fresh.url()).searchParams.get('from'),
			'UNDO invented no origin a shared link never had'
		).toBeNull();
		await expect(previewBack(fresh)).toContainText('SOURCES');
		await expect(addButton(fresh)).toBeVisible();

		// Nothing in the app was behind the link: one swipe back is the tab's own
		// blank page, not a 404 and not a catalog it never had.
		await fresh.goBack();
		await expect.poll(() => fresh.url()).toBe('about:blank');
	} finally {
		await fresh.close();
	}
});

/**
 * The other half of the band's UNDO (wave 46): a shared link's ADD can hide the
 * series too, and then the band is BROWSE's. There is no catalog behind that
 * entry either, so UNDO hands the preview no `from=` — ← says SOURCES, one
 * swipe back leaves the app — and the recorded catalog is what keeps the two
 * apart: only an ADD the catalog itself carried records one.
 */
test('a shared link’s ADD that hid the series: the band’s UNDO invents no catalog behind it', async ({
	page,
	baseURL
}) => {
	const source = `/browse/${ANIME_SOURCE.id}`;
	const flag = async (value: string) =>
		page.request.post(`${source}/settings?/flag`, {
			form: { flag: 'addedHidden', value },
			headers: { origin: baseURL! }
		});
	expect((await flag('true')).ok()).toBe(true);
	try {
		const shared = `/downloads/source/${ANIME_SOURCE.id}~${Buffer.from('/show/search-hit').toString('base64url')}`;
		const fresh = await page.context().newPage();
		try {
			await fresh.goto(shared);
			await expect(addButton(fresh)).toBeVisible();
			const onPreview = await fresh.evaluate(() => history.length);
			await addButton(fresh).click();
			// The source is all but hidden now, so the band is BROWSE's (c435).
			await expect.poll(() => new URL(fresh.url()).searchParams.get('added')).toBe('hidden');
			const undo = fresh
				.locator('.band', { hasText: 'ADDED TO THE LIBRARY, AND HIDDEN' })
				.getByRole('button', { name: 'UNDO' });
			await expect(undo).toBeVisible();
			await undo.click();
			await expect.poll(() => new URL(fresh.url()).pathname).toBe(shared);
			expect(
				await fresh.evaluate(() => history.length),
				'UNDO replaced the landing’s entry, rather than pushing over it'
			).toBe(onPreview);
			expect(
				new URL(fresh.url()).searchParams.get('from'),
				'UNDO invented no catalog a shared link never had'
			).toBeNull();
			await expect(previewBack(fresh)).toContainText('SOURCES');
			await fresh.goBack();
			await expect.poll(() => fresh.url()).toBe('about:blank');
		} finally {
			await fresh.close();
		}
	} finally {
		expect((await flag('false')).ok(), 'the switch back as it was').toBe(true);
	}
});
