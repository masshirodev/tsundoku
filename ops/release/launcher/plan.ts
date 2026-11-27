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

/** The release host (doc/UPDATES.md): its latest.json, and every version's files. */
export const UPDATES = 'https://dl.tsundoku.masshiro.pro';

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
	/** Put there by the installer (its uninstaller beside it), so UPDATE can run the next one. */
	installed?: boolean;
	/**
	 * SETTINGS' WEBVIEW switch as it stands (`readSwitch`, webview-switch.ts):
	 * the engine runs WebView extensions only when it's on. Off by default.
	 * Read again for every engine start, so it's the plan's input, not the
	 * plan's to read.
	 */
	webview?: boolean;
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
			// A password chosen on first open (doc/SIGN-IN.md), unless the data
			// folder's .env names a TSUNDOKU_TOKEN: an install served on a tailnet runs
			// the same bundle and keeps its token. A friend's install never has one.
			...(o.env.TSUNDOKU_TOKEN ? {} : { TSUNDOKU_LOGIN: 'password' }),
			// Where new versions are announced (doc/UPDATES.md); "off" in .env stops looking.
			TSUNDOKU_UPDATES: o.env.TSUNDOKU_UPDATES || UPDATES,
			...(o.installed ? { TSUNDOKU_INSTALLED: '1' } : {}),
			TSUNDOKU_HOME: o.home,
			DATABASE_PATH: o.env.DATABASE_PATH || p.join(o.home, 'tsundoku.sqlite'),
			PORT: String(ports.app),
			ENGINE_URL: `http://127.0.0.1:${ports.engine}`,
			ENGINE_TOKEN: o.engineToken,
			...(o.solverDir ? { ENGINE_SOLVER_URL: `http://127.0.0.1:${ports.solver}/v1` } : {}),
			// The WEBVIEW switch the launcher reads, and the folder Chromium goes to:
			// SETTINGS turns it on and off, and shows and removes the folder
			// (doc/SETTINGS.md, "07 — BROWSE").
			ENGINE_WEBVIEW_SWITCH: switchPath(o.home, o.platform),
			ENGINE_WEBVIEW_DIR: chromiumPath(o.home, o.platform),
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
			// And its temporary files: the loader's working folder, the network
			// cache and Chromium's. In the system's temp folder a tidy-up removed
			// them from under a running engine, and every extension then failed to
			// load; on Linux that folder is often a tmpfs, so they also took RAM.
			`-Djava.io.tmpdir=${engineTmpPath(o.home, o.platform)}`,
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
			ENGINE_APK_DIR: p.join(o.home, 'engine', 'apks'),
			// Headless Chromium for WebView extensions, only when SETTINGS has it on
			// (doc/EXTENSION-ENGINE.md, "Cloudflare and WebView extensions"). Its folder is named so the
			// app and the engine agree on it.
			...engineWebViewEnv(o.webview === true),
			ENGINE_WEBVIEW_DIR: chromiumPath(o.home, o.platform)
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

/**
 * Files in FlareSolverr's folder to set aside before it starts. Its Linux
 * build (PyInstaller) puts its own folder first on LD_LIBRARY_PATH for every
 * program it starts, and asks `/bin/sh` for Chrome's version: with the
 * readline it carries (8.2), a newer bash (Arch's 5.3, built on readline 8.3)
 * dies on "undefined symbol: rl_print_keybinding", Chrome's version isn't
 * found, and FlareSolverr exits, again and again (3.4.6 and 3.5.2 alike,
 * on Arch). That readline only serves
 * Python's interactive prompt, which a server never shows, so without it the
 * shell uses the system's own. Renamed, never deleted.
 *
 * The same folder carries half of NSS, Chrome's certificate library
 * (`SOLVER_NSS`), from the Ubuntu it was built on, but not its `libsoftokn3`,
 * which NSS always loads from the system. On a system whose NSS is newer the
 * two halves disagree: Arch's 3.129 softokn wants `NSSUTIL_3.108` from the
 * bundled nssutil, NSS fails to start, and Chrome aborts on the first
 * certificate it checks (`FATAL: nss_error=-5925`), so every solve over HTTPS
 * fails as "the browser has closed the connection". With
 * the bundled half set aside, NSS is the system's, whole and in one version.
 */
export function solverSetAside(
	solverDir: string,
	platform: NodeJS.Platform,
	exists: (file: string) => boolean
): { from: string; to: string }[] {
	if (platform !== 'linux') return [];
	return ['libreadline.so.8', ...SOLVER_NSS]
		.map((name) => path.posix.join(solverDir, '_internal', name))
		.filter((from) => exists(from))
		.map((from) => ({ from, to: `${from}.bundled-off` }));
}

/** NSS and NSPR as FlareSolverr's Linux build bundles them (3.4.6). */
export const SOLVER_NSS = [
	'libnss3.so',
	'libnssutil3.so',
	'libsmime3.so',
	'libnspr4.so',
	'libplc4.so',
	'libplds4.so'
];

/**
 * The browsers FlareSolverr's Linux build may borrow from the system, in the
 * order they are looked for. Both were measured clearing Cloudflare's check
 * (doc/EXTENSION-ENGINE.md, "The solver's browser").
 */
export const SOLVER_BROWSERS = [
	'chromium',
	'chromium-browser',
	'google-chrome-stable',
	'google-chrome'
];

