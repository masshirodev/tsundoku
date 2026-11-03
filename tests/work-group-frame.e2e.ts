import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * The GROUP sheet, AS a Work (c278, W4; doc/BOOKS.md, "The AS row").
 *
 * The frame assertions below are design-tools/gen-conformance output pinned
 * from `Work-Group.dc.html` (B5); the preamble that seeds a database, serves
 * the build on its own port and opens the sheet is hand-written, and
 * regenerating drops it (doc/WORKS.md, "The frames"). The one hand edit in the
 * generated part is the AS row's cell tracks: the board's sheet is 556px and
 * its tracks are that sheet's, so the cells are asserted equal rather than
 * 254px (the generator's own caveat about computed tracks).
 *
 * Three doujin singles: the selection allows BOOKS as well as a Work, which is
 * the two answers the board draws. The Work's answer is chosen, and the sheet
 * stays open.
 */
const pinnedPort = Number(process.env.PLAYWRIGHT_WORKS_PORT);
const PORT =
	Number.isInteger(pinnedPort) && pinnedPort > 0 && pinnedPort <= 65535
		? pinnedPort
		: // Nothing outside this file needs the number: it seeds its own database
			// and serves it here. `PLAYWRIGHT_WORKS_PORT` pins the port when the
			// gate assigns one; unset, the OS hands out a free one, so the repo's
			// own `npx playwright test` runs the file and two concurrent runs do
			// not collide.
			await new Promise<number>((resolve, reject) => {
				const probe = createServer();
				probe.once('error', reject);
				probe.listen(0, '127.0.0.1', () => {
					const { port } = probe.address() as AddressInfo;
					probe.close(() => resolve(port));
				});
			});
const base = `http://localhost:${PORT}`;
const dbPath = join(tmpdir(), `tsundoku-e2e-work-group-${process.pid}.sqlite`);
let server: ChildProcess | null = null;

/** The three singles this file groups: visible doujin, one book each. */
const SINGLES = ['Ame no Hi no Toshokan', 'Hoshi no Umi no Tabibito', 'Sekai no Owari no Kissaten'];

test.use({ baseURL: base });

test.beforeAll(async () => {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(tmpdir(), `tsundoku-e2e-work-group-empty-${process.pid}`),
			TSUNDOKU_HOME: join(tmpdir(), `tsundoku-e2e-work-group-home-${process.pid}`)
		},
		stdio: 'ignore'
	});
	let up = false;
	for (let i = 0; i < 120 && !up; i++) {
		try {
			up = (await fetch(`${base}/`, { redirect: 'manual' })).status > 0;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	if (!up) throw new Error('the work-group preview never answered');
});

test.afterAll(() => {
	server?.kill();
	server = null;
	rmSync(dbPath, { force: true });
});

/** The library, three singles selected, GROUP open, AS a Work, its name typed. */
async function openGroup(page: Page) {
	// The doujin shelf holds four visible singles: the three this file groups fit
	// on its one page, so no grid lookup waits on a later one.
	await page.goto('/?shelf=k:doujin&sort=title');
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	for (const title of SINGLES)
		await page
			.locator('.grid .tile')
			.filter({ has: page.locator('.title', { hasText: new RegExp(`^${title}$`) }) })
			.locator('.open')
			.click();
	await page.getByRole('button', { name: 'GROUP', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'Group into a series' });
	await expect(sheet).toBeVisible();
	await sheet.getByRole('radio', { name: /A WORK · SERIES/ }).click();
	await sheet.getByRole('textbox', { name: 'Work name' }).fill('Three Singles');
	await expect(sheet.getByRole('radio', { name: /NEW WORK/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
}

const SEL = {
	asLabel: '.group .sl.as',
	answers: '.group .seg.answers',
	intoLabel: '.group .sl.into',
	into: '.group .seg.into',
	nameLabel: '.group .sl.name-label',
	orderSeg: '.group .seg.order',
	grows: '.group .rows.grows',
	gr: '.group .rows.grows .row.gr >> nth=0',
	num: '.group .rows.grows .row.gr >> nth=0 >> .num',
	keeps: '.group .keeps',
	sfoot: '.group .sfoot'
};

test('The GROUP sheet, AS a Work: asLabel matches the handoff', async ({ page }) => {
	await openGroup(page);
	await expect(page.locator(SEL.asLabel)).toBeVisible();

	const asLabelStyle = await page.locator(SEL.asLabel).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			justifyContent: cs.justifyContent,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(asLabelStyle.display).toBe('flex');
	expect(asLabelStyle.justifyContent).toBe('space-between');
	expect(asLabelStyle.rowGap).toBe('12px');
	expect(asLabelStyle.columnGap).toBe('12px');
	expect(asLabelStyle.paddingTop).toBe('18px');
	expect(asLabelStyle.paddingRight).toBe('24px');
	expect(asLabelStyle.paddingBottom).toBe('10px');
	expect(asLabelStyle.paddingLeft).toBe('24px');
	expect(asLabelStyle.fontSize).toBe('13px');
	expect(asLabelStyle.fontWeight).toBe('500');
	expect(asLabelStyle.letterSpacing).toBe('0.78px');
});

test('The GROUP sheet, AS a Work: answers matches the handoff', async ({ page }) => {
	await openGroup(page);
	await expect(page.locator(SEL.answers)).toBeVisible();

	// authored as: 254px 254px
	const answersTracks = (
		(await page
			.locator(SEL.answers)
			.evaluate((node) => getComputedStyle(node).gridTemplateColumns)) as string
	).split(' ');
	expect(answersTracks).toHaveLength(2);
	// The board's own tracks are its side sheet's; ours is the full-width
	// sheet, so the cells are asserted equal instead (the tool's own caveat).
	expect(parseFloat(answersTracks[0])).toBeGreaterThan(0);
	expect(parseFloat(answersTracks[1])).toBeGreaterThan(0);
	expect(parseFloat(answersTracks[1])).toBeCloseTo(parseFloat(answersTracks[0]), 0);

	const answersStyle = await page.locator(SEL.answers).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			borderTopWidth: cs.borderTopWidth,
			borderRightWidth: cs.borderRightWidth,
			borderBottomWidth: cs.borderBottomWidth,
			borderLeftWidth: cs.borderLeftWidth
		};
	});
	expect(answersStyle.display).toBe('grid');
	expect(answersStyle.borderTopWidth).toBe('1px');
	expect(answersStyle.borderRightWidth).toBe('1px');
	expect(answersStyle.borderBottomWidth).toBe('1px');
	expect(answersStyle.borderLeftWidth).toBe('1px');
});

