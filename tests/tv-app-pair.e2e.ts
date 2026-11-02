import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The APK's own first screens (9A, 9B; android/tv/app/src/main/assets/pair),
 * opened from the file the app ships, with no bridge: a remote, 960x540.
 */
const page9 = pathToFileURL(
	join(process.cwd(), 'android/tv/app/src/main/assets/pair/index.html')
).href;

test('START opens 9B on NEXT, so no number pad covers the buttons (c247)', async ({ page }) => {
	await page.goto(page9);
	await page.keyboard.press('Enter'); // START →

	// A text field that takes focus is what asks the WebView for the TV's
	// number pad, and the pad covers both buttons. The mark lands on NEXT
	// instead, so a remote without number keys can reach the whole-address
	// escape with one press down, having dismissed nothing.
	await expect(page.locator('#next')).toBeFocused();
	await expect(page.locator('#last')).not.toBeFocused();

	await page.keyboard.press('ArrowDown');
	await expect(page.locator('#whole-toggle')).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator('#prefix')).toBeHidden();
	await expect(page.locator('#last')).toBeFocused();
});

test("a remote's number keys type into the field without the pad (c247)", async ({ page }) => {
	await page.goto(page9);
	await page.keyboard.press('Enter'); // START →, the mark on NEXT

	// The number keys used to need the field's focus, which is the same thing
	// that opens the pad. They now land in the field wherever the mark is.
	await page.keyboard.press('2');
	await page.keyboard.press('3');
	await expect(page.locator('#last')).toHaveValue('23');
	await expect(page.locator('#next')).toBeFocused();

	// And NEXT still probes what was typed (no bridge here, as on a desktop).
	await page.keyboard.press('Enter');
	await expect(page.locator('#checking')).toContainText('THE APP BRIDGE IS MISSING');
});

test('TYPE THE WHOLE ADDRESS keeps a field to type it in, reachable from the buttons', async ({
	page
}) => {
	await page.goto(page9);
	await page.keyboard.press('Enter'); // START →
	const field = page.locator('#last');
	await expect(field).toBeVisible();
	await expect(page.locator('#prefix')).toBeVisible();

	await page.locator('#whole-toggle').focus();
	await page.keyboard.press('Enter');
	// The prefix and the port go; the field stays and takes the whole address
	// (2026-11-02: it was hidden with them, so Tailscale had nothing to type in).
	await expect(page.locator('#prefix')).toBeHidden();
	await expect(page.locator('#port')).toBeHidden();
	await expect(field).toBeVisible();
	await expect(field).toBeFocused();
	await page.keyboard.type('https://name.ts.net:8443');
	await expect(field).toHaveValue('https://name.ts.net:8443');
	await expect(page.locator('#tv-meta')).toContainText('OVER TAILSCALE');

	// ↑ from the buttons comes back to it.
	await page.locator('#next').focus();
	await page.keyboard.press('ArrowUp');
	await expect(field).toBeFocused();
});

test("9A and 9D keep a friend's WI-FI remedy beside a tailnet install's truth (c245)", async ({
	page
}) => {
	await page.goto(page9);

	// 9A step 01. A friend's install starts with WI-FI OFF and the six digits
	// only render inside its panel, so the step must still name the switch; a
	// tailnet install has no switch at all, so it must not send anyone to one.
	const step = page.locator('#welcome .steps > div').first();
	await expect(step.locator('.lab')).toHaveText('01 — ON THE COMPUTER');
	await expect(step).toContainText('SETTINGS › 08 — DEVICES');
	await expect(step).toContainText('WI-FI ON');
	await expect(step).toContainText('Tailscale');

	// 9D reason 2, on the screen a TV reaches when nothing answers: the same
	// two installs fail in different ways, and WI-FI OFF is still one of them.
	const reason = page.locator('#lost .reasons .reason').nth(1);
	await expect(reason.locator('.n')).toHaveText('2');
	await expect(reason).toContainText('WI-FI is off');
	await expect(reason).toContainText('no six digits');
	await expect(reason).toContainText('address changed');
});

test('a given address is checked without 9A or 9B (c260)', async ({ page }) => {
	const origin = 'https://zen.tailnet.ts.net:8443';
	await page.goto(`${page9}#connect=${encodeURIComponent(origin)}`);

	// The app was handed an address, so nobody types one: neither the welcome
	// screen nor the address field is on the way. The checking line names what
	// is being checked, and there is no bridge in a desktop browser.
	await expect(page.locator('#start')).toBeHidden();
	await expect(page.locator('#next')).toBeHidden();
	await expect(page.locator('#connect')).toBeVisible();
	await expect(page.locator('#connect-line')).toContainText('zen.tailnet.ts.net:8443');
	await expect(page.locator('#connect-line')).toContainText('THE APP BRIDGE IS MISSING');
	// The step still says which half of pairing this is, so the page has not
	// fallen back to 9A while the probe is unanswered.
	await expect(page.locator('#step')).toHaveText('PAIR THIS TV · 1 OF 2');
	await expect(page.locator('#start')).toBeHidden();
});

test('a refused address shows the band on 9B and leaves it usable (c260)', async ({ page }) => {
	await page.goto(`${page9}#bad=${encodeURIComponent('ftp://zen.local')}`);

	// The activity refused it, so 9B is where the TV lands: the field empty,
	// the band saying nothing was saved, the mark on NEXT.
	await expect(page.locator('#address-form')).toBeVisible();
	await expect(page.locator('#start')).toBeHidden();
	const band = page.locator('#refused');
	await expect(band).toBeVisible();
	await expect(band).toContainText('THAT ADDRESS WAS REFUSED');
	await expect(band).toContainText('NOTHING WAS SAVED');
	await expect(page.locator('#last')).toHaveValue('');
	await expect(page.locator('#next')).toBeFocused();

	// The band ends above the label, and every box ends inside the 540 frame:
	// this is 9C's with-band rhythm, not sizes invented here (c246).
	const bandBox = await band.boundingBox();
	const labelBox = await page.locator('#address .address-label').boundingBox();
	const fieldBox = await page.locator('#address-form').boundingBox();
	const actionsBox = await page.locator('#address .address-actions').boundingBox();
	const checkingBox = await page.locator('#checking').boundingBox();
	expect(bandBox).not.toBeNull();
	expect(labelBox).not.toBeNull();
	expect(fieldBox).not.toBeNull();
	expect(actionsBox).not.toBeNull();
	expect(checkingBox).not.toBeNull();
	expect(bandBox!.y + bandBox!.height).toBeLessThanOrEqual(labelBox!.y);
	expect(fieldBox!.y + fieldBox!.height).toBeLessThanOrEqual(540);
	expect(actionsBox!.y + actionsBox!.height).toBeLessThanOrEqual(540);
	expect(checkingBox!.y).toBeLessThanOrEqual(540);

	// The screen is still the address screen: the whole-address escape works.
	await page.locator('#whole-toggle').click();
	await expect(page.locator('#last')).toBeVisible();
	await page.locator('#last').fill('https://zen.tailnet.ts.net:8443');
	await page.locator('#next').click();
	await expect(page.locator('#checking')).toContainText('THE APP BRIDGE IS MISSING');
});
