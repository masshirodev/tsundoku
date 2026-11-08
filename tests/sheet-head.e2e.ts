import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * A long sheet keeps its way out (c716): Sheet pins a head marked
 * `sheet-head`, so ✕ or CANCEL stays reachable at the end of the content, and
 * measures it so a focused row stops below it instead of under it. Runs on
 * every device at 600 px high, the short window the card names: MORE has its
 * head as a direct child of the scroller, GROUP has it inside a form. Nothing
 * here writes: the sheets are only opened and closed. The TV's panel is
 * `tests/tv-servers.e2e.ts`, since only the `tv` project has no pointer.
 */

const shortWindow = async (page: Page) => {
	const width = page.viewportSize()!.width;
	await page.setViewportSize({ width, height: 600 });
};

/** Scrolled to its end, with the head and a row's stopping place measured. */
async function atTheEnd(sheet: Locator, control: Locator) {
	const facts = await sheet.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
		const head = el.querySelector<HTMLElement>('.sheet-head')!;
		return {
			overflows: el.scrollHeight > el.clientHeight,
			scrolled: el.scrollTop > 0,
			headTop: head.getBoundingClientRect().top - el.getBoundingClientRect().top,
			height: head.offsetHeight,
			room: parseFloat(getComputedStyle(el).scrollPaddingTop)
		};
	});
	expect(facts.overflows).toBe(true);
	expect(facts.scrolled).toBe(true);
	// The strong rule is the sheet's top border, so 2 px is the head's own place.
	expect(Math.abs(facts.headTop)).toBeLessThanOrEqual(2);
	expect(facts.room).toBe(facts.height);
	// Nothing is painted over the control: a tap there reaches it.
	const reached = await control.evaluate((el) => {
		const r = el.getBoundingClientRect();
		const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		return el === hit || el.contains(hit);
	});
	expect(reached).toBe(true);
}

/** A focused row at the top stops below the head, not under it. */
async function aRowStopsBelowTheHead(sheet: Locator, row: Locator) {
	const gap = await row.evaluate((el) => {
		const scroller = el.closest('.sheet')!;
		el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
		const head = scroller.querySelector('.sheet-head')!.getBoundingClientRect();
		return el.getBoundingClientRect().top - head.bottom;
	});
	expect(gap).toBeGreaterThanOrEqual(-1);
	await expect(sheet).toBeVisible();
}

test.beforeEach(async ({ page }) => shortWindow(page));

test('MORE, scrolled to its end in a short window, keeps ✕ and it closes (c716)', async ({
	page
}, info) => {
	test.skip(info.project.name === 'desktop', 'The desktop has the sidebar: no MORE cell');
	await page.goto('/');
	await page.locator('[data-focus-id="library-more"]').click();
	const sheet = page.getByRole('dialog', { name: 'More' });
	await expect(sheet).toBeVisible();
	const x = sheet.getByRole('button', { name: 'Close' });

	await atTheEnd(sheet, x);
	await aRowStopsBelowTheHead(sheet, sheet.locator('.row').first());
	await x.click();
	await expect(sheet).toBeHidden();
});

test('GROUP, whose head is inside its form, keeps CANCEL and it closes (c716)', async ({
	page
}) => {
	await page.goto('/?sort=title');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	const tiles = page.locator('.grid .tile');
	await expect(tiles.nth(11)).toBeVisible();
	for (let i = 0; i < 12; i++) await tiles.nth(i).click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await expect(sheet.locator('.h-title')).toHaveText(/^GROUP 12 /);
	const cancel = sheet.getByRole('button', { name: 'CANCEL', exact: true });

	await atTheEnd(sheet, cancel);
	await aRowStopsBelowTheHead(sheet, sheet.locator('.rows .row').first());
	await cancel.click();
	await expect(sheet).toBeHidden();
});
