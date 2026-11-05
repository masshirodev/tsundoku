import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The pairing page on a phone and a tablet (c521; doc/PHONE-APP.md): the file
 * the APK ships (android/tv/app/src/main/assets/pair), opened with a stand-in
 * for the phone app's bridge, whose `form()` says "mobile". The TV's own frame
 * on the same file is tests/tv-app-pair.e2e.ts's, and stays exactly as it was.
 *
 * The measurements are the handoff's literals (PhoneApp-Phone.dc.html,
 * PhoneApp-Tablet.dc.html). They are asserted rather than eyeballed so that a
 * later pass tidying hand-set values onto a spacing ladder redraws nothing
 * silently. The camera band and the gesture strip the design draws inside its
 * frame are the app's padding (Insets.kt, InsetsTest.kt), so the page itself
 * starts at the header here.
 *
 * Every test sets its own viewport and screen, so the file says the same thing
 * in whichever device project runs it.
 */
const page9 = pathToFileURL(
	join(process.cwd(), 'android/tv/app/src/main/assets/pair/index.html')
).href;

type Stub = { probes: string[]; surfaces: string[] };

declare global {
	interface Window {
		__phone?: Stub;
		TsundokuTV?: Record<string, unknown>;
		tsundokuProbe?: (at: string, ok: boolean) => void;
	}
}

/** The phone app's bridge, before the page's script runs: PairingBridge.kt with form() "mobile". */
async function phoneBridge(page: Page, o: { network?: string; own?: string } = {}) {
	await page.addInitScript(
		({ network, own }: { network: string; own: string }) => {
			const state: Stub = { probes: [], surfaces: [] };
			window.__phone = state;
			window.TsundokuTV = {
				form: () => 'mobile',
				network: () => network,
				tvAddress: () => own,
				prefix: () => (own ? own.split('.').slice(0, 3).join('.') + '.' : ''),
				defaultPort: () => 42143,
				remembered: () => '',
				servers: () => '[]',
				remember: () => {},
				surface: (css: string) => {
					state.surfaces.push(css);
				},
				probe: (at: string) => {
					state.probes.push(at);
					setTimeout(() => window.tsundokuProbe?.(at, false), 50);
				}
			};
		},
		{ network: o.network ?? 'home', own: o.own ?? '192.168.1.40' }
	);
}

const box = (page: Page, selector: string) =>
	page.locator(selector).evaluate((el) => {
		const r = el.getBoundingClientRect();
		return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
	});

