import { expect, test } from './fixtures';
import { hydrated } from './helpers/hydration';

/**
 * The remote's keys (c235; doc/TV.md, "The remote"): OK held or MENU opens the
 * focused thing's long-press options, and BACK closes what is open before it
 * climbs out. The `tv` project has no pointer, so every press here is a key.
 *
 * Read-only but for the chapter row, whose hold marks it and the ones before it
 * read: the band's own UNDO puts that back inside the test (the flow files run
 * beside this one on the same database).
 */

/** Past the 450ms hold the layer and the pointer's long press share. */
async function holdOk(page: import('@playwright/test').Page): Promise<void> {
	await page.keyboard.down('Enter');
	await page.waitForTimeout(700);
	await page.keyboard.up('Enter');
}

const focusId = (page: import('@playwright/test').Page) =>
	page.evaluate(
		() =>
			document.activeElement?.closest<HTMLElement>('[data-focus-id]')?.dataset.focusId ??
			document.activeElement?.id ??
			''
	);

/** The library's KIND band (c436), the last stop above the grid, the screen's start first. */
async function toBand(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/?sort=title');
	await page.keyboard.press('ArrowDown'); // the first CONTINUE card
	await page.keyboard.press('ArrowDown'); // the shelf tabs
	await page.keyboard.press('ArrowDown'); // the KIND band
}

/** The library's first row of covers, the screen's start first. */
async function intoGrid(page: import('@playwright/test').Page): Promise<string> {
	await toBand(page);
	await page.keyboard.press('ArrowDown'); // the first cover
	return page.evaluate(
		() =>
			document.activeElement?.closest<HTMLElement>('[data-focus-line]')?.dataset.focusTitle ?? ''
	);
}

test('OK held opens the focused tile’s sheet; a short OK opens the series instead', async ({
	page
}) => {
	const title = await intoGrid(page);
	expect(title.length).toBeGreaterThan(0);

	await holdOk(page);
	const dialog = page.getByRole('dialog', { name: title });
	await expect(dialog).toBeVisible();
	// Every sheet is a 420px panel from the right on a TV (c238): the same
	// element, opened by a remote rather than a finger.
	const box = (await dialog.boundingBox())!;
	expect(Math.round(box.width)).toBe(420);

	// The release after a hold neither closes it nor opens the series.
	expect(page.url()).toContain('/?sort=title');

	// BACK closes the sheet and puts focus back on the tile.
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	expect(await focusId(page)).toMatch(/^series-\d+$/);

	// A short press is the click a keyboard would make: the series, not its sheet.
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/series\/\d+/);
});

test('MENU opens the same sheet at once', async ({ page }) => {
	const title = await intoGrid(page);
	await page.keyboard.press('ContextMenu');
	const dialog = page.getByRole('dialog', { name: title });
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
});

/** Whether the focused element is wholly on screen, with nothing pinned over it. */
const focusedInSight = (page: import('@playwright/test').Page) =>
	page.evaluate(() => {
		const el = document.activeElement as HTMLElement;
		const r = el.getBoundingClientRect();
		// A fraction of a pixel over is a rounding, not a row out of sight.
		if (r.top < -1 || r.bottom > innerHeight + 1) return false;
		const x = r.left + r.width / 2;
		return [r.top + 2, Math.min(r.bottom, innerHeight) - 2].every((y) => {
			const hit = document.elementFromPoint(x, y);
			return !!hit && (el.contains(hit) || hit.contains(el));
		});
	});

/**
 * The seeded shelf is about five rows deep: three ↓ from the first stays off
 * the last, where a ↓ with nothing under it is the browser's own smooth
 * scroll (still running when the next key lands). Then the page is let settle.
 */
async function downThroughGrid(page: import('@playwright/test').Page): Promise<void> {
	for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
	await expect
		.poll(async () => {
			const a = await page.evaluate(() => scrollY);
			await page.waitForTimeout(100);
			return a === (await page.evaluate(() => scrollY)) ? a : -1;
		})
		.toBeGreaterThan(0);
}

