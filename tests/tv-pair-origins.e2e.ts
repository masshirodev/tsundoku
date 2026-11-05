import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	chromium,
	request,
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	type Page
} from '@playwright/test';
import { expect, test } from './fixtures';
import { hydrated } from './helpers/hydration';
import { E2E_TOKEN } from '../playwright.config';

/**
 * The TV's side of pairing on servers of this file's own (doc/WIFI.md,
 * doc/TV-APP.md, doc/SIGN-IN.md), where the shared preview cannot go:
 *
 * - **c246**: `/pair/tv` opened with an expired code, the server's clock
 *   moved past the code's 10 minutes, makes a new one; a burned one stays.
 *   And the computer's half: SETTINGS' DEVICES row, open in a browser of its
 *   own, keeps asking about an expired code, so it draws the one the TV made
 *   on its own 5 s tick, with no focus change.
 * - **c531**: a burned code stays burned through a reload of SETTINGS' data
 *   (an unrelated setting changed), and a real visit (the app's link, the
 *   back button, the browser's reload) makes a new one.
 * - **c545**: 9E carries the server's name in `data-paired-name`, and the TV
 *   app's own `PAIRED_JS`, read out of MainActivity.kt, reads it there.
 * - **c530**: two tsundoku on one host, two ports, paired in one cookie jar as
 *   the TV's WebView keeps it: each stays paired after the other pairs and
 *   after FORGET on the other, and a jar holding only the name used before
 *   c530 stays paired and is moved to the new one.
 *
 * Two `vite preview` of its own, each with a seeded database and a port from
 * the OS: the six digits live in a server's memory, one code at a time, and
 * `tv-pair.e2e.ts` spends the shared server's. Each server's `Date.now` is
 * moved by a file this spec writes (`--import`, below), since a code's 10
 * minutes cannot be waited out. Both answer at 127.0.0.1, and each has an
 * `ORIGIN` on `tsundoku.test:<port>`, the shape `scripts/serve.ts` gives a
 * tailnet install: a loopback origin is no door for a TV's cookie at all
 * (`tailnetHost`). The browser resolves that name to 127.0.0.1, so the TV's
 * jar holds both servers' cookies under one host, which is the bug c530 is.
 *
 * In the `tv` project only (a `tv-*.e2e.ts`): the pages are the TV's, and one
 * project stands the two servers up once. Serial, for the one code each.
 */
test.describe.configure({ mode: 'serial', timeout: 90_000 });

const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});

/**
 * What `--import` loads into each server: `Date.now` plus whatever the clock
 * file says, read again at most every 50 ms. Only `Date.now` moves; the
 * pairing code reads nothing else (src/lib/server/pairing.ts).
 */
const CLOCK_JS = `
import { readFileSync } from 'node:fs';
const file = process.env.TSUNDOKU_E2E_CLOCK;
if (file) {
	const real = Date.now.bind(Date);
	let offset = 0;
	let read = 0;
	Date.now = () => {
		const t = real();
		if (t - read > 50) {
			read = t;
			try { offset = Number(readFileSync(file, 'utf8')) || 0; } catch { offset = 0; }
		}
		return t + offset;
	};
}
`;
const clockModule = join(tmpdir(), `tsundoku-e2e-clock-${process.pid}.mjs`);

type Server = {
	port: number;
	/** Where the TV opens it: the tailnet-like name its ORIGIN gives. */
	tv: string;
	/** Where the computer asks for its code: 127.0.0.1, which `/api/pair/tv` answers. */
	computer: string;
	db: string;
	clock: string;
	child: ChildProcess | null;
};
const server = (port: number, name: string): Server => {
	const db = join(tmpdir(), `tsundoku-e2e-origins-${name}-${process.pid}.sqlite`);
	return {
		port,
		tv: `http://tsundoku.test:${port}`,
		computer: `http://127.0.0.1:${port}`,
		db,
		clock: `${db}.clock`,
		child: null
	};
};
const A = server(await freePort(), 'a');
const B = server(await freePort(), 'b');

const tvProject = () => test.info().project.name === 'tv';

