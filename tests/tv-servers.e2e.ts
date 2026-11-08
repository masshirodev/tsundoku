import { hostname } from 'node:os';
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The TV app's servers on the web side (c261; doc/TV-APP.md, "Servers";
 * doc/handoffs/tv-servers/): MORE's SERVERS row (S6), SERVERS (S2), a
 * server's options (S3) and FORGET (S4), drawn by MoreSheet over the library,
 * and the layout telling the app the server's name.
 *
 * Runs in the `tv` project, 960x540 with no pointer, because these are drawn
 * only where the APK's bridge (`window.TsundokuTV`) exists, and that is only
 * ever a TV. The bridge is stood up with an init script, as PairingBridge.kt
 * answers. Nothing here writes to the shared database: the list lives in the
 * stub, and opening a server only records the call.
 *
 * The measurements are TV-Servers.dc.html's, extracted with the design tools
 * (extract-spec, wave 21) rather than read by eye; they are asserted so a later
 * tidy-up cannot round the hand-set values onto a ladder.
 */

type Stub = { origin: string; name: string; tvName: string; opened: number };
type Calls = {
	probes: string[];
	opened: string[];
	forgot: string[];
	named: [string, string][];
	added: number;
	renamed: string[];
	welcome: number;
};

declare global {
	interface Window {
		__tv?: Calls;
		/** The app's RENAME, done behind the page's back (S5 is the APK's own screen). */
		__tvRename?: (origin: string, tvName: string) => void;
		/** c645: each held `servers()` answer's resolver, in the order the page asked. */
		__tvLater?: Array<(answer: string) => void>;
		/** c717: how many of the next `servers()` questions to hold. */
		__tvHold?: number;
	}
}

const HOME = 'http://192.168.1.23:42143';
const ZEN = 'https://zen.tailnet.ts.net:8443';
const STUDIO = 'http://192.168.1.61:42143';
const DAY = 86_400_000;

async function bridge(
	page: Page,
	list: Stub[],
	answers: Record<string, { ok: boolean; after: number }> = {},
	/**
	 * When FORGET is refused, as PairingBridge refuses a page it does not know
	 * (it answers "", c549): every call, or every call after the first, which
	 * is the real bridge once FORGET of the server in use has made that page
	 * unknown.
	 */
	refuse: 'never' | 'always' | 'after-first' = 'never'
) {
	await page.addInitScript(
		({ list, answers, refuse }) => {
			const calls: Calls = {
				probes: [],
				opened: [],
				forgot: [],
				named: [],
				added: 0,
				renamed: [],
				welcome: 0
			};
			window.__tv = calls;
			// The app keeps its list in its prefs: a reload reads what was written.
			const KEPT = '__tvState';
			let state: Stub[] = JSON.parse(sessionStorage.getItem(KEPT) ?? 'null') ?? [...list];
			const keep = () => sessionStorage.setItem(KEPT, JSON.stringify(state));
			window.__tvRename = (o: string, tvName: string) => {
				state = state.map((s) => (s.origin === o ? { ...s, tvName } : s));
				keep();
			};
			const shown = (s: Stub) => s.tvName || s.name || s.origin.replace(/^https?:\/\//, '');
			const json = () =>
				JSON.stringify(
					[...state]
						.sort((a, b) => b.opened - a.opened)
						.map((s, i) => ({ ...s, shown: shown(s), inUse: i === 0 }))
				);
			(window as unknown as { TsundokuTV: Record<string, unknown> }).TsundokuTV = {
				servers: json,
				open: (o: string) => calls.opened.push(o),
				probe: (o: string) => {
					calls.probes.push(o);
					const a = answers[o];
					// A negative delay holds the answer: the test sends it itself.
					if (a && a.after >= 0)
						setTimeout(
							() =>
								(
									window as unknown as { tsundokuProbe?: (o: string, ok: boolean) => void }
								).tsundokuProbe?.(o, a.ok),
							a.after
						);
				},
				forgetServer: (o: string) => {
					calls.forgot.push(o);
					if (refuse === 'always' || (refuse === 'after-first' && calls.forgot.length > 1))
						return '';
					state = state.filter((s) => s.origin !== o);
					keep();
					return json();
				},
				addServer: () => (calls.added += 1),
				renameServer: (o: string) => calls.renamed.push(o),
				welcome: () => (calls.welcome += 1),
				// As Servers.named: the entry for that origin takes the name, upper-cased.
				named: (o: string, n: string) => {
					calls.named.push([o, n]);
					state = state.map((s) => (s.origin === o ? { ...s, name: n.trim().toUpperCase() } : s));
					keep();
				}
			};
		},
		{ list, answers, refuse }
	);
}

const calls = (page: Page) => page.evaluate(() => window.__tv!);

/** MORE, the way a remote opens it: the cell focused, then OK. */
async function openMore(page: Page) {
	await page.goto('/');
	const more = page.locator('[data-focus-id="library-more"]');
	await more.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
	return page.getByRole('dialog', { name: 'More' });
}

const focusedText = (page: Page) =>
	page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText.trim() ?? '');

test('a page without the bridge draws no SERVERS row', async ({ page }) => {
	const sheet = await openMore(page);
	await expect(sheet.locator('.row').first()).toBeVisible();
	await expect(sheet.locator('[data-more-servers]')).toHaveCount(0);
	await expect(sheet.getByText('SERVERS')).toHaveCount(0);
});

test('S6: with one server, MORE ends on SERVERS · ADD ANOTHER, and it opens on + ADD', async ({
	page
}) => {
	await bridge(page, [{ origin: HOME, name: 'ZEN-HOME', tvName: '', opened: Date.now() }]);
	const sheet = await openMore(page);
	const row = sheet.locator('[data-more-servers]');
	await expect(row).toHaveText(/SERVERS →\s*1 · ADD ANOTHER/);
	// The last row in MORE.
	await expect(sheet.locator('.row').last()).toHaveAttribute('data-more-servers', '');
	// It is a stop the remote reaches from the rows above it.
	await sheet.locator('.row').first().focus();
	for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
	await expect(row).toBeFocused();
	await page.keyboard.press('Enter');

	await expect(sheet.locator('.p-head')).toHaveText(/SERVERS\s*1/);
	await expect(sheet.locator('[data-server]')).toHaveCount(1);
	await expect(sheet.locator('[data-server] .st')).toHaveText('IN USE');
	await expect(sheet.locator('[data-server] .g')).toHaveText('✓');
	await expect(sheet.locator('[data-server-add]')).toBeFocused();
	await page.keyboard.press('Enter');
	expect((await calls(page)).added).toBe(1);

	// BACK: to MORE, on the row that opened it.
	await page.keyboard.press('Escape');
	await expect(row).toBeFocused();
	await expect(sheet.locator('.p-head')).toHaveCount(0);
	// And once more, MORE closes.
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
});

