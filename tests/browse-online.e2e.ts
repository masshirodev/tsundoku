import { expect, test } from './fixtures';
import { engineDown, manhwaChapters, resetEngine, slowPageLists, SOURCES } from './browse-world';

/**
 * A manga read online (doc/READING-ONLINE.md, "Manga online"): from a source's
 * preview without ADD, its pages
 * straight from the fake engine's /image/ proxy and never kept; then, added,
 * its chapters read online from the series screen, ↓ downloading apart.
 */

test('a chapter opens online from the preview, a record keeps the place, the series reads online', async ({
	page
}) => {
	test.setTimeout(90_000);
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.locator('.grid .tile', { hasText: 'Open Source 1-4' }).click();
	await expect(page).toHaveURL(/\/downloads\/source\//);
	const preview = page.url();
	// Reading first, adding beside it.
	await expect(page.locator('.cta-go .cta')).toContainText('▶ READ CH. 1');
	await expect(page.locator('.cta-go .cta')).toContainText('ONLINE');
	await expect(page.getByRole('region', { name: 'Chapters' }).locator('.head')).toContainText(
		'3 · ALL ONLINE'
	);
	// The pages come from the source, through tsundoku, and are never kept:
	// the reader holds them in memory only, as blob: URLs.
	const first = page.waitForResponse((r) => /\/api\/entries\/\d+\/pages\/0\?/.test(r.url()));
	await page.locator('.cta-go .cta').click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	const img = page.locator('.stage .screen:not([aria-hidden]) img').first();
	await expect(img).toBeVisible({ timeout: 20_000 });
	await expect(img).toHaveAttribute('src', /^blob:/);
	const res = await first;
	expect(res.headers()['content-type']).toBe('image/png');
	expect(res.headers()['cache-control']).toBe('private, no-store');
	// Esc shows the controls (a click turns the page, as a mouse does).
	await page.keyboard.press('Escape');
	await expect(page.locator('header[aria-label="Reader"] .meta')).toContainText('ONLINE');
	// A record: + ADD where the rating and FAV are, and the meta line says so.
	await expect(page.locator('header[aria-label="Reader"] .meta')).toContainText('NOT IN LIBRARY');
	await expect(
		page.getByRole('banner', { name: 'Reader' }).getByRole('button', { name: '+ ADD' })
	).toBeVisible();

	// Back at the preview: a record, ▶ CONTINUE, and + ADD beside it.
	await page.goto(preview);
	await expect(page.locator('.row.record')).toContainText('Not in library · 0 of 3 read');
	await expect(page.locator('.cta-go .cta')).toContainText('▶ CONTINUE');

	// Added: the series screen reads each chapter online, and ↓ downloads apart.
	await page.getByRole('button', { name: /ADD TO LIBRARY/ }).click();
	await expect(page).toHaveURL(/\/series\/\d+/);
	// ← goes back to the source it was added from, not the library.
	const back = page.getByRole('banner', { name: 'Series' }).locator('a.back');
	await expect(back.locator('.back-label')).toHaveText('BROWSE');
	// Its pages too (?pages=), so the source's results come back as they were left.
	await expect(back).toHaveAttribute('href', new RegExp(`^/browse/${SOURCES.open.id}(\\?|$)`));
	const series = new URL(page.url()).pathname;
	const list = page.getByRole('region', { name: /Chapters/ });
	const row = list.locator('.entry', { hasText: 'Chapter 2' });
	await expect(row.locator('.status')).toContainText('ONLINE');
	await expect(row.getByRole('button', { name: 'Download Chapter 2' })).toHaveText('↓');
	await row.locator('.entry-btn').click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
		timeout: 20_000
	});

	// The source stops answering: a chapter not yet asked for waits on the
	// reader's interstitial page, says so, and opens once it answers again.
	const third = list.locator('.entry', { hasText: 'Chapter 3' });
	await page.goBack();
	await engineDown();
	try {
		await third.locator('.entry-btn').click();
		await expect(page.getByRole('status')).toContainText('SOURCES NOT ANSWERING', {
			timeout: 20_000
		});
	} finally {
		await resetEngine();
	}
	await page.getByRole('button', { name: 'TRY AGAIN' }).click();
	await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
		timeout: 20_000
	});

	// Opened again from BROWSE, an in-library series is its series, not a
	// preview again — and its ← still goes back to BROWSE.
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.locator('.grid .tile', { hasText: 'Open Source 1-4' }).click();
	await expect(page).toHaveURL(new RegExp(`${series}\\?from=`));
	await expect(back.locator('.back-label')).toHaveText('BROWSE');
	await back.click();
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCES.open.id}(\\?|$)`));
	// A from that isn't an in-app BROWSE or search is ignored: ← LIBRARY.
	for (const from of ['https://evil.example/browse/1', '//evil.example/browse/1', '/settings']) {
		await page.goto(`${series}?from=${encodeURIComponent(from)}`);
		await expect(back.locator('.back-label')).toHaveText('LIBRARY');
		await expect(back).toHaveAttribute('href', '/');
	}
});

/**
 * Tall pages: a source never says how big its pages are, and in a manga
 * page's box a manhwa's tall slice comes out a narrow column with black either
 * side, whatever the zoom. The box takes the image's own shape once it
 * arrives. The fake's second page
 * is 600 × 3000.
 */
test('a page read online takes its own shape once it arrives, paged and vertical', async ({
	page
}) => {
	test.setTimeout(90_000);
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.locator('.grid .tile', { hasText: 'Open Source 1-5' }).click();
	await page.locator('.cta-go .cta').click();
	await expect(page).toHaveURL(/\/read\/\d+/);

	const shapeOf = (box: import('@playwright/test').Locator) =>
		box.evaluate((el) => {
			const r = el.getBoundingClientRect();
			return { w: r.width, h: r.height };
		});

	// Paged: the second page's box is as tall as its image, five times its width.
	await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
		timeout: 20_000
	});
	await page.keyboard.press('ArrowLeft');
	const paged = page.locator('.stage .screen:not([aria-hidden]) .page[data-page="2"]');
	await expect(paged.locator('img')).toBeVisible({ timeout: 20_000 });
	await expect
		.poll(async () => {
			const s = await shapeOf(paged);
			return Math.round((s.h / s.w) * 10) / 10;
		})
		.toBe(5);

	// Vertical: every page as wide as the strip, the tall one included.
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: /R→L ·/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await sheet.getByRole('radio', { name: 'VERTICAL' }).click();
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	const strip = page.locator('.strip');
	await expect(strip).toBeVisible();
	// The chapter being read: the strip holds the next one too.
	const entry = new URL(page.url()).pathname.split('/').pop();
	const tall = strip.locator(`[data-role="page"][data-entry="${entry}"][data-index="1"] .page`);
	await tall.scrollIntoViewIfNeeded();
	await expect(tall.locator('img')).toBeVisible({ timeout: 20_000 });
	const width = (await shapeOf(strip)).w;
	await expect
		.poll(async () => {
			const s = await shapeOf(tall);
			return { full: Math.abs(s.w - width) < 1, ratio: Math.round((s.h / s.w) * 10) / 10 };
		})
		.toEqual({ full: true, ratio: 5 });
	// What's drawn fills the box: no column with black either side.
	const drawn = await tall.locator('img').evaluate((img) => {
		const i = img as HTMLImageElement;
		const r = i.getBoundingClientRect();
		return (i.naturalHeight / i.naturalWidth) * r.width <= r.height + 1;
	});
	expect(drawn).toBe(true);
});

/**
 * Reading on down the strip, a chapter read online crosses into the next
 * without anything moving on screen. Its data arrives in more than one step,
 * and the reader took the step for the chapter being left as a jump from the
 * controls: at each band the next chapter's first page snapped to the top of
 * the screen, mid-read (561 px here). Watched every frame: whatever page was
 * under the middle must move by about one wheel step, never more.
 */
test('the strip reads on across chapters read online, and nothing jumps at a band', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.locator('.grid .tile', { hasText: 'Open Source 1-5' }).click();
	await page.locator('.cta-go .cta').click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
		timeout: 20_000
	});
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: /R→L ·/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await sheet.getByRole('radio', { name: 'VERTICAL' }).click();
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('.strip')).toBeVisible();
	const first = new URL(page.url()).pathname;
	await page.evaluate(() => {
		const w = window as unknown as { jumps: string[] };
		w.jumps = [];
		let prev: { el: HTMLElement; top: number } | null = null;
		const frame = () => {
			const el =
				document
					.elementFromPoint(innerWidth / 2, innerHeight / 2)
					?.closest<HTMLElement>('[data-role]') ?? null;
			if (prev?.el.isConnected) {
				const moved = prev.el.getBoundingClientRect().top - prev.top;
				if (Math.abs(moved) > 150)
					w.jumps.push(
						`${Math.round(moved)}px: ${prev.el.dataset.entry}/${prev.el.dataset.index} at ${location.pathname}`
					);
			}
			prev = el ? { el, top: el.getBoundingClientRect().top } : null;
			requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
	});
	for (let i = 0; i < 160; i++) {
		await page.mouse.wheel(0, 80);
		await page.waitForTimeout(40);
	}
	await page.waitForTimeout(1500);
	// It read on into another chapter, and nothing on screen jumped.
	expect(new URL(page.url()).pathname).not.toBe(first);
	expect(await page.evaluate(() => (window as unknown as { jumps: string[] }).jumps)).toEqual([]);
});

/**
 * Turning back: a page read online is `no-store`, and a turn mounts a new
 * element for the page turned to, so the browser would ask the workstation,
 * and the workstation the source, for a page that had just been on screen; on
 * a bad connection the loading box stays. The reader holds the pages near the
 * one being read in memory
 * ($lib/reader/online-pages): forward and back again asks for each page once,
 * and a page drawn before is never drawn as its loading box again.
 */
test('turning back and forth on a chapter read online asks for each page once and never redraws its loading box', async ({
	page
}) => {
	test.setTimeout(90_000);
	const asked = new Map<string, number>();
	page.on('request', (r) => {
		const m = new URL(r.url()).pathname.match(/^\/api\/entries\/(\d+)\/pages\/(\d+)$/);
		if (m) asked.set(`${m[1]}/${m[2]}`, (asked.get(`${m[1]}/${m[2]}`) ?? 0) + 1);
	});
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.locator('.grid .tile', { hasText: 'Open Source 1-6' }).click();
	await page.locator('.cta-go .cta').click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	const entry = new URL(page.url()).pathname.split('/').pop()!;
	const main = (n: number) =>
		page.locator(`.stage .screen:not([aria-hidden]) .page[data-page="${n}"] img:not(.hidden)`);
	await expect(main(1)).toBeVisible({ timeout: 20_000 });
	// Online pages draw from the reader's own copy.
	await expect(main(1)).toHaveAttribute('src', /^blob:/);

	// Every frame from here: a page drawn once must never show its loading box again.
	await page.evaluate(() => {
		const w = window as unknown as { __flashes: string[] };
		w.__flashes = [];
		const drawn = new Set<string>();
		const look = () => {
			for (const p of document.querySelectorAll<HTMLElement>('.stage .screen .page')) {
				const n = p.dataset.page!;
				const img = p.querySelector('img');
				if (img && !img.classList.contains('hidden')) drawn.add(n);
				else if (drawn.has(n) && p.querySelector('.loading')) w.__flashes.push(`p. ${n}`);
			}
			requestAnimationFrame(look);
		};
		requestAnimationFrame(look);
	});
	// R→L: ← is forward.
	for (const [key, to] of [
		['ArrowLeft', 2],
		['ArrowRight', 1],
		['ArrowLeft', 2],
		['ArrowRight', 1]
	] as const) {
		await page.keyboard.press(key);
		await expect(main(to)).toBeVisible({ timeout: 20_000 });
		// Settled past the slide, so the next turn starts from rest.
		await page.waitForTimeout(400);
	}
	expect(
		await page.evaluate(() => (window as unknown as { __flashes: string[] }).__flashes)
	).toEqual([]);
	// Each page of the chapter was asked for once, however many turns reached it.
	const mine = [...asked].filter(([k]) => k.startsWith(`${entry}/`));
	expect(mine.length).toBeGreaterThanOrEqual(2);
	expect(mine.filter(([, n]) => n !== 1)).toEqual([]);
});

/**
 * Crossing chapters in the strip while a real site's pages arrive late and at
 * their own sizes (c1153). The owner, reading online in Firefox, finished a
 * chapter, went past its band, and the reader walked backwards through the
 * series by itself: CH. 28 opened, then 27, 26, 25, one a second, each near
 * its top (the reading log). Here each page image is held a while before it
 * comes, and the reader must never open a chapter it has already read past.
 * What did it: a chapter's data and its neighbour's pages landing together,
 * each keeping the place and both telling a Page Down glide the content had
 * moved, so the glide went twice as far back, to the top of the strip.
 */
test('the strip reads on across chapters whose pages arrive late, and never walks back by itself', async ({
	page
}) => {
	test.setTimeout(180_000);
	// A real site: each page comes when it comes.
	await page.route(/\/api\/entries\/\d+\/pages\/\d+/, async (route) => {
		await new Promise((r) => setTimeout(r, 300 + Math.random() * 1700));
		await route.continue();
	});
	const opens: number[] = [];
	page.on('request', (r) => {
		if (!r.url().endsWith('/api/reading') || r.method() !== 'POST') return;
		const b = JSON.parse(r.postData() ?? '{}') as { kind?: string; entryId?: number };
		if (b.kind === 'open' && b.entryId) opens.push(b.entryId);
	});
	await page.goto(`/browse/${SOURCES.open.id}`);
	await page.locator('.grid .tile', { hasText: 'Open Source 1-5' }).click();
	// From the first chapter, whatever an earlier spec read: READ resumes, and a
	// run that resumed at the last chapter had nothing to cross and passed.
	await page
		.locator('li.ch button.open', { has: page.locator('.num', { hasText: /^1$/ }) })
		.click();
	await expect(page).toHaveURL(/\/read\/\d+/);
	await expect(page.locator('.stage .screen:not([aria-hidden]) img').first()).toBeVisible({
		timeout: 20_000
	});
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: /R→L ·/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await sheet.getByRole('radio', { name: 'VERTICAL' }).click();
	await sheet.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('.strip')).toBeVisible();
	const entryNow = () => Number(new URL(page.url()).pathname.split('/').pop());
	const first = entryNow();
	// Page Down, as the owner read, until the reader has crossed into a later chapter twice.
	const visited = [first];
	for (let i = 0; i < 120 && visited.length < 3; i++) {
		await page.keyboard.press('PageDown');
		await page.waitForTimeout(250);
		const now = entryNow();
		if (now !== visited.at(-1)) visited.push(now);
	}
	// Then still: the pages still arriving must not carry the reader anywhere.
	await page.waitForTimeout(6000);
	const settled = entryNow();
	// Read forward only: each chapter opened once, in order, and it stayed put.
	expect(opens, `opened ${opens.join(' → ')}`).toEqual([...new Set(opens)]);
	expect(visited.length, 'read across two bands').toBe(3);
	expect(visited, `walked back: ${visited.join(' → ')}`).toEqual([...new Set(visited)]);
	expect(settled).toBe(visited.at(-1));
});

/**
 * c1158: a manhwa read online on a tablet over a slow link. The owner read
 * ch. 57 to its end, crossed into 58, scrolled back up into 57 and, two
 * seconds later, was at 57's first page; crossing into 58 again, the strip
 * walked back to 57 and 56 by itself (the library's reading log). Arriving in
 * 57 put 56 in above, a chapter of tall pages, and the scroll that keeps the
 * place under such a change was lost: a touch browser can drop a scroll set
 * by hand while a finger or a fling is moving the page. Here that browser is
 * the test's (`scrollBy` does nothing while the strip moves), and what lands
 * above the page being read must wait until the strip is still. The mode is
 * picked for the visit only: REMEMBER would open this world's series in the
 * strip for every later spec (browse-strip-guess's sheet is R→L's).
 */
test('on a slow source, what lands above the page being read waits for a still strip, and nothing walks back', async ({
	page
}) => {
	test.setTimeout(240_000);
	await manhwaChapters(25);
	await slowPageLists(3000);
	// Each page's image takes its time, as over Tailscale.
	await page.route(/\/api\/entries\/\d+\/pages\/\d+/, async (route) => {
		await new Promise((r) => setTimeout(r, 300 + Math.random() * 1700));
		await route.continue();
	});
	try {
		const entryNow = () => Number(new URL(page.url()).pathname.split('/').pop());
		// The third chapter, its neighbours either side, in the strip. Chosen for
		// this visit only: remembered, the series would open every later spec
		// of this world's in the strip.
		await page.goto(`/browse/${SOURCES.open.id}`);
		await page.locator('.grid .tile', { hasText: 'Open Source 1-5' }).click();
		await page
			.locator('li.ch button.open', { has: page.locator('.num', { hasText: /^3$/ }) })
			.click();
		await expect(page.locator('.stage')).toBeVisible({ timeout: 30_000 });
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: /R→L ·/ }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await sheet.getByRole('radio', { name: 'VERTICAL' }).click();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.strip')).toBeVisible({ timeout: 30_000 });
		const third = entryNow();
		// A touch browser's way: a scroll set by hand is dropped while the strip
		// is moving. And every entry the address names, from now on.
		await page.evaluate(() => {
			const w = window as unknown as { moving: boolean; dropped: number; names: string[] };
			w.moving = false;
			w.dropped = 0;
			w.names = [location.pathname];
			const by = window.scrollBy.bind(window);
			window.scrollBy = ((...args: Parameters<typeof window.scrollBy>) => {
				if (w.moving) return void (w.dropped += 1);
				by(...args);
			}) as typeof window.scrollBy;
			const frame = () => {
				if (w.names.at(-1) !== location.pathname) w.names.push(location.pathname);
				requestAnimationFrame(frame);
			};
			requestAnimationFrame(frame);
		});
		const setMoving = (on: boolean) =>
			page.evaluate((on) => ((window as unknown as { moving: boolean }).moving = on), on);
		/** Scrolls by the wheel for [ms], the strip moving all the while. */
		const move = async (dy: number, ms: number) => {
			await setMoving(true);
			for (const until = Date.now() + ms; Date.now() < until;) {
				await page.mouse.wheel(0, dy);
				await page.waitForTimeout(50);
			}
			await setMoving(false);
		};
		const middle = () =>
			page.evaluate(() => {
				const el = document
					.elementsFromPoint(innerWidth / 2, innerHeight / 2)
					.map((e) => e.closest<HTMLElement>('[data-entry][data-index]'))
					.find(Boolean);
				return el ? { entry: Number(el.dataset.entry), index: Number(el.dataset.index) } : null;
			});
		const pagesOf = (entry: number) =>
			page.locator(`.strip [data-entry="${entry}"][data-index]`).count();
		// The chapters either side on the strip, and still.
		await page.waitForTimeout(8000);
		expect(entryNow()).toBe(third);

		// Up into the second chapter, and on moving while the first lands above it.
		for (let i = 0; i < 60 && entryNow() === third; i++) await move(-60, 100);
		const second = entryNow();
		expect(second, 'crossed up into the chapter before').not.toBe(third);
		// On moving, gently, until the chapter above has landed: its page list
		// takes 3 s, and it must land while the strip moves, as the owner's did.
		const pagesAbove = () =>
			page.evaluate((second) => {
				const ids = [...document.querySelectorAll<HTMLElement>('.strip [data-entry]')].map((e) =>
					Number(e.dataset.entry)
				);
				const at = ids.indexOf(second);
				return ids.slice(0, at).length;
			}, second);
		for (let k = 0; k < 40 && (await pagesAbove()) === 0; k++) await move(-15, 300);
		await move(-15, 2000);
		await page.waitForTimeout(2000);
		const there = await middle();
		expect(there?.entry, 'still in the chapter scrolled up into').toBe(second);
		expect(there?.index ?? 0, 'near its end, not at its start').toBeGreaterThan(
			(await pagesOf(second)) - 5
		);

		// Down again, moving, across the band: forward only, and it stays.
		for (let i = 0; i < 80 && entryNow() === second; i++) await move(120, 100);
		await move(20, 4000);
		await page.waitForTimeout(4000);
		const names = await page.evaluate(() =>
			(window as unknown as { names: string[] }).names.map((p) => Number(p.split('/').pop()))
		);
		expect(names, `the address named ${names.join(' → ')}`).toEqual([third, second, third]);
		expect((await middle())?.entry).toBe(third);
	} finally {
		await resetEngine();
	}
});

/**
 * c1158, the owner's words: "the reader loads the next chapter while I scroll,
 * but after I pass the boundary I'm moved to the start with a reload, like
 * entering a new page". A chapter's page list read online is kept ten minutes
 * (15 s in this world, `TSUNDOKU_ONLINE_KEEP_MS`). He had read the chapter
 * before for longer than that, so crossing into the next one asked the source
 * again, and a crossing is a navigation: the reader waited by throwing itself
 * away for the waiting page, and a new reader opened the chapter at its start.
 */
test('crossing into a chapter whose page list went stale keeps the strip, and where it was', async ({
	page
}) => {
	test.setTimeout(240_000);
	await slowPageLists(3000);
	try {
		const entryNow = () => Number(new URL(page.url()).pathname.split('/').pop());
		await page.goto(`/browse/${SOURCES.open.id}`);
		await page.locator('.grid .tile', { hasText: 'Open Source 1-5' }).click();
		await page
			.locator('li.ch button.open', { has: page.locator('.num', { hasText: /^1$/ }) })
			.click();
		await expect(page.locator('.stage')).toBeVisible({ timeout: 30_000 });
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: /R→L ·/ }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await sheet.getByRole('radio', { name: 'VERTICAL' }).click();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.strip')).toBeVisible({ timeout: 30_000 });
		const first = entryNow();
		// The strip as it is, the waiting page if it ever shows, and every entry named.
		await page.evaluate(() => {
			const w = window as unknown as {
				strip: Element | null;
				lost: number;
				waited: number;
				names: string[];
			};
			w.strip = document.querySelector('.strip');
			w.lost = 0;
			w.waited = 0;
			w.names = [location.pathname];
			const frame = () => {
				if (document.querySelector('.strip') !== w.strip) w.lost += 1;
				if (document.querySelector('.inter[role="status"]')) w.waited += 1;
				if (w.names.at(-1) !== location.pathname) w.names.push(location.pathname);
				requestAnimationFrame(frame);
			};
			requestAnimationFrame(frame);
		});
		// Read on past the time the next chapter's list is kept.
		await page.waitForTimeout(17_000);
		// Down, across the band, into the second chapter: from its last page,
		// however long an earlier spec of this world left the chapter.
		await page
			.locator(`.strip [data-entry="${first}"][data-index]`)
			.last()
			.evaluate((el) => el.scrollIntoView({ block: 'start' }));
		await page.waitForTimeout(500);
		for (let i = 0; i < 120 && entryNow() === first; i++) {
			await page.mouse.wheel(0, 120);
			await page.waitForTimeout(60);
		}
		const second = entryNow();
		expect(second, 'crossed into the next chapter').not.toBe(first);
		// Its list comes from the source again, three seconds: nothing moves meanwhile.
		await page.waitForTimeout(6000);
		const seen = await page.evaluate(() => {
			const w = window as unknown as { lost: number; waited: number; names: string[] };
			return {
				lost: w.lost,
				waited: w.waited,
				names: w.names.map((p) => Number(p.split('/').pop()))
			};
		});
		expect(seen.waited, 'the waiting page took the screen').toBe(0);
		expect(seen.lost, 'the strip was thrown away and drawn again').toBe(0);
		expect(seen.names).toEqual([first, second]);
		const at = await page.evaluate(() => {
			const el = document
				.elementsFromPoint(innerWidth / 2, innerHeight / 2)
				.map((e) => e.closest<HTMLElement>('[data-entry][data-index]'))
				.find(Boolean);
			return el ? { entry: Number(el.dataset.entry), index: Number(el.dataset.index) } : null;
		});
		expect(at?.entry).toBe(second);
	} finally {
		await resetEngine();
	}
});
