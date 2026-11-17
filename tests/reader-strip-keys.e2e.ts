import { expect, readerReady, test } from './fixtures';

/**
 * The vertical strip's ← and → (doc/READER.md, "Scrolling on a PC"):
 * they nudge like Ctrl + ↑ / ↓, follow the mode rather than the kind, keep
 * panning sideways while the strip is zoomed wider than the screen, and a
 * paged reader still turns on them. Also a held ↓: its repeats scroll
 * steadily rather than stacking steps, from rest up to its full speed,
 * and every door that can take the keyup away ends it. Runs on every device because the keys are the same on each and
 * the strip's width is not. Read-only: it reads in incognito, so nothing is
 * written to the shared database, and it reads the series reader-layout reads
 * (Sousou no Frieren), switched to the strip from READING, whose mode is
 * session state that only REMEMBER stores.
 */

// 60 s, measured: each case opens the reader cold and switches
// to the strip before its first key, and at a load of 35-50 (four burners
// beside the slots, phone, `--repeat-each=10 --workers=4`) the passing copies
// took 11-27 s of the 30 s; at 41-58, 6 of 80 copies ran the 30 s out in
// `open()` or `toStrip()`'s menu steps, each waiting on the right state.
test.describe.configure({ timeout: 60_000 });

test.beforeEach(async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
});

async function open(page: import('@playwright/test').Page) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: 'Sousou no Frieren' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page.waitForLoadState('networkidle');
	await page.getByRole('link', { name: /▶/ }).first().click();
	await readerReady(page);
	await page.waitForLoadState('networkidle');
}

/**
 * The strip's scroll, less what keeping its place added since `toStrip` began.
 * Once `toStrip` has settled it is read off one page slot instead (`ref`, the
 * one under the middle then): how far that slot's top has gone up the screen.
 * `kept` counts only the app's own place-keeping, and under load the browser's
 * scroll anchoring moved `scrollY` by thousands of pixels as images above came
 * in, with no event (4864 px on tablet-portrait, 10504 on the phone, wave 23's
 * loaded whole run; c439). A nudge moves the slot by its 100 px whatever
 * arrives above it. If that slot leaves the strip, `place()` throws rather
 * than switch measures mid-case.
 */
const place = (page: import('@playwright/test').Page) =>
	page.evaluate(() => {
		const w = window as unknown as { kept?: number; ref?: Element };
		if (!w.ref) return Math.round(scrollY - (w.kept ?? 0));
		// Never fall back to the scroll once the slot is the measure: a start read
		// off the slot against a scroll read now differs by thousands of pixels,
		// which reads as a wrong nudge rather than as what it is.
		if (!w.ref.isConnected) throw new Error('place(): the reference page slot left the strip');
		return Math.round(-w.ref.getBoundingClientRect().top);
	});

const pageParam = (page: import('@playwright/test').Page) =>
	Number(new URL(page.url()).searchParams.get('p') ?? '0');

/** The strip, from READING (session state): the controls come and go by Escape. */
async function toStrip(page: import('@playwright/test').Page) {
	await page.keyboard.press('Escape');
	await page.locator('footer[aria-label="Reader controls"] .cell.grow').click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	const vertical = sheet.getByRole('radio', { name: 'VERTICAL' });
	await vertical.click();
	await expect(vertical).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await expect(page.locator('.reader')).toHaveClass(/vertical/);
	// The mouse off the window's edge before the controls go, as a reader's
	// would be: the reader shows them for a mouse within HOVER_EDGE of an edge
	// (ImageReader's `hover`), and the clicks above left it on the bottom bar,
	// where any pointermove brings them back after Escape (forced in wave 24;
	// Chromium also sends one when the page moves under a still cursor).
	const vp = page.viewportSize()!;
	await page.mouse.move(vp.width / 2, vp.height / 2);
	// Escape toggles the controls, so it is pressed only while they show: a
	// navigation the strip makes as it settles can hide them first, and a
	// blind press then brought them back (traced in wave 24: they went with
	// a crossing to the next chapter and back, no key pressed, and the
	// Escape after it showed them again).
	const banner = page.getByRole('banner', { name: 'Reader' });
	await expect(async () => {
		if (await banner.count()) await page.keyboard.press('Escape');
		await expect(banner).toHaveCount(0, { timeout: 1_000 });
	}).toPass();
	// The strip finds its place after the switch (pages above arrive and the
	// place is kept): wait until it has held still for a second. A chapter can
	// still arrive later under load, and the strip then scrolls with it by
	// thousands of pixels (`keepPlaceBy`); `place()` takes those away, as
	// reader-flow's c192 case does.
	await page.evaluate(() => {
		const w = window as unknown as { kept: number };
		w.kept = 0;
		addEventListener('tsundoku:kept-place', (e) => (w.kept += (e as CustomEvent<number>).detail));
	});
	const y = () => place(page);
	let before = await y();
	await expect
		.poll(
			async () => {
				const now = await y();
				const still = now === before;
				before = now;
				return still;
			},
			{ intervals: [1000], timeout: 30_000 }
		)
		.toBe(true);
	// Measured from here: what was kept while settling is the start, and the
	// slot under the middle is what `place()` reads from now on.
	await page.evaluate(() => {
		const w = window as unknown as { kept: number; ref?: Element };
		w.kept = 0;
		w.ref =
			document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('[data-role="page"]') ??
			undefined;
	});
}

