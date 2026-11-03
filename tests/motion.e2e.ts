import { expect, test } from './fixtures';

/**
 * Motion in the real app (doc/MOTION.md, card c396): every tap is drawn and
 * held long enough to be seen, a pointer tints what it's over, a sheet leaves
 * the way it came, and a screen slides in. Read-only: it opens and closes, and
 * writes nothing. The decisions themselves are motion.spec.ts's.
 */

test('a tap inverts what it lands on and holds it long enough to be seen', async ({
	page,
	isMobile
}) => {
	await page.goto('/');
	const filter = page.locator('summary:visible', { hasText: 'FILTER' }).first();
	await expect(filter).toBeVisible();
	// When the press was drawn and when it went, measured in the page: a
	// round trip from here is slower than the hold itself.
	await filter.evaluate((el) => {
		const w = window as unknown as { press: number[] };
		w.press = [];
		new MutationObserver(() => w.press.push(performance.now())).observe(el, {
			attributes: true,
			attributeFilter: ['data-pressed']
		});
	});
	const box = (await filter.boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;

	if (isMobile) {
		// A quick tap ends before the finger's delay; it's still drawn, and held.
		await page.touchscreen.tap(x, y);
	} else {
		await page.mouse.move(x, y);
		await page.mouse.down();
		await expect(filter).toHaveAttribute('data-pressed', 'both');
		await expect(filter).toHaveCSS('scale', '0.97');
		await page.mouse.up();
	}
	await expect(filter).not.toHaveAttribute('data-pressed', /.*/);
	const [on, off] = await page.evaluate(() => (window as unknown as { press: number[] }).press);
	expect(off - on).toBeGreaterThanOrEqual(95);
	// FILTER opened too: the press layer never swallows the tap.
	await expect(page.getByRole('group', { name: 'Filters' })).toBeVisible();
	// And it sinks back to its own size.
	await expect(filter).toHaveCSS('scale', 'none');
});

test('a scrim is never pressed: it is the size of the screen', async ({ page }, info) => {
	test.skip(
		info.project.name === 'desktop',
		'the desktop names a shelf in the sidebar, not a sheet'
	);
	await page.goto('/?new=shelf');
	const scrim = page.locator('.new-shelf .scrim');
	await expect(scrim).toBeVisible();
	const vp = page.viewportSize()!;
	await page.mouse.move(vp.width / 2, 20);
	await page.mouse.down();
	await expect(scrim).not.toHaveAttribute('data-pressed', /.*/);
	await page.mouse.up();
});

test('a sheet leaves the way it came, and then is gone', async ({ page }, info) => {
	test.skip(
		info.project.name === 'desktop',
		'the desktop names a shelf in the sidebar, not a sheet'
	);
	await page.goto('/?new=shelf');
	const sheet = page.getByRole('dialog', { name: 'New shelf' });
	await expect(sheet).toBeVisible();
	await sheet.getByRole('link', { name: 'Close' }).click();
	// Leaving, it is still drawn for a moment, sliding down, and can't be tapped twice.
	await expect(sheet).toHaveCSS('pointer-events', 'none');
	await expect(sheet).toHaveCount(0);
	await expect(page).not.toHaveURL(/new=shelf/);
});

test('a sheet opened again before it was gone takes taps again', async ({ page }, info) => {
	test.skip(
		info.project.name === 'desktop',
		'the desktop names a shelf in the sidebar, not a sheet'
	);
	await page.goto('/?new=shelf');
	const sheet = page.getByRole('dialog', { name: 'New shelf' });
	await expect(sheet).toBeVisible();
	// Closed, and opened again while it is still on its way out.
	await page.evaluate(async () => {
		const close = document.querySelector<HTMLAnchorElement>('.new-shelf .x')!;
		close.click();
		await new Promise((r) => setTimeout(r, 40));
		history.back();
	});
	await expect(page).toHaveURL(/new=shelf/);
	await expect(sheet).toHaveCount(1);
	await expect(sheet).toHaveCSS('pointer-events', 'auto');
	await sheet.getByRole('textbox').first().fill('x');
});

test('a deeper screen slides in, and history slides it back out', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.evaluate(() => {
		const w = window as unknown as { moves: string[] };
		w.moves = [];
		const main = document.querySelector<HTMLElement>('.main')!;
		new MutationObserver(() => {
			if (main.dataset.arrived) w.moves.push(main.dataset.arrived);
		}).observe(main, { attributes: true, attributeFilter: ['data-arrived'] });
	});
	await page.locator('.grid .tile').first().click();
	await page.waitForURL(/\/series\/\d+/);
	// The real screen moves, not a picture of it: a tap in the meantime lands.
	await expect(page.locator('.main > .route-view > *').first()).toHaveCSS(
		'animation-name',
		/^screen-(in-right|fade-in)$/
	);
	await page.goBack();
	// The URL changes at once; the screen moves once its data is here. Under a
	// loaded run either screen can take long enough that its outline showed and
	// slid in first, and then the screen only fades over it.
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { moves: string[] }).moves))
		.toEqual([expect.stringMatching(/^(forward|fade)$/), expect.stringMatching(/^(back|fade)$/)]);
});

test('a tap the moment a screen arrives lands on it', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile').first().click();
	await page.waitForURL(/\/series\/\d+/);
	const back = page.locator('.main > .route-view a', { hasText: 'LIBRARY' }).first();
	// Still sliding in, and already listening.
	await back.click({ timeout: 2000 });
	await page.waitForURL((url) => url.pathname === '/');
});

test('a pointer tints what it is over, on a device that has one', async ({ page, isMobile }) => {
	test.skip(isMobile, 'a tap fires a false hover on touch, so touch gets none');
	await page.goto('/');
	const select = page.locator('summary:visible', { hasText: 'FILTER' }).first();
	await expect(select).toHaveCSS('background-image', 'none');
	await select.hover();
	await expect(select).toHaveCSS('background-image', /linear-gradient/);
});

test('a slow screen: its outline is what slides in', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.route('**/series/*/__data.json*', async (route) => {
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});
	await page.locator('.grid .tile').first().click();
	const outline = page.locator('[data-arriving="forward"] > [data-arrive]');
	await expect(outline).toBeVisible();
	await expect(outline).toHaveCSS('animation-name', 'screen-in-right');
	await page.waitForURL(/\/series\/\d+/);
	await expect(page.locator('[data-arrive]')).toHaveCount(0);
});
