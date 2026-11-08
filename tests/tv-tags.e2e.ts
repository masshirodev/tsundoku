import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { GENRE, SOURCE, startTagWorld, type TagWorld } from './helpers/tag-world';

/**
 * A tag on the series screen with the remote (card c313; doc/FOCUS.md): at
 * 960×540 with no pointer, the D-pad reaches a tag value (through DETAILS,
 * which folds TAGS on a TV since c425), OK opens its sheet
 * with the first row focused, and BACK closes it and gives focus back to the
 * tag. On its own world (tests/helpers/tag-world.ts), so it opens no series
 * the shared database's specs touch, and writes nothing.
 */

let world: TagWorld;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
	world = await startTagWorld('tv-tags');
});
test.afterAll(async () => {
	await world?.stop();
});

/**
 * What the page shows one second into a wait on `tag-search` (c452), as the
 * page itself saw it: once a link starts a navigation, Playwright waits for
 * it before it reads the page again, so the old page writes down its busy
 * element, its words and whether it is focused, in sessionStorage, which the
 * landing (same tab, same origin) reads back.
 */
async function recordWait(page: Page): Promise<void> {
	await page.evaluate(() => {
		sessionStorage.removeItem('c452');
		setTimeout(() => {
			const busy = document.querySelector<HTMLElement>('[aria-busy="true"]');
			sessionStorage.setItem(
				'c452',
				JSON.stringify({
					text: busy?.innerText.replace(/\s+/g, ' ').trim() ?? null,
					focused: !!busy && document.activeElement === busy,
					line:
						document.querySelector('.tag-wait')?.textContent?.replace(/\s+/g, ' ').trim() ?? null
				})
			);
		}, 1000);
	});
}
const recorded = async (page: Page) =>
	JSON.parse((await page.evaluate(() => sessionStorage.getItem('c452'))) ?? 'null') as {
		text: string | null;
		focused: boolean;
		line: string | null;
	} | null;

const focusedText = (page: Page) =>
	page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? '');

type Mark = { row: string; inTags: boolean; text: string; toward: string | null };
/** Where the focus mark is, and which arrow points from it to the value (inside the TAGS row). */
const mark = (page: Page, value: string) =>
	page.evaluate((v): Mark => {
		const a = document.activeElement as HTMLElement | null;
		const target = [...document.querySelectorAll<HTMLElement>('.tags a')].find(
			(t) => t.innerText.trim() === v
		);
		let toward: string | null = null;
		if (a && target && a !== target) {
			const r = a.getBoundingClientRect();
			const t = target.getBoundingClientRect();
			toward =
				t.bottom <= r.top
					? 'ArrowUp'
					: t.top >= r.bottom
						? 'ArrowDown'
						: t.left >= r.right
							? 'ArrowRight'
							: 'ArrowLeft';
		}
		return {
			row: a?.closest('.row')?.querySelector('.label')?.textContent?.trim() ?? '',
			inTags: !!a?.closest('.tags'),
			text: a?.innerText?.trim() ?? '',
			toward
		};
	}, value);

/** Whether the focus is on DETAILS while it is folded (c425). */
const onFoldedDetails = (page: Page) =>
	page.evaluate(
		() => document.activeElement?.matches('[data-row="details"][aria-expanded="false"]') ?? false
	);

/**
 * The way a remote reaches a tag: ↓ down the panel, OK on DETAILS where it is
 * folded (on a TV TAGS is one of the rows it folds, c425), ↓ on to the TAGS row
 * (the pad meets it at its EDIT cell, on the right), ← into its values, then
 * the arrow toward the value, one press at a time. At most `n` presses; the
 * path is the error.
 */
async function padTo(page: Page, value: string, n = 40) {
	const path: string[] = [];
	for (let i = 0; i < n; i++) {
		const m = await mark(page, value);
		path.push(`${m.row}:${m.text.slice(0, 16)}`);
		if (m.inTags && m.text === value) return;
		const key = (await onFoldedDetails(page))
			? 'Enter'
			: m.row === 'TAGS' && !m.inTags
				? 'ArrowLeft'
				: m.inTags
					? m.toward!
					: 'ArrowDown';
		await page.keyboard.press(key);
	}
	throw new Error(`the pad never reached ${value}; path ${path.join(' > ')}`);
}

test('the pad reaches a tag, OK opens its sheet on the first row, BACK closes it onto the tag', async ({
	page
}) => {
	expect(
		await page.evaluate(() => matchMedia('(pointer: none)').matches),
		'the tv project has no pointer'
	).toBe(true);
	await page.goto(`${world.base}/series/${world.ids.tagged}`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: 'Tagbearer Heir' })).toBeVisible();

	await padTo(page, 'Romance');
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Look for Romance' });
	await expect(sheet).toBeVisible();
	const first = sheet.getByRole('link', { name: /IN THE LIBRARY/ });
	await expect(first).toBeFocused();
	// ↓ is the other row, and the sheet keeps the keys.
	await page.keyboard.press('ArrowDown');
	await expect(
		sheet.getByRole('link', { name: new RegExp(`IN ${SOURCE.name.toUpperCase()}`) })
	).toBeFocused();

	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	expect(await focusedText(page)).toBe('Romance');
	await expect
		.poll(() =>
			page.evaluate(() => !!(document.activeElement as HTMLElement | null)?.closest('.tags'))
		)
		.toBe(true);

	// OK on the source's row goes there.
	await page.keyboard.press('Enter');
	await expect(sheet).toBeVisible();
	await expect(first).toBeFocused();
	await page.keyboard.press('ArrowDown');
	const toSource = sheet.getByRole('link', {
		name: new RegExp(`IN ${SOURCE.name.toUpperCase()}`)
	});
	await expect(toSource).toBeFocused();
	// The source's filters are slow and nothing has asked for them yet (c452):
	// the row says it is finding them, and stays the focused stop, readable.
	world.schema({ slowMs: 3000 });
	await recordWait(page);
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}\\?`), { timeout: 15_000 });
	world.schema('ok');
	const wait = await recorded(page);
	expect(wait?.text).toBe(
		`IN ${SOURCE.name.toUpperCase()} FINDING ${SOURCE.name.toUpperCase()}'S FILTERS… →`
	);
	expect(wait?.focused).toBe(true);
	// On the filter Romance names, included, and not a search for the word.
	const u = new URL(page.url());
	expect(u.searchParams.get('tab')).toBe('filtered');
	expect(u.searchParams.get(`f${GENRE}.1`)).toBe('1');
	expect(u.searchParams.get('q')).toBeNull();
	await expect(page.locator('nav[aria-label="Lists"] .tab.on')).toHaveText('FILTERED');
});
