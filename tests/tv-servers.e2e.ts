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
	}
}

const HOME = 'http://192.168.1.23:42143';
const ZEN = 'https://zen.tailnet.ts.net:8443';
const STUDIO = 'http://192.168.1.61:42143';
const DAY = 86_400_000;

async function bridge(
	page: Page,
	list: Stub[],
	answers: Record<string, { ok: boolean; after: number }> = {}
) {
	await page.addInitScript(
		({ list, answers }) => {
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
			let state = [...list];
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
					if (a)
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
					state = state.filter((s) => s.origin !== o);
					return json();
				},
				addServer: () => (calls.added += 1),
				renameServer: (o: string) => calls.renamed.push(o),
				welcome: () => (calls.welcome += 1),
				named: (o: string, n: string) => calls.named.push([o, n])
			};
		},
		{ list, answers }
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
		// Studio answers before Masshiro's: each lands on its own row.
		{ [ZEN]: { ok: true, after: 700 }, [STUDIO]: { ok: false, after: 100 } }
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
	await expect(rows.nth(1).locator('.st')).toHaveText('CHECKING');
	await expect(rows.nth(2).locator('.st')).toHaveText('NO ANSWER');
	await expect(rows.nth(2).locator('.g')).toHaveText('○');
	await expect(rows.nth(1).locator('.st')).toHaveText('ANSWERS');
	await expect(rows.nth(1).locator('.g')).toHaveText('●');
	await expect(rows.nth(0).locator('.st')).toHaveText('IN USE');
	await expect(rows.nth(1).locator('.meta')).toHaveText('zen.tailnet.ts.net:8443');

	// The frame: TV-Servers.dc.html's list, as extracted.
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
