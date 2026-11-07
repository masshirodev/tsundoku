/**
 * The built website in a real browser. The frame and its measurements are
 * pinned on purpose: the spacing is the handoff's, hand-set and on no scale,
 * and these assertions are what keeps a later tidy-up from quietly redrawing
 * the page (~/.config/myconf/HANDOFF.md, "Verify what eyes cannot"). Values
 * are from doc/handoffs/website/Site.dc.html and Download.dc.html.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readRelease } from '../lib/data.ts';
import { DEFAULT_HELP, renderPage, type Captures } from '../lib/page.ts';
import { ANDROID_MANIFEST, testKey } from './helpers.ts';

const UA = {
	windows:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
	linux:
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
	mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
	phone:
		'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
	ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
	tv: 'Mozilla/5.0 (Linux; Android 12; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
};

/** Pretend to be `os`: the user agent, and no userAgentData to contradict it. */
async function as(page: Page, os: keyof typeof UA) {
	await page.context().setExtraHTTPHeaders({});
	await page.addInitScript((ua) => {
		Object.defineProperty(navigator, 'userAgent', { get: () => ua });
		Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
		Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
	}, UA[os]);
}

const rowOrder = (page: Page) =>
	page.locator('.dl-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-os')));
const visibleTags = (page: Page) =>
	page
		.locator('.dl-row')
		.evaluateAll((rows) =>
			rows
				.filter((r) => !(r.querySelector('.tag') as HTMLElement).hidden)
				.map((r) => r.getAttribute('data-os'))
		);
const accented = (page: Page) =>
	page
		.locator('.btn-main.btn-accent')
		.evaluateAll((bs) => bs.map((b) => b.getAttribute('data-main')));

test.describe('with JavaScript off', () => {
	test.use({ javaScriptEnabled: false });

	test('the HTML as built: Windows, Linux, macOS, nothing tagged, no dead control', async ({
		page
	}) => {
		await page.goto('/');
		expect(await rowOrder(page)).toEqual(['windows', 'linux', 'mac']);
		expect(await visibleTags(page)).toEqual([]);
		expect(await accented(page)).toEqual(['windows']);
		await expect(page.locator('.bar-theme')).toBeHidden();
		await expect(page.locator('.dl-band')).toBeHidden();
		await expect(page.locator('#hero-download')).toHaveText('↓ DOWNLOAD');
		await expect(page.locator('#hero-meta')).toHaveText(
			'VERSION 2026.11.01.2 · WINDOWS AND LINUX · FREE'
		);
	});
});

test('a saved release without the Android apps draws no app row and offers none', async ({
	page
}) => {
	await page.goto('/');
	expect(await page.locator('.dl-row[data-os^="android"]').count()).toBe(0);
	await expect(page.locator('.dl-band-text')).toHaveText(
		'tsundoku runs on a computer, Windows or Linux. Install it there, then read on this phone over Wi-Fi.'
	);
	await expect(page.locator('.phone-lead')).toHaveText(
		'tsundoku stays on the computer; the phone opens it in its browser. Two ways in.'
	);
});

const cap = (file: string) => ({ file, width: 1, height: 1 });
const CAPTURES: Captures = {
	'library-desktop': { dark: cap('a.webp') },
	'series-tablet': { dark: cap('b.webp') },
	'library-phone': { dark: cap('c.webp') },
	'reader-phone': { dark: cap('d.webp') },
	'strip-phone': { dark: cap('e.webp') },
	'history-phone': { dark: cap('f.webp') }
};

/**
 * The page a c614-shaped manifest makes, with the real order.js and site.js
 * inlined. The checked-in fixture is release-signed and has no apps, so this
 * is the one door that can exercise site.js's app rows: page.test.ts proves
 * the rows exist, order.test.ts proves the rule, and this proves the script
 * reads the rows from the page and reorders them.
 */
