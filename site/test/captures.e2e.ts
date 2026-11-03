/**
 * The website's figures (doc/WEBSITE.md, "Captures"), taken from the seed
 * library by `yarn run site:captures` and committed under site/captures/.
 *
 * The seed also has a hidden Hentoid root of doujinshi (src/lib/server/
 * fixtures.ts, HIDDEN_TITLES). Reveal is never turned on here, and every shot
 * is refused if a hidden title, the root's name or a HIDDEN badge is anywhere
 * in the page: a public page must never carry one, even in a corner.
 */
import {
	devices,
	expect,
	test,
	type Browser,
	type BrowserContextOptions,
	type Page
} from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { HIDDEN_TITLES } from '../../src/lib/server/fixtures.ts';
import { CAPTURE_PORT, CAPTURE_TOKEN } from '../captures.config.ts';

test.describe.configure({ mode: 'serial' });

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'captures');
const base = `http://localhost:${CAPTURE_PORT}`;
// The session cookie the token derives (src/lib/server/auth.ts, sessionValueFor).
const session = createHash('sha256').update(`tsundoku/v1:${CAPTURE_TOKEN}`).digest('hex');

type Palette = 'dark' | 'light';
type Shot = { file: string; width: number; height: number };
const index: Record<string, { dark?: Shot; light?: Shot }> = {};

const DESKTOP: BrowserContextOptions = {
	...devices['Desktop Chrome'],
	viewport: { width: 1440, height: 900 }
};
const TABLET: BrowserContextOptions = {
	...devices['Galaxy Tab S4'],
	viewport: { width: 800, height: 1280 }
};
// Pixel 7 as the e2e phone project, at the 412×915 the handoff frames draw
// (Playwright's Pixel 7 viewport is 412×839, its screen 412×915).
const PHONE: BrowserContextOptions = {
	...devices['Pixel 7'],
	viewport: { width: 412, height: 915 }
};

async function open(browser: Browser, device: BrowserContextOptions, palette: Palette) {
	const context = await browser.newContext({
		...device,
		deviceScaleFactor: 2,
		locale: 'en-US',
		baseURL: base,
		reducedMotion: 'reduce'
	});
	await context.addCookies([
		{ name: 'tsundoku_session', value: session, url: base },
		{ name: 'tsundoku_theme', value: palette, url: base }
	]);
	return { context, page: await context.newPage() };
}

/** Nothing hidden exists (call 09): refuse the shot otherwise. */
async function guard(page: Page) {
	const cookies = await page.context().cookies();
	expect(
		cookies.find((c) => c.name === 'tsundoku_reveal'),
		'reveal is never on'
	).toBeUndefined();
	const text = await page.evaluate(() => document.documentElement.innerText);
	const html = await page.content();
	for (const t of HIDDEN_TITLES) {
		expect(text.includes(t), `hidden title on screen: ${t}`).toBe(false);
		expect(html.includes(t), `hidden title in the page: ${t}`).toBe(false);
	}
	expect(text).not.toMatch(/\bHENTOID\b|\bHIDDEN\b|\bDOUJIN/i);
}

async function shoot(page: Page, id: string, palette: Palette) {
	await page.waitForLoadState('networkidle');
	// Fonts and images settled, so a capture never catches a fallback face.
	// Only images in view: the strip reader lazy-loads the pages below, which
	// never load while nothing scrolls to them.
	await page.evaluate(async () => {
		await document.fonts.ready;
		const inView = (i: HTMLImageElement) => {
			const r = i.getBoundingClientRect();
			return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
		};
		const loads = [...document.images]
			.filter((i) => !i.complete && inView(i))
			.map((i) => new Promise((r) => (i.onload = i.onerror = r)));
		await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 10_000))]);
	});
	await guard(page);
	const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
	const file = `${id}-${palette}.webp`;
	const img = sharp(png);
	const meta = await img.metadata();
	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, file), await img.webp({ quality: 82, effort: 6 }).toBuffer());
	(index[id] ??= {})[palette] = { file, width: meta.width!, height: meta.height! };
}

async function openSeries(page: Page, title: string) {
	await page.goto('/?sort=title');
	await page.waitForLoadState('networkidle');
	await page.locator('.grid .tile', { hasText: title }).first().click();
	await page.waitForURL(/\/series\/\d+/);
}

async function openReader(page: Page, title: string) {
	await openSeries(page, title);
	await page
		.getByRole('link', { name: /▶ CONTINUE/ })
		.first()
		.click();
	await page.waitForURL(/\/read\/\d+/);
	await expect(page.locator('.reader')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
	await page.waitForLoadState('networkidle');
}

for (const palette of ['dark', 'light'] as const) {
	test(`FIG. 1, the library on a desktop, ${palette}`, async ({ browser }) => {
		const { context, page } = await open(browser, DESKTOP, palette);
		await page.goto('/');
		await shoot(page, 'library-desktop', palette);
		await context.close();
	});

	test(`FIG. 3, the library on a phone, ${palette}`, async ({ browser }) => {
		const { context, page } = await open(browser, PHONE, palette);
		await page.goto('/');
		await shoot(page, 'library-phone', palette);
		await context.close();
	});

	test(`FIG. 2, a series on a tablet, ${palette}`, async ({ browser }) => {
		const { context, page } = await open(browser, TABLET, palette);
		await openSeries(page, 'Sousou no Frieren');
		await shoot(page, 'series-tablet', palette);
		await context.close();
	});

	test(`STILL B, history on a phone, ${palette}`, async ({ browser }) => {
		const { context, page } = await open(browser, PHONE, palette);
		await page.goto('/history');
		await shoot(page, 'history-phone', palette);
		await context.close();
	});
}

// The reader is always dark (black ground in either theme), so one capture each.
test('FIG. 4, the reader on a phone, its controls showing', async ({ browser }) => {
	const { context, page } = await open(browser, PHONE, 'dark');
	await openReader(page, 'Sousou no Frieren');
	const vp = page.viewportSize()!;
	await page.touchscreen.tap(vp.width / 2, vp.height / 2);
	await expect(page.getByRole('banner', { name: 'Reader' })).toBeVisible();
	await shoot(page, 'reader-phone', 'dark');
	await context.close();
});

test('STILL A, a manhwa in the long strip', async ({ browser }) => {
	const { context, page } = await open(browser, PHONE, 'dark');
	await openReader(page, 'The Greatest Estate Developer');
	await page.mouse.move(206, 450);
	await page.mouse.wheel(0, 1400);
	await page.waitForTimeout(400);
	await shoot(page, 'strip-phone', 'dark');
	await context.close();
});

test.afterAll(() => {
	const ids = [
		'library-desktop',
		'series-tablet',
		'library-phone',
		'reader-phone',
		'strip-phone',
		'history-phone'
	];
	for (const id of ids) if (!index[id]?.dark) return; // a failed run leaves the old index alone
	writeFileSync(join(out, 'captures.json'), JSON.stringify(index, null, '\t') + '\n');
});