test('S2: the one in use first, focus on the first not in use, each probed as it opens', async ({
	page
}) => {
	const now = Date.now();
	await bridge(
		page,
		[
			{ origin: STUDIO, name: 'STUDIO-PC', tvName: 'Studio', opened: now - 9 * DAY },
			{ origin: HOME, name: 'ZEN-HOME', tvName: 'Living room', opened: now },
			{ origin: ZEN, name: 'ZEN', tvName: "Masshiro's", opened: now - 3 * DAY }
		],
		// Studio answers before Masshiro's, which the test answers itself once
		// it has seen CHECKING: each lands on its own row.
		{ [ZEN]: { ok: true, after: -1 }, [STUDIO]: { ok: false, after: 100 } }
	);
	const sheet = await openMore(page);
	await expect(sheet.locator('[data-more-servers]')).toHaveText(
		/SERVERS →\s*3 · LIVING ROOM IN USE/
	);
	await sheet.locator('[data-more-servers]').focus();
	await page.keyboard.press('Enter');

	const rows = sheet.locator('[data-server]');
	await expect(rows).toHaveCount(3);
	await expect(rows.locator('.n > span:first-child')).toHaveText([
		'Living room',
		"Masshiro's",
		'Studio'
	]);
	await expect(rows.nth(0)).not.toBeFocused();
	await expect(rows.nth(1)).toBeFocused();
	expect((await calls(page)).probes.sort()).toEqual([HOME, STUDIO, ZEN].sort());
	await expect(rows.nth(2).locator('.st')).toHaveText('NO ANSWER');
	await expect(rows.nth(2).locator('.g')).toHaveText('○');
	await expect(rows.nth(1).locator('.st')).toHaveText('CHECKING');
	await page.evaluate(
		(o) =>
			(window as unknown as { tsundokuProbe?: (o: string, ok: boolean) => void }).tsundokuProbe?.(
				o,
				true
			),
		ZEN
	);
	await expect(rows.nth(1).locator('.st')).toHaveText('ANSWERS');
	await expect(rows.nth(1).locator('.g')).toHaveText('●');
	await expect(rows.nth(0).locator('.st')).toHaveText('IN USE');
	await expect(rows.nth(1).locator('.meta')).toHaveText('zen.tailnet.ts.net:8443');

	// The frame: TV-Servers.dc.html's list, as extracted. The panel rises in
	// from the right over --motion-panel (240 ms, `.rise` in motion.css), and
	// read before its transition ends its left edge is a fraction of a pixel
	// in: 960.4 at 216 ms of it (c707, measured), so it is read at rest.
	await page
		.locator('.sheet')
		.evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished.catch(() => undefined))));
	const panel = (await page.locator('.sheet').boundingBox())!;
	expect(panel.width).toBe(420);
	expect(panel.x + panel.width).toBe(960);
	const row = rows.nth(1);
	expect((await row.boundingBox())!.width).toBe(371);
	await expect(row).toHaveCSS('min-height', '72px');
	await expect(row).toHaveCSS('border-bottom-width', '1px');
	await expect(row.locator('.g')).toHaveCSS('width', '56px');
	await expect(row.locator('.g')).toHaveCSS('font-size', '18px');
	await expect(row.locator('.g')).toHaveCSS('border-right-width', '1px');
	await expect(row.locator('.b')).toHaveCSS('padding-left', '18px');
	await expect(row.locator('.b')).toHaveCSS('padding-right', '18px');
	await expect(row.locator('.b')).toHaveCSS('row-gap', '4px');
	await expect(row.locator('.n > span:first-child')).toHaveCSS('font-size', '20px');
	await expect(row.locator('.n > span:first-child')).toHaveCSS('line-height', '26px');
	await expect(row.locator('.st')).toHaveCSS('font-size', '14px');
	await expect(row.locator('.st')).toHaveCSS('letter-spacing', '0.56px');
	await expect(row.locator('.meta')).toHaveCSS('font-size', '15px');
	await expect(row.locator('.meta')).toHaveCSS('line-height', '19.5px');
	const head = sheet.locator('.p-head');
	await expect(head).toHaveCSS('height', '56px');
	await expect(head).toHaveCSS('padding-left', '22px');
	await expect(head).toHaveCSS('letter-spacing', '0.9px');
	await expect(head).toHaveCSS('border-bottom-width', '1px');
	const foot = sheet.locator('.p-foot');
	await expect(foot).toHaveCSS('padding-top', '14px');
	await expect(foot).toHaveCSS('padding-left', '22px');
	await expect(foot).toHaveCSS('column-gap', '22px');
	await expect(foot.locator('.key').first()).toHaveCSS('min-width', '26px');
	await expect(foot.locator('.key').first()).toHaveCSS('margin-right', '8px');
	await expect(foot.locator('.key').first()).toHaveCSS('font-size', '13px');
	await expect(foot).toHaveText(/OK\s*OPEN\s*MENU\s*OPTIONS\s*BACK\s*CLOSE/);

	// OK on another opens it at once; on the one in use, closes the panel.
	await page.keyboard.press('Enter');
	expect((await calls(page)).opened).toEqual([ZEN]);
	await rows.nth(0).focus();
	await page.keyboard.press('Enter');
	await expect(sheet).toBeHidden();
	expect((await calls(page)).opened).toEqual([ZEN]);
});

test("S3 and S4: MENU opens a server's options, FORGET is a confirmation the remote can't hit by accident", async ({
	page
}) => {
	const now = Date.now();
	await bridge(
		page,
		[
			{ origin: HOME, name: 'ZEN-HOME', tvName: 'Living room', opened: now },
			{ origin: ZEN, name: 'ZEN', tvName: "Masshiro's", opened: now - 3 * DAY },
			{ origin: STUDIO, name: '', tvName: '', opened: 0 }
		],
		{ [STUDIO]: { ok: false, after: 50 } }
	);
	// FORGET's 0.6 s is a timer: the test holds the page's clock while the
	// early keys arrive, so a loaded machine cannot let it run out first.
	await page.clock.install();
	const sheet = await openMore(page);
	await sheet.locator('[data-more-servers]').focus();
	await page.keyboard.press('Enter');
	const rows = sheet.locator('[data-server]');
	await rows.nth(1).focus();
	await page.keyboard.press('ContextMenu');

	await expect(sheet.locator('.p-head')).toHaveText(/MASSHIRO'S\s*OPTIONS/);
	await expect(sheet.locator('.p-row')).toHaveText([
		/ADDRESS\s*zen\.tailnet\.ts\.net:8443/,
		/ITS NAME\s*ZEN/,
		/OPENED\s*3 DAYS AGO/,
		/NOW\s*CHECKING/
	]);
	await expect(sheet.locator('[data-act="open"]')).toBeFocused();
	const prow = sheet.locator('.p-row').first();
	await expect(prow).toHaveCSS('min-height', '56px');
	await expect(prow.locator('.k')).toHaveCSS('width', '116px');
	await expect(prow.locator('.k')).toHaveCSS('padding-left', '22px');
	await expect(prow.locator('.k')).toHaveCSS('border-right-width', '1px');
	await expect(sheet.locator('.p-row .v').nth(1)).toHaveCSS('padding-left', '18px');
	await expect(sheet.locator('.p-row .v').nth(1)).toHaveCSS('font-size', '17px');
	const open = sheet.locator('[data-act="open"]');
	await expect(open).toHaveCSS('margin-top', '20px');
	await expect(open).toHaveCSS('border-top-width', '1px');
	await expect(open).toHaveCSS('min-height', '56px');
	await expect(open).toHaveCSS('padding-left', '22px');

	// BACK: to the list, on the same row.
	await page.keyboard.press('Escape');
	await expect(rows.nth(1)).toBeFocused();

	// The one never opened, never named: its host, NEVER, and its probe's answer.
	await rows.nth(2).focus();
	await page.keyboard.press('ContextMenu');
	await expect(sheet.locator('.p-row')).toHaveText([
		/ADDRESS\s*192\.168\.1\.61:42143/,
		/ITS NAME\s*NOT SAID YET/,
		/OPENED\s*NEVER/,
		/NOW\s*○ NO ANSWER/
	]);
	// RENAME is the app's own screen (S5).
	await sheet.locator('[data-act="rename"]').focus();
	await page.keyboard.press('Enter');
	expect((await calls(page)).renamed).toEqual([STUDIO]);

	// FORGET: its own panel, KEEP IT focused, FORGET out of reach for 0.6 s.
	await sheet.locator('[data-act="forget"]').focus();
	await page.clock.pauseAt(new Date(Date.now() + 60_000));
	await page.keyboard.press('Enter');
	await expect(sheet.locator('.p-head')).toHaveText('FORGET 192.168.1.61:42143?');
	await expect(sheet.locator('.prose p')).toHaveText(
		'This TV stops knowing 192.168.1.61:42143 and drops its pairing there. To come back, add it again and type six digits from that computer.'
	);
	await expect(sheet.locator('[data-act="keep"]')).toBeFocused();
	await expect(sheet.locator('[data-act="confirm"]')).toBeDisabled();
	// A held OK's tail, and an arrow, arriving at once: both dropped, the
	// panel still FORGET's, the mark still on KEEP IT, nothing forgotten.
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	await expect(sheet.locator('[data-act="keep"]')).toBeFocused();
	expect((await calls(page)).forgot).toEqual([]);
	await expect(sheet.locator('[data-act="confirm"]')).toBeDisabled();
	// 0.6 s on: FORGET can be reached.
	await page.clock.runFor(700);
	await page.clock.resume();
	await expect(sheet.locator('[data-act="confirm"]')).toBeEnabled();
	await page.keyboard.press('ArrowDown');
	await expect(sheet.locator('[data-act="confirm"]')).toBeFocused();
	await expect(sheet.locator('[data-act="confirm"]')).toHaveText('FORGET 192.168.1.61:42143');
	await page.keyboard.press('Enter');
	expect((await calls(page)).forgot).toEqual([STUDIO]);
	// Not the one in use: back to the list, two left, nothing opened.
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(1)).toBeFocused();
	expect((await calls(page)).opened).toEqual([]);
});