async function serve(at: Server) {
	rmSync(at.db, { force: true });
	writeFileSync(at.clock, '0');
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: at.db, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const env: NodeJS.ProcessEnv = {
		...process.env,
		DATABASE_PATH: at.db,
		TSUNDOKU_TOKEN: E2E_TOKEN,
		TSUNDOKU_ANILIST: 'off',
		LIBRARY_ROOT: join(tmpdir(), `tsundoku-e2e-origins-empty-${process.pid}`),
		TSUNDOKU_HOME: `${at.db}.home`,
		ORIGIN: at.tv,
		__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: 'tsundoku.test',
		TSUNDOKU_E2E_CLOCK: at.clock,
		NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(clockModule).href}`
	};
	at.child = spawn(
		'npx',
		['vite', 'preview', '--port', String(at.port), '--strictPort', '--host', '127.0.0.1'],
		{ env, stdio: 'ignore' }
	);
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${at.computer}/manifest.webmanifest`)).ok) return;
		} catch {
			// Not up yet.
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`the ${at.computer} preview never answered`);
}

/** Moves a server's clock to `ms` past the real one; waits out the module's 50 ms reread. */
async function clockAt(at: Server, ms: number) {
	writeFileSync(at.clock, String(ms));
	await new Promise((r) => setTimeout(r, 200));
}

let browser: Browser;
/** The computer's own browser: a pointer, no TV flags, for SETTINGS' DEVICES row. */
let desk: Browser;
const computers = new Map<Server, APIRequestContext>();
const session = createHash('sha256').update(`tsundoku/v1:${E2E_TOKEN}`).digest('hex');

test.beforeAll(async () => {
	if (!tvProject()) return;
	test.setTimeout(150_000);
	writeFileSync(clockModule, CLOCK_JS);
	await Promise.all([serve(A), serve(B)]);
	// The TV's jar: one host for both servers, as a WebView keeps it.
	browser = await chromium.launch({
		args: [
			'--host-resolver-rules=MAP tsundoku.test 127.0.0.1',
			'--blink-settings=availablePointerTypes=none,availableHoverTypes=none'
		]
	});
	desk = await chromium.launch();
	for (const at of [A, B])
		computers.set(
			at,
			await request.newContext({
				baseURL: at.computer,
				extraHTTPHeaders: { cookie: `tsundoku_session=${session}` }
			})
		);
});

test.afterAll(async () => {
	for (const c of computers.values()) await c.dispose().catch(() => {});
	await browser?.close().catch(() => {});
	await desk?.close().catch(() => {});
	for (const at of [A, B]) {
		at.child?.kill();
		at.child = null;
		for (const f of [at.db, `${at.db}-wal`, `${at.db}-shm`, at.clock]) rmSync(f, { force: true });
		rmSync(`${at.db}.home`, { recursive: true, force: true });
	}
	rmSync(clockModule, { force: true });
});

test.beforeEach(() => {
	test.skip(!tvProject(), 'the TV’s own pages, on servers this file stands up once');
});

const opened: BrowserContext[] = [];
test.afterEach(async () => {
	for (const c of opened.splice(0)) await c.close().catch(() => {});
	for (const at of [A, B]) await clockAt(at, 0);
});

/** A TV: an empty jar, 960x540, no pointer. */
async function tv(): Promise<{ context: BrowserContext; page: Page }> {
	const context = await browser.newContext({
		viewport: { width: 960, height: 540 },
		locale: 'en-US'
	});
	opened.push(context);
	return { context, page: await context.newPage() };
}

type TvCode = { code: string | null; state: string; minutes: number; left: number };
/** The code as the computer reads it (`/api/pair/tv`, 127.0.0.1 only). */
const codeOn = async (at: Server) =>
	(await (await computers.get(at)!.get('/api/pair/tv')).json()) as TvCode;
/** NEW CODE on the computer. */
const newCode = async (at: Server) =>
	(await (
		await computers.get(at)!.post('/api/pair/tv', { data: { action: 'code' } })
	).json()) as TvCode;

const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