/** What the middle of the screen shows: the page slot under it, whatever covers it. */
const middle = (page: import('@playwright/test').Page) =>
	page.evaluate(() => {
		const s = document
			.elementsFromPoint(innerWidth / 2, innerHeight / 2)
			.find((e) => e.closest('[data-role="page"]'))
			?.closest('[data-role="page"]');
		return `${s?.getAttribute('data-entry')}/${s?.getAttribute('data-index')}`;
	});

// c568 (wave 24's trace): VERTICAL picked in READING's sheet opens the
// strip at the reader's page, and the chapter above arriving while the sheet
// still covers the middle used to find the sheet there, keep nothing, and
// leave the strip a chapter up under a URL naming the chapter below. The
// chapter above is held until the sheet is open, so the state is reached
// every time rather than under load only.
test.describe('the strip under READING', () => {
	test.use({ serviceWorkers: 'block' });
	test('a chapter arriving above while READING is open keeps the page being read', async ({
		page
	}) => {
		await open(page);
		const entry = Number(new URL(page.url()).pathname.split('/').pop());
		// Hold every other chapter's pages until the sheet is open over the strip.
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const held: string[] = [];
		await page.route('**/api/entries/*/pages', async (route) => {
			const id = Number(new URL(route.request().url()).pathname.split('/')[3]);
			if (id !== entry) {
				held.push(String(id));
				await gate;
			}
			await route.continue();
		});
		await page.keyboard.press('Escape');
		await page.locator('footer[aria-label="Reader controls"] .cell.grow').click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		const vertical = sheet.getByRole('radio', { name: 'VERTICAL' });
		await vertical.click();
		await expect(page.locator('.reader')).toHaveClass(/vertical/);
		await expect.poll(() => held.length).toBeGreaterThan(0);
		const at = await middle(page);
		expect(at.startsWith(`${entry}/`)).toBe(true);
		const slots = await page.locator('[data-role="page"]').count();
		release();
		await expect.poll(() => page.locator('[data-role="page"]').count()).toBeGreaterThan(slots);
		await page.keyboard.press('Escape');
		await expect(sheet).toHaveCount(0);
		expect(await middle(page)).toBe(at);
	});
});

test('a paged reader still turns on ← and →', async ({ page }) => {
	await open(page);
	await expect(page.locator('.reader')).not.toHaveClass(/vertical/);
	// The URL follows the page once the reader settles on it (800 ms).
	await expect.poll(() => pageParam(page)).toBeGreaterThan(0);
	const from = pageParam(page);
	// R→L: ← reads on.
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => pageParam(page)).toBeGreaterThan(from);
	const on = pageParam(page);
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => pageParam(page)).toBeLessThan(on);
});

