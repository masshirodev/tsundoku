import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';
import { startPreview } from './highlights-preview';

/**
 * The highlights page's frame (the desktop at 1440 with the sidebar, the list
 * by day, a quote open with its paragraph, the disk line).
 *
 * The frame assertions below are the conformance generator's output
 * from the design, checked in deliberately: the numbers are hand-set in the
 * mock and do not round to a spacing ladder, so a later pass that tidies
 * them would silently redraw the screen. Extracted at 1440x2400.
 *
 * Hand edits after generation, which regenerating drops (doc/HIGHLIGHTS.md,
 * "The frame"): the generator writes `import { expect, test } from
 * '@playwright/test'`, changed to `./fixtures`
 * as every new e2e file takes it; and this preamble, because the
 * shared seed has no highlights: it seeds a database of its own with one
 * highlight per kind and serves the build on a port the OS gives it
 * (`listen(0)`, as tests/highlights-flow.e2e.ts does), never
 * `PLAYWRIGHT_WORKS_PORT`: the works frames serve on that one, and in a full
 * run their project and this file's `desktop` start at the same time, so a
 * shared port is a race the loser loses against the other file's server and
 * database. The readiness poll fails as soon as its own preview exits, so a
 * lost port is a clear error, never a run against someone else's server. The
 * design is the desktop's, so it runs in the desktop project and skips itself
 * in the others; its DEVICE_IGNORE line is a gap for e2e's
 * playwright.config.ts.
 */
const PORT = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once('error', reject);
	probe.listen(0, '127.0.0.1', () => {
		const { port } = probe.address() as AddressInfo;
		probe.close(() => resolve(port));
	});
});
const base = `http://localhost:${PORT}`;
const scratch = join(tmpdir(), `tsundoku-e2e-highlights-frame-${process.pid}`);
const dbPath = join(scratch, 'library.sqlite');
let server: ChildProcess | null = null;
/** The quote the frame draws open. */
let openId = 0;

test.use({ baseURL: base, viewport: { width: 1440, height: 960 } });
test.describe.configure({ mode: 'serial' });

test.beforeEach(() => {
	test.skip(
		test.info().project.name !== 'desktop',
		'P1 is the desktop’s board, beside the sidebar'
	);
});