function androidPage(): string {
	const k = testKey();
	const html = renderPage({
		release: readRelease(k.signed(ANDROID_MANIFEST), k.raw),
		solver: {
			windows: { name: 'flaresolverr-3.4.6-win-x64.zip', size: 1 },
			linux: { name: 'flaresolverr-3.4.6-linux-x64.tar.gz', size: 1 }
		},
		captures: CAPTURES,
		help: DEFAULT_HELP,
		assets: { css: 'x.css', js: 'x.js', favicon: 'f.png', touchIcon: 't.png' },
		fonts: ''
	});
	const order = readFileSync(new URL('../src/order.js', import.meta.url), 'utf8').replace(
		/^export /gm,
		''
	);
	const script = readFileSync(new URL('../src/site.js', import.meta.url), 'utf8');
	return html
		.replace(/<link rel="stylesheet"[^>]*>/, '')
		.replace(/<script src="[^"]+"><\/script>/, `<script>${order}\n${script}</script>`);
}

test.describe('a release with the Android apps', () => {
	const html = androidPage();

	test.describe('on a phone', () => {
		test.use({ userAgent: UA.phone });

		test('the phone app leads, tagged and on the accent', async ({ page }) => {
			await page.setContent(html);
			await expect(page.locator('html')).toHaveAttribute('data-os', 'phone');
			expect(await rowOrder(page)).toEqual(['android', 'android-tv', 'windows', 'linux', 'mac']);
			expect(await visibleTags(page)).toEqual(['android']);
			expect(await accented(page)).toEqual(['android']);
			await expect(page.locator('.dl-band')).toBeVisible();
		});
	});

	test.describe('on an iPhone', () => {
		test.use({ userAgent: UA.ios });

		test('no Android app leads, is tagged or takes the accent', async ({ page }) => {
			// No userAgentData: a Safari phone offers none, and the UA alone must
			// decide. setContent does not run addInitScript, so it goes in first.
			await page.setContent(
				`<script>Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });</script>${html}`
			);
			await expect(page.locator('html')).toHaveAttribute('data-os', 'ios');
			expect(await rowOrder(page)).toEqual(['windows', 'linux', 'mac', 'android', 'android-tv']);
			expect(await visibleTags(page)).toEqual([]);
			expect(await accented(page)).toEqual(['windows']);
			await expect(page.locator('.dl-band')).toBeVisible();
			await expect(page.locator('#hero-meta')).toHaveText('FOR A COMPUTER · WINDOWS AND LINUX');
		});
	});

	test.describe('on a TV', () => {
		test.use({ userAgent: UA.tv });

		test('the TV app leads, tagged and on the accent', async ({ page }) => {
			await page.setContent(html);
			await expect(page.locator('html')).toHaveAttribute('data-os', 'tv');
			expect(await rowOrder(page)).toEqual(['android-tv', 'android', 'windows', 'linux', 'mac']);
			expect(await visibleTags(page)).toEqual(['android-tv']);
			expect(await accented(page)).toEqual(['android-tv']);
			await expect(page.locator('.dl-band')).toBeHidden();
			await expect(page.locator('#hero-meta')).toHaveText('ANDROID TV · THE APP');
		});
	});
});