test('on the strip, → and ← nudge as Ctrl + ↓ and Ctrl + ↑ do; Ctrl + → / ← add nothing', async ({
	page
}) => {
	await open(page);
	await toStrip(page);
	const y = () => place(page);
	const y0 = await y();
	// Room above for ← to nudge back up.
	expect(await page.evaluate(() => scrollY)).toBeGreaterThan(40);

	await page.keyboard.press('ArrowRight');
	await expect.poll(async () => Math.abs((await y()) - y0 - 100)).toBeLessThanOrEqual(1);
	await page.keyboard.press('ArrowLeft');
	await expect.poll(async () => Math.abs((await y()) - y0)).toBeLessThanOrEqual(1);

	// The same distance as the Ctrl nudge, both ways.
	await page.keyboard.press('Control+ArrowDown');
	await expect.poll(async () => Math.abs((await y()) - y0 - 100)).toBeLessThanOrEqual(1);
	await page.keyboard.press('Control+ArrowUp');
	await expect.poll(async () => Math.abs((await y()) - y0)).toBeLessThanOrEqual(1);

	// Twice: a second press mid-glide adds a nudge, it doesn't restart one.
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect.poll(async () => Math.abs((await y()) - y0 - 200)).toBeLessThanOrEqual(1);
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await expect.poll(async () => Math.abs((await y()) - y0)).toBeLessThanOrEqual(1);

	// Ctrl + → / ← are nothing new: the strip stays put.
	await page.keyboard.press('Control+ArrowRight');
	await page.keyboard.press('Control+ArrowLeft');
	// Nothing to wait on: the assertion is that nothing happens.
	await page.waitForTimeout(500);
	expect(Math.abs((await y()) - y0)).toBeLessThanOrEqual(1);
});

test('zoomed wider than the screen, ← and → pan the strip sideways instead', async ({ page }) => {
	await open(page);
	await toStrip(page);
	// 300%: past the screen on every device, SIDES' margins included.
	for (let i = 0; i < 8; i++) await page.keyboard.press('+');
	const lane = page.locator('.lane.wider');
	await expect.poll(() => lane.evaluate((n) => n.scrollWidth > n.clientWidth + 1)).toBe(true);
	await page.waitForTimeout(500);
	const at = () =>
		page.evaluate(() => ({
			x: Math.round(document.querySelector('.lane.wider')!.scrollLeft),
			y: Math.round(scrollY - ((window as unknown as { kept?: number }).kept ?? 0))
		}));
	const before = await at();
	await page.keyboard.press('ArrowRight');
	await expect.poll(async () => (await at()).x).toBeGreaterThan(before.x);
	const right = await at();
	expect(right.y).toBe(before.y);
	await page.keyboard.press('ArrowLeft');
	await expect.poll(async () => (await at()).x).toBeLessThan(right.x);
	expect((await at()).y).toBe(before.y);
});

// ---- a held arrow ----------------------------------------------------------------
// Playwright's `keyboard.down` sends one keydown, not the browser's repeats, so
// a held key here is `keyboard.down` plus its repeats dispatched at the OS's
// ~30/s. The reader reads its keys on the window, which is where they go.

/** The window's scroll, less what keeping the place added (as tv-strip-keys reads it). */
const scrollAt = (page: import('@playwright/test').Page) =>
	page.evaluate(() => Math.round(scrollY - ((window as unknown as { kept?: number }).kept ?? 0)));

/** Send `count` repeats of a held `key`, at the OS's ~30/s. */
async function repeats(page: import('@playwright/test').Page, key: string, count: number) {
	await page.evaluate(
		async ({ key, count }) => {
			const code = key === 'ArrowDown' ? 40 : key === 'ArrowUp' ? 38 : 0;
			for (let i = 0; i < count; i++) {
				await new Promise((r) => setTimeout(r, 33));
				window.dispatchEvent(
					new KeyboardEvent('keydown', {
						key,
						code: key,
						keyCode: code,
						which: code,
						repeat: true,
						bubbles: true,
						cancelable: true
					})
				);
			}
		},
		{ key, count }
	);
}

/**
 * Wait until the strip has held still for half a second, and say where it
 * stopped. Two equal reads are not enough: the window can be a frame or two
 * behind (a 46,000 px reflow under load starves the frames), and a read taken
 * then sees the ease paused rather than finished.
 */
