/**
 * Serve the built app.
 *
 *   yarn run build && yarn run serve
 *
 * Three ways, and HTTPS is the default (doc/SERVING.md):
 *
 * - **https** -- the app listens on 127.0.0.1 only, and `tailscale serve`
 *   terminates TLS with the machine's tailnet certificate on port 8443
 *   (TSUNDOKU_HTTPS_PORT). Nothing but the proxy can reach the app, and the
 *   reader gets the secure context WebAuthn, the wake lock and service
 *   workers need. The mapping is added if missing, never over someone else's.
 * - **http** (TSUNDOKU_SERVE=http) -- the old way: plain http on the tailnet
 *   address, as kirisute does.
 * - **local** (TSUNDOKU_SERVE=local) -- plain http on 127.0.0.1, opened as
 *   http://localhost on the same computer. A friend's install, with no
 *   Tailscale (doc/DISTRIBUTION.md); localhost is a secure context too.
 *
 * Either way this wrapper exists because `node build` is one forgotten
 * variable away from being wrong without saying so: adapter-node defaults to
 * 0.0.0.0 (this box has no firewall, so that is the LAN), and a wrong ORIGIN
 * 403s every POST -- the app loads and then no rating saves. Both are decided
 * here, before the server is imported; adapter-node reads its environment at
 * module load.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from '../src/lib/server/fspath.ts';
import { fileURLToPath } from 'node:url';
import {
	BindRefused,
	SERVING_FILE,
	TAILSCALE_HTTPS_PORTS,
	httpsOrigin,
	localOrigin,
	originFor,
	resolveBindHost,
	serveMode,
	serveState,
	tailnetName,
	tailscaleCommand,
	type ServeMode,
	type Serving
} from '../src/lib/server/bind.ts';
import { dataPaths } from '../src/lib/server/data-dirs.ts';
import { ensureToken } from '../src/lib/server/first-run.ts';
import { readLogin } from '../src/lib/server/login.ts';
import { startListeners } from '../src/lib/server/lan-listen.ts';

const root = new URL('../', import.meta.url);
const built = new URL('build/', root);
// The server runs from its own copy of the build, taken now. `build/` is
// rebuilt in place by `yarn run build` and by every e2e run, and a server
// serving it lost its scripts under it and crashed on the first request for
// one that was gone (doc/SERVING.md). The copy sits inside the project, so it
// still finds node_modules.
//
// Not a release's (TSUNDOKU_SNAPSHOT=off, set by its launcher): a release is
// never rebuilt in place, and its folder may not be writable (Program Files).
const snapshotting = process.env.TSUNDOKU_SNAPSHOT !== 'off';
const servingDir = new URL('.serving/', root);
const snapshot = snapshotting ? new URL(`${Date.now()}/`, servingDir) : built;
const entry = new URL('index.js', snapshot);

// A plain node process gets none of Vite's .env loading, and the token lives
// there. Shell variables still win: loadEnvFile does not overwrite them.
// TSUNDOKU_PROJECT_ENV=off skips it: the browser suite's friend install
// (tests/friend-setup.ts) runs from this checkout and must never pick up the
// owner's own tokens. A release has no project .env at all.
try {
	if (process.env.TSUNDOKU_PROJECT_ENV !== 'off')
		process.loadEnvFile(fileURLToPath(new URL('.env', root)));
} catch {
	// Absent .env is not fatal: a friend's install keeps its settings in the data folder.
}

// Then the data folder's own .env, which is where a friend's install keeps its
// settings (the program's folder may not be theirs to write). The project's
// .env, read first, wins over it; the shell wins over both.
const homeEnv = join(dataPaths().home, '.env');
try {
	process.loadEnvFile(homeEnv);
} catch {
	// None yet: a first start, or the workstation, whose .env is the project's.
}

const fail = (message: string): never => {
	console.error(message);
	process.exit(1);
};

if (!existsSync(new URL('index.js', built))) fail('no build/ found. Run `yarn run build` first.');

let mode: ServeMode = 'https';
try {
	mode = serveMode(process.env.TSUNDOKU_SERVE);
} catch (e) {
	fail((e as Error).message);
}

// A friend's install signs in with a password chosen on first open, never a
// token (doc/SIGN-IN.md; TSUNDOKU_LOGIN=password, set by its launcher).
const friend = process.env.TSUNDOKU_LOGIN === 'password';
const login = friend ? readLogin(dataPaths().home) : null;
// No password, or none chosen yet, is for this computer alone: whoever reached
// SET UP first would claim the library, and with none, anyone on the tailnet
// would walk in. The page refuses too; this says why before anything listens.
if (friend && mode !== 'local' && login?.kind !== 'password')
	fail(
		`tsundoku needs a password before it's on Tailscale, or anyone there could open it.\n` +
			`Take TSUNDOKU_SERVE out of ${homeEnv}, start tsundoku, set a password in\n` +
			`SETTINGS > DEVICES, then put the line back.`
	);

// No token anywhere: make one and keep it, rather than exit on a first start.
let madeToken = false;
if (!friend && !process.env.TSUNDOKU_TOKEN) {
	const { token, created } = ensureToken(homeEnv);
	process.env.TSUNDOKU_TOKEN = token;
	madeToken = created;
}

const port = Number(process.env.PORT ?? 42143);
if (!Number.isInteger(port) || port < 1 || port > 65535)
	fail(`PORT=${process.env.PORT} is not a usable port.`);

const tailscaleCli = tailscaleCommand(process.platform, process.env, existsSync);
const tailscale = (...args: string[]) => execFileSync(tailscaleCli, args, { encoding: 'utf8' });
const windows = process.platform === 'win32';

let host: string;
let origin: string;
let note: string;

if (mode === 'local') {
	// Loopback only, whatever HOST says: this mode is the one with no other guard.
	host = '127.0.0.1';
	origin = process.env.ORIGIN ?? localOrigin(port);
	note = 'local: this computer only, no Tailscale';
} else if (mode === 'https') {
	const httpsPort = Number(process.env.TSUNDOKU_HTTPS_PORT ?? 8443);
	if (!(TAILSCALE_HTTPS_PORTS as readonly number[]).includes(httpsPort))
		fail(
			`TSUNDOKU_HTTPS_PORT must be one of ${TAILSCALE_HTTPS_PORTS.join(', ')}: tailscale serve takes no other.`
		);
	let name: string | null = null;
	try {
		name = tailnetName(JSON.parse(tailscale('status', '--json')));
	} catch {
		fail(
			windows
				? '`tailscale status` failed: is Tailscale installed, running and signed in? ' +
						"Remove TSUNDOKU_SERVE from the data folder's .env to use tsundoku on this computer only."
				: '`tailscale status` failed: is tailscaled up? TSUNDOKU_SERVE=http serves plain http instead.'
		);
	}
	if (!name)
		fail(
			'this machine has no tailnet HTTPS certificate. Enable MagicDNS and HTTPS certificates in the ' +
				'Tailscale admin console (DNS page), or set TSUNDOKU_SERVE=http.'
		);
	host = '127.0.0.1';
	const target = `http://127.0.0.1:${port}`;
	const state = serveState(
		JSON.parse(tailscale('serve', 'status', '--json') || '{}'),
		name!,
		httpsPort,
		target
	);
	if (state === 'taken')
		fail(
			`https port ${httpsPort} is already served by something else (tailscale serve status). ` +
				`Pick another with TSUNDOKU_HTTPS_PORT (${TAILSCALE_HTTPS_PORTS.join(', ')}).`
		);
	if (state === 'free') {
		try {
			// Tailnet only: `serve`, never `funnel`.
			tailscale('serve', '--bg', `--https=${httpsPort}`, target);
		} catch {
			fail(
				`could not add the tailscale serve mapping. Run it once yourself:\n` +
					`  ${tailscaleCli.includes(' ') ? `"${tailscaleCli}"` : tailscaleCli} serve --bg --https=${httpsPort} ${target}\n` +
					(windows
						? `(in a terminal; if it's refused there too, in one opened with "Run as administrator").`
						: `(it may need \`sudo tailscale set --operator=$USER\` first).`)
			);
		}
	}
	origin = process.env.ORIGIN ?? httpsOrigin(name!, httpsPort);
	note = `https through tailscale serve, app on ${target}${state === 'free' ? ' (mapping added)' : ''}`;
} else {
	try {
		const bind = resolveBindHost({
			requested: process.env.HOST,
			allowAny: process.env.TSUNDOKU_BIND_ANY === '1'
		});
		host = bind.host;
		note =
			bind.source === 'tailnet'
				? 'plain http, tailnet address auto-detected'
				: bind.source === 'wildcard-override'
					? 'WILDCARD -- reachable from the whole LAN, not just the tailnet'
					: 'plain http, from HOST';
	} catch (e) {
		if (e instanceof BindRefused) fail(e.message);
		throw e;
	}
	origin = process.env.ORIGIN ?? originFor(host!, port);
}

process.env.HOST = host!;
process.env.PORT = String(port);
process.env.NODE_ENV = 'production';
// Local mode answers at more than one address once WI-FI is on (doc/WIFI.md):
// localhost here, the phone's view of this computer there. So no single
// ORIGIN; each request's origin is the Host it asked for, over plain http
// (lan-listen.ts sets the protocol header), and the hook refuses a Host that
// isn't one of ours. TSUNDOKU_ORIGIN keeps the one localhost is sent to.
if (mode === 'local' && !process.env.ORIGIN) {
	delete process.env.ORIGIN;
	process.env.PROTOCOL_HEADER = 'x-tsundoku-proto';
	process.env.TSUNDOKU_ORIGIN = origin!;
} else process.env.ORIGIN = origin!;

if (snapshotting) {
	// Older copies belong to servers that have stopped; this one replaces them.
	for (const old of existsSync(servingDir) ? readdirSync(servingDir) : [])
		rmSync(new URL(old, servingDir), { recursive: true, force: true });
	cpSync(built, snapshot, { recursive: true });
}

// Where it serves, for a release's launcher to open (doc/RELEASE.md, "The
// launcher"): only local mode's address is localhost. Best effort: a folder
// that can't be written to doesn't stop the server.
const serving: Serving = {
	pid: process.pid,
	mode,
	origin: origin!,
	listen: originFor(host!, port)
};
try {
	writeFileSync(join(dataPaths().home, SERVING_FILE), JSON.stringify(serving) + '\n');
} catch {
	// The workstation's data folder is always there; a friend's is made by the launcher.
}

console.log(`tsundoku  ${origin!}  (${note!})`);
if (friend && !login) console.log('First start: choose a password in the browser.');
if (madeToken)
	console.log(
		`First start: your sign-in token is ${process.env.TSUNDOKU_TOKEN}\n` +
			`It's kept in ${homeEnv}; sign in once per browser.`
	);

if (mode === 'local' && process.env.PROTOCOL_HEADER) {
	// The app's handler on our own listeners: 127.0.0.1, and the home network's
	// while WI-FI is on, switched from SETTINGS (src/lib/server/lan-listen.ts).
	const { handler } = (await import(new URL('handler.js', snapshot).href)) as {
		handler: Parameters<typeof startListeners>[0]['handler'];
	};
	const lan = await startListeners({ handler, port, home: dataPaths().home });
	(globalThis as { __tsundokuLan?: unknown }).__tsundokuLan = lan;
	// What adapter-node's own entry does on a signal, which these listeners
	// replace: tell the app (its workers stop on SIGTERM but don't exit), close
	// the listeners, and go. Without it a SIGTERM -- a Linux launcher's, a
	// closed terminal's -- left the server running.
	const shutdown = (reason: 'SIGTERM' | 'SIGINT') => {
		(process.emit as (e: string, r: string) => boolean)('sveltekit:shutdown', reason);
		setTimeout(() => process.exit(0), 3000).unref();
		void lan.close().finally(() => process.exit(0));
	};
	process.once('SIGTERM', () => shutdown('SIGTERM'));
	process.once('SIGINT', () => shutdown('SIGINT'));
	console.log(`Listening on http://127.0.0.1:${port}`);
	const s = lan.status();
	if (s.on) console.log(`WI-FI is on: ${s.listening.join(', ') || 'no home-network address yet'}`);
} else await import(entry.href);
