/**
 * tsundoku's launcher, in a release bundle (doc/RELEASE.md, "The launcher").
 * Run by the bundle's own Node, from `tsundoku.cmd` or `tsundoku`:
 *
 *   tsundoku                  # start everything, open the browser
 *   tsundoku --no-browser     # start everything, open nothing
 *   tsundoku --reset-password # forget the password: the next open is SET UP
 *   tsundoku --tray           # run by the tray (doc/TRAY.md): no window, events on stdout
 *
 * It starts the extension engine, FlareSolverr when its optional archive was
 * unzipped beside it, and the app, then opens the app where it serves:
 * http://localhost, or its tailnet address when the data folder's .env puts
 * it on Tailscale.
 * Closing it (Ctrl+C, or closing its window) stops all three. Started again
 * while it runs, it just opens the app.
 *
 * Friends don't run this directly any more: `tsundoku.exe` (Windows) and
 * `./tsundoku` (Linux) are the tray (ops/release/tray/), which runs this with
 * `--tray` and no window, and quits it from its menu. `tsundoku.cmd` and
 * `./tsundoku --foreground` still run it in a window, as before.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	unwatchFile,
	watchFile
} from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	readServing,
	SERVE_SHAPING,
	SERVING_FILE,
	type Serving
} from '../app/src/lib/server/bind.ts';
import { dataPaths } from '../app/src/lib/server/data-dirs.ts';
import { ensureSetting, newToken } from '../app/src/lib/server/first-run.ts';
import { clearLogin, readLogin } from '../app/src/lib/server/login.ts';
import { readSwitch } from '../app/src/lib/server/engine/webview-switch.ts';
import { Log } from './log.ts';
import { opener, plan, solverAt, solverSetAside, switchPath, type Proc } from './plan.ts';
import { CommandReader, eventLine, type TrayEvent } from './tray.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
// Started by an update's installer, this inherits the old server's own
// variables: its ORIGIN made the new serve.ts serve as before Wi-Fi
// (bind.ts, SERVER_ENV). Gone before anything reads them.
for (const k of SERVE_SHAPING) delete process.env[k];
// The default data folder's .env first: it may say TSUNDOKU_HOME is elsewhere
// (another drive), and then that folder's .env is read too. Neither overrides
// what the shell already says.
const readEnv = (file: string) => {
	try {
		process.loadEnvFile(file);
	} catch {
		// None yet: a first start.
	}
};
readEnv(join(dataPaths().home, '.env'));
const home = dataPaths().home;
const homeEnv = join(home, '.env');
readEnv(homeEnv);
const windows = process.platform === 'win32';
const browse = !process.argv.includes('--no-browser') && process.env.TSUNDOKU_NO_BROWSER !== '1';
// Run by the tray: nobody reads this window, so the launcher's lines go to
// logs/launcher.log, stdout carries only events (tray.ts), and nothing waits
// for Enter.
const tray = process.argv.includes('--tray');

let version = '';
try {
	version = (JSON.parse(readFileSync(join(root, 'release.json'), 'utf8')) as { version: string })
		.version;
} catch {
	// A bundle always has one; without it the banner just says less.
}

// Forgot the password (doc/SIGN-IN.md): being at this computer is the proof.
// Works while tsundoku runs too: the next page it serves is SET UP.
if (process.argv.includes('--reset-password')) {
	console.log(
		clearLogin(home)
			? 'tsundoku has forgotten its password. Open it, and choose a new one (or none).'
			: 'tsundoku had no password to forget.'
	);
	// From the Start menu the window would close before it could be read.
	if (windows) {
		console.log('\nPress Enter to close this window.');
		process.stdin.once('data', () => process.exit(0));
		await new Promise(() => {});
	}
	process.exit(0);
}

mkdirSync(join(home, 'logs'), { recursive: true });
const emit = (e: TrayEvent) => {
	if (tray) process.stdout.write(eventLine(e));
};
if (tray) {
	const own = new Log(join(home, 'logs', 'launcher.log'));
	const to =
		(level: 'INFO' | 'ERROR') =>
		(...a: unknown[]) =>
			own.write(level, `${a.map(String).join(' ')}\n`);
	console.log = to('INFO');
	console.warn = to('ERROR');
	console.error = to('ERROR');
	own.line('INFO', `--- starting the launcher for the tray`);
}
emit({ event: 'home', home, logs: join(home, 'logs') });
const engineToken =
	process.env.ENGINE_TOKEN || ensureSetting(homeEnv, 'ENGINE_TOKEN', newToken).value;
const solverDir = solverAt(root, home, process.platform, existsSync);
const planWith = (webview: boolean) =>
	plan({
		root,
		home,
		env: process.env,
		platform: process.platform,
		engineToken,
		solverDir,
		installed: windows && existsSync(join(root, 'uninstall.exe')),
		webview
	});
// The app, FlareSolverr and the ports don't depend on the WebView switch; the
// engine's start reads it each time (`engineProc`, below).
const p = planWith(false);
const webviewFile = switchPath(home, process.platform);

console.log(`tsundoku ${version}`);
console.log(`  data:   ${home}`);
console.log(`  logs:   ${join(home, 'logs')}`);
// Before anything else, the window's one rule.
if (!tray) console.log(`  Leave this window open while you read; closing it stops tsundoku.`);

// Where the app serves, as serve.ts writes it on every start (src/lib/server/bind.ts,
// `Serving`). Only local mode's address is localhost: on Tailscale the origin is
// the tailnet name or address, and a page opened anywhere else can't save.
const servingFile = join(home, SERVING_FILE);
const serving = (): Serving | null => {
	try {
		return readServing(readFileSync(servingFile, 'utf8'));
	} catch {
		return null;
	}
};
const localOnly = { origin: p.url, listen: `http://127.0.0.1:${p.ports.app}` };

/** Whether a tsundoku answers at `listen`. */
async function answers(listen: string): Promise<boolean> {
	try {
		const r = await fetch(`${listen}/manifest.webmanifest`, { signal: AbortSignal.timeout(1500) });
		return r.ok && ((await r.json()) as { short_name?: string }).short_name === 'tsundoku';
	} catch {
		return false;
	}
}

