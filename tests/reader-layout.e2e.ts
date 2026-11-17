import { expect, readerReady, test } from './fixtures';

/**
 * The reader's frame on every device (doc/READER.md). Read-only: it reads in
 * incognito, so opening pages writes nothing to the shared database, and it
 * reads a series no flow file owns (Sousou no Frieren).
 */
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

test('the page fills the screen on true black, with nothing over it', async ({ page }) => {
	await open(page);
	const vp = page.viewportSize()!;
	const box = await page.locator('[data-page]').first().boundingBox();
	expect(box!.height).toBeCloseTo(vp.height, -1);
	expect(await page.locator('.reader').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
		'rgb(0, 0, 0)'
	);
	await expect(page.getByRole('banner', { name: 'Reader' })).toHaveCount(0);
	// The library's chrome is gone: no sidebar, no bands.
	await expect(page.locator('.sidebar')).toHaveCount(0);
});

test('the controls: a 64px bar on top, a 56px scrubber and 64px cells below', async ({ page }) => {
	await open(page);
	const vp = page.viewportSize()!;
	// The middle button: a left click would turn the page (mouseAction).
	await page.mouse.click(vp.width / 2, vp.height / 2, { button: 'middle' });
	const top = await page.getByRole('banner', { name: 'Reader' }).boundingBox();
	expect(top).toMatchObject({ y: 0, height: 64 });
	const scrub = await page.locator('.scrub').boundingBox();
	expect(scrub!.height).toBe(56);
	const cells = await page.locator('.cells').boundingBox();
	expect(cells!.height).toBe(64);
	expect(cells!.y + cells!.height).toBeCloseTo(vp.height, 0);
});

test('off a TV the chrome declares no focus start of its own', async ({ page }) => {
	await open(page);
	// The start belongs to the TV's chrome, where OK focuses it anyway.
	// Off a TV it would matter where the reader lifts its opt-out, at the end
	// page: a declared start there would take the first arrow to the
	// footer instead of the end page's cells. This case does not reach the end
	// page (`open` resumes inside a chapter, never past it); it reads the attribute
	// on the footer itself, with the chrome up.
	const vp = page.viewportSize()!;
	await page.mouse.click(vp.width / 2, vp.height / 2, { button: 'middle' });
	const scrub = page.locator('footer[aria-label="Reader controls"] .track');
	await expect(scrub).toBeVisible();
	await expect(scrub).not.toHaveAttribute('data-focus-start');
});

test('nothing hidden opens while reveal is off', async ({ request }) => {
	const res = await request.get('/api/entries/999999/pages');
	expect(res.status()).toBe(404);
});

/**
 * Every frame of the bars' exit, read in the page (a round trip from here is
 * slower than the exit itself): each bar's translate and opacity until it's gone.
 */
async function sampleExit(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		const w = window as unknown as { exit: { top: string[]; bottom: string[]; opacity: string[] } };
		w.exit = { top: [], bottom: [], opacity: [] };
		const step = () => {
			const top = document.querySelector('header.top');
			const bottom = document.querySelector('footer.bottom');
			if (top) w.exit.top.push(getComputedStyle(top).translate);
			if (bottom) w.exit.bottom.push(getComputedStyle(bottom).translate);
			if (top) w.exit.opacity.push(getComputedStyle(top).opacity);
			if (top || bottom) requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	});
}

const ys = (frames: string[]) =>
	frames.filter((t) => t !== 'none').map((t) => parseFloat(t.split(' ')[1] ?? '0'));

test('hiding, the top bar goes up and away and the bottom one down', async ({ page }) => {
	await open(page);
	const vp = page.viewportSize()!;
	await page.mouse.click(vp.width / 2, vp.height / 2, { button: 'middle' });
	const top = page.getByRole('banner', { name: 'Reader' });
	await expect(top).toBeVisible();
	await top.evaluate((el) =>
		Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)))
	);
	await sampleExit(page);
	await page.mouse.click(vp.width / 2, vp.height / 2, { button: 'middle' });
	await expect(top).toHaveCount(0);
	const exit = await page.evaluate(
		() => (window as unknown as { exit: { top: string[]; bottom: string[] } }).exit
	);
	const up = ys(exit.top);
	const down = ys(exit.bottom);
	// It moved, and only ever the way it should: never down through the page.
	expect(up.some((y) => y < 0)).toBe(true);
	expect(up.every((y) => y <= 0)).toBe(true);
	expect(down.some((y) => y > 0)).toBe(true);
	expect(down.every((y) => y >= 0)).toBe(true);
});