const css = (page: Page, selector: string, prop: string) =>
	page.locator(selector).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.describe('on a phone, 360 x 780', () => {
	test.use({ viewport: { width: 360, height: 780 }, screen: { width: 360, height: 780 } });

	test('9A is the phone column: the device word, the short header, START at the bottom', async ({
		page
	}) => {
		await phoneBridge(page);
		await page.goto(page9);
		await expect(page.locator('html')).toHaveAttribute('data-form', 'mobile');
		await expect(page.locator('html')).toHaveAttribute('data-device', 'phone');
		await expect(page.locator('#welcome h1')).toHaveText('Read in the app');
		await expect(page.locator('#welcome p')).toContainText('This phone opens the library');
		await expect(page.locator('#step')).toHaveText('PAIR');
		// 積ん読 and the long step don't fit 360 at 130% (the design's THE FRAME).
		await expect(page.locator('.wm span')).toBeHidden();
		await expect(page.locator('.steps > div').nth(1).locator('.t')).toHaveText('FOR THE APP');

		// The header: 56, its step in a cell of its own.
		expect((await box(page, '.bar')).height).toBe(56);
		expect(await css(page, '.step', 'border-left-width')).toBe('1px');

		// The steps stack in one closed box, the number in a 44 px cell.
		const n = await box(page, '.steps > div:first-child .n');
		// 44 with its rule inside: this page sizes boxes border-box, as the TV's
		// cells always were (the mock's content-box draws 45).
		expect(n.right - n.left).toBe(44);
		const first = await box(page, '.steps > div:nth-child(1)');
		const second = await box(page, '.steps > div:nth-child(2)');
		expect(second.top).toBeGreaterThanOrEqual(first.bottom - 1);

		// START is full width at the bottom, the Tailscale line just above it.
		const start = await box(page, '#start');
		expect(start.bottom).toBe(780 - 12);
		expect(start.right - start.left).toBe(360 - 32);
		expect(start.height).toBeGreaterThanOrEqual(56);
		const meta = await box(page, '.welcome-actions .meta');
		expect(meta.bottom).toBeLessThanOrEqual(start.top);
	});

	test('9B: the field takes focus, http:// is dropped, NEXT is pinned to the bottom', async ({
		page
	}) => {
		await phoneBridge(page);
		await page.goto(page9);
		await page.locator('#start').click();
		await expect(page.locator('#step')).toHaveText('PAIR · 1 OF 2');
		// A phone's keyboard pushes the page up instead of covering it, so the
		// field takes focus at once (the TV never does: c247).
		await expect(page.locator('#last')).toBeFocused();
		await expect(page.locator('#prefix')).toHaveText('192.168.1.');
		await expect(page.locator('#tv-meta')).toHaveText(
			'THIS PHONE IS AT 192.168.1.40, SO THE COMPUTER IS 192.168.1.SOMETHING'
		);
		expect((await box(page, '#address-form')).height).toBe(64);

		// TYPE THE WHOLE ADDRESS sits with the field, under the meta line; NEXT
		// is the bottom button.
		const meta = await box(page, '#tv-meta');
		const toggle = await box(page, '#whole-toggle');
		const next = await box(page, '#next');
		expect(toggle.top).toBeGreaterThan(meta.bottom);
		expect(toggle.height).toBe(48);
		expect(next.bottom).toBe(780 - 12);

		// The keyboard opens: the app pads the WebView by it (Insets.kt), which
		// a browser sees as a shorter viewport. NEXT rides the keyboard's top edge.
		await page.setViewportSize({ width: 360, height: 430 });
		const riding = await box(page, '#next');
		expect(riding.bottom).toBe(430 - 12);
	});

	test('9B: the whole address keeps the field and reads USE THE LAST NUMBER', async ({ page }) => {
		await phoneBridge(page);
		await page.goto(page9);
		await page.locator('#start').click();
		await page.locator('#whole-toggle').click();
		await expect(page.locator('#prefix')).toBeHidden();
		await expect(page.locator('#whole-toggle')).toHaveText('USE THE LAST NUMBER');
		await expect(page.locator('#last')).toHaveAttribute('inputmode', 'url');
		await expect(page.locator('#last')).toBeFocused();
	});

	test('9D: the band wraps, the reasons are one box, TRY AGAIN is the bottom button', async ({
		page
	}) => {
		await phoneBridge(page);
		await page.goto(page9 + '#lost=' + encodeURIComponent('http://192.168.1.23:42143'));
		await expect(page.locator('#lost-title')).toHaveText('○ NOTHING ANSWERS AT 192.168.1.23:42143');
		expect(await css(page, '#lost-title', 'white-space')).toBe('normal');
		await expect(page.locator('#reason-3')).toHaveText(
			"This phone is on another Wi-Fi: it's at 192.168.1.40, not 192.168.1."
		);
		const retry = await box(page, '#retry');
		const change = await box(page, '#change');
		expect(retry.bottom).toBe(780 - 12);
		expect(change.bottom).toBeLessThanOrEqual(retry.top);
	});

	test('9D on mobile data: reason 3 says so and names both ways out', async ({ page }) => {
		await phoneBridge(page, { network: 'data', own: '' });
		await page.goto(page9 + '#lost=' + encodeURIComponent('http://192.168.1.23:42143'));
		await expect(page.locator('#reason-3')).toHaveText(
			"This phone isn't on a Wi-Fi, so it's on mobile data: connect it to the computer's Wi-Fi, or type a Tailscale address"
		);
	});

	test("the page tells the app its colour, and follows the phone's light setting", async ({
		page
	}) => {
		await phoneBridge(page);
		// A headless browser prefers light unless told; the phone here is dark.
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto(page9);
		await expect
			.poll(() => page.evaluate(() => window.__phone!.surfaces.at(-1)))
			.toBe('rgb(14, 15, 16)');
		await page.emulateMedia({ colorScheme: 'light' });
		await expect
			.poll(() => page.evaluate(() => window.__phone!.surfaces.at(-1)))
			.toMatch(/^rgb\(24[45], 24[345], 2(39|40)\)$/);
	});

	test("a finger shows no focus mark; zoom is the WebView's to refuse, and the page says manipulation", async ({
		page
	}) => {
		await phoneBridge(page);
		await page.goto(page9);
		await page.locator('#start').click();
		await page.locator('#whole-toggle').click();
		expect(await css(page, '#whole-toggle', 'box-shadow')).toBe('none');
		expect(await css(page, 'html', 'touch-action')).toBe('manipulation');
	});
});

