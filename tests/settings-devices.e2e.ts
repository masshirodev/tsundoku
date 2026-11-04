import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, type Browser, type Page, type TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_TOKEN } from '../playwright.config';

/**
 * SETTINGS › 08 — DEVICES' TV row, end to end, on two token installs of this
 * file's own (c264, c265; doc/WIFI.md, "Where they show").
 *
 * - `door`: an `ORIGIN` on a tailnet-like host, as `scripts/serve.ts` sets it,
 *   so a TV's paired cookie is a door and the row draws the six digits.
 * - `bare`: no `ORIGIN` at all, the shape of `yarn run dev`, `vite preview` and
 *   serve.ts's local mode, where the hook refuses every TV's cookie.
 *
 * Their own servers and databases, not the shared preview: the six digits
 * live in the server's memory, one code at a time, and `tv-pair.e2e.ts` spends
 * the shared server's. Both ports come from the OS at load, so nothing here
 * collides with the eight the gate assigns (doc/TESTING.md).
 *
 * Desktop only: the row is the same markup at every width, and every project
 * that loaded this file would otherwise stand up two more servers.
 */
test.describe.configure({ mode: 'serial' });

const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});

type Install = { base: string; db: string; server: ChildProcess | null };
const install = (port: number, name: string): Install => ({
	base: `http://localhost:${port}`,
	db: join(tmpdir(), `tsundoku-e2e-devices-${name}-${process.pid}.sqlite`),
	server: null
});
const door = install(await freePort(), 'door');
const bare = install(await freePort(), 'bare');

async function serve(at: Install, origin: string | null) {
	rmSync(at.db, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: at.db, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const env: NodeJS.ProcessEnv = {
		...process.env,
		DATABASE_PATH: at.db,
		TSUNDOKU_TOKEN: E2E_TOKEN,
		TSUNDOKU_ANILIST: 'off',
		LIBRARY_ROOT: join(tmpdir(), `tsundoku-e2e-devices-empty-${process.pid}`),
		TSUNDOKU_HOME: `${at.db}.home`
	};
	// Whatever the shell had, this install's ORIGIN is the one named here.
	delete env.ORIGIN;
	if (origin) env.ORIGIN = origin;
	const port = new URL(at.base).port;
	at.server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort'], {
		env,
		stdio: 'ignore'
	});
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${at.base}/manifest.webmanifest`)).ok) return;
		} catch {
			// Not up yet.
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`the ${at.base} preview never answered`);
}

const desktop = () => test.info().project.name === 'desktop';

test.beforeAll(async () => {
	if (!desktop()) return;
	await Promise.all([
		serve(door, `http://tsundoku.test:${new URL(door.base).port}`),
		serve(bare, null)
	]);
});

test.afterAll(() => {
	for (const at of [door, bare]) {
		at.server?.kill();
		at.server = null;
		rmSync(at.db, { force: true });
		rmSync(`${at.db}.home`, { recursive: true, force: true });
	}
});

test.beforeEach(() => {
	test.skip(!desktop(), 'the row is the same at every width');
});

/** The owner's SETTINGS on one install, signed in with the suite's token. */
async function settings(browser: Browser, info: TestInfo, at: Install) {
	const context = await browser.newContext({
		storageState: info.project.use.storageState as string,
		baseURL: at.base
	});
	const page = await context.newPage();
	return { page, close: () => context.close() };
}

/** The TV's code as the computer itself reads it (`/api/pair/tv`, localhost only). */
async function tvCode(page: Page) {
	const r = await page.request.get('/api/pair/tv');
	return (await r.json()) as { code: string | null; state: string };
}

/** A fresh live code, made the way a test makes one, not through the row. */
async function freshCode(page: Page) {
	await page.request.post('/api/pair/tv', { data: { action: 'code' } });
}

/** The six digits the row draws, or null when it draws none. */
async function shownDigits(page: Page) {
	const code = page.getByLabel('Pairing code for a TV');
	if ((await code.count()) === 0) return null;
	return ((await code.textContent()) ?? '').replace(/\D/g, '');
}

/**
 * A TV with nothing but the computer's address types six digits on /pair/tv:
 * the form 9C posts, with the same-origin header its own page sends. Not a
 * page of this browser: closing one hands the window's focus back to
 * SETTINGS, which is itself an event the row answers, and would refresh it
 * before the case under test could.
 */
