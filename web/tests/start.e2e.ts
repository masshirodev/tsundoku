/**
 * Opening the web edition (doc/WEB-EDITION.md, "Starting, and when it
 * cannot"; handoff `web-edition-start`): the starting screen the shell paints
 * from the first byte, its header rule filling as each step really finishes,
 * a first visit's FIRST VISIT carried over its reload, the could-not-start
 * screen for each failure a test can force, and the refusal a takeover
 * answers a lost write with.
 *
 * Every test is a first visit in a fresh context. Failures are forced with
 * init scripts, which run in the page before its own scripts: taking a part
 * away from `navigator`, or putting a stand-in in place of the server worker
 * that says what a real one would have said when it failed.
 *
 * Shelf names are invented.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/** One moment of the starting screen, as the page logged it. */
type Moment = {
	load: number;
	origin: number;
	t: number;
	boot: string | undefined;
	step: string | undefined;
	first: boolean;
	revealed: boolean;
	failed: string | undefined;
	left: string;
	right: string;
	fill: string;
	mark: [number, number] | null;
};

/**
 * Logs the starting screen at the first parse of every load and at each
 * change of its step, into sessionStorage, which the tab keeps over the first
 * visit's reload. A moment is read where the screen is, never guessed.
 */
async function logTheStart(context: BrowserContext) {
	await context.addInitScript(() => {
		const loads = Number(sessionStorage.getItem('test.loads') ?? '0') + 1;
		sessionStorage.setItem('test.loads', String(loads));
		const log = () => {
			const s = document.getElementById('web-start');
			if (!s) return;
			const text = (sel: string) => s.querySelector(sel)?.textContent ?? '';
			const latin = [...s.querySelectorAll('.ws-latin')].find(
				(e) => e.getBoundingClientRect().width > 0
			);
			const r = latin?.getBoundingClientRect();
			const all = JSON.parse(sessionStorage.getItem('test.start') ?? '[]');
			all.push({
				load: loads,
				origin: performance.timeOrigin,
				t: Date.now(),
				boot: document.documentElement.dataset.webBoot,
				step: s.dataset.step,
				first: s.hasAttribute('data-first'),
				revealed: s.hasAttribute('data-revealed'),
				failed: s.dataset.failed,
				left: text('.ws-label-left'),
				right: text('.ws-label-right'),
				fill: (s.querySelector('.ws-fill') as HTMLElement | null)?.style.width ?? '',
				mark: r ? [Math.round(r.x), Math.round(r.y)] : null
			});
			sessionStorage.setItem('test.start', JSON.stringify(all));
		};
		document.addEventListener('DOMContentLoaded', () => {
			log();
			const s = document.getElementById('web-start');
			if (s)
				new MutationObserver(log).observe(s, {
					attributes: true,
					attributeFilter: ['data-step', 'data-revealed', 'data-failed']
				});
		});
	});
}

const moments = (page: Page): Promise<Moment[]> =>
	page.evaluate(() => JSON.parse(sessionStorage.getItem('test.start') ?? '[]'));

/** The app has opened in place: it drew, and the starting screen is gone. */
async function opened(page: Page) {
	await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'ready', { timeout: 30_000 });
	await expect(page.locator('#svelte-announcer')).toBeAttached({ timeout: 30_000 });
	await expect(page.locator('#web-start')).toHaveCount(0);
}

/** Where the app's own wordmark is, the one on screen. */
const appMark = (page: Page) =>
	page.evaluate(() => {
		const latin = [...document.querySelectorAll('.wordmark .latin')].find(
			(e) => e.getBoundingClientRect().width > 0
		);
		const r = latin!.getBoundingClientRect();
		return [Math.round(r.x), Math.round(r.y)];
	});

/**
 * Puts a stand-in in place of the server worker, which posts `messages` as
 * the real one would. Everything else the page starts is the real thing.
 */