test('The GROUP sheet, AS a Work: intoLabel matches the handoff', async ({ page }) => {
	await openGroup(page);
	await expect(page.locator(SEL.intoLabel)).toBeVisible();

	const intoLabelStyle = await page.locator(SEL.intoLabel).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			justifyContent: cs.justifyContent,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(intoLabelStyle.display).toBe('flex');
	expect(intoLabelStyle.justifyContent).toBe('space-between');
	expect(intoLabelStyle.rowGap).toBe('12px');
	expect(intoLabelStyle.columnGap).toBe('12px');
	expect(intoLabelStyle.paddingTop).toBe('20px');
	expect(intoLabelStyle.paddingRight).toBe('24px');
	expect(intoLabelStyle.paddingBottom).toBe('10px');
	expect(intoLabelStyle.paddingLeft).toBe('24px');
	expect(intoLabelStyle.fontSize).toBe('13px');
	expect(intoLabelStyle.fontWeight).toBe('500');
	expect(intoLabelStyle.letterSpacing).toBe('0.78px');
});

test('The GROUP sheet, AS a Work: into matches the handoff', async ({ page }) => {
	await openGroup(page);
	await expect(page.locator(SEL.into)).toBeVisible();

	// authored as: 254px 254px
	const intoTracks = (
		(await page
			.locator(SEL.into)
			.evaluate((node) => getComputedStyle(node).gridTemplateColumns)) as string
	).split(' ');
	expect(intoTracks).toHaveLength(2);
	// The board's own tracks are its side sheet's; ours is the full-width
	// sheet, so the cells are asserted equal instead (the tool's own caveat).
	expect(parseFloat(intoTracks[0])).toBeGreaterThan(0);
	expect(parseFloat(intoTracks[1])).toBeGreaterThan(0);
	expect(parseFloat(intoTracks[1])).toBeCloseTo(parseFloat(intoTracks[0]), 0);

	const intoStyle = await page.locator(SEL.into).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			borderTopWidth: cs.borderTopWidth,
			borderRightWidth: cs.borderRightWidth,
			borderBottomWidth: cs.borderBottomWidth,
			borderLeftWidth: cs.borderLeftWidth
		};
	});
	expect(intoStyle.display).toBe('grid');
	expect(intoStyle.borderTopWidth).toBe('1px');
	expect(intoStyle.borderRightWidth).toBe('1px');
	expect(intoStyle.borderBottomWidth).toBe('1px');
	expect(intoStyle.borderLeftWidth).toBe('1px');
});

test('The GROUP sheet, AS a Work: nameLabel matches the handoff', async ({ page }) => {
	await openGroup(page);
	await expect(page.locator(SEL.nameLabel)).toBeVisible();

	const nameLabelStyle = await page.locator(SEL.nameLabel).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			justifyContent: cs.justifyContent,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(nameLabelStyle.display).toBe('flex');
	expect(nameLabelStyle.justifyContent).toBe('space-between');
	expect(nameLabelStyle.rowGap).toBe('12px');
	expect(nameLabelStyle.columnGap).toBe('12px');
	expect(nameLabelStyle.paddingTop).toBe('20px');
	expect(nameLabelStyle.paddingRight).toBe('24px');
	expect(nameLabelStyle.paddingBottom).toBe('10px');
	expect(nameLabelStyle.paddingLeft).toBe('24px');
	expect(nameLabelStyle.fontSize).toBe('13px');
	expect(nameLabelStyle.fontWeight).toBe('500');
	expect(nameLabelStyle.letterSpacing).toBe('0.78px');
});