test('forgetting the one in use opens the next that answers; the last returns to 9A', async ({
	page
}) => {
	const now = Date.now();
	await bridge(
		page,
		[
			{ origin: HOME, name: '', tvName: 'Living room', opened: now },
			{ origin: STUDIO, name: '', tvName: 'Studio', opened: now - DAY },
			{ origin: ZEN, name: 'ZEN', tvName: '', opened: now - 2 * DAY }
		],
		// The next by when it was opened is Studio, which does not answer.
		{ [STUDIO]: { ok: false, after: 20 }, [ZEN]: { ok: true, after: 20 } }
	);
	const sheet = await openMore(page);
	await sheet.locator('[data-more-servers]').focus();
	await page.keyboard.press('Enter');
	const rows = sheet.locator('[data-server]');
	await expect(rows.nth(2).locator('.st')).toHaveText('ANSWERS');
	await rows.nth(0).focus();
	await page.keyboard.press('ContextMenu');
	await sheet.locator('[data-act="forget"]').focus();
	await page.keyboard.press('Enter');
	await expect(sheet.locator('[data-act="confirm"]')).toBeEnabled();
	await sheet.locator('[data-act="confirm"]').focus();
	await page.keyboard.press('Enter');
	const c = await calls(page);
	expect(c.forgot).toEqual([HOME]);
	expect(c.opened).toEqual([ZEN]);
});

test('a refused FORGET changes nothing: no 9A, nothing opened, the list as it was (c549)', async ({
	page
}) => {
	const now = Date.now();
	await bridge(
		page,
		[
			{ origin: HOME, name: '', tvName: 'Living room', opened: now },
			{ origin: STUDIO, name: '', tvName: 'Studio', opened: now - DAY }
		],
		{},
		'always'
	);
	const sheet = await openMore(page);
	await sheet.locator('[data-more-servers]').focus();
	await page.keyboard.press('Enter');
	const rows = sheet.locator('[data-server]');
	await expect(rows).toHaveCount(2);
	await rows.nth(1).focus();
	await page.keyboard.press('ContextMenu');
	await sheet.locator('[data-act="forget"]').focus();
	await page.keyboard.press('Enter');
	const confirm = sheet.locator('[data-act="confirm"]');
	await expect(confirm).toBeEnabled();
	await confirm.focus();
	await page.keyboard.press('Enter');
	await page.waitForTimeout(200);
	const c = await calls(page);
	expect(c.forgot).toEqual([STUDIO]);
	// Until round 2 of c549 the "" (then "[]") read as "the last one is gone": 9A.
	expect(c.welcome).toBe(0);
	expect(c.opened).toEqual([]);
	// Still FORGET's panel, and FORGET can be pressed again.
	await expect(sheet.locator('.p-head')).toHaveText('FORGET STUDIO?');
	await expect(confirm).toBeEnabled();
	// BACK twice: the list, both still there.
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(1)).toBeFocused();
});

test('FORGET of the one in use pressed twice opens the next once and never 9A (c549)', async ({
	page
}) => {
	const now = Date.now();
	await bridge(
		page,
		[
			{ origin: HOME, name: '', tvName: 'Living room', opened: now },
			{ origin: STUDIO, name: '', tvName: 'Studio', opened: now - DAY }
		],
		{ [STUDIO]: { ok: true, after: 20 } },
		// The real bridge: the first FORGET made this page's server unknown.
		'after-first'
	);
	const sheet = await openMore(page);
	await sheet.locator('[data-more-servers]').focus();
	await page.keyboard.press('Enter');
	const rows = sheet.locator('[data-server]');
	await expect(rows.nth(1).locator('.st')).toHaveText('ANSWERS');
	await rows.nth(0).focus();
	await page.keyboard.press('ContextMenu');
	await sheet.locator('[data-act="forget"]').focus();
	await page.keyboard.press('Enter');
	const confirm = sheet.locator('[data-act="confirm"]');
	await expect(confirm).toBeEnabled();
	// A double tap: both presses land before the page redraws, and the
	// stub's open() does not navigate, as the next page has not committed.
	await confirm.evaluate((b: HTMLButtonElement) => {
		b.click();
		b.click();
	});
	await page.waitForTimeout(200);
	const c = await calls(page);
	expect(c.forgot).toEqual([HOME]);
	expect(c.opened).toEqual([STUDIO]);
	expect(c.welcome).toBe(0);
});

test('forgetting the only server returns the TV to 9A', async ({ page }) => {
	await bridge(page, [{ origin: HOME, name: '', tvName: '', opened: Date.now() }]);
	const sheet = await openMore(page);
	await sheet.locator('[data-more-servers]').focus();
	await page.keyboard.press('Enter');
	await sheet.locator('[data-server]').focus();
	await page.keyboard.press('ContextMenu');
	await sheet.locator('[data-act="forget"]').focus();
	await page.keyboard.press('Enter');
	await expect(sheet.locator('[data-act="confirm"]')).toBeEnabled();
	await sheet.locator('[data-act="confirm"]').focus();
	await page.keyboard.press('Enter');
	const c = await calls(page);
	expect(c.forgot).toEqual([HOME]);
	expect(c.welcome).toBe(1);
	expect(c.opened).toEqual([]);
});

test.describe('the TV app', () => {
	test.use({
		userAgent:
			'Mozilla/5.0 (Linux; Android 11; BRAVIA 4K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 TsundokuTV/2026.11.04'
	});

	test("the library tells the app its server's own name, as /pair/tv says it", async ({ page }) => {
		await bridge(page, []);
		await page.goto('/');
		await expect
			.poll(async () => (await calls(page)).named)
			.toEqual([[new URL(page.url()).origin, (hostname() || 'computer').toUpperCase()]]);
	});
});

