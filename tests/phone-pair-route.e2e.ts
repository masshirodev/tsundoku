import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import type { Browser, BrowserContext } from '@playwright/test';
import { expect, hydrated, test } from './helpers/hydrated';

/**
 * The computer's `/pair/tv` as the phone app sees it (c521; doc/PHONE-APP.md,
 * PhoneApp-Phone.dc.html and PhoneApp-Tablet.dc.html 9C and 9E). The app's
 * user agent says TsundokuApp, and the page says the phone or the tablet where
 * it said the TV, reflowed at 600 px. The TV's page is tests/tv-pair.e2e.ts's.
 *
 * No test here spends the six digits: they live in the server's memory, one at
 * a time, and the TV's specs pair with them. 9E is reached with a paired row of
 * this file's own, removed afterwards; the TV's specs already add real ones to
 * this server whenever they pair.
 */
const PORT = process.env.PLAYWRIGHT_PORT ?? '4183';
/** The paired cookie on this origin (c530): `vite preview` builds the URL from the Host. */
const PAIRED = `tsundoku_paired_${PORT}`;

const PHONE_UA =
	'Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
	'Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36 TsundokuApp/2026.11.05';
const TABLET_UA =
	'Mozilla/5.0 (Linux; Android 14; SM-X710; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
	'Version/4.0 Chrome/131.0.6778.135 Safari/537.36 TsundokuApp/2026.11.05';

/** The app, signed in to nothing: the page is public, as it is for the TV. */
async function app(
	browser: Browser,
	ua: string,
	viewport: { width: number; height: number }
): Promise<BrowserContext> {
	return browser.newContext({
		userAgent: ua,
		viewport,
		hasTouch: true,
		storageState: { cookies: [], origins: [] }
	});
}

const box = async (page: import('@playwright/test').Page, selector: string) => {
	const b = (await page.locator(selector).first().boundingBox())!;
	return { ...b, bottom: b.y + b.height, right: b.x + b.width };
};

test.describe('9C on a phone, 360 x 780', () => {
	test('the column: the short step, six thumb cells, PAIR → at the bottom', async ({ browser }) => {
		const ctx = await app(browser, PHONE_UA, { width: 360, height: 780 });
		const page = await ctx.newPage();
		await page.goto('/pair/tv');
		await hydrated(page);
		await expect(page.locator('.step')).toHaveText('PAIR · 2 OF 2');
		await expect(page).toHaveTitle('PAIR THIS PHONE · tsundoku');
		// 積ん読 doesn't fit 360 at 130% (the design's THE FRAME).
		await expect(page.locator('.wordmark .jp')).toBeHidden();
		expect((await box(page, '.bar')).height).toBe(56);
		await expect(page.locator('.hint')).toHaveText(
			'GOOD FOR 10 MINUTES · ONE DEVICE, ONCE · A NEW CODE ON THE COMPUTER IF IT RAN OUT'
		);

		// Six cells in two threes that flex to the width, never under 44, 64 high.
		const cells = await page
			.locator('.cell')
			.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
		expect(cells).toHaveLength(6);
		for (const c of cells) {
			expect(c.width).toBeGreaterThanOrEqual(44);
			expect(c.height).toBe(64);
			expect(c.width).toBeCloseTo(cells[0].width, 0);
		}
		// The threes are held apart by the 10 px gap and the 6 px gaps either side.
		expect(Math.round(cells[3].left - cells[2].right)).toBe(6 + 10 + 6);
		expect(Math.round(cells[0].left)).toBe(16);
		expect(Math.round(cells[5].right)).toBe(360 - 16);

		// The keys are the hidden field's, and it has them on arrival.
		await expect(page.locator('input[name="code"]')).toBeFocused();

		// PAIR → is the bottom button, dim until the sixth digit; ← THE ADDRESS
		// is the full-width outline above it.
		const pair = await box(page, 'button[type="submit"]');
		expect(Math.round(pair.bottom)).toBe(780 - 12);
		expect(pair.width).toBe(360 - 32);
		await expect(page.locator('button[type="submit"]')).toBeDisabled();
		const back = await box(page, 'button[type="button"]');
		expect(back.height).toBe(48);
		expect(back.bottom).toBeLessThanOrEqual(pair.y);

		// The keyboard opens: the app pads the WebView by it, a shorter viewport
		// here. PAIR → rides its top edge.
		await page.setViewportSize({ width: 360, height: 430 });
		expect(Math.round((await box(page, 'button[type="submit"]')).bottom)).toBe(430 - 12);
		await ctx.close();
	});

	test('NOT THAT CODE runs edge to edge and says the rule under the count', async ({ browser }) => {
		const ctx = await app(browser, PHONE_UA, { width: 360, height: 780 });
		const page = await ctx.newPage();
		await page.goto('/pair/tv?r=wrong&left=4');
		await expect(page.locator('.band .bh')).toHaveText('NOT THAT CODE');
		await expect(page.locator('.band .bm')).toHaveText('4 TRIES LEFT · FIVE WRONG TRIES BURN IT');
		const band = await box(page, '.band');
		expect(band.x).toBe(0);
		expect(band.width).toBe(360);
		expect(band.y).toBe(56);
		// The label sits under the band, never inside it (c246's rule, kept).
		expect((await box(page, '.sl')).y).toBeGreaterThanOrEqual(band.bottom);
		await ctx.close();
	});
});