test.describe('the visitor’s system', () => {
	test('Windows leads, tagged, its installer on the accent', async ({ page }) => {
		await as(page, 'windows');
		await page.goto('/');
		expect(await rowOrder(page)).toEqual(['windows', 'linux', 'mac']);
		expect(await visibleTags(page)).toEqual(['windows']);
		expect(await accented(page)).toEqual(['windows']);
		await expect(page.locator('#hero-download')).toHaveText('↓ DOWNLOAD FOR WINDOWS');
	});

	test('Linux leads and takes the accent', async ({ page }) => {
		await as(page, 'linux');
		await page.goto('/');
		expect(await rowOrder(page)).toEqual(['linux', 'windows', 'mac']);
		expect(await visibleTags(page)).toEqual(['linux']);
		expect(await accented(page)).toEqual(['linux']);
		await expect(page.locator('#hero-download')).toHaveText('↓ DOWNLOAD FOR LINUX');
	});

	test('macOS leads, dimmed, with no accent in the block', async ({ page }) => {
		await as(page, 'mac');
		await page.goto('/');
		expect(await rowOrder(page)).toEqual(['mac', 'windows', 'linux']);
		expect(await visibleTags(page)).toEqual(['mac']);
		expect(await accented(page)).toEqual([]);
		await expect(page.locator('.dl-row[data-os="mac"]')).toHaveCSS('opacity', '0.4');
		await expect(page.locator('#hero-meta')).toHaveText('WINDOWS AND LINUX · NOT YET FOR MACOS');
	});

	test('a phone gets the band and the static order', async ({ page }) => {
		await as(page, 'phone');
		await page.goto('/');
		await expect(page.locator('.dl-band')).toBeVisible();
		expect(await rowOrder(page)).toEqual(['windows', 'linux', 'mac']);
		expect(await visibleTags(page)).toEqual([]);
		expect(await page.locator('.dl-row[data-os^="android"]').count()).toBe(0);
		await expect(page.locator('#hero-meta')).toHaveText('FOR A COMPUTER · WINDOWS AND LINUX');
	});

	test('an iPhone gets the band and the desktop order, and is not a phone', async ({ page }) => {
		await as(page, 'ios');
		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('data-os', 'ios');
		await expect(page.locator('.dl-band')).toBeVisible();
		expect(await rowOrder(page)).toEqual(['windows', 'linux', 'mac']);
		expect(await visibleTags(page)).toEqual([]);
		expect(await accented(page)).toEqual(['windows']);
		await expect(page.locator('#hero-meta')).toHaveText('FOR A COMPUTER · WINDOWS AND LINUX');
	});

	test('an iPad asking for the desktop page is iOS, not a phone', async ({ page }) => {
		// iPadOS reports a Mac UA; only the touch screen gives it away (site.js).
		await page.addInitScript((ua) => {
			Object.defineProperty(navigator, 'userAgent', { get: () => ua });
			Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
			Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
		}, UA.mac);
		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('data-os', 'ios');
		await expect(page.locator('.dl-band')).toBeVisible();
		expect(await rowOrder(page)).toEqual(['windows', 'linux', 'mac']);
		expect(await visibleTags(page)).toEqual([]);
		expect(await accented(page)).toEqual(['windows']);
	});
});

test.describe('theme', () => {
	test.use({ colorScheme: 'dark' });

	test('follows the system, then the header’s cell, and remembers it', async ({ page }) => {
		await page.goto('/');
		const button = page.locator('.bar-theme');
		await expect(button).toHaveText('/LIGHT');
		await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(14, 15, 16)');
		await button.click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		await expect(button).toHaveText('/DARK');
		await expect(page.locator('.cap-light').first()).toBeVisible();
		await expect(page.locator('.cap-dark').first()).toBeHidden();
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		await expect(page.locator('.bar-theme')).toHaveText('/DARK');
	});

	test('a light system gets Paper / ink with no script at all', async ({ browser }) => {
		const context = await browser.newContext({ colorScheme: 'light', javaScriptEnabled: false });
		const page = await context.newPage();
		await page.goto(test.info().project.use.baseURL + '/');
		await expect(page.locator('.cap-light').first()).toBeVisible();
		await expect(page.locator('.cap-dark').first()).toBeHidden();
		await context.close();
	});
});

test('nothing loads from anywhere but the page’s own host', async ({ page }) => {
	const hosts = new Set<string>();
	page.on('request', (r) => hosts.add(new URL(r.url()).host));
	await page.goto('/');
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await page.waitForLoadState('networkidle');
	expect([...hosts]).toEqual([new URL(page.url()).host]);
});