test('↑ through the grid keeps each row in sight, out from under the pinned band', async ({
	page
}) => {
	await intoGrid(page);
	await downThroughGrid(page);
	expect(await focusedInSight(page)).toBe(true);
	for (let i = 0; i < 3; i++) {
		await page.keyboard.press('ArrowUp');
		// Before 2026-11-02 the row went under the pinned tabs (the KIND band
		// pins in their place since c436) and stayed there.
		expect(await focusedInSight(page)).toBe(true);
	}
});

test('BACK climbs only to what is out of sight: scrolled, to the top; at the top, it leaves', async ({
	page
}) => {
	// The KIND band, CONTINUE still in full view: nothing to climb to. (The
	// first row of covers was that stop until c436: the band's 56px above the
	// grid scroll it far enough to put CONTINUE under the pinned bar.)
	await toBand(page);
	expect(await page.evaluate(() => window.tsundokuBack!())).toBe(false);

	await page.keyboard.press('ArrowDown'); // the first cover
	await downThroughGrid(page);
	// Scrolled: BACK goes back up to the page's own top, the first CONTINUE
	// card (the pinned KIND band's chosen cell is in sight, so it isn't a stop).
	await page.keyboard.press('Escape');
	expect(await focusId(page)).toMatch(/^continue-/);
	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	// And at the top there is nothing left in the page to take it.
	expect(await page.evaluate(() => window.tsundokuBack!())).toBe(false);
	expect(page.url()).toContain('/?sort=title');
});

test('OK held as a stream of fresh keydowns, as Android TV sends it, opens the sheet', async ({
	page
}) => {
	const title = await intoGrid(page);
	await page.evaluate(async () => {
		const send = (type: string) =>
			document.activeElement!.dispatchEvent(
				new KeyboardEvent(type, { key: 'Enter', bubbles: true, cancelable: true })
			);
		send('keydown');
		for (let i = 0; i < 12; i++) {
			await new Promise((r) => setTimeout(r, 50));
			send('keydown');
		}
		send('keyup');
	});
	await expect(page.getByRole('dialog', { name: title })).toBeVisible();
	expect(page.url()).toContain('/?sort=title');
	await page.keyboard.press('Escape');
});

test('window.tsundokuBack() closes an open sheet and says it did', async ({ page }) => {
	await intoGrid(page);
	await holdOk(page);
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	expect(await page.evaluate(() => window.tsundokuBack!())).toBe(true);
	await expect(dialog).toHaveCount(0);
});

test('OK held on a chapter row marks through, and its UNDO puts every chapter back', async ({
	page
}) => {
	// A series no other spec reads its CONTINUE from: the hold marks its last
	// chapter and everything before it, and the band's UNDO puts it back.
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Isekai Yakkyoku' }).click();
	await page.waitForURL(/\/series\/\d+/);
	const rows = page.locator('.entry-btn');
	await rows.last().focus();
	await holdOk(page);
	const band = page.getByRole('status').filter({ hasText: 'MARKED READ THROUGH' });
	await expect(band).toBeVisible();
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.getByText(/MARKED READ THROUGH/)).toHaveCount(0);
});

test('OK held on a history row puts its REMOVE up, and BACK takes it down', async ({ page }) => {
	await page.goto('/history');
	const row = page.locator('.rows .row a.main').first();
	await row.focus();
	await holdOk(page);
	await expect(page.locator('.rows .row.pressed').first()).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.locator('.rows .row.pressed')).toHaveCount(0);
	expect(page.url()).toContain('/history');
});

test('▶❚❚ on a focused CONTINUE card resumes it, without the series screen', async ({ page }) => {
	// Incognito, so resuming writes nothing to the shared database.
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
	await page.goto('/?sort=title');
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => focusId(page)).toMatch(/^continue-/);
	await page.evaluate(() =>
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'MediaPlayPause', cancelable: true }))
	);
	await page.waitForURL(/\/read\/\d+/);
});

