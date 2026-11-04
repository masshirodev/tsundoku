import { expect, test } from './fixtures';
import { makeLogin, writeLogin } from '../src/lib/server/login.ts';
import { FRIEND_HOME, FRIEND_PORT } from './friend-world';
import { hydrated } from './helpers/hydration';

/**
 * Reading on a phone over home Wi-Fi (doc/WIFI.md; card c188), on the friend
 * project's own install, served by scripts/serve.ts (tests/friend-setup.ts),
 * so the Wi-Fi listeners are the real ones on this machine's home-network
 * address. "The phone" is a second browser context opening that address. In
 * order: one switch, one code, one phone.
 */
test.describe.configure({ mode: 'serial' });

const local = `http://localhost:${FRIEND_PORT}`;
type Wifi = { on: boolean; phone: string | null; code: { url: string; state: string } | null };
const wifi = async (request: import('@playwright/test').APIRequestContext) =>
	(await (await request.get(`${local}/api/wifi`)).json()) as Wifi;

test.beforeAll(() => {
	// No password: the computer opens straight in, and over Wi-Fi only a code signs in.
	writeLogin(FRIEND_HOME, makeLogin(null));
});

test('WI-FI is off until switched on, and says who it lets in', async ({ page }) => {
	await page.goto('/settings#s-devices');
	// ON, OFF and NEW CODE are clicked: a click before hydration lands on
	// server-rendered markup with no handler (seen under load, wave 21).
	await hydrated(page);
	const seg = page.getByRole('group', { name: 'Other devices on this Wi-Fi' });
	await expect(seg.getByRole('button', { name: 'OFF' })).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByText(/ANYONE ON THE SAME WI-FI REACHES THE SIGN-IN PAGE/)).toBeVisible();
	await expect(page.getByText('NOT OVER WI-FI', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Pairing', { exact: true })).toHaveCount(0);
});

test('ON shows a code, the address in text, and what typing it does', async ({ page, request }) => {
	await page.goto('/settings#s-devices');
	await hydrated(page);
	await page
		.getByRole('group', { name: 'Other devices on this Wi-Fi' })
		.getByRole('button', { name: 'ON' })
		.click();
	await expect(page.getByRole('img', { name: 'Pairing code' })).toBeVisible();
	await expect(page.getByText("SCAN WITH THE PHONE'S CAMERA")).toBeVisible();
	// The handoff's measurements (Wifi.dc.html, "on"), pinned so a tidy-up can't redraw them:
	// the code's inverse cell, its column, the switch's height.
	const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
	expect(await box('.pair .qr')).toMatchObject({ width: 273, height: 273 });
	expect((await box('.pair .pair-code')).width).toBe(321);
	expect((await box('.wifi-seg')).height).toBe(52);
	expect((await box('.pair-foot')).height).toBeGreaterThanOrEqual(52);
	await expect(page.getByText(/GOOD FOR \d MIN · SIGNS IN ONE PHONE, ONCE/)).toBeVisible();
	// A TV's six digits beside the phone's QR (c236; doc/TV.md): two threes,
	// under a FOR A TV label, with a countdown of its own.
	await expect(page.getByText('FOR A TV · SIX DIGITS')).toBeVisible();
	const threes = page.locator('.pair-tv .tvcode span');
	await expect(threes).toHaveCount(2);
	for (const three of await threes.all()) expect(await three.textContent()).toMatch(/^\d{3}$/);
	await expect(page.getByText(/GOOD FOR \d MIN · ONE TV, ONCE/)).toBeVisible();
	const w = await wifi(request);
	expect(w.on).toBe(true);
	expect(w.phone).toMatch(new RegExp(`^http://(10|172|192)\\.[\\d.]+:${FRIEND_PORT}$`));
	await expect(page.getByText(w.phone!, { exact: true })).toBeVisible();
	await expect(page.getByText(/WITH NO PASSWORD SET, ONLY A CODE SIGNS IN/)).toBeVisible();
});

/**
 * A TV's six digits burned by five wrong tries while the panel is open (c460).
 * The panel polls `/api/wifi` every 5 s, and that poll once replaced a burned
 * code, so anyone on the Wi-Fi got five more guesses every 5 s. The poll now
 * reads the code as it is: BURNED, and the same code on the server two polls
 * later, until NEW CODE.
 */
test('a TV code burned on /pair/tv stays BURNED on the open panel until NEW CODE (c460)', async ({
	page,
	playwright,
	request
}) => {
	// Two polls after the burn shows, at 5 s each, on top of the page's load.
	test.setTimeout(60_000);
	const onComputer = async () =>
		(await (await request.get(`${local}/api/pair/tv`)).json()) as { code: string; state: string };
	await page.goto('/settings#s-devices');
	await hydrated(page);
	await expect(page.getByLabel('Pairing code for a TV')).toBeVisible();
	const { code, state } = await onComputer();
	expect(state).toBe('live');

	// A TV on the Wi-Fi, not this browser: the form 9C posts, five wrong codes.
	const { phone } = await wifi(request);
	const tv = await playwright.request.newContext({ baseURL: phone! });
	try {
		const wrong = code === '000000' ? '111111' : '000000';
		for (let i = 0; i < 5; i += 1) {
			const r = await tv.post('/pair/tv', {
				form: { code: wrong },
				headers: { origin: phone!, accept: 'text/html' },
				maxRedirects: 0
			});
			expect(r.status()).toBe(303);
		}
	} finally {
		await tv.dispose();
	}
	expect(await onComputer()).toEqual(expect.objectContaining({ code, state: 'burned' }));

	// The panel's own poll notices, and draws the burn rather than a new code.
	await expect(page.locator('.pair-tv .tvcode.dim')).toHaveText('BURNED', { timeout: 15_000 });
	await expect(page.getByText('NO TRIES LEFT · MAKE A NEW CODE')).toBeVisible();
	await expect(page.getByLabel('Pairing code for a TV')).toHaveCount(0);

	// Two more polls, 10 s: each answered, and the server still holds the same
	// burned code. Read from the server, not from the page.
	for (let i = 0; i < 2; i += 1)
		await page.waitForResponse((r) => new URL(r.url()).pathname === '/api/wifi', {
			timeout: 15_000
		});
	expect(await onComputer()).toEqual(expect.objectContaining({ code, state: 'burned' }));
	await expect(page.locator('.pair-tv .tvcode.dim')).toHaveText('BURNED');

	// NEW CODE is what brings live digits back, and they are new ones.
	await page.locator('.pair-foot').getByRole('button', { name: 'NEW CODE' }).click();
	await expect(page.getByLabel('Pairing code for a TV')).toBeVisible();
	const next = await onComputer();
	expect(next.state).toBe('live');
	expect(next.code).not.toBe(code);
	await expect(page.getByText('NO TRIES LEFT · MAKE A NEW CODE')).toHaveCount(0);
});

test('the phone scans it, is signed in, and the computer lists it with SIGN OUT', async ({
	page,
	browser,
	request
}) => {
	await page.goto('/settings#s-devices');
	await hydrated(page);
	const { code } = await wifi(request);
	const phone = await browser.newPage({ storageState: { cookies: [], origins: [] } });
	await phone.goto(code!.url);
	await expect(phone).toHaveURL(/\/welcome$/);
	await expect(phone.getByRole('heading', { name: 'This phone is signed in' })).toBeVisible();
	await expect(phone.getByText('Offline chapters')).toBeVisible();
	// The handoff's measurements (Wifi-Phone.dc.html, 3A), pinned so a tidy-up can't redraw them.
	const box = async (sel: string) => (await phone.locator(sel).first().boundingBox())!;
	expect((await box('.welcome .bar')).height).toBe(60);
	expect((await box('.welcome .go')).height).toBe(56);
	await phone.getByRole('link', { name: 'OPEN THE LIBRARY →' }).click();
	await expect(phone.getByText('01 — CONTINUE')).toBeVisible();

	// SETTINGS on the phone (3E): WI-FI shown, never switched from here.
	// At the Wi-Fi address it was paired at: the base URL is the computer's localhost.
	await phone.goto(`${new URL(code!.url).origin}/settings#s-devices`);
	await expect(phone.getByText('SET ON THE COMPUTER ONLY')).toBeVisible();
	await expect(phone.getByRole('group', { name: 'Other devices on this Wi-Fi' })).toHaveCount(0);
	await expect(phone.getByRole('img', { name: 'Pairing code' })).toHaveCount(0);

	// The panel turns USED on its own (it polls), and the phone joins DEVICES.
	await expect(page.getByText('✓ USED')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText(/OVER WI-FI · JUST PAIRED/)).toBeVisible({ timeout: 15_000 });
	await expect(page.getByRole('button', { name: 'SIGN OUT' })).toBeVisible();

	// The same code again, from another phone: once only.
	const other = await browser.newPage({ storageState: { cookies: [], origins: [] } });
	await other.goto(code!.url);
	await expect(other).toHaveURL(/\/login\?pair=used/);
	await expect(other.getByText('THIS CODE WAS ALREADY USED')).toBeVisible();
	// With no password set, the typed address has nothing to sign in with.
	await expect(other.getByText('ONLY A CODE SIGNS IN HERE')).toBeVisible();
	await other.close();

	// SIGN OUT: at once, and the phone's next page is the sign-in page.
	await page.getByRole('button', { name: 'SIGN OUT' }).click();
	await expect(page.getByRole('button', { name: 'SIGN OUT' })).toHaveCount(0);
	await phone.reload();
	await expect(phone).toHaveURL(/\/login/);
	await phone.close();
});

test('over Wi-Fi, only its own address: another name is refused, and the computer’s switch too', async ({
	request
}) => {
	const { phone } = await wifi(request);
	const r = await request.get(`${phone}/`, {
		headers: { host: `evil.example:${FRIEND_PORT}` },
		maxRedirects: 0
	});
	expect(r.status()).toBe(403);
	// A phone can't switch it, or ask for a code.
	const off = await request.post(`${phone}/api/wifi`, { data: { action: 'off' } });
	expect([401, 403]).toContain(off.status());
});

test('OFF stops listening on the Wi-Fi; the computer goes on', async ({ page, request }) => {
	const { phone } = await wifi(request);
	await page.goto('/settings#s-devices');
	await hydrated(page);
	await page
		.getByRole('group', { name: 'Other devices on this Wi-Fi' })
		.getByRole('button', { name: 'OFF' })
		.click();
	await expect(page.getByLabel('Pairing', { exact: true })).toHaveCount(0);
	await expect(request.get(`${phone}/`, { timeout: 3000 })).rejects.toThrow();
	expect((await request.get(`${local}/manifest.webmanifest`)).ok()).toBe(true);
});
