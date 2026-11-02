import { expect, test } from './fixtures';

/**
 * A TV pairing itself with six digits typed on a remote (c236; doc/TV.md,
 * "Pairing"; TV-Pair.dc.html 9C and 9E). This is the computer's own route,
 * reached by the app once it has found the computer, so the spec is the TV:
 * 960x540, no pointer, and every press a key.
 *
 * Serial: the six digits live in the server's memory, one at a time, so two
 * tests racing on them would spend each other's tries.
 */
test.describe.configure({ mode: 'serial' });

const PORT = process.env.PLAYWRIGHT_PORT ?? '4183';
/**
 * The host the e2e server's `ORIGIN` names (playwright.config.ts), as a
 * tailnet install's own public origin would: the door a paired TV's cookie
 * opens (c245).
 */
const TAILNET = `tsundoku.test:${PORT}`;

type TvCode = { code: string | null; state: string; minutes: number; left: number };
const tvCode = async (request: import('@playwright/test').APIRequestContext) =>
	(await (await request.get('/api/pair/tv')).json()) as TvCode;

/** Type six digits the way a remote does: the sixth submits the form itself. */
async function typeCode(page: import('@playwright/test').Page, code: string) {
	await page.locator('input[name="code"]').fill(code);
}

/** A code that is certainly not the real one. */
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

/**
 * The band's every state, reached through `r` — what the action redirects to —
 * so the geometry is checked without spending a try or a code. The page shows
 * the same band markup for a state it read on arrival.
 */
const BANDS = [
	['wrong&left=4', 'NOT THAT CODE', '4 TRIES LEFT'],
	['short', 'SIX DIGITS', 'TYPE ALL SIX'],
	['expired', 'THIS CODE EXPIRED', 'MAKE A NEW ONE ON THE COMPUTER'],
	['used', 'THIS CODE IS USED', 'ONE TV, ONCE'],
	['burned', 'NO TRIES LEFT', 'MAKE A NEW CODE ON THE COMPUTER']
] as const;

test('a band pushes the column down instead of drawing over it (c246)', async ({ page }) => {
	// The design's 9C: the section label at 108, the six cards at 148.
	await page.goto('/pair/tv');
	await expect(page.locator('.band')).toHaveCount(0);
	expect((await page.locator('.sl').boundingBox())!.y).toBe(108);
	expect((await page.locator('.cell').first().boundingBox())!.y).toBe(148);

	for (const [r, head, meta] of BANDS) {
		await page.goto(`/pair/tv?r=${r}`);
		const band = page.locator('.band');
		await expect(band).toContainText(head);
		await expect(band).toContainText(meta);

		// 2026-11-02: the band was drawn over "02 — …" and its ✓ ANSWERED
		// line. It now ends above both that label and the cards.
		const b = (await band.boundingBox())!;
		const label = (await page.locator('.sl').boundingBox())!;
		const cell = (await page.locator('.cell').first().boundingBox())!;
		expect(b.y + b.height).toBeLessThanOrEqual(label.y);
		expect(b.y + b.height).toBeLessThanOrEqual(cell.y);
		// Still inside the frame the handoff draws, not pushed off the bottom.
		const actions = (await page.locator('.actions').boundingBox())!;
		expect(actions.y + actions.height).toBeLessThanOrEqual(540 - 28);
	}
});

test('a wrong code spends a try, and the right one pairs the TV', async ({ page, request }) => {
	await page.goto('/pair/tv');
	await expect(page.getByText('02 — THE SIX DIGITS ON THE COMPUTER')).toBeVisible();

	// The handoff's measurements (TV-Pair.dc.html, 9C): two threes of 72x88
	// cells with a 12px gap, 56px buttons, the bar 28 from the top.
	const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
	expect(await box('.cell')).toMatchObject({ width: 72, height: 88 });
	expect((await box('.gap')).width).toBe(12);
	expect((await box('.btn.pri')).height).toBe(56);
	expect((await box('.bar')).y).toBe(28);

	const { code, state } = await tvCode(request);
	expect(state).toBe('live');
	expect(code).toMatch(/^\d{6}$/);
	// Two threes on the page, as the panel draws them.
	await expect(page.locator('.cells .cell')).toHaveCount(6);

	await typeCode(page, wrong(code!));
	await expect(page.getByText('NOT THAT CODE')).toBeVisible();
	await expect(page.getByText('4 TRIES LEFT')).toBeVisible();
	await expect(page.locator('.cell.ring')).toHaveCount(1);

	await typeCode(page, code!);
	await expect(page.getByRole('heading', { name: 'The library is on this TV' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'OPEN THE LIBRARY →' })).toBeVisible();
});

