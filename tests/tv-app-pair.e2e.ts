import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The APK's own first screens (9A, 9B; android/app/src/main/assets/pair),
 * opened from the file the app ships, with no bridge: a remote, 960x540.
 *
 * This is **not** the app's loader. On a TV the page is served by
 * `WebViewAssetLoader` at `https://appassets.androidplatform.net/pair/index.html`
 * (c549); here it is opened from the asset file itself, because a browser has
 * no loader and the page's scripts do not read `location.protocol`. What the
 * loader changes — `BridgeGuard`, `Back.kt` and the WebView client — is pinned
 * by the JVM tests and the owner's check on a TV (`doc/TV-APP.md`).
 */
const page9 = pathToFileURL(
	join(process.cwd(), 'android/app/src/main/assets/pair/index.html')
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
 * `probe` answers with the origin `Address.originOf` keeps (a path, a query and
 * userinfo dropped), never with the string it was handed, because that is what
 * the real bridge answers and what the page's guard must accept. `answer` is
 * what it says; `hold` leaves the probe on `window.__bridge.pending` instead, so
 * the test decides when and what the answer is.
 *
 * What `remember` was called with is also kept on this side of the page: a
 * superseded answer stores its address immediately before the navigation that
 * answer would cause, and a navigation takes the page's own record with it.
 */
async function stubBridge(page: Page, options: { hold?: boolean; answer?: boolean } = {}) {
	const remembered: string[] = [];
	await page.exposeFunction('__bridgeRemembered', (at: string) => {
		remembered.push(at);
	});
	await page.addInitScript(
		({ hold, answer }: { hold: boolean; answer: boolean }) => {
			const state: StubBridge = { probes: [], remembered: [], pending: '' };
			// The origin a typed whole address becomes once the bridge parses it.
			const clean = (at: string) => {
				try {
					const u = new URL(/^https?:\/\//i.test(at) ? at : 'http://' + at);
					return u.origin;
				} catch {
					return at;
				}
			};
			window.__bridge = state;
			window.TsundokuTV = {
				tvAddress: () => '192.168.1.31',
				prefix: () => '192.168.1.',
				defaultPort: () => 42143,
				remembered: () => state.remembered[state.remembered.length - 1] ?? '',
				remember: (at: string) => {
					state.remembered.push(clean(at));
					void window.__bridgeRemembered?.(clean(at));
				},
				forget: () => {
					state.remembered = [];
				},
				probe: (at: string) => {
					state.probes.push(at);
					state.pending = at;
					if (!hold) setTimeout(() => window.tsundokuProbe?.(clean(at), answer), 50);
				}
			};
		},
		{ hold: options.hold ?? false, answer: options.answer ?? false }
	);
	return { remembered };
}

/**
 * How wide a no-wrap line of monospace text is on a TV, in CSS px.
 *
 * This box's `monospace` is Iosevka, about 0.5 em a glyph, so a line that fits
 * here can still be cut off by an ellipsis on the TV. The asset asks for
 * `ui-monospace, 'Roboto Mono', monospace`, and a TV's WebView ends on Roboto
 * Mono or Android's own monospace, Droid Sans Mono: both advance every glyph
 * they have by 1229/2048 em (0.6001), read from the fonts' `hmtx` tables
 * (c307). A glyph neither has (○, ✓, →) falls back to another font, so it is
 * counted at a whole em, the wide case.
 */
async function tvMonoWidth(page: Page, selector: string): Promise<number> {
	return page.locator(selector).evaluate((el) => {
		const size = parseFloat(getComputedStyle(el).fontSize);
		const text = (el as HTMLElement).innerText.trim();
		let ems = 0;
		for (const ch of text) ems += ch.codePointAt(0)! < 0x2500 ? 1229 / 2048 : 1;
		return ems * size;
	});
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

test("9A's steps end above START, whatever step 01 says (c263)", async ({ page }) => {
	await page.goto(page9);
	await page.evaluate(() => document.fonts.ready);

	// The handoff puts the steps grid at 262 and the action row at 400. A step
	// that wraps to one line more than the grid has room for pushes its bottom
	// border behind START (the round-2 9A copy did: 413.75 against 400), so
	// the grid must end at or above the row, not merely the text inside it.
	const steps = await page.locator('#welcome .steps').boundingBox();
	const actions = await page.locator('#welcome .welcome-actions').boundingBox();
	const start = await page.locator('#start').boundingBox();
	expect(steps).not.toBeNull();
	expect(actions).not.toBeNull();
	expect(start).not.toBeNull();
	expect(steps!.y + steps!.height).toBeLessThanOrEqual(actions!.y);
	expect(steps!.y + steps!.height).toBeLessThanOrEqual(start!.y);
	// And the row itself still ends inside the 540 frame.
	expect(actions!.y + actions!.height).toBeLessThanOrEqual(540);
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

	// The hint names every rule the activity refused by, and no other
	// (Address.intentOrigin: the scheme, a host, no userinfo, a port of 1 to
	// 65535; c307). Neither half of the band may be cut off by an ellipsis: not
	// in this browser, and not at a TV's wider monospace, where a hint that
	// fits here can push the first line's NOTHING WAS SAVED out of sight.
	const hint = band.locator('.meta');
	await expect(hint).toHaveText('http(s)://HOST · NO LOGIN · PORT 1–65535');
	for (const half of await band.locator(':scope > div').all()) {
		const cut = await half.evaluate((el) => el.scrollWidth > el.clientWidth);
		expect(cut).toBe(false);
	}
	const room = await band.evaluate((el) => {
		const css = getComputedStyle(el);
		return {
			inner: el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
			gap: parseFloat(css.columnGap)
		};
	});
	const firstAtTv = await tvMonoWidth(page, '#refused > div:first-child');
	const hintAtTv = await tvMonoWidth(page, '#refused > .meta');
	expect(firstAtTv + room.gap + hintAtTv).toBeLessThanOrEqual(room.inner);

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

test('a typed whole address with a path pairs at its origin (c260)', async ({ page }) => {
	const bridge = await stubBridge(page, { answer: true });
	// The typed address answers, so the page leaves for its /pair/tv. Abort
	// that request and keep its URL: this test must see where it went, not dial.
	const navigations: string[] = [];
	await page.route('https://zen.tailnet.ts.net:8443/**', (route) => {
		navigations.push(route.request().url());
		return route.abort();
	});
	await page.goto(page9);
	await page.keyboard.press('Enter'); // START → 9B, the mark on NEXT
	await page.locator('#whole-toggle').focus();
	await page.keyboard.press('Enter'); // TYPE THE WHOLE ADDRESS
	await page.locator('#last').fill('https://zen.tailnet.ts.net:8443/library');
	await page.locator('#next').click();

	// The field keeps the path; the bridge answers the origin. The page used to
	// compare the two raw strings and drop the answer, leaving 9B on CHECKING
	// with NEXT disabled (c260). It now compares origins, so the success lands.
	await expect.poll(() => bridge.remembered.length).toBeGreaterThan(0);
	expect(bridge.remembered).toContain('https://zen.tailnet.ts.net:8443');
	expect(bridge.remembered).not.toContain('https://zen.tailnet.ts.net:8443/library');
	await expect.poll(() => navigations.length).toBeGreaterThan(0);
	expect(navigations[0]).toBe('https://zen.tailnet.ts.net:8443/pair/tv');
});

test('a whole address typed with its scheme in capitals is probed with one scheme (c548)', async ({
	page
}) => {
	// A TV keyboard that capitalises the first letter types Http://. 9B used to
	// test the scheme with a case-sensitive startsWith and put its own http://
	// in front, so the bridge was asked about http://HTTP://…, a host named
	// HTTP, and 9B said NOTHING ANSWERS about a server that was there.
	await stubBridge(page, { hold: true });
	for (const typed of ['HTTP://Zen.local:42143', 'Http://zen.local:42143']) {
		await page.goto(page9);
		await page.keyboard.press('Enter'); // START → 9B
		await page.locator('#whole-toggle').focus();
		await page.keyboard.press('Enter'); // TYPE THE WHOLE ADDRESS
		await page.locator('#last').fill(typed);
		await page.locator('#next').click();
		await expect.poll(() => page.evaluate(() => window.__bridge!.probes.length)).toBe(1);
		const probed = await page.evaluate(() => window.__bridge!.probes[0]);
		expect(probed).not.toMatch(/:\/\/https?:\/\//i);
		expect(probed).toBe(typed);
	}
});

test('CHECKING and the lost line strip a scheme typed in capitals, as a lower-case one (c621)', async ({
	page
}) => {
	// 9B's origin() keeps what was typed, capitals included (it tests the scheme
	// without case since c548). The status line used to strip `http://` with a
	// case-sensitive replace, so a keyboard that capitalised the first letter
	// read `CHECKING HTTP://Zen.local:42143…` where a lower-case address read
	// its host; 9D had the same strip on its title (c621).
	const typed = 'HTTP://Zen.local:42143';
	await stubBridge(page, { hold: true });
	await page.goto(page9);
	await page.keyboard.press('Enter'); // START → 9B
	await page.locator('#whole-toggle').focus();
	await page.keyboard.press('Enter'); // TYPE THE WHOLE ADDRESS
	await page.locator('#last').fill(typed);
	await page.locator('#next').click();

	// The probe is held, so CHECKING is the attempt in hand. The host is shown
	// as typed, without the scheme and without a second one put in front.
	await expect.poll(() => page.evaluate(() => window.__bridge!.pending)).toBe(typed);
	await expect(page.locator('#checking')).toHaveText('CHECKING Zen.local:42143…');

	// The answer is the unreachable one, the way a real bridge answers a probe
	// that found no tsundoku. A failure for the attempt in hand enters 9D, whose
	// title names the same host, lower-case scheme stripped all the same.
	await page.evaluate((at) => window.tsundokuProbe?.(at, false), typed);
	await expect(page.locator('#lost-title')).toHaveText('○ NOTHING ANSWERS AT Zen.local:42143');
	await expect(page.locator('#lost-title')).not.toContainText('HTTP://');
});

test('a typed whole address with a query fails at its origin (c260)', async ({ page }) => {
	await stubBridge(page);
	await page.goto(page9);
	await page.keyboard.press('Enter'); // START → 9B
	await page.locator('#whole-toggle').focus();
	await page.keyboard.press('Enter'); // TYPE THE WHOLE ADDRESS
	await page.locator('#last').fill('http://192.168.1.23:42143/?q=1');
	await page.locator('#next').click();

	// A failure is the same identity question as a success: the query is not
	// part of the origin, so 9D must name the address that was probed, and the
	// answer must not be dropped with NEXT left disabled (c260).
	await expect(page.locator('#retry')).toBeVisible();
	await expect(page.locator('#lost-title')).toContainText('192.168.1.23:42143');
	await expect(page.locator('#lost-title')).not.toContainText('q=1');
	await expect(page.locator('#next')).toBeEnabled();
});

test('a refused address is not replaced by a probe already in flight (c260)', async ({ page }) => {
	const bridge = await stubBridge(page, { hold: true });
	await page.goto(page9);
	await page.keyboard.press('Enter'); // START → 9B, the mark on NEXT
	await page.keyboard.press('2');
	await page.keyboard.press('3');
	await page.keyboard.press('Enter'); // NEXT: the typed probe is held
	const typed = 'http://192.168.1.23:42143';
	await expect.poll(() => page.evaluate(() => window.__bridge!.pending)).toBe(typed);

	// A second launch is refused. The band says nothing was saved; 9B is back.
	await page.evaluate(() => {
		location.hash = '#bad=' + encodeURIComponent('zen.local:42143');
	});
	await expect(page.locator('#refused')).toBeVisible();
	await expect(page.locator('#address-form')).toBeVisible();

	// The probe sent before the refusal now fails. It is an answer for the
	// attempt the refusal replaced, so its failure must not erase the band and
	// take the screen to 9D for an address nobody handed in (c260).
	await page.evaluate((at) => window.tsundokuProbe?.(at, false), typed);
	await page.waitForTimeout(300);
	await expect(page.locator('#refused')).toBeVisible();
	await expect(page.locator('#address-form')).toBeVisible();
	await expect(page.locator('#retry')).toBeHidden();
	await expect(page.locator('#lost')).toBeHidden();
	expect(bridge.remembered).toEqual([]);
});

test('a new attempt after a refusal clears the band and can fail to 9D (c260)', async ({
	page
}) => {
	await stubBridge(page);
	await page.goto(`${page9}#bad=${encodeURIComponent('zen.local:42143')}`);
	await expect(page.locator('#refused')).toBeVisible();

	// The band describes the refused launch, not the attempt the owner makes
	// next. If it outlived a new probe, the guard above would drop that probe's
	// failure and leave 9B with NEXT disabled and no way forward (c260).
	await page.locator('#whole-toggle').click();
	await page.locator('#last').fill('https://zen.tailnet.ts.net:8443/library');
	await page.locator('#next').click();
	await expect(page.locator('#refused')).toBeHidden();
	await expect(page.locator('#retry')).toBeVisible();
	await expect(page.locator('#lost-title')).toContainText('zen.tailnet.ts.net:8443');
	await expect(page.locator('#lost-title')).not.toContainText('library');
});

test('a given address after a refusal that does not answer reaches 9D (c260)', async ({ page }) => {
	const bridge = await stubBridge(page);
	await page.goto(`${page9}#bad=${encodeURIComponent('ftp://zen.local')}`);
	await expect(page.locator('#refused')).toBeVisible();

	// The third door into the refusal state. `connect()` hides 9B, and hiding
	// the screen never hid the band's flag: the guard read the leftover flag as
	// "a refusal is the current state" and dropped this failure, leaving a bare
	// CHECKING line over a hidden screen with nothing a remote could press
	// (c260). A given address owns the band the same way a typed one does.
	await page.evaluate(() => {
		location.hash = '#connect=' + encodeURIComponent('https://zen.tailnet.ts.net:8443');
	});
	await expect(page.locator('#retry')).toBeVisible();
	await expect(page.locator('#connect')).toBeHidden();
	await expect(page.locator('#lost-title')).toContainText('zen.tailnet.ts.net:8443');
	expect(bridge.remembered).toEqual([]);
});

test('a given address after a refusal that answers still pairs at its origin (c260)', async ({
	page
}) => {
	const bridge = await stubBridge(page, { answer: true });
	// The address answers, so the page leaves for its /pair/tv. Abort that
	// request and keep its URL: this test must see where it went, not dial.
	const navigations: string[] = [];
	await page.route('https://zen.tailnet.ts.net:8443/**', (route) => {
		navigations.push(route.request().url());
		return route.abort();
	});
	await page.goto(`${page9}#bad=${encodeURIComponent('ftp://zen.local')}`);
	await expect(page.locator('#refused')).toBeVisible();

	// Only a *failure* for a superseded attempt is dropped: an address that
	// answers is the current one and still replaces the remembered address
	// (Decision 9). Pinned here so a later tightening of the guard cannot
	// quietly stop a given address from pairing (c260).
	await page.evaluate(() => {
		location.hash = '#connect=' + encodeURIComponent('https://zen.tailnet.ts.net:8443');
	});
	await expect.poll(() => navigations.length).toBeGreaterThan(0);
	expect(navigations[0]).toBe('https://zen.tailnet.ts.net:8443/pair/tv');
	expect(bridge.remembered).toContain('https://zen.tailnet.ts.net:8443');
});

// ---- c261: the TV's servers on the app's own screens (S5, S7, S8, S9) --------

type StubServer = { origin: string; name: string; tvName: string; opened: number };
type ServersBridge = {
	list: StubServer[];
	probes: string[];
	opened: string[];
	remembered: string[];
	moved: [string, string][];
	/** Origins whose probe is held until the test answers it (`hold`). */
	held: string[];
};

declare global {
	interface Window {
		__servers?: ServersBridge;
	}
}

const HOME = 'http://192.168.1.23:42143';
const ZEN = 'https://zen.tailnet.ts.net:8443';
const STUDIO = 'http://192.168.1.61:42143';

/**
 * PairingBridge.kt with its c261 list, as Servers.kt answers it: the one in
 * use first, `shown` the TV's name, else the server's, else the host. `answers`
 * says which origins a probe finds (anything else does not answer), each
 * after its own delay, so answers can land out of order as on a TV. `hold`
 * keeps an answer until the test gives it (`answerHeld`): a case that asserts
 * the state before an answer (CHECKING) must not race a timer for it, which a
 * loaded box loses (wave 32: S9 read ANSWERS where CHECKING was due, 1 run in
 * 5 at a load of 36-64).
 */
async function stubServers(
	page: Page,
	list: StubServer[],
	answers: Record<string, { ok: boolean; after?: number; hold?: boolean }> = {}
) {
	await page.addInitScript(
		({ list, answers }) => {
			const state: ServersBridge = {
				list,
				probes: [],
				opened: [],
				remembered: [],
				moved: [],
				held: []
			};
			const clean = (at: string) => {
				try {
					return new URL(at.startsWith('http') ? at : 'http://' + at).origin;
				} catch {
					return at;
				}
			};
			const shown = (s: StubServer) => s.tvName || s.name || s.origin.replace(/^https?:\/\//, '');
			const sorted = () => [...state.list].sort((a, b) => b.opened - a.opened);
			window.__servers = state;
			window.TsundokuTV = {
				tvAddress: () => '192.168.1.31',
				prefix: () => '192.168.1.',
				defaultPort: () => 42143,
				remembered: () => sorted()[0]?.origin ?? '',
				servers: () =>
					JSON.stringify(sorted().map((s, i) => ({ ...s, shown: shown(s), inUse: i === 0 }))),
				remember: (at: string) => {
					state.remembered.push(clean(at));
					if (!state.list.some((s) => s.origin === clean(at)))
						state.list.push({ origin: clean(at), name: '', tvName: '', opened: 0 });
				},
				open: (at: string) => state.opened.push(at),
				rename: (at: string, name: string) => {
					const s = state.list.find((x) => x.origin === at);
					if (s) s.tvName = name.trim();
				},
				move: (from: string, to: string) => {
					state.moved.push([from, clean(to)]);
					// Kept outside the page too: the move is followed by a navigation.
					void (
						window as unknown as { __serversMoved?: (f: string, t: string) => void }
					).__serversMoved?.(from, clean(to));
				},
				probe: (at: string) => {
					const o = clean(at);
					state.probes.push(o);
					const a = answers[o] ?? { ok: false, after: 50 };
					if (a.hold) state.held.push(o);
					else setTimeout(() => window.tsundokuProbe?.(o, a.ok), a.after ?? 50);
				}
			};
		},
		{ list, answers }
	);
}

/** Answer a probe `stubServers` held, once the page has asked it (`hold`). */
async function answerHeld(page: Page, origin: string, ok: boolean) {
	await expect
		.poll(() => page.evaluate((o) => window.__servers!.held.includes(o), origin))
		.toBe(true);
	await page.evaluate(({ o, ok }) => window.tsundokuProbe?.(o, ok), { o: origin, ok });
}

const three: StubServer[] = [
	{ origin: HOME, name: 'ZEN-HOME', tvName: 'Living room', opened: 3 },
	{ origin: ZEN, name: 'ZEN', tvName: "Masshiro's", opened: 2 },
	{ origin: STUDIO, name: 'STUDIO-PC', tvName: 'Studio', opened: 1 }
];

test('S9: 9D for the one in use offers the others, each probed, OK opening one', async ({
	page
}) => {
	// Studio answers first and Masshiro's later, the reverse of the list's
	// order: each answer must land on its own row. Masshiro's is held until
	// its row has been seen CHECKING.
	await stubServers(page, three, {
		[ZEN]: { ok: true, hold: true },
		[STUDIO]: { ok: false, after: 100 }
	});
	await page.goto(`${page9}#lost=${encodeURIComponent(HOME)}`);
	await expect(page.locator('#lost-title')).toHaveText(
		'○ NOTHING ANSWERS AT LIVING ROOM · 192.168.1.23:42143'
	);
	await expect(page.locator('#others-label')).toBeVisible();
	await expect(page.locator('#others-count')).toHaveText('2');
	const rows = page.locator('#others .srv');
	await expect(rows).toHaveCount(2);
	// Never the one that did not answer, and in the list's order.
	await expect(rows.nth(0)).toContainText("Masshiro's");
	await expect(rows.nth(1)).toContainText('Studio');
	await expect(rows.nth(1).locator('.st')).toHaveText('NO ANSWER');
	await expect(rows.nth(0).locator('.st')).toHaveText('CHECKING');
	await answerHeld(page, ZEN, true);
	await expect(rows.nth(0).locator('.st')).toHaveText('ANSWERS');
	await expect(rows.nth(0).locator('.g')).toHaveText('●');
	await expect(rows.nth(1).locator('.g')).toHaveText('○');
	// An answer for another row is not the attempt's: 9D stays, for HOME.
	await expect(page.locator('#retry')).toBeVisible();
	expect(await page.evaluate(() => window.__servers!.opened)).toEqual([]);

	// TRY AGAIN keeps the mark; ↑ reaches the others (they are stops, the
	// reasons are not), and OK opens one.
	await expect(page.locator('#retry')).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(rows.nth(1)).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(rows.nth(0)).toBeFocused();
	await page.keyboard.press('Enter');
	expect(await page.evaluate(() => window.__servers!.opened)).toEqual([ZEN]);

	// The frame's measurements (TV-Servers.dc.html, lost): the reasons at
	// 48 for 500, the others at 580 for 332, rows 72 high, buttons at 416.
	const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
	const main = await box('main');
	const reasons = await box('#lost .reasons');
	const others = await box('#others');
	expect(reasons.x - main.x).toBe(48);
	expect(reasons.width).toBe(500);
	expect(others.x - main.x).toBe(580);
	expect(others.width).toBe(332);
	expect(others.y - main.y).toBe(200);
	expect((await box('#others .srv')).height).toBe(72);
	// 60 is the rows' least height; a reason that wraps at 500 grows past it,
	// and all three still end above the buttons.
	await expect(page.locator('#lost .reason').first()).toHaveCSS('min-height', '60px');
	const lastReason = await page.locator('#lost .reason').last().boundingBox();
	expect(lastReason!.y + lastReason!.height).toBeLessThan((await box('#retry')).y);
	expect((await box('#retry')).y - main.y).toBe(416);
	expect((await box('#retry')).y + 56 - main.y).toBeLessThanOrEqual(540);
});

test("S9: 9D's 5 s retries keep the mark on another server and its answer (c261, round 2)", async ({
	page
}) => {
	// HOME never answers, so the 5 s retry fails again and again. A failure
	// for the attempt already on 9D is a count, not a new 9D: rebuilding it
	// took the mark back to TRY AGAIN, put every row back to CHECKING and
	// probed every other server again, on every tick.
	// Paused, so only runFor moves time: a slow assertion must not add a tick.
	// install() starts a running clock (Playwright's reference: install before
	// navigating and let `Date.now` progress while the page loads, then pause).
	// Under load it has moved past t0 before pauseAt runs, and pauseAt "cannot
	// fast-forward to the past", so a pause at t0 + 1 ms lands in the past on a
	// loaded box (c619). Read the page's own clock and pause a margin of
	// seconds ahead of it, as settings-devices does at install + 30 s.
	const t0 = new Date('2026-11-04T10:00:00Z');
	await page.clock.install({ time: t0 });
	await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 30_000));
	await stubServers(page, three, {
		[ZEN]: { ok: true, after: 300 },
		[STUDIO]: { ok: false, after: 100 }
	});
	await page.goto(`${page9}#lost=${encodeURIComponent(HOME)}`);
	await page.clock.runFor(1000);
	const rows = page.locator('#others .srv');
	await expect(rows.nth(0).locator('.st')).toHaveText('ANSWERS');
	await expect(rows.nth(1).locator('.st')).toHaveText('NO ANSWER');
	await expect(page.locator('#lost-meta')).toContainText('TRIED 0 TIMES');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowUp');
	await expect(rows.nth(0)).toBeFocused();
	// A marker on the node itself: a rebuilt row is another element.
	await rows.nth(0).evaluate((el) => (el.dataset.kept = 'yes'));

	// 5.2 s: the first tick's probe failed at 5.05 s. A rebuilt 9D would show
	// the others CHECKING until their own probes answer again (ZEN's at 5.35).
	await page.clock.runFor(4200);
	await expect(page.locator('#lost-meta')).toContainText('TRIED 1 TIME ');
	await expect.soft(rows.nth(0).locator('.st')).toHaveText('ANSWERS', { timeout: 500 });
	await expect.soft(rows.nth(1).locator('.st')).toHaveText('NO ANSWER', { timeout: 500 });
	await page.clock.runFor(5000);
	await expect(page.locator('#lost-meta')).toContainText('TRIED 2 TIMES');
	await page.clock.runFor(1000);

	await expect.soft(page.locator('#others .srv[data-kept="yes"]')).toBeFocused();
	await expect.soft(rows.nth(0)).toContainText("Masshiro's");
	await expect.soft(rows.nth(0).locator('.st')).toHaveText('ANSWERS');
	await expect.soft(rows.nth(1).locator('.st')).toHaveText('NO ANSWER');
	await expect.soft(rows).toHaveCount(2);
	// Soft, so a run against a 9D that rebuilds itself names every one it breaks.
	const probes = await page.evaluate(() => window.__servers!.probes);
	// Each other server once, on entering 9D; HOME on each of the two ticks.
	expect.soft(probes.filter((p) => p === ZEN)).toHaveLength(1);
	expect.soft(probes.filter((p) => p === STUDIO)).toHaveLength(1);
	expect.soft(probes.filter((p) => p === HOME)).toHaveLength(2);
	expect(test.info().errors).toEqual([]);
	// The mark still works where it was left.
	await page.keyboard.press('Enter');
	expect(await page.evaluate(() => window.__servers!.opened)).toEqual([ZEN]);
});

test('9D with one server is 9D as before c261: no others, the reasons full width', async ({
	page
}) => {
	await stubServers(page, [three[0]]);
	await page.goto(`${page9}#lost=${encodeURIComponent(HOME)}`);
	await expect(page.locator('#retry')).toBeVisible();
	await expect(page.locator('#others')).toBeHidden();
	await expect(page.locator('#others-label')).toBeHidden();
	const main = (await page.locator('main').boundingBox())!;
	const reasons = (await page.locator('#lost .reasons').boundingBox())!;
	expect(reasons.width).toBe(960 - 96);
	expect((await page.locator('#retry').boundingBox())!.y - main.y).toBe(392);
});

test('S7: ADD A SERVER is 9B naming who is here, and BACK returns to the library', async ({
	page
}) => {
	await stubServers(page, three);
	await page.goto(`${page9}#add`);
	await expect(page.locator('#step')).toHaveText('ADD A SERVER · 1 OF 2');
	await expect(page.locator('#address-label')).toHaveText(
		"01 — THE NEW COMPUTER'S ADDRESS · ON ITS SCREEN, UNDER THE CODE"
	);
	await expect(page.locator('#tv-meta')).toContainText(
		"ALREADY HERE: LIVING ROOM, MASSHIRO'S, STUDIO"
	);
	await expect(page.locator('#add-back')).toHaveText(
		"BACK RETURNS TO LIVING ROOM'S LIBRARY · NOTHING THERE CHANGES"
	);
	await expect(page.locator('#next')).toBeFocused();
	// BACK is the page's here: the library in use opens, nothing changes.
	expect(await page.evaluate(() => window.tsundokuBack?.())).toBe(true);
	expect(await page.evaluate(() => window.__servers!.opened)).toEqual([HOME]);
	expect(await page.evaluate(() => window.__servers!.remembered)).toEqual([]);
});

test('S7: an address already in the list opens it instead of pairing', async ({ page }) => {
	await stubServers(page, three);
	await page.goto(`${page9}#add`);
	await page.keyboard.press('6');
	await page.keyboard.press('1');
	await page.keyboard.press('Enter'); // NEXT →
	await expect(page.locator('#already')).toHaveText('ALREADY IN SERVERS AS STUDIO · OPENING');
	// The band moves the column down, as every band on 9B does (c246).
	await expect(page.locator('#address')).toHaveClass(/with-band/);
	await expect.poll(() => page.evaluate(() => window.__servers!.opened)).toEqual([STUDIO]);
	expect(await page.evaluate(() => window.__servers!.probes)).toEqual([]);
	expect(await page.evaluate(() => window.__servers!.remembered)).toEqual([]);
});

test('S7: a new address that answers is added and goes to its pairing', async ({ page }) => {
	const fresh = 'http://192.168.1.77:42143';
	await stubServers(page, three, { [fresh]: { ok: true } });
	await page.goto(`${page9}#add`);
	await page.keyboard.press('7');
	await page.keyboard.press('7');
	const nav = page.waitForRequest((r) => r.url().startsWith(fresh));
	await page.keyboard.press('Enter');
	expect((await nav).url()).toBe(fresh + '/pair/tv');
});

test('a given address already in the list opens its library once it answers', async ({ page }) => {
	await stubServers(page, three, { [ZEN]: { ok: true } });
	await page.goto(`${page9}#connect=${encodeURIComponent(ZEN)}`);
	await expect.poll(() => page.evaluate(() => window.__servers!.opened)).toEqual([ZEN]);
	expect(await page.evaluate(() => window.__servers!.remembered)).toEqual([]);
});

test("9D's server back opens its library, not its pairing again", async ({ page }) => {
	await stubServers(page, three, { [HOME]: { ok: true } });
	await page.goto(`${page9}#lost=${encodeURIComponent(HOME)}`);
	await page.locator('#retry').click();
	await expect.poll(() => page.evaluate(() => window.__servers!.opened)).toContain(HOME);
});

test('CHANGE THE ADDRESS on a server in the list gives that entry its new address', async ({
	page
}) => {
	const moved = 'http://192.168.1.99:42143';
	const moves: [string, string][] = [];
	await page.exposeFunction('__serversMoved', (f: string, t: string) => moves.push([f, t]));
	await stubServers(page, three, { [moved]: { ok: true } });
	await page.goto(`${page9}#lost=${encodeURIComponent(HOME)}`);
	await page.locator('#change').click();
	await expect(page.locator('#address-label')).toHaveText(
		"01 — LIVING ROOM'S NEW ADDRESS · ON ITS SCREEN, UNDER THE CODE"
	);
	await page.keyboard.press('9');
	await page.keyboard.press('9');
	const nav = page.waitForRequest((r) => r.url().startsWith(moved));
	await page.keyboard.press('Enter');
	expect((await nav).url()).toBe(moved + '/pair/tv');
	// Replaced, not added (remember is never called): Servers.move keeps the
	// TV's name for the entry, which ServersTest pins.
	expect(moves).toEqual([[HOME, moved]]);
});

test('S8: after an add, the app says who is still here, OPEN focused', async ({ page }) => {
	await stubServers(page, [three[0], { origin: ZEN, name: 'ZEN', tvName: '', opened: 0 }]);
	await page.goto(`${page9}#added=${encodeURIComponent(ZEN)}`);
	await expect(page.locator('#step')).toHaveText('ADDED · 2 SERVERS');
	await expect(page.locator('#added-lab')).toHaveText(
		'✓ PAIRED WITH ZEN · ZEN.TAILNET.TS.NET:8443'
	);
	await expect(page.locator('#added-title')).toHaveText("ZEN is one of this TV's servers");
	await expect(page.locator('#added-prose')).toContainText('Living room is still here.');
	await expect(page.locator('#added-prose')).toContainText('the name at the top of the library');
	await expect(page.locator('#added-prose')).toContainText('MORE › SERVERS');
	await expect(page.locator('#added-meta')).toHaveText('ZEN IS WHAT THE COMPUTER CALLS ITSELF');
	await expect(page.locator('#added-open')).toHaveText('OPEN ZEN →');
	await expect(page.locator('#added-open')).toBeFocused();
	const main = (await page.locator('main').boundingBox())!;
	expect((await page.locator('.added-head').boundingBox())!.y - main.y).toBe(112);
	expect((await page.locator('#added-open').boundingBox())!.y - main.y).toBe(330);
	await page.keyboard.press('Enter');
	expect(await page.evaluate(() => window.__servers!.opened)).toEqual([ZEN]);
});

test('S5: RENAME from S8 keeps the name on the TV and comes back to S8', async ({ page }) => {
	await stubServers(page, [three[0], { origin: ZEN, name: 'ZEN', tvName: '', opened: 0 }]);
	await page.goto(`${page9}#added=${encodeURIComponent(ZEN)}`);
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('#added-rename')).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator('#step')).toHaveText('RENAME A SERVER');
	await expect(page.locator('#rename-label')).toHaveText(
		"THIS TV'S NAME FOR ZEN.TAILNET.TS.NET:8443"
	);
	await expect(page.locator('#rename-meta')).toHaveText(
		'THE SERVER CALLS ITSELF ZEN · EMPTY GOES BACK TO THAT · KEPT ON THIS TV ONLY'
	);
	// The field has the mark at once: the keyboard rising is this screen's point.
	await expect(page.locator('#rename-field')).toBeFocused();
	const main = (await page.locator('main').boundingBox())!;
	const field = (await page.locator('#rename-field').boundingBox())!;
	expect(field.y - main.y).toBe(140);
	expect(field.height).toBe(64);
	expect(field.x - main.x).toBe(48);
	expect(field.width).toBe(960 - 96);
	await page.keyboard.type("Masshiro's");
	await page.keyboard.press('Enter');
	await expect(page.locator('#added-title')).toHaveText("Masshiro's is one of this TV's servers");
	expect(await page.evaluate(() => window.__servers!.list[1].tvName)).toBe("Masshiro's");
});

test('S5: RENAME from the library goes back to the library, saved or not', async ({ page }) => {
	await stubServers(page, three);
	await page.goto(`${page9}#rename=${encodeURIComponent(ZEN)}`);
	await expect(page.locator('#rename-field')).toHaveValue("Masshiro's");
	// BACK cancels: nothing is renamed, and the library in use opens.
	expect(await page.evaluate(() => window.tsundokuBack?.())).toBe(true);
	expect(await page.evaluate(() => window.__servers!.opened)).toEqual([HOME]);
	expect(await page.evaluate(() => window.__servers!.list[1].tvName)).toBe("Masshiro's");
	// Emptied and saved, the TV's name goes; the server's own comes back.
	await page.goto(`${page9}#rename=${encodeURIComponent(STUDIO)}`);
	await page.locator('#rename-field').fill('');
	await page.keyboard.press('Enter');
	expect(await page.evaluate(() => window.__servers!.list[2].tvName)).toBe('');
});

test('a page with no list behaves as before c261: no others, no ADD mode', async ({ page }) => {
	// An older bridge has no servers(): stubBridge is that bridge.
	await stubBridge(page);
	await page.goto(`${page9}#lost=${encodeURIComponent(HOME)}`);
	await expect(page.locator('#others')).toBeHidden();
	await expect(page.locator('#lost-title')).toHaveText('○ NOTHING ANSWERS AT 192.168.1.23:42143');
});

// ---- c685: a door the page acted on is not taken again by a history step ----

/** A server nobody else in this file pairs, for c685's replays. */
const GONE = 'http://192.168.1.88:42143';
/** The launch's token, as `MainActivity.loadAsset` writes it into the URL. */
const TOKEN = '6a1f0c9e-2b7d-4a55-9d1e-3f8c0b2a7e64';

type Across = {
	/** Every origin any document asked the bridge to probe, in order. */
	probes: string[];
	/** Every origin any document stored. */
	remembered: string[];
	/** Every origin any document opened. */
	opened: string[];
	/** origin -> its answer; an origin with none is held, never answered. */
	answers: Map<string, boolean>;
};

/**
 * PairingBridge.kt as `stubServers` stands it up, but kept on this side of the
 * page, so it outlives each document: a history step loads the pair page
 * again, and the question is what that new document does with the bridge.
 * The list is the activity's (`Servers.kt`), the same in every document, and
 * `GONE` is never in it: a server the owner FORGOT after the first visit is,
 * to the second document, exactly that. A probe is answered asynchronously,
 * as the real bridge answers from its own thread (`PairingBridge.probe`), and
 * an origin with no answer set is held, as a server that has not answered
 * yet is.
 */
async function stubAcross(page: Page, list: StubServer[]): Promise<Across> {
	const across: Across = { probes: [], remembered: [], opened: [], answers: new Map() };
	await page.exposeFunction('__acrossProbe', (at: string) => {
		across.probes.push(at);
		const ok = across.answers.get(at);
		return ok === undefined ? new Promise<boolean>(() => {}) : ok;
	});
	await page.exposeFunction('__acrossRemember', (at: string) => {
		across.remembered.push(at);
	});
	await page.exposeFunction('__acrossOpen', (at: string) => {
		across.opened.push(at);
	});
	await page.addInitScript((list: StubServer[]) => {
		const w = window as unknown as Record<string, (at: string) => Promise<boolean>>;
		const shown = (s: StubServer) => s.tvName || s.name || s.origin.replace(/^https?:\/\//, '');
		window.TsundokuTV = {
			tvAddress: () => '192.168.1.31',
			prefix: () => '192.168.1.',
			defaultPort: () => 42143,
			remembered: () => list[0]?.origin ?? '',
			servers: () =>
				JSON.stringify(list.map((s, i) => ({ ...s, shown: shown(s), inUse: i === 0 }))),
			remember: (at: string) => void w.__acrossRemember(at),
			open: (at: string) => void w.__acrossOpen(at),
			probe: (at: string) => void w.__acrossProbe(at).then((ok) => window.tsundokuProbe?.(at, ok))
		};
	}, list);
	// The server's own pages, which the pair page leaves for. A real server
	// answers its /pair/tv; nothing here dials the address.
	await page.route(`${GONE}/**`, (route) =>
		route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>9E</p>' })
	);
	await page.route(`${HOME}/**`, (route) =>
		route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>library</p>' })
	);
	return across;
}

test('a given address leaves its entry without the fragment once it is checked, the token kept (c685)', async ({
	page
}) => {
	await stubAcross(page, three);
	// How long the history was when this document began, before its script
	// ran (Playwright's page starts on about:blank, an entry of its own).
	await page.addInitScript(() => {
		(window as unknown as { __entries: number }).__entries = history.length;
	});
	await page.goto(`${page9}?t=${TOKEN}#connect=${encodeURIComponent(GONE)}`);
	await expect(page.locator('#connect')).toBeVisible();
	await expect(page.locator('#connect-line')).toContainText('192.168.1.88:42143');
	// The entry no longer says connect=, so nothing that loads it again can
	// act on it; the query is the launch's token, which the asset guard
	// requires (BridgeGuard.carriesAssetToken), so it must survive.
	expect(await page.evaluate(() => location.hash)).toBe('');
	expect(await page.evaluate(() => location.search)).toBe(`?t=${TOKEN}`);
	expect(page.url()).toBe(`${page9}?t=${TOKEN}`);
	// And the entry was replaced, not added to: BACK has no extra step.
	expect(
		await page.evaluate(
			() => history.length - (window as unknown as { __entries: number }).__entries
		)
	).toBe(0);
});

test('a history step into an old #connect= entry does not bring a forgotten server back (c685)', async ({
	page
}) => {
	const across = await stubAcross(page, three);
	across.answers.set(GONE, true);
	await page.goto(`${page9}?t=${TOKEN}#connect=${encodeURIComponent(GONE)}`);
	// The first visit pairs: a new server that answers is stored and its
	// /pair/tv opens, as c260 has it.
	await page.waitForURL(`${GONE}/pair/tv`);
	expect(across.remembered).toEqual([GONE]);
	expect(across.probes).toEqual([GONE]);

	// The owner FORGETs it later (the list never had it, so to the next
	// document it is forgotten). Any page the WebView shows can step back
	// into the pair page's entry, which carries the app's own token.
	await page.evaluate(() => history.back());
	await page.waitForURL(`${page9}?t=${TOKEN}`);
	// The entry is the pair page with no door in it: 9A, and nothing checked.
	await expect(page.locator('#start')).toBeVisible();
	await expect(page.locator('#connect')).toBeHidden();
	expect(across.probes).toEqual([GONE]);
	expect(across.remembered).toEqual([GONE]);
	expect(page.url()).toBe(`${page9}?t=${TOKEN}`);
});

test('a history step into an old #lost= entry does not bring a forgotten server back (c685)', async ({
	page
}) => {
	const across = await stubAcross(page, three);
	// 9D for a server that does not answer, then nobody waits on it: another
	// server opens (an app load, which leaves a history entry of its own).
	across.answers.set(GONE, false);
	await page.goto(`${page9}?t=${TOKEN}#lost=${encodeURIComponent(GONE)}`);
	await expect(page.locator('#lost-title')).toContainText('192.168.1.88:42143');
	expect(await page.evaluate(() => location.hash)).toBe('');
	expect(page.url()).toBe(`${page9}?t=${TOKEN}`);
	await page.goto(`${HOME}/`);

	// It answers now, and it has been forgotten. Stepping back into the entry
	// must not reopen 9D for it: 9D's retry would find it answering, store it
	// and leave for its /pair/tv with no input.
	across.answers.set(GONE, true);
	await page.evaluate(() => history.back());
	await page.waitForURL(`${page9}?t=${TOKEN}`);
	await expect(page.locator('#start')).toBeVisible();
	await expect(page.locator('#lost')).toBeHidden();
	expect(across.remembered).toEqual([]);
	expect(across.probes.filter((at) => at === GONE)).toEqual([]);
});

test('a second launch with the same address is taken again once the first has cleared its fragment (c685)', async ({
	page
}) => {
	const across = await stubAcross(page, three);
	await page.goto(`${page9}?t=${TOKEN}#connect=${encodeURIComponent(GONE)}`);
	await expect(page.locator('#connect')).toBeVisible();
	await expect.poll(() => across.probes).toEqual([GONE]);
	// A singleTask app started again with the same address: MainActivity's
	// loadAsset sets the same fragment on this same document (c260). The entry
	// has none now, so it is a change, and the address is checked again.
	await page.evaluate((at) => {
		location.hash = '#connect=' + encodeURIComponent(at);
	}, GONE);
	await expect.poll(() => across.probes).toEqual([GONE, GONE]);
	await expect(page.locator('#connect')).toBeVisible();
	expect(await page.evaluate(() => location.hash)).toBe('');
	expect(await page.evaluate(() => location.search)).toBe(`?t=${TOKEN}`);
});
