import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * the search, selecting, in a real browser.
 *
 * Generated from the design's mock, and
 * checked in deliberately. These assert the frame and the measurements — the
 * part visual review reliably misses. The numbers are hand-set in the mock and
 * do not round to a spacing ladder, so a later pass that tidies them would
 * silently redraw the screen. That is what this is here to stop; it is not
 * pedantry.
 *
 * Regenerating overwrites this file: the hand-written preamble below (its own
 * install, the selecting state, the project it runs in) and the `./fixtures`
 * import (the generator still writes `@playwright/test`) must be put
 * back (doc/LIBRARY.md, "SELECT across the search").
 */

/**
 * Kept by hand over the generator's output. The board draws a Work
 * found by its name, a tag chip and a ticked hit beside an unticked one; the
 * shared seed has no Work and no such tag, and a frame spec that wrote to the
 * shared database would change what the flow specs beside it see. So: a
 * seeded database of this file's own with a Work of two parts and a tag on
 * them, all named Zelkova, and a preview of the same build on a port from the
 * OS (never an assigned one: a frame pinned to a port races another project).
 * Drawn at the board's 1280x800, the `tablet-landscape` project's
 * own viewport; it skips itself in the other device projects. The selecting
 * state is reached through the app's own controls: SELECT on the search's bar, then
 * a tap on one part.
 */
test.use({ viewport: { width: 1280, height: 800 } });
test.beforeEach(() => {
	test.skip(test.info().project.name !== 'tablet-landscape', 'drawn at tablet landscape');
});

const dbPath = join(tmpdir(), `tsundoku-e2e-select-frame-${process.pid}.sqlite`);
const library = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-select-frame-'));
let server: ChildProcess | null = null;
let base = '';

test.beforeAll(async () => {
	if (test.info().project.name !== 'tablet-landscape') return;
	test.setTimeout(120_000);
	const port = await new Promise<number>((ok, no) => {
		const probe = createServer();
		probe.once('error', no);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => ok(port));
		});
	});
	base = `http://localhost:${port}`;
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const now = Date.now();
		const root = (db.prepare('SELECT MIN(id) AS id FROM roots').get() as { id: number }).id;
		const ids = ['Zelkova Saga: Roots', 'Zelkova Saga: Crown'].map((title) => {
			const id = Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, hue, added_at, indexed_at)
						VALUES (?, ?, 'manga', 0, ?, ?)`
					)
					.run(root, title, now, now).lastInsertRowid
			);
			db.prepare(
				`INSERT INTO entries (series_id, position, label, added_at) VALUES (?, 1, 'Ch. 1', ?)`
			).run(id, now);
			return id;
		});
		const work = Number(
			db
				.prepare(
					`INSERT INTO works (name, created_at, order_mode) VALUES ('Zelkova Saga', ?, 'hand')`
				)
				.run(now).lastInsertRowid
		);
		const tag = Number(
			db.prepare(`INSERT INTO tags (namespace, value) VALUES ('artist', 'Zelkova Hand')`).run()
				.lastInsertRowid
		);
		ids.forEach((id, i) => {
			db.prepare(`INSERT INTO work_series (work_id, series_id, position) VALUES (?, ?, ?)`).run(
				work,
				id,
				i + 1
			);
			db.prepare(`INSERT INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(id, tag);
		});
	} finally {
		db.close();
	}
	server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
		env: {
			...process.env,
			DATABASE_PATH: dbPath,
			TSUNDOKU_TOKEN: E2E_TOKEN,
			ENGINE_URL: 'http://127.0.0.1:1',
			ENGINE_TOKEN: 'e2e-engine-token',
			ENGINE_STORE: library,
			TSUNDOKU_ANILIST: 'off',
			LIBRARY_ROOT: library,
			COVER_DIR: join(library, 'covers'),
			BACKUP_DIR: join(library, 'backups')
		},
		stdio: 'ignore'
	});
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(base, { redirect: 'manual' })).status) return;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	throw new Error('the select-search frame preview never answered');
});

test.afterAll(() => {
	server?.kill();
	rmSync(dbPath, { force: true });
	rmSync(library, { recursive: true, force: true });
});

/** The board's state: the search for Zelkova, SELECT on, one part ticked. */
async function selectingSearch(page: Page) {
	await page.goto(`${base}/search?q=zelkova`);
	await page.getByRole('button', { name: 'SELECT', exact: true }).click();
	await page.getByRole('checkbox', { name: /^Zelkova Saga: Roots / }).click();
	await expect(page.locator('.sel.in-bar .selected-count')).toHaveText('1 SELECTED');
}

