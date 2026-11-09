import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { previewId, SOURCE, startTagWorld, type TagWorld } from './helpers/tag-world';

/**
 * DETAILS, the fold above the list (c425; doc/SERIES.md "DETAILS";
 * doc/handoffs/series-phone/). On a phone the settings-like rows fold behind
 * one 64px line, closed by default and remembered for the device; SHELVES
 * and ABOUT stay above it, and ABOUT clamps to three lines. Everywhere else
 * these projects run (the tablet in both orientations, the desktop) nothing
 * folds, and ABOUT and TAGS stand under REFRESH and FOLLOW (c837). A plain
 * `*.e2e.ts`, so it runs on the four device projects; the TV's stop is
 * tv-series-details.e2e.ts'.
 *
 * It only reads the shared seed: Tower of God (series-layout's, unlinked, so
 * its line carries LISTS' NOT LINKED mark in ink) and Hoshi no Umi no
 * Tabibito, a doujin with no lists at all (the quiet line). Opening DETAILS
 * writes the browser's localStorage, which is the test's own context. c837's
 * cases write tags, through the EDIT sheet, so they run on a world of their own
 * (tests/helpers/tag-world.ts).
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
		: page.locator('.panel .label:visible', { hasText: new RegExp(`^${label}`) }).first()
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

	test('TAGS stays inside DETAILS (1A, 1C), under SOURCE’s place, drawn once (c837)', async ({
		page
	}) => {
		await openSeries(page, 'Tower of God');
		await expect(page.locator('.panel .tags:visible')).toHaveCount(0);
		await toggle(page, true);
		await expect(page.locator('.panel .tags:visible')).toHaveCount(1);
		const tags = await top(page, 'TAGS');
		expect(tags).toBeGreaterThan((await line(page).boundingBox())!.y);
		expect(tags).toBeGreaterThan(await top(page, 'COVER'));
		expect(tags).toBeLessThan(await top(page, 'FILE'));
		expect((await line(page).locator('.dt-all').textContent())!.split(' · ')).toContain('TAGS');
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
		const p = page.locator('.panel .about:visible p');
		const lines = () =>
			p.evaluate((n) =>
				Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight))
			);
		expect(await lines()).toBe(3);
		const more = page.locator('.panel .about:visible .more');
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
		await expect(page.locator('.panel .about:visible .more')).toHaveText('MORE ↓');
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

	test('no DETAILS line, and ABOUT and TAGS stand above the other rows (c837)', async ({
		page
	}) => {
		await openSeries(page, 'Tower of God');
		await expect(line(page)).toBeHidden();
		await expect(page.locator('.file-row')).toBeVisible();
		// The order (doc/SERIES.md, "The frame"): ABOUT, TAGS, DIRECTION, SHELVES,
		// LISTS, COVER, FILE.
		const order = ['ABOUT', 'TAGS', 'DIRECTION', 'SHELVES', 'LISTS', 'COVER', 'FILE'];
		const tops = [];
		for (const l of order) tops.push(await top(page, l));
		expect([...tops].sort((a, b) => a - b)).toEqual(tops);
		// ABOUT keeps its two lines here.
		const lines = await page
			.locator('.panel .about:visible p')
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

/**
 * c837: each TAGS line used to cut off with an ellipsis, and `+ N MORE` was
 * plain text. Every tag is read whole and opened, from the row where it stands
 * on this device: under FOLLOW where nothing folds, inside DETAILS on a phone.
 * Tags go in through the EDIT sheet, the owner's own door, on a world of its
 * own, in order: one series grows past the cap as the cases run.
 */
