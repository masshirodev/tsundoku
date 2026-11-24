import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices, type CDPSession, type Page } from '@playwright/test';
import { E2E_TOKEN } from '../playwright.config';
import { expect, test, waitsForHydration } from './fixtures';
import { startPreview } from './highlights-preview';
import { HOST_ARGS } from './helpers/host-args';

/**
 * Commands in every top search bar, in BROWSE's world so the
 * source and EXTENSIONS bars can be driven with their fake engine. A leading
 * `/` runs the library's own command (`/api/command`, the same `runCommand`
 * its `?/command` action calls) and the screen stays where it was; anything
 * else is still the bar's own filter. The cases that enrol Chromium's virtual
 * authenticator run in a world of their own (at the end of this file):
 * while a gate stands on a database, `/reveal` takes the gated path for every
 * browser on it, so it must not stand on the one every `browse-*` file shares.
 */

// A TV case launches a Chromium of its own, and a gate case makes two gotos
// and a WebAuthn prompt: more than a default case's 30 seconds.
test.describe.configure({ timeout: 120_000 });

/** A search box's own answer to a command: Enter, exactly as a keyboard does. */
async function enter(page: Page, box: ReturnType<Page['getByRole']>, text: string) {
	await box.fill(text);
	await box.press('Enter');
}

test('EXTENSIONS: /reveal runs from its bar and the list stays where it was', async ({ page }) => {
	await page.goto('/browse/extensions?tab=available');
	const box = page.getByRole('searchbox', { name: 'Search the available extensions' });
	await enter(page, box, '/reveal');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await expect(page).toHaveURL(/\/browse\/extensions\?tab=available$/);

	await enter(page, box, '/hide');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
	await expect(page).toHaveURL(/\/browse\/extensions\?tab=available$/);
});

test("BROWSE's search: /reveal runs there too", async ({ page }) => {
	await page.goto('/downloads/search');
	const box = page.getByRole('searchbox', { name: 'Search' });
	await enter(page, box, '/reveal');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await expect(page).toHaveURL(/\/downloads\/search$/);

	await enter(page, box, '/hide');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
});

test("a source's bar: /reveal runs and the source stays open", async ({ page }) => {
	await page.goto('/browse/100');
	const box = page.getByRole('searchbox', { name: 'Search Open Source' });
	await enter(page, box, '/reveal');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	// The screen's own path is kept; `pages` may grow under it as it scrolls on.
	expect(new URL(page.url()).pathname).toBe('/browse/100');

	await enter(page, box, '/hide');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
});

test('an unknown command says so, and a query still filters the bar', async ({ page }) => {
	await page.goto('/browse/extensions?tab=available');
	const box = page.getByRole('searchbox', { name: 'Search the available extensions' });
	await enter(page, box, '/rev');
	await expect(page.getByText('UNKNOWN COMMAND · /REV · NOTHING CHANGED')).toBeVisible();
	await expect(page).toHaveURL(/\/browse\/extensions\?tab=available$/);

	// Not a command: the bar's own list, as before.
	await enter(page, box, 'webtoons');
	await expect(page).toHaveURL(/tab=available.*q=webtoons|q=webtoons.*tab=available/);
});

test('/settings opens the page from a bar', async ({ page }) => {
	await page.goto('/browse/extensions?tab=available');
	await enter(
		page,
		page.getByRole('searchbox', { name: 'Search the available extensions' }),
		'/settings'
	);
	await expect(page).toHaveURL(/\/settings$/);
});

test('a go=1 link runs no command, and is taken off the URL', async ({ page }) => {
	// The intent to run on arrival travels in history state; a typed or shared
	// `?go=1` link is not one. The prompt half of the
	// rule, with a device that would answer it, is in the gated world below.
	await page.goto('/search?q=%2Freveal&go=1');
	await expect(page.getByRole('searchbox')).toHaveValue('/reveal');
	await expect(page).toHaveURL(/\/search\?q=%2Freveal$/);
	await expect(page.locator('.band.reveal')).toHaveCount(0);
	await expect(page.locator('.app.revealed')).toHaveCount(0);

	await page.goto('/search?q=%2Fincognito&go=1');
	await expect(page.getByRole('searchbox')).toHaveValue('/incognito');
	await expect(page).toHaveURL(/\/search\?q=%2Fincognito$/);
	await expect(page.getByText('INCOGNITO · NOTHING SAVED')).toHaveCount(0);
});