const SEL = {
	block: '.sel.in-bar',
	blockX: '.sel.in-bar .sel-x',
	blockCount: '.sel.in-bar .selected-count',
	blockShow: '.sel.in-bar .sel-show',
	chipsLabel: '.label.first',
	chips: '.chips',
	chip: '.chips a.chip',
	chipGo: '.chips a.chip .go',
	titlesLabel: '.label:not(.first)',
	workRow: '.hits .hit.work.tk',
	workTick: '.hits .hit.work.tk .tick',
	workBox: '.hits .hit.work.tk .box',
	workText: '.hits .hit.work.tk .text',
	workInk: '.hits .hit.work.tk .why .ink',
	tickedRow: '.hits .hit.tk.on:not(.work)',
	tickedBox: '.hits .hit.tk.on:not(.work) .box',
	tickedTitle: '.hits .hit.tk.on:not(.work) .title',
	tickedWhy: '.hits .hit.tk.on:not(.work) .why',
	plainRow: '.hits .hit.tk:not(.on):not(.work)'
};

test('the search, selecting: block matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.block)).toBeVisible();

	const blockStyle = await page.locator(SEL.block).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			borderLeftWidth: cs.borderLeftWidth
		};
	});
	expect(blockStyle.display).toBe('flex');
	expect(blockStyle.alignItems).toBe('stretch');
	expect(blockStyle.borderLeftWidth).toBe('1px');
});

test('the search, selecting: blockX matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.blockX)).toBeVisible();

	const blockXStyle = await page.locator(SEL.blockX).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			fontWeight: cs.fontWeight
		};
	});
	expect(blockXStyle.display).toBe('flex');
	expect(blockXStyle.alignItems).toBe('center');
	expect(blockXStyle.paddingRight).toBe('24px');
	expect(blockXStyle.paddingLeft).toBe('24px');
	expect(blockXStyle.fontWeight).toBe('500');
});

test('the search, selecting: blockCount matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.blockCount)).toBeVisible();

	const blockCountStyle = await page.locator(SEL.blockCount).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			borderLeftWidth: cs.borderLeftWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight
		};
	});
	expect(blockCountStyle.display).toBe('flex');
	expect(blockCountStyle.alignItems).toBe('center');
	expect(blockCountStyle.paddingRight).toBe('18px');
	expect(blockCountStyle.paddingLeft).toBe('18px');
	expect(blockCountStyle.borderLeftWidth).toBe('1px');
	expect(blockCountStyle.fontSize).toBe('17px');
	expect(blockCountStyle.fontWeight).toBe('500');
});

test('the search, selecting: blockShow matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.blockShow)).toBeVisible();

	const blockShowStyle = await page.locator(SEL.blockShow).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			borderLeftWidth: cs.borderLeftWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			lineHeight: cs.lineHeight
		};
	});
	expect(blockShowStyle.display).toBe('flex');
	expect(blockShowStyle.alignItems).toBe('center');
	expect(blockShowStyle.paddingRight).toBe('24px');
	expect(blockShowStyle.paddingLeft).toBe('24px');
	expect(blockShowStyle.borderLeftWidth).toBe('1px');
	expect(blockShowStyle.fontSize).toBe('14px');
	expect(blockShowStyle.fontWeight).toBe('500');
	expect(blockShowStyle.lineHeight).toBe('16.8px');
});

test('the search, selecting: chipsLabel matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.chipsLabel)).toBeVisible();

	const chipsLabelStyle = await page.locator(SEL.chipsLabel).evaluate((node) => {
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
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(chipsLabelStyle.display).toBe('flex');
	expect(chipsLabelStyle.justifyContent).toBe('space-between');
	expect(chipsLabelStyle.rowGap).toBe('12px');
	expect(chipsLabelStyle.columnGap).toBe('12px');
	expect(chipsLabelStyle.paddingTop).toBe('18px');
	expect(chipsLabelStyle.paddingRight).toBe('24px');
	expect(chipsLabelStyle.paddingBottom).toBe('10px');
	expect(chipsLabelStyle.paddingLeft).toBe('24px');
	expect(chipsLabelStyle.fontSize).toBe('13px');
	expect(chipsLabelStyle.fontWeight).toBe('500');
	expect(chipsLabelStyle.letterSpacing).toBe('0.78px');
	expect(chipsLabelStyle.lineHeight).toBe('15.6px');
});

test('the search, selecting: chips matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.chips)).toBeVisible();

	const chipsStyle = await page.locator(SEL.chips).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexWrap: cs.flexWrap,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft
		};
	});
	expect(chipsStyle.display).toBe('flex');
	expect(chipsStyle.flexWrap).toBe('wrap');
	expect(chipsStyle.rowGap).toBe('8px');
	expect(chipsStyle.columnGap).toBe('8px');
	expect(chipsStyle.paddingRight).toBe('24px');
	expect(chipsStyle.paddingBottom).toBe('8px');
	expect(chipsStyle.paddingLeft).toBe('24px');
});

