import { test, expect, type Page } from '@playwright/test';
import { SOURCE, startTagWorld, type TagWorld } from './helpers/tag-world';

/**
 * A tag on the series screen with the remote (card c313; doc/FOCUS.md): at
 * 960×540 with no pointer, the D-pad reaches a tag value, OK opens its sheet
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

/**
 * The way a remote reaches a tag: ↓ down the panel to the TAGS row (the pad
 * meets it at its EDIT cell, on the right), ← into its values, then the arrow
 * toward the value, one press at a time. At most `n` presses; the path is the error.
 */
async function padTo(page: Page, value: string, n = 40) {
	const path: string[] = [];
	for (let i = 0; i < n; i++) {
		const m = await mark(page, value);
		path.push(`${m.row}:${m.text.slice(0, 16)}`);
		if (m.inTags && m.text === value) return;
		const key = m.row === 'TAGS' && !m.inTags ? 'ArrowLeft' : m.inTags ? m.toward! : 'ArrowDown';
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
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(new RegExp(`/browse/${SOURCE.id}\\?`));
});