async function openPairing(page: Page, at: Server) {
	await page.goto(`${at.tv}/pair/tv`);
	await hydrated(page);
}

/** Six digits typed: the sixth submits the form itself, as on 9C. */
const typeCode = (page: Page, code: string) => page.locator('input[name="code"]').fill(code);

async function pair(page: Page, at: Server) {
	const { code } = await newCode(at);
	await openPairing(page, at);
	await typeCode(page, code!);
	await expect(page.getByRole('heading', { name: 'The library is on this TV' })).toBeVisible();
}

/** Whether the TV's jar signs it in on that server: the library, not /login. */
async function signedIn(page: Page, at: Server) {
	const r = await page.goto(`${at.tv}/`);
	return r!.ok() && !new URL(page.url()).pathname.startsWith('/login');
}

const paired = (port: number) => `tsundoku_paired_${port}`;

// ---- c531 round 2: a client-side visit with no code at all ---------------------

/**
 * The library in the computer's browser, opened as a document: SETTINGS is
 * then reached only by the app's own links, a client-side navigation whose
 * load is a data request and makes no code (c531).
 */
async function libraryOn(at: Server) {
	const context = await desk.newContext({
		viewport: { width: 1280, height: 800 },
		locale: 'en-US'
	});
	opened.push(context);
	await context.addCookies([
		{ name: 'tsundoku_session', value: session, domain: '127.0.0.1', path: '/' }
	]);
	const page = await context.newPage();
	await page.goto(`${at.computer}/`);
	await hydrated(page);
	return page;
}

/** The library's MORE › SETTINGS, by click. */
async function moreSettings(page: Page) {
	await page.getByRole('button', { name: 'MORE', exact: true }).click();
	await page.locator('a[href="/settings"]').filter({ visible: true }).first().click();
	await page.waitForURL((u) => u.pathname === '/settings');
	await hydrated(page);
}

const renewPost = (u: URL) => u.pathname === '/settings' && u.search === '?/renew';

// First in the file, on purpose: server A has made no code yet, the state a
// restart leaves the owner's tailnet install in.
test('with no code at all, the library’s MORE › SETTINGS makes the code and draws it, and a reload of the data keeps it (c531 round 2)', async () => {
	expect((await codeOn(A)).state, 'a fresh server has no code').toBe('none');
	const page = await libraryOn(A);
	expect((await codeOn(A)).state, 'the library makes no code').toBe('none');
	await moreSettings(page);
	await expect(page.getByText('FOR A TV · SIX DIGITS')).toBeVisible();
	await expect.poll(() => shownDigits(page)).toMatch(/^\d{6}$/);
	const made = await codeOn(A);
	expect(made).toMatchObject({ state: 'live', left: 5 });
	expect(await shownDigits(page)).toBe(made.code);

	// A reload of the page's data (an unrelated setting): the same code.
	const mode = page
		.locator('.row', { has: page.locator('.label', { hasText: /^MODE$/ }) })
		.getByRole('group', { name: 'MANGA' });
	for (const choice of ['L→R', 'R→L']) {
		const reloaded = reloadOfData(page);
		await mode.getByRole('button', { name: choice }).click();
		await reloaded;
		await expect(mode.getByRole('button', { name: choice })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect((await codeOn(A)).code, `after ${choice}`).toBe(made.code);
		expect(await shownDigits(page)).toBe(made.code);
	}
});

// On server B, which no case before c530's makes a code on.
test('with no code and `?/renew` unanswered, the DEVICES row is still drawn, and its NEW CODE makes one (c531 round 2)', async () => {
	expect((await codeOn(B)).state, 'B has made no code yet').toBe('none');
	const page = await libraryOn(B);
	// The page's own `?/renew` refused: what the row draws from the load
	// alone, which made no code.
	await page.route(renewPost, (r) => r.abort());
	const refused = page.waitForRequest((r) => renewPost(new URL(r.url())));
	await moreSettings(page);
	await refused;
	await expect(page.getByText('FOR A TV · SIX DIGITS')).toBeVisible();
	await expect(page.locator('.pair-tv .tvcode.dim')).toHaveText('—');
	await expect(page.getByText('EXPIRED · MAKE A NEW CODE')).toBeVisible();
	await expect(page.getByLabel('Pairing code for a TV')).toHaveCount(0);
	expect((await codeOn(B)).state).toBe('none');
	await page.unroute(renewPost);

	await page.locator('.pair-foot').getByRole('button', { name: 'NEW CODE' }).click();
	await expect.poll(() => shownDigits(page)).toMatch(/^\d{6}$/);
	const made = await codeOn(B);
	expect(made.state).toBe('live');
	expect(await shownDigits(page)).toBe(made.code);
});

// ---- c246 ---------------------------------------------------------------------

test('an expired code is made new when the TV opens /pair/tv, and it pairs (c246)', async () => {
	const made = await newCode(A);
	expect(made.state).toBe('live');
	// Past the code's 10 minutes: what the first real TV found after 25.
	await clockAt(A, 10 * 60_000 + 5_000);
	expect((await codeOn(A)).state).toBe('expired');

	const { page } = await tv();
	await openPairing(page, A);
	// No THIS CODE EXPIRED: a new code, live, and the digits can be typed.
	await expect(page.getByText('02 — THE SIX DIGITS ON THE COMPUTER')).toBeVisible();
	await expect(page.locator('.band')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'PAIR →' })).toBeEnabled();
	const now = await codeOn(A);
	expect(now).toMatchObject({ state: 'live', left: 5 });
	expect(now.code).not.toBe(made.code);

	// What the computer's DEVICES row asks on its next refresh: the new digits.
	const row = await computers.get(A)!.get('/settings/tv');
	expect(((await row.json()) as { tv: { code: string; state: string } }).tv).toMatchObject({
		code: now.code,
		state: 'live'
	});
	// A second opening makes nothing more: the live code is kept.
	await openPairing(page, A);
	expect((await codeOn(A)).code).toBe(now.code);

	await typeCode(page, now.code!);
	await expect(page.getByRole('heading', { name: 'The library is on this TV' })).toBeVisible();
});

