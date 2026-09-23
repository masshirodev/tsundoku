import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * One complete flow with real data, end to end: rate, favourite, shelve and
 * hide from the long-press sheet, then reveal and unhide. This is the walk
 * doc/design's HANDOFF asks for early, because it is what surfaces an
 * invariant a mock never had to satisfy.
 *
 * Each test restores what it changed, so the order they run in does not
 * matter and the seeded library stays the one the other specs expect.
 */

const TITLE = 'Kusuriya no Hitorigoto';

// These write to the one seeded database the preview server holds, so they run
// in order, and only on the tablet project (the others ignore `*-flow.e2e.ts`
// in playwright.config.ts). The frame specs are read-only and run everywhere.
test.describe.configure({ mode: 'serial' });

async function longPress(page: Page, title: string) {
	const tile = page.locator('.grid .tile', { hasText: title });
	// Under a full parallel run hydration can trail the load event, and a
	// right-click before it opens nothing.
	await page.waitForLoadState('networkidle');
	await tile.scrollIntoViewIfNeeded();
	await tile.click({ button: 'right' }); // the context menu is the long press
	const sheet = page.getByRole('dialog', { name: title });
	await expect(sheet).toBeVisible();
	return sheet;
}

test('rating from the sheet persists, and 0 clears it back to unrated', async ({ page }) => {
	await page.goto('/');
	let sheet = await longPress(page, TITLE);
	// Unrated: no cell is filled and the label says so.
	await expect(sheet.getByText('UNRATED', { exact: true })).toBeVisible();
	for (const name of ['Unrated', 'Rate 1', 'Rate 5']) {
		await expect(sheet.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
	}

	await sheet.getByRole('button', { name: 'Rate 2' }).click();
	await expect(sheet.getByRole('button', { name: 'Rate 2' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.keyboard.press('Escape');
	const bars = page.locator('.grid .tile', { hasText: TITLE }).getByRole('img');
	await expect(bars).toHaveAttribute('aria-label', 'Rated 2 of 5');

	await page.reload();
	sheet = await longPress(page, TITLE);
	await expect(sheet.getByRole('button', { name: 'Rate 2' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await sheet.getByRole('button', { name: 'Unrated' }).click();
	await expect(sheet.getByText('UNRATED', { exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(bars).toHaveAttribute('aria-label', 'Unrated');
});

test('favourite toggles from the sheet and shows on the tile', async ({ page }) => {
	await page.goto('/');
	const tile = page.locator('.grid .tile', { hasText: TITLE });
	await expect(tile.getByText('FAV', { exact: true })).toHaveCount(0);

	const sheet = await longPress(page, TITLE);
	await sheet.getByRole('switch').click();
	await expect(sheet.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	await expect(tile.getByText('FAV', { exact: true })).toBeVisible();

	await longPress(page, TITLE);
	await page.getByRole('switch').click();
	await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});

test('FAV toggles on the cover in one tap, without opening anything', async ({ page }) => {
	await page.goto('/');
	const tile = page.locator('.grid .tile', { hasText: TITLE });
	const fav = tile.getByRole('button', { name: 'Favourite' });
	await expect(fav).toHaveAttribute('aria-pressed', 'false');

	await fav.click();
	await expect(fav).toHaveAttribute('aria-pressed', 'true');
	await expect(tile.getByText('FAV', { exact: true })).toBeVisible();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('dialog')).toHaveCount(0);

	await page.reload();
	await expect(fav).toHaveAttribute('aria-pressed', 'true');
	await fav.click();
	await expect(fav).toHaveAttribute('aria-pressed', 'false');
	await page.reload();
	await expect(tile.getByText('FAV', { exact: true })).toHaveCount(0);
});

test('the rating bars open the six cells on the tile, and a cell saves', async ({ page }) => {
	await page.goto('/');
	const tile = page.locator('.grid .tile', { hasText: TITLE });
	const bars = tile.getByRole('img');
	await tile.getByRole('button', { name: /^Rate, / }).click();
	const picker = tile.getByRole('group', { name: 'Rating' });
	await expect(picker.getByRole('button')).toHaveCount(6);

	await picker.getByRole('button', { name: 'Rate 4' }).click();
	await expect(picker).toHaveCount(0);
	await expect(bars).toHaveAttribute('aria-label', 'Rated 4 of 5');
	await expect(page).toHaveURL(/\/$/);

	await page.reload();
	await expect(bars).toHaveAttribute('aria-label', 'Rated 4 of 5');
	// A tap elsewhere closes it without choosing.
	await tile.getByRole('button', { name: /^Rate, / }).click();
	await expect(picker).toBeVisible();
	await page.evaluate(() =>
		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
	);
	await expect(picker).toHaveCount(0);

	await tile.getByRole('button', { name: /^Rate, / }).click();
	await picker.getByRole('button', { name: 'Unrated' }).click();
	await expect(bars).toHaveAttribute('aria-label', 'Unrated');
});

test('hidden means hidden, until /reveal, and HIDE AGAIN ends it', async ({ page }) => {
	await page.goto('/');
	const sheet = await longPress(page, TITLE);
	await sheet.getByRole('button', { name: 'HIDE', exact: true }).click();
	await expect(page.locator('.grid .tile', { hasText: TITLE })).toHaveCount(0);

	// Search does not find it either.
	await page.goto(`/search?q=${encodeURIComponent('Kusuriya')}`);
	await expect(page.getByText('TITLES')).toBeVisible();
	await expect(page.locator('.hit')).toHaveCount(0);

	// Reveal is the exact typed command, run on Enter.
	await page.getByRole('searchbox').fill('/reveal');
	await page.getByRole('searchbox').press('Enter');
	await expect(page).toHaveURL('/');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	const tile = page.locator('.grid .tile', { hasText: TITLE });
	await expect(tile.getByText('HIDDEN', { exact: true })).toBeVisible();

	// Unhide it, then end reveal.
	await longPress(page, TITLE);
	await page.getByRole('button', { name: 'UNHIDE' }).click();
	await expect(tile.getByText('HIDDEN', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'HIDE AGAIN' }).click();
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
	await expect(page.locator('.grid .tile', { hasText: TITLE })).toBeVisible();
});

test('nothing hints at the hidden root while reveal is off', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText(/HENTOID/i)).toHaveCount(0);
	await expect(page.getByText(/hidden/i)).toHaveCount(0);
	const res = await page.request.get('/search?q=Onsen');
	expect(await res.text()).not.toContain('Onsen Ryokan');
});

test('multi-select applies a rating to exactly the selection', async ({ page }) => {
	await page.goto('/?sort=title');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const tile = (title: string) => page.locator('.grid .tile', { hasText: title });
	// Two unrated series, so clearing them afterwards restores them exactly.
	const picked = ['Hoshi no Umi no Tabibito', 'Isekai Yakkyoku'];
	for (const t of picked) await tile(t).click();
	await expect(page.getByText('2 SELECTED')).toBeVisible();

	const bystander = tile('Isekai Ojisan').getByRole('img');
	await expect(bystander).toHaveAttribute('aria-label', 'Rated 3 of 5');

	const toolbar = page.getByRole('toolbar');
	await toolbar.getByRole('button', { name: 'Rate 5' }).click();
	for (const t of picked)
		await expect(tile(t).getByRole('img')).toHaveAttribute('aria-label', 'Rated 5 of 5');
	await expect(bystander).toHaveAttribute('aria-label', 'Rated 3 of 5');

	await toolbar.getByRole('button', { name: 'Unrated' }).click();
	for (const t of picked)
		await expect(tile(t).getByRole('img')).toHaveAttribute('aria-label', 'Unrated');
});

test('START SCAN with nothing to import says where it looked', async ({ request }) => {
	// playwright.config.ts points LIBRARY_ROOT at an empty folder, so a scan
	// here can never import into the shared seeded database.
	const res = await request.post('/?/scan', {
		headers: { origin: 'http://localhost:4183', 'x-sveltekit-action': 'true' },
		form: {}
	});
	expect(await res.text()).toContain('NOTHING TO IMPORT');
});
