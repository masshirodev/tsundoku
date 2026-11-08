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

test('a given address in the list is checked without 9A or 9B (c260)', async ({ page }) => {
	await stubServers(page, three, { [ZEN]: { ok: false, hold: true } });
	await page.goto(`${page9}#connect=${encodeURIComponent(ZEN)}`);

	// The app was handed an address it knows, so nobody types one: neither the
	// welcome screen nor the address field is on the way. The checking line
	// names what is being checked, and the probe is out and unanswered.
	await expect(page.locator('#start')).toBeHidden();
	await expect(page.locator('#next')).toBeHidden();
	await expect(page.locator('#connect')).toBeVisible();
	await expect(page.locator('#connect-line')).toContainText('zen.tailnet.ts.net:8443');
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
	// A friend whose LAN probe failed is the case doc/TV-APP.md sends here: the
	// TV is already retrying something nobody answers. It is a server in the
	// list, because that is who the app's own #lost= is for (c683).
	const lan = 'http://192.168.1.99:42143';
	await stubServers(page, [{ origin: lan, name: '', tvName: '', opened: 1 }]);
	await page.goto(`${page9}#lost=${encodeURIComponent(lan)}`);
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
	const probesWhenRefused = await page.evaluate(() => window.__servers!.probes.length);

	// One retry tick is 5 s. 9B is a second door into this screen, and the
	// timer outlives it unless refused() stops it: the tick would probe the
	// old origin, fail, and replace the refusal with 9D for it.
	await page.waitForTimeout(5600);
	await expect(page.locator('#refused')).toBeVisible();
	await expect(page.locator('#address-form')).toBeVisible();
	await expect(page.locator('#retry')).toBeHidden();
	const afterRefusal = await page.evaluate(
		(from) => window.__servers!.probes.slice(from),
		probesWhenRefused
	);
	expect(afterRefusal).toEqual([]);
	// 9B starts clean on this door too (d0d217d): nothing is left disabled.
	await expect(page.locator('#next')).toBeEnabled();
	await expect(page.locator('#checking')).toHaveText('');
});

test('a probe a link superseded neither stores nor navigates (c260, c683)', async ({ page }) => {
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
	// flight. The question supersedes the typed one, whose answer must be
	// dropped, and it asks nothing of the address it is showing.
	const given = 'https://zen.tailnet.ts.net:8443';
	await page.evaluate((at) => {
		location.hash = '#ask=' + encodeURIComponent(at);
	}, given);
	await expect(page.locator('#already')).toBeVisible();
	await expect(page.locator('#last')).toHaveValue(given);
	expect(await page.evaluate(() => window.__bridge!.probes)).toEqual([typed]);

	// The superseded probe answers. It is true for its own origin, but not for
	// what is on the screen now: storing it would add an address the owner
	// walked away from, and leaving for its /pair/tv would drop the question.
	// Both happen before the navigation, so the record is read from this side.
	await page.evaluate((at) => window.tsundokuProbe?.(at, true), typed);
	await expect(page.locator('#last')).toHaveValue(given);
	expect(bridge.remembered).toEqual([]);
	expect(page.url().startsWith(page9)).toBe(true);
	await expect(page.locator('#already')).toBeVisible();

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
	await stubServers(page, three, { [ZEN]: { ok: false } });
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
	expect(await page.evaluate(() => window.__servers!.remembered)).toEqual([]);
});