async function still(read: () => Promise<number>, timeout = 20_000): Promise<number> {
	const started = Date.now();
	let last = await read();
	let unchanged = Date.now();
	while (Date.now() - started < timeout) {
		await new Promise((r) => setTimeout(r, 100));
		const now = await read();
		if (now !== last) {
			last = now;
			unchanged = Date.now();
		} else if (Date.now() - unchanged >= 500) return now;
	}
	throw new Error(`still: the strip kept moving (at ${last} after ${timeout} ms)`);
}

/**
 * The strip from the series' first seeded chapter. The continue link opens the
 * series at the last place read, near its end, where a held ↓ has nowhere to
 * go; the owner's own case is mid-series, so the hold cases start at chapter
 * 139's first page and hold down through it.
 */
async function openForHold(page: import('@playwright/test').Page) {
	await open(page);
	const from = new URL(page.url()).pathname;
	const banner = page.getByRole('banner', { name: 'Reader' });
	// The chrome, then the chapter cell: the adjacent chapter opens at page 1.
	await page.keyboard.press('Escape');
	const chapter = page
		.locator('footer[aria-label="Reader controls"] button.cell')
		.filter({ hasText: 'CH.' })
		.first();
	await chapter.click();
	await expect.poll(() => new URL(page.url()).pathname).not.toBe(from);
	// The chrome may stay up across the chapter; it is hidden before the switch.
	await expect(async () => {
		if (await banner.count()) await page.keyboard.press('Escape');
		await expect(banner).toHaveCount(0, { timeout: 1_000 });
	}).toPass();
	await page.waitForLoadState('networkidle');
	await toStrip(page);
}

