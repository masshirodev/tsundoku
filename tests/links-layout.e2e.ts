import { expect, test } from './fixtures';

/**
 * The link review's frame per device, from its design (doc/LINKS.md).
 * The mock's spacing is hand-set, not a ladder, so these are its literals,
 * asserted so a later tidy-up onto round numbers shows up as a failure rather
 * than a quietly redrawn screen. Tablet landscape has the room the desktop
 * drawing had, so it takes that layout: the series beside its candidates.
 * Read-only.
 */
type Frame = {
	side: boolean;
	head: number;
	cover: number;
	candCover: number;
	label: number;
	cols: number;
	act: string;
};
const FRAMES: Record<string, Frame> = {
	'tablet-portrait': {
		side: false,
		head: 72,
		cover: 104,
		candCover: 96,
		label: 104,
		cols: 1,
		act: '14px'
	},
	'tablet-landscape': {
		side: true,
		head: 72,
		cover: 120,
		candCover: 96,
		label: 104,
		cols: 2,
		act: '14px'
	},
	phone: { side: false, head: 60, cover: 72, candCover: 64, label: 84, cols: 1, act: '12px' },
	desktop: { side: true, head: 72, cover: 120, candCover: 96, label: 104, cols: 2, act: '14px' }
};

test('the link review matches the design for this device', async ({ page }, info) => {
	const f = FRAMES[info.project.name];
	test.skip(!f, 'no frame drawn for this project');
	// Mount Hua's own review, whatever order links-flow has left the queue in.
	await page.goto('/?sort=title');
	await page.locator('.grid .tile', { hasText: 'Return of the Mount Hua Sect' }).click();
	await page.waitForURL(/\/series\/\d+/);
	const id = /\/series\/(\d+)/.exec(page.url())![1];
	await page.goto(`/links?series=${id}`);
	await expect(page.locator('.cand')).toHaveCount(3);
	// The third candidate is the series' own title: marked, not preselected
	// (doc/LINKS.md, "The review").
	await expect(page.locator('.chip.exact')).toHaveCount(1);

	const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
	expect((await box('.head')).height).toBe(f.head);
	expect((await box('.series .cover')).width).toBe(f.cover);
	expect((await box('.ccover')).width).toBe(f.candCover);
	// Every cover is the tile's 2:2.9.
	const c = await box('.ccover');
	expect(Math.abs(c.height - (c.width * 2.9) / 2)).toBeLessThan(1);

	const series = await box('.series');
	const cands = await box('.cands');
	if (f.side) {
		expect(series.width).toBe(420);
		expect(Math.round(cands.x)).toBe(Math.round(series.x + series.width));
	} else {
		expect(cands.y).toBeGreaterThanOrEqual(series.y + series.height - 1);
	}

	const cols = await page
		.locator('.grid')
		.evaluate((n) => getComputedStyle(n).gridTemplateColumns.split(' ').length);
	expect(cols).toBe(f.cols);
	const label = await page
		.locator('.series .r')
		.first()
		.evaluate((n) => getComputedStyle(n).gridTemplateColumns.split(' ')[0]);
	expect(label).toBe(`${f.label}px`);

	// The candidate's strip: 44px, its letter cell square.
	expect((await box('.strip')).height).toBe(44);
	expect((await box('.letter')).width).toBe(44);
	// Tools 52px and actions 64px, at the foot, in the mock's type size.
	expect((await box('.tools button')).height).toBeGreaterThanOrEqual(52);
	expect((await box('.actions button')).height).toBeGreaterThanOrEqual(64);
	expect(
		await page
			.locator('.actions button')
			.first()
			.evaluate((n) => getComputedStyle(n).fontSize)
	).toBe(f.act);
	const actions = await box('.actions');
	const vh = page.viewportSize()!.height;
	expect(Math.round(actions.y + actions.height)).toBeLessThanOrEqual(vh);
});