test('a press while a command runs sends nothing, and an unknown one still says so', async ({
	page
}) => {
	let posts = 0;
	let release = () => {};
	const held = new Promise<void>((done) => (release = done));
	let reached = () => {};
	const arrived = new Promise<void>((done) => (reached = done));
	await page.route('**/api/command', async (route) => {
		posts += 1;
		reached();
		await held;
		await route.continue();
	});

	await page.goto('/browse/extensions?tab=available');
	const box = page.getByRole('searchbox', { name: 'Search the available extensions' });
	await enter(page, box, '/reveal');
	await arrived;

	await box.press('Enter');
	await enter(page, box, '/rev');
	await expect(page.getByText('UNKNOWN COMMAND · /REV · NOTHING CHANGED')).toBeVisible();
	expect(posts).toBe(1);

	release();
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	// The first press's answer landing does not wipe the second's refusal.
	await expect(page.getByText('UNKNOWN COMMAND · /REV · NOTHING CHANGED')).toBeVisible();
	await page.unrouteAll();
	await enter(page, box, '/hide');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
});

test('a command that got no answer lets the next press run', async ({ page }) => {
	await page.route('**/api/command', (route) => route.abort(), { times: 1 });
	await page.goto('/browse/extensions?tab=available');
	const box = page.getByRole('searchbox', { name: 'Search the available extensions' });
	await enter(page, box, '/reveal');
	await expect(page.getByText('THE WORKSTATION DID NOT ANSWER · NOTHING CHANGED')).toBeVisible();
	await box.press('Enter');
	await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	await enter(page, box, '/hide');
	await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
});

/**
 * A television cannot turn reveal on (doc/TV.md). The
 * TV's pointer is set at Chromium's launch, not by a context or a media
 * emulation (playwright.config.ts's `tv` project says why), and the browse
 * project's Galaxy Tab has a coarse one, so a TV case launches its own
 * Chromium with the `tv` project's own arguments and carries this context's
 * sign-in cookie to it. One runner backs every bar, so EXTENSIONS
 * stands for the three -- and only BROWSE has a server with an engine, which
 * EXTENSIONS needs, so the `tv` project's shared preview cannot show it.
 */
async function onATv(page: Page, baseURL: string, body: (screen: Page) => Promise<void>) {
	const browser = await chromium.launch({
		args: [...HOST_ARGS, '--blink-settings=availablePointerTypes=none,availableHoverTypes=none']
	});
	try {
		// A context made in a test inherits the project's own device options
		// (a Galaxy Tab's Android user agent, `isMobile`, touch), which keep
		// the pointer coarse however Chromium was launched; the `tv` project's
		// desktop device replaces them, as it does there.
		const tv = await browser.newContext({
			...devices['Desktop Chrome'],
			baseURL,
			viewport: { width: 960, height: 540 },
			locale: 'en-US',
			storageState: { cookies: await page.context().cookies(), origins: [] }
		});
		// Not the fixture's page, so its waits are given to it here: typed before
		// hydration, a command posted the bar's form without JavaScript and
		// never reached /api/command, which a held route then waited on for good.
		const screen = waitsForHydration(await tv.newPage());
		await body(screen);
	} finally {
		await browser.close();
	}
}

/** What the guard reads, asked of the page itself before trusting it. */
async function isTheTvQuery(screen: Page) {
	expect(
		await screen.evaluate(() => matchMedia('(pointer: none) and (min-width: 900px)').matches)
	).toBe(true);
}

test('on a TV, EXTENSIONS refuses /reveal and no reveal band appears', async ({ page }) => {
	await onATv(page, test.info().project.use.baseURL!, async (screen) => {
		await screen.goto('/browse/extensions?tab=available');
		await isTheTvQuery(screen);
		const box = screen.getByRole('searchbox', { name: 'Search the available extensions' });
		await box.fill('/reveal');
		await box.press('Enter');
		await expect(screen.getByText('NOT ON A TV · TURN REVEAL ON FROM THE COMPUTER')).toBeVisible();
		await expect(screen.locator('.band.reveal')).toHaveCount(0);
		await expect(screen).toHaveURL(/\/browse\/extensions\?tab=available$/);
	});
});