async function standInServer(context: BrowserContext, messages: object[]) {
	await context.addInitScript((posted) => {
		const Real = window.Worker;
		window.Worker = class extends Real {
			constructor(url: string | URL, options?: WorkerOptions) {
				const stand = String(url).endsWith('/server/worker.js')
					? URL.createObjectURL(
							new Blob([`for (const m of ${JSON.stringify(posted)}) self.postMessage(m);`], {
								type: 'text/javascript'
							})
						)
					: url;
				super(stand, options);
			}
		};
	}, messages);
}

const failure = (page: Page) => page.locator('#web-start .ws-fail');

test('a first visit says so at once, fills the rule step by step, and carries on over its reload', async ({
	context,
	page
}) => {
	await logTheStart(context);
	await page.goto('/');
	await opened(page);
	const log = await moments(page);

	// The first paint is already the first visit's, before any step.
	expect(log[0]).toMatchObject({
		load: 1,
		first: true,
		revealed: false,
		left: '00 — FIRST VISIT',
		right: 'GETTING READY'
	});
	expect(log[0].fill).toBe('0%');

	// The rule fills a quarter per step, each reached in turn and never undone.
	const steps = log.map((m) => Number(m.step));
	expect(steps).toEqual([...steps].sort((a, b) => a - b));
	for (const s of [1, 2, 3, 4]) expect(steps).toContain(s);
	for (const m of log) expect(m.fill).toBe(`${Number(m.step) * 25}%`);

	// At most one reload (none when the service worker claims the tab before
	// boot.js looks), and the page after it carries the same picture on.
	expect([...new Set(log.map((m) => m.load))]).toEqual(
		log.some((m) => m.load === 2) ? [1, 2] : [1]
	);
	const second = log.filter((m) => m.load === 2);
	if (second.length > 0) {
		expect(second[0]).toMatchObject({ first: true, left: '00 — FIRST VISIT' });
		expect(Number(second[0].step)).toBeGreaterThanOrEqual(1);
		expect(second[0].fill).not.toBe('0%');
	}

	// What this is, and the four steps, only after 1.5 s, and from then on.
	const origin = log[0].origin;
	const shown = log.findIndex((m) => m.revealed);
	expect(shown).toBeGreaterThan(-1);
	for (const m of log.slice(shown)) expect(m.revealed).toBe(true);
	for (const m of log.filter((m) => m.revealed)) expect(m.t - origin).toBeGreaterThanOrEqual(1500);
	expect(log[log.length - 1].right).toMatch(/^4 OF 4 · /);

	// The app opens in place on GET STARTED: its wordmark where the screen's was.
	await expect(page.getByText('GET STARTED').first()).toBeVisible();
	expect(log[log.length - 1].mark).toEqual(await appMark(page));
});

test('a reload during a first visit carries the same picture on: the step reached, the steps shown', async ({
	context,
	page
}) => {
	// A server that loads and never opens the library holds the start at
	// step 2, so the reload lands at a known place (a first visit's own
	// reload, when there is one, comes right after step 1).
	await standInServer(context, [{ type: 'tsundoku-step', step: 'server' }]);
	await logTheStart(context);
	await page.goto('/');
	const screen = page.locator('#web-start');
	await expect(screen).toHaveAttribute('data-revealed', '', { timeout: 30_000 });
	await expect(screen).toHaveAttribute('data-step', '2');
	await page.reload();
	await expect(screen).toHaveAttribute('data-step', '2');
	// The last load is the test's own reload (a first visit may have had one before it).
	const log = await moments(page);
	const after = log.filter((m) => m.load === log[log.length - 1].load);
	// The very first paint after the reload is already where the start was.
	expect(after[0]).toMatchObject({
		first: true,
		revealed: true,
		step: '2',
		fill: '50%',
		left: '00 — FIRST VISIT',
		right: '3 OF 4 · OPENING THE LIBRARY'
	});
});

