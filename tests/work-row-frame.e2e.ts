import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Page } from '@playwright/test';
import { expect, readerReady, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * The series screen's WORK row (W5, Work-Row.dc.html, all three slices).
 *
 * The frame assertions below are design-tools/gen-conformance output pinned
 * from the board; the preamble that seeds a database, serves the build on its
 * own port and opens each of the board's three states is hand-written, and
 * regenerating drops it (doc/WORKS.md, "The frames").
 *
 * The board draws three states of one screen: a part mid-run (the plain row,
 * both cells live), a part read through with the next one unstarted (the
 * accent row, CONTINUE quiet), and a first part (← dimmed). This file makes two
 * Works in SQL -- one caught mid-run, one with its second part read through --
 * and measures each state on the screen that draws it.
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
const dbPath = join(tmpdir(), `tsundoku-e2e-work-row-${process.pid}.sqlite`);
let server: ChildProcess | null = null;

/** The two Works' series: part 1, 2 and 3 of each, in the seed. */
const MID = [18, 1, 20];
const READ = [21, 8, 22];
const workIds = { mid: 0, read: 0 };

test.use({ baseURL: base });

test.beforeAll(async () => {
	// The hook waits up to 60 s for its own preview to answer, after seeding a database and writing two Works into it:
	// past the default 30 s on a loaded box, where the hook ran out in wave
	// 24's first gate, as `work-end-frame`'s did in wave 20's.
	// Measured in wave 25 at a load of about 30 (the works-frame project, 3
	// copies): 3.3-4.4 s. So 60 s for the preview plus 30 s for the seed. In a hook, test.setTimeout sets the
	// hook's own budget (Playwright's test.d.ts, "Changing timeout for a
	// beforeAll").
	test.setTimeout(90_000);
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	const now = Date.now();
	const make = db.prepare(`INSERT INTO works (name, created_at, order_mode) VALUES (?, ?, 'hand')`);
	const member = db.prepare(
		`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, ?)`
	);
	workIds.mid = Number(make.run('Mid Run', now).lastInsertRowid);
	MID.forEach((id, i) => member.run(workIds.mid, id, i + 1));
	workIds.read = Number(make.run('Read Run', now).lastInsertRowid);
	READ.forEach((id, i) => member.run(workIds.read, id, i + 1));
	// Mid Run: part 1 read through, part 2 in progress, part 3 never opened.
	db.prepare(`UPDATE entries SET read_at = ? WHERE series_id = ? AND shadowed = 0`).run(
		now,
		MID[0]
	);
	db.prepare(
		`UPDATE entries SET read_at = ? WHERE series_id = ? AND shadowed = 0 AND position <= 20`
	).run(now, MID[1]);
	db.prepare(
		`UPDATE entries SET last_opened_at = ? WHERE series_id = ? AND shadowed = 0 AND position = 20`
	).run(now, MID[1]);
	// Read Run: parts 1 and 2 read through, part 3 not started -- so part 2 is
	// the accent row, and CONTINUE on it is quiet.
	db.prepare(`UPDATE entries SET read_at = ? WHERE series_id IN (?, ?) AND shadowed = 0`).run(
		now,
		READ[0],
		READ[1]
	);
	db.close();
	server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: join(tmpdir(), `tsundoku-e2e-work-row-empty-${process.pid}`),
			TSUNDOKU_HOME: join(tmpdir(), `tsundoku-e2e-work-row-home-${process.pid}`)
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
	if (!up) throw new Error('the work-row preview never answered');
});

test.afterAll(() => {
	server?.kill();
	server = null;
	rmSync(dbPath, { force: true });
});

/** Part 2 of Mid Run, opened from its Work: the plain WORK row. */
async function openMid(page: Page) {
	await page.goto(`/series/${MID[1]}?from=work:${workIds.mid}`);
	await expect(page.locator('.prow.work-row')).toBeVisible();
}

/** Part 2 of Read Run: read through, so the accent row and a quiet CONTINUE. */
async function openRead(page: Page) {
	await page.goto(`/series/${READ[1]}?from=work:${workIds.read}`);
	await expect(page.locator('.prow.next')).toBeVisible();
}

/** The plain row's own sheet, opened the way a finger or a remote opens one. */
async function openSheet(page: Page) {
	await openMid(page);
	await page.locator('.prow.work-row .lk').click({ button: 'right' });
	await expect(page.getByRole('dialog', { name: /WORK$/ })).toBeVisible();
}

const SEL = {
	cta: '.panel .cta',
	workRow: '.panel .prow.work-row',
	workLabel: '.panel .prow.work-row .label',
	workLk: '.panel .prow.work-row .lk',
	workTitle: '.panel .prow.work-row .lk-a',
	workMeta: '.panel .prow.work-row .lk-b',
	workPrev: '.panel .prow.work-row .pn >> nth=0',
	quietCta: '.panel .cta.quiet',
	accentRow: '.panel .prow.next',
	accentLabel: '.panel .prow.next .label',
	accentCell: '.panel .prow.next .next-cell',
	sheetHead: '.sheet .sh-head',
	openRow: '.sheet .prow >> nth=0',
	openLabel: '.sheet .prow >> nth=0 >> .label',
	openCell: '.sheet .prow >> nth=0 >> .lc',
	moveRow: '.sheet form.prow >> nth=0',
	takeOutRow: '.sheet form.prow >> nth=1'
};

test("The series screen's WORK row: cta matches the handoff", async ({ page }) => {
	await openMid(page);
	await expect(page.locator(SEL.cta)).toBeVisible();

	const ctaStyle = await page.locator(SEL.cta).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(ctaStyle.display).toBe('flex');
	expect(ctaStyle.alignItems).toBe('center');
	expect(ctaStyle.justifyContent).toBe('space-between');
	expect(ctaStyle.rowGap).toBe('12px');
	expect(ctaStyle.columnGap).toBe('12px');
	expect(ctaStyle.paddingRight).toBe('24px');
	expect(ctaStyle.paddingLeft).toBe('24px');
	expect(ctaStyle.fontSize).toBe('15px');
	expect(ctaStyle.fontWeight).toBe('500');
	expect(ctaStyle.letterSpacing).toBe('0.6px');
});

test("The series screen's WORK row: workRow matches the handoff", async ({ page }) => {
	await openMid(page);
	await expect(page.locator(SEL.workRow)).toBeVisible();

	const workRowStyle = await page.locator(SEL.workRow).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			borderBottomWidth: cs.borderBottomWidth,
			minHeight: cs.minHeight
		};
	});
	expect(workRowStyle.display).toBe('flex');
	expect(workRowStyle.alignItems).toBe('stretch');
	expect(workRowStyle.borderBottomWidth).toBe('1px');
	expect(workRowStyle.minHeight).toBe('64px');
});