test('a browser that is not the app is never told the name', async ({ page }) => {
	await bridge(page, []);
	await page.goto('/');
	await expect(page.locator('[data-focus-id="library-more"]')).toBeVisible();
	expect((await calls(page)).named).toEqual([]);
});

test('RESCAN in MORE: the remote reaches it, the question opens on CANCEL, and OK there starts nothing (c561)', async ({
	page
}) => {
	const posted: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && new URL(r.url()).search === '?/scan') posted.push(r.url());
	});
	const sheet = await openMore(page);
	await sheet.locator('.row').first().focus();
	let found = false;
	for (let i = 0; i < 12 && !found; i++) {
		if ((await focusedText(page)) === 'RESCAN') found = true;
		else await page.keyboard.press('ArrowDown');
	}
	expect(found).toBe(true);
	await page.keyboard.press('Enter');
	const ask = page.getByRole('dialog', { name: 'RESCAN THE LIBRARY FOLDER?' });
	await expect(ask).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'More' })).toHaveCount(0);
	// The safe answer is where the remote lands: OK at once cancels.
	await expect(ask.getByRole('button', { name: 'CANCEL' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(ask).toBeHidden();
	// Back on the bar's MORE, the door it came through.
	await expect(page.locator('[data-focus-id="library-more"]')).toBeFocused();
	await page.waitForTimeout(300);
	expect(posted).toEqual([]);
});

test('RESCAN in MORE, confirmed on an empty library: the band, its ✕ reached by arrows, and OK puts it away (c561)', async ({
	page
}) => {
	// The shared server's library folder is empty (playwright.config.ts), so
	// the scan is refused with where it looked, and nothing is imported.
	const sheet = await openMore(page);
	await sheet.locator('.row').first().focus();
	let found = false;
	for (let i = 0; i < 12 && !found; i++) {
		if ((await focusedText(page)) === 'RESCAN') found = true;
		else await page.keyboard.press('ArrowDown');
	}
	expect(found).toBe(true);
	await page.keyboard.press('Enter');
	const ask = page.getByRole('dialog', { name: 'RESCAN THE LIBRARY FOLDER?' });
	await expect(ask.getByRole('button', { name: 'CANCEL' })).toBeFocused();
	// The remote's way to the confirming answer: an arrow off CANCEL.
	const yes = ask.getByRole('button', { name: 'RESCAN' });
	for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
		if (await yes.evaluate((b) => b === document.activeElement)) break;
		await page.keyboard.press(key);
	}
	await expect(yes).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(ask).toBeHidden();
	const band = page.locator('.rescan-band');
	await expect(band).toBeVisible();
	await expect(band).toContainText('NOTHING TO IMPORT');
	// The ✕ is a stop the remote reaches: up from the bar.
	const more = page.locator('[data-focus-id="library-more"]');
	await expect(more).toBeFocused();
	const close = band.getByRole('button', { name: 'Close' });
	for (let i = 0; i < 6; i++) {
		if (await close.evaluate((b) => b === document.activeElement)) break;
		await page.keyboard.press('ArrowUp');
	}
	await expect(close).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(band).toHaveCount(0);
	// The mark is not lost with the button: it is back on the bar, where it came from.
	await expect(more).toBeFocused();
});

test('TO LINK is a stop the remote reaches in MORE (c475)', async ({ page }) => {
	const sheet = await openMore(page);
	const row = sheet.locator('.row', { hasText: 'TO LINK' });
	await expect(row).toHaveText(/TO LINK →\s*\d+/);
	await sheet.locator('.row').first().focus();
	let found = false;
	for (let i = 0; i < 10 && !found; i++) {
		if ((await focusedText(page)).startsWith('TO LINK')) found = true;
		else await page.keyboard.press('ArrowDown');
	}
	expect(found).toBe(true);
	await page.keyboard.press('Enter');
	await page.waitForURL(/\/links$/);
});

// ---- S1: the server in use, in the library's bar (c261, wave 24) ---------------

const cell = (page: Page) => page.locator('[data-focus-id="library-server"]');

test('S1: no cell without the bridge, with an older app, with an answer that is not a list, or with one server', async ({
	page
}) => {
	// No bridge: a browser, a phone, a computer.
	await page.goto('/');
	await expect(page.locator('[data-focus-id="library-more"]')).toBeVisible();
	await expect(cell(page)).toHaveCount(0);

	// An APK from before c261: a bridge with no `servers`.
	await page.addInitScript(() => {
		(window as unknown as { TsundokuTV: object }).TsundokuTV = { forget: () => undefined };
	});
	await page.reload();
	await expect(page.locator('[data-focus-id="library-more"]')).toBeVisible();
	await expect(cell(page)).toHaveCount(0);
});

for (const [what, answer] of [
	['not JSON', 'nope'],
	['not a list', '{"origin":"http://a","shown":"A","inUse":true}'],
	[
		'a list of things that are not servers',
		'[{"origin":"http://a","shown":"A","inUse":true},{"name":"B"}]'
	],
	[
		'a list with no name',
		'[{"origin":"http://a","inUse":true},{"origin":"http://b","inUse":false}]'
	],
	// The origin is how the page knows which one it is on (servers-in-use.ts).
	['a list with no origin', '[{"shown":"A","inUse":true},{"shown":"B","inUse":false}]'],
	// Two good and one not: a filter would keep two and draw a cell; the
	// answer as a whole is not one the page can trust.
	[
		'two servers and something else',
		'[{"origin":"http://a","shown":"A","inUse":true},{"origin":"http://b","shown":"B","inUse":false},{"shown":3,"inUse":"no"}]'
	],
	// Well formed, but neither is this page's server and the app marks none.
	[
		'two servers, neither in use',
		'[{"origin":"http://a","shown":"A","inUse":false},{"origin":"http://b","shown":"B","inUse":false}]'
	]
] as const) {
	test(`S1: an answer that is ${what} draws no cell`, async ({ page }) => {
		await page.addInitScript((answer) => {
			(window as unknown as { TsundokuTV: object }).TsundokuTV = { servers: () => answer };
		}, answer);
		await page.goto('/');
		await expect(page.locator('[data-focus-id="library-more"]')).toBeVisible();
		// The page has read the bridge by the time MORE draws: the row is MORE's own reading.
		await expect(cell(page)).toHaveCount(0);
	});
}

test('S1: one server draws no cell, as today', async ({ page }) => {
	await bridge(page, [
		{ origin: HOME, name: 'ZEN-HOME', tvName: 'Living room', opened: Date.now() }
	]);
	const sheet = await openMore(page);
	// MORE has read the bridge (its SERVERS row is there), and the bar has no cell.
	await expect(sheet.locator('[data-more-servers]')).toHaveText(/1 · ADD ANOTHER/);
	await expect(cell(page)).toHaveCount(0);
	await expect(page.getByText('ON LIVING ROOM')).toHaveCount(0);
});

/*
 * c645: the bridge as c549's message transport will answer it (doc/TV-APP.md,
 * "What it does not do yet", item 2). `servers()` returns a Promise, and each
 * call parks its resolver on `window.__tvLater`, so a case decides when — and
 * in which order — the answers land. The real transport may answer late, out
 * of order, or never; so may this.
 */
async function laterBridge(page: Page) {
	await page.addInitScript(() => {
		const pending: Array<(answer: string) => void> = [];
		(window as unknown as { __tvLater: typeof pending }).__tvLater = pending;
		(window as unknown as { TsundokuTV: Record<string, unknown> }).TsundokuTV = {
			servers: () =>
				new Promise<string>((resolve) => {
					pending.push(resolve);
				})
		};
	});
}

