import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { request, type APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';
import { makeLogin, sessionFor, writeLogin } from '../src/lib/server/login.ts';
import { E2E_TOKEN } from '../playwright.config';

/**
 * A TV's six digits on installs served the way `scripts/serve.ts` serves one
 * on the tailnet (c266; doc/SIGN-IN.md, doc/WIFI.md "Where they show"): its
 * `http` mode, bound to 127.0.0.1, with an `ORIGIN` on a tailnet-like host, so
 * the origin the hook and `tvBlockFor` read is the real path's, not `vite
 * preview`'s.
 *
 * - `friend`: a friend's install (`TSUNDOKU_LOGIN=password`, a password set).
 *   SETTINGS draws no six digits and no door makes them, and a TV's paired
 *   cookie signs nothing in: its guard reads one only over Wi-Fi.
 * - `token`: the owner's shape, the same mode and origin with the token. The
 *   digits are drawn, typed on `/pair/tv`, and the cookie that sets signs a
 *   request in on the tailnet host, never at 127.0.0.1. It is here so the
 *   friend's refusals are the friend's, not the origin's or the test's.
 *
 * In the friend project, not a device one: serve.ts is the friend project's
 * server already (tests/friend-setup.ts), the project is signed out with one
 * worker, and a plain `*.e2e.ts` would stand two more servers up in each of
 * four device projects. Both installs are this file's own, on ports from the
 * OS, with their own databases and data folders; the shared friend install
 * is untouched. serve.ts serves the suite's `build/`, which the shared
 * preview's web server has made before any project runs.
 */
test.describe.configure({ mode: 'serial', timeout: 60_000 });

const freePort = () =>
	new Promise<number>((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});

type Install = {
	name: string;
	port: number;
	/** The tailnet-like name its ORIGIN gives, as serve.ts's http mode would the tailnet's. */
	host: string;
	db: string;
	home: string;
	server: ChildProcess | null;
};
const install = async (name: string): Promise<Install> => {
	const port = await freePort();
	const db = join(tmpdir(), `tsundoku-e2e-tailnet-${name}-${process.pid}.sqlite`);
	return { name, port, host: `tsundoku.test:${port}`, db, home: `${db}.home`, server: null };
};
const friend = await install('friend');
const token = await install('token');

const PASSWORD = 'a-friends-password';
const login = makeLogin(PASSWORD);
const tokenSession = createHash('sha256').update(`tsundoku/v1:${E2E_TOKEN}`).digest('hex');

async function serve(at: Install, env: NodeJS.ProcessEnv, prepare = () => {}) {
	rmSync(at.db, { force: true });
	rmSync(at.home, { recursive: true, force: true });
	mkdirSync(join(at.home, 'library'), { recursive: true });
	prepare();
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: at.db, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const all: NodeJS.ProcessEnv = {
		...process.env,
		TSUNDOKU_SERVE: 'http',
		HOST: '127.0.0.1',
		PORT: String(at.port),
		ORIGIN: `http://${at.host}`,
		TSUNDOKU_SNAPSHOT: 'off',
		// Never the owner's tokens from the project's .env (scripts/serve.ts).
		TSUNDOKU_PROJECT_ENV: 'off',
		TSUNDOKU_UPDATES: 'off',
		DATABASE_PATH: at.db,
		TSUNDOKU_HOME: at.home,
		LIBRARY_ROOT: join(at.home, 'library'),
		BACKUP_DIR: join(at.home, 'backups'),
		ENGINE_URL: 'http://127.0.0.1:1',
		SUWAYOMI_URL: '',
		TSUNDOKU_ANILIST: 'off',
		...env
	};
	at.server = spawn(
		process.execPath,
		['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'scripts/serve.ts'],
		{ env: all, stdio: 'ignore' }
	);
	const base = `http://127.0.0.1:${at.port}`;
	for (let i = 0; i < 120; i++) {
		try {
			const r = await fetch(`${base}/manifest.webmanifest`);
			if (r.ok && ((await r.json()) as { short_name?: string }).short_name === 'tsundoku') return;
		} catch {
			// Not up yet.
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`the ${at.name} install at ${base} never answered`);
}

test.beforeAll(async () => {
	// Two seeds and two serve.ts starts on a loaded box (as settings-devices').
	test.setTimeout(120_000);
	await Promise.all([
		// serve.ts refuses a friend's install off localhost without a password.
		serve(friend, { TSUNDOKU_LOGIN: 'password', TSUNDOKU_TOKEN: '' }, () =>
			writeLogin(friend.home, login)
		),
		serve(token, { TSUNDOKU_LOGIN: '', TSUNDOKU_TOKEN: E2E_TOKEN })
	]);
});

test.afterAll(() => {
	for (const at of [friend, token]) {
		at.server?.kill();
		at.server = null;
		rmSync(at.db, { force: true });
		rmSync(at.home, { recursive: true, force: true });
	}
});

/**
 * A client on the tailnet: every request names the install's tailnet host,
 * as a browser that opened `ORIGIN` does, and carries only the cookies given.
 */
async function tailnet(at: Install, cookie: string | null, host = at.host) {
	return request.newContext({
		baseURL: `http://127.0.0.1:${at.port}`,
		extraHTTPHeaders: { host, ...(cookie ? { cookie } : {}) }
	});
}

/** SETTINGS' HTML as the server renders it, and the six digits it draws, if any. */
async function settingsDigits(client: APIRequestContext) {
	const r = await client.get('/settings', { maxRedirects: 0 });
	expect(r.status()).toBe(200);
	const html = await r.text();
	expect(html).toContain('08 — DEVICES');
	const at = html.indexOf('aria-label="Pairing code for a TV"');
	const digits =
		at < 0
			? null
			: html
					.slice(at, at + 400)
					.replace(/<[^>]*>/g, '')
					.match(/\d{3}\s*\d{3}/)?.[0]
					.replace(/\s/g, '');
	return { html, digits: digits ?? null };
}

/** NEW CODE's action and the row's refresh, posted as the page's own button would. */
async function otherDoors(client: APIRequestContext, at: Install) {
	const action = await client.post('/settings?/tvCode', {
		headers: { 'x-sveltekit-action': 'true', origin: `http://${at.host}` },
		multipart: {}
	});
	const refresh = await client.get('/settings/tv');
	return { action: await action.json(), refresh: await refresh.json() };
}

/** Whether a request with only this cookie is signed in: `/` answers, or sends it to /login. */
async function signsIn(at: Install, cookie: string, host = at.host) {
	const client = await tailnet(at, cookie, host);
	try {
		const r = await client.get('/', { maxRedirects: 0 });
		return { status: r.status(), location: r.headers()['location'] ?? null };
	} finally {
		await client.dispose();
	}
}

test('a friend’s install on its tailnet origin draws no TV digits, and no door makes them (c266)', async () => {
	const owner = await tailnet(friend, `tsundoku_session=${sessionFor(login)}`);
	try {
		const { html, digits } = await settingsDigits(owner);
		expect(digits).toBeNull();
		expect(html).not.toContain('FOR A TV · SIX DIGITS');
		// No WI-FI panel off local mode either, so nothing on the page carries them.
		expect(html).not.toContain('Other devices on this Wi-Fi');
		const doors = await otherDoors(owner, friend);
		expect(doors.action).toMatchObject({ type: 'failure', status: 403 });
		expect(doors.refresh).toEqual({ tv: null });
	} finally {
		await owner.dispose();
	}
});

test('a TV’s paired cookie signs nothing in on a friend’s tailnet origin (c266)', async () => {
	// The pairing no door here can make (the digits are never drawn, and
	// /api/pair/tv answers only at the computer, which a served instance's
	// ORIGIN never names), written as /pair/tv would write it: what the guard
	// alone must refuse.
	const cookie = randomBytes(32).toString('base64url');
	const db = new Database(friend.db);
	try {
		db.prepare(
			`INSERT INTO paired_devices (token_hash, label, address, paired_at, seen_at) VALUES (?, ?, ?, ?, ?)`
		).run(
			createHash('sha256').update(cookie).digest('hex'),
			'Android TV · Chrome',
			friend.host,
			Date.now(),
			Date.now()
		);
	} finally {
		db.close();
	}
	const r = await signsIn(friend, `tsundoku_paired=${cookie}`);
	expect(r.status).toBe(303);
	expect(r.location).toMatch(/^\/login/);
	// While the friend's own password session does sign in on the same host.
	expect(await signsIn(friend, `tsundoku_session=${sessionFor(login)}`)).toMatchObject({
		status: 200
	});
});

test('the token install on the same origin draws the digits, and the TV they pair signs in there only (c266)', async () => {
	const owner = await tailnet(token, `tsundoku_session=${tokenSession}`);
	let digits: string | null;
	try {
		({ digits } = await settingsDigits(owner));
		expect(digits).toMatch(/^\d{6}$/);
		const doors = await otherDoors(owner, token);
		expect(doors.action).toMatchObject({ type: 'success' });
		// NEW CODE made another: read it the way the page does after its reload.
		({ digits } = await settingsDigits(owner));
		expect(doors.refresh.tv).toMatchObject({ state: 'live' });
	} finally {
		await owner.dispose();
	}

	// The TV types them on /pair/tv, as 9C posts them, on the tailnet host.
	const tv = await tailnet(token, null);
	let cookie: string;
	try {
		const r = await tv.post('/pair/tv', {
			form: { code: digits! },
			headers: { origin: `http://${token.host}`, accept: 'text/html' },
			maxRedirects: 0
		});
		expect(r.status()).toBe(303);
		expect(r.headers()['location']).toBe('/pair/tv');
		const set = r.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value ?? '';
		cookie = set.match(/tsundoku_paired=([^;]+)/)?.[1] ?? '';
		expect(cookie).not.toBe('');
	} finally {
		await tv.dispose();
	}

	// Only that cookie: signed in on the tailnet host, sent to /login at 127.0.0.1.
	expect(await signsIn(token, `tsundoku_paired=${cookie}`)).toMatchObject({ status: 200 });
	const local = await signsIn(token, `tsundoku_paired=${cookie}`, `127.0.0.1:${token.port}`);
	expect(local.status).toBe(303);
	expect(local.location).toMatch(/^\/login/);
});
