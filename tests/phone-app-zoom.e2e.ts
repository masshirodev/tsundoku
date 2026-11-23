import { devices, type Page } from '@playwright/test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from './fixtures';

/**
 * Zoom is off in the Android app (doc/ANDROID.md, "Zoom is off"). The
 * WebView's setSupportZoom(false) is not enough on every WebView build (a
 * LineageOS tablet pinched every screen anyway), so in the app the page pins
 * its own viewport scale to 1 (src/app.html). A browser keeps its pinch.
 *
 * The pinch is Chromium's own synthetic gesture, so it goes through the same
 * page-scale limits a finger's does. It is sent as a mouse's (a touchpad
 * pinch): headless Chromium drops a touch-sourced one, leaving the scale at 1
 * whatever the page says. The browser case is the control: it proves the
 * gesture scales the page here at all, so the app's 1 means something.
 */
test.use({ serviceWorkers: 'block' });

const APP_UA = `${devices['Pixel 7'].userAgent} TsundokuApp/2026.11.21`;

async function pinchOut(page: Page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.synthesizePinchGesture', {
		x: 195,
		y: 400,
		scaleFactor: 2.5,
		gestureSourceType: 'mouse'
	});
	await cdp.detach();
	// The scale lands a frame or two after the gesture's promise resolves.
	await page.waitForTimeout(300);
	return page.evaluate(() => window.visualViewport?.scale ?? 1);
}

const viewport = (page: Page) => page.locator('meta[name="viewport"]').getAttribute('content');

test.describe('in the app', () => {
	test.use({ userAgent: APP_UA });

	test('the viewport cannot be scaled, and a pinch leaves the library at 1', async ({ page }) => {
		await page.goto('/');
		const content = await viewport(page);
		expect(content).toContain('maximum-scale=1');
		expect(content).toContain('minimum-scale=1');
		expect(content).toContain('user-scalable=no');
		expect(content).toContain('viewport-fit=cover');
		expect(await pinchOut(page)).toBe(1);
	});
});

test.describe('the pairing page the APK ships', () => {
	// android/app/src/main/assets/pair: opened only inside the app, so it pins
	// its own scale in the file, whatever the user agent.
	const pairPage = pathToFileURL(
		join(process.cwd(), 'android/app/src/main/assets/pair/index.html')
	).href;

	test('its viewport cannot be scaled, and a pinch leaves it at 1', async ({ page }) => {
		await page.goto(pairPage);
		const content = await viewport(page);
		expect(content).toContain('maximum-scale=1');
		expect(content).toContain('minimum-scale=1');
		expect(content).toContain('user-scalable=no');
		expect(await pinchOut(page)).toBe(1);
	});
});

test.describe('in a browser', () => {
	test('the viewport is left scalable, and a pinch zooms the page', async ({ page }) => {
		await page.goto('/');
		expect(await viewport(page)).toBe('width=device-width, initial-scale=1, viewport-fit=cover');
		expect(await pinchOut(page)).toBeGreaterThan(1);
	});
});