/** Two servers whose page is [name], in the shape `readTvServers` accepts. */
const answered = (name: string) =>
	JSON.stringify([
		{ origin: HOME, shown: name, inUse: true },
		{ origin: ZEN, shown: 'ZEN', inUse: false }
	]);

const later = {
	count: (page: Page) => page.evaluate(() => window.__tvLater?.length ?? 0),
	/**
	 * The last question asked. The library's own reads are the mount's and the
	 * tick's, and the tick's is the last of them; MoreSheet's own read may sit
	 * anywhere before it, and does not touch the library's cell.
	 */
	newest: (page: Page, answer: string) =>
		page.evaluate((a) => {
			const pending = window.__tvLater ?? [];
			pending[pending.length - 1]?.(a);
		}, answer),
	/** Every earlier question: a stale answer that must not be drawn. */
	earlier: (page: Page, answer: string) =>
		page.evaluate((a) => {
			const pending = window.__tvLater ?? [];
			for (let i = 0; i < pending.length - 1; i++) pending[i](a);
		}, answer)
};

/** Let the page's tick read land as well as its mount read: both are asked by then. */
async function settled(page: Page) {
	await expect.poll(() => later.count(page)).toBeGreaterThanOrEqual(3);
	await page.waitForTimeout(100);
}

test('S1: a bridge that answers late draws the cell when its answer lands, not before (c645)', async ({
	page
}) => {
	await laterBridge(page);
	await page.goto('/');
	await expect(page.locator('[data-focus-id="library-more"]')).toBeVisible();
	await settled(page);
	await expect(cell(page)).toHaveCount(0);
	await later.newest(page, answered('Living room'));
	await expect(cell(page)).toHaveText(/^ON\s*LIVING ROOM$/);
});

test('S1: an answer to an older question that lands after a newer one is dropped (c645)', async ({
	page
}) => {
	await laterBridge(page);
	await page.goto('/');
	await settled(page);
	// The later question answers first, as a message may.
	await later.newest(page, answered('Living room'));
	await expect(cell(page)).toHaveText(/^ON\s*LIVING ROOM$/);
	// The older ones answer afterwards with another name. They are stale: the
	// sequence number has moved, so nothing may redraw the cell.
	await later.earlier(page, answered('Stale den'));
	await page.waitForTimeout(150);
	await expect(cell(page)).toHaveText(/^ON\s*LIVING ROOM$/);
});

test('S1: an answer that lands after the library is left draws nothing on the next visit (c645)', async ({
	page
}) => {
	// The `!mounted` half of refreshTvServers is defensive: Svelte 5 throws
	// nothing when a dead instance's `$state` is written, and each instance
	// owns its own `tvServers`, so the write has no observable effect. What
	// this case can observe is the next visit: a second instance is shown
	// while the first one's answers land, and its cell must come only from
	// its own reads, never from theirs.
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await laterBridge(page);
	await page.goto('/');
	await settled(page);
	// A link in MORE is the page's own navigation, so the document — and the
	// pending answer — survives it, where a full load would take both away.
	await page.locator('[data-focus-id="library-more"]').focus();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'More' });
	await sheet.getByRole('link', { name: /HISTORY/ }).click();
	await expect(page).toHaveURL(/\/history/);
	const askedBefore = await later.count(page);
	// The first instance is gone; its answers land anyway, and throw nothing.
	await later.earlier(page, answered('Stale den'));
	await later.newest(page, answered('Stale den'));
	await page.waitForTimeout(100);
	expect(errors).toEqual([]);
	await expect(page).toHaveURL(/\/history/);

	// Back by the page's own history: the document survives, so a second
	// library instance is the one shown, with its own reads still pending.
	await page.goBack();
	await expect(page).toHaveURL(/\/$/);
	await expect.poll(() => later.count(page)).toBeGreaterThanOrEqual(askedBefore + 2);
	// Nothing the first instance's answers said may be drawn on this one.
	await expect(cell(page)).toHaveCount(0);
	await later.newest(page, answered('Living room'));
	await expect(cell(page)).toHaveText(/^ON\s*LIVING ROOM$/);
});

for (const [what, answer] of [
	['throws', 'throw'],
	['answers what is not JSON', 'nope']
] as const) {
	test(`S1: a bridge that ${what} draws no cell (c645)`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.addInitScript((answer) => {
			(window as unknown as { TsundokuTV: Record<string, unknown> }).TsundokuTV = {
				servers: () => {
					// A bridge that fails says so when it is asked, as a sync
					// interface does; a rejected promise is step 3's shape, and
					// MoreSheet does not await one yet.
					if (answer === 'throw') throw new Error('the bridge failed');
					return answer;
				}
			};
		}, answer);
		await page.goto('/');
		await expect(page.locator('[data-focus-id="library-more"]')).toBeVisible();
		await expect(page.locator('.grid .tile').first()).toBeVisible();
		await page.waitForTimeout(150);
		await expect(cell(page)).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}

for (const [what, answer] of [
	['an empty list', '[]'],
	['an empty string', '']
] as const) {
	test(`S1: a refused read that answers late with ${what} draws no cell (c645)`, async ({
		page
	}) => {
		await laterBridge(page);
		await page.goto('/');
		await settled(page);
		await later.earlier(page, answer);
		await later.newest(page, answer);
		await page.waitForTimeout(150);
		await expect(cell(page)).toHaveCount(0);
	});
}

test('S1: a bridge that never answers leaves the cell as without one, and the page is not stuck (c645)', async ({
	page
}) => {
	await laterBridge(page);
	await page.goto('/');
	await expect(page.locator('[data-focus-id="library-more"]')).toBeVisible();
	await settled(page);
	// The library draws as it does with no bridge at all, and stays drawn.
	await expect(page.locator('.grid .tile').first()).toBeVisible();
	await expect(cell(page)).toHaveCount(0);
	await page.waitForTimeout(200);
	await expect(cell(page)).toHaveCount(0);
	// MORE still opens: nothing on the page is waiting for that answer.
	await page.locator('[data-focus-id="library-more"]').focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
});

test("S1: two servers put the one in use beside the wordmark, the TV's own name first", async ({
	page
}) => {
	const now = Date.now();
	await bridge(page, [
		{ origin: ZEN, name: 'ZEN', tvName: '', opened: now - DAY },
		{ origin: HOME, name: 'ZEN-HOME', tvName: 'Living room', opened: now }
	]);
	await page.goto('/');
	await expect(cell(page)).toHaveText(/^ON\s*LIVING ROOM$/);
	await expect(page.getByRole('button', { name: 'ON LIVING ROOM', exact: true })).toBeVisible();

	// The frame: TV-Servers.dc.html's `bar`. After the wordmark, before the search.
	const brand = (await page.locator('header .brand').boundingBox())!;
	const box = (await cell(page).boundingBox())!;
	const search = (await page.locator('header .search-hint').boundingBox())!;
	expect(box.x).toBeCloseTo(brand.x + brand.width, 0);
	expect(search.x).toBeGreaterThanOrEqual(box.x + box.width);
	expect(box.y).toBeCloseTo(brand.y, 0);
	expect(box.height).toBeCloseTo(brand.height, 0);
	await expect(cell(page)).toHaveCSS('max-width', '200px');
	await expect(cell(page)).toHaveCSS('border-left-width', '1px');
	// ON in the second ink, the name in the first (`.t2` in the mock).
	const ink = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).color);
	expect(await ink('[data-focus-id="library-server"] .srv-on')).toBe(
		await ink('header .search-hint')
	);
	expect(await ink('[data-focus-id="library-server"] .srv-name')).not.toBe(
		await ink('[data-focus-id="library-server"] .srv-on')
	);
	await expect(cell(page)).toHaveCSS('column-gap', '10px');
});

