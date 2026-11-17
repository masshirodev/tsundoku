import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * The web app at 130% text: the phone and tablet app follows Android's
 * font size up to 130% through the WebView's `textZoom` (doc/ANDROID.md on
 * the `phone-app` branch), which scales every computed font size and nothing
 * else. A browser has no text zoom, so the closest it gets is this: on a
 * 360 × 780 phone, every element's computed `font-size` is
 * multiplied by 1.3 in place (`zoomText`), all read first and then written,
 * so nothing is scaled twice. Line heights that are unitless or in `em`
 * follow, as they do under `textZoom`; ones fixed in px stay, as they do
 * there. Read only, on the seed: Drawing's long title and the series screen.
 * It runs on the `phone` project alone, the device measured; the check on a
 * real phone, at Android's largest font step under 130%, is done by hand
 * (doc/SERIES.md, "At a larger text size").
 */
test.use({ viewport: { width: 360, height: 780 } });
test.beforeEach(() => {
	test.skip(test.info().project.name !== 'phone', 'the card measured a 360 px phone');
});

/** Every computed font size times `factor`, as the WebView's textZoom does. */
async function zoomText(page: Page, factor: number) {
	await page.evaluate((f) => {
		const all = [...document.querySelectorAll<HTMLElement>('body, body *')];
		const sizes = all.map((el) => parseFloat(getComputedStyle(el).fontSize));
		all.forEach((el, i) => el.style.setProperty('font-size', `${sizes[i] * f}px`, 'important'));
	}, factor);
}

/** A tile title's box against the two lines it clamps to. */
const titleBoxes = (page: Page) =>
	page.locator('.grid .tile .title').evaluateAll((els) =>
		els.map((el) => {
			const cs = getComputedStyle(el);
			return {
				text: el.textContent ?? '',
				height: el.getBoundingClientRect().height,
				line: parseFloat(cs.lineHeight),
				scroll: el.scrollHeight
			};
		})
	);

async function library(page: Page) {
	await page.goto('/?sort=title');
	await expect(page.locator('.grid .tile', { hasText: 'Drawing: Saikyou' })).toBeVisible();
}

test('at 100% a tile title keeps its 32 px box, two lines of the tile’s type', async ({ page }) => {
	await library(page);
	const boxes = await titleBoxes(page);
	expect(boxes.length).toBeGreaterThan(3);
	for (const b of boxes) expect(b.height, b.text).toBeCloseTo(32, 1);
});

test('at 130% text a tile title still has room for both lines: the second is never cut through', async ({
	page
}) => {
	await library(page);
	await zoomText(page, 1.3);
	const boxes = await titleBoxes(page);
	const drawing = boxes.find((b) => b.text.startsWith('Drawing: Saikyou'))!;
	// The case seen on a phone: a title of more than two lines, clamped to two.
	expect(drawing.scroll).toBeGreaterThan(2 * drawing.line);
	for (const b of boxes) {
		// Two line boxes, less at most the second's half-leading (the box is
		// 32/13 em: exactly 32 px at 100%, where two lines are 32.5).
		const halfLeading = (b.line - b.line / 1.25) / 2;
		expect(b.height, b.text).toBeGreaterThanOrEqual(2 * b.line - halfLeading);
		// And never more than two: the clamp still holds.
		expect(b.height, b.text).toBeLessThan(3 * b.line);
	}
});