/** `asked`: the tray's OPEN, which opens even when started with --no-browser. */
function open(url: string, asked = false) {
	if (!browse && !asked) return;
	const o = opener(process.platform, url);
	const c = spawn(o.cmd, o.args, { stdio: 'ignore', detached: true, windowsHide: true });
	// A Linux with no xdg-open (a server, a container) fails to spawn it, and
	// an unhandled 'error' would stop tsundoku over a browser it couldn't open.
	c.on('error', (e) => console.warn(`Couldn't open a browser (${e.message}): open ${url}`));
	c.unref();
}

function opening(s: Serving) {
	console.log(
		tray ? `\nOpen ${s.origin}` : `\nOpen ${s.origin} (closing this window stops tsundoku).`
	);
	ready = s.origin;
	emit({ event: 'ready', origin: s.origin });
	if (!process.env.TSUNDOKU_TOKEN && !readLogin(home))
		console.log(`First start: choose a password in the browser.`);
	if (s.mode !== 'local')
		console.log(`On your phone or tablet, signed in to the same tailnet, open the same address.`);
	open(s.origin, wanted);
}

const children = new Set<ChildProcess>();
let stopping = false;

/** Stop a child and everything it started (FlareSolverr starts Chrome). */
function stop(child: ChildProcess) {
	if (child.exitCode !== null || child.pid === undefined) return;
	// Hidden: run by the tray, this launcher has no window of its own, and
	// taskkill would open one for a moment.
	if (windows)
		spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
			stdio: 'ignore',
			windowsHide: true
		});
	else {
		try {
			// Its own process group, made by `detached` below.
			process.kill(-child.pid, 'SIGTERM');
		} catch {
			child.kill('SIGTERM');
		}
	}
}

function stopAll(code: number) {
	if (stopping) return;
	stopping = true;
	unwatchFile(webviewFile);
	for (const c of children) stop(c);
	exit(code);
}

