import type { Page } from '@playwright/test';
import { sampleEpub } from '../src/lib/server/pages/sample-epub';
import { Zip } from '../src/lib/epub/unzip';
import { expect, test } from './fixtures';

/**
 * The text reader (doc/TEXT-READER.md), against the seed's generated EPUBs.
 * This file owns Honzuki no Gekokujou, a novel read to the end, so reading it
 * again moves no CONTINUE row another spec counts.
 */
const TITLE = 'Honzuki no Gekokujou';
test.describe.configure({ mode: 'serial' });

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
const forward = async (page: Page) => {
	const v = page.viewportSize()!;
	await page.mouse.click(v.width - 8, v.height / 2);
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
	// Read once the turn has settled: mid-slide the block is still off-screen,
	// and turning again then overshot it into the next chapter under the full
	// run (2026-10-15). Settled is the same position twice, 150ms apart.
	const onScreen = async () => {
		if ((await open.count()) === 0) return false;
		let b = await open.boundingBox();
		for (let i = 0; i < 20; i++) {
			await page.waitForTimeout(150);
			const again = await open.boundingBox();
			if (again?.x === b?.x) break;
			b = again;
		}
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
	await page.mouse.click(8, page.viewportSize()!.height / 2);
	await expect(page.locator('.bottom')).toHaveCount(0);
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