test.describe('a held arrow', () => {
	test('a held ↓ moves steadily, and stops soon after the key comes up', async ({ page }) => {
		await openForHold(page);
		const y = () => scrollAt(page);
		const step = await page.evaluate(() => Math.round(innerHeight * 0.85));
		const y0 = await y();
		await page.keyboard.down('ArrowDown');
		await repeats(page, 'ArrowDown', 30);
		// It moved while the key was down (a steady scroll, never thirty steps:
		// `smooth-scroll.spec.ts` holds the speed itself).
		expect((await y()) - y0).toBeGreaterThan(100);
		await page.keyboard.up('ArrowDown');
		// Read once the keyup is in, so a busy frame before its handler is not
		// counted as travel after the release: what the ease out adds is short.
		const atKeyup = await y();
		const stopped = await still(y);
		expect(stopped - atKeyup).toBeLessThan(step);
	});

	test('a held ↓ starts from rest and reaches a screen per 220 ms', async ({ page }) => {
		await openForHold(page);
		const y = () => scrollAt(page);
		const step = await page.evaluate(() => Math.round(innerHeight * 0.85));
		const full = step / 220;
		// The press's own glide first, as a real key's: it is over long before
		// the OS's first repeat, and the strip is at rest when the hold begins.
		await page.keyboard.down('ArrowDown');
		await still(y);
		// The window's scroll on every frame, while the repeats arrive, read in
		// the page so a slow round trip cannot blur the start of the ramp.
		const { start, samples } = await page.evaluate(async () => {
			const w = window as unknown as { kept?: number };
			const samples: [number, number][] = [];
			let on = true;
			const tick = (t: number) => {
				// After this frame's callbacks, the strip's own write among them:
				// read here, an uneven frame paired one frame's move with another's
				// time, which read 0.76 and 1.33 of a speed the strip held exactly.
				setTimeout(() => samples.push([t, scrollY - (w.kept ?? 0)]));
				if (on) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
			const start = performance.now();
			for (let i = 0; i < 30; i++) {
				window.dispatchEvent(
					new KeyboardEvent('keydown', {
						key: 'ArrowDown',
						code: 'ArrowDown',
						keyCode: 40,
						which: 40,
						repeat: true,
						bubbles: true,
						cancelable: true
					})
				);
				await new Promise((r) => setTimeout(r, 33));
			}
			on = false;
			return { start, samples };
		});
		await page.keyboard.up('ArrowDown');
		// Each frame's speed, by when it happened after the first repeat. The
		// median, because images arriving above can move the scroll in one frame.
		const speeds = samples.slice(1).map(([t, at], i) => ({
			when: (t + samples[i][0]) / 2 - start,
			speed: (at - samples[i][1]) / (t - samples[i][0])
		}));
		const median = (from: number, to: number) => {
			const inside = speeds
				.filter((s) => s.when >= from && s.when < to)
				.map((s) => s.speed)
				.sort((a, b) => a - b);
			expect(inside.length, `frames between ${from} and ${to} ms`).toBeGreaterThan(0);
			return inside[Math.floor(inside.length / 2)];
		};
		// Halfway through the first 110 ms the ramp is at a quarter of the speed;
		// a start at full speed would read 1.
		expect(median(0, 110) / full).toBeLessThan(0.6);
		// Past the ramp, the speed one press covers in its glide.
		const steady = median(320, 1000) / full;
		expect(steady).toBeGreaterThan(0.8);
		expect(steady).toBeLessThan(1.2);
	});

	test('a second key during the hold takes over from where the strip is', async ({ page }) => {
		await openForHold(page);
		const y = () => scrollAt(page);
		const step = await page.evaluate(() => Math.round(innerHeight * 0.85));
		await page.keyboard.down('ArrowDown');
		await repeats(page, 'ArrowDown', 10);
		// ↑ is its own press: the held ↓ stops there (a glide drops a hold's
		// steady speed) and the strip turns round. Dispatched and read in the
		// same task, so the position returned is the press's own start.
		const atPress = await page.evaluate(() => {
			const event = (type: string) =>
				new KeyboardEvent(type, {
					key: 'ArrowUp',
					code: 'ArrowUp',
					keyCode: 38,
					which: 38,
					bubbles: true,
					cancelable: true
				});
			window.dispatchEvent(event('keydown'));
			window.dispatchEvent(event('keyup'));
			return Math.round(scrollY - ((window as unknown as { kept?: number }).kept ?? 0));
		});
		await page.keyboard.up('ArrowDown');
		const stopped = await still(y);
		// A screen up, not on down at the held key's speed.
		expect(atPress - stopped).toBeGreaterThan(step / 2);
		expect(stopped).toBeLessThan(atPress);
	});

	test('the window losing focus ends the hold', async ({ page }) => {
		await openForHold(page);
		const y = () => scrollAt(page);
		const step = await page.evaluate(() => Math.round(innerHeight * 0.85));
		await page.keyboard.down('ArrowDown');
		await repeats(page, 'ArrowDown', 15);
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		// Read after the door has been handled.
		const atBlur = await y();
		const stopped = await still(y);
		expect(stopped - atBlur).toBeLessThan(step);
		await page.keyboard.up('ArrowDown');
	});

	test('the page being hidden ends the hold', async ({ page }) => {
		await openForHold(page);
		const y = () => scrollAt(page);
		const step = await page.evaluate(() => Math.round(innerHeight * 0.85));
		await page.keyboard.down('ArrowDown');
		await repeats(page, 'ArrowDown', 15);
		await page.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', {
				value: 'hidden',
				configurable: true
			});
			document.dispatchEvent(new Event('visibilitychange'));
		});
		const atHidden = await y();
		const stopped = await still(y);
		expect(stopped - atHidden).toBeLessThan(step);
		await page.evaluate(() => {
			delete (document as unknown as { visibilityState?: unknown }).visibilityState;
		});
		await page.keyboard.up('ArrowDown');
	});

	test('the page menu opening ends the hold', async ({ page }) => {
		await openForHold(page);
		const y = () => scrollAt(page);
		await page.keyboard.down('ArrowDown');
		await repeats(page, 'ArrowDown', 15);
		await page.keyboard.press('ContextMenu');
		// The menu's own lock: the effect that ends the hold is the one that
		// holds the page still.
		await expect
			.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflowY))
			.toBe('hidden');
		const atMenu = await y();
		const stopped = await still(y);
		// At once, not an ease on under the lock: 185 px would be a screen's
		// release gliding on after the menu took the keyboard.
		expect(stopped - atMenu).toBeLessThan(10);
		await page.keyboard.up('ArrowDown');
		await page.keyboard.press('Escape');
	});

	test('the READING sheet ends the hold', async ({ page }) => {
		await openForHold(page);
		const y = () => scrollAt(page);
		await page.keyboard.down('ArrowDown');
		await repeats(page, 'ArrowDown', 10);
		// The controls, then the cell that opens the sheet over the strip.
		const banner = page.getByRole('banner', { name: 'Reader' });
		if (!(await banner.count())) await page.keyboard.press('Escape');
		await expect(banner).toHaveCount(1);
		await page.locator('footer[aria-label="Reader controls"] .cell.grow').click();
		await expect(page.getByRole('dialog', { name: 'Reading settings' })).toBeVisible();
		const atSheet = await y();
		const stopped = await still(y);
		expect(stopped - atSheet).toBeLessThan(10);
		await page.keyboard.up('ArrowDown');
		await page.keyboard.press('Escape');
	});

	test('leaving the chapter ends the hold, so its repeats do not scroll the next one', async ({
		page
	}) => {
		await openForHold(page);
		const read = () => scrollAt(page);
		const step = await page.evaluate(() => Math.round(innerHeight * 0.85));
		const path = () => new URL(page.url()).pathname;
		const from = path();
		await page.keyboard.down('ArrowDown');
		await repeats(page, 'ArrowDown', 10);
		// The chrome, then a chapter cell: the reader leaves this chapter while
		// the key is still down, and the repeats that follow are not the new
		// strip's.
		await page.keyboard.press('Escape');
		const chapter = page
			.locator('footer[aria-label="Reader controls"] button.cell')
			.filter({ hasText: 'CH.' })
			.last();
		await expect(chapter).toBeVisible();
		await chapter.click();
		await expect.poll(path).not.toBe(from);
		await page.waitForLoadState('networkidle');
		const atCross = await still(read);
		await repeats(page, 'ArrowDown', 10);
		await page.waitForTimeout(400);
		expect(Math.abs((await read()) - atCross)).toBeLessThanOrEqual(step * 1.5);
		await page.keyboard.up('ArrowDown');
	});

	test('the page hidden mid-ramp stops there, and no later repeat or return moves it', async ({
		page
	}) => {
		await openForHold(page);
		const y = () => scrollAt(page);
		const start = await y();
		await page.keyboard.down('ArrowDown');
		// On the ramp, which the first repeat starts and which lasts the
		// glide's 220 ms: the repeat and the hiding are one `evaluate`, so the
		// moment is the page's own clock and not a poll, which is met by the
		// press's glide and stays true after the ramp has ended. Read in the same
		// turn as the door, or an ease's first frames go unseen.
		const { atHidden, after } = await page.evaluate(async () => {
			window.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'ArrowDown',
					code: 'ArrowDown',
					keyCode: 40,
					which: 40,
					repeat: true,
					bubbles: true,
					cancelable: true
				})
			);
			const from = performance.now();
			await new Promise<void>((done) => {
				const wait = () => (performance.now() - from >= 90 ? done() : requestAnimationFrame(wait));
				requestAnimationFrame(wait);
			});
			Object.defineProperty(document, 'visibilityState', {
				value: 'hidden',
				configurable: true
			});
			const atHidden = Math.round(scrollY - ((window as unknown as { kept?: number }).kept ?? 0));
			const after = performance.now() - from;
			document.dispatchEvent(new Event('visibilitychange'));
			return { atHidden, after };
		});
		expect(after).toBeLessThan(220);
		expect(atHidden - start).toBeGreaterThan(20);
		// At once: an ease would still cover the ramp's speed times a third of a nudge's glide.
		const stopped = await still(y);
		expect(stopped - atHidden).toBeLessThan(10);
		// The key is still down behind another window, and its repeats are nobody's.
		await repeats(page, 'ArrowDown', 3);
		expect((await still(y)) - stopped).toBeLessThan(10);
		// And coming back lands nowhere new: what a suspended frame would have jumped.
		await page.evaluate(() => {
			delete (document as unknown as { visibilityState?: unknown }).visibilityState;
			document.dispatchEvent(new Event('visibilitychange'));
		});
		expect((await still(y)) - stopped).toBeLessThan(10);
		await page.keyboard.up('ArrowDown');
	});

	test('a jump through history to a chapter not on the strip ends the hold', async ({ page }) => {
		await page.goto('/?sort=title');
		await page.waitForLoadState('networkidle');
		await page.locator('.grid .tile', { hasText: 'Sousou no Frieren' }).click();
		await page.waitForURL(/\/series\/\d+/);
		await page.waitForLoadState('networkidle');
		const entryOf = () => Number(new URL(page.url()).pathname.split('/').pop());
		// Two chapters of this series, far apart: the one the list opens first,
		// and the one the series continues at (near its end).
		await page.locator('.entry .entry-btn').first().click();
		await readerReady(page);
		const near = entryOf();
		await page.goBack();
		await page.waitForURL(/\/series\/\d+/);
		await page.waitForLoadState('networkidle');
		await page.getByRole('link', { name: /▶/ }).first().click();
		await readerReady(page);
		const far = entryOf();
		expect(far, 'two chapters to walk between').not.toBe(near);
		// A client navigation between them, so the reader stays mounted and
		// going back is a jump, not a load. The app's own chapter doors replace
		// history and ← SERIES pops it, so a second reader in the stack is made
		// by a link, as a link to a chapter from anywhere in the app would be.
		await page.evaluate((href) => {
			const a = document.createElement('a');
			a.href = href;
			document.body.append(a);
			a.click();
			a.remove();
		}, `/read/${near}`);
		await expect.poll(entryOf).toBe(near);
		await readerReady(page);
		await page.waitForLoadState('networkidle');
		await toStrip(page);
		await expect(
			page.locator(`[data-role="page"][data-entry="${far}"]`),
			'the far chapter is off this strip, or this is the crossing door'
		).toHaveCount(0);
		const read = () => scrollAt(page);
		const step = await page.evaluate(() => Math.round(innerHeight * 0.85));
		await page.keyboard.down('ArrowDown');
		await repeats(page, 'ArrowDown', 10);
		await page.evaluate(() => history.go(-1));
		await expect.poll(entryOf).toBe(far);
		await page.waitForLoadState('networkidle');
		const atJump = await still(read);
		// The key is still down; the strip on screen is not the one it was moving.
		await repeats(page, 'ArrowDown', 10);
		await page.waitForTimeout(800);
		expect(Math.abs((await read()) - atJump)).toBeLessThanOrEqual(step * 1.5);
		await page.keyboard.up('ArrowDown');
	});
});

