import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import Database from 'better-sqlite3';
// Hand-edited (as every frame file is): `./fixtures`' `test`,
// whose `page.goto` waits for hydration, where the generator writes
// '@playwright/test'.
import { expect, readerReady, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';
import { startPreview } from './highlights-preview';

/**
 * MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page, in a real browser.
 *
 * Generated from the design's mock, and
 * checked in deliberately. These assert the frame and the measurements — the
 * part visual review reliably misses. The numbers are hand-set in the mock and
 * do not round to a spacing ladder, so a later pass that tidies them would
 * silently redraw the screen. That is what this is here to stop; it is not
 * pedantry.
 *
 * Regenerating overwrites this file. Hand edits belong in a sibling spec.
 */

/*
 * Hand-written below this line and above the first case, and dropped by
 * a regeneration: the generator writes a bare `page.goto('/')`, where these
 * states (a kept page's sheet, a spread's choice) exist only inside the
 * reader, after a page is kept. So the file seeds a database of its own and
 * serves the build on a port the OS gives it (`startPreview`, as the
 * highlights flow files do; never an assigned port), and each case opens its
 * state in place of the generator's goto.
 *
 * The regions are the design's app UI, picked by hand in the map
 * (temp/design/manga-map.json, written by the generator's `--init`, whose
 * own regions are the board's presentation sections): the kept page's sheet
 * and the spread's chooser. The cell is not here: it is the reader's own cell, as
 * its neighbours draw it (doc/HIGHLIGHTS.md, "Where it departs").
 *
 * The chooser is drawn on the tablet's landscape board (spreads are
 * landscape only), so the file runs in `tablet-landscape` and skips itself in
 * the other projects; the sheet's measurements do not depend on the width.
 */
test.describe.configure({ mode: 'serial', timeout: 60_000 });
test.beforeEach(() => {
	test.skip(test.info().project.name !== 'tablet-landscape', 'drawn at the tablet’s landscape');
});

const PORT = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once('error', reject);
	probe.listen(0, '127.0.0.1', () => {
		const { port } = probe.address() as AddressInfo;
		probe.close(() => resolve(port));
	});
});
const base = `http://localhost:${PORT}`;
const scratch = join(tmpdir(), `tsundoku-e2e-highlights-manga-frame-${process.pid}`);
const dbPath = join(scratch, 'library.sqlite');
let server: ChildProcess | null = null;
test.use({ baseURL: base, serviceWorkers: 'block' });

test.beforeAll(async () => {
	if (test.info().project.name !== 'tablet-landscape') return;
	test.setTimeout(120_000);
	rmSync(scratch, { recursive: true, force: true });
	mkdirSync(scratch, { recursive: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	server = await startPreview(
		() =>
			spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
				env: {
					...process.env,
					DATABASE_PATH: dbPath,
					TSUNDOKU_TOKEN: E2E_TOKEN,
					TSUNDOKU_ANILIST: 'off',
					LIBRARY_ROOT: join(scratch, 'library'),
					TRASH_DIR: join(scratch, 'trash'),
					TSUNDOKU_HOME: join(scratch, 'home')
				},
				stdio: 'ignore'
			}),
		base,
		'the manga highlights frame preview'
	);
});

test.afterAll(() => {
	server?.kill();
	server = null;
	rmSync(scratch, { recursive: true, force: true });
});

function entryOf(title: string): number {
	const db = new Database(dbPath, { readonly: true });
	try {
		return (
			db
				.prepare(
					`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id WHERE s.title = ?
					ORDER BY e.position LIMIT 1`
				)
				.get(title) as { id: number }
		).id;
	} finally {
		db.close();
	}
}

/** The reader at `p`, its controls up, spreads on. */
async function reader(page: Page, p: number) {
	await page.addInitScript(() => localStorage.setItem('tsundoku.reader.spreads', 'true'));
	await page.goto(`/read/${entryOf('Dungeon Meshi')}?p=${p}`);
	await readerReady(page);
	await page.waitForLoadState('networkidle');
	const banner = page.getByRole('banner', { name: 'Reader' });
	await expect(async () => {
		if (!(await banner.count())) await page.keyboard.press('Escape');
		await expect(banner).toBeVisible({ timeout: 1_000 });
	}).toPass();
	return page.locator('footer[aria-label="Reader controls"] .cell.hl');
}

/** The cover kept (it stands alone in a spread reader), and its sheet open. */
async function openSheet(page: Page) {
	const cell = await reader(page, 1);
	if ((await cell.innerText()) === 'HIGHLIGHT') {
		await cell.click();
		await expect(cell).toHaveText('✓ HIGHLIGHTED');
	}
	await cell.click();
	const sheet = page.getByRole('dialog', { name: 'Highlight' });
	await expect(sheet).toBeVisible();
	await sheet.evaluate((el) =>
		Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)))
	);
}