// ---- c578: ↑ ↓ chain past a scroller at its end -------------------------------

type Scrolls = { page: number; outer: number; inner: number; clip: number };

/**
 * A page of scrollers built for the case, on the live layer: `/history`'s
 * own markup hidden (it reads no arrows itself), and one button, the only
 * stop, so every ↑ ↓ has nothing that way and is the layer's step
 * (`stepScroll`). The page is taller than the TV; `outer` (300 px, auto) holds
 * `inner` (200 px, auto), and `clip` (overflow hidden, with more to show) can
 * sit between `inner` and the page instead. The button sits where the key
 * leaves it in view: at `inner`'s bottom for ↓, at its top for ↑.
 */
async function scrollers(
	page: import('@playwright/test').Page,
	o: { around: 'outer' | 'clip'; at: 'top' | 'bottom' }
): Promise<() => Promise<Scrolls>> {
	await page.goto('/history');
	await hydrated(page);
	await page.evaluate(({ around, at }) => {
		for (const el of document.body.children) (el as HTMLElement).style.display = 'none';
		const box = (css: string, ...kids: HTMLElement[]) => {
			const d = document.createElement('div');
			d.style.cssText = css;
			d.append(...kids);
			return d;
		};
		const button = document.createElement('button');
		button.id = 'c578';
		button.textContent = 'IN';
		button.style.cssText = 'display:block;height:40px;margin:0';
		const fill = () => box('height:600px');
		const inner = box(
			'overflow-y:auto;height:200px',
			...(at === 'bottom' ? [fill(), button] : [button, fill()])
		);
		inner.id = 'inner';
		const wrap = box(
			around === 'outer' ? 'overflow-y:auto;height:300px' : 'overflow:hidden;height:300px',
			inner,
			box('height:400px')
		);
		wrap.id = around;
		document.body.append(box('padding-top:100px', wrap, box('height:2000px')));
	}, o);
	return () =>
		page.evaluate(() => ({
			page: document.scrollingElement!.scrollTop,
			outer: document.getElementById('outer')?.scrollTop ?? -1,
			inner: document.getElementById('inner')!.scrollTop,
			clip: document.getElementById('clip')?.scrollTop ?? -1
		}));
}

/** Put a scroller where the case needs it, then the button in focus. */
async function setUp(page: import('@playwright/test').Page, tops: Partial<Record<string, number>>) {
	await page.evaluate((t) => {
		for (const [id, top] of Object.entries(t)) {
			const el = id === 'page' ? document.scrollingElement! : document.getElementById(id)!;
			el.scrollTop = top === -1 ? el.scrollHeight : top!;
		}
		document.getElementById('c578')!.focus({ preventScroll: true });
	}, tops);
}