test('on a TV, the refusal still shows while another command runs', async ({ page }) => {
	await onATv(page, test.info().project.use.baseURL!, async (screen) => {
		let release = () => {};
		const held = new Promise<void>((done) => (release = done));
		let reached = () => {};
		const arrived = new Promise<void>((done) => (reached = done));
		await screen.route('**/api/command', async (route) => {
			reached();
			await held;
			await route.continue();
		});
		await screen.goto('/browse/extensions?tab=available');
		await isTheTvQuery(screen);
		const box = screen.getByRole('searchbox', { name: 'Search the available extensions' });
		await enter(screen, box, '/hide');
		await arrived;
		await enter(screen, box, '/reveal');
		await expect(screen.getByText('NOT ON A TV · TURN REVEAL ON FROM THE COMPUTER')).toBeVisible();
		const answered = screen.waitForResponse('**/api/command');
		release();
		await answered;
		// And after /hide's answer lands: it is the earlier press's, not this one's.
		await expect(screen.getByText('NOT ON A TV · TURN REVEAL ON FROM THE COMPUTER')).toBeVisible();
	});
});

// The other two bars, the same rule: a source's page and BROWSE's search.
for (const { name, url, label } of [
	{ name: 'a source’s bar', url: '/browse/100', label: 'Search Open Source' },
	{ name: 'BROWSE’s search', url: '/downloads/search', label: 'Search' }
])
	test(`${name}: a refusal made while a command runs outlives that command’s answer`, async ({
		page
	}) => {
		let release = () => {};
		const held = new Promise<void>((done) => (release = done));
		let reached = () => {};
		const arrived = new Promise<void>((done) => (reached = done));
		await page.route('**/api/command', async (route) => {
			reached();
			await held;
			await route.continue();
		});
		await page.goto(url);
		const box = page.getByRole('searchbox', { name: label });
		await enter(page, box, '/reveal');
		await arrived;
		await enter(page, box, '/rev');
		const refusal = page.getByText('UNKNOWN COMMAND · /REV · NOTHING CHANGED');
		await expect(refusal).toBeVisible();
		release();
		await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
		await expect(refusal).toBeVisible();
		await page.unrouteAll();
		await enter(page, box, '/hide');
		await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
	});

// ---- a gated box, on a database of its own -----------------------------------------

/** The port the OS has free now; `startPreview` says so if another takes it first. */
const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});

/** Stops the world's own server by the child it was started as, and waits until it has gone. */
function stop(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
		child.once('exit', () => {
			clearTimeout(force);
			resolve();
		});
		child.kill();
	});
}

