import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The APK's own first screens (9A, 9B; android/tv/app/src/main/assets/pair),
 * opened from the file the app ships, with no bridge: a remote, 960x540.
 */
const page9 = pathToFileURL(
	join(process.cwd(), 'android/tv/app/src/main/assets/pair/index.html')
).href;

type StubBridge = {
	/** Every origin the page asked the bridge to probe, in order. */
	probes: string[];
	/** Every origin the page stored. */
	remembered: string[];
	/** The probe last handed over, for a test that answers it itself. */
	pending: string;
};

declare global {
	interface Window {
		__bridge?: StubBridge;
		__bridgeRemembered?: (at: string) => Promise<void>;
		TsundokuTV?: Record<string, unknown>;
		tsundokuProbe?: (at: string, ok: boolean) => void;
	}
}

/**
 * The APK's bridge (PairingBridge.kt) stood up before the page's script runs,
 * so the states only the real app reaches are reachable here too: a probe in
 * flight while a second launch arrives is exactly what c260's round 2 is
 * about, and a file:// page has no bridge to hold one.
 *
 * A probe answers `false` after ~50 ms, as a LAN nobody answers does. `hold`
 * leaves it on `window.__bridge.pending` instead, so the test decides when and
 * what the answer is.
 *
 * What `remember` was called with is also kept on this side of the page: a
 * superseded answer stores its address immediately before the navigation that
 * answer would cause, and a navigation takes the page's own record with it.
 */
async function stubBridge(page: Page, options: { hold?: boolean } = {}) {
	const remembered: string[] = [];
	await page.exposeFunction('__bridgeRemembered', (at: string) => {
		remembered.push(at);
	});
	await page.addInitScript((hold: boolean) => {
		const state: StubBridge = { probes: [], remembered: [], pending: '' };
		window.__bridge = state;
		window.TsundokuTV = {
			tvAddress: () => '192.168.1.31',
			prefix: () => '192.168.1.',
			defaultPort: () => 42143,
			remembered: () => state.remembered[state.remembered.length - 1] ?? '',
			remember: (at: string) => {
				state.remembered.push(at);
				void window.__bridgeRemembered?.(at);
			},
			forget: () => {
				state.remembered = [];
			},
			probe: (at: string) => {
				state.probes.push(at);
				state.pending = at;
				if (!hold) setTimeout(() => window.tsundokuProbe?.(at, false), 50);
			}
		};
	}, options.hold ?? false);
	return { remembered };
}

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

test('a refused address stops the 9D retry, so the refusal stays (c260)', async ({ page }) => {
	await stubBridge(page);
	// A friend whose LAN probe failed is the case doc/TV-APP.md sends here:
	// the TV is already retrying something nobody answers.
	await page.goto(`${page9}#lost=${encodeURIComponent('http://192.168.1.99:42143')}`);
	// 9D itself has no height of its own (its blocks are positioned), so its
	// buttons are what a person can see — and what a stolen screen takes away.
	await expect(page.locator('#retry')).toBeVisible();
	await expect(page.locator('#lost-title')).toContainText('NOTHING ANSWERS');

	await page.evaluate(() => {
		location.hash = '#bad=' + encodeURIComponent('zen.local:42143');
	});
	await expect(page.locator('#refused')).toBeVisible();
	await expect(page.locator('#address-form')).toBeVisible();
	await expect(page.locator('#retry')).toBeHidden();
	const probesWhenRefused = await page.evaluate(() => window.__bridge!.probes.length);

	// One retry tick is 5 s. 9B is a second door into this screen, and the
	// timer outlives it unless refused() stops it: the tick would probe the
	// old origin, fail, and replace the refusal with 9D for it.
	await page.waitForTimeout(5600);
	await expect(page.locator('#refused')).toBeVisible();
	await expect(page.locator('#address-form')).toBeVisible();
	await expect(page.locator('#retry')).toBeHidden();
	const afterRefusal = await page.evaluate(
		(from) => window.__bridge!.probes.slice(from),
		probesWhenRefused
	);
	expect(afterRefusal).toEqual([]);
	// 9B starts clean on this door too (d0d217d): nothing is left disabled.
	await expect(page.locator('#next')).toBeEnabled();
	await expect(page.locator('#checking')).toHaveText('');
});

test('a probe a given address superseded neither stores nor navigates (c260)', async ({ page }) => {
	const bridge = await stubBridge(page, { hold: true });
	await page.goto(page9);
	// Nothing real lives at the typed address; if the superseded answer still
	// wins, its /pair/tv is a request this test must see, not dial.
	await page.route('http://192.168.1.23:42143/**', (route) => route.abort());
	await page.keyboard.press('Enter'); // START → 9B, the mark on NEXT
	await page.keyboard.press('2');
	await page.keyboard.press('3');
	await page.keyboard.press('Enter'); // NEXT: probes the typed address, held

	const typed = 'http://192.168.1.23:42143';
	await expect.poll(() => page.evaluate(() => window.__bridge!.pending)).toBe(typed);

	// A second launch hands the app another address while that probe is in
	// flight. It now supersedes the typed one, whose answer must be dropped.
	const given = 'https://zen.tailnet.ts.net:8443';
	await page.evaluate((at) => {
		location.hash = '#connect=' + encodeURIComponent(at);
	}, given);
	await expect(page.locator('#connect')).toBeVisible();
	await expect(page.locator('#connect-line')).toContainText('zen.tailnet.ts.net:8443');
	await expect(page.locator('#next')).toBeHidden();

	// The superseded probe answers. It is true for its own origin, but not for
	// the attempt now in progress: storing it would drop the given launch,
	// and leaving for its /pair/tv would pair at an address nobody handed in.
	// Both happen before the navigation, so the record is read from this side.
	await page.evaluate((at) => window.tsundokuProbe?.(at, true), typed);
	await page.waitForTimeout(200);
	expect(bridge.remembered).not.toContain(typed);
	expect(page.url().startsWith(page9)).toBe(true);
	await expect(page.locator('#connect')).toBeVisible();
	await expect(page.locator('#connect-line')).toContainText('zen.tailnet.ts.net:8443');

	// The refusal door into 9B resets what the held probe left behind: NEXT
	// enabled and no CHECKING line, which d0d217d fixed and this pins.
	await page.evaluate(() => {
		location.hash = '#bad=' + encodeURIComponent('zen.local:42143');
	});
	await expect(page.locator('#refused')).toBeVisible();
	await expect(page.locator('#next')).toBeEnabled();
	await expect(page.locator('#checking')).toHaveText('');
});