test('hiding under reduced motion, the bars only fade', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await open(page);
	const vp = page.viewportSize()!;
	await page.mouse.click(vp.width / 2, vp.height / 2, { button: 'middle' });
	const top = page.getByRole('banner', { name: 'Reader' });
	await expect(top).toBeVisible();
	await top.evaluate((el) =>
		Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)))
	);
	await sampleExit(page);
	await page.mouse.click(vp.width / 2, vp.height / 2, { button: 'middle' });
	await expect(top).toHaveCount(0);
	const exit = await page.evaluate(
		() =>
			(window as unknown as { exit: { top: string[]; bottom: string[]; opacity: string[] } }).exit
	);
	expect([...ys(exit.top), ...ys(exit.bottom)].every((y) => y === 0)).toBe(true);
	expect(exit.opacity.some((o) => parseFloat(o) < 1)).toBe(true);
});

test('READING: every segmented choice is the full-height cell SIDES is', async ({ page }) => {
	await open(page);
	const vp = page.viewportSize()!;
	await page.mouse.click(vp.width / 2, vp.height / 2, { button: 'middle' });
	await page.getByRole('button', { name: /SETTINGS ↑/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await expect(sheet).toBeVisible();
	await sheet.evaluate((el) =>
		Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)))
	);
	// Every cell of every segmented row, each group's buttons and its value
	// readout, measured against SIDES' own cells: all of them, not a pick.
	const cells = await sheet.locator('.seg').evaluateAll((segs) =>
		segs.map((s) => ({
			group: s.getAttribute('aria-label'),
			box: s.getBoundingClientRect().height,
			cells: [...s.children].map((c) => ({
				text: c.textContent?.trim(),
				h: c.getBoundingClientRect().height
			}))
		}))
	);
	const sides = cells.find((c) => c.group === 'Side margins')!;
	expect(sides.cells.length).toBe(4);
	const side = sides.cells[0].h;
	// The design system's control height, not a strip.
	expect(side).toBeGreaterThanOrEqual(44);
	for (const seg of cells) {
		expect(seg.cells.length, seg.group!).toBeGreaterThan(0);
		for (const c of seg.cells) expect(c.h, `${seg.group}: ${c.text}`).toBeCloseTo(side, 0);
	}
	expect(cells.map((c) => c.group)).toEqual(
		expect.arrayContaining(['Mode', 'Fit', 'Wide pages', 'Side margins', 'Zoom'])
	);
	// RATING is not a row: the slider sits in the sheet's column itself, and a
	// column that scrolls squeezed it to about 38px. It keeps its own
	// height, the tablet's 64 or the phone's 52 (RatingSlider's `height` and
	// `phoneHeight`, switched at 599px), whether or not the sheet overflows.
	const rating = await sheet.locator('.rs').evaluate((el) => ({
		h: el.getBoundingClientRect().height,
		over: el.parentElement!.scrollHeight > el.parentElement!.clientHeight
	}));
	expect(rating.h, `RATING (sheet overflows: ${rating.over})`).toBe(vp.width < 600 ? 52 : 64);
});

/**
 * In the image reader: a turn whose slide is overtaken by the scrubber
 * gives way to it, rather than turning from where the scrub left off; and a
 * second finger ends a drag instead of re-basing it. Same rule and the same
 * cases as the text reader's (`text-reader-turn.e2e.ts`), since the two
 * readers share it (`src/lib/reader/pointer.ts`).
 */
