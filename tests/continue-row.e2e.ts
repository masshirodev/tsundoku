import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The library's CONTINUE row (c840, c841; doc/LIBRARY.md, "The CONTINUE row"):
 * ▶ centred by what is drawn rather than by a font's metrics, on every device
 * the row is drawn on, so a plain `*.e2e.ts` in the four device projects.
 * Read-only: nothing here writes to the database the other projects share.
 */

/** The ink inside a cell, from its own pixels: what the eye gets, whatever drew it. */
async function ink(page: Page, cell: Locator) {
	const png = (await cell.screenshot({ animations: 'disabled' })).toString('base64');
	const dpr = await page.evaluate(() => devicePixelRatio);
	const read = await page.evaluate(async (b64) => {
		const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const g = canvas.getContext('2d')!;
		g.drawImage(bitmap, 0, 0);
		const { data, width, height } = g.getImageData(0, 0, bitmap.width, bitmap.height);
		// Inside the cell's 1 px border (and a pixel of rounding either side).
		const skip = Math.ceil(devicePixelRatio) * 3;
		const at = (x: number, y: number) => (y * width + x) * 4;
		const bg = at(skip, skip);
		let mass = 0;
		let mx = 0;
		let my = 0;
		for (let y = skip; y < height - skip; y++) {
			for (let x = skip; x < width - skip; x++) {
				const i = at(x, y);
				const w =
					Math.abs(data[i] - data[bg]) +
					Math.abs(data[i + 1] - data[bg + 1]) +
					Math.abs(data[i + 2] - data[bg + 2]);
				mass += w;
				mx += w * (x + 0.5);
				my += w * (y + 0.5);
			}
		}
		return { mass, x: mx / mass, y: my / mass, width, height };
	}, png);
	return {
		mass: read.mass,
		// In CSS pixels from the cell's own middle: the triangle's centroid, 0 when centred.
		dx: (read.x - read.width / 2) / dpr,
		dy: (read.y - read.height / 2) / dpr
	};
}

const firstGo = (page: Page) => page.locator('.cont > .row .go:not(:disabled)').first();

test.describe('▶ in its cell (c840)', () => {
	const within = async (page: Page, state: string) => {
		const m = await ink(page, firstGo(page));
		expect(m.mass, `${state}: the cell has a mark at all`).toBeGreaterThan(0);
		// A half pixel is the screen's own: at a device pixel ratio of 1 a cell laid
		// out on a half pixel is snapped, and the mark with it. The text ▶ was 2 px off.
		expect(Math.abs(m.dx), `${state}: ▶ across its cell, ${m.dx.toFixed(2)} px`).toBeLessThan(0.75);
		expect(Math.abs(m.dy), `${state}: ▶ down its cell, ${m.dy.toFixed(2)} px`).toBeLessThan(0.75);
	};

	test('the triangle’s centroid is the cell’s middle, in each of the row’s states', async ({
		page
	}, info) => {
		test.skip(info.project.name === 'tv', 'a TV draws the card, not this cell');
		await page.goto('/');
		await expect(firstGo(page)).toBeVisible();
		await within(page, 'plain');

		// The accent cell (UP NEXT) is CSS on the same mark: only a Work between
		// parts wears it and the seed has no Work (works-flow's own world does),
		// so the class is put on the cell the page drew, to read the paint alone.
		await firstGo(page).evaluate((n) => n.classList.add('acc'));
		await within(page, 'accent');
	});

	test('an unavailable row keeps its dash and its accessible name', async ({ page }, info) => {
		test.skip(info.project.name === 'tv', 'a TV draws the card, not this cell');
		await page.goto('/');
		await expect(firstGo(page)).toBeVisible();
		const label = await firstGo(page).getAttribute('aria-label');
		expect(label).toMatch(/^(Resume|Start) /);
		await expect(firstGo(page).locator('svg')).toHaveAttribute('aria-hidden', 'true');

		await page.context().setOffline(true);
		await page.evaluate(() => dispatchEvent(new Event('offline')));
		const dimmed = page.locator('.cont > .row.unavailable .go').first();
		await expect(dimmed).toHaveText('—');
		await expect(dimmed).toBeDisabled();
		await expect(dimmed).toHaveAttribute('aria-label', /^(Resume|Start) /);
		await expect(dimmed.locator('svg')).toHaveCount(0);
		await page.context().setOffline(false);
	});
});