test('five wrong tries burn the code, and a new one is made on the computer', async ({
	page,
	request
}) => {
	// A TV that paired in the test above opens 9E; this one has nothing yet.
	await page.context().clearCookies({ name: 'tsundoku_paired' });
	const fresh = (await (
		await request.post('/api/pair/tv', { data: { action: 'code' } })
	).json()) as TvCode;
	expect(fresh.state).toBe('live');

	await page.goto('/pair/tv');
	for (let left = 4; left >= 1; left -= 1) {
		await typeCode(page, wrong(fresh.code!));
		await expect(page.getByText(`${left} ${left === 1 ? 'TRY' : 'TRIES'} LEFT`)).toBeVisible();
	}
	await typeCode(page, wrong(fresh.code!));
	await expect(page.getByText('NO TRIES LEFT')).toBeVisible();
	await expect(page.getByText('MAKE A NEW CODE ON THE COMPUTER')).toBeVisible();

	// The right code is no longer worth anything, and the page stays 9C.
	await typeCode(page, fresh.code!);
	await expect(page.getByText('NO TRIES LEFT')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'The library is on this TV' })).toHaveCount(0);
});

/**
 * The owner's own instance (c245; doc/WIFI.md, doc/SIGN-IN.md): token mode,
 * no WI-FI panel, so SETTINGS › 08 — DEVICES is where the six digits are seen.
 * The block is the pairing panel's own, without the phone's QR.
 */
test('with no WI-FI panel, DEVICES shows the TV’s six digits', async ({ page, request }) => {
	await page.goto('/settings#s-devices');
	const row = page.locator('#s-devices .row.wifi');
	await expect(row).toBeVisible();
	const panel = row.locator('.pair-tv');
	await expect(panel.getByText('FOR A TV · SIX DIGITS')).toBeVisible();
	// No WI-FI row on this install: there is no Wi-Fi panel to carry the code.
	await expect(page.getByRole('group', { name: 'Other devices on this Wi-Fi' })).toHaveCount(0);

	const threes = panel.locator('.tvcode span');
	await expect(threes).toHaveCount(2);
	const shown = (await threes.allTextContents()).join('');
	expect(shown).toMatch(/^\d{6}$/);
	await expect(panel).toContainText(/GOOD FOR \d+ MIN · ONE TV, ONCE/);
	// This row shows no address and a tailnet TV types the whole one (9B), so
	// the panel's "last number" shortcut is not what this block says.
	await expect(panel.locator('.pnote')).toHaveText(
		'TYPE THE WHOLE ADDRESS ON THE TV, THEN THESE SIX'
	);
	// The page's data is the code: the computer's own route agrees with it.
	expect((await tvCode(request)).code).toBe(shown);

	// NEW CODE replaces it through the page's own data, not /api/pair/tv.
	const next = page.locator('#s-devices .row.wifi').getByRole('button', { name: 'NEW CODE' });
	await next.click();
	await expect.poll(async () => (await threes.allTextContents()).join('')).not.toBe(shown);
	const now = (await threes.allTextContents()).join('');
	expect(now).toMatch(/^\d{6}$/);
	expect((await tvCode(request)).code).toBe(now);
});

/**
 * Token mode and `/pair/tv` (c245; doc/SIGN-IN.md): the six digits set the
 * same cookie a phone's link does, and that cookie alone is a session on the
 * tailnet host the instance's public origin names -- and nowhere else.
 */
test('a paired cookie signs in on the tailnet host, and not at localhost', async ({
	playwright,
	request,
	browser
}) => {
	const fresh = (await (
		await request.post('/api/pair/tv', { data: { action: 'code' } })
	).json()) as TvCode;
	expect(fresh.state).toBe('live');

	// The TV's own page: public, and no session of its own.
	const tv = await browser.newContext({ storageState: { cookies: [], origins: [] } });
	const tvPage = await tv.newPage();
	await tvPage.goto('/pair/tv');
	await typeCode(tvPage, fresh.code!);
	await expect(tvPage.getByRole('heading', { name: 'The library is on this TV' })).toBeVisible();
	// 9E names the DEVICES row by what both installs have, not by WI-FI: on the
	// tailnet that row says OVER TAILSCALE (c245).
	await expect(tvPage.getByText('TV · WITH SIGN OUT')).toBeVisible();
	const paired = (await tv.cookies()).find((c) => c.name === 'tsundoku_paired');
	expect(paired).toBeTruthy();
	await tv.close();

	// Only `tsundoku_paired`: no session cookie at all. The Host is the one
	// playwright.config.ts gives the server as its public origin.
	const tailnet = await playwright.request.newContext({
		baseURL: `http://localhost:${PORT}`,
		extraHTTPHeaders: { host: TAILNET },
		storageState: { cookies: [paired!], origins: [] }
	});
	const home = await tailnet.get('/');
	expect(home.status()).toBe(200);
	expect(await home.text()).toContain('CONTINUE');
	// A page inside the library too, not only its first byte: SETTINGS is a
	// session's page and writes nothing of another spec's.
	const settings = await tailnet.get('/settings');
	expect(settings.status()).toBe(200);
	expect(await settings.text()).toContain('SETTINGS');
	await tailnet.dispose();

	// The same cookie at localhost: the computer itself gains nothing from it.
	const local = await playwright.request.newContext({
		baseURL: `http://localhost:${PORT}`,
		storageState: { cookies: [paired!], origins: [] },
		maxRedirects: 0
	});
	const denied = await local.get('/');
	expect(denied.status()).toBe(303);
	expect(denied.headers()['location']).toMatch(/^\/login/);
	await local.dispose();
});
