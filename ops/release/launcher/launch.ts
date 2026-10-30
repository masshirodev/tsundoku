/**
 * tsundoku's launcher, in a release bundle (doc/RELEASE.md, "The launcher").
 * Run by the bundle's own Node, from `tsundoku.cmd` or `tsundoku`:
 *
 *   tsundoku                  # start everything, open the browser
 *   tsundoku --no-browser     # start everything, open nothing
 *   tsundoku --reset-password # forget the password: the next open is SET UP
 *
 * It starts the extension engine, FlareSolverr when its optional archive was
 * unzipped beside it, and the app, then opens the app where it serves:
 * http://localhost, or its tailnet address when the data folder's .env puts
 * it on Tailscale.
 * Closing it (Ctrl+C, or closing its window) stops all three. Started again
 * while it runs, it just opens the app.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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
import { Log } from './log.ts';
import { opener, plan, solverAt, type Proc } from './plan.ts';

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
const engineToken =
	process.env.ENGINE_TOKEN || ensureSetting(homeEnv, 'ENGINE_TOKEN', newToken).value;
const solverDir = solverAt(root, home, process.platform, existsSync);
const p = plan({
	root,
	home,
	env: process.env,
	platform: process.platform,
	engineToken,
	solverDir,
	installed: windows && existsSync(join(root, 'uninstall.exe'))
});

console.log(`tsundoku ${version}`);
console.log(`  data:   ${home}`);
console.log(`  logs:   ${join(home, 'logs')}`);
// Before anything else, the window's one rule.
console.log(`  Leave this window open while you read; closing it stops tsundoku.`);

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

function open(url: string) {
	if (!browse) return;
	const o = opener(process.platform, url);
	spawn(o.cmd, o.args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}

function opening(s: Serving) {
	console.log(`\nOpen ${s.origin} (closing this window stops tsundoku).`);
	if (!readLogin(home)) console.log(`First start: choose a password in the browser.`);
	if (s.mode !== 'local')
		console.log(`On your phone or tablet, signed in to the same tailnet, open the same address.`);
	open(s.origin);
}

const children = new Set<ChildProcess>();
let stopping = false;

/** Stop a child and everything it started (FlareSolverr starts Chrome). */
function stop(child: ChildProcess) {
	if (child.exitCode !== null || child.pid === undefined) return;
	if (windows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
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
	for (const c of children) stop(c);
	process.exit(code);
}

/**
 * A helper (the engine, FlareSolverr), its output to its log, started again
 * if it stops while tsundoku runs: the app's screens say what's missing
 * meanwhile, as they do on the workstation.
 */
function helper(proc: Proc, delay = 2000) {
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
	child.stdout?.on('data', (c: Buffer) => log.write('INFO', c));
	child.stderr?.on('data', (c: Buffer) => log.write('ERROR', c));
	child.on('error', (e) => log.line('ERROR', `${proc.name} didn't start: ${e.message}`));
	child.on('exit', (code) => {
		children.delete(child);
		log.line(code ? 'ERROR' : 'INFO', `--- ${proc.name} stopped (${code})`);
		if (stopping) return;
		console.warn(`${proc.name} stopped; starting it again (its log: ${log.file}).`);
		setTimeout(() => helper(proc, Math.min(delay * 2, 60_000)), delay);
	});
}

// Already running: this start only opens it. Where the last start said it
// serves first, then the default, in case that file is from another mode.
for (const at of [serving(), localOnly]) {
	if (at && (await answers(at.listen))) {
		console.log(`Already running: opening ${at.origin}`);
		open(at.origin);
		process.exit(0);
	}
}
// From here, a serving.json is this start's.
rmSync(servingFile, { force: true });

mkdirSync(join(home, 'engine'), { recursive: true });
helper(p.engine);
if (p.solver) helper(p.solver);
else
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
		// A window that closes at once says nothing: wait to be read, as above.
		if (windows) {
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