test('The GROUP sheet, AS a Work: orderSeg matches the handoff', async ({ page }) => {
	await openGroup(page);
	await expect(page.locator(SEL.orderSeg)).toBeVisible();

	// authored as: 169.328px 169.328px 169.328px
	const orderSegTracks = (
		(await page
			.locator(SEL.orderSeg)
			.evaluate((node) => getComputedStyle(node).gridTemplateColumns)) as string
	).split(' ');
	expect(orderSegTracks).toHaveLength(3);
	// The board's own tracks are its side sheet's; ours is the full-width
	// sheet, so the cells are asserted equal instead (the tool's own caveat).
	expect(parseFloat(orderSegTracks[0])).toBeGreaterThan(0);
	expect(parseFloat(orderSegTracks[1])).toBeGreaterThan(0);
	expect(parseFloat(orderSegTracks[2])).toBeGreaterThan(0);
	expect(parseFloat(orderSegTracks[1])).toBeCloseTo(parseFloat(orderSegTracks[0]), 0);
	expect(parseFloat(orderSegTracks[2])).toBeCloseTo(parseFloat(orderSegTracks[0]), 0);

	const orderSegStyle = await page.locator(SEL.orderSeg).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			borderTopWidth: cs.borderTopWidth,
			borderRightWidth: cs.borderRightWidth,
			borderBottomWidth: cs.borderBottomWidth,
			borderLeftWidth: cs.borderLeftWidth
		};
	});
	expect(orderSegStyle.display).toBe('grid');
	expect(orderSegStyle.borderTopWidth).toBe('1px');
	expect(orderSegStyle.borderRightWidth).toBe('1px');
	expect(orderSegStyle.borderBottomWidth).toBe('1px');
	expect(orderSegStyle.borderLeftWidth).toBe('1px');
});

test('The GROUP sheet, AS a Work: grows matches the handoff', async ({ page }) => {
	await openGroup(page);
	await expect(page.locator(SEL.grows)).toBeVisible();

	const growsStyle = await page.locator(SEL.grows).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection,
			borderTopWidth: cs.borderTopWidth,
			borderRightWidth: cs.borderRightWidth,
			borderBottomWidth: cs.borderBottomWidth,
			borderLeftWidth: cs.borderLeftWidth
		};
	});
	expect(growsStyle.display).toBe('flex');
	expect(growsStyle.flexDirection).toBe('column');
	expect(growsStyle.borderTopWidth).toBe('1px');
	expect(growsStyle.borderRightWidth).toBe('1px');
	expect(growsStyle.borderBottomWidth).toBe('1px');
	expect(growsStyle.borderLeftWidth).toBe('1px');
});

test('The GROUP sheet, AS a Work: gr matches the handoff', async ({ page }) => {
	await openGroup(page);
	await expect(page.locator(SEL.gr)).toBeVisible();

	const grStyle = await page.locator(SEL.gr).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			minHeight: cs.minHeight
		};
	});
	expect(grStyle.display).toBe('flex');
	expect(grStyle.alignItems).toBe('stretch');
	expect(grStyle.minHeight).toBe('64px');
});

test('The GROUP sheet, AS a Work: num matches the handoff', async ({ page }) => {
	await openGroup(page);
	await expect(page.locator(SEL.num)).toBeVisible();

	const numStyle = await page.locator(SEL.num).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			borderRightWidth: cs.borderRightWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight
		};
	});
	expect(numStyle.display).toBe('flex');
	expect(numStyle.alignItems).toBe('center');
	expect(numStyle.justifyContent).toBe('center');
	expect(numStyle.borderRightWidth).toBe('1px');
	expect(numStyle.fontSize).toBe('13px');
	expect(numStyle.fontWeight).toBe('500');
});

test('The GROUP sheet, AS a Work: keeps matches the handoff', async ({ page }) => {
	await openGroup(page);
	await expect(page.locator(SEL.keeps)).toBeVisible();

	const keepsStyle = await page.locator(SEL.keeps).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			fontSize: cs.fontSize,
			lineHeight: cs.lineHeight
		};
	});
	expect(keepsStyle.display).toBe('block');
	expect(keepsStyle.paddingTop).toBe('14px');
	expect(keepsStyle.paddingRight).toBe('24px');
	expect(keepsStyle.paddingLeft).toBe('24px');
	expect(keepsStyle.fontSize).toBe('12px');
	expect(keepsStyle.lineHeight).toBe('18px');
});

test('The GROUP sheet, AS a Work: sfoot matches the handoff', async ({ page }) => {
	await openGroup(page);
	await expect(page.locator(SEL.sfoot)).toBeVisible();

	const sfootStyle = await page.locator(SEL.sfoot).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			borderTopWidth: cs.borderTopWidth
		};
	});
	expect(sfootStyle.display).toBe('flex');
	expect(sfootStyle.borderTopWidth).toBe('1px');
});