test("The series screen's WORK row: workLabel matches the handoff", async ({ page }) => {
	await openMid(page);
	await expect(page.locator(SEL.workLabel)).toBeVisible();

	const workLabelStyle = await page.locator(SEL.workLabel).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			paddingLeft: cs.paddingLeft,
			borderRightWidth: cs.borderRightWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(workLabelStyle.display).toBe('flex');
	expect(workLabelStyle.alignItems).toBe('center');
	expect(workLabelStyle.paddingLeft).toBe('24px');
	expect(workLabelStyle.borderRightWidth).toBe('1px');
	expect(workLabelStyle.fontSize).toBe('12px');
	expect(workLabelStyle.fontWeight).toBe('500');
	expect(workLabelStyle.letterSpacing).toBe('0.72px');
});

test("The series screen's WORK row: workLk matches the handoff", async ({ page }) => {
	await openMid(page);
	await expect(page.locator(SEL.workLk)).toBeVisible();

	const workLkStyle = await page.locator(SEL.workLk).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection,
			justifyContent: cs.justifyContent,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft
		};
	});
	expect(workLkStyle.display).toBe('flex');
	expect(workLkStyle.flexDirection).toBe('column');
	expect(workLkStyle.justifyContent).toBe('center');
	expect(workLkStyle.rowGap).toBe('5px');
	expect(workLkStyle.columnGap).toBe('5px');
	expect(workLkStyle.paddingTop).toBe('10px');
	expect(workLkStyle.paddingRight).toBe('14px');
	expect(workLkStyle.paddingBottom).toBe('10px');
	expect(workLkStyle.paddingLeft).toBe('14px');
});