test('the search, selecting: chip matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.chip)).toBeVisible();

	const chipStyle = await page.locator(SEL.chip).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			borderTopWidth: cs.borderTopWidth,
			borderRightWidth: cs.borderRightWidth,
			borderBottomWidth: cs.borderBottomWidth,
			borderLeftWidth: cs.borderLeftWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			lineHeight: cs.lineHeight
		};
	});
	expect(chipStyle.display).toBe('flex');
	expect(chipStyle.alignItems).toBe('center');
	expect(chipStyle.rowGap).toBe('10px');
	expect(chipStyle.columnGap).toBe('10px');
	expect(chipStyle.paddingRight).toBe('14px');
	expect(chipStyle.paddingLeft).toBe('14px');
	expect(chipStyle.borderTopWidth).toBe('1px');
	expect(chipStyle.borderRightWidth).toBe('1px');
	expect(chipStyle.borderBottomWidth).toBe('1px');
	expect(chipStyle.borderLeftWidth).toBe('1px');
	expect(chipStyle.fontSize).toBe('14px');
	expect(chipStyle.fontWeight).toBe('500');
	expect(chipStyle.lineHeight).toBe('16.8px');
});

test('the search, selecting: chipGo matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.chipGo)).toBeVisible();

	const chipGoStyle = await page.locator(SEL.chipGo).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			paddingLeft: cs.paddingLeft,
			borderLeftWidth: cs.borderLeftWidth
		};
	});
	expect(chipGoStyle.display).toBe('flex');
	expect(chipGoStyle.alignItems).toBe('center');
	expect(chipGoStyle.paddingLeft).toBe('12px');
	expect(chipGoStyle.borderLeftWidth).toBe('1px');
});

test('the search, selecting: titlesLabel matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.titlesLabel)).toBeVisible();

	const titlesLabelStyle = await page.locator(SEL.titlesLabel).evaluate((node) => {
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
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(titlesLabelStyle.display).toBe('flex');
	expect(titlesLabelStyle.justifyContent).toBe('space-between');
	expect(titlesLabelStyle.rowGap).toBe('12px');
	expect(titlesLabelStyle.columnGap).toBe('12px');
	expect(titlesLabelStyle.paddingTop).toBe('20px');
	expect(titlesLabelStyle.paddingRight).toBe('24px');
	expect(titlesLabelStyle.paddingBottom).toBe('10px');
	expect(titlesLabelStyle.paddingLeft).toBe('24px');
	expect(titlesLabelStyle.fontSize).toBe('13px');
	expect(titlesLabelStyle.fontWeight).toBe('500');
	expect(titlesLabelStyle.letterSpacing).toBe('0.78px');
	expect(titlesLabelStyle.lineHeight).toBe('15.6px');
});

test('the search, selecting: workRow matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.workRow)).toBeVisible();

	const workRowStyle = await page.locator(SEL.workRow).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			borderBottomWidth: cs.borderBottomWidth,
			minHeight: cs.minHeight
		};
	});
	expect(workRowStyle.display).toBe('flex');
	expect(workRowStyle.alignItems).toBe('center');
	expect(workRowStyle.rowGap).toBe('0px');
	expect(workRowStyle.columnGap).toBe('0px');
	expect(workRowStyle.paddingTop).toBe('10px');
	expect(workRowStyle.paddingRight).toBe('24px');
	expect(workRowStyle.paddingBottom).toBe('10px');
	expect(workRowStyle.borderBottomWidth).toBe('1px');
	expect(workRowStyle.minHeight).toBe('82px');
});

test('the search, selecting: workTick matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.workTick)).toBeVisible();

	const workTickStyle = await page.locator(SEL.workTick).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent
		};
	});
	expect(workTickStyle.display).toBe('flex');
	expect(workTickStyle.alignItems).toBe('center');
	expect(workTickStyle.justifyContent).toBe('center');
});

test('the search, selecting: workBox matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.workBox)).toBeVisible();

	const workBoxStyle = await page.locator(SEL.workBox).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			borderTopWidth: cs.borderTopWidth,
			borderRightWidth: cs.borderRightWidth,
			borderBottomWidth: cs.borderBottomWidth,
			borderLeftWidth: cs.borderLeftWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight
		};
	});
	expect(workBoxStyle.display).toBe('flex');
	expect(workBoxStyle.alignItems).toBe('center');
	expect(workBoxStyle.justifyContent).toBe('center');
	expect(workBoxStyle.borderTopWidth).toBe('1px');
	expect(workBoxStyle.borderRightWidth).toBe('1px');
	expect(workBoxStyle.borderBottomWidth).toBe('1px');
	expect(workBoxStyle.borderLeftWidth).toBe('1px');
	expect(workBoxStyle.fontSize).toBe('14px');
	expect(workBoxStyle.fontWeight).toBe('500');
});

