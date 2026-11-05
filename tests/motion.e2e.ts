import { expect, screenSettled, test } from './helpers/hydrated';
test.use({ serviceWorkers: 'block' }); // the worker answers __data.json past page.route (c477)

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
	// Leaving, it is still drawn for a moment, sliding down, and can't be tapped
	// twice. Read in the page as the leave starts: Svelte runs `out:leave`
	// (`src/lib/motion.ts`) as the element's own `animate()`, so its style is
	// read right after that call. Polled from here, a loaded run found the
	// sheet already gone, and a starved page may draw no frame inside the
	// animation at all (c439, phone).
	type Look = { drawn: boolean; taps: string };
	await sheet.evaluate((el) => {
		const w = window as unknown as { leaving: Look[] };
		w.leaving = [];
		const animate = el.animate.bind(el);
		el.animate = (...args: Parameters<Element['animate']>) => {
			const running = animate(...args);
			w.leaving.push({ drawn: el.isConnected, taps: getComputedStyle(el).pointerEvents });
			return running;
		};
	});
	await sheet.getByRole('link', { name: 'Close' }).click();
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { leaving: Look[] }).leaving))
		.toContainEqual({ drawn: true, taps: 'none' });
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
	// Closed, and opened again while it is still on its way out. The back is
	// taken the first frame the close has left the address, not 40 ms after
	// the tap: under load the close's navigation had not happened yet by then,
	// so back left the library altogether (c439). It reports whether the
	// sheet was still drawn, leaving, when back went, which is this case's
	// premise: had it gone already, this would be an ordinary second open.
	const leaving = await page.evaluate(async () => {
		const close = document.querySelector<HTMLAnchorElement>('.new-shelf .x')!;
		close.click();
		const t0 = performance.now();
		while (location.search.includes('new=shelf') && performance.now() - t0 < 10_000)
			await new Promise(requestAnimationFrame);
		const drawn = !!document.querySelector('.new-shelf');
		history.back();
		return drawn;
	});
	expect(leaving).toBe(true);
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
	// Still sliding in, and already listening. `force`, because a plain click
	// first waits for the cell to stop moving, which is the opposite of this
	// case: under load the slide outlasted the 2 s it was given and the click
	// never went (c439, desktop). The URL below is what proves it landed.
	await back.click({ force: true });
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

/**
 * The tint replaces the background-image, so it must never land on a picture
 * (c486): hovering the series cover made it vanish, because the cover sets its
 * picture with the `background:` shorthand and the rule only left out an
 * inline `background-image`.
 */