test('a scrub during a slide wins: the turn gives way instead of landing one past it', async ({
	page
}) => {
	await open(page);
	const track = page.locator('footer[aria-label="Reader controls"] .track');
	await page.keyboard.press('Escape');
	await expect(track).toBeVisible();
	// One screen in, so that page 1 is behind: R→L, ← reads on.
	const v0 = Number(await track.getAttribute('aria-valuenow'));
	await page.keyboard.press('ArrowLeft');
	await expect
		.poll(async () => Number(await track.getAttribute('aria-valuenow')))
		.toBeGreaterThan(v0);
	await expect(page.locator('.stage .track')).not.toHaveClass(/animating/);
	const box = (await track.boundingBox())!;
	await page.evaluate(() => {
		const w = window as unknown as { keyAt: number; scrubAt: number };
		addEventListener('keydown', () => (w.keyAt = performance.now()), { once: true, capture: true });
		document
			.querySelector('footer[aria-label="Reader controls"] .track')!
			.addEventListener('pointerdown', () => (w.scrubAt = performance.now()), { once: true });
	});
	// ← turns on; mid-slide the scrubber's right end (page 1 in R→L) is asked for.
	await page.keyboard.press('ArrowLeft');
	await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
	const gap = await page.evaluate(() => {
		const w = window as unknown as { keyAt: number; scrubAt: number };
		return w.scrubAt - w.keyAt;
	});
	expect(gap).toBeLessThan(220);
	await expect(page.locator('.stage .track')).not.toHaveClass(/animating/);
	await page.waitForTimeout(500);
	await expect(track).toHaveAttribute('aria-valuenow', '1');
});

test('a turn asked for right after a mid-slide scrub waits for the first, and slides whole', async ({
	page
}) => {
	await open(page);
	const track = page.locator('footer[aria-label="Reader controls"] .track');
	const stage = page.locator('.stage .track');
	await page.keyboard.press('Escape');
	await expect(track).toBeVisible();
	const box = (await track.boundingBox())!;
	// Page 1 (R→L: the track's right end), then where one turn on from it lands,
	// a spread or a page: ← reads on.
	await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
	await expect(track).toHaveAttribute('aria-valuenow', '1');
	await page.keyboard.press('ArrowLeft');
	await expect
		.poll(async () => Number(await track.getAttribute('aria-valuenow')))
		.toBeGreaterThan(1);
	await expect(stage).not.toHaveClass(/animating/);
	const one = Number(await track.getAttribute('aria-valuenow'));
	// How long each slide runs: the span the track holds `animating`.
	await page.evaluate(() => {
		const w = window as unknown as { spans: number[]; on: number | null; keys: number[] };
		w.spans = [];
		w.on = null;
		w.keys = [];
		addEventListener('keydown', () => w.keys.push(performance.now()), { capture: true });
		const el = document.querySelector('.stage .track')!;
		new MutationObserver(() => {
			const now = el.classList.contains('animating');
			if (now && w.on === null) w.on = performance.now();
			else if (!now && w.on !== null) {
				w.spans.push(performance.now() - w.on);
				w.on = null;
			}
		}).observe(el, { attributes: true, attributeFilter: ['class'] });
	});
	// ← turns on; mid-slide the scrub asks for page 1, and ← again at once. The
	// second turn is taken when the first's slide is done, from page 1.
	//
	// Whether the second ← lands inside the first's 220 ms slide is the
	// driver's doing, not the app's: on a loaded box two presses arrive further
	// apart than that (232-349 ms on desktop, 4 runs in 5 at a load of
	// 35-39), and the state this case guards was never reached. So a try that
	// missed goes back to where the case began (page 1 by the scrub, then ← to
	// `one`, at rest: a missed try can end a page past it) and is made again,
	// and the outcome is asserted on the try that landed.
	let keys: number[] = [];
	for (let attempt = 0; attempt < 5; attempt++) {
		await page.evaluate(() => {
			const w = window as unknown as { spans: number[]; on: number | null; keys: number[] };
			w.spans = [];
			w.on = null;
			w.keys = [];
		});
		await page.keyboard.press('ArrowLeft');
		await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
		await page.keyboard.press('ArrowLeft');
		keys = await page.evaluate(() => (window as unknown as { keys: number[] }).keys);
		if (keys[1] - keys[0] < 220) break;
		await expect(stage).not.toHaveClass(/animating/);
		await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
		await expect(track).toHaveAttribute('aria-valuenow', '1');
		await expect(stage).not.toHaveClass(/animating/);
		await page.keyboard.press('ArrowLeft');
		await expect(track).toHaveAttribute('aria-valuenow', String(one));
		await expect(stage).not.toHaveClass(/animating/);
	}
	expect(keys[1] - keys[0]).toBeLessThan(220);
	await page.waitForTimeout(800);
	await expect(stage).not.toHaveClass(/animating/);
	await expect(track).toHaveAttribute('aria-valuenow', String(one));
	// Its slide ran its whole 220 ms: until the turn had its own guard, the
	// first turn's tail cut it short, and the page snapped there.
	const spans = await page.evaluate(() => (window as unknown as { spans: number[] }).spans);
	expect(spans.at(-1)!).toBeGreaterThanOrEqual(200);
});