/** Exit once stdout has passed on every event: a pipe can be asynchronous, and the tray reads them. */
function exit(code: number) {
	if (tray) process.stdout.write('', () => process.exit(code));
	else process.exit(code);
}

/** Children stopped on purpose, to start again at once (the WebView switch), not as a crash. */
const restarting = new Set<ChildProcess>();

/**
 * A helper (the engine, FlareSolverr), its output to its log, started again
 * if it stops while tsundoku runs: the app's screens say what's missing
 * meanwhile, as they do on the workstation. `make` is asked for each start,
 * so the engine's reads the WebView switch as it stands then. `started` is
 * told each child.
 */
function helper(make: () => Proc, delay = 2000, started?: (c: ChildProcess) => void) {
	const proc = make();
	// Stamped and rotated (log.ts, c193).
	const log = new Log(join(home, 'logs', `${proc.name}.log`));
	log.line('INFO', `--- starting ${proc.name}`);
	const child = spawn(proc.cmd, proc.args, {
		cwd: proc.cwd,
		env: { ...process.env, ...proc.env },
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true,
		detached: !windows
	});
	children.add(child);
	started?.(child);
	child.stdout?.on('data', (c: Buffer) => log.write('INFO', c));
	child.stderr?.on('data', (c: Buffer) => log.write('ERROR', c));
	child.on('error', (e) => log.line('ERROR', `${proc.name} didn't start: ${e.message}`));
	child.on('exit', (code) => {
		children.delete(child);
		log.line(code ? 'ERROR' : 'INFO', `--- ${proc.name} stopped (${code})`);
		if (stopping) return;
		if (restarting.delete(child)) {
			// Asked for: started again at once, and not counted as a crash.
			setTimeout(() => helper(make, 2000, started), 500);
			return;
		}
		console.warn(`${proc.name} stopped; starting it again (its log: ${log.file}).`);
		setTimeout(() => helper(make, Math.min(delay * 2, 60_000), started), delay);
	});
}

/**
 * The engine, with the WebView switch as it stands at each start
 * (doc/EXTENSION-ENGINE.md, "Cloudflare and WebView extensions"), and the switch watched: when
 * SETTINGS turns it on or off, the engine is stopped (its process group, so a
 * private Xvfb and any Chromium go with it) and started again with the new
 * value. The app sees the change on `/capabilities` a few seconds later.
 */
let engineChild: ChildProcess | null = null;
let engineWebView = false;
function engineProc(): Proc {
	engineWebView = readSwitch(webviewFile);
	if (engineWebView)
		console.log(`  The engine runs WebView extensions (SETTINGS > BROWSE > WEBVIEW).`);
	return planWith(engineWebView).engine;
}
function watchWebView() {
	// Polled, not fs.watch: the file is renamed into place, which fs.watch
	// follows differently on each platform; a 2 s poll of one stat is nothing.
	watchFile(webviewFile, { interval: 2000, persistent: false }, () => {
		// A stopped engine reads the switch when it starts again anyway.
		if (
			stopping ||
			!engineChild ||
			engineChild.exitCode !== null ||
			engineChild.signalCode !== null
		)
			return;
		if (readSwitch(webviewFile) === engineWebView) return;
		console.log(
			`  The WebView was switched ${engineWebView ? 'off' : 'on'} in SETTINGS: restarting the engine.`
		);
		const old = engineChild;
		restarting.add(old);
		stop(old);
		// The engine's JVM outlives SIGTERM while an extension's WebView call is
		// in flight, until that call times out (measured 2026-11-12: 27 s, its
		// Xvfb and Chromium gone at once). The switch is asked for now, so after
		// a grace the old engine is ended outright.
		setTimeout(() => {
			if (old.exitCode !== null || old.signalCode !== null || old.pid === undefined) return;
			try {
				if (windows) old.kill('SIGKILL');
				else process.kill(-old.pid, 'SIGKILL');
			} catch {
				// Gone between the check and the kill.
			}
		}, 10_000).unref();
	});
}