test("S1: the server's own name when the TV has none, and a long one clipped at 180 px", async ({
	page
}) => {
	const now = Date.now();
	await bridge(page, [
		{ origin: HOME, name: 'ZEN-HOME', tvName: '', opened: now - DAY },
		{
			origin: ZEN,
			name: 'THE-COMPUTER-UNDER-THE-STAIRS-IN-THE-OLD-HOUSE',
			tvName: '',
			opened: now
		}
	]);
	await page.goto('/');
	const name = cell(page).locator('.srv-name');
	await expect(name).toHaveText('THE-COMPUTER-UNDER-THE-STAIRS-IN-THE-OLD-HOUSE');
	await expect(name).toHaveCSS('text-overflow', 'ellipsis');
	expect((await name.boundingBox())!.width).toBeLessThanOrEqual(180);
	expect((await cell(page).boundingBox())!.width).toBeLessThanOrEqual(200);
	// Clipped, not wrapped: the name is wider than its box.
	expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

test('S1: ↑ from the library reaches the cell; OK opens SERVERS; BACK closes it onto the cell', async ({
	page
}) => {
	const now = Date.now();
	await bridge(
		page,
		[
			{ origin: HOME, name: 'ZEN-HOME', tvName: 'Living room', opened: now },
			{ origin: ZEN, name: 'ZEN', tvName: "Masshiro's", opened: now - DAY }
		],
		{ [ZEN]: { ok: true, after: 20 } }
	);
	await page.goto('/');
	await expect(cell(page)).toBeVisible();
	// The remote's way up: from the screen's start, ↑ until the bar.
	await page.keyboard.press('ArrowDown');
	let reached = false;
	for (let i = 0; i < 8 && !reached; i++) {
		await page.keyboard.press('ArrowUp');
		reached = await cell(page).evaluate((el) => el === document.activeElement);
	}
	expect(reached).toBe(true);

	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'More' });
	// SERVERS at once, not MORE's rows: S1 → S2.
	await expect(sheet.locator('.p-head')).toHaveText(/SERVERS\s*2/);
	await expect(sheet.locator('[data-more-servers]')).toHaveCount(0);
	const rows = sheet.locator('[data-server]');
	// S2's arrival: the first one not in use.
	await expect(rows.nth(1)).toBeFocused();
	await expect(rows.nth(1).locator('.st')).toHaveText('ANSWERS');
	expect((await calls(page)).probes.sort()).toEqual([HOME, ZEN].sort());
	await expect(cell(page)).toHaveClass(/\bon\b/);
	await expect(page.locator('[data-focus-id="library-more"]')).not.toHaveClass(/\bon\b/);

	// MENU, then BACK: the options climb back to the list as from MORE.
	await page.keyboard.press('ContextMenu');
	await expect(sheet.locator('[data-act="open"]')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(rows.nth(1)).toBeFocused();

	// BACK from the list: the panel closes, focus on the cell that opened it.
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect(cell(page)).toBeFocused();
	await expect(cell(page)).not.toHaveClass(/\bon\b/);

	// And again: the sheet opens on SERVERS every time the cell opens it,
	// and on MORE's rows when MORE does.
	await page.keyboard.press('Enter');
	await expect(sheet.locator('.p-head')).toHaveText(/SERVERS\s*2/);
	await expect(rows.nth(1)).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(cell(page)).toBeFocused();
	await page.locator('[data-focus-id="library-more"]').focus();
	await page.keyboard.press('Enter');
	await expect(sheet.locator('[data-more-servers]')).toBeVisible();
	await expect(sheet.locator('.p-head')).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect(page.locator('[data-focus-id="library-more"]')).toBeFocused();
});

test('S1: MORE opened again while SERVERS is still leaving gives focus back to MORE, not the cell', async ({
	page
}) => {
	const now = Date.now();
	await bridge(page, [
		{ origin: HOME, name: 'ZEN-HOME', tvName: 'Living room', opened: now },
		{ origin: ZEN, name: 'ZEN', tvName: '', opened: now - DAY }
	]);
	await page.goto('/');
	await cell(page).focus();
	await page.keyboard.press('Enter');
	const sheet = page.locator('.sheet');
	await expect(sheet.locator('[data-server]').nth(1)).toBeFocused();
	// BACK, then MORE and OK, inside the panel's 180 ms exit: one task, so a
	// slow machine cannot let the exit end first. The sheet is the same
	// element, opened again before it was gone (doc/FOCUS.md, "Scopes").
	const reopened = await page.evaluate(async () => {
		const key = (k: string, type: string) =>
			document.activeElement!.dispatchEvent(
				new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true })
			);
		const before = document.querySelector('.sheet');
		key('Escape', 'keydown');
		key('Escape', 'keyup');
		// Svelte starts the exit in its next flush, and the scope closes when it
		// sees the sheet go inert, giving focus back to the cell: microtasks
		// both, so no frame passes and the 180 ms exit cannot end first.
		const cellEl = document.querySelector('[data-focus-id="library-server"]');
		for (let i = 0; i < 50 && document.activeElement !== cellEl; i++) await Promise.resolve();
		const leaving = !!(before as HTMLElement | null)?.inert;
		const backOnCell = document.activeElement === cellEl;
		const more = document.querySelector<HTMLElement>('[data-focus-id="library-more"]')!;
		more.focus();
		more.click();
		for (let i = 0; i < 50 && (before as HTMLElement).inert; i++) await Promise.resolve();
		return { leaving, backOnCell, same: document.querySelector('.sheet') === before };
	});
	expect(reopened).toEqual({ leaving: true, backOnCell: true, same: true });
	await expect(sheet.locator('[data-more-servers]')).toBeVisible();
	await expect(sheet.locator('.p-head')).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(page.locator('[data-focus-id="library-more"]')).toBeFocused();
	await expect(cell(page)).not.toBeFocused();
});

test('S1: OK on the other server opens it; on the one in use, closes onto the cell', async ({
	page
}) => {
	const now = Date.now();
	await bridge(page, [
		{ origin: HOME, name: 'ZEN-HOME', tvName: 'Living room', opened: now },
		{ origin: ZEN, name: 'ZEN', tvName: '', opened: now - DAY }
	]);
	await page.goto('/');
	await cell(page).focus();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'More' });
	const rows = sheet.locator('[data-server]');
	await expect(rows.nth(1)).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(rows.nth(0)).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(sheet).toBeHidden();
	await expect(cell(page)).toBeFocused();
	expect((await calls(page)).opened).toEqual([]);

	await page.keyboard.press('Enter');
	await expect(rows.nth(1)).toBeFocused();
	await page.keyboard.press('Enter');
	expect((await calls(page)).opened).toEqual([ZEN]);
});