test('an arrow pressed while a short drag goes back is taken right after, once', async ({
	page
}) => {
	await open(page);
	const track = page.locator('footer[aria-label="Reader controls"] .track');
	const stage = page.locator('.stage .track');
	await page.keyboard.press('Escape');
	await expect(track).toBeVisible();
	const now = async () => Number(await track.getAttribute('aria-valuenow'));
	// Where one ← (R→L: on) lands from here, a page or a spread, then back.
	const v0 = await now();
	await page.keyboard.press('ArrowLeft');
	await expect.poll(now).toBeGreaterThan(v0);
	await expect(stage).not.toHaveClass(/animating/);
	const v1 = await now();
	await page.keyboard.press('ArrowRight');
	await expect.poll(now).toBe(v0);
	await expect(stage).not.toHaveClass(/animating/);
	// A drag too short to turn: let go, the page goes back over 220 ms, and ←
	// is pressed while it does.
	await page.evaluate(() => {
		const w = window as unknown as { keyAt: number; upAt: number };
		addEventListener('keydown', () => (w.keyAt = performance.now()), { once: true, capture: true });
		addEventListener('pointerup', () => (w.upAt = performance.now()), {
			once: true,
			capture: true
		});
	});
	const vp = page.viewportSize()!;
	const [x, y] = [vp.width / 2, vp.height / 2];
	await page.mouse.move(x, y);
	await page.mouse.down();
	for (const d of [10, 20, 30]) await page.mouse.move(x + d, y);
	await expect(stage).toHaveAttribute('style', /translateX\(30px\)/);
	await page.mouse.up();
	await page.keyboard.press('ArrowLeft');
	const gap = await page.evaluate(() => {
		const w = window as unknown as { keyAt: number; upAt: number };
		return w.keyAt - w.upAt;
	});
	expect(gap).toBeLessThan(220);
	// Taken once the page is back: one turn on, not none and not two.
	await expect.poll(now).toBe(v1);
	await expect(stage).not.toHaveClass(/animating/);
	await page.waitForTimeout(500);
	expect(await now()).toBe(v1);
});