test('a used code is kept while the computer shows ✓ USED, then made new for another TV (c246)', async () => {
	const { page: first } = await tv();
	await pair(first, A);
	const used = await codeOn(A);
	expect(used.state).toBe('used');

	// A second TV, a minute later: the computer is still turning ✓ USED.
	await clockAt(A, 60_000);
	const { page: second } = await tv();
	await openPairing(second, A);
	await expect(second.locator('.band')).toContainText('THIS CODE IS USED');
	expect((await codeOn(A)).code).toBe(used.code);

	// Past the 2 minutes ✓ USED stays up: the second TV gets a code of its own.
	await clockAt(A, 2 * 60_000 + 5_000);
	await openPairing(second, A);
	await expect(second.locator('.band')).toHaveCount(0);
	const next = await codeOn(A);
	expect(next.state).toBe('live');
	expect(next.code).not.toBe(used.code);
	await typeCode(second, next.code!);
	await expect(second.getByRole('heading', { name: 'The library is on this TV' })).toBeVisible();
});

test('a code that runs out while 9C is up says the new one is on the computer (c246)', async () => {
	const made = await newCode(A);
	const { page } = await tv();
	await openPairing(page, A);
	await clockAt(A, 10 * 60_000 + 5_000);
	// The digits the TV had, typed after they ran out: refused, and a new code made.
	await typeCode(page, made.code!);
	await expect(page.locator('.band')).toContainText('THAT CODE EXPIRED');
	await expect(page.locator('.band')).toContainText('THE NEW ONE IS ON THE COMPUTER');
	await hydrated(page);
	const now = await codeOn(A);
	expect(now.state).toBe('live');
	expect(now.code).not.toBe(made.code);
	await typeCode(page, now.code!);
	await expect(page.getByRole('heading', { name: 'The library is on this TV' })).toBeVisible();
});