test('S1: forgetting the other of two from the cell takes the cell away, and focus goes to MORE', async ({
	page
}) => {
	const now = Date.now();
	await bridge(page, [
		{ origin: HOME, name: 'ZEN-HOME', tvName: 'Living room', opened: now },
		{ origin: ZEN, name: 'ZEN', tvName: '', opened: now - DAY }
	]);
	await page.goto('/');
	await cell(page).focus();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'More' });
	const rows = sheet.locator('[data-server]');
	await expect(rows.nth(1)).toBeFocused();
	await page.keyboard.press('ContextMenu');
	await sheet.locator('[data-act="forget"]').focus();
	await page.keyboard.press('Enter');
	await expect(sheet.locator('[data-act="confirm"]')).toBeEnabled();
	await sheet.locator('[data-act="confirm"]').focus();
	await page.keyboard.press('Enter');
	expect((await calls(page)).forgot).toEqual([ZEN]);
	// One left: the list says so, with + ADD A SERVER marked.
	await expect(rows).toHaveCount(1);
	await expect(sheet.locator('[data-server-add]')).toBeFocused();
	// The bar keeps its cell while the panel is up, the panel's own opener.
	await expect(cell(page)).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect(cell(page)).toHaveCount(0);
	await expect(page.locator('[data-focus-id="library-more"]')).toBeFocused();
});

test('S1: a rename made in the app shows when MORE closes and on the next load, not before', async ({
	page
}) => {
	const now = Date.now();
	await bridge(page, [
		{ origin: HOME, name: 'ZEN-HOME', tvName: 'Living room', opened: now },
		{ origin: ZEN, name: 'ZEN', tvName: '', opened: now - DAY }
	]);
	await page.goto('/');
	await expect(cell(page)).toHaveText(/^ON\s*LIVING ROOM$/);
	// The list is read when the library loads, not watched: the bridge has no event.
	await page.evaluate((o) => window.__tvRename!(o, 'Den'), HOME);
	await expect(cell(page)).toHaveText(/^ON\s*LIVING ROOM$/);
	// MORE reads it again, and the bar with it when it closes.
	await page.locator('[data-focus-id="library-more"]').focus();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'More' });
	await expect(sheet.locator('[data-more-servers]')).toHaveText(/2 · DEN IN USE/);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect(cell(page)).toHaveText(/^ON\s*DEN$/);
	// Emptied, the server's own name comes back; a reload reads it.
	await page.evaluate((o) => window.__tvRename!(o, ''), HOME);
	await page.reload();
	await expect(cell(page)).toHaveText(/^ON\s*ZEN-HOME$/);
});

// The real app marks a server opened only once its page has finished loading
// (MainActivity's onPageFinished), so the library that mounts right after a
// switch reads a list whose newest, the bridge's `inUse`, is the server just
// left. These stubs say so: the page's own server is the older one.
test('S1: the first library after a switch names the server it is on, not the one just left', async ({
	page,
	baseURL
}) => {
	const here = new URL(baseURL!).origin;
	const now = Date.now();
	await bridge(page, [
		{ origin: here, name: 'ZEN-HOME', tvName: 'Den', opened: now - DAY },
		{ origin: ZEN, name: 'ZEN', tvName: 'Living room', opened: now }
	]);
	await page.goto('/');
	await expect(cell(page)).toHaveText(/^ON\s*DEN$/);
	expect((await calls(page)).named).toEqual([]);

	// OK on the cell: S2 says this one is in use, and the mark is on the other.
	await cell(page).focus();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'More' });
	const row = (o: string) => sheet.locator(`[data-server="${o}"]`);
	await expect(row(here).locator('.st')).toHaveText('IN USE');
	await expect(row(here).locator('.g')).toHaveText('✓');
	await expect(row(ZEN).locator('.st')).not.toHaveText('IN USE');
	await expect(row(ZEN)).toBeFocused();

	// OK on the one it is on closes onto the cell; it does not reload it.
	await row(here).focus();
	await page.keyboard.press('Enter');
	await expect(sheet).toBeHidden();
	await expect(cell(page)).toBeFocused();
	expect((await calls(page)).opened).toEqual([]);
	// Still this one, after MORE has read the list again.
	await expect(cell(page)).toHaveText(/^ON\s*DEN$/);

	// And MORE's own SERVERS row names it.
	await page.locator('[data-focus-id="library-more"]').focus();
	await page.keyboard.press('Enter');
	await expect(sheet.locator('[data-more-servers]')).toHaveText(/2 · DEN IN USE/);
});

test('S1: right after a switch, FORGET knows which one the TV is on', async ({ page, baseURL }) => {
	const here = new URL(baseURL!).origin;
	const now = Date.now();
	await bridge(page, [
		{ origin: here, name: 'ZEN-HOME', tvName: 'Den', opened: now - 2 * DAY },
		{ origin: ZEN, name: 'ZEN', tvName: '', opened: now },
		{ origin: STUDIO, name: 'STUDIO', tvName: '', opened: now - DAY }
	]);
	await page.goto('/');
	await cell(page).focus();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'More' });
	const row = (o: string) => sheet.locator(`[data-server="${o}"]`);
	const forget = async (o: string) => {
		await row(o).focus();
		await page.keyboard.press('ContextMenu');
		await sheet.locator('[data-act="forget"]').focus();
		await page.keyboard.press('Enter');
		await expect(sheet.locator('[data-act="confirm"]')).toBeEnabled();
		await sheet.locator('[data-act="confirm"]').focus();
		await page.keyboard.press('Enter');
	};

	// One not in use: the list stays, and the mark goes to the other one not
	// in use, not to the one the TV is on.
	await forget(STUDIO);
	await expect(row(STUDIO)).toHaveCount(0);
	await expect(row(ZEN)).toBeFocused();
	await expect(row(here).locator('.st')).toHaveText('IN USE');
	expect((await calls(page)).opened).toEqual([]);

	// The one it is on: the TV moves to the one left (S4's rule for the one in use).
	await forget(here);
	expect((await calls(page)).forgot).toEqual([STUDIO, here]);
	await expect.poll(async () => (await calls(page)).opened).toEqual([ZEN]);
});

test.describe('the TV app, on a server it has not named yet', () => {
	test.use({
		userAgent:
			'Mozilla/5.0 (Linux; Android 11; BRAVIA 4K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 TsundokuTV/2026.11.04'
	});

	test("S1: the first library shows the server's own name, not its host", async ({
		page,
		baseURL
	}) => {
		const here = new URL(baseURL!).origin;
		const now = Date.now();
		// Paired by address and never loaded: no name yet, so `shown` is the host.
		await bridge(page, [
			{ origin: here, name: '', tvName: '', opened: now },
			{ origin: ZEN, name: 'ZEN', tvName: '', opened: now - DAY }
		]);
		await page.goto('/');
		const name = (hostname() || 'computer').toUpperCase();
		// The layout's onMount names it after the page has read the list once.
		await expect(cell(page).locator('.srv-name')).toHaveText(name);
		await expect(page.getByRole('dialog', { name: 'More' })).toHaveCount(0);
	});
});

/*
 * c717: closing MORE reads the list again, and its focus hand-back waits for
 * that answer. Today's bridge answers at once, so only a held answer reaches
 * this: the next `__tvHold` questions park on `__tvLater`, and everything else
 * (MoreSheet's own synchronous read included) answers from the stub.
 */
async function holdNext(page: Page, n = 1) {
	await page.evaluate((n) => (window.__tvHold = n), n);
}

async function holdingBridge(page: Page) {
	const now = Date.now();
	await bridge(page, [
		{ origin: HOME, name: 'ZEN-HOME', tvName: 'Living room', opened: now },
		{ origin: ZEN, name: 'ZEN', tvName: '', opened: now - DAY }
	]);
	await page.addInitScript(() => {
		const pending: Array<(answer: string) => void> = [];
		window.__tvLater = pending;
		const tv = (window as unknown as { TsundokuTV: { servers: () => unknown } }).TsundokuTV;
		const answer = tv.servers;
		tv.servers = () => {
			if (!window.__tvHold) return answer();
			window.__tvHold -= 1;
			return new Promise<string>((resolve) => pending.push(resolve));
		};
	});
}

