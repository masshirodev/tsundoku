import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
	COLD,
	SOURCE,
	coldPreviewId,
	previewId,
	startTagWorld,
	type TagWorld
} from './helpers/tag-world';

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

/**
 * A thing at rest. A sheet rises for 240 ms and the fonts land after it, so a
 * tap aimed at once can be waited out as "not stable" while both keep moving
 * (`doc/TESTING.md`, "Measure a screen only once it has come to rest"). Ask
 * the element's own box until it holds still, then tap.
 */
async function atRest(page: Page, el: Locator) {
	await expect
		.poll(
			async () => {
				const a = await el.boundingBox();
				await page.waitForTimeout(100);
				const b = await el.boundingBox();
				return !!a && !!b && a.x === b.x && a.y === b.y && a.height === b.height;
			},
			{ message: 'the element holding still', timeout: 10_000 }
		)
		.toBe(true);
}

/** Turns a switch to `on` by tapping it, and waits for the save to answer. */
async function flip(page: Page, title: string, on: boolean) {
	await page.goto(url(settings));
	await page.waitForLoadState('networkidle');
	const sw = own(page, title).getByRole('switch');
	await expect(sw).toHaveAttribute('aria-checked', String(!on));
	await sw.click();
}

/**
 * A case's body and its cleanup, so a failed cleanup cannot hide the body's
 * (c649). A `try`/`finally` reports whichever threw last, so a cleanup that
 * failed over an already failed body replaced the body's own assertion with
 * its own (a `page.goto` timing out, `ok()` false). Here the body's failure is
 * kept and rethrown after the cleanup, and the cleanup's is thrown only when
 * the body passed; when both fail, the cleanup's is printed rather than lost.
 */
async function settle(body: () => Promise<void>, cleanup: () => Promise<void>): Promise<void> {
	let bodyFailed = false;
	let bodyError: unknown;
	try {
		await body();
	} catch (e) {
		bodyFailed = true;
		bodyError = e;
	}
	try {
		await cleanup();
	} catch (e) {
		if (!bodyFailed) throw e;
		console.error('the cleanup failed after the body:', e);
	}
	if (bodyFailed) throw bodyError;
}

