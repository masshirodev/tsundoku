import { describe, expect, it } from 'vitest';
import { opener, plan } from '../ops/release/launcher/plan.ts';

const base = { engineToken: 'eng', solverPresent: false };

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
		expect(p.server.args).toEqual(['C:\\Program Files\\tsundoku\\app\\scripts\\serve.ts']);
		expect(p.server.env).toMatchObject({
			TSUNDOKU_SERVE: 'local',
			TSUNDOKU_SNAPSHOT: 'off',
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

	it('runs FlareSolverr, and tells the app where, only once it’s unzipped beside it', () => {
		const without = plan({ ...base, root: '/t', home: '/h', env: {}, platform: 'linux' });
		expect(without.solver).toBeNull();
		expect(without.server.env.ENGINE_SOLVER_URL).toBeUndefined();
		const withIt = plan({
			...base,
			solverPresent: true,
			root: '/t',
			home: '/h',
			env: {},
			platform: 'linux'
		});
		expect(withIt.solver?.cmd).toBe('/t/flaresolverr/flaresolverr');
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