test('the search, selecting: workText matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.workText)).toBeVisible();

	const workTextStyle = await page.locator(SEL.workText).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingRight: cs.paddingRight
		};
	});
	expect(workTextStyle.display).toBe('flex');
	expect(workTextStyle.flexDirection).toBe('column');
	expect(workTextStyle.rowGap).toBe('5px');
	expect(workTextStyle.columnGap).toBe('5px');
	expect(workTextStyle.paddingRight).toBe('24px');
});

test('the search, selecting: workInk matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.workInk)).toBeVisible();

	const workInkStyle = await page.locator(SEL.workInk).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display
		};
	});
	expect(workInkStyle.display).toBe('inline');
});

test('the search, selecting: tickedRow matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.tickedRow)).toBeVisible();

	const tickedRowStyle = await page.locator(SEL.tickedRow).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			borderBottomWidth: cs.borderBottomWidth,
			minHeight: cs.minHeight
		};
	});
	expect(tickedRowStyle.display).toBe('flex');
	expect(tickedRowStyle.alignItems).toBe('center');
	expect(tickedRowStyle.rowGap).toBe('0px');
	expect(tickedRowStyle.columnGap).toBe('0px');
	expect(tickedRowStyle.paddingTop).toBe('10px');
	expect(tickedRowStyle.paddingRight).toBe('24px');
	expect(tickedRowStyle.paddingBottom).toBe('10px');
	expect(tickedRowStyle.borderBottomWidth).toBe('1px');
	expect(tickedRowStyle.minHeight).toBe('82px');
});

test('the search, selecting: tickedBox matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.tickedBox)).toBeVisible();

	const tickedBoxStyle = await page.locator(SEL.tickedBox).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			borderTopWidth: cs.borderTopWidth,
			borderRightWidth: cs.borderRightWidth,
			borderBottomWidth: cs.borderBottomWidth,
			borderLeftWidth: cs.borderLeftWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight
		};
	});
	expect(tickedBoxStyle.display).toBe('flex');
	expect(tickedBoxStyle.alignItems).toBe('center');
	expect(tickedBoxStyle.justifyContent).toBe('center');
	expect(tickedBoxStyle.borderTopWidth).toBe('1px');
	expect(tickedBoxStyle.borderRightWidth).toBe('1px');
	expect(tickedBoxStyle.borderBottomWidth).toBe('1px');
	expect(tickedBoxStyle.borderLeftWidth).toBe('1px');
	expect(tickedBoxStyle.fontSize).toBe('14px');
	expect(tickedBoxStyle.fontWeight).toBe('500');
});

test('the search, selecting: tickedTitle matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.tickedTitle)).toBeVisible();

	const tickedTitleStyle = await page.locator(SEL.tickedTitle).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			fontWeight: cs.fontWeight,
			lineHeight: cs.lineHeight
		};
	});
	expect(tickedTitleStyle.display).toBe('block');
	expect(tickedTitleStyle.fontWeight).toBe('500');
	expect(tickedTitleStyle.lineHeight).toBe('20.8px');
});

test('the search, selecting: tickedWhy matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.tickedWhy)).toBeVisible();

	const tickedWhyStyle = await page.locator(SEL.tickedWhy).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			fontSize: cs.fontSize,
			lineHeight: cs.lineHeight
		};
	});
	expect(tickedWhyStyle.display).toBe('block');
	expect(tickedWhyStyle.fontSize).toBe('13px');
	expect(tickedWhyStyle.lineHeight).toBe('16.9px');
});

test('the search, selecting: plainRow matches the design', async ({ page }) => {
	await selectingSearch(page);
	await expect(page.locator(SEL.plainRow)).toBeVisible();

	const plainRowStyle = await page.locator(SEL.plainRow).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			borderBottomWidth: cs.borderBottomWidth,
			minHeight: cs.minHeight
		};
	});
	expect(plainRowStyle.display).toBe('flex');
	expect(plainRowStyle.alignItems).toBe('center');
	expect(plainRowStyle.rowGap).toBe('0px');
	expect(plainRowStyle.columnGap).toBe('0px');
	expect(plainRowStyle.paddingTop).toBe('10px');
	expect(plainRowStyle.paddingRight).toBe('24px');
	expect(plainRowStyle.paddingBottom).toBe('10px');
	expect(plainRowStyle.borderBottomWidth).toBe('1px');
	expect(plainRowStyle.minHeight).toBe('82px');
});