test.describe('on a tablet, 1280 x 800', () => {
	test.use({ viewport: { width: 1280, height: 800 }, screen: { width: 1280, height: 800 } });

	test("9A is the TV's arrangement in flow: three steps across, START beside its line", async ({
		page
	}) => {
		await phoneBridge(page);
		await page.goto(page9);
		await expect(page.locator('html')).toHaveAttribute('data-device', 'tablet');
		await expect(page.locator('#step')).toHaveText('PAIR THIS TABLET');
		await expect(page.locator('#welcome p')).toContainText('This tablet opens the library');
		await expect(page.locator('.wm span')).toBeVisible();
		expect((await box(page, '.bar')).height).toBe(64);
		// The number reads inline again: "01 — ON THE COMPUTER".
		await expect(page.locator('.steps > div').first().locator('.lab')).toHaveText(
			'01 — ON THE COMPUTER'
		);
		const tops = await page
			.locator('.steps > div')
			.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
		expect(new Set(tops).size).toBe(1);
		const start = await box(page, '#start');
		const meta = await box(page, '.welcome-actions .meta');
		expect(meta.left).toBeGreaterThan(start.right);
		// The 24 px page margin, and the 36 px top of landscape.
		expect(start.left).toBe(24);
		expect((await box(page, '.welcome-head')).top).toBe(64 + 36);
	});

	test('9B keeps http:// and puts both buttons side by side under the field', async ({ page }) => {
		await phoneBridge(page);
		await page.goto(page9);
		await page.locator('#start').click();
		await expect(page.locator('#prefix')).toHaveText('http://192.168.1.');
		expect((await box(page, '#address-form')).height).toBe(72);
		const next = await box(page, '#next');
		const toggle = await box(page, '#whole-toggle');
		expect(toggle.top).toBe(next.top);
		expect(toggle.left).toBe(next.right + 16);
		// The keyboard leaves 450 px in landscape, and both buttons sit above it.
		await page.setViewportSize({ width: 1280, height: 450 });
		expect((await box(page, '#next')).bottom).toBeLessThanOrEqual(450);
	});

	test("a hardware keyboard's digits type into the field wherever focus is", async ({ page }) => {
		await phoneBridge(page);
		await page.goto(page9);
		await page.locator('#start').click();
		await page.locator('#next').focus();
		await page.keyboard.press('2');
		await page.keyboard.press('3');
		await expect(page.locator('#last')).toHaveValue('23');
	});

	test('9D: TRY AGAIN first, beside CHANGE THE ADDRESS, under the reasons', async ({ page }) => {
		await phoneBridge(page);
		await page.goto(page9 + '#lost=' + encodeURIComponent('http://192.168.1.23:42143'));
		const retry = await box(page, '#retry');
		const change = await box(page, '#change');
		expect(change.top).toBe(retry.top);
		expect(change.left).toBeGreaterThan(retry.right);
		expect(retry.top).toBeGreaterThan((await box(page, '.reasons')).bottom);
	});
});

test.describe('on a tablet in portrait, 800 x 1280', () => {
	test.use({ viewport: { width: 800, height: 1280 }, screen: { width: 800, height: 1280 } });

	test('the page starts 48 below the header', async ({ page }) => {
		await phoneBridge(page);
		await page.goto(page9);
		expect((await box(page, '.welcome-head')).top).toBe(64 + 48);
	});
});

test.describe('a phone turned on its side, 780 x 360', () => {
	test.use({ viewport: { width: 780, height: 360 }, screen: { width: 780, height: 360 } });

	test("is still a phone in its words, laid out as a tablet's", async ({ page }) => {
		await phoneBridge(page);
		await page.goto(page9);
		await expect(page.locator('html')).toHaveAttribute('data-device', 'phone');
		await expect(page.locator('#welcome p')).toContainText('This phone opens');
		await expect(page.locator('.wm span')).toBeVisible();
	});
});

test.describe('the TV, with no form from its bridge', () => {
	test.use({ viewport: { width: 960, height: 540 }, screen: { width: 1920, height: 1080 } });

	test("keeps its words and its 960 frame; only step 02's label is the app's", async ({ page }) => {
		await page.goto(page9);
		await expect(page.locator('html')).toHaveAttribute('data-form', 'tv');
		await expect(page.locator('#welcome h1')).toHaveText('Read from the couch');
		await expect(page.locator('#welcome p')).toContainText('This TV opens the library');
		await expect(page.locator('#step')).toHaveText('PAIR THIS TV');
		await expect(page.locator('.steps > div').nth(1).locator('.lab')).toHaveText(
			'02 — FOR THE APP'
		);
		expect((await box(page, 'main')).right - (await box(page, 'main')).left).toBe(960);
		expect(await css(page, '.bar', 'position')).toBe('absolute');
	});
});
