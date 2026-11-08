import type { Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { sampleEpub } from '../src/lib/server/pages/sample-epub';
import { Zip } from '../src/lib/epub/unzip';
import { zip } from '../src/lib/server/zip-write';
import { drawnFonts } from './helpers/fonts';
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

test('left at once, the text reader never writes its ?at= onto the series it went back to (c565)', async ({
	page
}) => {
	await openBook(page);
	// The series slower to answer than the reader's 800 ms settle (see the
	// image reader's case in reader-flow): the timer used to fire while BACK's
	// load was out and write /read/<id>?at= onto the series' entry.
	await page.route('**/series/*/__data.json*', async (route) => {
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});
	// A page turned just before leaving: its settle is still to come as BACK
	// starts, whenever the book's first one fired.
	await forward(page);
	await middle(page);
	await page.getByRole('link', { name: 'Back to the series' }).click();
	await expect(page.getByRole('link', { name: /READ AGAIN|CONTINUE|START/ }).first()).toBeVisible();
	await expect(page).toHaveURL(/\/series\/\d+(\?|$)/);
	await page.unroute('**/series/*/__data.json*');
	await page.reload();
	await expect(page).toHaveURL(/\/series\/\d+(\?|$)/);
	await page.goBack();
	await expect(page).not.toHaveURL(/\/read\//);
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

/** How many pages the open chapter's flow lays out to, from the flow itself. */
const pagesNow = (page: Page) =>
	page.locator('.flow').evaluate((el: HTMLElement) => {
		const box = el.parentElement!;
		const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
		return Math.round((el.scrollWidth + gap) / (box.clientWidth + gap));
	});

/** Whether OpenDyslexic is declared on the page at all, and whether a face of it has loaded. */
const dyslexic = (page: Page) =>
	page.evaluate(() => {
		const faces = [...document.fonts].filter(
			(f) => f.family.replace(/["']/g, '') === 'OpenDyslexic'
		);
		return { declared: faces.length > 0, loaded: faces.some((f) => f.status === 'loaded') };
	});

test('FONT offers OpenDyslexic, loads it only once chosen, keeps it, and lays the pages out again (c442)', async ({
	page
}) => {
	await openBook(page);
	// Nothing of it until it is asked for: the bundle's face costs nothing to a Plex reader.
	expect(await dyslexic(page)).toEqual({ declared: false, loaded: false });
	const before = await pagesNow(page);

	await middle(page);
	await page.getByRole('button', { name: /^PAGED · SERIF/ }).click();
	const choice = page.getByRole('radiogroup', { name: 'FONT' }).getByRole('radio', {
		name: 'OpenDyslexic'
	});
	// Each name is drawn in its own font.
	await expect(choice).toHaveCSS('font-family', /^"?OpenDyslexic"?,/);
	await choice.click();
	await expect(choice).toHaveAttribute('aria-checked', 'true');
	await expect(page.locator('.flow')).toHaveCSS(
		'font-family',
		/^"?OpenDyslexic"?, "IBM Plex Sans JP"/
	);
	await expect.poll(() => dyslexic(page)).toEqual({ declared: true, loaded: true });
	expect(await page.evaluate(() => document.fonts.check('20px OpenDyslexic'))).toBe(true);
	// The wider face makes more pages, and the reader counted them again.
	await expect.poll(() => pagesNow(page)).toBeGreaterThan(before);
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.getByRole('button', { name: /^PAGED · DYSLEXIC/ })).toBeVisible();

	// Kept on the device: a reload opens in it, and fetches it again.
	await page.reload();
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
	await expect(page.locator('.flow')).toHaveCSS('font-family', /^"?OpenDyslexic"?,/);
	await expect.poll(() => dyslexic(page)).toEqual({ declared: true, loaded: true });

	// A FONT this build doesn't know (a newer build's) is the default, never an
	// empty font-family; the rest of the stored settings stay.
	await page.evaluate(() => {
		const k = 'tsundoku.text.settings';
		const s = JSON.parse(localStorage.getItem(k) ?? '{}');
		localStorage.setItem(k, JSON.stringify({ ...s, font: 'literata', theme: 'paper' }));
	});
	await page.reload();
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
	await expect(page.locator('.flow')).toHaveCSS(
		'font-family',
		/^"IBM Plex Serif", "IBM Plex Sans JP"/
	);
	await expect(page.locator('.text-reader')).toHaveClass(/paper/);
	await middle(page);
	await expect(page.getByRole('button', { name: /^PAGED · SERIF \d+ · PAPER/ })).toBeVisible();
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

/**
 * DIRECTION (c440): R→L, remembered for the series, read again after a reload,
 * and doing nothing in SCROLL. It writes `series.text_direction` for this
 * file's own series, and puts it back (REMEMBER L→R stores NULL, the default)
 * however the case ends, through the same action the sheet posts to.
 */
test('DIRECTION R→L is remembered for the series, survives a reload, and leaves SCROLL alone (c440)', async ({
	page
}) => {
	await openBook(page);
	const entry = /\/read\/(\d+)/.exec(page.url())![1];
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	try {
		await middle(page);
		await page.getByRole('button', { name: /^PAGED · / }).click();
		await expect(sheet.getByText('SERIES DEFAULT L→R')).toBeVisible();
		await sheet.getByRole('radio', { name: 'R→L' }).click();
		const saved = page.waitForResponse(
			(r) => r.url().includes('?/textDirection') && r.request().method() === 'POST'
		);
		await sheet.getByRole('button', { name: 'REMEMBER R→L' }).click();
		expect((await saved).status()).toBe(200);
		await expect(sheet.getByText('SERIES DEFAULT R→L')).toBeVisible();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();

		// Again after a reload: the series reads R→L, and a tap on the left
		// strip reads on, sliding the page right.
		await page.reload();
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		await expect(page.locator('.flow')).toHaveClass(/\brtl\b/);
		const at = () =>
			page
				.locator('.flow')
				.evaluate((el: HTMLElement) =>
					Number(/translateX\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 0)
				);
		const before = await at();
		const v = page.viewportSize()!;
		await page.touchscreen.tap(8, v.height / 2);
		await expect.poll(at).toBeGreaterThan(before);
		await expect(page.locator('.flow')).not.toHaveClass(/sliding/);

		// SCROLL: the row is dimmed and says why, the columns run as always, and
		// a tap at the left edge is no turn.
		await middle(page);
		await page.getByRole('button', { name: /^PAGED R→L · / }).click();
		await sheet.getByRole('radio', { name: 'SCROLL' }).click();
		await expect(sheet.getByRole('radio', { name: 'R→L' })).toBeDisabled();
		await expect(sheet.getByText('PAGED ONLY')).toBeVisible();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
		await expect(page.locator('.flow')).not.toHaveClass(/\brtl\b/);
		await page.locator('.page').evaluate((n) => (n.scrollTop = 0));
		await page.touchscreen.tap(8, v.height / 2);
		await page.waitForTimeout(300);
		expect(await page.locator('.page').evaluate((n) => n.scrollTop)).toBe(0);
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
	} finally {
		// Put the series back: NULL, the default.
		await page.evaluate(async (entry) => {
			const body = new FormData();
			body.set('direction', 'ltr');
			await fetch(`/read/${entry}?/textDirection`, {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
		}, entry);
	}
	await page.reload();
	await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
	await expect(page.locator('.flow')).not.toHaveClass(/\brtl\b/);
});

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
	// The kana and kanji are drawn in Plex Sans JP itself, from the woff2-only
	// faces of fonts-plex.css (c537), not a system font the stack fell to.
	await expect(page.locator('.blocks p').first()).toHaveCSS('font-family', /IBM Plex Sans JP/);
	await expect
		.poll(async () =>
			(await drawnFonts(page, '.blocks p'))
				.filter((f) => f.isCustomFont && f.glyphCount > 0)
				.map((f) => f.familyName)
		)
		.toContain('IBM Plex Sans JP');
	// Right to left: the left strip turns forward. The chapter opens on the
	// band at its start (c705), alone on its page because the cover after it
	// is a page wide, so this turn is onto the cover.
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
	// DIRECTION is a horizontal book's (c440): vertical text reads R→L, and the row says so.
	await page.getByRole('button', { name: /^VERTICAL · SANS JP/ }).click();
	const sheet = page.getByRole('dialog', { name: 'Reading settings' });
	await expect(sheet.getByRole('radio', { name: 'R→L' })).toHaveAttribute('aria-checked', 'true');
	await expect(sheet.getByRole('radio', { name: 'R→L' })).toBeDisabled();
	await expect(sheet.getByRole('radio', { name: 'L→R' })).toBeDisabled();
	await expect(sheet.getByText('VERTICAL TEXT READS R→L')).toBeVisible();
	await expect(page.locator('.flow')).not.toHaveClass(/\brtl\b/);
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

test('in SCROLL, a face arriving mid-scroll leaves the reader where they scrolled to', async ({
	page
}) => {
	await openBook(page);
	await middle(page);
	await page.getByRole('button', { name: /^PAGED · / }).click();
	await page.getByRole('radio', { name: 'SCROLL' }).click();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
	const top = () => page.locator('.page').evaluate((n) => n.scrollTop);
	// The reader's place is read 250 ms after a scroll stops; a relayout before
	// then (here `loadingdone`, which a late face fires, c441) once took the
	// reader back to the place they had scrolled away from (work-end-frame's
	// SCROLL end page never opened). Halfway down: far from where it opened.
	const at = await page.locator('.page').evaluate((n) => {
		n.scrollTop = Math.round((n.scrollHeight - n.clientHeight) / 2);
		n.dispatchEvent(new Event('scroll'));
		document.fonts.dispatchEvent(new Event('loadingdone'));
		return n.scrollTop;
	});
	expect(at).toBeGreaterThan(0);
	await page.waitForTimeout(400);
	expect(Math.abs((await top()) - at)).toBeLessThanOrEqual(1);
});

test('in SCROLL, a relayout after the reader settles leaves the line where it stood (c516)', async ({
	page
}) => {
	await openBook(page);
	await middle(page);
	await page.getByRole('button', { name: /^PAGED · / }).click();
	await page.getByRole('radio', { name: 'SCROLL' }).click();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
	const top = () => page.locator('.page').evaluate((n) => n.scrollTop);
	// Somewhere a line is cut by the top margin, as a hand leaves it: not on a
	// line's edge, which a relayout to the margin would have kept by luck.
	for (const at of [0.4, 0.6]) {
		await page.locator('.page').evaluate((n, at) => {
			const lh = parseFloat(getComputedStyle(n.querySelector('.flow p')!).lineHeight) || 32;
			n.scrollTop = Math.round((n.scrollHeight - n.clientHeight) * at) + Math.round(lh / 2);
			n.dispatchEvent(new Event('scroll'));
		}, at);
		// The place is read 250 ms after the scroll stops; the URL follows.
		await page.waitForTimeout(600);
		const settled = await top();
		await page.evaluate(() => window.dispatchEvent(new Event('load')));
		await page.waitForTimeout(400);
		// Until c516 the line was put on the top margin: up to a line back.
		expect(Math.abs((await top()) - settled)).toBeLessThanOrEqual(1);
		// The saved place (in the URL 800 ms after it is read) is a character on
		// the screen, not the start of its paragraph a screen higher.
		const shown = () =>
			page.evaluate(() => {
				const at = new URL(location.href).searchParams.get('at');
				if (!at) return false;
				const [b, o] = at.split('.').map(Number);
				const block = document.querySelector<HTMLElement>(`.blocks [data-b="${b}"]`);
				if (!block) return false;
				const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
				let left = o;
				for (let t = walk.nextNode(); t; t = walk.nextNode()) {
					const len = t.textContent?.length ?? 0;
					if (left < len) {
						const r = document.createRange();
						r.setStart(t, left);
						r.setEnd(t, left + 1);
						const box = document.querySelector('.page')!.getBoundingClientRect();
						const c = r.getBoundingClientRect();
						return c.top >= box.top - 1 && c.bottom <= box.bottom + 1;
					}
					left -= len;
				}
				return false;
			});
		await expect.poll(shown).toBe(true);
	}
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

	// In this block because a reload opens the series' own LAYOUT, so SCROLL
	// must be REMEMBERed, a write the shared seed cannot take back (REMEMBER
	// stores a layout; nothing stores the default, NULL, again).
	test('in SCROLL, a reload keeps the line where it stood, at any WIDTH, and an older ?at= opens on the margin (c554)', async ({
		page
	}) => {
		test.setTimeout(120_000);
		await page.goto(`${base}/?sort=title`);
		await page.locator('.grid .tile', { hasText: TITLE }).click();
		await page.waitForURL(/\/series\//);
		await page
			.getByRole('link', { name: /READ AGAIN|CONTINUE|START/ })
			.first()
			.click();
		await page.waitForURL(/\/read\//);
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await middle(page);
		await page.getByRole('button', { name: /^PAGED · / }).click();
		await sheet.getByRole('radio', { name: 'SCROLL' }).click();
		const saved = page.waitForResponse(
			(r) => r.url().includes('?/direction') && r.request().method() === 'POST'
		);
		await sheet.getByRole('button', { name: 'REMEMBER SCROLL' }).click();
		expect((await saved).status()).toBe(200);
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);

		const top = () => page.locator('.page').evaluate((n) => n.scrollTop);
		const at = () => new URL(page.url()).searchParams.get('at') ?? '';
		/** After a reload: the book open, its faces drawn, scrollTop held still. */
		const reloaded = async () => {
			await page.reload();
			await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
			await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
			await page.evaluate(() => document.fonts.ready);
		};
		// The URL settled on where SCROLL opened (800 ms after the place), so the
		// change awaited below is the scroll's, not the layout switch's.
		let opened = '';
		await expect
			.poll(
				() => {
					const now = at();
					const same = now !== '' && now === opened;
					opened = now;
					return same;
				},
				{ intervals: [1000] }
			)
			.toBe(true);
		// A line cut by the top margin, as a hand leaves it (on a line's edge the
		// margin would have been right by luck): the second line of a paragraph
		// mid-chapter with text above it, not an illustration. With the plate
		// between the margin and the first line, a WIDTH change in the session
		// itself kept the line 194 px off 1 run in 3 (reader notes, wave 25).
		await page.locator('.page').evaluate((n) => {
			// The first such paragraph of three lines or more: one further down can
			// bring the next chapter's start past the middle, which opens it at its top.
			const lh = parseFloat(getComputedStyle(n.querySelector('.flow p')!).lineHeight) || 32;
			const p = [...n.querySelectorAll<HTMLElement>('.blocks:not(.next) > p')].find(
				(p) => p.previousElementSibling?.tagName === 'P' && p.offsetHeight >= lh * 3 - 1
			)!;
			const margin = parseFloat(getComputedStyle(n.querySelector('.flow')!).paddingTop);
			n.scrollTop += Math.round(
				p.getBoundingClientRect().top - n.getBoundingClientRect().top - margin + lh * 1.5
			);
			n.dispatchEvent(new Event('scroll'));
		});
		// The place is read 250 ms after the scroll stops, and the URL keeps it
		// 800 ms after that.
		await expect.poll(at).not.toBe(opened);
		const settled = await top();
		// Somewhere mid-chapter, not its top: the case reads a place a reload could miss.
		expect(settled).toBeGreaterThan(0);
		await reloaded();
		await expect.poll(async () => Math.abs((await top()) - settled)).toBeLessThanOrEqual(1);
		// It could because the URL carries the line's height too (`b.o.y`).
		const place = at();
		expect(place).toMatch(/^\d+\.\d+\.-?\d+$/);

		// WIDTH changed, then a reload: the relayout put the line back at its
		// height, and the reload at the new width puts it there again.
		const measure = () =>
			page.locator('.blocks:not(.next)').evaluate((n: HTMLElement) => n.clientWidth);
		const wide = await measure();
		await middle(page);
		await page.getByRole('button', { name: /^SCROLL · / }).click();
		await sheet
			.getByRole('radiogroup', { name: 'Width' })
			.getByRole('radio', { name: '65%', exact: true })
			.click();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		// Laid out at 65%, then held still: what the relayout kept.
		await expect.poll(measure).toBeLessThan(wide);
		let still = -1;
		await expect
			.poll(
				async () => {
					const now = await top();
					const same = now === still;
					still = now;
					return same;
				},
				{ intervals: [300] }
			)
			.toBe(true);
		expect(at()).toBe(place);
		await reloaded();
		await expect.poll(async () => Math.abs((await top()) - still)).toBeLessThanOrEqual(1);

		// A link from before c554, `?at=b.o`: its character on the top margin, as it did.
		const [b, o] = place.split('.');
		const url = new URL(page.url());
		url.searchParams.set('at', `${b}.${o}`);
		await page.goto(url.toString());
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		await page.evaluate(() => document.fonts.ready);
		const fromMargin = () =>
			page.evaluate(
				([b, o]) => {
					const pageEl = document.querySelector<HTMLElement>('.page')!;
					const margin = parseFloat(getComputedStyle(pageEl.querySelector('.flow')!).paddingTop);
					const block = document.querySelector(`.blocks [data-b="${b}"]`)!;
					const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
					let left = Number(o);
					for (let t = walk.nextNode(); t; t = walk.nextNode()) {
						const n = t.textContent?.length ?? 0;
						if (left < n) {
							const r = document.createRange();
							r.setStart(t, left);
							r.setEnd(t, left + 1);
							return r.getBoundingClientRect().top - pageEl.getBoundingClientRect().top - margin;
						}
						left -= n;
					}
					return NaN;
				},
				[b, o]
			);
		await expect.poll(async () => Math.abs(await fromMargin())).toBeLessThanOrEqual(1);
	});

	/**
	 * Read on through the chapters (c565, round 2): the text reader moves
	 * between chapters in place and writes `/read/<next id>` with
	 * `replaceState`, which leaves SvelteKit's `page.url` at the entry it was
	 * opened at. A guard that compared the two read every settle after the
	 * first one in the second chapter as leaving, so `?at=` froze there and no
	 * more progress was sent. Each chapter here is checked by its own entry: the
	 * window names it, `?at=` moves, a `page` event carries it, and a reload
	 * opens it, not the first chapter crossed into.
	 */
	type Sent = { entryId: number; kind: string };
	function watchReading(page: Page) {
		const sent: Sent[] = [];
		page.on('request', (r) => {
			if (r.url().endsWith('/api/reading') && r.method() === 'POST') {
				const body = r.postDataJSON() as Sent | null;
				if (body) sent.push(body);
			}
		});
		return sent;
	}
	/** Open Honzuki in this block's own library, by the series screen's own door. */
	async function openOwnBook(page: Page) {
		await page.goto(`${base}/?sort=title`);
		await page.locator('.grid .tile', { hasText: TITLE }).click();
		await page.waitForURL(/\/series\//);
		await page
			.getByRole('link', { name: /READ AGAIN|CONTINUE|START/ })
			.first()
			.click();
		await page.waitForURL(/\/read\//);
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
	}
	/**
	 * Move on until `heading` reads `title`, then check the window caught up:
	 * the entry the reader opened for it (its `open` event) is the URL's, with
	 * a place (entry and `?at=`) other than `before`, and a `page` event named it.
	 */
	async function readInto(
		page: Page,
		sent: Sent[],
		heading: ReturnType<Page['locator']>,
		title: string,
		step: () => Promise<void>,
		before: string
	) {
		for (let i = 0; i < 80 && (await heading.textContent()) !== title; i++) await step();
		await expect(heading).toHaveText(title, { timeout: 15_000 });
		await expect.poll(() => sent.filter((b) => b.kind === 'open').length).toBeGreaterThan(0);
		const id = sent.filter((b) => b.kind === 'open').at(-1)!.entryId;
		await expect.poll(() => new URL(page.url()).pathname).toBe(`/read/${id}`);
		await expect.poll(() => placeOf(page)).not.toBe(before);
		await expect.poll(() => sent.some((b) => b.kind === 'page' && b.entryId === id)).toBe(true);
		return id;
	}
	/** The window's place: the entry and its `?at=` (two chapters' tops are both `0.0`). */
	const placeOf = (page: Page) => {
		const u = new URL(page.url());
		return `${u.pathname}?at=${u.searchParams.get('at') ?? ''}`;
	};
	/** `?at=` alone, which the reader keeps 800 ms after it settles on a place. */
	const atOf = (page: Page) => new URL(page.url()).searchParams.get('at') ?? '';
	/** The place the reader has settled on, once its 800 ms write is behind it. */
	async function settledAt(page: Page) {
		let last = '';
		await expect
			.poll(
				() => {
					const now = atOf(page);
					const same = now !== '' && now === last;
					last = now;
					return same;
				},
				{ intervals: [1000], timeout: 15_000 }
			)
			.toBe(true);
		return atOf(page);
	}
	const continueLink = (page: Page) =>
		page.getByRole('link', { name: /READ AGAIN|CONTINUE|START/ }).first();

	// After c554's case, which REMEMBERed SCROLL for this book: PAGED is set for
	// the session, and the reload opens in SCROLL, which reads the same entry.
	test('in PAGED, read on into a third chapter: the URL and progress follow every chapter, and a reload opens the last (c565, round 2)', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const sent = watchReading(page);
		await openOwnBook(page);
		await middle(page);
		await page.getByRole('button', { name: /^SCROLL · / }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await sheet.getByRole('radio', { name: 'PAGED' }).click();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).not.toHaveClass(/scroll/);
		const heading = page.locator('.blocks h1');
		const n = Number(((await heading.textContent()) ?? '').replace(/\D/g, ''));
		const step = () => forward(page);
		const first = await readInto(page, sent, heading, `Vol. ${n + 1}`, step, placeOf(page));
		const second = await readInto(page, sent, heading, `Vol. ${n + 2}`, step, placeOf(page));
		expect(second).not.toBe(first);
		// A page further on: its settle is written too, wherever it landed.
		const before = placeOf(page);
		const count = sent.length;
		await forward(page);
		await expect.poll(() => placeOf(page)).not.toBe(before);
		await expect
			.poll(() => sent.slice(count).some((b) => b.kind === 'page' && b.entryId !== first))
			.toBe(true);
		const last = sent.filter((b) => b.kind === 'open').at(-1)!.entryId;
		await expect.poll(() => new URL(page.url()).pathname).toBe(`/read/${last}`);
		await page.reload();
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		expect(new URL(page.url()).pathname).toBe(`/read/${last}`);
		const opened = page.locator('.blocks:not(.next) h1').first();
		if (last === second) await expect(opened).toHaveText(`Vol. ${n + 2}`);
		else await expect(opened).not.toHaveText(`Vol. ${n + 1}`);
	});

	// An invalidation gives `page.url` a new object for the entry the reader was
	// opened at, which isn't a navigation: the place must go on following the
	// chapters (wave 25's r2). The app does it for real, here by a newer theme.
	test('an invalidation partway through leaves the URL and progress following the chapters', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const sent = watchReading(page);
		await openOwnBook(page);
		await middle(page);
		await page.getByRole('button', { name: /^SCROLL · / }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await sheet.getByRole('radio', { name: 'PAGED' }).click();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).not.toHaveClass(/scroll/);
		const heading = page.locator('.blocks h1');
		const n = Number(((await heading.textContent()) ?? '').replace(/\D/g, ''));
		const step = () => forward(page);
		await readInto(page, sent, heading, `Vol. ${n + 1}`, step, placeOf(page));

		await page.route('**/api/devices/sync', (r) =>
			r.fulfill({ json: { newer: { 'tsundoku.theme': { v: 'light', at: Date.now() } } } })
		);
		const reloaded = page.waitForResponse((r) => r.url().includes('__data.json'));
		await page.evaluate(() => window.dispatchEvent(new Event('online')));
		await reloaded;
		await page.unroute('**/api/devices/sync');

		const second = await readInto(page, sent, heading, `Vol. ${n + 2}`, step, placeOf(page));
		await page.reload();
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		expect(new URL(page.url()).pathname).toBe(`/read/${second}`);
	});

	// After c554's case, which REMEMBERed SCROLL for this book, so a reload opens in SCROLL.
	test('in SCROLL, read on into a third chapter: the URL and progress follow every chapter, and a reload opens the last (c565, round 2)', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const sent = watchReading(page);
		await openOwnBook(page);
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
		const heading = page.locator('.blocks:not(.next) h1').first();
		const start = (await heading.textContent()) ?? '';
		const n = Number(start.replace(/\D/g, ''));
		const v = page.viewportSize()!;
		await page.mouse.move(v.width / 2, v.height / 2);
		const step = async () => {
			await page.mouse.wheel(0, 400);
			await page.waitForTimeout(60);
		};
		const first = await readInto(page, sent, heading, `Vol. ${n + 1}`, step, placeOf(page));
		const second = await readInto(page, sent, heading, `Vol. ${n + 2}`, step, placeOf(page));
		expect(second).not.toBe(first);
		await page.reload();
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
		expect(new URL(page.url()).pathname).toBe(`/read/${second}`);
		await expect(heading).toHaveText(`Vol. ${n + 2}`);
	});

	// c623: a chapter moving in place is written with `replaceState`, whose
	// history entry keeps the URL of the last real navigation: a popstate into
	// it (BACK from the series, then forward) loaded the chapter the reader was
	// opened at, not the one it read on to.
	test('history into the reader entry after an in-place chapter move opens the chapter read on to, at its place (c623)', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const sent = watchReading(page);
		await openOwnBook(page);
		await middle(page);
		await page.getByRole('button', { name: /^(PAGED|SCROLL) · / }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await sheet.getByRole('radio', { name: 'PAGED' }).click();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).not.toHaveClass(/scroll/);
		const heading = page.locator('.blocks:not(.next) h1').first();
		const n = Number(((await heading.textContent()) ?? '').replace(/\D/g, ''));
		const step = () => forward(page);
		await readInto(page, sent, heading, `Vol. ${n + 1}`, step, placeOf(page));
		await readInto(page, sent, heading, `Vol. ${n + 2}`, step, placeOf(page));
		// A place further into the third chapter, so the entry's URL is not its
		// top either. Larger type and half the page, as in c622: one paged turn
		// in a seed chapter's single page would reach its end and mark it read.
		await middle(page);
		await page.getByRole('button', { name: /^(PAGED|SCROLL) · / }).click();
		const reading = page.getByRole('dialog', { name: 'Reading settings' });
		await reading.getByRole('radio', { name: 'PAGED' }).click();
		for (let i = 0; i < 14; i++) {
			const larger = reading.getByRole('button', { name: 'Larger' });
			if (await larger.isDisabled()) break;
			await larger.click();
		}
		await reading
			.getByRole('radiogroup', { name: 'Width' })
			.getByRole('radio', { name: '50%', exact: true })
			.click();
		await reading.getByRole('button', { name: 'Close', exact: true }).click();
		expect(await pagesNow(page)).toBeGreaterThan(2);
		const before = await settledAt(page);
		await forward(page);
		await expect.poll(() => atOf(page), { timeout: 10_000 }).not.toBe(before);
		const place = atOf(page);
		expect(place).not.toBe('0.0');
		const third = Number(new URL(page.url()).pathname.split('/').pop());

		// To the series by the reader's own link (which goes back in history),
		// and back into the reader entry by history's forward.
		await middle(page);
		await page.getByRole('link', { name: 'Back to the series' }).click();
		await expect(continueLink(page)).toBeVisible();
		await page.goForward();
		await page.waitForURL(/\/read\//);
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		// The screen, not the address bar: a popstate that loads another chapter
		// leaves `location` naming the entry's own URL while the data loaded is
		// the stored one, so on the old code the window said the third chapter
		// and the page drew the first.
		await expect(page.locator('.blocks:not(.next) h1').first()).toHaveText(`Vol. ${n + 2}`);
		await expect
			.poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
			.toBe(`/read/${third}`);
		await expect.poll(() => atOf(page), { timeout: 10_000 }).toBe(place);
	});

	// c655: a rated series lost its rating block on the end page, leaving only
	// the name in the middle (the block was drawn only while `rating === 0`).
	// The text reader's last volume ends on the shared EndPage, so this is that
	// page, reached by the reader's own doors.
	test("a novel's end page keeps its rating block and offers the library row (c655)", async ({
		page
	}) => {
		test.setTimeout(120_000);
		await openOwnBook(page);
		await middle(page);
		const seriesHref = await page
			.getByRole('link', { name: 'Back to the series' })
			.getAttribute('href');
		const seriesId = Number(seriesHref!.match(/\/series\/(\d+)/)![1]);
		// PAGED, so the last page has a scrubber and one turn past it is the
		// end page's door (in SCROLL that is a scroll, not a click).
		await page.getByRole('button', { name: /^(PAGED|SCROLL) · / }).click();
		const sheet = page.getByRole('dialog', { name: 'Reading settings' });
		await sheet.getByRole('radio', { name: 'PAGED' }).click();
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).not.toHaveClass(/scroll/);
		await middle(page);
		await page.getByRole('button', { name: 'CONTENTS' }).click();
		await page.locator('.contents .entry-btn').last().click();
		await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
		// A chapter opened from CONTENTS puts the controls away, and they fade
		// out: the scrubber measured then was gone by the click, which landed on
		// the page as a turn, one page on and short of the end (red 3 of 3 in
		// wave 31, and on its base). So: the controls up again, on purpose.
		await expect(page.locator('.bottom')).toHaveCount(0);
		await middle(page);
		const track = page.locator('[role="slider"][aria-label="Page in chapter"]');
		await expect(track).toBeVisible();
		const box = (await track.boundingBox())!;
		await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
		await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
		// On the chapter's last page, then the controls away (a tap on the page
		// with them up only puts them away), so the next tap is a turn.
		await expect(page.locator('.bottom .left')).toHaveText(/^P\. (\d+) OF \1\b/);
		await page.keyboard.press('Escape');
		await expect(page.locator('.bottom')).toHaveCount(0);
		// One turn past the last page is the end page's door (a turn that stays
		// on the same heading, which is why `forward` is not the helper here).
		const v = page.viewportSize()!;
		await page.mouse.click(v.width - 8, v.height / 2);
		const end = page.locator('[data-end-page]');
		await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();
		await expect(end.locator('.big')).toHaveText(TITLE);
		// Honzuki is rated 10 and a favourite in the seed: the block shows both,
		// where before the fix a rated series drew neither.
		await expect(end.getByRole('button', { name: 'Rate 10 of 10' })).toBeVisible();
		await expect(end.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
		// Re-rating stays on the page: the block, the title and the foot remain.
		await end.getByRole('button', { name: 'Rate 8 of 10' }).click();
		await expect(end.getByRole('button', { name: 'Rate 8 of 10' })).toBeVisible();
		await expect(end.getByText('END · LAST AVAILABLE')).toBeVisible();
		await expect(end.locator('.big')).toHaveText(TITLE);
		await expect(end.getByRole('link', { name: 'LIBRARY' })).toBeVisible();
		// In the library, so the row offers DELETE rather than + ADD.
		await expect(end.getByRole('button', { name: '+ ADD TO LIBRARY' })).toHaveCount(0);
		await expect(end.getByRole('button', { name: 'DELETE', exact: true })).toBeVisible();
		await expect(end.getByRole('button', { name: 'HIDE', exact: true })).toHaveCount(0);
		// The file owns Honzuki: put its rating back.
		await page.request.post(`/series/${seriesId}?/rate`, {
			headers: { origin: new URL(base).origin, 'x-sveltekit-action': 'true' },
			form: { rating: '10' }
		});
	});
});

// ---- the band at a chapter's start (c705) ------------------------------------------------
//
// END's twin: the chapter's number, END's count and, only where the book does
// not print it, its table-of-contents title. The seed's book prints every
// title as its heading, so these cases serve one made from it with three
// chapters changed: Vol. 2 has no heading (a web-novel chapter from a
// source), Vol. 3's heading is another ("Interlude"), and Vol. 4's carries a
// "Chapter 4:" prefix over the title. Vol. 6 prints its number and its
// title in two headings, as many publishers' books do.

async function bandBook(): Promise<Buffer> {
	const base = new Zip(
		new Uint8Array(
			sampleEpub({
				title: TITLE,
				hue: 0,
				chapters: Array.from({ length: 33 }, (_, i) => `Vol. ${i + 1}`)
			})
		)
	);
	const edits: Record<string, [string, string]> = {
		'OEBPS/ch2.xhtml': ['<h1>Vol. 2</h1>', ''],
		'OEBPS/ch3.xhtml': ['<h1>Vol. 3</h1>', '<h1>Interlude</h1>'],
		'OEBPS/ch4.xhtml': ['<h1>Vol. 4</h1>', '<h1>Chapter 4: Vol. 4</h1>'],
		'OEBPS/ch6.xhtml': ['<h1>Vol. 6</h1>', '<h1>Chapter 6</h1>\n<h2>Vol. 6</h2>'],
		// A full-page illustration first: as tall as a page can show it.
		'OEBPS/ch5.xhtml': [
			'<h1>Vol. 5</h1>',
			'<p><img src="images/tall.svg" alt="Tall"/></p>\n<h1>Vol. 5</h1>'
		]
	};
	const files: { name: string; data: Buffer | string; deflate?: boolean }[] = [];
	for (const name of base.names) {
		const bytes = Buffer.from(await base.bytesOf(name));
		const edit = edits[name];
		if (edit) expect(bytes.toString()).toContain(edit[0]);
		files.push({
			name,
			data: edit ? bytes.toString().replace(edit[0], edit[1]) : bytes,
			deflate: name !== 'mimetype'
		});
	}
	files.push({
		name: 'OEBPS/images/tall.svg',
		data: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="4000"><rect width="400" height="4000" fill="#888"/></svg>'
	});
	return zip(files);
}

/** Open a chapter from CONTENTS, at its start, as a reader does. */
async function openFromContents(page: Page, label: string) {
	await middle(page);
	await page.getByRole('button', { name: 'CONTENTS' }).click();
	const sheet = page.locator('.contents');
	await expect(sheet.getByText('CONTENTS', { exact: true })).toBeVisible();
	// The list opens on the chapter being read: earlier ones are behind ↑ 1 – n.
	const earlier = sheet.getByRole('button', { name: /↑ 1 – / });
	if (await earlier.count()) await earlier.click();
	await sheet
		.locator('.entry-btn')
		.filter({ has: page.locator('.t').getByText(label, { exact: true }) })
		.click();
	await expect(sheet).toHaveCount(0);
	await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
}

/** The flow's page, from its transform: 0 is the chapter's first. */
const pageNo = (page: Page) =>
	page.evaluate(() => {
		const flow = document.querySelector<HTMLElement>('.flow')!;
		const x = Number(/translateX\((-?[\d.]+)px\)/.exec(flow.style.transform)?.[1] ?? 0);
		const w = document.querySelector<HTMLElement>('.page')!.getBoundingClientRect().width;
		// `+ 0`: page 0 at no shift is -0, which toBe(0) refuses.
		return Math.round(-x / w) + 0;
	});

/** The character `?at=b.o` names is on screen, inside the page's box. */
const onScreen = (page: Page, b: number, o: number) =>
	page.evaluate(
		([b, o]) => {
			const block = document.querySelector<HTMLElement>(`.blocks:not(.next) [data-b="${b}"]`);
			if (!block) return 'no block';
			const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
			let left = o;
			for (let t = walk.nextNode(); t; t = walk.nextNode()) {
				const len = t.textContent?.length ?? 0;
				if (left < len) {
					const r = document.createRange();
					r.setStart(t, left);
					r.setEnd(t, left + 1);
					const c = r.getBoundingClientRect();
					const box = document.querySelector('.page')!.getBoundingClientRect();
					const x = c.left + c.width / 2;
					const y = c.top + c.height / 2;
					return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
						? 'on screen'
						: `off screen at ${Math.round(x)},${Math.round(y)}`;
				}
				left -= len;
			}
			return 'no character';
		},
		[b, o]
	);

test.describe("the band at a chapter's start (c705)", () => {
	test.beforeEach(async ({ page }) => {
		await serveBook(page, await bandBook());
		await openBook(page);
	});

	test('PAGED: the band opens each chapter, with the title only where the book does not print it', async ({
		page
	}) => {
		const band = page.locator('.cstart');
		// Vol. 1 prints its title as its heading: the band has none of its own.
		await expect(band).toHaveCount(1);
		await expect(band.locator('.ab')).toHaveText(/^\s*CH\. 1\s*1 OF 33\s*$/);
		await expect(band.locator('.t')).toHaveCount(0);
		// It is not a block: outside `.blocks`, unnumbered, and the blocks are
		// numbered from the chapter's first as they always were (the cover, then
		// the heading).
		await expect(page.locator('.blocks .cstart, .cstart[data-b], .cstart [data-b]')).toHaveCount(0);
		await expect(page.locator('.blocks > [data-b="0"]')).toHaveJSProperty('localName', 'figure');
		await expect(page.locator('.blocks > [data-b="1"]')).toHaveText('Vol. 1');
		expect(
			await page
				.locator('.blocks > *')
				.evaluateAll((els) => els.every((e, i) => (e as HTMLElement).dataset.b === String(i)))
		).toBe(true);

		// Vol. 1 opens on its cover, which leaves room for the band: the same page.
		expect(await pageNo(page)).toBe(0);
		await expect(band).toBeInViewport();
		await expect(page.locator('figure.illus').first()).toBeInViewport({ ratio: 1 });

		// No heading: the title is the band's.
		await openFromContents(page, 'Vol. 2');
		await expect(page.locator('.blocks h1')).toHaveCount(0);
		await expect(band.locator('.ab')).toHaveText(/^\s*CH\. 2\s*2 OF 33\s*$/);
		await expect(band.locator('.t')).toHaveText('Vol. 2');
		// On the same page as the text: the chapter's first words are beside it.
		await expect(band).toBeInViewport();
		expect(await onScreen(page, 0, 0)).toBe('on screen');
		// A heading that says something else: the title too.
		await openFromContents(page, 'Vol. 3');
		await expect(page.locator('.blocks h1')).toHaveText('Interlude');
		await expect(band.locator('.t')).toHaveText('Vol. 3');
		// "Chapter 4: Vol. 4" is the title, with the number before it: none.
		await openFromContents(page, 'Vol. 4');
		await expect(page.locator('.blocks h1')).toHaveText('Chapter 4: Vol. 4');
		await expect(band.locator('.ab')).toHaveText(/^\s*CH\. 4\s*4 OF 33\s*$/);
		await expect(band.locator('.t')).toHaveCount(0);
		await expect(band).toBeInViewport();
		expect(await onScreen(page, 0, 0)).toBe('on screen');
		// "Chapter 6", then "Vol. 6" under it: the book prints the title in its
		// second heading, so the band does not print it again.
		await openFromContents(page, 'Vol. 6');
		await expect(page.locator('.blocks h1')).toHaveText('Chapter 6');
		await expect(page.locator('.blocks h2')).toHaveText('Vol. 6');
		await expect(band.locator('.ab')).toHaveText(/^\s*CH\. 6\s*6 OF 33\s*$/);
		await expect(band.locator('.t')).toHaveCount(0);

		// Vol. 5 opens on a full-page illustration, which leaves no room: the
		// band is the one page of its own, the illustration on the next, and a
		// relayout (a face arriving) keeps the reader on the band's page, which
		// has no character to keep.
		await openFromContents(page, 'Vol. 5');
		const tall = page.locator('figure.illus img[alt="Tall"]');
		await expect(tall).toHaveAttribute('src', /^blob:/);
		await expect(page.locator('.blocks > [data-b="0"] img')).toHaveAttribute('alt', 'Tall');
		await page.evaluate(() => document.fonts.ready);
		expect(await pageNo(page)).toBe(0);
		await expect(band).toBeInViewport();
		await expect(tall).not.toBeInViewport();
		for (const fire of ['loadingdone', 'load'] as const) {
			await page.evaluate((fire) => {
				if (fire === 'load') window.dispatchEvent(new Event('load'));
				else document.fonts.dispatchEvent(new Event('loadingdone'));
			}, fire);
			await page.waitForTimeout(300);
			expect(await pageNo(page), fire).toBe(0);
		}
		await forward(page);
		expect(await pageNo(page)).toBe(1);
		await expect(tall).toBeInViewport();
		await expect(band).not.toBeInViewport();
		// And back: the band's page again, held there through a relayout.
		const v0 = page.viewportSize()!;
		await page.mouse.click(8, v0.height / 2);
		await expect.poll(() => pageNo(page)).toBe(0);
		await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
		await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
		await page.waitForTimeout(300);
		expect(await pageNo(page)).toBe(0);
		// Scrubbed there from the chapter's last page, the band's page saves the
		// chapter's first character, as opening there does, not the last page's.
		await middle(page);
		const track = page.locator('[role="slider"][aria-label="Page in chapter"]');
		await expect(track).toBeVisible();
		const box = (await track.boundingBox())!;
		const at = () => new URL(page.url()).searchParams.get('at');
		await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
		await expect(page.locator('.bottom .left')).toHaveText(/^P\. (\d+) OF \1\b/);
		await expect.poll(at).not.toBe('0.0');
		await page.mouse.click(box.x + 2, box.y + box.height / 2);
		await expect(page.locator('.bottom .left')).toHaveText(/^P\. 1 OF /);
		await expect.poll(at).toBe('0.0');
		await page.keyboard.press('Escape');
		await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
		await page.waitForTimeout(300);
		expect(await pageNo(page)).toBe(0);
		await openFromContents(page, 'Vol. 4');

		// Back across Vol. 3's end from Vol. 4's first page: the last page, as
		// before, and its band is the END band, not this one.
		const v = page.viewportSize()!;
		await page.mouse.click(8, v.height / 2);
		await expect(page.locator('.blocks h1')).toHaveText('Interlude');
		await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
		await expect(page.locator('.band')).toBeInViewport();
		await expect(band).not.toBeInViewport();
	});

	test('PAGED: a saved place opens on the same words, the band before it or not', async ({
		page
	}) => {
		const first = page.url();
		await openFromContents(page, 'Vol. 2');
		// The reader's URL follows the chapter 800 ms after it settles.
		await expect(page).not.toHaveURL(first);
		const url = new URL(page.url());
		// Vol. 2 (no heading, so a title in the band): the first paragraph's
		// middle, on the band's page, and a paragraph pages further on.
		for (const [b, o] of [
			[0, 40],
			[10, 60]
		] as const) {
			url.searchParams.set('at', `${b}.${o}`);
			await page.goto(url.toString());
			await expect(page.locator('.blocks p').first()).toBeVisible({ timeout: 15000 });
			await expect(page.locator('.cstart .t')).toHaveText('Vol. 2');
			await page.evaluate(() => document.fonts.ready);
			await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
			await expect.poll(() => onScreen(page, b, o)).toBe('on screen');
			// The reader keeps that place as it was given: the band moved no block.
			await page.waitForTimeout(1000);
			expect(new URL(page.url()).searchParams.get('at')).toBe(`${b}.${o}`);
			expect(await onScreen(page, b, o)).toBe('on screen');
		}

		// Vol. 5 (a full-page illustration first, so the band has a page of its
		// own) opened as the series screen opens it, with no `?at=`, a read chapter at
		// its top, and with `?at=0.0`: both on the
		// band's page, not the illustration's.
		const vol2 = page.url();
		await openFromContents(page, 'Vol. 5');
		await expect(page).not.toHaveURL(vol2);
		const vol5 = new URL(page.url());
		for (const search of ['', '?at=0.0']) {
			vol5.search = search;
			await page.goto(vol5.toString());
			const tall = page.locator('figure.illus img[alt="Tall"]');
			await expect(tall).toHaveAttribute('src', /^blob:/, { timeout: 15000 });
			await page.evaluate(() => document.fonts.ready);
			await expect(page.locator('.flow')).not.toHaveClass(/sliding/);
			expect(await pageNo(page), search).toBe(0);
			await expect(page.locator('.cstart')).toBeInViewport();
			await expect(tall).not.toBeInViewport();
		}
	});

	test('SCROLL: the band above the first line, and END, then the next start band, then its text', async ({
		page
	}) => {
		await middle(page);
		await page.getByRole('button', { name: /^PAGED · / }).click();
		await page.getByRole('radio', { name: 'SCROLL' }).click();
		await page.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
		// Opened at its start: at the top, the band first.
		await openFromContents(page, 'Vol. 2');
		// The chapter's own band, the flow's first child; the next chapter's follows END.
		const band = page.locator('.flow > .cstart').first();
		await expect(page.locator('.flow > .sband + .cstart .t')).toHaveText('Vol. 3');
		await expect(band.locator('.t')).toHaveText('Vol. 2');
		const top = () => page.locator('.page').evaluate((n) => n.scrollTop);
		expect(await top()).toBe(0);
		await expect(band).toBeInViewport();
		// A relayout keeps the first line under it, not on the margin.
		await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
		await page.waitForTimeout(300);
		expect(await top()).toBe(0);

		// The order down the page: this chapter's text, END, Vol. 3's start
		// band (the heading "Interlude" is not its title, so the band names it),
		// then Vol. 3's text.
		const next = page.locator('.blocks.next > *').first();
		await expect(next).toHaveText('Interlude');
		const order = await page
			.locator('.flow')
			.evaluate((flow) =>
				[...flow.children].map((c) =>
					c.classList.contains('cstart')
						? `start:${c.querySelector('.t')?.textContent ?? ''}`
						: c.classList.contains('sband')
							? 'end'
							: c.classList.contains('next')
								? 'next'
								: c.classList.contains('blocks')
									? 'blocks'
									: c.className
				)
			);
		expect(order).toEqual(['start:Vol. 2', 'blocks', 'end', 'start:Vol. 3', 'next']);
		// The next chapter's blocks are not numbered: only the chapter on screen answers places.
		await expect(page.locator('.blocks.next [data-b]')).toHaveCount(0);

		// Scroll on until Vol. 3 opens: its band is the one that was below END.
		// Nothing above a chapter is kept in SCROLL, so a crossing at the middle
		// takes its start to the top, under its band (and to the margin before
		// c705; measured in the reader's notes, wave 32). A crossing caught late,
		// the start already higher than that, as a fling leaves it, keeps the
		// line where it stood: that is the one case below. All in the page, so
		// nothing waits on a round trip: the crossing, then a relayout at once,
		// before the reader's place is read again (250 ms after the last
		// scroll), as a face the new heading is the first to use arrives then.
		// The line stays where it crossed, not where a chapter opened at its
		// start keeps it, under the band.
		const v = page.viewportSize()!;
		const heading = page.locator('.blocks:not(.next) h1').first();
		const moved = await page.locator('.page').evaluate(async (n) => {
			const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
			const first = n.querySelector<HTMLElement>('.blocks.next > *')!;
			n.scrollTop += Math.round(
				first.getBoundingClientRect().top - n.getBoundingClientRect().top - 60
			);
			const h = () => n.querySelector<HTMLElement>('.blocks:not(.next) h1');
			for (let i = 0; i < 120 && h()?.textContent !== 'Interlude'; i++) await frame();
			await frame();
			const before = h()!.getBoundingClientRect().top;
			const scrolled = n.scrollTop;
			document.fonts.dispatchEvent(new Event('loadingdone'));
			await frame();
			await frame();
			// Late enough that the band is partly scrolled off: the case reached.
			return scrolled > 0 ? Math.abs(h()!.getBoundingClientRect().top - before) : -1;
		});
		await expect(heading).toHaveText('Interlude');
		expect(moved).toBeGreaterThanOrEqual(0);
		expect(moved).toBeLessThanOrEqual(1);
		await expect(band.locator('.t')).toHaveText('Vol. 3');
		// Vol. 4's heading carries its title: its band below END has none.
		await expect(page.locator('.flow > .sband + .cstart .ab')).toContainText('CH. 4');
		await expect(page.locator('.flow > .sband + .cstart .t')).toHaveCount(0);
		await page.waitForTimeout(400);
		const y = await heading.evaluate((h) => h.getBoundingClientRect().top);
		expect(y).toBeGreaterThan(0);
		expect(y).toBeLessThan(v.height);
		// A relayout then leaves it there, a line or less.
		await page.evaluate(() => window.dispatchEvent(new Event('load')));
		await page.waitForTimeout(400);
		expect(
			Math.abs((await heading.evaluate((h) => h.getBoundingClientRect().top)) - y)
		).toBeLessThanOrEqual(1);
	});
	/**
	 * c742: in SCROLL the start band (c705) and the flow's padding sit above
	 * `.blocks`, so a fraction over the blocks' height alone reached 1, and
	 * finished the chapter, one band height before its last line. One band
	 * short of the end is not finished; at the end it is. `/api/reading` is
	 * answered here, so nothing is written: the case reads what the reader
	 * sends. The settle's own 'page' send (after the 250 ms scroll check)
	 * is what says the check ran, not a timeout.
	 */
	test('SCROLL: one band short of the chapter’s end is not finished, and at its end it is (c742)', async ({
		page
	}) => {
		const sent: { kind: string; at: number }[] = [];
		await page.route('**/api/reading', async (route) => {
			const body = route.request().postDataJSON() as { kind: string };
			sent.push({ kind: body.kind, at: Date.now() });
			await route.fulfill({ json: { saved: true } });
		});
		await middle(page);
		await page.getByRole('button', { name: /^PAGED · / }).click();
		await page.getByRole('radio', { name: 'SCROLL' }).click();
		await page.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(page.locator('.text-reader')).toHaveClass(/scroll/);
		await openFromContents(page, 'Vol. 2');
		await expect(page.locator('.flow > .cstart').first().locator('.t')).toHaveText('Vol. 2');

		const m = await page.locator('.page').evaluate((n) => {
			const blocks = n.querySelector<HTMLElement>('.blocks:not(.next)')!;
			const band = n.querySelector<HTMLElement>('.flow > .cstart')!;
			return {
				parentIsPage: blocks.offsetParent === n,
				offsetTop: blocks.offsetTop,
				band: band.getBoundingClientRect().height,
				blocks: blocks.offsetHeight,
				client: n.clientHeight,
				scrollHeight: n.scrollHeight
			};
		});
		console.log(`c742 measured: ${JSON.stringify(m)}`);
		// The premise: `.page` is what offsetTop counts from, and the band is above the blocks.
		expect(m.parentIsPage).toBe(true);
		expect(m.offsetTop).toBeGreaterThanOrEqual(m.band);
		const end = m.offsetTop + m.blocks - m.client;
		// One band short of the last line, and still past where the blocks'
		// height alone (the fraction before c742) already read 1.
		const short = end - Math.round(m.band);
		expect(short).toBeGreaterThan(m.blocks - m.client);

		const scrollTo = (top: number) =>
			page.locator('.page').evaluate((n, top) => {
				n.scrollTop = top;
				n.dispatchEvent(new Event('scroll'));
			}, top);
		const settled = async (since: number) =>
			expect
				.poll(() => sent.some((s) => s.kind === 'page' && s.at > since), { timeout: 10_000 })
				.toBe(true);

		let since = Date.now();
		await scrollTo(short);
		await settled(since);
		expect(sent.map((s) => s.kind)).not.toContain('finish');
		// The fraction's other reader, the progress bar, is short of the end too.
		const bar = () =>
			page.locator('.progress').evaluate((n) => parseFloat((n as HTMLElement).style.width));
		expect(await bar()).toBeLessThan(99.9);

		// At the chapter's end: finished, once.
		since = Date.now();
		await scrollTo(end);
		await expect.poll(() => sent.filter((s) => s.kind === 'finish').length).toBe(1);
		await settled(since);
		expect(await bar()).toBe(100);

		// The scrubber maps its 99 onto the same end: from the top, its right
		// edge lands on the last line at the screen's foot, not one band short.
		await scrollTo(0);
		await expect.poll(bar).toBe(0);
		await middle(page);
		const track = page.locator('[role="slider"][aria-label="Page in chapter"]');
		await expect(track).toBeVisible();
		const box = (await track.boundingBox())!;
		await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
		await expect
			.poll(() => page.locator('.page').evaluate((n) => Math.round(n.scrollTop)))
			.toBe(end);
		// Still Vol. 2: the end of its blocks did not cross into Vol. 3.
		await expect(page.locator('.flow > .cstart').first().locator('.t')).toHaveText('Vol. 2');
	});
});
