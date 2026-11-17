import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { makeLogin, writeLogin } from '../src/lib/server/login.ts';
import { homeSubnet } from '../src/lib/server/lan.ts';

/**
 * A firewall on the computer, under WI-FI ON (c721; doc/WIFI.md, "A firewall
 * on the computer"): the line per platform, the commands with the running
 * app's port and the computer's own home network, and NO PHONE HAS REACHED
 * THIS COMPUTER YET appearing while a code waits and clearing when a phone's
 * request arrives.
 *
 * The platform and the probe are the server's, so each case serves an
 * install of its own through scripts/serve.ts in local mode, the real Wi-Fi
 * listeners on this machine's home address, with the e2e's seams set: the
 * platform (`TSUNDOKU_FIREWALL_PLATFORM`), the probe's answer
 * (`TSUNDOKU_FIREWALL_PROBE`) and the 30 s wait shortened
 * (`TSUNDOKU_FIREWALL_QUIET_MS`), none of which a launcher sets. In the
 * friend project: serve.ts is its server already, it is signed out with one
 * worker, and a plain `*.e2e.ts` would stand these up in four device
 * projects. Every install is this file's own, on a port from the OS, with
 * its own database and data folder; the shared friend install is untouched,
 * and no phone paired here is left paired anywhere.
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

type Install = { port: number; base: string; db: string; home: string; server: ChildProcess };

async function serve(env: NodeJS.ProcessEnv): Promise<Install> {
	const port = await freePort();
	const db = join(tmpdir(), `tsundoku-e2e-firewall-${port}.sqlite`);
	const home = `${db}.home`;
	rmSync(db, { force: true });
	rmSync(home, { recursive: true, force: true });
	mkdirSync(join(home, 'library'), { recursive: true });
	// No password: the computer opens straight in, as on the shared friend install.
	writeLogin(home, makeLogin(null));
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: db, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const server = spawn(
		process.execPath,
		['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'scripts/serve.ts'],
		{
			env: {
				...process.env,
				// What the launcher sets (ops/release/launcher/plan.ts), as tests/friend-setup.ts.
				TSUNDOKU_LOGIN: 'password',
				TSUNDOKU_SERVE: 'local',
				TSUNDOKU_SNAPSHOT: 'off',
				TSUNDOKU_PROJECT_ENV: 'off',
				PORT: String(port),
				TSUNDOKU_TOKEN: '',
				TSUNDOKU_UPDATES: 'off',
				DATABASE_PATH: db,
				TSUNDOKU_HOME: home,
				LIBRARY_ROOT: join(home, 'library'),
				BACKUP_DIR: join(home, 'backups'),
				ENGINE_URL: 'http://127.0.0.1:1',
				TSUNDOKU_ANILIST: 'off',
				...env
			},
			stdio: 'ignore'
		}
	);
	const base = `http://localhost:${port}`;
	for (let i = 0; i < 120; i++) {
		try {
			const r = await fetch(`${base}/manifest.webmanifest`);
			if (r.ok && ((await r.json()) as { short_name?: string }).short_name === 'tsundoku')
				return { port, base, db, home, server };
		} catch {
			// Not up yet.
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	server.kill();
	throw new Error(`the firewall install on ${port} never answered`);
}

function stop(at: Install | null) {
	if (!at) return;
	at.server.kill();
	rmSync(at.db, { force: true });
	rmSync(at.home, { recursive: true, force: true });
}

type Wifi = { phone: string | null; code: { url: string; state: string } | null };

/** WI-FI ON from the computer, and the home address it listens on. */
async function switchOn(request: APIRequestContext, at: Install): Promise<string> {
	const r = await request.post(`${at.base}/api/wifi`, { data: { action: 'on' } });
	expect(r.ok()).toBe(true);
	let phone: string | null = null;
	await expect
		.poll(
			async () =>
				(phone = ((await (await request.get(`${at.base}/api/wifi`)).json()) as Wifi).phone),
			{ timeout: 15_000 }
		)
		.toMatch(/^http:\/\//);
	return phone!;
}

async function openPanel(page: Page, at: Install) {
	await page.goto(`${at.base}/settings#s-devices`);
	await expect(page.getByLabel('Pairing', { exact: true })).toBeVisible();
	return page.getByRole('group', { name: 'Firewall' });
}

let at: Install | null = null;
test.afterEach(() => {
	stop(at);
	at = null;
});

test('Linux, no firewall found: the general line, and the two commands with the real port and home network', async ({
	page,
	request
}) => {
	at = await serve({ TSUNDOKU_FIREWALL_PLATFORM: 'linux', TSUNDOKU_FIREWALL_PROBE: 'none' });
	const phone = await switchOn(request, at);
	const ip = new URL(phone).hostname;
	const subnet = homeSubnet(ip);
	// The computer's own network, worked out here from the adapter as the OS
	// reports it, not by the function under test: the address under its mask.
	const nic = Object.values(networkInterfaces())
		.flat()
		.find((a) => a?.family === 'IPv4' && a.address === ip)!;
	const mask = nic.netmask.split('.').map(Number);
	const bits = mask.reduce((n, o) => n + o.toString(2).replace(/0/g, '').length, 0);
	expect(subnet).toBe(
		`${ip
			.split('.')
			.map((o, i) => Number(o) & mask[i])
			.join('.')}/${bits}`
	);
	const fw = await openPanel(page, at);
	await expect(fw).toContainText(
		`IF YOUR COMPUTER RUNS A FIREWALL, LET PORT ${at.port} IN FROM YOUR HOME NETWORK`
	);
	const more = fw.getByRole('button', { name: /THE LINES TO COPY/ });
	await expect(more).toHaveAttribute('aria-expanded', 'false');
	await expect(fw.locator('.fw-cmd')).toHaveCount(0);
	await more.click();
	await expect(more).toHaveAttribute('aria-expanded', 'true');
	await expect(fw.locator('.fw-cmd')).toHaveText([
		`sudo ufw allow from ${subnet} to any port ${at.port} proto tcp`,
		`sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="${subnet}" port port="${at.port}" protocol="tcp" accept' && sudo firewall-cmd --reload`
	]);
	await expect(fw).toContainText(`to let a phone on ${subnet} in`);
	// Neither firewall named: the probe found none, and none is claimed.
	await expect(fw).not.toContainText('IS ON');
	await more.click();
	await expect(fw.locator('.fw-cmd')).toHaveCount(0);
});

for (const [probe, name] of [
	['ufw', 'UFW'],
	['firewalld', 'FIREWALLD']
] as const)
	test(`Linux with ${name} on: it is named, with its one line to copy`, async ({
		page,
		request
	}) => {
		at = await serve({ TSUNDOKU_FIREWALL_PLATFORM: 'linux', TSUNDOKU_FIREWALL_PROBE: probe });
		const phone = await switchOn(request, at);
		const subnet = homeSubnet(new URL(phone).hostname);
		const fw = await openPanel(page, at);
		await expect(fw).toContainText(`${name} IS ON · PORT ${at.port} MAY BE BLOCKED`);
		const cmd = fw.locator('.fw-cmd');
		await expect(cmd).toHaveCount(1);
		await expect(cmd).toContainText(
			probe === 'ufw'
				? `sudo ufw allow from ${subnet} to any port ${at.port} proto tcp`
				: `source address="${subnet}" port port="${at.port}" protocol="tcp"`
		);
		// Its own line is shown at once, with no disclosure to open.
		await expect(fw.getByRole('button')).toHaveCount(0);
	});

test("Windows: its dialog named, and PHONE CAN'T CONNECT? with the fix", async ({
	page,
	request
}) => {
	// A probe answer too, to show Windows never reads one: the platform decides.
	at = await serve({ TSUNDOKU_FIREWALL_PLATFORM: 'win32', TSUNDOKU_FIREWALL_PROBE: 'ufw' });
	await switchOn(request, at);
	const fw = await openPanel(page, at);
	await expect(fw).toContainText(
		'WINDOWS WILL ASK TO LET TSUNDOKU THROUGH ITS FIREWALL · ALLOW IT ON PRIVATE NETWORKS'
	);
	await expect(fw).not.toContainText('UFW');
	await expect(fw).not.toContainText('sudo');
	await fw.getByRole('button', { name: /PHONE CAN'T CONNECT\?/ }).click();
	await expect(fw).toContainText(
		'Windows Security › Firewall & network protection › Allow an app through firewall'
	);
	await expect(fw).toContainText('Private network');
});

test('the general line in Portuguese, for a browser that reads it', async ({
	browser,
	request
}) => {
	at = await serve({ TSUNDOKU_FIREWALL_PLATFORM: 'linux', TSUNDOKU_FIREWALL_PROBE: 'none' });
	await switchOn(request, at);
	const ctx = await browser.newContext({
		locale: 'pt-BR',
		storageState: { cookies: [], origins: [] }
	});
	try {
		const page = await ctx.newPage();
		await page.goto(`${at.base}/settings#s-devices`);
		const fw = page.getByRole('group', { name: 'Firewall' });
		await expect(fw).toContainText(
			`SE O SEU COMPUTADOR TEM UM FIREWALL, LIBERE A PORTA ${at.port} PARA A SUA REDE DE CASA`
		);
		await expect(fw.getByRole('button', { name: /AS LINHAS PARA COPIAR/ })).toBeVisible();
	} finally {
		await ctx.close();
	}
});

/**
 * "Reached" is any request by a Wi-Fi listener from a home-network client
 * since the listeners opened (`noPhoneYet`, src/lib/server/firewall.ts): the
 * sign-in page a typed address opens counts, since it proves the firewall
 * lets a phone in. The wait is 4 s here, not 30, by the seam.
 */
test('NO PHONE HAS REACHED THIS COMPUTER YET appears while the code waits, and clears when a phone reaches it', async ({
	page,
	request,
	playwright
}) => {
	at = await serve({
		TSUNDOKU_FIREWALL_PLATFORM: 'linux',
		TSUNDOKU_FIREWALL_PROBE: 'none',
		TSUNDOKU_FIREWALL_QUIET_MS: '4000'
	});
	const phone = await switchOn(request, at);
	// Not before the wait is over: a code just made has had no time. Asked of
	// the server, which is what decides, rather than raced against the page.
	const fresh = await request.post(`${at.base}/api/wifi`, { data: { action: 'code' } });
	expect(((await fresh.json()) as { noPhoneYet: boolean }).noPhoneYet).toBe(false);
	const fw = await openPanel(page, at);
	const quiet = fw.getByText('NO PHONE HAS REACHED THIS COMPUTER YET · A FIREWALL?');
	// The panel's own 5 s poll draws it, with the commands opened under it.
	await expect(quiet).toBeVisible({ timeout: 15_000 });
	await expect(fw.locator('.fw-cmd')).toHaveCount(2);
	await expect(fw.getByRole('button', { name: /THE LINES TO COPY/ })).toBeDisabled();

	// A phone types the address: the sign-in page, over the Wi-Fi listener.
	const tab = await playwright.request.newContext({ baseURL: phone });
	try {
		const r = await tab.get('/', { maxRedirects: 0 });
		expect([200, 303]).toContain(r.status());
	} finally {
		await tab.dispose();
	}
	await expect(quiet).toHaveCount(0, { timeout: 15_000 });
	await expect(fw.locator('.fw-cmd')).toHaveCount(0);
});

const noPhoneYet = async (request: APIRequestContext, at: Install) =>
	((await (await request.get(`${at.base}/api/wifi`)).json()) as { noPhoneYet: boolean }).noPhoneYet;

/**
 * Round 2: a computer a phone has reached is settled. A reach before NEW
 * CODES proves the same firewall, so the new code's wait passes in silence
 * (the false alarm on every SETTINGS visit the review found). New listeners
 * are what ask again: OFF and ON forget the reach, and with no phone paired
 * the code still up asks at once.
 */
test('a phone that reached this computer before NEW CODES: no NO PHONE HAS REACHED after the wait, until OFF and ON', async ({
	page,
	request,
	playwright
}) => {
	at = await serve({
		TSUNDOKU_FIREWALL_PLATFORM: 'linux',
		TSUNDOKU_FIREWALL_PROBE: 'none',
		TSUNDOKU_FIREWALL_QUIET_MS: '4000'
	});
	await switchOn(request, at);
	const fw = await openPanel(page, at);
	const quiet = fw.getByText('NO PHONE HAS REACHED THIS COMPUTER YET · A FIREWALL?');
	// A phone scans the code: a request by the Wi-Fi listener, and the code used.
	const { code } = (await (await request.get(`${at.base}/api/wifi`)).json()) as Wifi;
	const scan = await playwright.request.newContext();
	try {
		const r = await scan.get(code!.url, { maxRedirects: 0 });
		expect(r.status()).toBe(303);
		expect(r.headers()['location']).toBe('/welcome');
	} finally {
		await scan.dispose();
	}
	await page.locator('.pair-foot').getByRole('button', { name: 'NEW CODES' }).click();
	// Past the 4 s wait and two of the panel's 5 s polls: the server says no, and so does the panel.
	await page.waitForTimeout(4000 + 2 * 5000);
	expect(await noPhoneYet(request, at)).toBe(false);
	await expect(quiet).toHaveCount(0);
	await expect(fw.getByRole('button', { name: /THE LINES TO COPY/ })).toBeEnabled();
	// A visit later, with the kept code older than the wait: still nothing.
	await page.reload();
	await expect(page.getByLabel('Pairing', { exact: true })).toBeVisible();
	await page.waitForTimeout(5000 + 1000);
	await expect(quiet).toHaveCount(0);

	// OFF and ON: new listeners, which can meet a new rule, and no phone paired.
	expect((await request.post(`${at.base}/api/wifi`, { data: { action: 'off' } })).ok()).toBe(true);
	await switchOn(request, at);
	await expect.poll(() => noPhoneYet(request, at!), { timeout: 15_000 }).toBe(true);
	await expect(quiet).toBeVisible({ timeout: 15_000 });
});
