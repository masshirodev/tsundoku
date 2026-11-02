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

type TvCode = { code: string | null; state: string; minutes: number; left: number };
const tvCode = async (request: import('@playwright/test').APIRequestContext) =>
	(await (await request.get('/api/pair/tv')).json()) as TvCode;

/** Type six digits the way a remote does: the sixth submits the form itself. */
async function typeCode(page: import('@playwright/test').Page, code: string) {
	await page.locator('input[name="code"]').fill(code);
}

/** A code that is certainly not the real one. */
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

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