// The tray's commands. OPEN before the app answers is kept until it does;
// stdin closing means the tray is gone (killed, or an update's installer
// stopped it), and nothing may outlive it.
let ready: string | null = null;
let wanted = false;
if (tray) {
	const reader = new CommandReader((c) => {
		if (c === 'quit') stopAll(0);
		else if (ready) open(ready, true);
		else wanted = true;
	});
	process.stdin.on('data', (chunk: Buffer) => reader.write(chunk));
	process.stdin.on('end', () => stopAll(0));
	process.stdin.on('error', () => stopAll(0));
}

// Already running: this start only opens it. Where the last start said it
// serves first, then the default, in case that file is from another mode.
for (const at of [serving(), localOnly]) {
	if (at && (await answers(at.listen))) {
		console.log(`Already running: opening ${at.origin}`);
		emit({ event: 'already', origin: at.origin });
		open(at.origin, wanted);
		exit(0);
		// Nothing more of this start may run before the write's callback exits.
		await new Promise(() => {});
	}
}
// From here, a serving.json is this start's.
rmSync(servingFile, { force: true });

mkdirSync(join(home, 'engine'), { recursive: true });
helper(engineProc, 2000, (c) => (engineChild = c));
watchWebView();
if (p.solver && solverDir) {
	for (const { from, to } of solverSetAside(solverDir, process.platform, existsSync)) {
		try {
			renameSync(from, to);
			console.log(`  FlareSolverr: set its own ${basename(from)} aside (the system's is used).`);
		} catch (e) {
			console.log(`  FlareSolverr: couldn't set ${from} aside: ${(e as Error).message}`);
		}
	}
	const solver = p.solver;
	helper(() => solver);
} else
	console.log(
		`  FlareSolverr isn't installed: sources behind a browser check won't load.\n` +
			`  (Unzip its archive into ${home}.)`
	);

// The app, its output to logs/tsundoku.log as the helpers' is. Not this
// window: selecting text in a Windows console (QuickEdit) stops whatever
// writes to it until Enter or Esc, so an app writing here froze mid-request
// while a friend copied something (suspected on 2026.10.30, c189). What a
// friend needs from this window, the launcher says itself.
const appLog = join(home, 'logs', 'tsundoku.log');
const serverLog = new Log(appLog);
serverLog.line('INFO', `--- starting tsundoku ${version}`);
const server = spawn(p.server.cmd, p.server.args, {
	cwd: p.server.cwd,
	env: { ...process.env, ...p.server.env },
	stdio: ['ignore', 'pipe', 'pipe'],
	windowsHide: true,
	detached: !windows
});
children.add(server);
// The last lines, to show if it stops: a start that fails says why here.
const tail: string[] = [];
for (const [out, level] of [
	[server.stdout, 'INFO'],
	[server.stderr, 'ERROR']
] as const) {
	out?.on('data', (chunk: Buffer) => {
		serverLog.write(level, chunk);
		tail.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
		tail.splice(0, Math.max(0, tail.length - 12));
	});
}
server.on('exit', (code) => {
	if (!stopping && code) {
		console.error(`\ntsundoku stopped (${code}). The end of its log (${appLog}):\n`);
		console.error(tail.map((l) => `  ${l}`).join('\n'));
		emit({ event: 'stopped', code, log: appLog });
		// A window that closes at once says nothing: wait to be read, as above.
		// The tray has no window; it says so in its menu instead.
		if (windows && !tray) {
			console.error('\nPress Enter to close this window.');
			process.stdin.once('data', () => stopAll(code));
			return;
		}
	}
	stopAll(code ?? 1);
});
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
// A closed window or terminal. On Linux the app and the engine are in process
// groups of their own, so the hangup reaches only this launcher, and without
// this they outlived it (c187).
process.on('SIGHUP', () => stopAll(0));

// Open the app once it answers, where it says it serves.
let opened = false;
for (let i = 0; i < 180 && !stopping && !opened; i++) {
	const s = serving();
	if (s && s.pid === server.pid && (await answers(s.listen))) {
		opening(s);
		opened = true;
	} else await new Promise((r) => setTimeout(r, 500));
}
if (!opened && !stopping)
	console.warn(`\ntsundoku hasn't answered yet; its address is printed above once it does.`);