test('a burned code stays burned, even after its 10 minutes, until the computer makes one (c246)', async () => {
	const made = await newCode(A);
	const { page } = await tv();
	await openPairing(page, A);
	// Each wrong try reloads 9C, so the next is typed once it has hydrated.
	for (let left = 4; left >= 0; left -= 1) {
		await typeCode(page, wrong(made.code!));
		await page.waitForURL(left > 0 ? new RegExp(`r=wrong&left=${left}$`) : /r=burned$/);
		await hydrated(page);
	}
	await expect(page.locator('.band')).toContainText('NO TRIES LEFT');

	for (const later of [60_000, 10 * 60_000 + 5_000, 60 * 60_000]) {
		await clockAt(A, later);
		await openPairing(page, A);
		await expect(page.locator('.band'), `${later} ms on`).toContainText('NO TRIES LEFT');
		await expect(page.locator('.band')).toContainText('MAKE A NEW CODE ON THE COMPUTER');
		await expect(page.getByRole('button', { name: 'PAIR →' })).toBeDisabled();
		const still = await codeOn(A);
		expect(still.code, `${later} ms on`).toBe(made.code);
		expect(still.left).toBe(0);
	}

	// The computer's NEW CODE is the way out.
	const fresh = await newCode(A);
	await openPairing(page, A);
	await expect(page.locator('.band')).toHaveCount(0);
	await typeCode(page, fresh.code!);
	await expect(page.getByRole('heading', { name: 'The library is on this TV' })).toBeVisible();
});

// ---- c246, the computer's half ----------------------------------------------

/**
 * The owner's SETTINGS on a server, in the computer's browser, signed in with
 * the suite's token: the DEVICES row with the TV's six digits (c245). At
 * 127.0.0.1, as the owner's own browser on the computer would be; the row
 * itself is drawn wherever the server's ORIGIN makes a TV's cookie a door.
 */
async function settingsOn(at: Server) {
	const context = await desk.newContext({
		viewport: { width: 1280, height: 800 },
		locale: 'en-US'
	});
	opened.push(context);
	await context.addCookies([
		{ name: 'tsundoku_session', value: session, domain: '127.0.0.1', path: '/' }
	]);
	const page = await context.newPage();
	await page.goto(`${at.computer}/settings#s-devices`);
	await hydrated(page);
	await expect(page.getByText('FOR A TV · SIX DIGITS')).toBeVisible();
	return page;
}

/** The six digits the DEVICES row draws, or null when it draws none. */
async function shownDigits(page: Page) {
	const code = page.getByLabel('Pairing code for a TV');
	if ((await code.count()) === 0) return null;
	return ((await code.textContent()) ?? '').replace(/\D/g, '');
}

/**
 * Counts every focus and visibility event the page sees from here on: the
 * row also refreshes on those (c265), and this file's cases are about what
 * its own tick does while the owner never leaves the window.
 */
async function countReturns(page: Page) {
	await page.evaluate(() => {
		const w = window as unknown as { returns: number };
		w.returns = 0;
		addEventListener('focus', () => (w.returns += 1), true);
		document.addEventListener('visibilitychange', () => (w.returns += 1), true);
	});
	return () => page.evaluate(() => (window as unknown as { returns: number }).returns);
}

