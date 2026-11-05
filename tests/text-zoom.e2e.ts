import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * The web app at 130% text (c591): the phone and tablet app follows Android's
 * font size up to 130% through the WebView's `textZoom` (doc/PHONE-APP.md on
 * the `phone-app` branch), which scales every computed font size and nothing
 * else. A browser has no text zoom, so the closest it gets is the card's
 * method: on a 360 × 780 phone, every element's computed `font-size` is
 * multiplied by 1.3 in place (`zoomText`), all read first and then written,
 * so nothing is scaled twice. Line heights that are unitless or in `em`
 * follow, as they do under `textZoom`; ones fixed in px stay, as they do
 * there. Read only, on the seed: Drawing's long title and the series screen.
 * It runs on the `phone` project alone, the device the card measured; the
 * check on a real phone, at Android's largest font step under 130%, is the
 * owner's (doc/SERIES.md, "At a larger text size").
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
	// The case the card saw: a title of more than two lines, clamped to two.
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
	await expect(panel.locator('.label', { hasText: 'SHELVES' })).toBeVisible();
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