// ---- a crossing is not a jump ------------------------------------------------------
// The strip's band between two chapters is 320 px of chapter boundary, and
// reading on across it is the strip's own move: `stripPage` navigates with
// `replaceState` and `noScroll`, so `data.entry.id` changes and the strip
// stays. Round 1 ended a hold on any change of the entry, so every glide, wheel
// ease and held key died at every band (measured on that head: one ↓ from 15 px
// above the crossing moved 717, 83 and 58 px of its 765; a double ↓ 786, 704
// and 984 of 1530; two notches 196, 109 and 109 of 240; a held ↓ stayed put
// through 80 further repeats). Only a real jump ends a hold now.
//
// The ruler is the next chapter's first page slot, never `scrollY`: a crossing
// adds and drops chapters around it and reshapes the strip.

/** The chapter after `entry` on the strip, read off the band between them. */
const nextOnStrip = (page: import('@playwright/test').Page, entry: number) =>
	page.evaluate((entry) => {
		const band = document.querySelector<HTMLElement>(`section.band[data-between^="${entry}-"]`);
		const next = band?.dataset.between?.split('-')[1];
		return next === undefined ? null : Number(next);
	}, entry);

/**
 * Put the next chapter's first page `gap` px below the middle line: the
 * crossing (that page reaching the middle) is then `gap` px of scroll away.
 */