async function typeOnTv(at: Install, codes: string[]) {
	const tv = await request.newContext({ baseURL: at.base });
	try {
		for (const code of codes) {
			const r = await tv.post('/pair/tv', {
				form: { code },
				// A form post, as the TV's WebView sends one: html, not an action's JSON.
				headers: { origin: at.base, accept: 'text/html' },
				maxRedirects: 0
			});
			// The action always answers with a redirect: paired, or the band's reason.
			expect(r.status()).toBe(303);
		}
	} finally {
		await tv.dispose();
	}
}

/**
 * Open the row with the page's timers stopped, so only the event under test
 * can refresh it. `install` alone lets the fake time flow, and the row's own
 * 5 s tick would then rescue a case whose event handler was missing; pausing
 * after the page is up races that flowing time under load ("cannot
 * fast-forward to the past"). So the clock is paused at the moment it is
 * installed, before the page loads, and only `runFor` moves it.
 */
async function openFrozen(page: Page) {
	const at = new Date();
	await page.clock.install({ time: at });
	await page.clock.pauseAt(at);
	await page.goto('/settings#s-devices');
	await expect(page.getByText('FOR A TV · SIX DIGITS')).toBeVisible();
}

test('with no ORIGIN, DEVICES draws no six digits and no door makes them (c264)', async ({
	browser
}, info) => {
	const { page, close } = await settings(browser, info, bare);
	try {
		await page.goto('/settings#s-devices');
		await expect(page.getByText('08 — DEVICES').first()).toBeVisible();
		// The row is the token install's, and this one's TV cookie opens nothing.
		await expect(page.getByText('FOR A TV · SIX DIGITS')).toHaveCount(0);
		await expect(page.getByLabel('Pairing code for a TV')).toHaveCount(0);

		// NEW CODE's action and the row's refresh are refused as the load is: the
		// same door (tvBlockHere), asked from the page as its own button would.
		const answers = await page.evaluate(async () => {
			const action = await fetch('/settings?/tvCode', {
				method: 'POST',
				headers: { 'x-sveltekit-action': 'true' },
				body: new FormData()
			});
			const refresh = await fetch('/settings/tv', { cache: 'no-store' });
			return { action: await action.json(), refresh: await refresh.json() };
		});
		expect(answers.action).toMatchObject({ type: 'failure', status: 403 });
		expect(answers.refresh).toEqual({ tv: null });
		// So the computer holds no TV code at all: nothing above made one.
		expect(await tvCode(page)).toMatchObject({ code: null, state: 'none' });
	} finally {
		await close();
	}

	// The same three doors with a tailnet ORIGIN do draw and make one, so the
	// refusals above are the door's, not the test's.
	const other = await settings(browser, info, door);
	try {
		await other.page.goto('/settings#s-devices');
		await expect(other.page.getByText('FOR A TV · SIX DIGITS')).toBeVisible();
		expect(await shownDigits(other.page)).toMatch(/^\d{6}$/);
		expect(await tvCode(other.page)).toMatchObject({ state: 'live' });
	} finally {
		await other.close();
	}
});

test('a code a TV uses while SETTINGS is open turns USED when the window regains focus (c265)', async ({
	browser
}, info) => {
	const { page, close } = await settings(browser, info, door);
	try {
		await freshCode(page);
		await openFrozen(page);
		const code = await shownDigits(page);
		expect(code).toMatch(/^\d{6}$/);

		await typeOnTv(door, [code!]);
		await expect.poll(async () => (await tvCode(page)).state).toBe('used');
		// Nothing has told the page yet: this is the defect the card names.
		expect(await shownDigits(page)).toBe(code);

		// The owner comes back to the window. No NEW CODE press.
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await expect(page.getByLabel('Pairing code for a TV')).toHaveCount(0);
		await expect(page.locator('.pair-tv .tvcode.dim')).toHaveText('✓ USED');
		await expect(page.getByText('✓ USED · ONE TV, ONCE')).toBeVisible();
	} finally {
		await close();
	}
});

/**
 * Wait for the row's next answer from `GET /settings/tv`, armed before the
 * event that should cause it. Without it, "the server's code is unchanged"
 * could be read before the refresh had even asked, and pass for that reason.
 */
const rowAsks = (page: Page) =>
	page.waitForResponse((r) => new URL(r.url()).pathname === '/settings/tv');

/** Five wrong guesses from a TV, never the code itself: the last one burns it. */
async function burn(page: Page, code: string) {
	const wrong = code === '000000' ? '111111' : '000000';
	await typeOnTv(door, [wrong, wrong, wrong, wrong, wrong]);
	await expect.poll(async () => (await tvCode(page)).state).toBe('burned');
	// Nothing has told the page yet: it still draws the burned code as live.
	expect(await shownDigits(page)).toBe(code);
}

