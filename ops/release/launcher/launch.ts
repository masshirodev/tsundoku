/**
 * tsundoku's launcher, in a release bundle (doc/RELEASE.md, "The launcher").
 * Run by the bundle's own Node, from `tsundoku.cmd` or `tsundoku`:
 *
 *   tsundoku              # start everything, open the browser
 *   tsundoku --no-browser # start everything, open nothing
 *
 * It starts the extension engine, FlareSolverr when its optional archive was
 * unzipped beside it, and the app on http://localhost, then opens the app.
 * Closing it (Ctrl+C, or closing its window) stops all three. Started again
 * while it runs, it just opens the app.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPaths } from '../app/src/lib/server/data-dirs.ts';
import { ensureSetting, newToken } from '../app/src/lib/server/first-run.ts';
import { opener, plan, solverAt, type Proc } from './plan.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
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
	solverDir
});

console.log(`tsundoku ${version}`);
console.log(`  data:   ${home}`);
console.log(`  logs:   ${join(home, 'logs')}`);

/** Whether a tsundoku already answers on the app's port: then this one only opens it. */
async function running(): Promise<boolean> {
	try {
		const r = await fetch(`http://127.0.0.1:${p.ports.app}/manifest.webmanifest`, {
			signal: AbortSignal.timeout(1500)
		});
		return r.ok && ((await r.json()) as { short_name?: string }).short_name === 'tsundoku';
	} catch {
		return false;
	}
}

function open() {
	if (!browse) return;
	const o = opener(process.platform, p.url);
	spawn(o.cmd, o.args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
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
	const log = createWriteStream(join(home, 'logs', `${proc.name}.log`), { flags: 'a' });
	log.write(`\n--- ${new Date().toISOString()} starting ${proc.name}\n`);
	const child = spawn(proc.cmd, proc.args, {
		cwd: proc.cwd,
		env: { ...process.env, ...proc.env },
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true,
		detached: !windows
	});
	children.add(child);
	child.stdout?.pipe(log, { end: false });
	child.stderr?.pipe(log, { end: false });
	child.on('error', (e) => log.write(`${proc.name} didn't start: ${e.message}\n`));
	child.on('exit', (code) => {
		children.delete(child);
		log.write(`--- ${proc.name} stopped (${code})\n`);
		if (stopping) return;
		console.warn(`${proc.name} stopped; starting it again (its log: ${log.path}).`);
		setTimeout(() => helper(proc, Math.min(delay * 2, 60_000)), delay);
	});
}

if (await running()) {
	console.log(`Already running: opening ${p.url}`);
	open();
	process.exit(0);
}

mkdirSync(join(home, 'engine'), { recursive: true });
helper(p.engine);
if (p.solver) helper(p.solver);
else
	console.log(
		`  FlareSolverr isn't installed: sources behind a browser check won't load.\n` +
			`  (Unzip its archive into ${home}.)`
	);

// The app in this window: its first start prints the sign-in token here.
const server = spawn(p.server.cmd, p.server.args, {
	cwd: p.server.cwd,
	env: { ...process.env, ...p.server.env },
	stdio: 'inherit',
	detached: !windows
});
children.add(server);
server.on('exit', (code) => stopAll(code ?? 1));
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
if (windows) process.on('SIGHUP', () => stopAll(0));

// Open the app once it answers.
for (let i = 0; i < 120 && !stopping; i++) {
	if (await running()) {
		console.log(`\nOpen ${p.url} (closing this window stops tsundoku).`);
		open();
		break;
	}
	await new Promise((r) => setTimeout(r, 500));
}