/** A spread's HIGHLIGHT, asking which. */
async function openChoices(page: Page) {
	const cell = await reader(page, 4);
	await expect(page.locator('.stage .screen:not([aria-hidden]) [data-page]')).toHaveCount(2);
	await cell.click();
	await expect(page.getByRole('dialog', { name: 'Highlight which page' })).toBeVisible();
}

const SEL = {
	sheet: 'div[role="dialog"][aria-label="Highlight"]',
	sheetHead: 'div[role="dialog"][aria-label="Highlight"] > .head',
	sheetTitle: 'div[role="dialog"][aria-label="Highlight"] .h',
	sheetClose: 'div[role="dialog"][aria-label="Highlight"] .x',
	sheetBody: 'div[role="dialog"][aria-label="Highlight"] > .body',
	sheetThumb: 'div[role="dialog"][aria-label="Highlight"] .thumb',
	sheetNote: 'div[role="dialog"][aria-label="Highlight"] textarea',
	sheetMade: 'div[role="dialog"][aria-label="Highlight"] > .made',
	sheetFoot: 'div[role="dialog"][aria-label="Highlight"] > .foot',
	sheetSave: 'div[role="dialog"][aria-label="Highlight"] .foot > .act:first-child',
	sheetDelete: 'div[role="dialog"][aria-label="Highlight"] .foot > .act.del',
	choices: 'div[role="dialog"][aria-label="Highlight which page"]',
	choicesHead: 'div[role="dialog"][aria-label="Highlight which page"] > .ch-h',
	choiceFirst: 'div[role="dialog"][aria-label="Highlight which page"] > .ch:nth-of-type(1)',
	choiceBoth: 'div[role="dialog"][aria-label="Highlight which page"] > .ch:last-child'
};

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: sheet matches the design', async ({
	page
}) => {
	await openSheet(page);
	await expect(page.locator(SEL.sheet)).toBeVisible();

	const sheetStyle = await page.locator(SEL.sheet).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection,
			borderTopWidth: cs.borderTopWidth
		};
	});
	expect(sheetStyle.display).toBe('flex');
	expect(sheetStyle.flexDirection).toBe('column');
	expect(sheetStyle.borderTopWidth).toBe('1px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: sheetHead matches the design', async ({
	page
}) => {
	await openSheet(page);
	await expect(page.locator(SEL.sheetHead)).toBeVisible();

	const sheetHeadStyle = await page.locator(SEL.sheetHead).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			borderBottomWidth: cs.borderBottomWidth
		};
	});
	expect(sheetHeadStyle.display).toBe('flex');
	expect(sheetHeadStyle.alignItems).toBe('stretch');
	expect(sheetHeadStyle.borderBottomWidth).toBe('1px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: sheetTitle matches the design', async ({
	page
}) => {
	await openSheet(page);
	await expect(page.locator(SEL.sheetTitle)).toBeVisible();

	const sheetTitleStyle = await page.locator(SEL.sheetTitle).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(sheetTitleStyle.display).toBe('flex');
	expect(sheetTitleStyle.alignItems).toBe('center');
	expect(sheetTitleStyle.paddingRight).toBe('20px');
	expect(sheetTitleStyle.paddingLeft).toBe('20px');
	expect(sheetTitleStyle.fontSize).toBe('12px');
	expect(sheetTitleStyle.fontWeight).toBe('500');
	expect(sheetTitleStyle.letterSpacing).toBe('0.72px');
	expect(sheetTitleStyle.lineHeight).toBe('14.4px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: sheetClose matches the design', async ({
	page
}) => {
	await openSheet(page);
	await expect(page.locator(SEL.sheetClose)).toBeVisible();

	const sheetCloseStyle = await page.locator(SEL.sheetClose).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			borderLeftWidth: cs.borderLeftWidth,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(sheetCloseStyle.display).toBe('flex');
	expect(sheetCloseStyle.alignItems).toBe('center');
	expect(sheetCloseStyle.justifyContent).toBe('center');
	expect(sheetCloseStyle.paddingRight).toBe('18px');
	expect(sheetCloseStyle.paddingLeft).toBe('18px');
	expect(sheetCloseStyle.borderLeftWidth).toBe('1px');
	expect(sheetCloseStyle.fontWeight).toBe('500');
	expect(sheetCloseStyle.letterSpacing).toBe('0.96px');
	expect(sheetCloseStyle.lineHeight).toBe('16px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: sheetBody matches the design', async ({
	page
}) => {
	await openSheet(page);
	await expect(page.locator(SEL.sheetBody)).toBeVisible();

	const sheetBodyStyle = await page.locator(SEL.sheetBody).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft
		};
	});
	expect(sheetBodyStyle.display).toBe('flex');
	expect(sheetBodyStyle.rowGap).toBe('16px');
	expect(sheetBodyStyle.columnGap).toBe('16px');
	expect(sheetBodyStyle.paddingTop).toBe('18px');
	expect(sheetBodyStyle.paddingRight).toBe('20px');
	expect(sheetBodyStyle.paddingBottom).toBe('18px');
	expect(sheetBodyStyle.paddingLeft).toBe('20px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: sheetThumb matches the design', async ({
	page
}) => {
	await openSheet(page);
	await expect(page.locator(SEL.sheetThumb)).toBeVisible();

	const sheetThumbStyle = await page.locator(SEL.sheetThumb).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display
		};
	});
	expect(sheetThumbStyle.display).toBe('block');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: sheetNote matches the design', async ({
	page
}) => {
	await openSheet(page);
	await expect(page.locator(SEL.sheetNote)).toBeVisible();

	const sheetNoteStyle = await page.locator(SEL.sheetNote).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			borderTopWidth: cs.borderTopWidth,
			borderRightWidth: cs.borderRightWidth,
			borderBottomWidth: cs.borderBottomWidth,
			borderLeftWidth: cs.borderLeftWidth,
			lineHeight: cs.lineHeight,
			minHeight: cs.minHeight
		};
	});
	expect(sheetNoteStyle.display).toBe('block');
	expect(sheetNoteStyle.paddingTop).toBe('12px');
	expect(sheetNoteStyle.paddingRight).toBe('14px');
	expect(sheetNoteStyle.paddingBottom).toBe('12px');
	expect(sheetNoteStyle.paddingLeft).toBe('14px');
	expect(sheetNoteStyle.borderTopWidth).toBe('1px');
	expect(sheetNoteStyle.borderRightWidth).toBe('1px');
	expect(sheetNoteStyle.borderBottomWidth).toBe('1px');
	expect(sheetNoteStyle.borderLeftWidth).toBe('1px');
	expect(sheetNoteStyle.lineHeight).toBe('24px');
	expect(sheetNoteStyle.minHeight).toBe('76px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: sheetMade matches the design', async ({
	page
}) => {
	await openSheet(page);
	await expect(page.locator(SEL.sheetMade)).toBeVisible();

	const sheetMadeStyle = await page.locator(SEL.sheetMade).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			fontSize: cs.fontSize,
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(sheetMadeStyle.display).toBe('block');
	expect(sheetMadeStyle.paddingTop).toBe('0px');
	expect(sheetMadeStyle.paddingRight).toBe('20px');
	expect(sheetMadeStyle.paddingBottom).toBe('14px');
	expect(sheetMadeStyle.paddingLeft).toBe('20px');
	expect(sheetMadeStyle.fontSize).toBe('12px');
	expect(sheetMadeStyle.letterSpacing).toBe('0.48px');
	expect(sheetMadeStyle.lineHeight).toBe('15.6px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: sheetFoot matches the design', async ({
	page
}) => {
	await openSheet(page);
	await expect(page.locator(SEL.sheetFoot)).toBeVisible();

	const sheetFootStyle = await page.locator(SEL.sheetFoot).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			borderTopWidth: cs.borderTopWidth
		};
	});
	expect(sheetFootStyle.display).toBe('flex');
	expect(sheetFootStyle.alignItems).toBe('stretch');
	expect(sheetFootStyle.borderTopWidth).toBe('1px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: sheetSave matches the design', async ({
	page
}) => {
	await openSheet(page);
	await expect(page.locator(SEL.sheetSave)).toBeVisible();

	const sheetSaveStyle = await page.locator(SEL.sheetSave).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(sheetSaveStyle.display).toBe('flex');
	expect(sheetSaveStyle.flexDirection).toBe('column');
	expect(sheetSaveStyle.alignItems).toBe('flex-start');
	expect(sheetSaveStyle.justifyContent).toBe('center');
	expect(sheetSaveStyle.rowGap).toBe('6px');
	expect(sheetSaveStyle.columnGap).toBe('6px');
	expect(sheetSaveStyle.paddingRight).toBe('18px');
	expect(sheetSaveStyle.paddingLeft).toBe('18px');
	expect(sheetSaveStyle.fontSize).toBe('13px');
	expect(sheetSaveStyle.fontWeight).toBe('500');
	expect(sheetSaveStyle.letterSpacing).toBe('0.78px');
	expect(sheetSaveStyle.lineHeight).toBe('13px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: sheetDelete matches the design', async ({
	page
}) => {
	await openSheet(page);
	await expect(page.locator(SEL.sheetDelete)).toBeVisible();

	const sheetDeleteStyle = await page.locator(SEL.sheetDelete).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			borderLeftWidth: cs.borderLeftWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(sheetDeleteStyle.display).toBe('flex');
	expect(sheetDeleteStyle.flexDirection).toBe('column');
	expect(sheetDeleteStyle.alignItems).toBe('flex-start');
	expect(sheetDeleteStyle.justifyContent).toBe('center');
	expect(sheetDeleteStyle.rowGap).toBe('6px');
	expect(sheetDeleteStyle.columnGap).toBe('6px');
	expect(sheetDeleteStyle.paddingRight).toBe('18px');
	expect(sheetDeleteStyle.paddingLeft).toBe('18px');
	expect(sheetDeleteStyle.borderLeftWidth).toBe('1px');
	expect(sheetDeleteStyle.fontSize).toBe('13px');
	expect(sheetDeleteStyle.fontWeight).toBe('500');
	expect(sheetDeleteStyle.letterSpacing).toBe('0.78px');
	expect(sheetDeleteStyle.lineHeight).toBe('13px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: choices matches the design', async ({
	page
}) => {
	await openChoices(page);
	await expect(page.locator(SEL.choices)).toBeVisible();

	const choicesStyle = await page.locator(SEL.choices).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			borderTopWidth: cs.borderTopWidth,
			borderRightWidth: cs.borderRightWidth,
			borderBottomWidth: cs.borderBottomWidth,
			borderLeftWidth: cs.borderLeftWidth
		};
	});
	expect(choicesStyle.display).toBe('block');
	expect(choicesStyle.borderTopWidth).toBe('1px');
	expect(choicesStyle.borderRightWidth).toBe('1px');
	expect(choicesStyle.borderBottomWidth).toBe('1px');
	expect(choicesStyle.borderLeftWidth).toBe('1px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: choicesHead matches the design', async ({
	page
}) => {
	await openChoices(page);
	await expect(page.locator(SEL.choicesHead)).toBeVisible();

	const choicesHeadStyle = await page.locator(SEL.choicesHead).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			borderBottomWidth: cs.borderBottomWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(choicesHeadStyle.display).toBe('block');
	expect(choicesHeadStyle.paddingTop).toBe('14px');
	expect(choicesHeadStyle.paddingRight).toBe('16px');
	expect(choicesHeadStyle.paddingBottom).toBe('14px');
	expect(choicesHeadStyle.paddingLeft).toBe('16px');
	expect(choicesHeadStyle.borderBottomWidth).toBe('1px');
	expect(choicesHeadStyle.fontSize).toBe('12px');
	expect(choicesHeadStyle.fontWeight).toBe('500');
	expect(choicesHeadStyle.letterSpacing).toBe('0.72px');
	expect(choicesHeadStyle.lineHeight).toBe('14.4px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: choiceFirst matches the design', async ({
	page
}) => {
	await openChoices(page);
	await expect(page.locator(SEL.choiceFirst)).toBeVisible();

	const choiceFirstStyle = await page.locator(SEL.choiceFirst).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			borderBottomWidth: cs.borderBottomWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(choiceFirstStyle.display).toBe('flex');
	expect(choiceFirstStyle.alignItems).toBe('center');
	expect(choiceFirstStyle.justifyContent).toBe('space-between');
	expect(choiceFirstStyle.paddingTop).toBe('0px');
	expect(choiceFirstStyle.paddingRight).toBe('16px');
	expect(choiceFirstStyle.paddingBottom).toBe('0px');
	expect(choiceFirstStyle.paddingLeft).toBe('16px');
	expect(choiceFirstStyle.borderBottomWidth).toBe('1px');
	expect(choiceFirstStyle.fontSize).toBe('13px');
	expect(choiceFirstStyle.fontWeight).toBe('500');
	expect(choiceFirstStyle.letterSpacing).toBe('0.78px'); // authored 0.06em
	expect(choiceFirstStyle.lineHeight).toBe('13px');
});

test('MANGA, MANHWA, COMICS · THE IMAGE READER · PHONE 390, TABLET 1280 — A whole page, as a favourite page: choiceBoth matches the design', async ({
	page
}) => {
	await openChoices(page);
	await expect(page.locator(SEL.choiceBoth)).toBeVisible();

	const choiceBothStyle = await page.locator(SEL.choiceBoth).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
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
	expect(choiceBothStyle.display).toBe('flex');
	expect(choiceBothStyle.alignItems).toBe('center');
	expect(choiceBothStyle.justifyContent).toBe('space-between');
	expect(choiceBothStyle.paddingTop).toBe('0px');
	expect(choiceBothStyle.paddingRight).toBe('16px');
	expect(choiceBothStyle.paddingBottom).toBe('0px');
	expect(choiceBothStyle.paddingLeft).toBe('16px');
	expect(choiceBothStyle.fontSize).toBe('13px');
	expect(choiceBothStyle.fontWeight).toBe('500');
	expect(choiceBothStyle.letterSpacing).toBe('0.78px'); // authored 0.06em
	expect(choiceBothStyle.lineHeight).toBe('13px');
});
