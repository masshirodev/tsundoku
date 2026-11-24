import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	chromiumPath,
	engineWebViewEnv,
	opener,
	plan,
	SOLVER_NSS,
	solverAt,
	solverBrowser,
	solverSetAside,
	solverWrapper,
	switchPath,
	systemBrowser
} from '../ops/release/launcher/plan.ts';

const base = { engineToken: 'eng', solverDir: null };

describe('the launcher’s plan (doc/RELEASE.md)', () => {
	it('on Windows: the bundle’s own programs, localhost, and the data folder', () => {
		const p = plan({
			...base,
			root: 'C:\\Program Files\\tsundoku',
			home: 'C:/Users/Ami/AppData/Local/tsundoku',
			env: {},
			platform: 'win32'
		});
		expect(p.url).toBe('http://localhost:42143');
		expect(p.server.cmd).toBe('C:\\Program Files\\tsundoku\\node\\node.exe');
		expect(p.server.args).toEqual([
			'--disable-warning=ExperimentalWarning',
			'C:\\Program Files\\tsundoku\\app\\scripts\\serve.ts'
		]);
		expect(p.server.env).toMatchObject({
			TSUNDOKU_SERVE: 'local',
			TSUNDOKU_SNAPSHOT: 'off',
			// A password chosen on first open, never a token (doc/SIGN-IN.md).
			TSUNDOKU_LOGIN: 'password',
			TSUNDOKU_UPDATES: 'https://dl.tsundoku.masshiro.pro',
			PORT: '42143',
			ENGINE_URL: 'http://127.0.0.1:4590',
			ENGINE_TOKEN: 'eng',
			FFMPEG: 'C:\\Program Files\\tsundoku\\ffmpeg\\bin\\ffmpeg.exe'
		});
		expect(p.server.env.DATABASE_PATH).toBe(
			'C:\\Users\\Ami\\AppData\\Local\\tsundoku\\tsundoku.sqlite'
		);
		expect(p.engine.cmd).toBe('C:\\Program Files\\tsundoku\\jre\\bin\\java.exe');
		expect(p.engine.args.slice(-2)).toEqual([
			'4590',
			'C:\\Users\\Ami\\AppData\\Local\\tsundoku\\engine\\app'
		]);
		// Loopback only, and the same token as the app sends.
		expect(p.engine.env).toMatchObject({ ENGINE_HOST: '127.0.0.1', ENGINE_TOKEN: 'eng' });
	});

	it('signs in with a password, unless the data folder names a token (the workstation)', () => {
		const friend = plan({ ...base, root: '/t', home: '/h', env: {}, platform: 'linux' });
		expect(friend.server.env.TSUNDOKU_LOGIN).toBe('password');
		const workstation = plan({
			...base,
			root: '/t',
			home: '/h',
			env: { TSUNDOKU_TOKEN: 'tok' },
			platform: 'linux'
		});
		expect(workstation.server.env).not.toHaveProperty('TSUNDOKU_LOGIN');
	});

	it('on Linux: bin/ for Node, no .exe', () => {
		const p = plan({
			...base,
			root: '/opt/tsundoku',
			home: '/home/ami/.local/share/tsundoku',
			env: {},
			platform: 'linux'
		});
		expect(p.server.cmd).toBe('/opt/tsundoku/node/bin/node');
		expect(p.engine.cmd).toBe('/opt/tsundoku/jre/bin/java');
		expect(p.server.env.FFPROBE).toBe('/opt/tsundoku/ffmpeg/bin/ffprobe');
	});

	it('leaves FPCALC to the data folder: a bundle fingerprints through its ffmpeg', () => {
		const plain = plan({ ...base, root: '/opt/tsundoku', home: '/h', env: {}, platform: 'linux' });
		expect(plain.server.env).not.toHaveProperty('FPCALC');
		const chosen = plan({
			...base,
			root: '/t',
			home: '/h',
			env: { FPCALC: '/usr/bin/fpcalc' },
			platform: 'linux'
		});
		expect(chosen.server.env).not.toHaveProperty('FPCALC');
	});

	it('runs FlareSolverr, and tells the app where, only once it’s unzipped', () => {
		const without = plan({ ...base, root: '/t', home: '/h', env: {}, platform: 'linux' });
		expect(without.solver).toBeNull();
		expect(without.server.env.ENGINE_SOLVER_URL).toBeUndefined();
		const withIt = plan({
			...base,
			solverDir: '/h/flaresolverr',
			root: '/t',
			home: '/h',
			env: {},
			platform: 'linux'
		});
		expect(withIt.solver?.cmd).toBe('/h/flaresolverr/flaresolverr');
		expect(withIt.solver?.env).toMatchObject({ HOST: '127.0.0.1', PORT: '8191' });
		expect(withIt.server.env.ENGINE_SOLVER_URL).toBe('http://127.0.0.1:8191/v1');
	});

	it('lets the data folder’s .env choose the ports, the mode and the database', () => {
		const p = plan({
			...base,
			root: '/t',
			home: '/h',
			env: {
				PORT: '5000',
				ENGINE_PORT: '5001',
				TSUNDOKU_SERVE: 'https',
				DATABASE_PATH: '/d/x.sqlite'
			},
			platform: 'linux'
		});
		expect(p.url).toBe('http://localhost:5000');
		expect(p.server.env).toMatchObject({
			PORT: '5000',
			TSUNDOKU_SERVE: 'https',
			DATABASE_PATH: '/d/x.sqlite',
			ENGINE_URL: 'http://127.0.0.1:5001'
		});
	});

	it('ignores a port that isn’t one', () => {
		expect(
			plan({ ...base, root: '/t', home: '/h', env: { PORT: 'abc' }, platform: 'linux' }).ports.app
		).toBe(42143);
	});
});

