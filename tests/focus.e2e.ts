import { test, expect, readerReady } from './fixtures';

/**
 * D-pad focus (card c234, doc/FOCUS.md): arrow keys move focus by geometry,
 * the mark is one ink frame, a sheet is a scope, and a trip back comes back to
 * what the screen was left from.
 *
 * Keyboard only, on the projects the suite already has. The reader leg writes
 * reading progress, so it skips off tablet-portrait; it owns Hoshi no Umi no
 * Tabibito's progress. Two flow files touch other fields of that series on the
 * same database, each putting them back: library-flow rates it 10 and clears
 * it, and books-flow selects it for a group that is refused. Neither reads or
 * writes its progress.
 */

const TARGET = 'Hoshi no Umi no Tabibito';

type Focused = {
	tag: string;
	id: string | null;
	text: string;
	shadow: string;
	visible: boolean;
	top: number;
	left: number;
};

async function focused(page: import('@playwright/test').Page): Promise<Focused> {
	return page.evaluate(() => {
		const el = document.activeElement as HTMLElement | null;
		const host = el?.closest<HTMLElement>('[data-focus-id]') ?? el;
		const rect = el?.getBoundingClientRect();
		return {
			tag: el?.tagName ?? '',
			id: host?.getAttribute('data-focus-id') ?? null,
			text: (host?.textContent ?? '').replace(/\s+/g, ' ').trim(),
			shadow: el ? getComputedStyle(el).boxShadow : '',
			visible: !!el?.matches(':focus-visible'),
			top: rect ? Math.round(rect.top) : -1,
			left: rect ? Math.round(rect.left) : -1
		};
	});
}

async function press(page: import('@playwright/test').Page, key: string): Promise<Focused> {
	await page.keyboard.press(key);
	return focused(page);
}

/** Press ↓ until a library tile has focus (past the first CONTINUE card). */
async function gridFocus(page: import('@playwright/test').Page): Promise<Focused> {
	await page.keyboard.press('ArrowDown');
	for (let i = 0; i < 14; i++) {
		const now = await focused(page);
		if (now.id?.startsWith('series-')) return now;
		await page.keyboard.press('ArrowDown');
	}
	throw new Error('the arrows never reached the grid');
}

/** Walk the grid, keyboard only, until the named series is focused. */
async function walkTo(page: import('@playwright/test').Page, title: string): Promise<Focused> {
	// The target's own rect, so the walk goes to its row and then along it
	// rather than guessing column counts.
	const target = await page.evaluate((needle) => {
		const el = [...document.querySelectorAll<HTMLElement>('[data-focus-id^="series-"]')].find(
			(candidate) => (candidate.textContent ?? '').includes(needle)
		);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { id: el.dataset.focusId ?? null, top: Math.round(r.top), left: Math.round(r.left) };
	}, title);
	if (!target) throw new Error(`${title} is not in the grid`);

	let now = await gridFocus(page);

	// Down to the target's row (down from a tile stays in the grid), then
	// along the row. At the row's own end the target would already be behind
	// us, so a horizontal step never leaves the row before it is reached.
	for (let step = 0; step < 40 && now.top < target.top; step++) {
		const down = await press(page, 'ArrowDown');
		if (down.id === now.id || !down.id?.startsWith('series-')) break;
		now = down;
	}
	for (let step = 0; step < 40 && now.id !== target.id; step++) {
		const key = now.left < target.left ? 'ArrowRight' : 'ArrowLeft';
		const next = await press(page, key);
		if (next.id === now.id || !next.id?.startsWith('series-')) break;
		now = next;
	}
	if (now.id !== target.id) throw new Error(`could not reach ${title} with the arrows`);
	return now;
}