test('every source’s settings page has tsundoku’s four switches, above the extension’s own', async ({
	page
}) => {
	await page.goto(url(settings));
	await expect(page.locator('form.own .t')).toHaveText([
		'Hidden source',
		'Added hidden',
		'Off history',
		'Never tracked'
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
	// Inside reveal the source is here, so the band names it and has no tail to
	// point at something hidden from this viewer (c605).
	await reveal(context, true);
	await page.goto(bandUrl);
	await expect(band).toContainText(`${SOURCE.name.toUpperCase()} ADDS ITS SERIES HIDDEN`);
	await expect(band).not.toContainText('REVEAL SHOWS');
	await reveal(context, false);
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

test('ADDED HIDDEN: the first ADD from a source with nothing else here leaves it mostly hidden, so the band and UNDO are on BROWSE, naming no source (c505)', async ({
	page,
	context
}) => {
	// About twenty navigations, two switch flips and two ADDs: 5.4-15.7 s alone,
	// and every copy of five ran out the 30 s once beside a build (c607).
	test.slow();
	// COLD has no series in this world: the ADD makes it 1 of 1 hidden, more
	// than half, so its own page is not found outside reveal (mostlyHidden).
	const coldSettings = `/browse/${COLD.id}/settings`;
	const coldPreview = `/downloads/source/${coldPreviewId}?from=${encodeURIComponent(`/browse/${COLD.id}`)}`;
	const flipCold = async (on: boolean) => {
		await page.goto(url(coldSettings));
		await page.waitForLoadState('networkidle');
		const sw = own(page, 'Added hidden').getByRole('switch');
		await expect(sw).toHaveAttribute('aria-checked', String(!on));
		await sw.click();
		await expect(own(page, 'Added hidden')).toHaveClass(/\bsaved\b/);
		await expect(sw).toHaveAttribute('aria-checked', String(on));
	};
	const band = page.locator('.band', { hasText: 'ADDED TO THE LIBRARY, AND HIDDEN' });
	// Every band the case lands on, so the cleanup can undo what is left.
	const landed: URLSearchParams[] = [];
	const addFromPreview = async () => {
		expect((await page.goto(url(coldPreview)))?.status()).toBe(200);
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /ADD TO LIBRARY/ }).click();
		await page.waitForURL((u) => u.searchParams.has('series'));
		landed.push(new URL(page.url()).searchParams);
		await expect(page).toHaveURL(/\/browse\?.*added=hidden/);
	};
	await reveal(context, false);
	await flipCold(true);
	await settle(
		async () => {
			await addFromPreview();
			const bandUrl = page.url();
			await expect(band).toContainText(
				/ITS SOURCE ADDS ITS SERIES HIDDEN · \d+ CHAPTERS? · NONE DOWNLOADED · THE SOURCE IS HIDDEN WITH IT · REVEAL SHOWS BOTH/
			);
			await expect(band.getByRole('button', { name: 'UNDO' })).toBeVisible();
			// Hidden means not named: the source is on no line of the page.
			await expect(page.locator('body')).not.toContainText(COLD.name);
			await expect(page.locator('body')).not.toContainText(COLD.name.toUpperCase());
			// Its own page is what round 1 landed on, and it is not found.
			expect((await page.goto(url(`/browse/${COLD.id}`)))?.status()).toBe(404);
			// The band is its URL: a load of it is a page, with the band and UNDO.
			expect((await page.goto(bandUrl))?.status()).toBe(200);
			await expect(band.getByRole('button', { name: 'UNDO' })).toBeVisible();
			// UNDO: out of the library, the source found again, and the preview opens.
			await band.getByRole('button', { name: 'UNDO' }).click();
			await expect(page).toHaveURL(new RegExp(`/downloads/source/${coldPreviewId}`));
			await expect(page.getByRole('button', { name: /ADD TO LIBRARY/ })).toBeVisible();
			expect((await page.goto(url(`/browse/${COLD.id}`)))?.status()).toBe(200);
			// The band's URL after UNDO says nothing; UNDO twice undoes nothing and lands the same.
			await page.goto(bandUrl);
			await expect(page.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })).toHaveCount(0);
			const params = new URL(bandUrl).searchParams;
			const form = { series: params.get('series')!, preview: params.get('preview')! };
			// Posted as a form without script is: a 303, whose location is where it lands.
			const post = (path: string, f: Record<string, string>) =>
				page.request.post(url(path), {
					form: f,
					headers: { origin: world.base, accept: 'text/html' },
					maxRedirects: 0
				});
			const twice = await post('/browse?/undoAdd', form);
			expect(twice.status()).toBe(303);
			expect(twice.headers().location).toBe(`/downloads/source/${coldPreviewId}`);

			// The source page's own UNDO, posted on a band while the source is hidden
			// (drawn there, then the source hidden from another tab): it undoes, and
			// is not a 404.
			await addFromPreview();
			const again = new URL(page.url()).searchParams;
			expect((await page.goto(url(`/browse/${COLD.id}`)))?.status()).toBe(404);
			const fromSourcePage = await post(`/browse/${COLD.id}?/undoAdd`, {
				series: again.get('series')!,
				preview: again.get('preview')!
			});
			expect(fromSourcePage.status()).toBe(303);
			expect(fromSourcePage.headers().location).toBe(`/downloads/source/${coldPreviewId}`);
			await page.goto(url(`/browse?${again}`));
			await expect(page.locator('.band', { hasText: 'ADDED TO THE LIBRARY' })).toHaveCount(0);
			expect((await page.goto(url(`/browse/${COLD.id}`)))?.status()).toBe(200);
		},
		async () => {
			// Put back: nothing of COLD's left in the library, and its switch off,
			// inside reveal, where its settings page is found whatever is hidden.
			for (const p of landed)
				await page.request.post(url('/browse?/undoAdd'), {
					form: { series: p.get('series')!, preview: p.get('preview')! },
					headers: { origin: world.base }
				});
			await reveal(context, true);
			await flipCold(false);
			await reveal(context, false);
		}
	);
});