test("The series screen's WORK row: workTitle matches the handoff", async ({ page }) => {
	await openMid(page);
	await expect(page.locator(SEL.workTitle)).toBeVisible();

	const workTitleStyle = await page.locator(SEL.workTitle).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			lineHeight: cs.lineHeight
		};
	});
	expect(workTitleStyle.display).toBe('block');
	expect(workTitleStyle.fontSize).toBe('15px');
	expect(workTitleStyle.fontWeight).toBe('500');
	expect(workTitleStyle.lineHeight).toBe('19.5px');
});

test("The series screen's WORK row: workMeta matches the handoff", async ({ page }) => {
	await openMid(page);
	await expect(page.locator(SEL.workMeta)).toBeVisible();

	const workMetaStyle = await page.locator(SEL.workMeta).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			fontSize: cs.fontSize,
			lineHeight: cs.lineHeight
		};
	});
	expect(workMetaStyle.display).toBe('block');
	expect(workMetaStyle.fontSize).toBe('13px');
	expect(workMetaStyle.lineHeight).toBe('17.55px');
});

test("The series screen's WORK row: workPrev matches the handoff", async ({ page }) => {
	await openMid(page);
	await expect(page.locator(SEL.workPrev)).toBeVisible();

	const workPrevStyle = await page.locator(SEL.workPrev).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			borderLeftWidth: cs.borderLeftWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight
		};
	});
	expect(workPrevStyle.display).toBe('flex');
	expect(workPrevStyle.alignItems).toBe('center');
	expect(workPrevStyle.justifyContent).toBe('center');
	expect(workPrevStyle.borderLeftWidth).toBe('1px');
	expect(workPrevStyle.fontSize).toBe('13px');
	expect(workPrevStyle.fontWeight).toBe('500');
});

test("The series screen's WORK row: quietCta matches the handoff", async ({ page }) => {
	await openRead(page);
	await expect(page.locator(SEL.quietCta)).toBeVisible();

	const quietCtaStyle = await page.locator(SEL.quietCta).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			borderBottomWidth: cs.borderBottomWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(quietCtaStyle.display).toBe('flex');
	expect(quietCtaStyle.alignItems).toBe('center');
	expect(quietCtaStyle.justifyContent).toBe('space-between');
	expect(quietCtaStyle.rowGap).toBe('12px');
	expect(quietCtaStyle.columnGap).toBe('12px');
	expect(quietCtaStyle.paddingRight).toBe('24px');
	expect(quietCtaStyle.paddingLeft).toBe('24px');
	expect(quietCtaStyle.borderBottomWidth).toBe('1px');
	expect(quietCtaStyle.fontSize).toBe('15px');
	expect(quietCtaStyle.fontWeight).toBe('500');
	expect(quietCtaStyle.letterSpacing).toBe('0.6px');
});

test("The series screen's WORK row: accentRow matches the handoff", async ({ page }) => {
	await openRead(page);
	await expect(page.locator(SEL.accentRow)).toBeVisible();

	const accentRowStyle = await page.locator(SEL.accentRow).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			borderBottomWidth: cs.borderBottomWidth,
			minHeight: cs.minHeight
		};
	});
	expect(accentRowStyle.display).toBe('flex');
	expect(accentRowStyle.alignItems).toBe('stretch');
	expect(accentRowStyle.borderBottomWidth).toBe('1px');
	expect(accentRowStyle.minHeight).toBe('64px');
});

test("The series screen's WORK row: accentLabel matches the handoff", async ({ page }) => {
	await openRead(page);
	await expect(page.locator(SEL.accentLabel)).toBeVisible();

	const accentLabelStyle = await page.locator(SEL.accentLabel).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			paddingLeft: cs.paddingLeft,
			borderRightWidth: cs.borderRightWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(accentLabelStyle.display).toBe('flex');
	expect(accentLabelStyle.alignItems).toBe('center');
	expect(accentLabelStyle.paddingLeft).toBe('24px');
	expect(accentLabelStyle.borderRightWidth).toBe('1px');
	expect(accentLabelStyle.fontSize).toBe('12px');
	expect(accentLabelStyle.fontWeight).toBe('500');
	expect(accentLabelStyle.letterSpacing).toBe('0.72px');
});

