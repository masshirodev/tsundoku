import path from 'node:path';

/**
 * What the launcher runs, and with what (doc/RELEASE.md, "The launcher"):
 * the engine, FlareSolverr when it's been unzipped beside it, and the app.
 * Pure, so a spec can ask for Windows' plan on Linux (tests/release-plan.spec.ts).
 */

type Env = Record<string, string | undefined>;

export type Proc = { name: string; cmd: string; args: string[]; env: Env; cwd: string };

export type Plan = {
	server: Proc;
	engine: Proc;
	/** Null until FlareSolverr's optional archive is unzipped (see `solverAt`). */
	solver: Proc | null;
	url: string;
	ports: { app: number; engine: number; solver: number };
};

export const DEFAULT_PORTS = { app: 42143, engine: 4590, solver: 8191 };

const port = (value: string | undefined, fallback: number) => {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
};

/**
 * `root` is the bundle's folder, `home` the data folder (TSUNDOKU_HOME), and
 * `env` the launcher's environment after the data folder's .env was read
 * into it. `engineToken` is the one kept in that .env. `solverDir` is the
 * folder FlareSolverr was unzipped into, if it was (`solverAt`).
 */
export function plan(o: {
	root: string;
	home: string;
	env: Env;
	platform: NodeJS.Platform;
	engineToken: string;
	solverDir: string | null;
}): Plan {
	const p = o.platform === 'win32' ? path.win32 : path.posix;
	const exe = o.platform === 'win32' ? '.exe' : '';
	const ports = {
		app: port(o.env.PORT, DEFAULT_PORTS.app),
		engine: port(o.env.ENGINE_PORT, DEFAULT_PORTS.engine),
		solver: port(o.env.SOLVER_PORT, DEFAULT_PORTS.solver)
	};
	const node =
		o.platform === 'win32'
			? p.join(o.root, 'node', 'node.exe')
			: p.join(o.root, 'node', 'bin', 'node');
	const ffmpeg = p.join(o.root, 'ffmpeg', 'bin');

	const server: Proc = {
		name: 'tsundoku',
		cmd: node,
		// Web Crypto's ML-DSA, which WebAuthn's library probes for, warns on every start.
		args: ['--disable-warning=ExperimentalWarning', p.join(o.root, 'app', 'scripts', 'serve.ts')],
		cwd: p.join(o.root, 'app'),
		env: {
			// The data folder's own .env can choose otherwise (https through Tailscale).
			TSUNDOKU_SERVE: o.env.TSUNDOKU_SERVE || 'local',
			TSUNDOKU_SNAPSHOT: 'off',
			TSUNDOKU_HOME: o.home,
			DATABASE_PATH: o.env.DATABASE_PATH || p.join(o.home, 'tsundoku.sqlite'),
			PORT: String(ports.app),
			ENGINE_URL: `http://127.0.0.1:${ports.engine}`,
			ENGINE_TOKEN: o.engineToken,
			...(o.solverDir ? { ENGINE_SOLVER_URL: `http://127.0.0.1:${ports.solver}/v1` } : {}),
			FFMPEG: o.env.FFMPEG || p.join(ffmpeg, `ffmpeg${exe}`),
			FFPROBE: o.env.FFPROBE || p.join(ffmpeg, `ffprobe${exe}`)
		}
	};

	const engine: Proc = {
		name: 'engine',
		cmd: p.join(o.root, 'jre', 'bin', `java${exe}`),
		args: [
			// Source preferences stay in the data folder (tsundoku sends them on every call).
			`-Djava.util.prefs.userRoot=${p.join(o.home, 'engine', 'prefs')}`,
			'-jar',
			p.join(o.root, 'engine', 'engine.jar'),
			String(ports.engine),
			p.join(o.home, 'engine', 'app')
		],
		cwd: o.home,
		env: {
			ENGINE_TOKEN: o.engineToken,
			// Loopback only: the proxies fetch through every source's cookies.
			ENGINE_HOST: '127.0.0.1',
			ENGINE_APK_DIR: p.join(o.home, 'engine', 'apks')
		}
	};

	const solver: Proc | null = o.solverDir
		? {
				name: 'flaresolverr',
				cmd: p.join(o.solverDir, `flaresolverr${exe}`),
				args: [],
				cwd: o.solverDir,
				env: { HOST: '127.0.0.1', PORT: String(ports.solver), LOG_LEVEL: 'info' }
			}
		: null;

	return { server, engine, solver, url: `http://localhost:${ports.app}`, ports };
}

/**
 * Where FlareSolverr's optional archive was unzipped: the data folder first,
 * where it outlives reinstalling and updating tsundoku (the installer
 * replaces the program's folders), else beside the program. `exists` is
 * injected so a spec can ask without the files.
 */
export function solverAt(
	root: string,
	home: string,
	platform: NodeJS.Platform,
	exists: (file: string) => boolean
): string | null {
	const p = platform === 'win32' ? path.win32 : path.posix;
	const exe = `flaresolverr${platform === 'win32' ? '.exe' : ''}`;
	for (const dir of [p.join(home, 'flaresolverr'), p.join(root, 'flaresolverr')])
		if (exists(p.join(dir, exe))) return dir;
	return null;
}

/** How to open a page in the friend's browser. */
export function opener(platform: NodeJS.Platform, url: string): { cmd: string; args: string[] } {
	// Not `cmd /c start`: its first quoted argument is a window title, and Node's
	// quoting of an empty one doesn't survive cmd's parsing.
	if (platform === 'win32') return { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
	if (platform === 'darwin') return { cmd: 'open', args: [url] };
	return { cmd: 'xdg-open', args: [url] };
}