async function aboveCrossing(page: import('@playwright/test').Page, gap: number) {
	const entry = Number(new URL(page.url()).pathname.split('/').pop());
	const next = await nextOnStrip(page, entry);
	expect(next, 'the next chapter is on the strip').not.toBeNull();
	await expect
		.poll(() => page.locator(`[data-role="page"][data-entry="${next}"]`).count())
		.toBeGreaterThan(0);
	await page.evaluate(
		({ next, gap }) => {
			const el = document.querySelector(`[data-role="page"][data-entry="${next}"]`)!;
			scrollBy(0, el.getBoundingClientRect().top - innerHeight / 2 - gap);
		},
		{ next: next!, gap }
	);
	// The strip notes the place a frame after the scroll: let it, so a crossing
	// is the key's, not the positioning's.
	await page.waitForTimeout(100);
	return next!;
}

/** The URL's chapter and the ruler's distance from the middle, read together. */
const crossed = (page: import('@playwright/test').Page, next: number) =>
	page.evaluate((next) => {
		const el = document.querySelector<HTMLElement>(`[data-role="page"][data-entry="${next}"]`);
		return {
			path: location.pathname,
			at: el ? Math.round(el.getBoundingClientRect().top - innerHeight / 2) : null
		};
	}, next);

test.describe('a crossing the band', () => {
	test('one ↓ across a band reaches its whole step', async ({ page }) => {
		await openForHold(page);
		const step = await page.evaluate(() => Math.round(innerHeight * 0.85));
		const gap = 15;
		const next = await aboveCrossing(page, gap);
		const from = new URL(page.url()).pathname;
		await page.keyboard.press('ArrowDown');
		// The crossing happened, and the glide carried on through it.
		await expect.poll(async () => (await crossed(page, next)).path).not.toBe(from);
		const settled = await still(async () => (await crossed(page, next)).at!);
		expect(Math.abs(settled - (gap - step))).toBeLessThanOrEqual(3);
	});

	test('a double ↓ across a band reaches both steps', async ({ page }) => {
		await openForHold(page);
		const step = await page.evaluate(() => Math.round(innerHeight * 0.85));
		const gap = 300;
		const next = await aboveCrossing(page, gap);
		const from = new URL(page.url()).pathname;
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await expect.poll(async () => (await crossed(page, next)).path).not.toBe(from);
		const settled = await still(async () => (await crossed(page, next)).at!);
		expect(Math.abs(settled - (gap - 2 * step))).toBeLessThanOrEqual(3);
	});

	test('a wheel notch across a band reaches its aim', async ({ page }) => {
		test.skip(test.info().project.name !== 'desktop', 'a wheel notch is the desktop’s (scale 1)');
		await openForHold(page);
		const gap = 15;
		const next = await aboveCrossing(page, gap);
		const from = new URL(page.url()).pathname;
		// A notch says its own distance; the strip aims by what the event says,
		// so the aim is read off the two events rather than assumed.
		await page.evaluate(() => {
			const w = window as unknown as { deltas: number[] };
			w.deltas = [];
			addEventListener('wheel', (e) => w.deltas.push(e.deltaY), { passive: true });
		});
		await page.mouse.wheel(0, 120);
		await page.mouse.wheel(0, 120);
		const aim = await page.evaluate(() =>
			(window as unknown as { deltas: number[] }).deltas.reduce((a, b) => a + b, 0)
		);
		expect(aim).toBeGreaterThan(gap);
		await expect.poll(async () => (await crossed(page, next)).path).not.toBe(from);
		const settled = await still(async () => (await crossed(page, next)).at!);
		expect(Math.abs(settled - (gap - aim))).toBeLessThanOrEqual(3);
	});

	test('a held ↓ reads on across a band, and stops on the keyup', async ({ page }) => {
		await openForHold(page);
		const step = await page.evaluate(() => Math.round(innerHeight * 0.85));
		const gap = 15;
		const next = await aboveCrossing(page, gap);
		const from = new URL(page.url()).pathname;
		await page.keyboard.down('ArrowDown');
		await expect
			.poll(async () => (await crossed(page, next)).path, { timeout: 10_000 })
			.not.toBe(from);
		// Past the band, with the key still down, the strip is still moving.
		await repeats(page, 'ArrowDown', 10);
		const moving = (await crossed(page, next)).at!;
		await repeats(page, 'ArrowDown', 10);
		expect(moving - (await crossed(page, next)).at!).toBeGreaterThan(100);
		await page.keyboard.up('ArrowDown');
		const atKeyup = (await crossed(page, next)).at!;
		const stopped = await still(async () => (await crossed(page, next)).at!);
		expect(atKeyup - stopped).toBeLessThan(step);
	});
});