test("The series screen's WORK row: accentCell matches the handoff", async ({ page }) => {
	await openRead(page);
	await expect(page.locator(SEL.accentCell)).toBeVisible();

	const accentCellStyle = await page.locator(SEL.accentCell).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			borderLeftWidth: cs.borderLeftWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(accentCellStyle.display).toBe('flex');
	expect(accentCellStyle.alignItems).toBe('center');
	expect(accentCellStyle.justifyContent).toBe('center');
	expect(accentCellStyle.paddingRight).toBe('18px');
	expect(accentCellStyle.paddingLeft).toBe('18px');
	expect(accentCellStyle.borderLeftWidth).toBe('1px');
	expect(accentCellStyle.fontSize).toBe('13px');
	expect(accentCellStyle.fontWeight).toBe('500');
	expect(accentCellStyle.letterSpacing).toBe('0.52px');
});

test("The series screen's WORK row: sheetHead matches the handoff", async ({ page }) => {
	await openSheet(page);
	await expect(page.locator(SEL.sheetHead)).toBeVisible();

	const sheetHeadStyle = await page.locator(SEL.sheetHead).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			borderTopWidth: cs.borderTopWidth,
			borderBottomWidth: cs.borderBottomWidth
		};
	});
	expect(sheetHeadStyle.display).toBe('flex');
	expect(sheetHeadStyle.alignItems).toBe('stretch');
	expect(sheetHeadStyle.borderTopWidth).toBe('1px');
	expect(sheetHeadStyle.borderBottomWidth).toBe('1px');
});

test("The series screen's WORK row: openRow matches the handoff", async ({ page }) => {
	await openSheet(page);
	await expect(page.locator(SEL.openRow)).toBeVisible();

	const openRowStyle = await page.locator(SEL.openRow).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			borderBottomWidth: cs.borderBottomWidth,
			minHeight: cs.minHeight
		};
	});
	expect(openRowStyle.display).toBe('flex');
	expect(openRowStyle.alignItems).toBe('stretch');
	expect(openRowStyle.borderBottomWidth).toBe('1px');
	expect(openRowStyle.minHeight).toBe('64px');
});

test("The series screen's WORK row: openLabel matches the handoff", async ({ page }) => {
	await openSheet(page);
	await expect(page.locator(SEL.openLabel)).toBeVisible();

	const openLabelStyle = await page.locator(SEL.openLabel).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			paddingLeft: cs.paddingLeft,
			borderRightWidth: cs.borderRightWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(openLabelStyle.display).toBe('flex');
	expect(openLabelStyle.alignItems).toBe('center');
	expect(openLabelStyle.paddingLeft).toBe('24px');
	expect(openLabelStyle.borderRightWidth).toBe('1px');
	expect(openLabelStyle.fontSize).toBe('12px');
	expect(openLabelStyle.fontWeight).toBe('500');
	expect(openLabelStyle.letterSpacing).toBe('0.72px');
});

test("The series screen's WORK row: openCell matches the handoff", async ({ page }) => {
	await openSheet(page);
	await expect(page.locator(SEL.openCell)).toBeVisible();

	const openCellStyle = await page.locator(SEL.openCell).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			borderLeftWidth: cs.borderLeftWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing
		};
	});
	expect(openCellStyle.display).toBe('flex');
	expect(openCellStyle.alignItems).toBe('center');
	expect(openCellStyle.justifyContent).toBe('center');
	expect(openCellStyle.paddingRight).toBe('18px');
	expect(openCellStyle.paddingLeft).toBe('18px');
	expect(openCellStyle.borderLeftWidth).toBe('1px');
	expect(openCellStyle.fontSize).toBe('13px');
	expect(openCellStyle.fontWeight).toBe('500');
	expect(openCellStyle.letterSpacing).toBe('0.52px');
});