test('a later visit says only STARTING · OPENING THE LIBRARY', async ({ context, page }) => {
	await page.goto('/');
	await opened(page);
	await logTheStart(context);
	await page.reload();
	await opened(page);
	const later = await moments(page);
	expect(later.length).toBeGreaterThan(0);
	for (const m of later)
		expect(m).toMatchObject({
			first: false,
			revealed: false,
			left: '00 — STARTING',
			right: 'OPENING THE LIBRARY'
		});
	expect(later[later.length - 1].step).toBe('4');
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('the screen has the library’s bar, and the app opens without moving it', async ({
		context,
		page
	}) => {
		await logTheStart(context);
		await page.goto('/');
		await opened(page);
		const log = await moments(page);
		expect(log[log.length - 1].mark).toEqual(await appMark(page));
		expect(await appMark(page)).toEqual([16, 21]);
	});
});

test('the screen is the handoff’s, measured: the frame, the line, the steps', async ({
	context,
	page
}) => {
	// A server that loads and then never opens the library: the start stops
	// at step 2, and the first visit's steps stay up to be measured.
	await standInServer(context, [{ type: 'tsundoku-step', step: 'server' }]);
	await page.goto('/');
	const screen = page.locator('#web-start');
	await expect(screen).toHaveAttribute('data-revealed', '', { timeout: 30_000 });
	await expect(screen).toHaveAttribute('data-step', '2');
	await expect(screen.locator('.ws-label-right')).toHaveText('3 OF 4 · OPENING THE LIBRARY');

	// These are hand-set in the handoff and on no ladder (doc/design/README.md,
	// "Space and shape"): pinned so a tidy-up cannot round them onto one. Read
	// from the handoff by design-tools (extract-spec, gen-conformance), and
	// written here by hand: a generated spec only opens a URL, and this screen
	// is up only while a start is held.
	const got = await page.evaluate(() => {
		const q = (sel: string) => document.querySelector(`#web-start ${sel}`) as HTMLElement;
		const cs = (sel: string) => getComputedStyle(q(sel));
		const box = (sel: string) => q(sel).getBoundingClientRect();
		return {
			side: box('.ws-side').width,
			sideMark: [box('.ws-side-mark').height, cs('.ws-side-mark').paddingLeft],
			bar: [box('.ws-bar').left, box('.ws-bar').height],
			rule: [box('.ws-rule').height, cs('.ws-rule').bottom],
			fill: box('.ws-fill').width / box('.ws-rule').width,
			label: [cs('.ws-label').paddingTop, cs('.ws-label').paddingBottom, cs('.ws-label').fontSize],
			body: [
				cs('.ws-body').flexDirection,
				cs('.ws-body').alignItems,
				cs('.ws-body').columnGap,
				cs('.ws-body').paddingTop,
				cs('.ws-body').paddingLeft
			],
			text: [cs('.ws-text').paddingTop, cs('.ws-text').paddingBottom, cs('.ws-text').rowGap],
			prose: [cs('.ws-prose-in').maxWidth, cs('.ws-prose-in').rowGap],
			h1: [cs('.ws-body h1').fontSize, cs('.ws-body h1').fontWeight, cs('.ws-body h1').lineHeight],
			p: [cs('.ws-body p').fontSize, cs('.ws-body p').lineHeight],
			steps: box('.ws-steps').width,
			row: box('.ws-step').height,
			num: box('.ws-num').width,
			numBox: [box('.ws-box').width, box('.ws-box').height],
			stepLabel: [cs('.ws-step-label').fontSize, cs('.ws-step-label').letterSpacing],
			status: [cs('.ws-status').paddingLeft, cs('.ws-status').fontSize]
		};
	});
	expect(got).toEqual({
		side: 248,
		sideMark: [64, '24px'],
		bar: [248, 64],
		rule: [2, '-1px'],
		fill: 0.5,
		label: ['24px', '12px', '13px'],
		// The handoff's desktop board pads 32px; the library's --pad is 24px
		// (doc/WEB-EDITION.md, "Where it departs from the handoff").
		body: ['row', 'flex-start', '56px', '12px', '24px'],
		text: ['10px', '10px', '4px'],
		prose: ['560px', '12px'],
		h1: ['22px', '500', '27.5px'],
		p: ['17px', '25.5px'],
		steps: 440,
		row: 60,
		num: 64,
		numBox: [32, 32],
		stepLabel: ['14px', '0.56px'],
		status: ['18px', '12px']
	});
	// The step under way and the ones done, in the system's colours.
	const marks = await screen
		.locator('.ws-step')
		.evaluateAll((rows) =>
			rows.map(
				(r) => `${(r as HTMLElement).dataset.state}:${r.querySelector('.ws-status')?.textContent}`
			)
		);
	expect(marks).toEqual(['done:DONE', 'done:DONE', 'now:NOW', 'todo:']);
});

