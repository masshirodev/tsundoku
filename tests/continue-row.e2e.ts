import { type Locator, type Page } from '@playwright/test';
import { markerPath } from '../src/lib/cache/policy';
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
	}) => {
		await page.goto('/');
		await expect(firstGo(page)).toBeVisible();
		await within(page, 'plain');

		// The accent cell (UP NEXT) is CSS on the same mark: only a Work between
		// parts wears it and the seed has no Work (works-flow's own world does),
		// so the class is put on the cell the page drew, to read the paint alone.
		await firstGo(page).evaluate((n) => n.classList.add('acc'));
		await within(page, 'accent');
	});

	test('an unavailable row keeps its dash and its accessible name', async ({ page }) => {
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

/**
 * The band is a link and ▶ its sibling (c841). The seed's CONTINUE has only
 * series; a Work's row is walked in `tests/works-library-frame.e2e.ts`, whose
 * own database has one.
 */
const row = (page: Page) => page.locator('.cont > .row').first();

test.describe('the band opens the entry, ▶ the reader (c841)', () => {
	test('valid HTML: a link around the cover, text and progress, with ▶ its sibling', async ({
		page
	}) => {
		await page.goto('/');
		const band = row(page).locator('> a.band');
		await expect(band).toHaveCount(1);
		await expect(band).toHaveAttribute('href', /^\/series\/\d+\?from=continue$/);
		for (const part of ['> .cover', '> .text', '> .progress'])
			await expect(band.locator(part)).toHaveCount(1);
		await expect(row(page).locator('> button.go')).toHaveCount(1);
		await expect(row(page).locator('a button, a a, button a')).toHaveCount(0);
	});

	test('a tap anywhere on the band opens the series; ← comes back; ▶ opens the reader', async ({
		page
	}) => {
		await page.goto('/');
		const band = row(page).locator('a.band');
		const href = (await band.getAttribute('href'))!;
		const box = (await row(page).boundingBox())!;
		// The row's own left padding, the part of the band with nothing drawn on it.
		await page.mouse.click(box.x + 3, box.y + box.height / 2);
		await page.waitForURL((u) => u.pathname + u.search === href);
		await page.goBack();
		await page.waitForURL((u) => u.pathname === '/');
		await expect(row(page)).toBeVisible();

		await row(page).locator('.go').click();
		await page.waitForURL(/\/read\/\d+/);
	});

	test('the gap before ▶ is the band too, and ▶ never follows the band', async ({ page }) => {
		await page.goto('/');
		const go = (await row(page).locator('.go').boundingBox())!;
		const at = await page.evaluate(
			([x, y]) => document.elementFromPoint(x, y)?.closest('a.band') !== null,
			[go.x - 6, go.y + go.height / 2]
		);
		expect(at, 'the 16 px before ▶ belongs to the link').toBe(true);
		const hit = await page.evaluate(
			([x, y]) => document.elementFromPoint(x, y)?.closest('a.band') === null,
			[go.x + go.width / 2, go.y + go.height / 2]
		);
		expect(hit, '▶ is not under the link').toBe(true);
	});

	/**
	 * The first ▶'s `data-focus-down` names the shelf tabs because a TV lays its
	 * cards three across (`tests/tv-library-top.e2e.ts`). Off a TV the rows are
	 * stacked (one column under 1024 px wide, two from there), and ↓ means the
	 * row under this one (c841, round 2).
	 */
	test('off a TV, ↓ from the first ▶ is the ▶ of the row under it, not the shelf tabs', async ({
		page
	}) => {
		await page.goto('/');
		const goes = page.locator('.cont > .row .go:visible');
		await expect.poll(() => goes.count()).toBeGreaterThanOrEqual(2);
		const boxes = await goes.evaluateAll((cells) =>
			cells.map((c) => {
				const r = c.getBoundingClientRect();
				return { x: r.x, y: r.y };
			})
		);
		const under = boxes.findIndex((b) => b.x === boxes[0].x && b.y > boxes[0].y);
		expect(under, 'a row is drawn under the first').toBeGreaterThan(0);
		await goes.first().focus();
		await page.keyboard.press('ArrowDown');
		await expect(goes.nth(under)).toBeFocused();
	});

	test('while selecting a tap on the row is not a way out', async ({ page }, info) => {
		// A phone hides the row while selecting; there is nothing to tap.
		test.skip(info.project.name === 'phone', 'the phone has no row while selecting');
		await page.goto('/');
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		await expect(row(page).locator('a.band')).toHaveCount(0);
		const box = (await row(page).boundingBox())!;
		await page.mouse.click(box.x + 3, box.y + box.height / 2);
		await page.waitForTimeout(300);
		expect(new URL(page.url()).pathname).toBe('/');
		await expect(page.getByRole('button', { name: 'Stop selecting' })).toBeVisible();
	});

	test('offline and not cached, the row goes nowhere; offline with its screen kept, it does', async ({
		page,
		context
	}, info) => {
		test.skip(info.project.name !== 'tablet-portrait', 'the worker, once');
		test.setTimeout(180_000);
		await page.goto('/');
		await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
			timeout: 90_000
		});
		await page.reload();
		await expect(row(page).locator('a.band')).toHaveCount(1);
		const href = (await row(page).locator('a.band').getAttribute('href'))!;
		const id = Number(/\/series\/(\d+)/.exec(href)![1]);

		// A row with nothing cached: the dash, and no link, whatever the worker keeps.
		await context.setOffline(true);
		await page.evaluate(() => dispatchEvent(new Event('offline')));
		await expect(row(page)).toHaveClass(/unavailable/);
		await expect(row(page).locator('a.band')).toHaveCount(0);
		await context.setOffline(false);
		await page.evaluate(() => dispatchEvent(new Event('online')));

		// A chapter on the tablet (the marker the reader's download leaves, which
		// is all `cachedOn` reads) and the series' screen never seen: the worker
		// would answer with the library under a series URL (measured, c841), so
		// the row must not offer it. ▶ stays, because the chapter really is here.
		const entry = 1;
		await page.evaluate(
			async ([marker]) => {
				const entries = await caches.open('tsundoku-entries');
				await entries.put(marker, new Response('1'));
			},
			[markerPath(id, entry)]
		);
		// Nothing kept yet for this series: an earlier run's screens are the
		// worker's, so make the state as a first visit finds it.
		await page.evaluate(async (seriesId) => {
			const screens = await caches.open('tsundoku-screens');
			for (const key of await screens.keys())
				if (new URL(key.url).pathname.startsWith(`/series/${seriesId}`)) await screens.delete(key);
		}, id);
		await context.setOffline(true);
		await page.evaluate(() => dispatchEvent(new Event('offline')));
		await expect(row(page)).not.toHaveClass(/unavailable/);
		await expect(row(page).locator('.go')).toBeEnabled();
		await expect(row(page).locator('a.band')).toHaveCount(0);
		await context.setOffline(false);
		await page.evaluate(() => dispatchEvent(new Event('online')));

		// A document loaded whole is kept (a data fetch is not: SvelteKit sends it
		// no-store); offline the band goes there, and it is the series that opens
		// (its URL and its own title), not the library's copy.
		await page.goto(href);
		await page.waitForLoadState('networkidle');
		await page.goto('/');
		await expect(row(page).locator('a.band')).toHaveCount(1);
		await context.setOffline(true);
		await page.evaluate(() => dispatchEvent(new Event('offline')));
		await expect(row(page).locator('a.band')).toHaveCount(1);
		const title = (await row(page).locator('.title').textContent())!.trim();
		await row(page).locator('a.band').click();
		await page.waitForURL((u) => u.pathname === `/series/${id}`);
		await expect(page.getByRole('heading', { name: title })).toBeVisible();
		await context.setOffline(false);
		await page.evaluate(
			async ([marker]) => {
				const entries = await caches.open('tsundoku-entries');
				await entries.delete(marker);
			},
			[markerPath(id, entry)]
		);
	});
});