test('an arrow starts focus and the mark is an ink frame', async ({ page }) => {
	await page.goto('/?shelf=all');
	const tile = await gridFocus(page);

	// The first arrow puts focus on the screen's start and does not also move
	// it away; the thing focused is what a keyboard focuses.
	expect(tile.visible).toBe(true);

	// On a cover the frame sits outside the cover itself, 3px of page then 4px
	// of ink (7px of spread), not around the tile's title.
	const coverShadow = await page.evaluate(() => {
		const cover = document.activeElement?.querySelector('.cover');
		return cover ? getComputedStyle(cover).boxShadow : '';
	});
	expect(coverShadow).not.toBe('none');
	expect(coverShadow).toContain('7px');
	expect(coverShadow).toContain('3px');

	// A cell of a ruled block takes the same mark inside, so it never crosses
	// the hairline that draws the cell. Above a tile is the shelf's tab row.
	let bar = await focused(page);
	for (
		let i = 0;
		i < 6 &&
		!(await page.evaluate(() => !!document.activeElement?.closest('[data-focus-mark="in"]')));
		i++
	) {
		await page.keyboard.press('ArrowUp');
		bar = await focused(page);
	}
	const inCell = await page.evaluate(
		() => !!document.activeElement?.closest('[data-focus-mark="in"]')
	);
	expect(inCell).toBe(true);
	expect(bar.shadow).toContain('inset');
	expect(bar.shadow).toContain('7px');
});

test('a keyboard’s Escape is not a climb: focus stays where it was', async ({ page }) => {
	// BACK climbs on a TV only (doc/TV.md, c235). On a keyboard the layer
	// leaves Escape to whatever listens for it, so a tile keeps its focus.
	await page.goto('/?shelf=all');
	const tile = await gridFocus(page);
	const after = await press(page, 'Escape');
	expect(after.id).toBe(tile.id);
});

test('a sheet is a scope: focus stays in and comes back', async ({ page }) => {
	test.skip(test.info().project.name !== 'tablet-portrait', 'MORE is the tablet and phone bar');

	await page.goto('/?shelf=all');

	// Tab reaches the bar's cells in DOM order; MORE is the last of them.
	let opener = await focused(page);
	for (let i = 0; i < 12 && opener.id !== 'library-more'; i++) {
		await page.keyboard.press('Tab');
		opener = await focused(page);
	}
	expect(opener.id).toBe('library-more');
	expect(opener.shadow).toContain('inset');

	await page.keyboard.press('Enter');
	const dialog = page.locator('[role="dialog"]');
	await expect(dialog).toBeVisible();
	await expect
		.poll(async () => dialog.evaluate((el) => el.contains(document.activeElement)))
		.toBe(true);

	// The arrows stay in the panel, and the screen under the scrim takes no keys.
	for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
	expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect.poll(async () => (await focused(page)).id).toBe('library-more');
});

test('library to series to reader, and back, by keyboard alone', async ({ page }) => {
	test.skip(test.info().project.name !== 'tablet-portrait', 'the reader leg writes progress');

	await page.goto('/?shelf=all&sort=title');
	const tile = await walkTo(page, TARGET);
	const tileId = tile.id;
	expect(tileId).toBeTruthy();

	// OK opens the series.
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/\/series\/\d+/);

	// The first arrow lands on ▶ CONTINUE, the screen's declared start.
	await page.keyboard.press('ArrowDown');
	await expect.poll(async () => (await focused(page)).id).toBe('series-continue');

	// OK opens the reader.
	await page.keyboard.press('Enter');
	await readerReady(page);
	const readerUrl = page.url();

	// The system's back returns to the series, on the thing it was left from.
	await page.goBack();
	await expect(page).toHaveURL(/\/series\/\d+/);
	await expect.poll(async () => (await focused(page)).id).toBe('series-continue');

	// And again, to the library, on the tile the series was opened from.
	await page.goBack();
	await expect(page).not.toHaveURL(readerUrl);
	await expect(page).toHaveURL(/\/\?shelf=all/);
	await expect.poll(async () => (await focused(page)).id).toBe(tileId);
});