test.describe('could not start', () => {
	test('without service workers: Firefox’s private window, a browser too old elsewhere', async ({
		context,
		page,
		browserName
	}) => {
		await context.addInitScript(() =>
			Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => undefined })
		);
		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('data-web-boot', 'failed');
		const label = page.locator('#web-start .ws-label');
		await expect(label).toContainText('00 — COULD NOT START');
		if (browserName === 'firefox') {
			await expect(label).toContainText('PRIVATE WINDOW');
			await expect(failure(page).locator('h1')).toHaveText(
				'A private window can’t keep a library.'
			);
			await expect(failure(page)).toContainText('FIREFOX · PRIVATE WINDOW · NO SERVICE WORKERS');
			await expect(failure(page).getByRole('button', { name: 'Copy the address' })).toBeVisible();
		} else {
			await expect(label).toContainText('BROWSER TOO OLD');
			await expect(failure(page)).toContainText('MISSING · SERVICE WORKERS');
		}
		// Under the same bar, with no rule: nothing is under way.
		await expect(page.locator('#web-start .ws-bar')).toBeVisible();
		await expect(page.locator('#web-start .ws-rule')).toBeHidden();
	});

	test('a browser too old names what is missing', async ({ context, page }) => {
		await context.addInitScript(() =>
			Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined })
		);
		await page.goto('/');
		await expect(page.locator('#web-start .ws-label')).toContainText('BROWSER TOO OLD');
		await expect(failure(page).locator('h1')).toHaveText('This browser is too old for tsundoku.');
		await expect(failure(page)).toContainText('MISSING · WEB LOCKS');
		await expect(failure(page).getByRole('link', { name: 'What it needs →' })).toHaveAttribute(
			'href',
			/WEB-EDITION\.md#a-browser-too-old$/
		);
	});

	test('a browser too old, as the server worker finds it', async ({ context, page }) => {
		await standInServer(context, [
			{ type: 'tsundoku-step', step: 'server' },
			{
				type: 'tsundoku-failed',
				error: 'Error: missing: SYNCHRONOUS FILE ACCESS',
				name: 'Error',
				missing: ['SYNCHRONOUS FILE ACCESS']
			}
		]);
		await page.goto('/');
		await expect(failure(page)).toContainText('MISSING · SYNCHRONOUS FILE ACCESS', {
			timeout: 30_000
		});
	});

	test('storage turned off, as the page finds it, and TRY AGAIN starts again', async ({
		context,
		page
	}) => {
		await context.addInitScript(() => {
			StorageManager.prototype.getDirectory = () =>
				Promise.reject(new DOMException('The operation is insecure.', 'SecurityError'));
		});
		await page.goto('/');
		await expect(page.locator('#web-start .ws-label')).toContainText('STORAGE TURNED OFF');
		await expect(failure(page).locator('h1')).toHaveText(
			/^This browser isn’t letting localhost:\d+ keep anything\.$/
		);
		await expect(failure(page)).toContainText('SITE DATA BLOCKED');
		const again = page.waitForEvent('load');
		await failure(page).getByRole('button', { name: 'Try again' }).click();
		await again;
		await expect(page.locator('#web-start .ws-label')).toContainText('STORAGE TURNED OFF');
	});

	test('storage turned off, as SQLite’s pool in the server worker finds it', async ({
		context,
		page
	}) => {
		await standInServer(context, [
			{ type: 'tsundoku-step', step: 'server' },
			{
				type: 'tsundoku-failed',
				error: 'SecurityError: Security error when calling GetDirectory',
				name: 'SecurityError',
				missing: []
			}
		]);
		await page.goto('/');
		await expect(page.locator('#web-start .ws-label')).toContainText('STORAGE TURNED OFF', {
			timeout: 30_000
		});
	});

	test('anything else shows what it said, selectable and copied whole', async ({
		context,
		page,
		browserName
	}) => {
		if (browserName === 'chromium')
			await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await standInServer(context, [
			{ type: 'tsundoku-step', step: 'server' },
			{ type: 'tsundoku-failed', error: 'Error: an invented failure', name: 'Error', missing: [] }
		]);
		await page.goto('/');
		await expect(page.locator('#web-start .ws-label')).toContainText('UNKNOWN', {
			timeout: 30_000
		});
		await expect(failure(page).locator('h1')).toHaveText('tsundoku couldn’t start.');
		const report = failure(page).locator('pre');
		await expect(report).toContainText('At: starting the server');
		await expect(report).toContainText('Error: an invented failure');
		await expect(report).not.toContainText('Error: Error:');
		await expect(report).toContainText(browserName === 'firefox' ? /Firefox \d+/ : /Chrome \d+/);
		expect(await report.evaluate((e) => getComputedStyle(e).userSelect)).not.toBe('none');
		await expect(failure(page)).toContainText('NOTHING IN THE LIBRARY WAS CHANGED');
		await failure(page).getByRole('button', { name: 'COPY' }).click();
		await expect(failure(page).getByRole('button', { name: 'COPIED' })).toBeVisible();
		if (browserName === 'chromium')
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
				await report.textContent()
			);
	});
});