test("The series screen's WORK row: moveRow matches the handoff", async ({ page }) => {
	await openSheet(page);
	await expect(page.locator(SEL.moveRow)).toBeVisible();

	const moveRowStyle = await page.locator(SEL.moveRow).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			borderBottomWidth: cs.borderBottomWidth,
			minHeight: cs.minHeight
		};
	});
	expect(moveRowStyle.display).toBe('flex');
	expect(moveRowStyle.alignItems).toBe('stretch');
	expect(moveRowStyle.borderBottomWidth).toBe('1px');
	expect(moveRowStyle.minHeight).toBe('64px');
});

test("The series screen's WORK row: takeOutRow matches the handoff", async ({ page }) => {
	await openSheet(page);
	await expect(page.locator(SEL.takeOutRow)).toBeVisible();

	const takeOutRowStyle = await page.locator(SEL.takeOutRow).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			minHeight: cs.minHeight
		};
	});
	expect(takeOutRowStyle.display).toBe('flex');
	expect(takeOutRowStyle.alignItems).toBe('stretch');
	expect(takeOutRowStyle.minHeight).toBe('64px');
});

// ---- the states the board draws, beyond its measurements ---------------------

test("the accent row is the screen's one accent, and CONTINUE beside it is quiet", async ({
	page
}) => {
	await openRead(page);
	const accent = page.locator('.prow.next');
	await expect(accent).toContainText('NEXT');
	await expect(accent.locator('.lk-a')).toHaveText('Isekai Yakkyoku');
	await expect(accent.locator('.lk-b')).toContainText('IN READ RUN · PART 3');
	await expect(accent.locator('.next-cell')).toContainText('▶ CH. 1');
	// The quiet bar has no accent ground; the row does. One accent, the run's.
	const quiet = await page.locator('.panel .cta.quiet').evaluate((n) => {
		return getComputedStyle(n).backgroundColor;
	});
	const row = await accent.evaluate((n) => getComputedStyle(n).backgroundColor);
	expect(quiet).toBe('rgba(0, 0, 0, 0)');
	expect(row).not.toBe(quiet);
	await expect(page.locator('.panel .cta.quiet')).toContainText('READ AGAIN');
});

test('a part whose run has moved on says where it is, and the first part dims ←', async ({
	page
}) => {
	// Part 1 is read through and part 2 is in progress: the row names part 2.
	await page.goto(`/series/${MID[0]}?from=work:${workIds.mid}`);
	await expect(page.locator('.prow.next')).toHaveCount(0);
	const row = page.locator('.prow.work-row');
	await expect(row.locator('.lk-b')).toContainText("PART 1 OF 3 · YOU'RE IN DRAWING: SAIKYOU");
	// ← is dimmed on the first part, and → opens the second.
	await expect(row.locator('.pn').first()).toHaveClass(/off/);
	await expect(row.locator('.pn').first()).not.toHaveAttribute('href');
	await expect(row.locator('.pn').nth(1)).toHaveAttribute('href', /\/series\/1\?from=work%3A\d+/);
});

test('mid-way: the row names the neighbour, its cells open them, and the name opens the Work', async ({
	page
}) => {
	await openMid(page);
	const row = page.locator('.prow.work-row');
	await expect(row.locator('.lk-a')).toHaveText('Mid Run');
	await expect(row.locator('.lk-b')).toHaveText('PART 2 OF 3 · NEXT · TENSEI SHITARA KEN DESHITA');
	// The neighbours: ← is part 1, → part 3, each opened from this Work.
	await expect(row.locator('.pn').first()).toHaveAttribute(
		'href',
		new RegExp(`/series/${MID[0]}\\?from=work%3A${workIds.mid}`)
	);
	await expect(row.locator('.pn').nth(1)).toHaveAttribute(
		'href',
		new RegExp(`/series/${MID[2]}\\?from=work%3A${workIds.mid}`)
	);
	// The name opens the Work's own screen.
	await row.locator('.lk').click();
	await page.waitForURL(new RegExp(`/work/${workIds.mid}`));
	await expect(page.locator('.bar-title .t')).toHaveText('Mid Run');
});