/** Every listener has had the key once the next frame is drawn. */
async function arrow(page: import('@playwright/test').Page, key: 'ArrowDown' | 'ArrowUp') {
	await page.keyboard.press(key);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

test('↓ with nothing below scrolls the nearest scroller while it can still move (c578)', async ({
	page
}) => {
	const read = await scrollers(page, { around: 'outer', at: 'bottom' });
	await setUp(page, { inner: 100 });
	const before = await read();
	await arrow(page, 'ArrowDown');
	expect(await read()).toEqual({ ...before, inner: before.inner + 40 });
});

test('↓ in a scroller at its end scrolls the next one out, then the page (c578)', async ({
	page
}) => {
	const read = await scrollers(page, { around: 'outer', at: 'bottom' });
	await setUp(page, { inner: -1 });
	const before = await read();
	expect(before.inner).toBe(600 + 40 - 200);
	await arrow(page, 'ArrowDown');
	// The inner list is at its end: the outer one moves, as Chromium's own does.
	expect(await read()).toEqual({ ...before, outer: before.outer + 40 });

	// Both at their end: the page.
	await setUp(page, { inner: -1, outer: -1 });
	const ends = await read();
	await arrow(page, 'ArrowDown');
	expect(await read()).toEqual({ ...ends, page: ends.page + 40 });
	await expect(page.locator('#c578')).toBeFocused();
});

test('↓ passes over a box that hides its overflow, and the page at its end moves nothing (c578)', async ({
	page
}) => {
	const errors: Error[] = [];
	page.on('pageerror', (e) => errors.push(e));
	const read = await scrollers(page, { around: 'clip', at: 'bottom' });
	await setUp(page, { inner: -1 });
	const before = await read();
	await arrow(page, 'ArrowDown');
	// `overflow: hidden` has more to show, but no key scrolls it.
	expect(await read()).toEqual({ ...before, page: before.page + 40 });

	// Everything at its end: nothing moves, and nothing throws.
	await setUp(page, { inner: -1, page: -1 });
	const ends = await read();
	await arrow(page, 'ArrowDown');
	expect(await read()).toEqual(ends);
	expect(errors).toEqual([]);
});

test('↑ in a scroller at its top scrolls the page up (c578)', async ({ page }) => {
	const read = await scrollers(page, { around: 'outer', at: 'top' });
	await setUp(page, { page: 400 });
	const before = await read();
	expect(before).toMatchObject({ inner: 0, outer: 0, page: 400 });
	await arrow(page, 'ArrowUp');
	expect(await read()).toEqual({ ...before, page: 360 });
});

test('↓ with the root locked scrolls nothing, as Chromium’s own arrow does (c618)', async ({
	page
}) => {
	const read = await scrollers(page, { around: 'clip', at: 'bottom' });
	await setUp(page, { inner: -1 });
	// The image reader's own lock while its lookup panel or page menu is up:
	// `html.style.overflow = 'hidden'` in ImageReader.svelte. The fallback below
	// the last scroller scrolled it anyway: `overflow: hidden` is still a scroll
	// container a script can move, where Chromium's own arrow chain refuses to.
	// Locking the body alone is the same lock: the root's `overflow` propagates
	// to the viewport, and a `visible` root hands that to the body. `clip` is a
	// lock too (c647): Chromium computes it as `clip` on the locked element, and
	// a script's scrollBy still moves the viewport, so ↓ was moving 40 px there.
	for (const { on, overflow } of [
		{ on: 'html', overflow: 'hidden' },
		{ on: 'body', overflow: 'hidden' },
		{ on: 'html', overflow: 'clip' },
		{ on: 'body', overflow: 'clip' }
	] as const) {
		const computed = await page.evaluate(
			({ on, overflow }) => {
				document.documentElement.style.overflow = '';
				document.body.style.overflow = '';
				const el = on === 'html' ? document.documentElement : document.body;
				el.style.overflow = overflow;
				return getComputedStyle(el).overflowY;
			},
			{ on, overflow }
		);
		// Measured, not assumed: a clip on the viewport is its own value in
		// Chromium, not `hidden`.
		expect(computed, `with ${on} set to ${overflow}`).toBe(overflow);
		const before = await page.evaluate(() => document.scrollingElement!.scrollTop);
		await arrow(page, 'ArrowDown');
		expect(
			await page.evaluate(() => document.scrollingElement!.scrollTop),
			`with ${on} locked by ${overflow}`
		).toBe(before);
	}
	// And the page still scrolls when nothing is locked, so the case cannot
	// pass by the layer having stopped scrolling the page at all.
	await page.evaluate(() => {
		document.documentElement.style.overflow = '';
		document.body.style.overflow = '';
	});
	const free = await page.evaluate(() => document.scrollingElement!.scrollTop);
	await arrow(page, 'ArrowDown');
	expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(free + 40);
	expect((await read()).page).toBe(free + 40);
});