test('a write the closing tab took is refused in the system’s band, and TRY AGAIN reaches the new server', async ({
	context
}) => {
	const first = await context.newPage();
	await first.goto('/');
	await opened(first);
	const second = await context.newPage();
	await second.goto('/');
	await opened(second);

	// The first tab leads; from now on it takes requests and never answers,
	// as a tab closing with one in hand does. It notes the write reaching it.
	await first.evaluate(() => {
		navigator.serviceWorker.onmessage = ({ data }) => {
			if (data?.type === 'tsundoku-request' && String(data.url).includes('?/newShelf'))
				document.documentElement.dataset.held = '';
		};
	});
	await second.getByRole('link', { name: '+ NEW SHELF' }).click();
	const field = second.getByRole('textbox', { name: 'New shelf name' });
	await field.fill('Sent As It Closed');
	await field.press('Enter');
	// Closed with the write in hand, not before it arrived: a write that
	// reaches no tab simply waits for the next leader, and is not lost.
	await expect(first.locator('html')).toHaveAttribute('data-held', '');
	await first.close();

	const band = second.getByRole('status').filter({ hasText: 'NOTHING CHANGED · NEW SHELF' });
	await expect(band).toBeVisible({ timeout: 30_000 });
	await expect(band).toContainText(
		'THE TAB RUNNING TSUNDOKU CLOSED AS IT WAS SENT · THIS TAB RUNS IT NOW'
	);
	await expect(band.getByRole('button', { name: 'Dismiss this band' })).toBeVisible();
	// Nothing was written.
	await expect(second.getByRole('link', { name: /Sent As It Closed/i })).toHaveCount(0);

	await band.getByRole('button', { name: 'TRY AGAIN' }).click();
	// The shelf, not the address: the library's GET STARTED poll
	// (invalidate every 5 s) can land during the redirect to the new shelf
	// and take the page back to the address it is on, under a loaded box.
	await expect(second.getByRole('link', { name: /Sent As It Closed/i }).first()).toBeVisible({
		timeout: 30_000
	});
	await expect(band).toHaveCount(0);
});