test('back from the Work: ← names it, and a stale id falls back to the library', async ({
	page
}) => {
	await page.goto(`/series/${MID[1]}?from=work:${workIds.mid}`);
	await expect(page.locator('a.back .back-label')).toHaveText('MID RUN');
	// A stale or hand-typed id is a claim, not a fact: the cell does not repeat it.
	await page.goto(`/series/${MID[1]}?from=work:999999`);
	await expect(page.locator('a.back .back-label')).toHaveText('LIBRARY');
});

test('read through: CONTINUE is quiet and the accent row opens the next part', async ({ page }) => {
	await openRead(page);
	await expect(page.locator('.panel .cta.quiet')).toHaveText(/↺ READ AGAIN/);
	const accent = page.locator('.prow.next');
	await expect(accent.locator('.lk-b')).toHaveText('IN READ RUN · PART 3 · 50 CH.');
	await accent.locator('.next-cell').click();
	await page.waitForURL(/\/read\/\d+/);
	await readerReady(page);
});

test('the sheet: MOVE reorders the run, and TAKE OUT leaves it with a band and UNDO', async ({
	page
}) => {
	await openSheet(page);
	const sheet = page.getByRole('dialog', { name: /WORK$/ });
	// MOVE ↑: part 2 takes part 1's place; the Work's own screen is the proof.
	await sheet.getByRole('button', { name: '↑' }).click();
	await page.goto(`/work/${workIds.mid}`);
	const parts = page.locator('.run .part .tx .a');
	await expect(parts.nth(0)).toHaveText(/^Drawing: Saikyou Mangaka/);
	await expect(parts.nth(1)).toHaveText('Boku no Kokoro no Yabai Yatsu');
	await page.waitForLoadState('networkidle');
	// Put the order back, so the rest of the file sees the seed's.
	await page.goto(`/series/${MID[1]}?from=work:${workIds.mid}`);
	await page.locator('.prow.work-row .lk').click({ button: 'right' });
	await page.getByRole('dialog', { name: /WORK$/ }).getByRole('button', { name: '↓' }).click();
	await page.goto(`/work/${workIds.mid}`);
	await expect(parts.nth(0)).toHaveText('Boku no Kokoro no Yabai Yatsu');

	// TAKE OUT: part 2 is its own series again; the Work keeps its other two.
	await page.goto(`/series/${MID[1]}?from=work:${workIds.mid}`);
	await page.locator('.prow.work-row .lk').click({ button: 'right' });
	await page
		.getByRole('dialog', { name: /WORK$/ })
		.getByRole('button', { name: 'TAKE OUT' })
		.click();
	const band = page.locator('.band', { hasText: 'TAKEN OUT OF MID RUN' });
	await expect(band).toBeVisible();
	await expect(page.locator('.prow.work-row')).toHaveCount(0);
	// UNDO puts it back where it was.
	await band.getByRole('button', { name: 'UNDO' }).click();
	await expect(page.locator('.prow.work-row')).toBeVisible();
	await expect(page.locator('.prow.work-row .lk-b')).toContainText('PART 2 OF 3');
});

test('on a phone the row keeps the board’s height and its ← → cells drop to 44px', async ({
	page
}) => {
	// Work-Row's note: "ON A PHONE THE ROW IS THE SAME 52PX ROW, AND THE ← → CELLS
	// DROP INTO IT AT 44PX." The 52px is `.prow .pn`'s width in the handoff's
	// `wk.css`, and `.prow` itself is `min-height: 64px` there, at every width
	// (the row measured 64px at 390x844 too). So a phone narrows the cells and
	// leaves the row's height alone.
	await page.setViewportSize({ width: 390, height: 844 });
	await openMid(page);
	const row = page.locator(SEL.workRow);
	await expect(row).toBeVisible();
	expect(await row.evaluate((n) => getComputedStyle(n).minHeight)).toBe('64px');
	const cells = page.locator('.panel .prow.work-row .pn');
	await expect(cells).toHaveCount(2);
	expect(await cells.first().evaluate((n) => getComputedStyle(n).width)).toBe('44px');
});