/** A system browser on `PATH`, by `SOLVER_BROWSERS`' order, or null. */
export function systemBrowser(env: Env, exists: (file: string) => boolean): string | null {
	const dirs = (env.PATH ?? '').split(':').filter((d) => d.startsWith('/'));
	for (const name of SOLVER_BROWSERS)
		for (const dir of dirs) {
			const file = path.posix.join(dir, name);
			if (exists(file)) return file;
		}
	return null;
}

/**
 * What stands at `_internal/chrome/chrome` when the system's browser is used:
 * a script that runs it. The library path goes back to what the solver was
 * started with (PyInstaller keeps it as `LD_LIBRARY_PATH_ORIG`), because the
 * bundle's own libraries, first on it for every program the solver starts,
 * break a system Chromium (Arch's dies on harfbuzz's `hb_calloc`).
 */
export function solverWrapper(browser: string): string {
	const quoted = `'${browser.replaceAll("'", `'\\''`)}'`;
	return [
		'#!/bin/sh',
		"# Written by tsundoku's launcher at every start (solverBrowser, plan.ts):",
		"# FlareSolverr's own Chromium is set aside as chrome.bundled-off.",
		'if [ -n "${LD_LIBRARY_PATH_ORIG+x}" ]; then',
		'\tLD_LIBRARY_PATH=$LD_LIBRARY_PATH_ORIG',
		'\texport LD_LIBRARY_PATH',
		'else',
		'\tunset LD_LIBRARY_PATH',
		'fi',
		`exec ${quoted} "$@"`,
		''
	].join('\n');
}

export type SolverBrowser =
	| { use: 'system'; browser: string; chrome: string; aside: { from: string; to: string } | null }
	| { use: 'bundled'; restore: { from: string; to: string } | null };

/**
 * Which Chromium FlareSolverr drives on Linux. Its own (a `.0` snapshot
 * build: 142.0.7444.0 in 3.4.6, 153.0.8010.0 in 3.5.2) reaches Cloudflare's
 * "Just a moment..." page and never clears it, where the same FlareSolverr
 * driving a packaged Chromium or Chrome clears it in about 20 s. FlareSolverr
 * has no setting for its browser: it runs `_internal/chrome/chrome` whenever
 * that file is there. So with a system browser, the bundled one is set aside
 * once and a wrapper (`solverWrapper`) stands in its place, rewritten at every
 * start so a browser moved or replaced is followed; with none, the bundled one
 * is put back. Null where there is nothing to decide: not Linux, or a build
 * with no Chromium of its own.
 */
export function solverBrowser(
	solverDir: string,
	platform: NodeJS.Platform,
	env: Env,
	exists: (file: string) => boolean
): SolverBrowser | null {
	if (platform !== 'linux') return null;
	const chrome = path.posix.join(solverDir, '_internal', 'chrome', 'chrome');
	const off = `${chrome}.bundled-off`;
	const isAside = exists(off);
	if (!isAside && !exists(chrome)) return null;
	const browser = systemBrowser(env, exists);
	if (browser)
		return { use: 'system', browser, chrome, aside: isAside ? null : { from: chrome, to: off } };
	return { use: 'bundled', restore: isAside ? { from: off, to: chrome } : null };
}

// ---- the WebView switch (doc/EXTENSION-ENGINE.md, "Cloudflare and WebView extensions") ----

/**
 * Where SETTINGS' WEBVIEW switch is kept, under the data folder, as WI-FI
 * keeps `wifi.json`: the launcher reads it before every engine start, having
 * no database (`readSwitch`, src/lib/server/engine/webview-switch.ts).
 */
export const switchPath = (home: string, platform: NodeJS.Platform) =>
	(platform === 'win32' ? path.win32 : path.posix).join(home, 'engine', 'webview.json');

/**
 * The engine's temporary folder (`java.io.tmpdir`), under the data folder. The
 * launcher makes it before every engine start, since Java won't, and empties
 * it when it starts: it owns the data folder, so no engine of its is running
 * then, and a killed engine's files would otherwise stay.
 */
export const engineTmpPath = (home: string, platform: NodeJS.Platform) =>
	(platform === 'win32' ? path.win32 : path.posix).join(home, 'engine', 'tmp');

/**
 * Where the engine downloads Chromium to and runs it from (`ENGINE_WEBVIEW_DIR`):
 * the engine's own default, `<app dir>/webview/chromium`, said out loud so the
 * app knows the folder SETTINGS shows and REMOVE deletes.
 */
export const chromiumPath = (home: string, platform: NodeJS.Platform) =>
	(platform === 'win32' ? path.win32 : path.posix).join(
		home,
		'engine',
		'app',
		'webview',
		'chromium'
	);

/**
 * What the engine is started with: on only when the switch is (the WebView
 * runs sites' scripts in Chromium 111 without a sandbox, so it is on for an
 * install that turns it on, and off on every other). Always said, `off` included: the launcher's
 * environment, the data folder's `.env` read into it, reaches the engine too,
 * and a stray `ENGINE_WEBVIEW=on` there must not turn on what the switch has
 * off.
 */
export const engineWebViewEnv = (on: boolean): { ENGINE_WEBVIEW: 'on' | 'off' } => ({
	ENGINE_WEBVIEW: on ? 'on' : 'off'
});

/** How to open a page in the friend's browser. */
export function opener(platform: NodeJS.Platform, url: string): { cmd: string; args: string[] } {
	// Not `cmd /c start`: its first quoted argument is a window title, and Node's
	// quoting of an empty one doesn't survive cmd's parsing.
	if (platform === 'win32') return { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
	if (platform === 'darwin') return { cmd: 'open', args: [url] };
	return { cmd: 'xdg-open', args: [url] };
}