/**
 * A source's ADDED HIDDEN switch, on and off, read back from the server's own
 * answer: the tag world's third source, whose page is not found outside reveal
 * while it is mostly hidden.
 */
async function flipAddedHidden(page: Page, id: string, on: boolean) {
	await page.goto(url(`/browse/${id}/settings`));
	await page.waitForLoadState('networkidle');
	const sw = own(page, 'Added hidden').getByRole('switch');
	await expect(sw).toHaveAttribute('aria-checked', String(!on));
	await sw.click();
	await expect(own(page, 'Added hidden')).toHaveClass(/\bsaved\b/);
	await expect(sw).toHaveAttribute('aria-checked', String(on));
}

/**
 * The two doors a person without script walks (c605, c606). Nothing the doors
 * themselves need is a handler: the refused UNDO, CONCEAL's question and its
 * band are each a form or a link, so the browser posts them and the server
 * answers with the page, which is what a phone with its scripts off gets.
 */
test.describe('without script', () => {
	test.use({ javaScriptEnabled: false });

	test('a refused UNDO says why in the band, and inside reveal the band names the source (c605)', async ({
		page,
		context,
		browser
	}) => {
		const coldPreview = `/downloads/source/${coldPreviewId}?from=${encodeURIComponent(`/browse/${COLD.id}`)}`;
		const band = page.locator('.band', { hasText: 'ADDED TO THE LIBRARY, AND HIDDEN' });
		const mark = (series: number, entry: number, read: boolean) =>
			page.request.post(url(`/series/${series}?/mark`), {
				form: { read: read ? '1' : '0', entry: String(entry) },
				headers: { origin: world.base }
			});
		await reveal(context, false);
		await flipAddedHidden(page, COLD.id, true);
		await settle(
			async () => {
				// The preview's ADD is a promise in its data, so a browser without
				// script never draws its button; the ADD is the state this case needs,
				// not the door it walks, so it is made with script. COLD has nothing
				// else here, so it lands on BROWSE, with the band.
				const setup = await browser.newContext({
					javaScriptEnabled: true,
					storageState: await context.storageState()
				});
				const sp = await setup.newPage();
				await sp.goto(url(coldPreview));
				await sp.getByRole('button', { name: /ADD TO LIBRARY/ }).click();
				await expect(sp).toHaveURL(/\/browse\?.*added=hidden/);
				const bandUrl = sp.url();
				const series = Number(new URL(bandUrl).searchParams.get('series'));
				expect(series).toBeGreaterThan(0);
				// The entry to mark read, off the series screen: with no script the
				// screen draws no reader link at all, so this too is asked of a page
				// with script. The series is hidden, so reveal lets its page be found.
				await reveal(setup, true);
				await sp.goto(url(`/series/${series}`));
				const entry = Number(
					/\/read\/(\d+)/.exec(
						(await sp.locator('a[href^="/read/"]').first().getAttribute('href'))!
					)![1]
				);
				expect(entry).toBeGreaterThan(0);
				await setup.close();

				// Everything below is the browser with no script.
				await page.goto(bandUrl);
				await expect(band).toContainText('· REVEAL SHOWS BOTH');
				await expect(band.getByRole('button', { name: 'UNDO' })).toBeVisible();

				// Inside reveal the source is here: the band names it, and points at
				// nothing hidden from this viewer (c605's third part).
				await reveal(context, true);
				await page.goto(bandUrl);
				await expect(band).toContainText(`${COLD.name.toUpperCase()} ADDS ITS SERIES HIDDEN`);
				await expect(band).not.toContainText('REVEAL SHOWS');

				// Drawn untouched while the series is unread, so its UNDO is there to
				// tap; read now, and the tap is refused. The page it answers with is
				// the band again, saying why -- where a post to a bare `?/undoAdd`
				// loaded `/browse` with no band and said nothing at all.
				await page.goto(bandUrl);
				await expect(band.getByRole('button', { name: 'UNDO' })).toBeVisible();
				expect((await mark(series, entry, true)).ok()).toBe(true);
				await reveal(context, false);
				const [answer] = await Promise.all([
					page.waitForResponse((r) => r.url().includes('/browse?/undoAdd')),
					band.getByRole('button', { name: 'UNDO' }).click()
				]);
				expect(answer.status()).toBe(409);
				await expect(band).toContainText('NO UNDO: SOMETHING OF IT IS DOWNLOADED OR READ NOW');
				await expect(band.getByRole('button', { name: 'UNDO' })).toHaveCount(0);
				expect(new URL(page.url()).searchParams.get('series')).toBe(String(series));

				// Put back: unread, UNDO, and the switch off (the finally reaches the
				// switch even when a step above went red).
				await reveal(context, true);
				expect((await mark(series, entry, false)).ok()).toBe(true);
				await page.goto(bandUrl);
				await band.getByRole('button', { name: 'UNDO' }).click();
				await expect(page).toHaveURL(new RegExp(`/downloads/source/${coldPreviewId}`));
			},
			async () => {
				await reveal(context, true);
				await page.request.post(url(`/browse/${COLD.id}/settings?/flag`), {
					form: { flag: 'addedHidden', value: 'false' },
					headers: { origin: world.base }
				});
				await reveal(context, false);
			}
		);
	});

	test('a refused UNDO on a source page the ADDs have mostly hidden lands on BROWSE and says why (c605)', async ({
		page,
		context,
		browser
	}) => {
		// Five ADDs, a read and a no-script tap: the slow budget, as the other
		// many-navigation case in this file asks for.
		test.slow();
		// A preview of any manga this world's fake answers: the same fake source
		// answers getDetailsManga for every url, so each ADD is a series of its own.
		const idOf = (manga: string) => `${SOURCE.id}~${Buffer.from(manga).toString('base64url')}`;
		const previewOf = (manga: string) =>
			`/downloads/source/${idOf(manga)}?from=${encodeURIComponent(`/browse/${SOURCE.id}`)}`;
		const band = page.locator('.band', { hasText: 'ADDED TO THE LIBRARY, AND HIDDEN' });
		const mark = (series: number, entry: number, read: boolean) =>
			page.request.post(url(`/series/${series}?/mark`), {
				form: { read: read ? '1' : '0', entry: String(entry) },
				headers: { origin: world.base }
			});
		// Every ADD this case makes, so the cleanup can undo it; and the one it
		// reads, so the cleanup can unread it first.
		const added: URLSearchParams[] = [];
		let series = 0;
		let entry = 0;
		await reveal(context, false);
		await flipAddedHidden(page, SOURCE.id, true);
		await settle(
			async () => {
				// The preview's ADD is a promise in its data, so a browser without
				// script never draws its button; the ADDs and the read are the state
				// this case needs, so they are made with script, as the case above does.
				const setup = await browser.newContext({
					javaScriptEnabled: true,
					storageState: await context.storageState()
				});
				const sp = await setup.newPage();
				const add = async (manga: string) => {
					expect((await sp.goto(url(previewOf(manga))))?.status()).toBe(200);
					await sp.getByRole('button', { name: /ADD TO LIBRARY/ }).click();
					await sp.waitForURL((u) => u.searchParams.has('series'));
					const at = new URL(sp.url());
					added.push(at.searchParams);
					return at;
				};
				// SOURCE has four shown series here, and the first ADD leaves one of
				// five hidden: more shown than hidden, so the band is drawn on the
				// source's own page, where a person without script can read it.
				const first = await add('/manga/preview-me');
				expect(first.pathname).toBe(`/browse/${SOURCE.id}`);
				series = Number(first.searchParams.get('series'));
				expect(series).toBeGreaterThan(0);
				await page.goto(first.href);
				await expect(band.getByRole('button', { name: 'UNDO' })).toBeVisible();

				// Four more ADDs from the same source, through the app's own door,
				// make it five hidden of nine: mostly hidden, so its own page is not
				// found outside reveal any more (the page above was drawn before).
				for (const manga of ['/manga/two', '/manga/three', '/manga/four', '/manga/five'])
					await add(manga);
				expect((await sp.goto(url(`/browse/${SOURCE.id}`)))?.status()).toBe(404);

				// A chapter read meanwhile: UNDO would be refused. The entry is asked
				// of the series screen with script and reveal on, as above.
				await reveal(setup, true);
				await sp.goto(url(`/series/${series}`));
				entry = Number(
					/\/read\/(\d+)/.exec(
						(await sp.locator('a[href^="/read/"]').first().getAttribute('href'))!
					)![1]
				);
				expect(entry).toBeGreaterThan(0);
				await setup.close();
				await reveal(context, true);
				expect((await mark(series, entry, true)).ok()).toBe(true);
				await reveal(context, false);

				// The tap, on the page drawn before the source went hidden: the
				// source page's action is refused, and that page cannot draw the
				// answer (its load 404s), so the refusal lands on BROWSE's band --
				// where a bare post used to land on a "not found" page (c605).
				const [answer] = await Promise.all([
					page.waitForResponse((r) => r.url().includes(`/browse/${SOURCE.id}?/undoAdd`)),
					band.getByRole('button', { name: 'UNDO' }).click()
				]);
				expect(answer.status()).toBe(303);
				await expect(page).toHaveURL(/\/browse\?.*refused=409/);
				await expect(band).toContainText('NO UNDO: SOMETHING OF IT IS DOWNLOADED OR READ NOW');
				await expect(band.getByRole('button', { name: 'UNDO' })).toHaveCount(0);
				// The refusal undid nothing: the series is still here.
				await reveal(context, true);
				expect((await page.request.get(url(`/series/${series}`))).status()).toBe(200);
				await reveal(context, false);
			},
			async () => {
				// Put back: unread, every ADD undone, and the switch off (reveal on,
				// where the hidden source's settings page is found).
				await reveal(context, true);
				if (entry) await mark(series, entry, false);
				for (const p of added)
					await page.request.post(url('/browse?/undoAdd'), {
						form: { series: p.get('series')!, preview: p.get('preview')! },
						headers: { origin: world.base }
					});
				await page.request.post(url(`/browse/${SOURCE.id}/settings?/flag`), {
					form: { flag: 'addedHidden', value: 'false' },
					headers: { origin: world.base }
				});
				await reveal(context, false);
			}
		);
	});

	test('CONCEAL asks through ?ask=conceal and its band draws, both without a handler (c606)', async ({
		page,
		context
	}) => {
		await reveal(context, false);
		await page.goto(url(`${settings}?ask=conceal`));
		const cell = page.locator('.own-act');
		const ownCount = Number(
			/Hides the (\d+) series here/.exec((await cell.locator('.s').textContent())!)![1]
		);
		expect(await cell.locator('.s').textContent()).not.toContain('more from other sources');
		const total = ownCount;
		expect(total).toBeGreaterThan(1);
		const sheet = page.getByRole('dialog', { name: `CONCEAL ${total} SERIES?` });
		await expect(sheet).toBeVisible();
		// Confirmed natively: the settings page answers with the band, which
		// outside reveal is on BROWSE (the source is mostly hidden now).
		const go = sheet.getByRole('button', { name: `CONCEAL ${total} SERIES` });
		await atRest(page, go);
		await go.click();
		await expect(page).toHaveURL(/\/browse\?.*concealed=/);
		const band = page.locator('.band', { hasText: 'SERIES HIDDEN NOW' });
		await expect(band).toContainText(`${total} SERIES HIDDEN NOW`);
		// UNDO the same way, so the world is as this case found it.
		await band.getByRole('button', { name: 'UNDO' }).click();
		await expect(page).toHaveURL(url('/browse'));
		await expect(band).toHaveCount(0);
	});
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

test('NEVER TRACKED: the source stays listed and searchable, and the series screen’s LISTS row says why nothing is sent (c522)', async ({
	page
}) => {
	// `tagged` is this world's series from the source (`mihon:100:/manga/tagged`).
	const series = world.ids.tagged;
	await settle(
		async () => {
			await flip(page, 'Never tracked', true);
			// It is not HIDDEN SOURCE: the source and its page are still found outside reveal.
			expect((await page.goto(url(`/browse/${SOURCE.id}`)))?.status()).toBe(200);

			// The LISTS row: one line (AniList's, unlinked here), the reason in its
			// place of a send, the strip saying it once, and no send cell to press.
			await page.goto(url(`/series/${series}`));
			const row = page.locator('[data-row="lists"]');
			await expect(row.locator('.note')).toHaveText('NOTHING SENT · NEVER TRACKED');
			await expect(row.locator('.lw .s .l')).toHaveText([
				'NOTHING SENT · ITS SOURCE IS NEVER TRACKED'
			]);
			await expect(row.getByRole('button', { name: 'EDIT' })).toHaveCount(0);
			await expect(row.getByRole('button', { name: 'TRY AGAIN' })).toHaveCount(0);
			await expect(row.getByRole('link', { name: 'SIGN IN →' })).toHaveCount(0);
			// A search is an ask, not a send, so FIND is still offered.
			await expect(row.getByRole('link', { name: 'FIND' })).toBeVisible();
		},
		async () => {
			await flip(page, 'Never tracked', false);
		}
	);
});

test('CONCEAL ITS SERIES hides what the source shows, a Work whole, says so, and UNDO brings back only that (c523)', async ({
	page,
	context
}) => {
	const post = (path: string, form: Record<string, string | string[]>) => {
		const body = new URLSearchParams();
		for (const [k, v] of Object.entries(form))
			for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
		return page.request.post(url(path), {
			data: body.toString(),
			headers: { origin: world.base, 'content-type': 'application/x-www-form-urlencoded' }
		});
	};
	const found = async (id: number) => (await page.request.get(url(`/series/${id}`))).status();
	const { twice, hentoid, gallery, tagged } = world.ids;
	// A Work across sources, by the library's own GROUP: a part from this
	// source and a Hentoid gallery, from none.
	const made = await post('/?/work', {
		series: [String(twice), String(hentoid)],
		name: 'Concealed Across'
	});
	expect(made.ok()).toBe(true);
	// Its id, from the series screen's link to it.
	const workId = Number(
		/\/work\/(\d+)/.exec(await (await page.request.get(url(`/series/${twice}`))).text())![1]
	);
	// One of the source's series hidden before, for its own reasons.
	expect((await post('/?/hide', { id: String(gallery), on: '1' })).ok()).toBe(true);
	const cell = page.locator('.own-act');
	await settle(
		async () => {
			// Inside reveal: the page stays, and the band is on it.
			await reveal(context, true);
			await page.goto(url(settings));
			await expect(cell.locator('.t')).toHaveText('Conceal its series');
			// Its own words: no HIDE control, and HIDDEN SOURCE's row is still the one switch so named.
			// (Reveal's own banner has HIDE AGAIN; the rows have none.)
			const rows = page.locator('form.own, .own-act');
			await expect(rows.getByRole('button', { name: 'HIDE' })).toHaveCount(0);
			await expect(rows.getByRole('link', { name: 'HIDE' })).toHaveCount(0);
			await expect(own(page, 'Hidden source')).toHaveCount(1);
			await expect(cell.locator('.s')).toContainText(
				'and 1 more from other sources: the parts of their Work, since a Work is hidden whole.'
			);
			const ownCount = Number(
				/Hides the (\d+) series here/.exec((await cell.locator('.s').textContent())!)![1]
			);
			expect(
				ownCount,
				'the source’s shown series, the hidden one not among them'
			).toBeGreaterThanOrEqual(2);
			const total = ownCount + 1;
			await cell.getByRole('link', { name: `CONCEAL ${total}` }).click();
			const sheet = page.getByRole('dialog', { name: `CONCEAL ${total} SERIES?` });
			await expect(sheet).toContainText(`${ownCount} FROM TAG SOURCE ARE HIDDEN NOW.`);
			await expect(sheet).toContainText('1 MORE GO WITH THEM');
			await sheet.getByRole('button', { name: `CONCEAL ${total} SERIES` }).click();
			await expect(page).toHaveURL(/\/settings\?.*concealed=/);
			const band = page.locator('.band', { hasText: 'SERIES HIDDEN NOW' });
			await expect(band).toContainText(`${total} SERIES HIDDEN NOW`);
			await expect(band).toContainText(
				`${ownCount} FROM TAG SOURCE · 1 MORE: PARTS OF THEIR WORK, HIDDEN WHOLE · REVEAL SHOWS THEM`
			);
			// Nothing of it is shown now: the cell is disabled, and a press anyway is refused.
			await expect(cell.getByRole('button', { name: 'CONCEAL' })).toBeDisabled();
			const again = await page.request.post(url(`${settings}?/conceal`), {
				form: {},
				headers: { origin: world.base, accept: 'text/html' }
			});
			expect(again.status()).toBe(409);
			expect(await again.text()).toContain('NOTHING FROM IT IS SHOWN');
			// The band is its URL: a reload says the same.
			const bandUrl = page.url();
			await page.reload();
			await expect(band).toContainText(`${total} SERIES HIDDEN NOW`);
			// Hidden: outside reveal the series, the Work's other part and the source are not found.
			await reveal(context, false);
			for (const id of [tagged, twice, hentoid]) expect(await found(id), `series ${id}`).toBe(404);
			expect((await page.request.get(url(settings))).status()).toBe(404);
			await reveal(context, true);

			// UNDO: what it hid comes back; the one hidden before stays hidden.
			await page.goto(bandUrl);
			await band.getByRole('button', { name: 'UNDO' }).click();
			await expect(page).toHaveURL(url(settings));
			await expect(band).toHaveCount(0);
			await reveal(context, false);
			for (const id of [tagged, twice, hentoid]) expect(await found(id), `series ${id}`).toBe(200);
			expect(await found(gallery)).toBe(404);
			// The band's URL after UNDO says nothing; UNDO twice shows nothing more.
			await reveal(context, true);
			await page.goto(bandUrl);
			await expect(band).toHaveCount(0);
			const params = new URL(bandUrl).searchParams;
			expect(
				(
					await post(`${settings}?/undoConceal`, {
						concealed: params.get('concealed')!,
						of: params.get('of')!
					})
				).ok()
			).toBe(true);
			await reveal(context, false);
			expect(await found(gallery)).toBe(404);

			// Outside reveal: the source is mostly hidden after, so CONCEAL lands on
			// BROWSE, whose band names no source, and UNDO there brings it back.
			await page.goto(url(settings));
			await cell.getByRole('link', { name: `CONCEAL ${total}` }).click();
			await page
				.getByRole('dialog', { name: `CONCEAL ${total} SERIES?` })
				.getByRole('button', { name: `CONCEAL ${total} SERIES` })
				.click();
			await expect(page).toHaveURL(/\/browse\?.*concealed=/);
			await expect(band).toContainText(
				`${ownCount} FROM ITS SOURCE · 1 MORE: PARTS OF THEIR WORK, HIDDEN WHOLE · THE SOURCE IS HIDDEN WITH THEM · REVEAL SHOWS BOTH`
			);
			await expect(page.locator('body')).not.toContainText(SOURCE.name.toUpperCase());
			await expect(page.locator('a.row', { hasText: SOURCE.name })).toHaveCount(0);
			await page.reload();
			await band.getByRole('button', { name: 'UNDO' }).click();
			await expect(page).toHaveURL(url('/browse'));
			await expect(band).toHaveCount(0);
			await expect(page.locator('a.row', { hasText: SOURCE.name }).first()).toBeVisible();
			for (const id of [tagged, twice, hentoid]) expect(await found(id), `series ${id}`).toBe(200);
			expect(await found(gallery)).toBe(404);
		},
		async () => {
			// Put back what the case made: the hidden series shown, the Work ended.
			await reveal(context, true);
			await post('/?/hide', { id: String(gallery), on: '0' });
			// c583: every Work door wants the Work's own moment (`made`), or the
			// writer refuses as stale; read it off the screen the way the owner's
			// form carries it, and assert the cleanup landed.
			if (workId) {
				const made = await page
					.goto(url(`/work/${workId}`))
					.then(() => page.locator('input[name="made"]').first().inputValue());
				expect((await post(`/work/${workId}?/ungroup`, { made })).ok()).toBe(true);
			}
			await reveal(context, false);
		}
	);
});