test('a drag begun right after a mid-slide scrub never snaps back to nothing', async ({ page }) => {
	await open(page);
	const track = page.locator('footer[aria-label="Reader controls"] .track');
	const stage = page.locator('.stage .track');
	await page.keyboard.press('Escape');
	await expect(track).toBeVisible();
	const box = (await track.boundingBox())!;
	// Every offset the page is drawn at, from here on.
	await page.evaluate(() => {
		const w = window as unknown as { xs: number[] };
		w.xs = [];
		const el = document.querySelector<HTMLElement>('.stage .track')!;
		new MutationObserver(() => {
			const m = /translateX\((-?[\d.]+)px\)/.exec(el.style.transform);
			if (m) w.xs.push(Number(m[1]));
		}).observe(el, { attributes: true, attributeFilter: ['style'] });
	});
	const vp = page.viewportSize()!;
	const [x, y] = [vp.width / 2, vp.height / 2];
	/** The page's offset now, and how long since the ← that began the slide. */
	const now = () =>
		page.evaluate(() => {
			const el = document.querySelector<HTMLElement>('.stage .track')!;
			return {
				x: Number(/translateX\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0),
				since: performance.now() - (window as unknown as { keyAt: number }).keyAt
			};
		});
	// ← slides on; mid-slide the scrubber asks for page 1 (R→L: the track's
	// right end), which cuts the slide short; and at once a finger on the page. The state is the press
	// landing inside the first turn's 220 ms: a loaded box can take longer than
	// that over the three inputs, and then it lets go (a drag, so not a tap
	// that would put the controls away) and tries again from page 1.
	for (let attempt = 0; ; attempt++) {
		expect(attempt, 'the press never landed inside the slide').toBeLessThan(6);
		// One screen in, so the scrub to page 1 is a change that cuts the slide.
		await page.keyboard.press('ArrowLeft');
		await expect
			.poll(async () => Number(await track.getAttribute('aria-valuenow')))
			.toBeGreaterThan(1);
		await expect(stage).not.toHaveClass(/animating/);
		await page.evaluate(() => {
			const w = window as unknown as { xs: number[]; keyAt: number; downAt: number };
			w.xs = [];
			addEventListener('keydown', () => (w.keyAt = performance.now()), {
				once: true,
				capture: true
			});
			document
				.querySelector('.stage .track')!
				.addEventListener('pointerdown', () => (w.downAt = performance.now()), {
					once: true,
					capture: true
				});
		});
		await page.keyboard.press('ArrowLeft');
		await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
		await page.mouse.move(x, y);
		await page.mouse.down();
		const gap = await page.evaluate(() => {
			const w = window as unknown as { keyAt: number; downAt: number };
			return w.downAt - w.keyAt;
		});
		if (gap < 200) break;
		await page.mouse.move(x + 20, y);
		await page.mouse.up();
		await expect(stage).not.toHaveClass(/animating/);
		await expect(track).toHaveAttribute('aria-valuenow', '1');
	}
	// The finger keeps going one way, past the first turn's tail, until the
	// page follows it, and a little further.
	// Past the long press's 10 px at once, so no page menu opens under a slow box.
	let d = 12;
	await page.mouse.move(x + d, y);
	let after = 0;
	for (let n = await now(); d < 160 && (after < 5 || n.since < 500); n = await now()) {
		if (n.x > 0) after++;
		d += 2;
		await page.mouse.move(x + d, y);
	}
	expect((await now()).x).toBeGreaterThan(0);
	const xs = await page.evaluate(() => (window as unknown as { xs: number[] }).xs);
	// Once the page has followed the finger, it never went back towards 0
	// while the finger went on: until the drag waited for the turn, the turn's
	// tail zeroed the offset under the finger and the next move jumped it back.
	const moved = xs.findIndex((v) => v > 0);
	expect(moved).toBeGreaterThanOrEqual(0);
	for (let i = moved + 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
	// Let go short of a turn: back into place, on the page it was on.
	const on = await track.getAttribute('aria-valuenow');
	await page.mouse.move(x + 10, y);
	await page.mouse.up();
	await expect(stage).not.toHaveClass(/animating/);
	await expect.poll(async () => (await now()).x).toBe(0);
	await expect(track).toHaveAttribute('aria-valuenow', on!);
});

test('a second finger cancels a drag: the page goes back rather than jerking to it', async ({
	page
}) => {
	test.skip(!test.info().project.use.hasTouch, 'two fingers need a touchscreen');
	await open(page);
	const at = () =>
		page
			.locator('.stage .track')
			.evaluate((el: HTMLElement) =>
				Number(/translateX\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0)
			);
	const vp = page.viewportSize()!;
	const [x, y] = [vp.width / 2, vp.height / 2];
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number }[]) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: pts.map((p, i) => ({ ...p, id: i }))
		});
	try {
		await touch('touchStart', [{ x, y }]);
		for (const d of [10, 20, 30]) await touch('touchMove', [{ x: x + d, y }]);
		await expect.poll(at).not.toBe(0);
		const followed = await at();
		await touch('touchStart', [
			{ x: x + 30, y },
			{ x: x - 150, y }
		]);
		for (const d of [40, 50, 60])
			await touch('touchMove', [
				{ x: x + d, y },
				{ x: x - 150, y }
			]);
		// Back into place, never past where the one finger had it.
		await expect.poll(at).toBe(0);
		expect(Math.abs(followed)).toBeLessThanOrEqual(30);
		await touch('touchEnd', []);
	} finally {
		await cdp.detach();
	}
	await page.waitForTimeout(500);
	expect(await at()).toBe(0);
});