describe('the pinned files (ops/release/versions.json)', () => {
	const pins = JSON.parse(
		readFileSync(fileURLToPath(new URL('../ops/release/versions.json', import.meta.url)), 'utf8')
	) as Record<string, Record<string, unknown>>;

	it('pins each component for both platforms, with the project’s own digest', () => {
		for (const name of ['node', 'jre', 'flaresolverr', 'ffmpeg']) {
			const p = pins[name];
			expect(p, name).toBeDefined();
			expect(typeof p.version).toBe('string');
			expect(typeof p.licence).toBe('string');
			for (const platform of ['win-x64', 'linux-x64']) {
				const pin = p[platform] as { url: string; sha256: string };
				expect(pin.url, `${name} ${platform}`).toMatch(/^https:\/\//);
				expect(pin.sha256, `${name} ${platform}`).toMatch(/^[0-9a-f]{64}$/);
			}
		}
		// A bundle fingerprints through its own
		// ffmpeg's chromaprint muxer, so no fpcalc is pinned or shipped.
		expect(pins.fpcalc).toBeUndefined();
	});
});

describe('solverAt', () => {
	it('prefers the data folder, which outlives reinstalling, then the program’s', () => {
		const both = (f: string) => f.endsWith('flaresolverr.exe');
		expect(solverAt('C:\\P\\tsundoku', 'C:/D/tsundoku', 'win32', both)).toBe(
			'C:\\D\\tsundoku\\flaresolverr'
		);
		const besideOnly = (f: string) => f.startsWith('/opt/');
		expect(solverAt('/opt/tsundoku', '/home/a/.local/share/tsundoku', 'linux', besideOnly)).toBe(
			'/opt/tsundoku/flaresolverr'
		);
		expect(solverAt('/opt/t', '/h', 'linux', () => false)).toBeNull();
	});
});

describe('opener', () => {
	it('opens the default browser on each platform', () => {
		expect(opener('win32', 'http://localhost:1')).toEqual({
			cmd: 'rundll32',
			args: ['url.dll,FileProtocolHandler', 'http://localhost:1']
		});
		expect(opener('darwin', 'u').cmd).toBe('open');
		expect(opener('linux', 'u').cmd).toBe('xdg-open');
	});
});

describe('updates (doc/UPDATES.md)', () => {
	const at = (env: Record<string, string>, installed?: boolean) =>
		plan({ ...base, root: 'C:\\t', home: 'C:/h', env, platform: 'win32', installed }).server.env;

	it('looks at the release host unless .env says otherwise', () => {
		expect(at({}).TSUNDOKU_UPDATES).toBe('https://dl.tsundoku.masshiro.pro');
		expect(at({ TSUNDOKU_UPDATES: 'off' }).TSUNDOKU_UPDATES).toBe('off');
	});

	it('says when the installer put it there, so UPDATE can run the next one', () => {
		expect(at({}, true).TSUNDOKU_INSTALLED).toBe('1');
		expect(at({}).TSUNDOKU_INSTALLED).toBeUndefined();
	});

	it('sets FlareSolverr’s own readline aside on Linux only, so /bin/sh keeps the system’s', () => {
		const lib = '/h/flaresolverr/_internal/libreadline.so.8';
		expect(solverSetAside('/h/flaresolverr', 'linux', (f) => f === lib)).toEqual([
			{ from: lib, to: `${lib}.bundled-off` }
		]);
		// Already set aside, or never there: nothing to do.
		expect(solverSetAside('/h/flaresolverr', 'linux', () => false)).toEqual([]);
		expect(solverSetAside('C:/h/flaresolverr', 'win32', () => true)).toEqual([]);
	});

	it('sets FlareSolverr’s half of NSS aside with its readline, so Chrome’s NSS is the system’s whole', () => {
		const dir = '/h/flaresolverr/_internal';
		const bundled = ['libreadline.so.8', ...SOLVER_NSS].map((n) => `${dir}/${n}`);
		expect(solverSetAside('/h/flaresolverr', 'linux', (f) => bundled.includes(f))).toEqual(
			bundled.map((from) => ({ from, to: `${from}.bundled-off` }))
		);
		// The readline set aside on an earlier start, NSS not yet: only NSS moves.
		const nss = bundled.slice(1);
		expect(solverSetAside('/h/flaresolverr', 'linux', (f) => nss.includes(f))).toEqual(
			nss.map((from) => ({ from, to: `${from}.bundled-off` }))
		);
		expect(SOLVER_NSS).toEqual(expect.arrayContaining(['libnss3.so', 'libnssutil3.so']));
	});
});

describe('FlareSolverr’s browser (doc/EXTENSION-ENGINE.md, "The solver’s browser")', () => {
	const dir = '/h/flaresolverr';
	const chrome = `${dir}/_internal/chrome/chrome`;
	const off = `${chrome}.bundled-off`;
	const env = { PATH: '/home/ami/.local/bin:/usr/bin:/bin' };
	const has =
		(...files: string[]) =>
		(f: string) =>
			files.includes(f);

	it('finds a system Chromium first, then Chrome, along PATH, absolute folders only', () => {
		expect(systemBrowser(env, has('/usr/bin/google-chrome-stable', '/usr/bin/chromium'))).toBe(
			'/usr/bin/chromium'
		);
		expect(systemBrowser(env, has('/usr/bin/google-chrome-stable'))).toBe(
			'/usr/bin/google-chrome-stable'
		);
		expect(systemBrowser(env, has('/home/ami/.local/bin/chromium', '/usr/bin/chromium'))).toBe(
			'/home/ami/.local/bin/chromium'
		);
		expect(systemBrowser({ PATH: 'bin:/usr/bin' }, has('bin/chromium'))).toBeNull();
		expect(systemBrowser({}, has('/usr/bin/chromium'))).toBeNull();
	});

	it('sets its own Chromium aside once, for the system’s, on Linux only', () => {
		expect(solverBrowser(dir, 'linux', env, has(chrome, '/usr/bin/chromium'))).toEqual({
			use: 'system',
			browser: '/usr/bin/chromium',
			chrome,
			aside: { from: chrome, to: off }
		});
		// A later start: already aside, the wrapper rewritten, nothing renamed.
		expect(solverBrowser(dir, 'linux', env, has(chrome, off, '/usr/bin/chromium'))).toEqual({
			use: 'system',
			browser: '/usr/bin/chromium',
			chrome,
			aside: null
		});
		expect(solverBrowser('C:/h/flaresolverr', 'win32', env, () => true)).toBeNull();
	});

	it('puts its own Chromium back when the system has none, and leaves it alone otherwise', () => {
		expect(solverBrowser(dir, 'linux', env, has(chrome, off))).toEqual({
			use: 'bundled',
			restore: { from: off, to: chrome }
		});
		expect(solverBrowser(dir, 'linux', env, has(chrome))).toEqual({
			use: 'bundled',
			restore: null
		});
		// A build with no Chromium of its own: nothing to decide.
		expect(solverBrowser(dir, 'linux', env, has('/usr/bin/chromium'))).toBeNull();
	});

	it('writes a wrapper that runs the browser with the library path the solver started with', () => {
		const tmp = mkdtempSync(join(tmpdir(), 'solver-wrapper-'));
		try {
			// A browser whose path needs quoting, that says what it was given.
			const browser = join(tmp, "it's chromium");
			writeFileSync(browser, '#!/bin/sh\necho "lib=${LD_LIBRARY_PATH-unset} args=$*"\n');
			chmodSync(browser, 0o755);
			const wrapper = join(tmp, 'chrome');
			writeFileSync(wrapper, solverWrapper(browser));
			chmodSync(wrapper, 0o755);
			const run = (extra: Record<string, string>) =>
				spawnSync(wrapper, ['--version', 'a b'], {
					env: { PATH: '/usr/bin:/bin', LD_LIBRARY_PATH: '/h/flaresolverr/_internal', ...extra },
					encoding: 'utf8'
				}).stdout.trim();
			// PyInstaller's own folder never reaches the browser.
			expect(run({})).toBe('lib=unset args=--version a b');
			expect(run({ LD_LIBRARY_PATH_ORIG: '/opt/own' })).toBe('lib=/opt/own args=--version a b');
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe('the WebView switch (doc/EXTENSION-ENGINE.md, "Cloudflare and WebView extensions")', () => {
	it('starts the engine with ENGINE_WEBVIEW=on only when the switch is on', () => {
		const on = plan({ ...base, root: '/t', home: '/h', env: {}, platform: 'linux', webview: true });
		expect(on.engine.env.ENGINE_WEBVIEW).toBe('on');
		const off = plan({
			...base,
			root: '/t',
			home: '/h',
			env: {},
			platform: 'linux',
			webview: false
		});
		expect(off.engine.env.ENGINE_WEBVIEW).toBe('off');
	});

	it('is off by default: a plan that wasn’t told is a friend’s install', () => {
		const p = plan({ ...base, root: '/t', home: '/h', env: {}, platform: 'linux' });
		expect(p.engine.env.ENGINE_WEBVIEW).toBe('off');
	});

	it('says off out loud, so a stray ENGINE_WEBVIEW=on in the data folder’s .env can’t turn it on', () => {
		// The launcher spawns the engine with its own environment under the
		// plan's, and the data folder's .env is read into the former.
		const p = plan({
			...base,
			root: '/t',
			home: '/h',
			env: { ENGINE_WEBVIEW: 'on' },
			platform: 'linux'
		});
		expect({ ...{ ENGINE_WEBVIEW: 'on' }, ...p.engine.env }.ENGINE_WEBVIEW).toBe('off');
		expect(engineWebViewEnv(true)).toEqual({ ENGINE_WEBVIEW: 'on' });
		expect(engineWebViewEnv(false)).toEqual({ ENGINE_WEBVIEW: 'off' });
	});

	it('tells the engine and the app the same Chromium folder, and the app where the switch is', () => {
		const p = plan({ ...base, root: '/t', home: '/h', env: {}, platform: 'linux', webview: true });
		expect(p.engine.env.ENGINE_WEBVIEW_DIR).toBe('/h/engine/app/webview/chromium');
		expect(p.server.env.ENGINE_WEBVIEW_DIR).toBe('/h/engine/app/webview/chromium');
		expect(p.server.env.ENGINE_WEBVIEW_SWITCH).toBe('/h/engine/webview.json');
		// The engine's own default, under the app dir it's given as its last argument.
		expect(p.engine.args.at(-1)).toBe('/h/engine/app');
	});

	it('writes Windows paths on Windows', () => {
		const home = 'C:\\Users\\Ami\\AppData\\Local\\tsundoku';
		expect(switchPath(home, 'win32')).toBe(`${home}\\engine\\webview.json`);
		expect(chromiumPath(home, 'win32')).toBe(`${home}\\engine\\app\\webview\\chromium`);
	});
});

// bind.ts' SERVER_ENV is what an update's installer takes out of the environment
// it hands the next start (withoutServerEnv), so the next server never inherits
// this one's. A list someone has to remember drifts: the launcher had come to
// set ENGINE_WEBVIEW_SWITCH and ENGINE_WEBVIEW_DIR without them in it. So every
// variable the launcher gives the server, on any platform and with every
// option, is in it.
describe('what the launcher gives the server', () => {
	it('is all in SERVER_ENV, so an update never hands it on', async () => {
		const { SERVER_ENV } = await import('../src/lib/server/bind');
		const given = new Set<string>();
		for (const platform of ['linux', 'win32', 'darwin'] as const)
			for (const env of [{}, { TSUNDOKU_TOKEN: 't', FFMPEG: '/f', DATABASE_PATH: '/d' }])
				for (const extra of [{}, { installed: true, webview: true, solverDir: '/s' }]) {
					const p = plan({ ...base, root: '/t', home: '/h', env, platform, ...extra });
					for (const k of Object.keys(p.server.env ?? {})) given.add(k);
				}
		expect(given.size).toBeGreaterThan(10);
		expect([...given].filter((k) => !(SERVER_ENV as readonly string[]).includes(k))).toEqual([]);
	});
});