test('a pointer never tints a picture away: the series cover keeps its image', async ({
	page,
	isMobile
}) => {
	test.skip(isMobile, 'a tap fires a false hover on touch, so touch gets none');
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Tower of God' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await screenSettled(page);
	const cover = page.locator('.panel a.cover');
	await expect(cover).toHaveAttribute('href', /\/read\//);
	const bg = () => cover.evaluate((el) => getComputedStyle(el).backgroundImage);

	// The seed has no cover files, so this is the placeholder's stripes: a picture too.
	const stripes = await bg();
	expect(stripes).toMatch(/gradient/);
	await cover.hover();
	await page.waitForTimeout(50);
	expect(await bg()).toBe(stripes);

	// A real cover, set the way SeriesPanel sets one.
	await page.mouse.move(0, 0);
	await cover.evaluate((el) => {
		(el as HTMLElement).style.background =
			'center / cover no-repeat url(data:image/gif;base64,R0lGODlhAQABAAAAACw=), linear-gradient(red, blue)';
	});
	const picture = await bg();
	expect(picture).toContain('url(');
	await cover.hover();
	await page.waitForTimeout(50);
	expect(await bg()).toBe(picture);

	// A picture from a stylesheet says so with data-picture.
	const back = page.locator('.main > .route-view a', { hasText: 'LIBRARY' }).first();
	await back.evaluate((el) => {
		el.setAttribute('data-picture', '');
		const s = document.createElement('style');
		s.textContent =
			'[data-picture] { background-image: repeating-linear-gradient(red 0 2px, blue 2px 4px) !important; }';
		document.head.append(s);
	});
	const sheetPicture = await back.evaluate((el) => getComputedStyle(el).backgroundImage);
	expect(sheetPicture).toMatch(/repeating-linear-gradient/);
	await back.hover();
	await page.waitForTimeout(50);
	expect(await back.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe(sheetPicture);

	// And a plain control on the same screen still gets its tint.
	await page.reload();
	await screenSettled(page);
	const plain = page.locator('.main > .route-view a', { hasText: 'LIBRARY' }).first();
	await expect(plain).toHaveCSS('background-image', 'none');
	await plain.hover();
	await expect(plain).toHaveCSS('background-image', /linear-gradient/);
});

/**
 * A library tile hovers as one (c487): three buttons tinted on their own
 * grayed a patchwork of the tile. The tile is tinted whole, the rating keeps
 * its own tint across the tile's full width, and the cover keeps its picture.
 */
test('a library tile hovers as one, and its rating runs edge to edge', async ({
	page,
	isMobile
}) => {
	test.skip(isMobile, 'a tap fires a false hover on touch, so touch gets none');
	await page.goto('/?sort=title');
	const tile = page.locator('.grid .tile:has(button.rating)').first();
	await expect(tile).toBeVisible();
	await screenSettled(page);
	const open = tile.locator('button.open');
	const rating = tile.locator('button.rating');
	const cover = tile.locator('.cover').first();
	const bg = (l: import('@playwright/test').Locator) =>
		l.evaluate((el) => getComputedStyle(el).backgroundImage);
	const box = (l: import('@playwright/test').Locator) =>
		l.evaluate((el) => {
			const r = el.getBoundingClientRect();
			return { left: r.left, top: r.top, width: r.width, height: r.height };
		});

	const before = await box(tile);
	const picture = await bg(cover);
	expect(await bg(tile)).toBe('none');

	// Over the cover: the whole rectangle, not the cover button's own box.
	await open.hover();
	await expect.poll(() => bg(tile)).toMatch(/linear-gradient/);
	expect(await bg(open)).toBe('none');
	expect(await bg(cover)).toBe(picture);
	expect(await box(tile)).toEqual(before);

	// The rating: the tile's full width, with its own tint on top of the tile's.
	const r = await box(rating);
	expect(r.left).toBeCloseTo(before.left, 0);
	expect(r.width).toBeCloseTo(before.width, 0);
	await rating.hover();
	await expect.poll(() => bg(rating)).toMatch(/linear-gradient/);
	expect(await bg(tile)).toMatch(/linear-gradient/);
	expect(await box(tile)).toEqual(before);
});

/**
 * The rating slider previews what a click would set (c494): every half from
 * the start to the pointer, or for FILTER's AT LEAST from the pointer to the
 * end. Each half reads as `on` (a real fill), `preview` (a light fill it
 * would add), `drop` (hatched: a fill it would take away) or `none`.
 */
type Half = 'on' | 'preview' | 'drop' | 'none';
const halvesOf = (track: import('@playwright/test').Locator): Promise<Half[]> =>
	track.locator('.half').evaluateAll((els) =>
		els.map((el): Half => {
			const s = getComputedStyle(el);
			if (s.backgroundImage.includes('repeating-linear-gradient')) return 'drop';
			if (el.classList.contains('on')) return 'on';
			return s.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'none' : 'preview';
		})
	);
/** The slider at rest: its real fill and nothing else. */
const resting = (value: number, min: boolean): Half[] =>
	Array.from({ length: 10 }, (_, i) =>
		(min ? value > 0 && i + 1 >= value : i + 1 <= value) ? 'on' : 'none'
	);
/** What the slider would show for `value`, hovered at half `at` (1-10), before it is clicked. */
function expected(value: number, at: number, min: boolean): Half[] {
	return Array.from({ length: 10 }, (_, i) => {
		const n = i + 1;
		const filled = min ? value > 0 && n >= value : n <= value;
		const kept = min ? n >= at : n <= at;
		return filled ? (kept ? 'on' : 'drop') : kept ? 'preview' : 'none';
	});
}

test('hovering the rating previews every half up to the pointer, and leaving clears it', async ({
	page,
	isMobile
}) => {
	test.skip(isMobile, 'a tap fires a false hover on touch, so touch gets none');
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Tower of God' }).click();
	await page.waitForURL(/\/series\/\d+/);
	await screenSettled(page);
	const track = page.getByRole('group', { name: 'Rating', exact: true }).first();
	await expect(track).toBeVisible();
	const pressed = track.locator('.half[aria-pressed="true"]');
	const stored = (await pressed.count())
		? Number((await pressed.getAttribute('aria-label'))!.match(/Rate (\d+)/)![1])
		: 0;
	const at = stored >= 7 ? 3 : 7;
	const half = track.locator('.half').nth(at - 1);

	await half.hover();
	await expect.poll(() => halvesOf(track)).toEqual(expected(stored, at, false));
	// Leaving clears it, and the saved value never moved.
	await page.mouse.move(0, 0);
	await expect.poll(() => halvesOf(track)).toEqual(resting(stored, false));
	await expect(pressed).toHaveCount(stored ? 1 : 0);

	// The 0 cell clears, so every filled half is hatched and none is added.
	await track.locator('xpath=..').getByRole('button', { name: 'Unrated' }).hover();
	await expect.poll(() => halvesOf(track)).toEqual(expected(stored, 0, false));
});

test("FILTER's AT LEAST previews from the pointer to the end, the ratings it would keep", async ({
	page,
	isMobile
}) => {
	test.skip(isMobile, 'a tap fires a false hover on touch, so touch gets none');
	await page.goto('/?shelf=all&sort=title&min=6');
	await page.locator('summary:visible', { hasText: 'FILTER' }).first().click();
	const track = page
		.getByRole('group', { name: 'At least', exact: true })
		.filter({ visible: true });
	await expect(track).toBeVisible();
	await expect.poll(() => halvesOf(track)).toEqual(resting(6, true));

	// Above the threshold: the halves from 6 to the pointer would go.
	await track.locator('.half').nth(7).hover();
	await expect.poll(() => halvesOf(track)).toEqual(expected(6, 8, true));
	// Below it: the halves from the pointer up to 6 would be added.
	await track.locator('.half').nth(2).hover();
	await expect.poll(() => halvesOf(track)).toEqual(expected(6, 3, true));
	await page.mouse.move(0, 0);
	await expect.poll(() => halvesOf(track)).toEqual(resting(6, true));
	await expect(page).toHaveURL(/min=6/);
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

/**
 * The scrim's box, against the viewport (c426). A screen that slid in must
 * leave nothing behind it: an animation that kept filling its last frame held
 * `translate` on the screen, which made the screen the containing block of
 * every `position: fixed` inside it, so FILTER's scrim began a sidebar's width
 * past the sidebar and a sheet's scrim missed the screen's left edge.
 */
const boxOf = (l: import('@playwright/test').Locator) =>
	l.evaluate((el) => {
		const r = el.getBoundingClientRect();
		return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
	});

/** Library → a series → back: the library arrives by a navigation, as the owner's did. */
async function arriveAtLibrary(page: import('@playwright/test').Page) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile').first().click();
	await page.waitForURL(/\/series\/\d+/);
	await page.goBack();
	await page.waitForURL((url) => url.pathname === '/');
	await expect(page.locator('.main')).toHaveAttribute('data-arrived', /.+/);
	await screenSettled(page);
}

test('a screen at rest holds no translate, so nothing fixed inside it is measured from it', async ({
	page
}) => {
	await arriveAtLibrary(page);
	await expect(page.locator('.main > .route-view > *').first()).toHaveCSS('translate', 'none');
	await page.locator('.grid .tile').first().click();
	await page.waitForURL(/\/series\/\d+/);
	await screenSettled(page);
	await expect(page.locator('.main > .route-view > *').first()).toHaveCSS('translate', 'none');
});

test('after a screen slides in, FILTER dims all of the screen but the bars', async ({ page }) => {
	await arriveAtLibrary(page);
	await page.locator('summary:visible', { hasText: 'FILTER' }).first().click();
	const scrim = page.locator('.filter[open] .scrim').filter({ visible: true });
	await expect(scrim).toHaveCount(1);
	const box = await boxOf(scrim);
	const vp = page.viewportSize()!;
	expect(box.right).toBe(vp.width);
	expect(box.bottom).toBe(vp.height);
	const sidebar = page.locator('.sidebar').filter({ visible: true });
	if (await sidebar.count()) {
		// The desktop: the sidebar and the top bar stay lit (3j).
		expect(box.left).toBe((await boxOf(sidebar.first())).right);
		const headerH = await scrim.evaluate((el) =>
			parseFloat(getComputedStyle(el).getPropertyValue('--header-h'))
		);
		expect(box.top).toBe(headerH);
	} else {
		expect(box.left).toBe(0);
	}
});

test("after a screen slides in, a sheet's scrim covers the whole viewport", async ({
	page
}, info) => {
	test.skip(info.project.name === 'desktop', 'MORE is the sidebar on the desktop, not a sheet');
	await arriveAtLibrary(page);
	await page.locator('button.more-cell').filter({ visible: true }).first().click();
	const scrim = page.locator('.library button.scrim').filter({ visible: true }).last();
	await expect(scrim).toBeVisible();
	await scrim.evaluate((el) =>
		Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)))
	);
	const vp = page.viewportSize()!;
	expect(await boxOf(scrim)).toEqual({ left: 0, top: 0, right: vp.width, bottom: vp.height });
});