/** The cell's sheet, open on SERVERS with the remote's focus on the other server. */
async function openServersFromCell(page: Page) {
	await cell(page).focus();
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'More' });
	await expect(sheet.locator('[data-server]').nth(1)).toBeFocused();
	return sheet;
}

const oneServer = JSON.stringify([{ origin: HOME, shown: 'Living room', inUse: true }]);
const heldAnswers = (page: Page) => page.evaluate(() => window.__tvLater?.length ?? 0);
const land = (page: Page, at: number, answer: string) =>
	page.evaluate(([at, answer]) => window.__tvLater![at as number](answer as string), [at, answer]);
/** A frame later: every promise and tick an answer started has run. */
const frame = (page: Page) =>
	page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
const inDialog = (page: Page) =>
	page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]:not([inert])'));
const onMore = (page: Page) => page.locator('[data-focus-id="library-more"]');

/** BACK with the answer held, and the cell again before it lands. */
async function closeHeldAndReopen(page: Page) {
	await page.goto('/');
	await expect(cell(page)).toBeVisible();
	const sheet = await openServersFromCell(page);
	await holdNext(page);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect.poll(() => heldAnswers(page)).toBe(1);
	await expect(cell(page)).toBeFocused();
	const again = await openServersFromCell(page);
	return again;
}

test('S1: a late answer to MORE closing leaves focus in the SERVERS sheet reopened before it (c717)', async ({
	page
}) => {
	await holdingBridge(page);
	const sheet = await closeHeldAndReopen(page);
	const on = sheet.locator('[data-server]').nth(1);

	await land(page, 0, oneServer);
	// The answer has been drawn, and it is the one that would hand focus back.
	await expect(cell(page)).toHaveCount(0);
	await frame(page);
	await expect(on).toBeFocused();
	await expect(onMore(page)).not.toBeFocused();
	await expect(sheet).toBeVisible();
});

test('S1: a late answer finds the reopened sheet open even with focus nowhere (c717)', async ({
	page
}) => {
	await holdingBridge(page);
	const sheet = await closeHeldAndReopen(page);
	// The frame before the scope's first focus, and any later fall to the body.
	await page.evaluate(() => (document.activeElement as HTMLElement).blur());
	await land(page, 0, oneServer);
	await expect(cell(page)).toHaveCount(0);
	await frame(page);
	await expect(onMore(page)).not.toBeFocused();
	await expect(sheet).toBeVisible();
});

test('S1: the cell gone under the reopened sheet still hands focus to MORE when it closes (c717)', async ({
	page
}) => {
	await holdingBridge(page);
	const sheet = await closeHeldAndReopen(page);
	await land(page, 0, oneServer);
	await expect(cell(page)).toHaveCount(0);
	await frame(page);

	// BACK from the sheet whose cell has gone: this close's answer comes late too.
	await holdNext(page);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect.poll(() => heldAnswers(page)).toBe(2);
	await land(page, 1, oneServer);
	await expect(onMore(page)).toBeFocused();
});

test('S1: a late answer to MORE closing does not take focus from another sheet (c717)', async ({
	page
}) => {
	await holdingBridge(page);
	await page.goto('/');
	await expect(cell(page)).toBeVisible();
	const servers = await openServersFromCell(page);
	await holdNext(page);
	await page.keyboard.press('Escape');
	await expect(servers).toBeHidden();
	await expect.poll(() => heldAnswers(page)).toBe(1);

	// MENU on a tile: a different dialog, so `moreOpen` stays false.
	await page.locator('[data-focus-id^="series-"]').first().focus();
	await page.keyboard.press('ContextMenu');
	await expect(page.locator('.sheet[role="dialog"]')).toBeVisible();
	await expect.poll(() => inDialog(page)).toBe(true);

	await land(page, 0, oneServer);
	await expect(cell(page)).toHaveCount(0);
	await frame(page);
	expect(await inDialog(page)).toBe(true);
	await expect(onMore(page)).not.toBeFocused();
});

test('S1: an older close answering after a newer one hands nothing back (c717)', async ({
	page
}) => {
	await holdingBridge(page);
	const sheet = await closeHeldAndReopen(page);
	await holdNext(page);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect.poll(() => heldAnswers(page)).toBe(2);

	// The newer close answers first, and that one hands back.
	await land(page, 1, oneServer);
	await expect(onMore(page)).toBeFocused();
	// Focus leaves for nowhere; the older answer must not bring it back.
	await page.evaluate(() => (document.activeElement as HTMLElement).blur());
	await land(page, 0, oneServer);
	await frame(page);
	expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('the panel keeps its head in the safe area, on the ground, when MORE is scrolled to its end (c716)', async ({
	page
}) => {
	await bridge(page, [{ origin: HOME, name: 'ZEN-HOME', tvName: '', opened: Date.now() }]);
	const sheet = await openMore(page);
	const facts = await sheet.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
		const head = el.querySelector<HTMLElement>('.sheet-head')!;
		const box = el.getBoundingClientRect();
		const top = head.getBoundingClientRect().top - box.top;
		// In the overscan band above the head, a third of the way across.
		const at = document.elementFromPoint(box.left + box.width / 3, box.top + 10);
		return {
			scrolled: el.scrollTop > 0,
			top,
			inBand: at === head || at === el,
			room: parseFloat(getComputedStyle(el).scrollPaddingTop),
			height: head.offsetHeight
		};
	});
	expect(facts.scrolled).toBe(true);
	expect(facts.top).toBeCloseTo(28, 0);
	expect(facts.inBand).toBe(true);
	expect(facts.room).toBe(28 + facts.height);

	const x = sheet.getByRole('button', { name: 'Close' });
	await x.focus();
	await page.keyboard.press('Enter');
	await expect(sheet).toBeHidden();
});

test('MORE gives up the head room when SERVERS has no head, and takes it back, and a head that grows is measured (c716)', async ({
	page
}) => {
	await bridge(page, [{ origin: HOME, name: 'ZEN-HOME', tvName: '', opened: Date.now() }]);
	const sheet = await openMore(page);
	const room = () => sheet.evaluate((el) => el.style.scrollPaddingTop);
	const taller = (px: number) =>
		sheet.evaluate(
			(el, px) => ((el.querySelector('.sheet-head') as HTMLElement).style.height = `${px}px`),
			px
		);
	await expect.poll(room).toBe('84px');
	await taller(120);
	await expect.poll(room).toBe('148px');

	await sheet.locator('[data-more-servers]').click();
	await expect(sheet.locator('.p-head')).toBeVisible();
	await expect.poll(room).toBe('');

	await page.keyboard.press('Escape');
	await expect(sheet.locator('.sheet-head')).toBeVisible();
	// The head is drawn anew at its own height.
	await expect.poll(room).toBe('84px');
});

test.describe('a TV that speaks Portuguese', () => {
	test.use({ locale: 'pt-BR' });

	test('S1 in Portuguese: EM, and the name as the TV has it', async ({ page }) => {
		const now = Date.now();
		await bridge(page, [
			{ origin: HOME, name: 'ZEN-HOME', tvName: 'Sala', opened: now },
			{ origin: ZEN, name: 'ZEN', tvName: '', opened: now - DAY }
		]);
		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
		await expect(cell(page)).toHaveText(/^EM\s*SALA$/);
	});
});