test.beforeAll(async () => {
	if (test.info().project.name !== 'desktop') return;
	test.setTimeout(90_000);
	rmSync(scratch, { recursive: true, force: true });
	mkdirSync(scratch, { recursive: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const novel = db.prepare(`SELECT id FROM series WHERE title = 'Mushoku Tensei'`).get() as {
			id: number;
		};
		const entry = db
			.prepare(
				`SELECT id, label FROM entries WHERE series_id = ? ORDER BY position LIMIT 1 OFFSET 2`
			)
			.get(novel.id) as { id: number; label: string };
		const put = db.prepare(
			`INSERT INTO highlights (kind, series_id, entry_id, number, block, block_offset, page, clip_in,
				clip_out, series_title, series_kind, entry_label, quote, paragraph, context, colour, note, made_at)
			VALUES (?, ?, ?, 3, 3, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const now = Date.now();
		put.run(
			'clip',
			null,
			null,
			null,
			724,
			816,
			'Toudai no Mukou',
			'anime',
			'Ep. 7',
			'',
			'',
			'',
			null,
			'',
			now
		);
		openId = Number(
			put.run(
				'quote',
				novel.id,
				entry.id,
				null,
				null,
				null,
				'Mushoku Tensei',
				'novel',
				entry.label,
				'Nothing is only anything',
				'“Nothing is only anything,” she said.',
				'“It’s only a lamp.”',
				'yellow',
				'Her mother’s line.',
				now - 1000
			).lastInsertRowid
		);
		put.run(
			'page',
			null,
			null,
			13,
			null,
			null,
			'Kaze no Tou',
			'manga',
			'Ch. 42',
			'',
			'',
			'',
			null,
			'',
			now - 86_400_000
		);
	} finally {
		db.close();
	}
	server = await startPreview(
		() =>
			spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
				env: {
					...process.env,
					DATABASE_PATH: dbPath,
					TSUNDOKU_TOKEN: E2E_TOKEN,
					TSUNDOKU_ANILIST: 'off',
					LIBRARY_ROOT: join(scratch, 'library'),
					TSUNDOKU_HOME: join(scratch, 'home')
				},
				stdio: 'ignore'
			}),
		base,
		'the highlights frame preview'
	);
});

test.afterAll(() => {
	server?.kill();
	server = null;
	rmSync(scratch, { recursive: true, force: true });
});

/** The frame: the list, and the quote open beside it. */
const p1 = () => `/highlights?open=${openId}`;

const SEL = {
	column: '.hl-page',
	bar: '.hl-page > header.bar',
	title: 'header.bar .title',
	search: 'header.bar .search',
	order: 'header.bar .order',
	chips: '.chips',
	chip: '.chips .chip >> nth=0',
	body: '.hl-page > .body',
	list: '.body > .list',
	day: '.list .lbl.day >> nth=0',
	box: '.list .box >> nth=0',
	row: '.list a.hl >> nth=0',
	open: 'aside.open',
	openHead: 'aside.open > .sh',
	paragraph: 'aside.open .tr',
	options: 'aside.open .opts',
	swatch: 'aside.open .sw >> nth=0',
	openFoot: 'aside.open > .bar.b',
	disk: 'footer.disk'
};

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: column matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.column)).toBeVisible();

	const columnStyle = await page.locator(SEL.column).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection
		};
	});
	expect(columnStyle.display).toBe('flex');
	expect(columnStyle.flexDirection).toBe('column');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: bar matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.bar)).toBeVisible();

	const barStyle = await page.locator(SEL.bar).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			borderBottomWidth: cs.borderBottomWidth
		};
	});
	expect(barStyle.display).toBe('flex');
	expect(barStyle.alignItems).toBe('stretch');
	expect(barStyle.borderBottomWidth).toBe('1px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: title matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.title)).toBeVisible();

	const titleStyle = await page.locator(SEL.title).evaluate((node) => {
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
	expect(titleStyle.display).toBe('flex');
	expect(titleStyle.flexDirection).toBe('column');
	expect(titleStyle.alignItems).toBe('flex-start');
	expect(titleStyle.justifyContent).toBe('center');
	expect(titleStyle.rowGap).toBe('6px');
	expect(titleStyle.columnGap).toBe('6px');
	expect(titleStyle.paddingRight).toBe('18px');
	expect(titleStyle.paddingLeft).toBe('18px');
	expect(titleStyle.fontSize).toBe('13px');
	expect(titleStyle.fontWeight).toBe('500');
	expect(titleStyle.letterSpacing).toBe('0.78px');
	expect(titleStyle.lineHeight).toBe('13px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: search matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.search)).toBeVisible();

	const searchStyle = await page.locator(SEL.search).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			justifyContent: cs.justifyContent,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			borderLeftWidth: cs.borderLeftWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(searchStyle.display).toBe('flex');
	expect(searchStyle.alignItems).toBe('center');
	expect(searchStyle.justifyContent).toBe('flex-start');
	expect(searchStyle.paddingTop).toBe('0px');
	expect(searchStyle.paddingRight).toBe('0px');
	expect(searchStyle.paddingBottom).toBe('0px');
	expect(searchStyle.paddingLeft).toBe('0px');
	expect(searchStyle.borderLeftWidth).toBe('1px');
	expect(searchStyle.fontSize).toBe('13px');
	expect(searchStyle.fontWeight).toBe('500');
	expect(searchStyle.letterSpacing).toBe('0.78px');
	expect(searchStyle.lineHeight).toBe('13px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: order matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.order)).toBeVisible();

	const orderStyle = await page.locator(SEL.order).evaluate((node) => {
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
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(orderStyle.display).toBe('flex');
	expect(orderStyle.alignItems).toBe('center');
	expect(orderStyle.justifyContent).toBe('center');
	expect(orderStyle.paddingRight).toBe('18px');
	expect(orderStyle.paddingLeft).toBe('18px');
	expect(orderStyle.borderLeftWidth).toBe('1px');
	expect(orderStyle.fontSize).toBe('13px');
	expect(orderStyle.fontWeight).toBe('500');
	expect(orderStyle.letterSpacing).toBe('0.78px');
	expect(orderStyle.lineHeight).toBe('13px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: chips matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.chips)).toBeVisible();

	const chipsStyle = await page.locator(SEL.chips).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexWrap: cs.flexWrap,
			alignItems: cs.alignItems,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			borderBottomWidth: cs.borderBottomWidth
		};
	});
	expect(chipsStyle.display).toBe('flex');
	expect(chipsStyle.flexWrap).toBe('wrap');
	expect(chipsStyle.alignItems).toBe('center');
	expect(chipsStyle.rowGap).toBe('8px');
	expect(chipsStyle.columnGap).toBe('8px');
	expect(chipsStyle.paddingTop).toBe('12px');
	expect(chipsStyle.paddingRight).toBe('24px');
	expect(chipsStyle.paddingBottom).toBe('12px');
	expect(chipsStyle.paddingLeft).toBe('24px');
	expect(chipsStyle.borderBottomWidth).toBe('1px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: chip matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.chip)).toBeVisible();

	const chipStyle = await page.locator(SEL.chip).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			paddingRight: cs.paddingRight,
			paddingLeft: cs.paddingLeft,
			borderTopWidth: cs.borderTopWidth,
			borderRightWidth: cs.borderRightWidth,
			borderBottomWidth: cs.borderBottomWidth,
			borderLeftWidth: cs.borderLeftWidth,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(chipStyle.display).toBe('flex');
	expect(chipStyle.alignItems).toBe('center');
	expect(chipStyle.paddingRight).toBe('12px');
	expect(chipStyle.paddingLeft).toBe('12px');
	expect(chipStyle.borderTopWidth).toBe('1px');
	expect(chipStyle.borderRightWidth).toBe('1px');
	expect(chipStyle.borderBottomWidth).toBe('1px');
	expect(chipStyle.borderLeftWidth).toBe('1px');
	expect(chipStyle.fontSize).toBe('12px');
	expect(chipStyle.fontWeight).toBe('500');
	expect(chipStyle.letterSpacing).toBe('0.72px');
	expect(chipStyle.lineHeight).toBe('12px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: body matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.body)).toBeVisible();

	const bodyStyle = await page.locator(SEL.body).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			minHeight: cs.minHeight
		};
	});
	expect(bodyStyle.display).toBe('flex');
	expect(bodyStyle.minHeight).toBe('0px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: list matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.list)).toBeVisible();

	const listStyle = await page.locator(SEL.list).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			borderRightWidth: cs.borderRightWidth
		};
	});
	expect(listStyle.display).toBe('block');
	expect(listStyle.paddingTop).toBe('0px');
	expect(listStyle.paddingRight).toBe('24px');
	expect(listStyle.paddingBottom).toBe('0px');
	expect(listStyle.paddingLeft).toBe('24px');
	expect(listStyle.borderRightWidth).toBe('1px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: day matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.day)).toBeVisible();

	const dayStyle = await page.locator(SEL.day).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
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
	expect(dayStyle.display).toBe('block');
	expect(dayStyle.paddingTop).toBe('18px');
	expect(dayStyle.paddingRight).toBe('0px');
	expect(dayStyle.paddingBottom).toBe('10px');
	expect(dayStyle.paddingLeft).toBe('0px');
	expect(dayStyle.fontSize).toBe('12px');
	expect(dayStyle.fontWeight).toBe('500');
	expect(dayStyle.letterSpacing).toBe('0.72px');
	expect(dayStyle.lineHeight).toBe('14.4px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: box matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.box)).toBeVisible();

	const boxStyle = await page.locator(SEL.box).evaluate((node) => {
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
	expect(boxStyle.display).toBe('flex');
	expect(boxStyle.flexDirection).toBe('column');
	expect(boxStyle.borderTopWidth).toBe('1px');
	expect(boxStyle.borderRightWidth).toBe('1px');
	expect(boxStyle.borderBottomWidth).toBe('1px');
	expect(boxStyle.borderLeftWidth).toBe('1px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: row matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.row)).toBeVisible();

	const rowStyle = await page.locator(SEL.row).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft
		};
	});
	expect(rowStyle.display).toBe('flex');
	expect(rowStyle.alignItems).toBe('flex-start');
	expect(rowStyle.rowGap).toBe('16px');
	expect(rowStyle.columnGap).toBe('16px');
	expect(rowStyle.paddingTop).toBe('16px');
	expect(rowStyle.paddingRight).toBe('16px');
	expect(rowStyle.paddingBottom).toBe('16px');
	expect(rowStyle.paddingLeft).toBe('16px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: open matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.open)).toBeVisible();

	const openStyle = await page.locator(SEL.open).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection
		};
	});
	expect(openStyle.display).toBe('flex');
	expect(openStyle.flexDirection).toBe('column');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: openHead matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.openHead)).toBeVisible();

	const openHeadStyle = await page.locator(SEL.openHead).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			borderBottomWidth: cs.borderBottomWidth
		};
	});
	expect(openHeadStyle.display).toBe('flex');
	expect(openHeadStyle.alignItems).toBe('stretch');
	expect(openHeadStyle.borderBottomWidth).toBe('1px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: paragraph matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.paragraph)).toBeVisible();

	const paragraphStyle = await page.locator(SEL.paragraph).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			borderBottomWidth: cs.borderBottomWidth,
			fontSize: cs.fontSize,
			lineHeight: cs.lineHeight
		};
	});
	expect(paragraphStyle.display).toBe('block');
	expect(paragraphStyle.paddingTop).toBe('24px');
	expect(paragraphStyle.paddingRight).toBe('28px');
	expect(paragraphStyle.paddingBottom).toBe('24px');
	expect(paragraphStyle.paddingLeft).toBe('28px');
	expect(paragraphStyle.borderBottomWidth).toBe('1px');
	expect(paragraphStyle.fontSize).toBe('18px');
	expect(paragraphStyle.lineHeight).toBe('29.16px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: options matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.options)).toBeVisible();

	const optionsStyle = await page.locator(SEL.options).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			flexDirection: cs.flexDirection,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft
		};
	});
	expect(optionsStyle.display).toBe('flex');
	expect(optionsStyle.flexDirection).toBe('column');
	expect(optionsStyle.rowGap).toBe('14px');
	expect(optionsStyle.columnGap).toBe('14px');
	expect(optionsStyle.paddingTop).toBe('20px');
	expect(optionsStyle.paddingRight).toBe('28px');
	expect(optionsStyle.paddingBottom).toBe('20px');
	expect(optionsStyle.paddingLeft).toBe('28px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: swatch matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.swatch)).toBeVisible();

	const swatchStyle = await page.locator(SEL.swatch).evaluate((node) => {
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
			fontWeight: cs.fontWeight,
			lineHeight: cs.lineHeight
		};
	});
	expect(swatchStyle.display).toBe('flex');
	expect(swatchStyle.alignItems).toBe('center');
	expect(swatchStyle.justifyContent).toBe('center');
	expect(swatchStyle.borderTopWidth).toBe('1px');
	expect(swatchStyle.borderRightWidth).toBe('1px');
	expect(swatchStyle.borderBottomWidth).toBe('1px');
	expect(swatchStyle.borderLeftWidth).toBe('1px');
	expect(swatchStyle.fontSize).toBe('14px');
	expect(swatchStyle.fontWeight).toBe('500');
	expect(swatchStyle.lineHeight).toBe('14px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: openFoot matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.openFoot)).toBeVisible();

	const openFootStyle = await page.locator(SEL.openFoot).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			borderTopWidth: cs.borderTopWidth
		};
	});
	expect(openFootStyle.display).toBe('flex');
	expect(openFootStyle.alignItems).toBe('stretch');
	expect(openFootStyle.borderTopWidth).toBe('1px');
});

test('/HIGHLIGHTS · DESKTOP 1440 WITH THE SIDEBAR, PHONE 390 — Every highlight, newest first: disk matches the design', async ({
	page
}) => {
	await page.goto(p1());
	await expect(page.locator(SEL.disk)).toBeVisible();

	const diskStyle = await page.locator(SEL.disk).evaluate((node) => {
		const cs = getComputedStyle(node);
		return {
			display: cs.display,
			alignItems: cs.alignItems,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			paddingTop: cs.paddingTop,
			paddingRight: cs.paddingRight,
			paddingBottom: cs.paddingBottom,
			paddingLeft: cs.paddingLeft,
			borderTopWidth: cs.borderTopWidth,
			fontSize: cs.fontSize,
			letterSpacing: cs.letterSpacing,
			lineHeight: cs.lineHeight
		};
	});
	expect(diskStyle.display).toBe('flex');
	expect(diskStyle.alignItems).toBe('center');
	expect(diskStyle.rowGap).toBe('18px');
	expect(diskStyle.columnGap).toBe('18px');
	expect(diskStyle.paddingTop).toBe('0px');
	expect(diskStyle.paddingRight).toBe('24px');
	expect(diskStyle.paddingBottom).toBe('0px');
	expect(diskStyle.paddingLeft).toBe('24px');
	expect(diskStyle.borderTopWidth).toBe('1px');
	expect(diskStyle.fontSize).toBe('12px');
	expect(diskStyle.letterSpacing).toBe('0.48px');
	expect(diskStyle.lineHeight).toBe('15.6px');
});