test.describe('9C on a tablet, 1280 x 800', () => {
	test("the TV's arrangement: 68 x 84 cells, the buttons side by side", async ({ browser }) => {
		const ctx = await app(browser, TABLET_UA, { width: 1280, height: 800 });
		const page = await ctx.newPage();
		await page.goto('/pair/tv');
		await hydrated(page);
		await expect(page.locator('.step')).toHaveText('PAIR THIS TABLET · 2 OF 2');
		await expect(page.locator('.wordmark .jp')).toBeVisible();
		expect((await box(page, '.bar')).height).toBe(64);
		const cell = await box(page, '.cell');
		expect(cell.width).toBe(68);
		expect(cell.height).toBe(84);
		const pair = await box(page, 'button[type="submit"]');
		const back = await box(page, 'button[type="button"]');
		expect(back.y).toBe(pair.y);
		expect(back.x).toBe(pair.right + 16);
		// The 24 px margin, the 36 px top of landscape.
		const label = await box(page, '.sl > div');
		expect(label.x).toBe(24);
		expect(label.y).toBe(64 + 36);
		await ctx.close();
	});
});

test.describe('9E', () => {
	const token = randomBytes(32).toString('base64url');
	const hash = createHash('sha256').update(token).digest('hex');
	const db = () => new Database(process.env.PLAYWRIGHT_DATABASE_PATH!);

	test.beforeAll(() => {
		const d = db();
		try {
			d.prepare(
				`INSERT INTO paired_devices (token_hash, label, address, paired_at, seen_at) VALUES (?, ?, ?, ?, ?)`
			).run(hash, 'Android phone · app 2026.11.05', `localhost:${PORT}`, Date.now(), Date.now());
		} finally {
			d.close();
		}
	});

	test.afterAll(() => {
		const d = db();
		try {
			d.prepare(`DELETE FROM paired_devices WHERE token_hash = ?`).run(hash);
		} finally {
			d.close();
		}
	});

	test('on a phone: the library is on this phone, OPEN THE LIBRARY → at the bottom', async ({
		browser
	}) => {
		const ctx = await app(browser, PHONE_UA, { width: 360, height: 780 });
		await ctx.addCookies([{ name: PAIRED, value: token, domain: 'localhost', path: '/' }]);
		const page = await ctx.newPage();
		await page.goto('/pair/tv');
		await expect(page.getByRole('heading', { name: 'The library is on this phone' })).toBeVisible();
		await expect(page.locator('.head p')).toContainText('Nothing is kept on the phone.');
		await expect(page.locator('.go-row .meta')).toHaveText(
			"ON THE COMPUTER IT'S A DEVICE: PHONE · IN THE APP · WITH SIGN OUT"
		);
		// The app reads the server's name from here (MainActivity's PAIRED_JS).
		await expect(page.locator('main.paired')).toHaveAttribute('data-paired-name', /\S/);
		const open = await box(page, '.go-row .btn');
		expect(Math.round(open.bottom)).toBe(780 - 12);
		expect((await box(page, '.go-row .meta')).bottom).toBeLessThanOrEqual(open.y);
		await ctx.close();
	});

	test('on a tablet: the line beside the button, as on the TV', async ({ browser }) => {
		const ctx = await app(browser, TABLET_UA, { width: 1280, height: 800 });
		await ctx.addCookies([{ name: PAIRED, value: token, domain: 'localhost', path: '/' }]);
		const page = await ctx.newPage();
		await page.goto('/pair/tv');
		await expect(
			page.getByRole('heading', { name: 'The library is on this tablet' })
		).toBeVisible();
		const open = await box(page, '.go-row .btn');
		const meta = await box(page, '.go-row .meta');
		expect(meta.x).toBeGreaterThan(open.right);
		await ctx.close();
	});
});
