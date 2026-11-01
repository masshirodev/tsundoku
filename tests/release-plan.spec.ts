import { describe, expect, it } from 'vitest';
import { opener, plan, solverAt, solverSetAside } from '../ops/release/launcher/plan.ts';

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