test('at 130% text every series row’s label fits its column, SHELVES included', async ({
	page
}) => {
	await page.goto('/?sort=title');
	await expect(async () => {
		await page.locator('.grid .tile', { hasText: 'Tower of God' }).first().click();
		await page.waitForURL(/\/series\/\d+/, { timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	const panel = page.getByRole('region', { name: 'About this series' });
	// SHELVES is drawn twice, one copy per order, and CSS shows one
	// (doc/SERIES.md, "Two markups"): the row to read is the copy that can be seen.
	await expect(
		panel.locator('.label', { hasText: 'SHELVES' }).filter({ visible: true })
	).toBeVisible();
	const overflowing = () =>
		panel.locator('.label').evaluateAll((els) =>
			els
				.filter((el) => (el as HTMLElement).offsetParent !== null)
				.map((el) => {
					// The text's own width against the column, the label's padding inside it.
					const range = document.createRange();
					range.selectNodeContents(el);
					const text = range.getBoundingClientRect();
					const box = el.getBoundingClientRect();
					const right = box.right - parseFloat(getComputedStyle(el).paddingRight);
					return { label: (el.textContent ?? '').trim(), over: text.right - right };
				})
				.filter((l) => l.over > 0.5)
		);
	// At 100% none runs past its rule, as the boards draw them.
	expect(await overflowing()).toEqual([]);
	const labels = await panel.locator('.label').count();
	expect(labels).toBeGreaterThan(3);
	await zoomText(page, 1.3);
	expect(await overflowing()).toEqual([]);
});

/**
 * The reader's bottom bar at 360 px: every cell of it reachable and
 * fully on screen, and a tap at each cell's centre landing on that cell, at
 * 100% and at 130% text, on both readers. Measured on a phone: FULL SCREEN off
 * the right edge on the text reader at 100%, and CH. 28 → off it on the image
 * reader at 130%, with SETTINGS a sliver between two cells: a row wider than
 * the phone clips its last cells with no way to reach them. The cells keep
 * their size and order and the row scrolls, so each is brought into view
 * before it is checked. The bar keeps its
 * 64 px, and so the reading area under it.
 */
const BAR = 'footer.bottom .cells';
const BAR_CELLS = `${BAR} .cell`;

async function expectBarReachable(page: Page, where: string) {
	const v = page.viewportSize()!;
	const row = page.locator(BAR);
	// One row, not two: the bar's height is what the reading area measured,
	// and a second row of cells would double it.
	const height = await row.evaluate((el) => el.clientHeight);
	expect(height, where).toBeGreaterThan(32);
	expect(height, where).toBeLessThan(80);
	const cells = page.locator(BAR_CELLS);
	const count = await cells.count();
	expect(count, where).toBeGreaterThan(3);
	const labels = await cells.evaluateAll((els) =>
		els.map((el) => (el as HTMLElement).innerText.trim())
	);
	// The summary's cell is the one that says what it opens; its text is
	// clipped on a phone, so it ends there rather than reading only that.
	expect(
		labels.some((l) => l.includes('SETTINGS ↑')),
		where
	).toBe(true);
	// And the label it ends in is whole: the summary gives way on a phone,
	// never SETTINGS ↑ itself (the "sliver" above).
	const label = await page.locator(`${BAR_CELLS} .opens-k`).evaluate((el) => {
		const k = el.getBoundingClientRect();
		const c = el.closest('.cell')!.getBoundingClientRect();
		return { left: k.left - c.left, right: c.right - k.right };
	});
	expect(label.left, `${where}: SETTINGS`).toBeGreaterThanOrEqual(-0.5);
	expect(label.right, `${where}: SETTINGS`).toBeGreaterThanOrEqual(-0.5);
	for (let i = 0; i < count; i++) {
		const cell = cells.nth(i);
		const label = labels[i];
		// Bring it into the bar's view, as a thumb does, then measure it: a
		// cell past the edge is the bug, and a row that cannot scroll to it
		// leaves it past the edge.
		await cell.evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'center' }));
		await expect
			.poll(
				async () => {
					const b = await cell.boundingBox();
					return !!b && b.x >= -0.5 && b.x + b.width <= v.width + 0.5;
				},
				{ message: `${where}: ${label}` }
			)
			.toBe(true);
		const hit = await cell.evaluate((el) => {
			const r = el.getBoundingClientRect();
			const at = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
			return (at?.closest<HTMLElement>('.cell')?.innerText ?? '').trim();
		});
		expect(hit, `${where}: ${label}`).toBe(label);
	}
}

/** The chrome, on a reader: a tap in the top margin shows it (a word or an
 * illustration is never there, and the image reader's strips run full height). */
async function showControls(page: Page) {
	const v = page.viewportSize()!;
	await page.mouse.click(v.width / 2, 30);
	await expect(page.locator(BAR)).toBeVisible();
}

async function openReaderBy(page: Page, title: string) {
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: title }).click();
	await page.waitForURL(/\/series\/\d+/);
	await page
		.getByRole('link', { name: /^(?!GET).*(READ AGAIN|CONTINUE|START|▶)/ })
		.first()
		.click();
	await page.waitForURL(/\/read\/\d+/);
	await expect(page.locator('.text-reader, .reader').first()).toBeVisible({ timeout: 15_000 });
}

test('the bottom bar keeps every cell reachable on a 360 px phone, on both readers, at 100% and 130% text', async ({
	page
}) => {
	test.setTimeout(120_000);
	// Incognito: a layout case, and the seed's history and progress are other
	// specs'; nothing here should be written.
	await page
		.context()
		.addCookies([{ name: 'tsundoku_incognito', value: '1', url: 'http://localhost' }]);
	await openReaderBy(page, 'Mushoku Tensei');
	await showControls(page);
	await expectBarReachable(page, 'text, 100%');
	await zoomText(page, 1.3);
	await expectBarReachable(page, 'text, 130%');

	await openReaderBy(page, 'Hikaru ga Shinda Natsu');
	await showControls(page);
	await expectBarReachable(page, 'image, 100%');
	await zoomText(page, 1.3);
	await expectBarReachable(page, 'image, 130%');
});
