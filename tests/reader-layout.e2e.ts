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
	// The start belongs to the TV's chrome (c241), where OK focuses it anyway.
	// Off a TV it would matter where the reader lifts its opt-out, at the end
	// page (c235): a declared start there would take the first arrow to the
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

test('hiding, the top bar goes up and away and the bottom one down (c427)', async ({ page }) => {
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

test('READING: every segmented choice is the full-height cell SIDES is (c428)', async ({
	page
}) => {
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
});

/**
 * c515, in the image reader: a turn whose slide is overtaken by the scrubber
 * gives way to it, rather than turning from where the scrub left off; and a
 * second finger ends a drag instead of re-basing it. Same rule and the same
 * cases as the text reader's (`text-reader-turn.e2e.ts`), since the two
 * readers share it (`src/lib/reader/pointer.ts`).
 */
test('a scrub during a slide wins: the turn gives way instead of landing one past it (c515)', async ({
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

test('a second finger cancels a drag: the page goes back rather than jerking to it (c515)', async ({
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