test('the DEVICES row draws the code the TV made in place of an expired one, on its own tick (c246)', async () => {
	const made = await newCode(A);
	const page = await settingsOn(A);
	expect(await shownDigits(page)).toBe(made.code);
	const returns = await countReturns(page);

	// The code runs out while SETTINGS stays open: the row's tick says so.
	await clockAt(A, 10 * 60_000 + 5_000);
	await expect(page.locator('.pair-tv .tvcode.dim')).toHaveText('EXPIRED', { timeout: 15_000 });
	await expect(page.getByText('EXPIRED · MAKE A NEW CODE')).toBeVisible();

	// The TV opens /pair/tv and makes a new one: THE NEW ONE IS ON THE COMPUTER.
	const { page: onTv } = await tv();
	await openPairing(onTv, A);
	await expect(onTv.locator('.band')).toHaveCount(0);
	const now = await codeOn(A);
	expect(now.state).toBe('live');
	expect(now.code).not.toBe(made.code);

	// And the computer's row draws it by itself, within a tick or two.
	await expect.poll(() => shownDigits(page), { timeout: 15_000 }).toBe(now.code);
	await expect(page.getByText('EXPIRED · MAKE A NEW CODE')).toHaveCount(0);
	expect(await returns(), 'no focus or visibility change helped').toBe(0);

	// The next state: the TV types those digits, and the row turns ✓ USED.
	await typeCode(onTv, now.code!);
	await expect(onTv.getByRole('heading', { name: 'The library is on this TV' })).toBeVisible();
	await expect(page.locator('.pair-tv .tvcode.dim')).toHaveText('✓ USED', { timeout: 15_000 });
	expect(await returns()).toBe(0);

	// Round 2: SETTINGS left on ✓ USED, and a second TV past the 2 minutes it
	// stays up. /pair/tv replaces the used code and says THE NEW ONE IS ON THE
	// COMPUTER, so the row must draw it on its own tick too.
	await clockAt(A, 10 * 60_000 + 5_000 + 2 * 60_000 + 5_000);
	const { page: second } = await tv();
	await openPairing(second, A);
	await expect(second.locator('.band')).toHaveCount(0);
	const again = await codeOn(A);
	expect(again.state).toBe('live');
	expect(again.code).not.toBe(now.code);
	await expect.poll(() => shownDigits(page), { timeout: 15_000 }).toBe(again.code);
	expect(await returns(), 'no focus or visibility change helped').toBe(0);
});

// ---- c531: only a real visit renews ------------------------------------------

/**
 * Five wrong tries from a TV, as 9C posts them, at the computer's address: a
 * request of its own, not a page, so no window's focus moves.
 */
async function burnOn(at: Server) {
	const { code } = await codeOn(at);
	const tvSide = await request.newContext({ baseURL: at.computer });
	try {
		for (let i = 0; i < 5; i++) {
			const r = await tvSide.post('/pair/tv', {
				form: { code: wrong(code!) },
				headers: { origin: at.computer, accept: 'text/html' },
				maxRedirects: 0
			});
			expect(r.status()).toBe(303);
		}
	} finally {
		await tvSide.dispose();
	}
	expect(await codeOn(at)).toMatchObject({ code, state: 'burned', left: 0 });
	return code!;
}

/** The row told the code is burned (a refresh on focus) and drawing it so. */
async function rowBurned(page: Page) {
	const asked = page.waitForResponse((r) => new URL(r.url()).pathname === '/settings/tv');
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await asked;
	await expect(page.locator('.pair-tv .tvcode.dim')).toHaveText('BURNED');
	await expect(page.getByText('NO TRIES LEFT · MAKE A NEW CODE')).toBeVisible();
}

/** The row drawing a live code that is the server's, and not `old`. */
async function rowLive(page: Page, at: Server, old: string) {
	await expect.poll(() => shownDigits(page)).toMatch(/^\d{6}$/);
	const now = await codeOn(at);
	expect(now).toMatchObject({ state: 'live', left: 5 });
	expect(now.code).not.toBe(old);
	expect(await shownDigits(page)).toBe(now.code);
}

/** SETTINGS' own ← LIBRARY: a client-side navigation away. */
async function toLibrary(page: Page) {
	await page.locator('a[href="/"]').filter({ visible: true }).first().click();
	await page.waitForURL((u) => u.pathname === '/');
	await hydrated(page);
}

const reloadOfData = (page: Page) =>
	page.waitForResponse((r) => new URL(r.url()).pathname === '/settings/__data.json');