test.describe('a gated box', () => {
	let work = '';
	let base = '';
	let preview: ChildProcess | null = null;
	/** So a teardown that fails cannot be read in place of a case that failed. */
	let bodyFailed = false;
	/** This test's virtual authenticator, kept so the teardown answers for the credential it enrolled. */
	let session: { cdp: CDPSession; id: string } | null = null;

	test.beforeAll(async () => {
		test.setTimeout(120_000);
		work = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-browse-gate-'));
		const database = join(work, 'gate.sqlite');
		const library = join(work, 'library');
		execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
			env: {
				...process.env,
				DATABASE_PATH: database,
				LIBRARY_ROOT: library,
				NODE_NO_WARNINGS: '1'
			},
			stdio: 'pipe'
		});
		const port = await freePort();
		base = `http://localhost:${port}`;
		// `node` itself rather than `npx`, so the pid kept here is the server's.
		preview = await startPreview(
			() =>
				spawn(
					process.execPath,
					['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort'],
					{
						env: {
							...process.env,
							DATABASE_PATH: database,
							TSUNDOKU_TOKEN: E2E_TOKEN,
							// An engine is what makes EXTENSIONS a page at all, and nothing here
							// asks it. A port nothing listens on, not the browse world's fake:
							// browse-flow's `__down` would otherwise reach these cases.
							ENGINE_URL: 'http://127.0.0.1:1',
							ENGINE_TOKEN: 'e2e-engine-token',
							ENGINE_STORE: join(work, 'store'),
							TSUNDOKU_ANILIST: 'off',
							TSUNDOKU_HOME: join(work, 'home'),
							LIBRARY_ROOT: library,
							COVER_DIR: join(work, 'covers'),
							BACKUP_DIR: join(work, 'backups')
						},
						stdio: 'ignore'
					}
				),
			base,
			'the gated box’s preview'
		);
	});

	test.afterAll(async () => {
		const failures: unknown[] = [];
		if (preview) await stop(preview).catch((e: unknown) => failures.push(e));
		try {
			if (work) rmSync(work, { recursive: true, force: true });
		} catch (e) {
			failures.push(e);
		}
		if (failures.length && !bodyFailed) throw failures[0];
	});

	test.beforeEach(() => {
		session = null;
	});

	async function authenticator(page: Page): Promise<{ cdp: CDPSession; id: string }> {
		if (session) return session;
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('WebAuthn.enable');
		const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
			options: {
				protocol: 'ctap2',
				transport: 'internal',
				hasResidentKey: true,
				hasUserVerification: true,
				isUserVerified: true,
				automaticPresenceSimulation: true
			}
		});
		session = { cdp, id: authenticatorId };
		return session;
	}

	/** The next case in this world starts with no gate, whatever this one did. */
	test.afterEach(async ({ page }, info) => {
		if (info.status !== info.expectedStatus) bodyFailed = true;
		const { cdp, id } = await authenticator(page);
		// A case that left a refusing sensor behind must not keep the gate up.
		await cdp.send('WebAuthn.setUserVerified', { authenticatorId: id, isUserVerified: true });
		await page.goto(`${base}/search`);
		await page.getByRole('searchbox').fill('/unlock');
		await page.keyboard.press('Enter');
		// With no gate it says NO LOCK; with one it asks this device (which answers).
		await expect(page.getByText(/UNLOCKED · \/reveal ASKS NOTHING|NO LOCK · \/reveal ASKS NOTHING/))
			.toBeVisible({ timeout: 8_000 })
			.catch(() => undefined);
	});

	/** A box behind the gate, this browser's device enrolled and reveal off. */
	async function gateTheBox(page: Page) {
		await authenticator(page);
		// /lock's rule: only an unlocked session adds a device (doc/PRIVACY.md).
		await page.goto(`${base}/search`);
		await page.getByRole('searchbox').fill('/reveal');
		await page.keyboard.press('Enter');
		await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();

		// As unlock-gate.e2e.ts drives it: a fresh /search, then the command.
		await page.goto(`${base}/search`);
		await page.getByRole('searchbox').fill('/lock');
		await page.keyboard.press('Enter');
		await expect(page.getByText('LOCKED · /reveal NOW ASKS THIS DEVICE')).toBeVisible();

		// Reveal off, but the gate stays on.
		await page.goto(`${base}/search`);
		await page.getByRole('searchbox').fill('/hide');
		await page.keyboard.press('Enter');
		await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
	}

	test('a gated /reveal from EXTENSIONS raises the device prompt, and reveal turns on', async ({
		page,
		browser
	}) => {
		await gateTheBox(page);

		// What this world is for: with this gate standing, the database every other
		// `browse-*` file shares has none, so a browser there still reveals at once.
		// A context of its own, because a reveal cookie is not scoped to a port.
		const shared = await browser.newContext({
			...devices['Desktop Chrome'],
			baseURL: test.info().project.use.baseURL,
			storageState: { cookies: await page.context().cookies(), origins: [] }
		});
		try {
			const elsewhere = await shared.newPage();
			await elsewhere.goto('/search');
			await elsewhere.getByRole('searchbox').fill('/reveal');
			await elsewhere.keyboard.press('Enter');
			await expect(elsewhere.getByText('HIDDEN SHOWN')).toBeVisible();
		} finally {
			await shared.close();
		}

		const asked = promptsAsked(page);
		await page.goto(`${base}/browse/extensions?tab=available`);
		await enter(
			page,
			page.getByRole('searchbox', { name: 'Search the available extensions' }),
			'/reveal'
		);
		// Through the device, as /search's own /reveal ends: on the library.
		await expect(page).toHaveURL(`${base}/`);
		await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
		expect(asked).toEqual(['reveal']);

		// The entry it ran from is spent: back onto it asks nothing again.
		await page.goBack();
		await expect(page).toHaveURL(/\/search\?q=%2Freveal$/);
		await expect(page.getByRole('searchbox')).toHaveValue('/reveal');
		await settled(page);
		expect(asked).toEqual(['reveal']);
		expect(await page.evaluate(() => history.state['sveltekit:states'])).toEqual({});
		await page.reload();
		await settled(page);
		expect(asked).toEqual(['reveal']);

		// The device that enrolled takes the gate away again.
		await page.goto(`${base}/search`);
		await page.getByRole('searchbox').fill('/unlock');
		await page.keyboard.press('Enter');
		await expect(page.getByText('UNLOCKED · /reveal ASKS NOTHING')).toBeVisible();
	});

	test('a refused fingerprint from a bar shows nothing, and only a new press asks again', async ({
		page
	}) => {
		await gateTheBox(page);
		const { cdp, id } = await authenticator(page);
		const asked = promptsAsked(page);
		await cdp.send('WebAuthn.setUserVerified', { authenticatorId: id, isUserVerified: false });

		await page.goto(`${base}/browse/extensions?tab=available`);
		await enter(
			page,
			page.getByRole('searchbox', { name: 'Search the available extensions' }),
			'/reveal'
		);
		await expect(page.getByText('NOT UNLOCKED')).toBeVisible();
		await expect(page).toHaveURL(/\/search\?q=%2Freveal$/);
		await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);
		expect(asked).toEqual(['reveal']);

		// Away and back through history: nothing reruns behind the user's back.
		await page.goBack();
		await expect(
			page.getByRole('searchbox', { name: 'Search the available extensions' })
		).toBeVisible();
		await page.goForward();
		await expect(page).toHaveURL(/\/search\?q=%2Freveal$/);
		await expect(page.getByRole('searchbox')).toHaveValue('/reveal');
		await settled(page);
		expect(asked).toEqual(['reveal']);
		await expect(page.getByText('NOT UNLOCKED')).toHaveCount(0);

		// Enter is the second press; it runs one ceremony, and this one passes.
		await cdp.send('WebAuthn.setUserVerified', { authenticatorId: id, isUserVerified: true });
		await page.getByRole('searchbox').press('Enter');
		await expect(page).toHaveURL(`${base}/`);
		await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
		expect(asked).toEqual(['reveal', 'reveal']);
	});

	test('a double press on a bar is one run: one POST, one prompt, nothing on the back', async ({
		page
	}) => {
		await gateTheBox(page);
		const asked = promptsAsked(page);
		let prompted = () => {};
		const prompt = new Promise<void>((done) => (prompted = done));
		// The delay gives a held second `goto` time to land on the mounted /search.
		await page.route('**/api/unlock/options', async (route) => {
			prompted();
			await new Promise((done) => setTimeout(done, 600));
			await route.continue();
		});
		let posts = 0;
		await page.route('**/api/command', async (route) => {
			posts += 1;
			if (posts > 1) await prompt;
			await route.continue();
		});

		await page.goto(`${base}/browse/extensions?tab=available`);
		const box = page.getByRole('searchbox', { name: 'Search the available extensions' });
		await box.fill('/reveal');
		await box.evaluate((el) => {
			const form = (el as HTMLInputElement).form!;
			form.requestSubmit();
			form.requestSubmit();
		});

		await expect(page).toHaveURL(`${base}/`);
		await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
		expect(asked).toEqual(['reveal']);

		await page.goBack();
		await expect(page).toHaveURL(/\/search\?q=%2Freveal$/);
		await expect(page.getByRole('searchbox')).toHaveValue('/reveal');
		await settled(page);
		expect(asked).toEqual(['reveal']);
		expect(posts).toBe(1);
	});

	test('a press during a running ceremony starts no other', async ({ page }) => {
		await gateTheBox(page);
		const asked = promptsAsked(page);
		await page.route('**/api/unlock/options', async (route) => {
			await new Promise((done) => setTimeout(done, 600));
			await route.continue();
		});
		await page.goto(`${base}/search`);
		const box = page.getByRole('searchbox');
		await box.fill('/reveal');
		await box.evaluate((el) => {
			const form = (el as HTMLInputElement).form!;
			form.requestSubmit();
			form.requestSubmit();
		});
		await expect(page).toHaveURL(`${base}/`);
		await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
		expect(asked).toEqual(['reveal']);
	});

	test('an options request that never answers ends the wait, and a new press asks again', async ({
		page
	}) => {
		await gateTheBox(page);
		await page.route('**/api/unlock/options', (route) => route.abort(), { times: 1 });
		await page.goto(`${base}/search`);
		const box = page.getByRole('searchbox');
		await box.fill('/reveal');
		await box.press('Enter');
		await expect(page.getByText('NOT UNLOCKED')).toBeVisible();

		await box.press('Enter');
		await expect(page).toHaveURL(`${base}/`);
		await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
	});

	test('a go=1 link for /reveal behind a gate raises no prompt', async ({ page }) => {
		await gateTheBox(page);
		const asked = promptsAsked(page);
		await follow(page, '/search?q=%2Freveal&go=1');
		await expect(page).toHaveURL(/\/search\?q=%2Freveal$/);
		await settled(page);
		expect(asked).toEqual([]);
		await expect(page.getByText('COMMAND · WAITING FOR THE DEVICE')).toHaveCount(0);
		await expect(page.getByText('HIDDEN SHOWN')).toHaveCount(0);

		// A key still runs it: the link is what is inert, not the page.
		await page.getByRole('searchbox').press('Enter');
		await expect(page).toHaveURL(`${base}/`);
		await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
		expect(asked).toEqual(['reveal']);
	});

	test('on a TV, a gated box still refuses /reveal in its own words, before asking', async ({
		page
	}) => {
		await gateTheBox(page);
		await onATv(page, base, async (screen) => {
			const commands: string[] = [];
			screen.on('request', (r) => {
				if (new URL(r.url()).pathname === '/api/command') commands.push(r.method());
			});
			await screen.goto('/browse/extensions?tab=available');
			await isTheTvQuery(screen);
			await enter(
				screen,
				screen.getByRole('searchbox', { name: 'Search the available extensions' }),
				'/reveal'
			);
			await expect(
				screen.getByText('NOT ON A TV · TURN REVEAL ON FROM THE COMPUTER')
			).toBeVisible();
			await expect(screen).toHaveURL(/\/browse\/extensions\?tab=available$/);
			expect(commands).toEqual([]);
		});
	});

	/**
	 * Each ceremony this page starts, as the server is asked for it. The prompt
	 * itself is the browser's and a virtual authenticator answers it at once, so
	 * this POST, not anything drawn, is what says whether one was raised.
	 */
	function promptsAsked(page: Page): string[] {
		const asked: string[] = [];
		page.on('request', (r) => {
			if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/unlock/options') {
				asked.push(String(r.postDataJSON()?.purpose));
			}
		});
		return asked;
	}

	/** Two frames: a submit made on arrival has by then started its POST. */
	const settled = (page: Page) =>
		page.evaluate(
			() =>
				new Promise<void>((done) =>
					requestAnimationFrame(() => requestAnimationFrame(() => done()))
				)
		);

	/**
	 * A typed link, arriving. Not the fixture's `goto`: a ceremony that starts
	 * during the load keeps `networkidle` from ever arriving, so where the bug
	 * is present the case would time out instead of reading the count.
	 */
	const follow = (page: Page, href: string) =>
		page.evaluate((to) => location.assign(to), `${base}${href}`);

	test('a go=1 link raises no prompt, for /lock or /unlock, until a key is pressed', async ({
		page
	}) => {
		await authenticator(page);
		// Revealed, so that a /lock which did run would enrol, not be refused.
		await page.goto(`${base}/search`);
		await page.getByRole('searchbox').fill('/reveal');
		await page.keyboard.press('Enter');
		await expect(page.getByText('HIDDEN SHOWN')).toBeVisible();
		const asked = promptsAsked(page);

		await follow(page, '/search?q=%2Flock&go=1');
		await expect(page).toHaveURL(/\/search\?q=%2Flock$/);
		await settled(page);
		expect(asked).toEqual([]);
		await expect(page.getByText('COMMAND · WAITING FOR THE DEVICE')).toHaveCount(0);
		await expect(page.getByText('LOCKED · /reveal NOW ASKS THIS DEVICE')).toHaveCount(0);

		// The same page does run it for a key, once: the case above is not
		// green because the page was dead.
		const box = page.getByRole('searchbox');
		await expect(box).toHaveValue('/lock');
		await box.press('Enter');
		await expect(page.getByText('LOCKED · /reveal NOW ASKS THIS DEVICE')).toBeVisible();
		expect(asked).toEqual(['enrol']);

		await follow(page, '/search?q=%2Funlock&go=1');
		await expect(page).toHaveURL(/\/search\?q=%2Funlock$/);
		await settled(page);
		expect(asked).toEqual(['enrol']);
		await expect(page.getByText('UNLOCKED · /reveal ASKS NOTHING')).toHaveCount(0);

		// Back onto the link: SvelteKit keeps the address as it was when the
		// entry was replaced, `go=1` included, so it is read a second time.
		await page.getByRole('link', { name: 'Back to library' }).click();
		await expect(page).toHaveURL(`${base}/`);
		await page.goBack();
		await expect(page).toHaveURL(/\/search\?q=%2Funlock$/);
		await expect(page.getByRole('searchbox')).toHaveValue('/unlock');
		await settled(page);
		expect(asked).toEqual(['enrol']);
	});

	test('a command carried from a bar is spent once it has run: the reload, the back, the second press', async ({
		page
	}) => {
		await authenticator(page);
		const asked = promptsAsked(page);
		await page.goto(`${base}/browse/extensions?tab=available`);
		await enter(
			page,
			page.getByRole('searchbox', { name: 'Search the available extensions' }),
			'/lock'
		);
		await expect(page.getByText('LOCKED · /reveal NOW ASKS THIS DEVICE')).toBeVisible();
		expect(asked).toEqual(['enrol']);

		// What the entry holds now: SvelteKit's own key for `page.state`, empty.
		expect(await page.evaluate(() => history.state['sveltekit:states'])).toEqual({});

		await page.reload();
		await expect(page.getByRole('searchbox')).toHaveValue('/lock');
		await settled(page);
		expect(asked).toEqual(['enrol']);
		await expect(page.getByText('LOCKED · /reveal NOW ASKS THIS DEVICE')).toHaveCount(0);

		await page.getByRole('link', { name: 'Back to library' }).click();
		await expect(page).toHaveURL(`${base}/`);
		await page.goBack();
		await expect(page).toHaveURL(/\/search\?q=%2Flock$/);
		await expect(page.getByRole('searchbox')).toHaveValue('/lock');
		await settled(page);
		expect(asked).toEqual(['enrol']);
		await expect(page.getByText('LOCKED · /reveal NOW ASKS THIS DEVICE')).toHaveCount(0);

		// A key is a new request, and it is one: not revealed, so it is refused.
		await page.getByRole('searchbox').press('Enter');
		await expect(
			page.getByText('REVEAL FIRST · ONLY AN UNLOCKED SESSION ADDS A DEVICE')
		).toBeVisible();
		expect(asked).toEqual(['enrol', 'enrol']);
	});

	test('/lock from a bar opens the device prompt on search', async ({ page }) => {
		await authenticator(page);
		await page.goto(`${base}/browse/extensions?tab=available`);
		await enter(
			page,
			page.getByRole('searchbox', { name: 'Search the available extensions' }),
			'/lock'
		);
		// The `go` intent is history state, not a URL parameter, and is taken off
		// before the prompt runs.
		await expect(page).toHaveURL(/\/search\?q=%2Flock$/);
		await expect(page.getByText('LOCKED · /reveal NOW ASKS THIS DEVICE')).toBeVisible();
	});
});