test.describe('every tag can be read and opened (c837)', () => {
	test.describe.configure({ mode: 'serial' });
	const LONG = 'a-tag-with-no-spaces-in-it-'.repeat(8) + 'end';
	/** With a series' own genre, five namespaces: each case takes its own series. */
	const PAST_THE_CAP = ['circle:b', 'artist:c', 'language:d', 'source:e', 'zzz:f'];
	let world: TagWorld;
	test.beforeAll(async ({ browser: _ }, info) => {
		void _;
		test.skip(info.project.name === 'tv', 'tv-tags.e2e.ts walks these with the pad');
		world = await startTagWorld(`series-details-${info.project.name}`);
	});
	test.afterAll(async () => {
		await world?.stop();
	});

	/**
	 * Types a tag and waits for its suggestions. A suggestion still on its way
	 * from the tag before can land on this one, ✓ ON THIS and disabled, and a
	 * form's first submit button being disabled swallows Enter (see the notes).
	 */
	const fillTag = async (page: Page, field: Locator, raw: string) => {
		const answered = page.waitForResponse((r) => r.url().includes('/tags?q='));
		await field.fill(raw);
		await answered;
	};
	const url = (id: number) => `${world.base}/series/${id}`;
	const row = (page: Page) =>
		page.locator('.panel .row:visible', { has: page.locator('.label', { hasText: /^TAGS$/ }) });
	const visit = async (page: Page, id: number) => {
		await page.goto(url(id));
		await page.waitForLoadState('networkidle');
		if (await line(page).isVisible()) await toggle(page, true);
		await expect(row(page)).toHaveCount(1);
	};
	const addTags = async (page: Page, raws: string[]) => {
		await row(page).getByRole('button', { name: 'EDIT', exact: true }).click();
		const sheet = page.getByRole('dialog', { name: 'Shelves and tags' });
		const field = sheet.getByRole('textbox', { name: 'Add a tag, as namespace:value' });
		for (const raw of raws) {
			await fillTag(page, field, raw);
			await field.press('Enter');
			await expect(field).toHaveValue('');
		}
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
	};
	const lines = (page: Page) => row(page).locator('.tag-line .ns');
	const clipped = (page: Page) =>
		row(page).evaluate((n) => {
			const out: string[] = [];
			for (const l of n.querySelectorAll<HTMLElement>('.tag-line')) {
				const v = l.querySelector<HTMLElement>('.vals')!;
				const box = v.getBoundingClientRect();
				// The text's own edge: a namespace too long for its box paints past it
				// and the box does not grow, so the box's edge would say nothing.
				const ns = l.querySelector<HTMLElement>('.ns')!;
				const text = document.createRange();
				text.selectNodeContents(ns);
				if (text.getBoundingClientRect().right > box.left)
					out.push(`${ns.textContent}: into its values`);
				if (v.scrollWidth > v.clientWidth + 1) out.push(`${v.textContent}: scrolls`);
				if (getComputedStyle(v).textOverflow === 'ellipsis') out.push(`${v.textContent}: ellipsis`);
				for (const a of v.querySelectorAll('a'))
					if (a.getBoundingClientRect().right > box.right + 1) out.push(`${a.textContent}: past`);
			}
			return out;
		});

	test('exactly four namespaces: four lines whole, and nothing to open', async ({ page }) => {
		await visit(page, world.ids.edited);
		await addTags(page, ['artist:Ren', 'language:japanese', 'source:scanned']);
		await expect(lines(page)).toHaveText(['genre', 'artist', 'language', 'source']);
		await expect(row(page).locator('button.more')).toHaveCount(0);
		expect(await clipped(page)).toEqual([]);
	});

	test('past four: + N MORE ↓ opens the rest, each one a tag that opens, and LESS ↑ folds it', async ({
		page
	}) => {
		await visit(page, world.ids.tagged);
		await addTags(page, [
			'language:japanese',
			'source:scanned',
			'zzz:first value',
			'zzz:second value'
		]);
		await expect(lines(page)).toHaveText(['genre', 'artist', 'language', 'source']);
		const more = row(page).locator('button.more');
		// slice of life (tag) and the two zzz: values, not namespaces, are what it counts.
		await expect(more).toHaveText('+ 3 MORE ↓');
		await expect(more).toHaveAttribute('aria-expanded', 'false');
		await expect(row(page).getByRole('link', { name: 'second value' })).toHaveCount(0);

		await more.click();
		await expect(more).toHaveText('LESS ↑');
		await expect(more).toHaveAttribute('aria-expanded', 'true');
		await expect(lines(page)).toHaveText(['genre', 'artist', 'language', 'source', 'tag', 'zzz']);
		expect(await clipped(page)).toEqual([]);
		// A value past the cap opens as any other does: this series has a source, so it asks.
		await row(page).getByRole('link', { name: 'second value' }).click();
		const sheet = page.getByRole('dialog', { name: 'Look for second value' });
		await expect(sheet).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
		await expect(more).toHaveText('LESS ↑');

		await more.click();
		await expect(more).toHaveText('+ 3 MORE ↓');
		await expect(row(page).getByRole('link', { name: 'second value' })).toHaveCount(0);
	});

	test('a value in the row is its own box, and + N MORE ↓ sits under the values', async ({
		page
	}) => {
		await visit(page, world.ids.missing);
		await addTags(page, [...PAST_THE_CAP, 'genre:Second Genre']);
		const box = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!;
		const more = await box(row(page).locator('button.more'));
		const vals = await box(row(page).locator('.vals').first());
		expect(Math.abs(more.x - vals.x)).toBeLessThanOrEqual(1);
		// Each dot follows its own value on that value's line: no line starts on one.
		const dots = await row(page).evaluate((n) =>
			[...n.querySelectorAll<HTMLElement>('.val')]
				.filter((v) => v.querySelector('.sep'))
				.map((v) => {
					const a = v.querySelector('a')!.getBoundingClientRect();
					const d = v.querySelector('.sep')!.getBoundingClientRect();
					return { after: d.left >= a.right - 1, on: d.top < a.bottom && d.bottom > a.top };
				})
		);
		expect(dots.length).toBeGreaterThan(0);
		expect(dots.every((d) => d.after && d.on)).toBe(true);
	});

	test('a tag from the first four opens from this device’s row, moved or folded', async ({
		page
	}) => {
		await visit(page, world.ids.tagged);
		await row(page).getByRole('link', { name: 'Gourmet', exact: true }).click();
		const sheet = page.getByRole('dialog', { name: 'Look for Gourmet' });
		await expect(sheet).toBeVisible();
		const lib = new URL(
			(await sheet.getByRole('link', { name: /IN THE LIBRARY/ }).getAttribute('href'))!,
			world.base
		);
		expect(lib.search).toBe('?tag=genre%3AGourmet');
	});

	test('a value longer than the row wraps inside it and pushes nothing', async ({ page }) => {
		await visit(page, world.ids.gallery);
		await addTags(page, [`genre:${LONG}`]);
		const value = row(page).getByRole('link', { name: LONG, exact: true });
		await expect(value).toBeVisible();
		expect(await clipped(page)).toEqual([]);
		const height = (await value.boundingBox())!.height;
		const lineHeight = await value.evaluate((n) => parseFloat(getComputedStyle(n).lineHeight));
		expect(height).toBeGreaterThan(lineHeight * 1.5);
		const edit = (await row(page)
			.getByRole('button', { name: 'EDIT', exact: true })
			.boundingBox())!;
		const panel = (await page.locator('section.panel').boundingBox())!;
		expect(edit.x + edit.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			await page.evaluate(() => window.innerWidth)
		);
	});

	test('a long namespace wraps in its column, clear of its values, and a short one does not', async ({
		page
	}) => {
		await visit(page, world.ids.hentoid);
		await addTags(page, [
			'circle:b',
			'artist:c',
			'language:japanese',
			'source:e',
			'contributors:Someone',
			'a-namespace-far-longer-than-any-column:Else'
		]);
		// Past the cap, where only MORE reaches it: the namespaces outside the house's five.
		await row(page).locator('button.more').click();
		await expect(lines(page)).toHaveText([
			'genre',
			'circle',
			'artist',
			'language',
			'source',
			'a-namespace-far-longer-than-any-column',
			'contributors'
		]);
		await expect(row(page).getByRole('link', { name: 'Someone', exact: true })).toBeVisible();
		expect(await clipped(page)).toEqual([]);
		const shape = await row(page).evaluate((n) =>
			Object.fromEntries(
				[...n.querySelectorAll<HTMLElement>('.tag-line')].map((l) => {
					const ns = l.querySelector<HTMLElement>('.ns')!;
					const text = document.createRange();
					text.selectNodeContents(ns);
					return [
						ns.textContent!,
						{
							lines: text.getClientRects().length,
							vals: l.querySelector<HTMLElement>('.vals')!.getBoundingClientRect().left
						}
					];
				})
			)
		);
		expect(shape.contributors.lines).toBeGreaterThan(1);
		// The namespace the design draws on a phone's row (1A) stays one word.
		expect(shape.language.lines).toBe(1);
		// However long the namespace, the values keep one left edge.
		expect(new Set(Object.values(shape).map((l) => l.vals)).size).toBe(1);
	});

	test('no tags at all says NO TAGS', async ({ page }) => {
		await visit(page, world.ids.unsourced);
		await row(page).getByRole('button', { name: 'EDIT', exact: true }).click();
		const sheet = page.getByRole('dialog', { name: 'Shelves and tags' });
		await sheet.getByRole('button', { name: 'Remove genre:Romance' }).click();
		await expect(sheet.getByRole('button', { name: 'Remove genre:Romance' })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
		await expect(row(page).locator('.none')).toHaveText('NO TAGS');
		await expect(row(page).locator('button.more')).toHaveCount(0);
	});

	/**
	 * The card's "under REFRESH and FOLLOW". The shared seed has no series with a
	 * DOWNLOAD row, and a source's series only has a description if the source
	 * gave one when it was added (REFRESH writes none), so this adds one the way
	 * the owner does, from the source's preview.
	 */
	test('DOWNLOAD, with REFRESH and FOLLOW, stands above ABOUT and TAGS', async ({ page }) => {
		await visit(page, world.ids.tagged);
		test.skip(await line(page).isVisible(), 'the fold keeps ABOUT and TAGS where they stood');

		const box = async (l: Locator) => (await l.boundingBox())!;
		const expectUnderDownload = async (about: boolean) => {
			const download = page.locator('.panel .dl-row:visible');
			await expect(download).toBeVisible();
			// One line of the row or a line of its own under it, by the panel's width.
			const cells = page.locator('.panel .lcs:visible');
			const refresh = cells.getByRole('button', { name: 'REFRESH', exact: true });
			const follow = cells.getByRole('button', { name: 'FOLLOW', exact: true });
			await expect(refresh).toBeVisible();
			await expect(follow).toBeVisible();
			const boxes = [await box(download), await box(refresh), await box(follow)];
			const bottom = Math.max(...boxes.map((b) => b.y + b.height));
			const tags = await box(row(page));
			expect(bottom).toBeLessThanOrEqual(tags.y);
			const label = page.locator('.panel .label:visible', { hasText: /^ABOUT/ });
			if (!about) {
				await expect(label).toHaveCount(0);
				return;
			}
			await expect(label).toHaveCount(1);
			const aboutAt = await box(label);
			expect(bottom).toBeLessThanOrEqual(aboutAt.y);
			expect(aboutAt.y).toBeLessThan(tags.y);
		};
		await expectUnderDownload(false);

		await page.goto(
			`${world.base}/downloads/source/${previewId}?from=${encodeURIComponent(`/browse/${SOURCE.id}`)}`
		);
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /\+ ADD/ }).click();
		await expect(page).toHaveURL(/\/series\/\d+/);
		await expect(page.getByRole('heading', { name: 'Preview Me Tagged' })).toBeVisible();
		await page.waitForLoadState('networkidle');
		await expect(page.locator('.panel .about:visible p')).toHaveText('A preview with tags.');
		await expectUnderDownload(true);
	});

	test('MORE belongs to the series it was opened on, across a move on the same screen', async ({
		page
	}) => {
		await visit(page, world.ids.twice);
		await addTags(page, ['genre:a', 'circle:b', 'artist:c', 'language:d', 'source:e', 'zzz:f']);
		// source:e, the bare and the tag: Mecha, zzz:f: four values past the cap.
		await expect(row(page).locator('button.more')).toHaveText('+ 4 MORE ↓');
		await visit(page, world.ids.broken);
		await addTags(page, PAST_THE_CAP);
		await row(page).locator('button.more').click();
		await expect(row(page).locator('button.more')).toHaveText('LESS ↑');
		// The way SAME BOOK AS and MIGHT CONTINUE move: a link, and the same component.
		await page.evaluate((href) => {
			const a = Object.assign(document.createElement('a'), { href });
			document.body.append(a);
			a.click();
		}, `/series/${world.ids.twice}`);
		await expect(page.getByRole('heading', { name: 'Twice Tagged Mecha' })).toBeVisible();
		if (await line(page).isVisible()) await toggle(page, true);
		await expect(row(page).locator('button.more')).toHaveText('+ 4 MORE ↓');
		// And the first series still opens on a press, not left half-way.
		await row(page).locator('button.more').click();
		await expect(row(page).locator('button.more')).toHaveText('LESS ↑');
	});
});