test('a burned code stays burned through a reload of SETTINGS’ data, and a real visit makes a new one (c531)', async () => {
	await newCode(A);
	const page = await settingsOn(A);
	let old = await burnOn(A);
	await rowBurned(page);

	// An unrelated setting changed on the page: `act()`, then `invalidateAll()`.
	const mode = page
		.locator('.row', { has: page.locator('.label', { hasText: /^MODE$/ }) })
		.getByRole('group', { name: 'MANGA' });
	for (const choice of ['L→R', 'R→L']) {
		const reloaded = reloadOfData(page);
		await mode.getByRole('button', { name: choice }).click();
		await reloaded;
		await expect(mode.getByRole('button', { name: choice })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(await codeOn(A), `after ${choice}`).toMatchObject({ code: old, state: 'burned' });
		await expect(page.locator('.pair-tv .tvcode.dim')).toHaveText('BURNED');
	}

	// A real visit, by the app's own doors from another screen (SETTINGS'
	// ← LIBRARY, then the library's MORE › SETTINGS; this browser has no fine
	// pointer, so no sidebar): a client-side navigation, whose load is a data
	// request just like the reloads above.
	await toLibrary(page);
	expect(await codeOn(A), 'another screen makes no code').toMatchObject({
		code: old,
		state: 'burned'
	});
	await page.getByRole('button', { name: 'MORE', exact: true }).click();
	await page.locator('a[href="/settings"]').filter({ visible: true }).first().click();
	await page.waitForURL((u) => u.pathname === '/settings');
	await rowLive(page, A, old);

	// The browser's back button into SETTINGS is a visit too.
	old = await burnOn(A);
	await rowBurned(page);
	await toLibrary(page);
	await page.goBack();
	await page.waitForURL((u) => u.pathname === '/settings');
	await rowLive(page, A, old);

	// And so is the browser's reload: a document, not the page's data.
	old = await burnOn(A);
	await rowBurned(page);
	await page.reload();
	await rowLive(page, A, old);

	// A reload of the data after a visit renews nothing more: the new code is kept.
	const kept = (await codeOn(A)).code;
	const reloaded = reloadOfData(page);
	await mode.getByRole('button', { name: 'L→R' }).click();
	await reloaded;
	expect((await codeOn(A)).code).toBe(kept);
	await mode.getByRole('button', { name: 'R→L' }).click();
});

// ---- c581: burned is burned on both screens ----------------------------------

/**
 * The DEVICES row and `/pair/tv` once a burned code's 10 minutes have run
 * out (c581). `TvPairing.state` asked the clock first, so the row's refresh
 * turned BURNED into EXPIRED and its 5 s poll, which a burned code never
 * needs, started again, while the TV's page still said NO TRIES LEFT.
 */
test('a burned code past its 10 minutes stays BURNED on the DEVICES row, with no 5 s poll, as /pair/tv says (c581)', async () => {
	await newCode(A);
	const page = await settingsOn(A);
	const burned = await burnOn(A);
	await rowBurned(page);

	// Past the code's 10 minutes, and long past them.
	for (const later of [10 * 60_000 + 5_000, 60 * 60_000]) {
		await clockAt(A, later);
		expect(await codeOn(A), `${later} ms on`).toMatchObject({ code: burned, state: 'burned' });
		// The owner comes back to the window: the row asks, and still says BURNED.
		await rowBurned(page);
		await expect(page.getByText('EXPIRED · MAKE A NEW CODE')).toHaveCount(0);

		// And the 5 s poll does not start again: more than two ticks, no ask.
		let asks = 0;
		const count = (r: { url(): string }) => {
			if (new URL(r.url()).pathname === '/settings/tv') asks += 1;
		};
		page.on('request', count);
		// The one fixed wait here asserts that nothing happens (doc/TESTING.md, "Load").
		await page.waitForTimeout(11_000);
		page.off('request', count);
		expect(asks, `${later} ms on: the row's poll asked`).toBe(0);

		// The TV's page says the same about the same code.
		const { page: onTv } = await tv();
		await openPairing(onTv, A);
		await expect(onTv.locator('.band')).toContainText('NO TRIES LEFT');
		await expect(onTv.getByRole('button', { name: 'PAIR →' })).toBeDisabled();
		expect((await codeOn(A)).code).toBe(burned);
	}
	await expect(page.locator('.pair-tv .tvcode.dim')).toHaveText('BURNED');
});

// ---- c545 ---------------------------------------------------------------------

/** MainActivity.kt's PAIRED_JS, the very literal the app runs on 9E. */
const PAIRED_JS = (() => {
	const kt = readFileSync(
		join(process.cwd(), 'android/tv/app/src/main/java/dev/masshiro/tsundoku/tv/MainActivity.kt'),
		'utf8'
	);
	const m = kt.match(/PAIRED_JS =\s*"([^"\\$]*)"/);
	if (!m) throw new Error('PAIRED_JS not found in MainActivity.kt');
	return m[1];
})();

