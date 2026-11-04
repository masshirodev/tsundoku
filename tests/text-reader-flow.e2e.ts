import type { Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { sampleEpub } from '../src/lib/server/pages/sample-epub';
import { Zip } from '../src/lib/epub/unzip';
import { expect, test } from './helpers/hydrated';

/**
 * The text reader (doc/TEXT-READER.md), against the seed's generated EPUBs.
 * This file owns Honzuki no Gekokujou, a novel read to the end, so reading it
 * again moves no CONTINUE row another spec counts.
 */
const TITLE = 'Honzuki no Gekokujou';
test.describe.configure({ mode: 'serial' });
// `serveBook` stubs the whole book, `/api/series/<id>/epub`, which the service
// worker answers once it controls the page, and `page.route` never sees a
// request the worker sends: a trace of the Japanese case's failure shows the
// worker fetching the seed's English book while the files came from the stub,
// and the reader setting the English one (round 2, 1 in 34 at two workers).
// Nothing in this file reads offline; offline-flow owns that.
test.use({ serviceWorkers: 'block' });

async function openBook(page: Page) {
	await page.goto('/');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page.waitForURL(/\/series\//);
	await page
		.getByRole('link', { name: /READ AGAIN|CONTINUE|START/ })
		.first()
		.click();
	await page.waitForURL(/\/read\//);
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
}

/** The top margin: always the controls, never a word or an illustration. */
const middle = async (page: Page) => {
	const v = page.viewportSize()!;
	await page.mouse.click(v.width / 2, 30);
};
/**
 * Turn one page, and return once the reader has turned it and the page has
 * landed: the flow's transform (set to where the slide lands as it starts,
 * c441) or the chapter's heading has moved, both of which the click changes
 * at once, and the flow has stopped sliding, so what is measured next is not
 * moving. A click the reader hadn't handled
 * yet was read as "no turn" under a loaded suite, and the next click turned
 * twice, past the page the test was looking for (c394, c439). The URL is no
 * witness: the reader rewrites `?at=` 800 ms after the *previous* turn, so it
 * can move with no click at all (measured in round 2: `?at=0.0` became
 * `?at=3.0` 900 ms after a turn, nothing clicked).
 */
const forward = async (page: Page) => {
	const where = () =>
		page.evaluate(
			() =>
				`${document.querySelector('.blocks h1')?.textContent ?? ''} ${
					document.querySelector<HTMLElement>('.flow')?.style.transform ?? ''
				}`
		);
	const before = await where();
	const v = page.viewportSize()!;
	await page.mouse.click(v.width - 8, v.height / 2);
	await expect.poll(where).not.toBe(before);
	await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
};

test('a novel opens as text, turns, and carries on into the next chapter', async ({ page }) => {
	await openBook(page);
	// Vol. 1 of the sample: its heading, and the illustration it starts with.
	await expect(page.locator('.blocks h1')).toHaveText('Vol. 1');
	await expect(page.locator('figure.illus img').first()).toHaveAttribute('src', /^blob:/);
	const first = page.url();
	const report = page.waitForRequest(
		(r) => r.url().endsWith('/api/reading') && r.postDataJSON()?.kind === 'page'
	);
	// Page by page until the chapter changes: how many pages it has is the layout's business.
	for (let i = 0; i < 12 && (await page.locator('.blocks h1').textContent()) === 'Vol. 1'; i++)
		await forward(page);
	// Moving on is the reader's own business: no page load, a new URL.
	await expect(page.locator('.blocks h1')).toHaveText('Vol. 2');
	await expect(page).not.toHaveURL(first);
	// Progress is a paragraph and a character, with the chapter's size.
	const body = (await report).postDataJSON();
	expect(body).toMatchObject({ kind: 'page' });
	expect(Number.isInteger(body.offset) && body.total > 1).toBe(true);
});

test('the controls say where you are, and READING keeps your place as type changes', async ({
	page
}) => {
	await openBook(page);
	await forward(page);
	await middle(page);
	await expect(page.locator('.top .meta')).toHaveText(/^NOVEL · CH\. 1 OF 33 · \d+% OF BOOK$/);
	await expect(page.locator('.bottom .left')).toHaveText(/^P\. 2 OF \d+/);
	const at = () => page.evaluate(() => new URL(location.href).searchParams.get('at'));
	await expect.poll(at).not.toBeNull();
	const before = await at();
	await page.getByRole('button', { name: /^PAGED · SERIF/ }).click();
	await page.getByRole('button', { name: 'Larger' }).click();
	await page.getByRole('button', { name: 'Larger' }).click();
	await expect(page.getByRole('button', { name: 'Device default' })).toHaveText('22 PX');
	// The same paragraph is still on screen after the text grew.
	const [b] = before!.split('.').map(Number);
	await expect(page.locator(`[data-b="${b}"]`)).toBeInViewport();
	await page.getByRole('button', { name: 'Device default' }).click();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
});

test('the wheel turns one page a gesture, and back', async ({ page }) => {
	await openBook(page);
	const v = page.viewportSize()!;
	await page.mouse.move(v.width / 2, v.height / 2);
	// The page on screen: the chapter, and how far its flow is translated. A
	// turn off a chapter's last page opens the next one at 0.
	const at = () =>
		page.evaluate(() => {
			const flow = document.querySelector<HTMLElement>('.flow');
			const x = /translateX\((-?[\d.]+)px\)/.exec(flow?.style.transform ?? '')?.[1] ?? '0';
			return `${document.querySelector('.blocks h1')?.textContent} @ ${Number(x)}`;
		});
	const start = await at();
	// A notch, then a touchpad's inertia: still one page. Dispatched in one go,
	// so a loaded machine can't space them into gestures of their own.
	await page.evaluate(() => {
		for (const deltaY of [120, 20, 20, 20, 20, 20])
			window.dispatchEvent(new WheelEvent('wheel', { deltaY, cancelable: true }));
	});
	await expect.poll(at).not.toBe(start);
	const turned = await at();
	await page.waitForTimeout(300);
	expect(await at()).toBe(turned);
	await page.mouse.wheel(0, -120);
	await expect.poll(at).toBe(start);
});

test('CONTENTS lists the book and opens a chapter', async ({ page }) => {
	await openBook(page);
	await middle(page);
	await page.getByRole('button', { name: 'CONTENTS' }).click();
	const sheet = page.locator('.contents');
	await expect(sheet.getByText('CONTENTS', { exact: true })).toBeVisible();
	await sheet.getByRole('button', { name: /↑ 1 – / }).click();
	await sheet.locator('.entry-btn', { hasText: 'Vol. 5' }).click();
	await expect(page.locator('.blocks h1')).toHaveText('Vol. 5');
});

test('a wide block opens whole, and an illustration full screen', async ({ page }) => {
	await openBook(page);
	await page.locator('figure.illus img').first().click();
	await expect(page.getByRole('dialog', { name: 'Illustration' })).toBeVisible();
	await page.getByRole('dialog', { name: 'Illustration' }).click();
	await expect(page.getByRole('dialog', { name: 'Illustration' })).toHaveCount(0);
	// Turn until OPEN is on this page: a block on the next one is laid out,
	// and "visible" to Playwright, but translated off-screen.
	const open = page.locator('.wide.code .open');
	// `forward` returns once the turn has happened, so the box is read where
	// the turn left it (c394).
	const onScreen = async () => {
		if ((await open.count()) === 0) return false;
		const b = await open.boundingBox();
		const v = page.viewportSize()!;
		return !!b && b.x >= 0 && b.x + b.width <= v.width;
	};
	for (let i = 0; i < 8 && !(await onScreen()); i++) await forward(page);
	await expect(page.locator('.wide.code .wlabel')).toHaveText(/^LISTING · \d+ COLUMNS, \d+ SHOWN$/);
	await open.click();
	const view = page.getByRole('dialog', { name: 'Listing' });
	await expect(view.locator('pre')).toContainText('walk the import descriptors');
	await view.getByRole('button', { name: 'Close' }).click();
	await expect(view).toHaveCount(0);
});

/** Answer the reader's asks -- file by file, then whole -- from a book made here (doc/TEXT-READER.md). */
async function serveBook(page: Page, epub: Buffer) {
	const zip = new Zip(new Uint8Array(epub));
	const files = await Promise.all(
		zip.names.map(async (name) => ({ name, size: (await zip.bytesOf(name)).length }))
	);
	await page.route('**/api/series/*/epub/files?*', (r) => r.fulfill({ json: { files } }));
	// And the whole book, downloading behind the first chapter.
	await page.route('**/api/series/*/epub?*', (r) =>
		r.fulfill({ body: epub, contentType: 'application/epub+zip' })
	);
	await page.route('**/api/series/*/epub/file?*', async (r) => {
		const name = new URL(r.request().url()).searchParams.get('p') ?? '';
		if (!zip.has(name)) return r.fulfill({ status: 404, body: 'not found' });
		await r.fulfill({ body: Buffer.from(await zip.bytesOf(name)) });
	});
}

test('a Japanese book is set vertically, with furigana and upright numbers', async ({ page }) => {
	const ja = sampleEpub({
		title: TITLE,
		hue: 0,
		language: 'ja',
		chapters: Array.from({ length: 33 }, (_, i) => `第${i + 1}話`)
	});
	await serveBook(page, ja);
	await openBook(page);
	await expect(page.locator('.flow')).toHaveCSS('writing-mode', 'vertical-rl');
	await expect(page.locator('.blocks rt').first()).toHaveText('ぼうし');
	await expect(page.locator('.blocks .tcy', { hasText: /^12$/ }).first()).toBeAttached();
	// Right to left: the left strip turns forward, onto the chapter's first page of text.
	const shift = () =>
		page
			.locator('.flow')
			.evaluate((el: HTMLElement) => /translate([XY])\((-?[\d.]+)px\)/.exec(el.style.transform));
	await page.mouse.click(8, page.viewportSize()!.height / 2);
	await expect(page.locator('.bottom')).toHaveCount(0);
	// It slid on the vertical text's own axis: the page went up (c441).
	await expect.poll(async () => (await shift())?.[1]).toBe('Y');
	await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
	const turned = Number((await shift())![2]);
	expect(turned).toBeLessThan(0);
	// A drag to the right pulls the next page in, so the page follows it up,
	// and lifted short of the swipe it comes back down.
	const v = page.viewportSize()!;
	await page.mouse.move(v.width / 2, v.height / 2);
	await page.mouse.down();
	await page.mouse.move(v.width / 2 + 24, v.height / 2, { steps: 4 });
	expect(Number((await shift())![2])).toBeLessThan(turned);
	await page.mouse.up();
	await expect.poll(async () => Number((await shift())![2])).toBe(turned);
	await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
	await middle(page);
	await expect(page.locator('.bottom .left')).toHaveText(/^P\. 2 OF /);
	await expect(page.getByRole('button', { name: /^VERTICAL · SANS JP/ })).toBeVisible();
});

test('a file that is not an EPUB says so, and offers the way back', async ({ page }) => {
	await page.route('**/api/series/*/epub/files?*', (r) =>
		r.fulfill({ status: 422, json: { message: 'NOT A ZIP' } })
	);
	await page.goto('/');
	await page.locator('.grid .tile', { hasText: TITLE }).click();
	await page
		.getByRole('link', { name: /READ AGAIN|CONTINUE|START/ })
		.first()
		.click();
	await expect(page.getByText('DID NOT OPEN')).toBeVisible({ timeout: 15000 });
	await expect(page.getByText(/^BROKEN EPUB · /)).toBeVisible();
	await expect(page.getByRole('link', { name: '← SERIES' })).toBeVisible();
});

// ---- SCROLL across a volume's end (c347) ------------------------------------------------
//
// A novel grouped from two books is one download per volume (doc/TEXT-READER.md,
// "Opening"). The shared seed has none, and grouping writes, so this block seeds a
// database of its own, groups two of its novels through GROUP as volumes-flow does,
// and serves the build on a port the OS gives. Nothing it writes reaches another spec.

test.describe('a novel of two volumes, read in SCROLL (c347)', () => {
	// Made in beforeAll, not at load: `playwright test --list` loads this file too.
	let work = '';
	let preview: ChildProcess | null = null;
	let base = '';

	function freePort(): Promise<number> {
		return new Promise((ok) => {
			const s = createServer();
			s.listen(0, '127.0.0.1', () => {
				const port = (s.address() as AddressInfo).port;
				s.close(() => ok(port));
			});
		});
	}

	test.beforeAll(async () => {
		work = mkdtempSync(
			join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-text-volumes-')
		);
		const dbPath = join(work, 'text-volumes.sqlite');
		const library = join(work, 'library');
		execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
			env: { ...process.env, DATABASE_PATH: dbPath, LIBRARY_ROOT: library, NODE_NO_WARNINGS: '1' },
			stdio: 'pipe'
		});
		const port = await freePort();
		base = `http://localhost:${port}`;
		preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				LIBRARY_ROOT: library,
				TSUNDOKU_HOME: join(work, 'home'),
				BACKUP_DIR: join(work, 'backups'),
				TSUNDOKU_ANILIST: 'off'
			},
			stdio: 'ignore'
		});
		for (let i = 0; i < 120; i++) {
			try {
				if ((await fetch(`${base}/`, { redirect: 'manual' })).status) return;
			} catch {
				await new Promise((r) => setTimeout(r, 500));
			}
		}
		throw new Error('the two-volume preview never answered');
	});

	test.afterAll(() => {
		preview?.kill();
		if (work) rmSync(work, { recursive: true, force: true });
	});

	test('scrolling past the band opens the next volume, as a turn does in PAGED', async ({
		page
	}) => {
		test.setTimeout(120_000);
		// Two Isekai: Tensei Shitara Ken Deshita's 15 volumes, then Villainess Level 99's.
		await page.goto(`${base}/?shelf=k:novel&sort=title`);
		await page.getByRole('button', { name: 'SELECT', exact: true }).click();
		for (const t of ['Tensei Shitara Ken Deshita', 'Villainess Level 99'])
			await page.locator('.grid .tile', { hasText: t }).click();
		await page.getByRole('button', { name: /GROUP/ }).click();
		const sheet = page.getByRole('dialog', { name: 'Group into a series' });
		await sheet.getByRole('textbox', { name: 'Series name' }).fill('Two Isekai');
		await sheet.getByRole('button', { name: 'BY TITLE' }).click();
		await sheet.getByRole('button', { name: /CREATE SERIES · 2 VOLUMES/ }).click();
		await expect(page).toHaveURL(/\/series\/\d+\?created=2/);

		// The first volume's last chapter, read in SCROLL (session state: nothing stored).
		const list = page.getByRole('region', { name: 'Contents' });
		await list.getByText('Vol. 15', { exact: true }).first().click();
		await page.waitForURL(/\/read\//);
		const heading = page.locator('.blocks:not(.next) h1').first();
		await expect(heading).toHaveText('Vol. 15', { timeout: 15_000 });
		await middle(page);
		await page.getByRole('button', { name: /^PAGED · / }).click();
		await page.getByRole('radio', { name: 'SCROLL' }).click();
		await page.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
		// The band promises the next chapter, the other book's first.
		const band = page.locator('.sband');
		await expect(band.getByText('↓ KEEP SCROLLING')).toBeVisible();
		await expect(band.locator('.nx .t')).toHaveText('Vol. 1');

		// Scroll on, as a reader does, until the heading moves or 80 notches pass.
		const files: string[] = [];
		page.on('request', (r) => {
			if (/\/epub\/files\?v=.*&f=/.test(r.url())) files.push(r.url());
		});
		const v = page.viewportSize()!;
		await page.mouse.move(v.width / 2, v.height / 2);
		for (let i = 0; i < 80 && (await heading.textContent()) === 'Vol. 15'; i++) {
			await page.mouse.wheel(0, 400);
			await page.waitForTimeout(60);
		}
		// Villainess' own Vol. 1, opened from its own file at its top.
		await expect(heading).toHaveText('Vol. 1', { timeout: 15_000 });
		expect(files.length).toBeGreaterThan(0);
		await expect(heading).toBeInViewport();
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
	});
});