/** The row draws BURNED and no digits at all. */
async function showsBurned(page: Page) {
	await expect(page.getByText('NO TRIES LEFT · MAKE A NEW CODE')).toBeVisible();
	await expect(page.locator('.pair-tv .tvcode.dim')).toHaveText('BURNED');
	await expect(page.getByLabel('Pairing code for a TV')).toHaveCount(0);
}

test('a code a TV burns while SETTINGS is open shows BURNED, and stays burned until NEW CODE (c265)', async ({
	browser
}, info) => {
	const { page, close } = await settings(browser, info, door);
	try {
		await freshCode(page);
		await openFrozen(page);
		const code = (await shownDigits(page))!;
		expect(code).toMatch(/^\d{6}$/);
		await burn(page, code);

		// The tab comes back into view: the row reads the code as it is.
		let asked = rowAsks(page);
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await asked;
		await showsBurned(page);
		expect(await tvCode(page)).toMatchObject({ code, state: 'burned' });

		// Time passes and the owner comes back again. Neither may make a code:
		// a refresh that replaced a burned one would hand a guesser five more
		// tries every time the open page asked.
		await page.clock.runFor(15_000);
		asked = rowAsks(page);
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await asked;
		await showsBurned(page);
		expect(await tvCode(page)).toMatchObject({ code, state: 'burned' });

		// NEW CODE is what brings a live code back.
		await page.getByRole('button', { name: 'NEW CODE' }).click();
		await expect.poll(() => shownDigits(page)).toMatch(/^\d{6}$/);
		const now = await tvCode(page);
		expect(now.state).toBe('live');
		expect(now.code).not.toBe(code);
		expect(await shownDigits(page)).toBe(now.code);
		await expect(page.getByText('NO TRIES LEFT · MAKE A NEW CODE')).toHaveCount(0);
	} finally {
		await close();
	}
});

test("the row's own tick shows a burned code as BURNED and makes no new one (c265)", async ({
	browser
}, info) => {
	const { page, close } = await settings(browser, info, door);
	try {
		await freshCode(page);
		await openFrozen(page);
		const code = (await shownDigits(page))!;
		await burn(page, code);

		// No focus, no visibility change: SETTINGS stays in front, and only the
		// 5 s poll asks.
		const asked = rowAsks(page);
		await page.clock.runFor(5_000);
		await asked;
		await showsBurned(page);
		expect(await tvCode(page)).toMatchObject({ code, state: 'burned' });

		// And it stops asking once the row is not live: another 15 s, no request.
		let more = 0;
		page.on('request', (r) => {
			if (new URL(r.url()).pathname === '/settings/tv') more += 1;
		});
		await page.clock.runFor(15_000);
		expect(more).toBe(0);
		expect(await tvCode(page)).toMatchObject({ code, state: 'burned' });
	} finally {
		await close();
	}
});

test('a code a TV uses while SETTINGS stays in front turns USED within a tick (c265)', async ({
	browser
}, info) => {
	const { page, close } = await settings(browser, info, door);
	try {
		await freshCode(page);
		await openFrozen(page);
		const code = await shownDigits(page);
		await typeOnTv(door, [code!]);
		await expect.poll(async () => (await tvCode(page)).state).toBe('used');
		expect(await shownDigits(page)).toBe(code);

		// No focus, no visibility change: the owner never left the window while
		// typing on the TV. The row's own 5 s tick is what notices.
		await page.clock.runFor(5_000);
		await expect(page.locator('.pair-tv .tvcode.dim')).toHaveText('✓ USED');
	} finally {
		await close();
	}
});

test('the row asks every 5 s while live, and the 15 s countdown does not reset that (c265)', async ({
	browser
}, info) => {
	const { page, close } = await settings(browser, info, door);
	try {
		await freshCode(page);
		await openFrozen(page);
		const code = await shownDigits(page);
		let asked = 0;
		page.on('request', (r) => {
			if (new URL(r.url()).pathname === '/settings/tv') asked += 1;
		});
		// 30 s is six polls. An interval rebuilt by each 15 s countdown tick
		// starts over at 15 and 30, and loses one poll in three: four.
		await page.clock.runFor(30_000);
		await expect.poll(() => asked).toBe(6);
		// Asking changed nothing: the same live code, drawn and held.
		expect(await tvCode(page)).toMatchObject({ code, state: 'live' });
		expect(await shownDigits(page)).toBe(code);
	} finally {
		await close();
	}
});