test('every image has its size, and the fonts are the self-hosted ones', async ({ page }) => {
	await page.goto('/');
	const unsized = await page
		.locator('img')
		.evaluateAll(
			(imgs) => imgs.filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).length
		);
	expect(unsized).toBe(0);
	await page.evaluate(() => document.fonts.ready);
	const loaded = await page.evaluate(() =>
		[...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`)
	);
	expect(loaded).toEqual(
		expect.arrayContaining(['IBM Plex Mono 500', 'IBM Plex Sans 500', 'IBM Plex Sans JP 500'])
	);
});

/** Grid tracks as resolved pixels. */
const tracks = (page: Page, sel: string) =>
	page
		.locator(sel)
		.first()
		.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat));
const css = (page: Page, sel: string, prop: string) =>
	page
		.locator(sel)
		.first()
		.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.describe('the frame, desktop', () => {
	test.beforeEach(() => test.skip(test.info().project.name !== 'desktop'));

	test('header, sections, and their gutters', async ({ page }) => {
		await page.goto('/');
		expect(await css(page, '.bar', 'height')).toBe('56px');
		await expect(page.locator('.bar-nav a')).toHaveCount(6);
		expect(await css(page, '.bar-nav a', 'padding-left')).toBe('16px');
		expect(await css(page, '.sec', 'max-width')).toBe('1200px');
		expect(await css(page, '.sec', 'padding-left')).toBe('24px');
		expect(await css(page, '#look', 'padding-top')).toBe('56px');
		expect(await css(page, '.sec-head', 'padding-top')).toBe('24px');
		expect(await css(page, '.sec-head', 'padding-bottom')).toBe('12px');
		expect(await css(page, 'h1', 'font-size')).toBe('48px');
	});

	test('the grids keep the handoff’s tracks', async ({ page }) => {
		await page.goto('/');
		const hero = await tracks(page, '.hero');
		expect(hero[0] / hero[1]).toBeCloseTo(5 / 7, 2);
		expect(await css(page, '.hero', 'column-gap')).toBe('48px');
		expect((await tracks(page, '.card-defs'))[0]).toBe(40);
		const look = await tracks(page, '.look');
		expect(look[1]).toBeCloseTo(look[2], 1);
		expect(look[0] / look[1]).toBeCloseTo(10 / 7.2, 2);
		expect((await tracks(page, '.does'))[1]).toBe(380);
		expect((await tracks(page, '.feature'))[0]).toBe(160);
		expect((await tracks(page, '.dl-row'))[0]).toBe(220);
		const start = await tracks(page, '.start');
		expect(start[0] / start[1]).toBeCloseTo(7 / 5, 2);
		expect((await tracks(page, '.steps li'))[0]).toBe(48);
		expect((await tracks(page, '.msteps li'))[0]).toBe(44);
		expect((await tracks(page, '.data-row'))[0]).toBe(120);
		const foot = await tracks(page, '.foot');
		expect(foot).toHaveLength(4);
		expect(foot[1] / foot[0]).toBeCloseTo(2, 1);
	});

	test('controls are at least 44px, the hero’s 48px', async ({ page }) => {
		await page.goto('/');
		for (const b of await page.locator('.dl-rows .btn, .dl-solver .btn, .dl-older').all())
			expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		for (const b of await page.locator('.btn-hero').all())
			expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(48);
	});
});

test.describe('the frame, phone', () => {
	test.beforeEach(() => test.skip(test.info().project.name !== 'phone'));

	test('one column at 16px gutters, nothing scrolls sideways', async ({ page }) => {
		await page.goto('/');
		expect(await css(page, '.bar', 'height')).toBe('48px');
		await expect(page.locator('.bar-nav')).toBeHidden();
		expect(await css(page, '.sec', 'padding-left')).toBe('16px');
		expect(await css(page, '#look', 'padding-top')).toBe('40px');
		expect(await css(page, 'h1', 'font-size')).toBe('32px');
		for (const sel of [
			'.hero',
			'.does',
			'.start',
			'.dl-row',
			'.dl-lower',
			'.halves',
			'.foot',
			'.feature'
		])
			expect(await tracks(page, sel), sel).toHaveLength(1);
		expect(await tracks(page, '.look')).toHaveLength(2);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});

	test('download buttons take the row', async ({ page }) => {
		await page.goto('/');
		const width = (await page.locator('.dl-body').first().boundingBox())!.width;
		const btn = (await page.locator('.dl-body .btn').first().boundingBox())!.width;
		expect(btn).toBeGreaterThan(width - 40);
	});
});
