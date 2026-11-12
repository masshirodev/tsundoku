import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	chromiumPath,
	engineWebViewEnv,
	opener,
	plan,
	solverAt,
	solverSetAside,
	switchPath
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

	it('signs in with a password, unless the data folder names a token (the workstation, c228)', () => {
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
		// c297's premise was false (c299): a bundle fingerprints through its own
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
});

describe('the WebView switch (doc/EXTENSION-ENGINE.md, "WebView support"; card c978)', () => {
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
