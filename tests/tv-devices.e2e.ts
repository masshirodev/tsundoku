import { expect, test } from './fixtures';

/**
 * A TV is its own kind in DEVICES (c244; doc/SETTINGS.md, "How a device is
 * kept"): `/api/devices/sync` accepts it, where it used to answer 400 and the
 * page never went quiet (tv-screens' reveal spec timed out on it).
 *
 * The only write is one device row under a fixed id of this card's own, so no
 * other spec's row is touched; a device row has no delete of its own (a browser
 * that clears its storage is a new one), and the suite seeds a fresh database
 * each run.
 */

const TV_UA =
	'Mozilla/5.0 (Linux; Android 9; BRAVIA 4K GB) AppleWebKit/537.36 (KHTML, like Gecko) ' +
	'Version/4.0 Chrome/94.0.4606.80 Mobile Safari/537.36 TsundokuTV/1.0.0';

const ID = 'c244-0000-0000-0000-000000000001';

test('a TV’s check-in is accepted, and DEVICES calls it a TV', async ({ page }) => {
	await page.goto('/settings');
	const res = await page.request.post('/api/devices/sync', {
		data: {
			id: ID,
			// What the page says of itself: a TV's screen with no pointer is only a
			// screen, so the app's own user agent is what makes it a TV.
			kind: 'desktop',
			settings: { 'tsundoku.reader.fit': { v: 'width', at: Date.now() } }
		},
		headers: { 'user-agent': TV_UA }
	});
	expect(res.status()).toBe(200);
	await page.reload();
	// The app says itself where a browser's name was, and its label cell says
	// TV · APP (c521; PhoneApp-Calls.dc.html, DEVICES).
	const row = page.locator('.row.device', { hasText: 'Android TV · app 1.0.0' });
	await expect(row).toBeVisible();
	await expect(row.locator('.label')).toHaveText('TV · APP');
});