test('9E says the server’s name in data-paired-name, which the app’s PAIRED_JS reads (c545)', async () => {
	const name = (hostname() || 'computer').toUpperCase();
	const { page } = await tv();
	// Not 9E yet: the script says nothing.
	await openPairing(page, A);
	expect(await page.evaluate(PAIRED_JS)).toBe('');

	await pair(page, A);
	await expect(page.locator('main.paired')).toHaveAttribute('data-paired-name', name);
	const said = (await page.evaluate(PAIRED_JS)) as string;
	const [attribute, line] = [said.slice(0, said.indexOf('\n')), said.slice(said.indexOf('\n') + 1)];
	expect(attribute).toBe(name);
	// The first line stays, for an app older than c545 that parses it.
	expect(line).toContain(`PAIRED WITH ${name} · tsundoku.test:${A.port}`);
});

// ---- c530 ---------------------------------------------------------------------

test('two servers on one host keep their own pairing, after the other pairs and after FORGET on the other (c530)', async () => {
	const { context, page } = await tv();
	await pair(page, A);
	await pair(page, B);
	// One jar, one host: both names in it, each with its own token.
	const jar = await context.cookies(`http://tsundoku.test:${A.port}`);
	const names = jar.map((c) => c.name).filter((n) => n.startsWith('tsundoku_paired'));
	expect(names.sort()).toEqual([paired(A.port), paired(B.port)].sort());
	expect(await signedIn(page, A)).toBe(true);
	expect(await signedIn(page, B)).toBe(true);

	// FORGET on B, as the app does it (Forget.expiring, which ForgetTest pins):
	// B's name and the old shared one expired, and nothing of A's.
	await context.addCookies(
		[paired(B.port), 'tsundoku_paired'].map((name) => ({
			name,
			value: '',
			domain: 'tsundoku.test',
			path: '/',
			expires: 1
		}))
	);
	expect(await signedIn(page, A)).toBe(true);
	expect(await signedIn(page, B)).toBe(false);
	// And B paired again stands beside A once more.
	await pair(page, B);
	expect(await signedIn(page, A)).toBe(true);
	expect(await signedIn(page, B)).toBe(true);
});

test('a TV paired before c530, with only the old name, stays paired and is moved to the new one (c530)', async () => {
	// A pairing made the way it is now, then put back under the old shared
	// name in a TV of its own: a jar exactly as a TV paired before this
	// release keeps it. A new context, not the one that paired: 9E's page on A
	// keeps asking A for a moment, and A rightly moves the old name the first
	// time it sees it, before B could be asked (a red under load, wave 22).
	const pairing = await tv();
	await pair(pairing.page, A);
	const token = (await pairing.context.cookies()).find((c) => c.name === paired(A.port))!.value;
	await pairing.context.close();
	const { context, page } = await tv();
	await context.addCookies([
		{ name: 'tsundoku_paired', value: token, domain: 'tsundoku.test', path: '/', httpOnly: true }
	]);

	// B first: the old token is not B's, so B signs nothing in and leaves it.
	expect(await signedIn(page, B)).toBe(false);
	let jar = await context.cookies();
	expect(jar.find((c) => c.name === 'tsundoku_paired')?.value).toBe(token);
	expect(jar.find((c) => c.name === paired(B.port))).toBeUndefined();

	// A: signed in by the old name, and its answer moves it.
	expect(await signedIn(page, A)).toBe(true);
	jar = await context.cookies();
	expect(jar.find((c) => c.name === paired(A.port))?.value).toBe(token);
	expect(jar.find((c) => c.name === 'tsundoku_paired')).toBeUndefined();
	// Moved, and still paired on the next request, by the new name alone.
	expect(await signedIn(page, A)).toBe(true);
	expect(await signedIn(page, B)).toBe(false);
});