test('a link after a refusal still pairs at its origin once CONNECT is pressed (c260, c683)', async ({
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
	// answers is the current one and still pairs (Decision 9). Pinned here so
	// a later tightening of the guard cannot quietly stop a link from pairing
	// (c260); what c683 adds is the press in the middle.
	await page.evaluate(() => {
		location.hash = '#ask=' + encodeURIComponent('https://zen.tailnet.ts.net:8443');
	});
	await expect(page.locator('#refused')).toBeHidden();
	await page.locator('#next').click();
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
	// An older bridge has no servers(): stubBridge is that bridge. With no list
	// a #lost= asks (c683), so 9D is reached by the door such a page still has:
	// an address typed here that does not answer.
	await stubBridge(page);
	await page.goto(page9);
	await page.locator('#start').click();
	await page.locator('#last').fill('23');
	await page.locator('#next').click();
	await expect(page.locator('#retry')).toBeVisible();
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
 * The list is the activity's (`Servers.kt`), the same in every document, so an
 * address `remember` added stays for the next one and a server `forgetAcross`
 * took out stays out: sessionStorage, because a document has nothing else it
 * can read synchronously, as the page reads `servers()`, that outlives it. A
 * probe is answered asynchronously,
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
		const added = () => JSON.parse(sessionStorage.getItem('added') ?? '[]') as string[];
		window.TsundokuTV = {
			tvAddress: () => '192.168.1.31',
			prefix: () => '192.168.1.',
			defaultPort: () => 42143,
			remembered: () => list[0]?.origin ?? '',
			servers: () =>
				JSON.stringify(
					[...list, ...added().map((origin) => ({ origin, name: '', tvName: '', opened: 0 }))]
						.filter((s) => !sessionStorage.getItem(`forgotten:${s.origin}`))
						.map((s, i) => ({ ...s, shown: shown(s), inUse: i === 0 }))
				),
			remember: (at: string) => {
				sessionStorage.setItem('added', JSON.stringify([...added(), at]));
				void w.__acrossRemember(at);
			},
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

/** MORE › SERVERS › FORGET, as the next document will read the list. */
const forgetAcross = (page: Page, origin: string) =>
	page.evaluate((o) => sessionStorage.setItem(`forgotten:${o}`, '1'), origin);

/**
 * A page's own history.back(), scheduled so `evaluate` has returned first: the
 * step tears this document down, and one taken inside the evaluate can destroy
 * its context before the answer comes back (seen red under load, wave 35).
 */
const stepBack = (page: Page) =>
	page.evaluate(() => {
		setTimeout(() => history.back(), 0);
	});

test('a given address leaves its entry without the fragment once it is checked, the token kept (c685)', async ({
	page
}) => {
	await stubAcross(page, three);
	// How long the history was when this document began, before its script
	// ran (Playwright's page starts on about:blank, an entry of its own).
	await page.addInitScript(() => {
		(window as unknown as { __entries: number }).__entries = history.length;
	});
	await page.goto(`${page9}?t=${TOKEN}#connect=${encodeURIComponent(HOME)}`);
	await expect(page.locator('#connect')).toBeVisible();
	await expect(page.locator('#connect-line')).toContainText('192.168.1.23:42143');
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

test('a history step into an old #connect= entry checks nothing again (c685)', async ({ page }) => {
	const across = await stubAcross(page, three);
	across.answers.set(HOME, true);
	await page.goto(`${page9}?t=${TOKEN}#connect=${encodeURIComponent(HOME)}`);
	// The first visit opens the server in the list, and the WebView leaves
	// for it (the stub's open() does not navigate, so this test does).
	await expect.poll(() => across.opened).toEqual([HOME]);
	expect(across.probes).toEqual([HOME]);
	await page.goto(`${HOME}/`);

	// Any page the WebView shows can step back into the pair page's entry,
	// which carries the app's own token.
	await stepBack(page);
	await page.waitForURL(`${page9}?t=${TOKEN}`);
	// The entry is the pair page with no door in it: 9A, and nothing checked.
	await expect(page.locator('#start')).toBeVisible();
	await expect(page.locator('#connect')).toBeHidden();
	expect(across.probes).toEqual([HOME]);
	expect(across.opened).toEqual([HOME]);
	expect(across.remembered).toEqual([]);
	expect(page.url()).toBe(`${page9}?t=${TOKEN}`);
});

test('a history step into an old #lost= entry does not bring a forgotten server back (c685)', async ({
	page
}) => {
	const across = await stubAcross(page, [
		...three,
		{ origin: GONE, name: '', tvName: '', opened: 0 }
	]);
	// 9D for a server that does not answer, then nobody waits on it: the owner
	// forgets it, and another server opens (an app load, which leaves a history
	// entry of its own).
	across.answers.set(GONE, false);
	await page.goto(`${page9}?t=${TOKEN}#lost=${encodeURIComponent(GONE)}`);
	await expect(page.locator('#lost-title')).toContainText('192.168.1.88:42143');
	expect(await page.evaluate(() => location.hash)).toBe('');
	expect(page.url()).toBe(`${page9}?t=${TOKEN}`);
	await forgetAcross(page, GONE);
	await page.goto(`${HOME}/`);

	// It answers now, and it has been forgotten. The entry lost its fragment, so
	// a step back into it is 9A: neither 9D nor the question a replayed #lost=
	// would now put up for an address the list no longer holds.
	across.answers.set(GONE, true);
	await stepBack(page);
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
	await page.goto(`${page9}?t=${TOKEN}#connect=${encodeURIComponent(HOME)}`);
	await expect(page.locator('#connect')).toBeVisible();
	await expect.poll(() => across.probes).toEqual([HOME]);
	// A singleTask app started again with the same address: MainActivity's
	// loadAsset sets the same fragment on this same document (c260). The entry
	// has none now, so it is a change, and the address is checked again.
	await page.evaluate((at) => {
		location.hash = '#connect=' + encodeURIComponent(at);
	}, HOME);
	await expect.poll(() => across.probes).toEqual([HOME, HOME]);
	await expect(page.locator('#connect')).toBeVisible();
	expect(await page.evaluate(() => location.hash)).toBe('');
	expect(await page.evaluate(() => location.search)).toBe(`?t=${TOKEN}`);
});

// ---- c683: an address that arrived by a link waits for the owner ------------

/** Everything the page has asked the bridge, read at once. */
const asked = (page: Page) =>
	page.evaluate(() => ({
		probes: window.__bridge!.probes,
		remembered: window.__bridge!.remembered
	}));

/** The address a link hands over, and the /pair/tv it leaves for, aborted. */
const LINKED = 'https://library.example.com:8443';
async function holdPairing(page: Page) {
	const navigations: string[] = [];
	await page.route(`${LINKED}/**`, (route) => {
		navigations.push(route.request().url());
		return route.abort();
	});
	return navigations;
}

test('a link shows its address and stores nothing until CONNECT, then once (c683)', async ({
	page
}) => {
	const bridge = await stubBridge(page, { answer: true });
	const navigations = await holdPairing(page);
	await page.goto(`${page9}?t=${TOKEN}#ask=${encodeURIComponent(LINKED)}`);

	// 9B, the field filled, saying where the address came from.
	await expect(page.locator('#next')).toBeVisible();
	await expect(page.locator('#last')).toHaveValue(LINKED);
	await expect(page.locator('#already-line')).toContainText('CAME FROM A LINK');
	await expect(page.locator('#already-line')).toContainText('PRESS CONNECT');
	await expect(page.locator('#next')).toHaveText('CONNECT →');
	await expect(page.locator('#tv-meta')).toContainText(LINKED);

	// Neither asked nor stored, and the screen is settled, so this is not a
	// read taken before the page got round to it.
	expect(await asked(page)).toEqual({ probes: [], remembered: [] });
	expect(bridge.remembered).toEqual([]);

	// A link is opened by a press, so the mark is not on the answer: OK now
	// would be the stray one. CONNECT is one step up.
	await expect(page.locator('#whole-toggle')).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(page.locator('#next')).toBeFocused();
	await page.keyboard.press('Enter');

	await expect.poll(() => navigations.length).toBeGreaterThan(0);
	expect(navigations[0]).toBe(`${LINKED}/pair/tv`);
	expect(bridge.remembered).toEqual([LINKED]);
});

test('the stray OK a link was opened with does not answer the question (c683)', async ({
	page
}) => {
	const bridge = await stubBridge(page, { answer: true });
	await holdPairing(page);
	await page.goto(`${page9}#ask=${encodeURIComponent(LINKED)}`);
	await expect(page.locator('#whole-toggle')).toBeFocused();

	await page.keyboard.press('Enter');

	// The way out: 9B as START leaves it, with nothing of the link in it.
	await expect(page.locator('#already')).toBeHidden();
	await expect(page.locator('#last')).toHaveValue('');
	await expect(page.locator('#next')).toHaveText('NEXT →');
	await expect(page.locator('#prefix')).toBeVisible();
	await expect(page.locator('#address-label')).toContainText('ON ITS SCREEN');
	expect(await asked(page)).toEqual({ probes: [], remembered: [] });
	expect(bridge.remembered).toEqual([]);
});

test('a #connect= for an address not in the list asks, whoever wrote it (c683)', async ({
	page
}) => {
	const bridge = await stubBridge(page, { answer: true });
	await holdPairing(page);
	await page.goto(`${page9}#connect=${encodeURIComponent(LINKED)}`);
	await expect(page.locator('#last')).toHaveValue(LINKED);
	await expect(page.locator('#already')).toBeVisible();
	await expect(page.locator('#connect')).toBeHidden();
	expect(await asked(page)).toEqual({ probes: [], remembered: [] });
	expect(bridge.remembered).toEqual([]);
});

test('an #ask= that is not http(s) is refused, and nothing is asked (c683)', async ({ page }) => {
	await stubBridge(page, { answer: true });
	await page.goto(`${page9}#ask=${encodeURIComponent('javascript:alert(1)')}`);
	await expect(page.locator('#refused')).toBeVisible();
	await expect(page.locator('#already')).toBeHidden();
	await expect(page.locator('#last')).toHaveValue('');
	expect(await asked(page)).toEqual({ probes: [], remembered: [] });
});

test('a link leaves its entry without the fragment, and a history step shows 9A (c683)', async ({
	page
}) => {
	const across = await stubAcross(page, three);
	await page.goto(`${page9}?t=${TOKEN}#ask=${encodeURIComponent(GONE)}`);
	await expect(page.locator('#last')).toHaveValue(GONE);
	expect(await page.evaluate(() => location.hash)).toBe('');
	expect(page.url()).toBe(`${page9}?t=${TOKEN}`);

	// The owner went elsewhere without answering. Any page the WebView shows
	// can step back here, and the entry must not put the question up again.
	await page.goto(`${HOME}/`);
	await stepBack(page);
	await page.waitForURL(`${page9}?t=${TOKEN}`);
	await expect(page.locator('#start')).toBeVisible();
	await expect(page.locator('#already')).toBeHidden();
	expect(across.probes).toEqual([]);
	expect(across.remembered).toEqual([]);
});

test('a second link with the same address asks again; one with another replaces it (c683)', async ({
	page
}) => {
	const across = await stubAcross(page, three);
	await page.goto(`${page9}?t=${TOKEN}#ask=${encodeURIComponent(GONE)}`);
	await expect(page.locator('#last')).toHaveValue(GONE);

	// The owner cleared the field; the same link again is a fragment change,
	// because the first left the entry without one, so the question returns.
	await page.locator('#last').fill('');
	await page.evaluate((at) => {
		location.hash = '#ask=' + encodeURIComponent(at);
	}, GONE);
	await expect(page.locator('#last')).toHaveValue(GONE);

	await page.evaluate((at) => {
		location.hash = '#ask=' + encodeURIComponent(at);
	}, LINKED);
	await expect(page.locator('#last')).toHaveValue(LINKED);
	await expect(page.locator('#tv-meta')).toContainText(LINKED);
	expect(across.probes).toEqual([]);
	expect(across.remembered).toEqual([]);
});

test('a second link while CONNECT is checking drops the first answer (c683)', async ({ page }) => {
	const bridge = await stubBridge(page, { hold: true });
	await holdPairing(page);
	await page.goto(`${page9}#ask=${encodeURIComponent(LINKED)}`);
	await page.locator('#next').click();
	await expect.poll(() => page.evaluate(() => window.__bridge!.pending)).toBe(LINKED);
	await expect(page.locator('#next')).toBeDisabled();

	await page.evaluate((at) => {
		location.hash = '#ask=' + encodeURIComponent(at);
	}, ZEN);
	await expect(page.locator('#last')).toHaveValue(ZEN);
	await expect(page.locator('#next')).toBeEnabled();

	// The press was for the address that has gone from the screen.
	await page.evaluate((at) => window.tsundokuProbe?.(at, true), LINKED);
	await expect(page.locator('#last')).toHaveValue(ZEN);
	expect(bridge.remembered).toEqual([]);
	expect(page.url().startsWith(page9)).toBe(true);
});

test('leaving the question while CONNECT is checking drops its answer (c683)', async ({ page }) => {
	const bridge = await stubBridge(page, { hold: true });
	await holdPairing(page);
	await page.goto(`${page9}#ask=${encodeURIComponent(LINKED)}`);
	await page.locator('#next').click();
	await expect.poll(() => page.evaluate(() => window.__bridge!.pending)).toBe(LINKED);

	await page.locator('#whole-toggle').click();
	await expect(page.locator('#already')).toBeHidden();
	await page.evaluate((at) => window.tsundokuProbe?.(at, true), LINKED);
	await expect(page.locator('#next')).toBeVisible();
	await expect(page.locator('#last')).toHaveValue('');
	expect(bridge.remembered).toEqual([]);
	expect(page.url().startsWith(page9)).toBe(true);
});

test('CONNECT is not swallowed by a late answer for the same address (c683)', async ({ page }) => {
	const bridge = await stubBridge(page, { hold: true });
	await holdPairing(page);
	await page.goto(`${page9}#ask=${encodeURIComponent(LINKED)}`);
	await page.locator('#next').click();
	await expect.poll(() => page.evaluate(() => window.__bridge!.pending)).toBe(LINKED);

	// The link again, before its first probe answered: that answer is dropped,
	// and it leaves the origin in the page's 2 s window on its way.
	await page.evaluate((at) => {
		location.hash = '#ask=' + encodeURIComponent(at);
	}, LINKED);
	await expect(page.locator('#next')).toBeEnabled();
	await page.evaluate((at) => window.tsundokuProbe?.(at, true), LINKED);
	expect(bridge.remembered).toEqual([]);

	// Inside that window, the owner answers. Dropping this answer too would
	// leave CHECKING up and CONNECT disabled for good.
	await page.locator('#next').click();
	await expect.poll(() => page.evaluate(() => window.__bridge!.probes.length)).toBe(2);
	await page.evaluate((at) => window.tsundokuProbe?.(at, true), LINKED);
	await expect.poll(() => bridge.remembered).toEqual([LINKED]);
});

test('CONNECT pressed twice asks once and stores once (c683)', async ({ page }) => {
	const bridge = await stubBridge(page, { hold: true });
	await holdPairing(page);
	await page.goto(`${page9}#ask=${encodeURIComponent(LINKED)}`);
	await page.locator('#next').click();
	await expect.poll(() => page.evaluate(() => window.__bridge!.pending)).toBe(LINKED);

	// While it is checked the question's band stays up, and the column under it.
	await expect(page.locator('#already')).toBeVisible();
	const bandEnd = await page
		.locator('#already')
		.evaluate((el) => el.getBoundingClientRect().bottom);
	const labelTop = await page
		.locator('.address-label')
		.evaluate((el) => el.getBoundingClientRect().top);
	expect(labelTop).toBeGreaterThanOrEqual(bandEnd);

	// The button is disabled, so the second press is Enter in the field, which
	// the form's submit takes whether or not CONNECT can be clicked.
	await page.locator('#last').press('Enter');
	expect(await page.evaluate(() => window.__bridge!.probes)).toEqual([LINKED]);
	await page.evaluate((at) => window.tsundokuProbe?.(at, true), LINKED);
	await expect.poll(() => bridge.remembered).toEqual([LINKED]);
});

test('CONNECT to an address that does not answer reaches 9D and stores nothing yet (c683)', async ({
	page
}) => {
	const bridge = await stubBridge(page, { hold: true });
	await holdPairing(page);
	await page.goto(`${page9}#ask=${encodeURIComponent(LINKED)}`);
	await page.locator('#next').click();
	await expect.poll(() => page.evaluate(() => window.__bridge!.pending)).toBe(LINKED);
	await page.evaluate((at) => window.tsundokuProbe?.(at, false), LINKED);

	await expect(page.locator('#retry')).toBeVisible();
	await expect(page.locator('#lost-title')).toContainText('library.example.com:8443');
	expect(bridge.remembered).toEqual([]);

	// 9D's own TRY AGAIN, past the page's 2 s window: the owner pressed
	// CONNECT for this address, so its answering now is what was asked for.
	await page.waitForTimeout(2100);
	await page.locator('#retry').click();
	await page.evaluate((at) => window.tsundokuProbe?.(at, true), LINKED);
	await expect.poll(() => bridge.remembered).toEqual([LINKED]);
});

test('a refusal over the question leaves 9B as it was, not half a question (c683)', async ({
	page
}) => {
	await stubBridge(page, { answer: true });
	await page.goto(`${page9}#ask=${encodeURIComponent(LINKED)}`);
	await expect(page.locator('#already')).toBeVisible();
	await page.evaluate(() => {
		location.hash = '#bad=' + encodeURIComponent('ftp://zen.local');
	});
	await expect(page.locator('#refused')).toBeVisible();
	await expect(page.locator('#already')).toBeHidden();
	await expect(page.locator('#last')).toHaveValue('');
	await expect(page.locator('#next')).toHaveText('NEXT →');
	await expect(page.locator('#prefix')).toBeVisible();
	await expect(page.locator('#address-label')).toContainText('ON ITS SCREEN');
});

test('a link to a server the list gained meanwhile opens it and stores nothing (c683)', async ({
	page
}) => {
	await stubServers(page, three, { [ZEN]: { ok: true } });
	await page.goto(`${page9}#ask=${encodeURIComponent(ZEN)}`);
	await expect(page.locator('#last')).toHaveValue(ZEN);
	await page.locator('#next').click();
	await expect.poll(() => page.evaluate(() => window.__servers!.opened)).toEqual([ZEN]);
	expect(await page.evaluate(() => window.__servers!.remembered)).toEqual([]);
});

test('BACK from the question returns to the library and saves nothing (c683)', async ({ page }) => {
	await stubServers(page, three);
	await page.goto(`${page9}#ask=${encodeURIComponent(LINKED)}`);
	await expect(page.locator('#already')).toBeVisible();
	const backed = await page.evaluate(() =>
		(window as unknown as { tsundokuBack: () => boolean }).tsundokuBack()
	);
	expect(backed).toBe(true);
	expect(await page.evaluate(() => window.__servers!.opened)).toEqual([HOME]);
	expect(await page.evaluate(() => window.__servers!.remembered)).toEqual([]);
	expect(await page.evaluate(() => window.__servers!.probes)).toEqual([]);
});

test("BACK from the question with no server left is the app's to take (c683)", async ({ page }) => {
	await stubServers(page, []);
	await page.goto(`${page9}#ask=${encodeURIComponent(LINKED)}`);
	await expect(page.locator('#already')).toBeVisible();
	expect(
		await page.evaluate(() => (window as unknown as { tsundokuBack: () => boolean }).tsundokuBack())
	).toBe(false);
	expect(await page.evaluate(() => window.__servers!.remembered)).toEqual([]);
});

const pressBack = (page: Page) =>
	page.evaluate(() => (window as unknown as { tsundokuBack: () => boolean }).tsundokuBack());

/*
 * BACK asks the app to open the library, which is a loadUrl: this document runs
 * on until that navigation commits, and a slow library leaves the probe's whole
 * 6 s for an answer to land in. So `open()` here records and stays, as the real
 * document does, and the probe is held until BACK has been pressed. With no
 * server BACK is the app's (`false`), and the answer must be dropped all the
 * same: the screen said BACK leaves without saving, and a 9D would take the
 * screen from whatever the app is doing next.
 */
for (const { where, list, backed, opened } of [
	{ where: 'with a server in use', list: three, backed: true, opened: [HOME] },
	{ where: 'with no server left', list: [], backed: false, opened: [] }
])
	for (const ok of [true, false])
		test(`BACK while CONNECT is checking, ${where}: a late ${ok ? 'answer' : 'failure'} saves and moves nothing (c683)`, async ({
			page
		}) => {
			const across = await stubAcross(page, list);
			const navigations = await holdPairing(page);
			await page.goto(`${page9}#ask=${encodeURIComponent(LINKED)}`);
			await page.locator('#next').click();
			await expect.poll(() => across.probes).toEqual([LINKED]);
			await expect(page.locator('#checking')).toContainText('CHECKING library.example.com:8443');

			expect(await pressBack(page)).toBe(backed);
			await expect.poll(() => across.opened).toEqual(opened);

			await page.evaluate(({ at, ok }) => window.tsundokuProbe?.(at, ok), { at: LINKED, ok });
			// Time for anything that answer started: a navigation destroys this
			// context, and what it stored and where it went are read below.
			await page.evaluate(() => new Promise((done) => setTimeout(done, 200))).catch(() => {});
			expect(across.remembered).toEqual([]);
			expect(navigations).toEqual([]);
			expect(page.url().startsWith(page9)).toBe(true);
			await expect(page.locator('#retry')).toBeHidden();
			expect(across.probes).toEqual([LINKED]);
		});

// ---- c683, round 2: #lost= is a fragment too -------------------------------

test('a #lost= for an origin not in the list asks: no probe and no remember until CONNECT, then one of each (c683)', async ({
	page
}) => {
	const across = await stubAcross(page, three);
	const navigations = await holdPairing(page);
	// MainActivity.onReceivedError writes this for any failed main-frame load,
	// a page's own closed port or an external link included, unasked.
	await page.goto(`${page9}?t=${TOKEN}#lost=${encodeURIComponent(LINKED)}`);
	await expect(page.locator('#already')).toBeVisible();
	await expect(page.locator('#last')).toHaveValue(LINKED);
	await expect(page.locator('#next')).toHaveText('CONNECT →');
	await expect(page.locator('#retry')).toBeHidden();
	expect(page.url()).toBe(`${page9}?t=${TOKEN}`);

	// One 9D retry tick is 5 s, and that tick is what used to store it.
	await page.waitForTimeout(5600);
	expect(across.probes).toEqual([]);
	expect(across.remembered).toEqual([]);

	across.answers.set(LINKED, true);
	await page.locator('#next').click();
	await expect.poll(() => across.remembered).toEqual([LINKED]);
	expect(across.probes).toEqual([LINKED]);
	await expect.poll(() => navigations).toEqual([`${LINKED}/pair/tv`]);
});

test('a #lost= for a server in the list still reaches 9D, retries, and opens it (c683)', async ({
	page
}) => {
	const across = await stubAcross(page, three);
	across.answers.set(HOME, false);
	await page.goto(`${page9}#lost=${encodeURIComponent(HOME)}`);
	await expect(page.locator('#retry')).toBeVisible();
	await expect(page.locator('#lost-title')).toContainText('LIVING ROOM');
	await expect(page.locator('#already')).toBeHidden();
	const tried = () => across.probes.filter((at) => at === HOME).length;
	await expect.poll(tried, { timeout: 8000 }).toBe(1);
	across.answers.set(HOME, true);
	await expect.poll(tried, { timeout: 8000 }).toBe(2);
	await expect.poll(() => across.opened).toEqual([HOME]);
	expect(across.remembered).toEqual([]);
});

test('a #lost= spelled in capitals is still the server in the list (c683)', async ({ page }) => {
	const across = await stubAcross(page, three);
	await page.goto(`${page9}#lost=${encodeURIComponent('HTTP://192.168.1.23:42143')}`);
	await expect(page.locator('#retry')).toBeVisible();
	await expect(page.locator('#already')).toBeHidden();
	expect(across.remembered).toEqual([]);
});

test('a #lost= that is not http(s) is refused, and nothing is asked (c683)', async ({ page }) => {
	const across = await stubAcross(page, three);
	await page.goto(`${page9}#lost=${encodeURIComponent('ftp://zen.local')}`);
	await expect(page.locator('#refused')).toBeVisible();
	await expect(page.locator('#already')).toBeHidden();
	await expect(page.locator('#last')).toHaveValue('');
	expect(across.probes).toEqual([]);
});

test('a server remembered just before its /pair/tv failed is in the list: 9D, stored once (c683)', async ({
	page
}) => {
	const across = await stubAcross(page, three);
	const navigations = await holdPairing(page);
	await page.goto(`${page9}?t=${TOKEN}#ask=${encodeURIComponent(LINKED)}`);
	across.answers.set(LINKED, true);
	await page.locator('#next').click();
	await expect.poll(() => navigations).toEqual([`${LINKED}/pair/tv`]);
	expect(across.remembered).toEqual([LINKED]);
	// The aborted load commits an error page; a goto before that is interrupted
	// by it (red 4 of 5 under --repeat-each).
	await expect.poll(() => page.url()).toContain('chrome-error');

	// That load failed, and onReceivedError loads the app's page again: the
	// bridge's remember is synchronous, so the list already holds the address.
	await page.goto(`${page9}?t=${TOKEN}#lost=${encodeURIComponent(LINKED)}`);
	await expect(page.locator('#retry')).toBeVisible();
	await expect(page.locator('#lost-title')).toContainText('library.example.com:8443');
	await expect(page.locator('#already')).toBeHidden();
	expect(across.remembered).toEqual([LINKED]);
});

test('a #lost= that asks stops the retry of the 9D it replaces (c683)', async ({ page }) => {
	const across = await stubAcross(page, three);
	across.answers.set(HOME, false);
	await page.goto(`${page9}#lost=${encodeURIComponent(HOME)}`);
	await expect(page.locator('#retry')).toBeVisible();
	await page.evaluate((at) => {
		location.hash = '#lost=' + encodeURIComponent(at);
	}, LINKED);
	await expect(page.locator('#already')).toBeVisible();
	const before = across.probes.length;
	await page.waitForTimeout(5600);
	expect(across.probes.slice(before)).toEqual([]);
	await expect(page.locator('#retry')).toBeHidden();
});

// ---- c683, round 3: the 80-character limit holds in the page ----------------

/** An origin of exactly `length` characters. */
const originOfLength = (length: number) => {
	const head = 'https://';
	const tail = '.example.net';
	const at = head + 'a'.repeat(length - head.length - tail.length) + tail;
	expect(at.length).toBe(length);
	return at;
};
const LONGEST = originOfLength(80);
const TOO_LONG = originOfLength(81);

test('a #lost= over 80 characters for an origin not in the list is refused, a retry tick later too (c683)', async ({
	page
}) => {
	const across = await stubAcross(page, three);
	await page.goto(`${page9}?t=${TOKEN}#lost=${encodeURIComponent(TOO_LONG)}`);
	const refusedAndNothingAsked = async () => {
		await expect(page.locator('#refused')).toBeVisible();
		await expect(page.locator('#already')).toBeHidden();
		await expect(page.locator('#last')).toHaveValue('');
		await expect(page.locator('#next')).toHaveText('NEXT →');
		await expect(page.locator('#retry')).toBeHidden();
		expect(across.probes).toEqual([]);
		expect(across.remembered).toEqual([]);
	};
	await refusedAndNothingAsked();
	expect(page.url()).toBe(`${page9}?t=${TOKEN}`);

	// One 9D retry tick is 5 s, which is what would have probed it.
	await page.waitForTimeout(5600);
	await refusedAndNothingAsked();
});

test('a #lost= of exactly 80 characters for an origin not in the list asks (c683)', async ({
	page
}) => {
	const across = await stubAcross(page, three);
	await page.goto(`${page9}#lost=${encodeURIComponent(LONGEST)}`);
	await expect(page.locator('#already')).toBeVisible();
	await expect(page.locator('#last')).toHaveValue(LONGEST);
	await expect(page.locator('#next')).toHaveText('CONNECT →');
	await expect(page.locator('#refused')).toBeHidden();
	expect(across.probes).toEqual([]);
	expect(across.remembered).toEqual([]);
});

test('a #lost= over 80 characters for a server in the list still reaches 9D and retries (c683)', async ({
	page
}) => {
	const across = await stubAcross(page, [
		{ origin: TOO_LONG, name: 'LONG ONE', tvName: '', opened: 1 }
	]);
	across.answers.set(TOO_LONG, false);
	await page.goto(`${page9}#lost=${encodeURIComponent(TOO_LONG)}`);
	await expect(page.locator('#retry')).toBeVisible();
	await expect(page.locator('#refused')).toBeHidden();
	await expect(page.locator('#already')).toBeHidden();
	const tried = () => across.probes.filter((at) => at === TOO_LONG).length;
	await expect.poll(tried, { timeout: 8000 }).toBe(1);
	across.answers.set(TOO_LONG, true);
	await expect.poll(tried, { timeout: 8000 }).toBe(2);
	await expect.poll(() => across.opened).toEqual([TOO_LONG]);
	expect(across.remembered).toEqual([]);
});

test('a #connect= over 80 characters for an origin not in the list is refused (c683)', async ({
	page
}) => {
	const across = await stubAcross(page, three);
	await page.goto(`${page9}?t=${TOKEN}#connect=${encodeURIComponent(TOO_LONG)}`);
	await expect(page.locator('#refused')).toBeVisible();
	await expect(page.locator('#already')).toBeHidden();
	await expect(page.locator('#last')).toHaveValue('');
	await expect(page.locator('#connect')).toBeHidden();
	expect(page.url()).toBe(`${page9}?t=${TOKEN}`);
	expect(across.probes).toEqual([]);
	expect(across.remembered).toEqual([]);
});

test('the question fits a TV: the band whole, an 80-character address over the buttons (c683)', async ({
	page
}) => {
	await stubBridge(page, { answer: true });
	// The longest an address gets here (Given.MAX_ASKED, 9B's own maxLength).
	const longest = 'https://' + 'a'.repeat(40) + '.' + 'b'.repeat(19) + '.example.net';
	expect(longest.length).toBe(80);
	await page.goto(`${page9}#ask=${encodeURIComponent(longest)}`);
	await expect(page.locator('#already')).toBeVisible();

	// The band does not wrap, so it must fit at a TV's 0.6 em a glyph.
	const room = await page
		.locator('#already')
		.evaluate((el) => el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) * 2);
	expect(await tvMonoWidth(page, '#already-line')).toBeLessThanOrEqual(room);

	// The meta line carries the address whole and ends above the buttons, at
	// a TV's width: 0.6 em a glyph, not this box's narrower font.
	await expect(page.locator('#tv-meta')).toContainText(longest);
	const lines = await page.locator('#tv-meta').evaluate((el) => {
		const css = getComputedStyle(el);
		const size = parseFloat(css.fontSize);
		const glyphs = (el as HTMLElement).innerText.trim().length;
		const lineHeight = parseFloat(css.lineHeight);
		const wide = Math.ceil((glyphs * size * (1229 / 2048)) / el.clientWidth);
		return { height: wide * lineHeight, top: el.getBoundingClientRect().top };
	});
	const actions = await page
		.locator('.address-actions')
		.evaluate((el) => el.getBoundingClientRect().top);
	expect(lines.top + lines.height).toBeLessThanOrEqual(actions);

	// And the column sits under the band, as with every band on 9B.
	const band = await page.locator('#already').evaluate((el) => el.getBoundingClientRect().bottom);
	const label = await page
		.locator('.address-label')
		.evaluate((el) => el.getBoundingClientRect().top);
	expect(label).toBeGreaterThanOrEqual(band);
});

test.describe('on a phone, 360 x 780', () => {
	test.use({ viewport: { width: 360, height: 780 } });

	test('the question stands on the phone column, whole, with no keyboard up (c683)', async ({
		page
	}) => {
		await page.addInitScript(() => {
			const w = window as unknown as { __keyboard: number };
			w.__keyboard = 0;
			window.__bridge = { probes: [], remembered: [], pending: '' };
			window.TsundokuTV = {
				form: () => 'mobile',
				network: () => 'home',
				tvAddress: () => '192.168.1.40',
				prefix: () => '192.168.1.',
				defaultPort: () => 42143,
				remembered: () => '',
				servers: () => '[]',
				remember: (at: string) => window.__bridge!.remembered.push(at),
				probe: (at: string) => window.__bridge!.probes.push(at),
				keyboard: () => {
					w.__keyboard += 1;
				}
			};
		});
		const longest = 'https://' + 'a'.repeat(40) + '.' + 'b'.repeat(19) + '.example.net';
		await page.goto(`${page9}#ask=${encodeURIComponent(longest)}`);
		await expect(page.locator('html')).toHaveAttribute('data-device', 'phone');
		await expect(page.locator('#already')).toBeVisible();

		// A phone's band wraps, so the question is read whole, and the address
		// breaks rather than running off a 360 column.
		await expect(page.locator('#already-line')).toContainText('PRESS CONNECT');
		await expect(page.locator('#tv-meta')).toContainText(longest);
		for (const selector of ['#already-line', '#tv-meta', '#next', '#whole-toggle']) {
			const r = await page.locator(selector).evaluate((el) => {
				const b = el.getBoundingClientRect();
				return { right: b.right, bottom: b.bottom, over: el.scrollWidth - el.clientWidth };
			});
			expect(r.right, selector).toBeLessThanOrEqual(360);
			expect(r.bottom, selector).toBeLessThanOrEqual(780);
			expect(r.over, selector).toBeLessThanOrEqual(0);
		}

		// The keyboard is for typing, and nothing here needs it: it would push
		// the question up and put CONNECT under the thumb.
		expect(
			await page.evaluate(() => (window as unknown as { __keyboard: number }).__keyboard)
		).toBe(0);
		expect(await asked(page)).toEqual({ probes: [], remembered: [] });

		await page.locator('#next').click();
		expect(await asked(page)).toEqual({ probes: [longest], remembered: [] });
	});
});
