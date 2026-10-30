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
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from '../src/lib/server/fspath.ts';
import { fileURLToPath } from 'node:url';
import {
	BindRefused,
	TAILSCALE_HTTPS_PORTS,
	httpsOrigin,
	localOrigin,
	originFor,
	resolveBindHost,
	serveMode,
	serveState,
	tailnetName,
	type ServeMode
} from '../src/lib/server/bind.ts';
import { dataPaths } from '../src/lib/server/data-dirs.ts';
import { ensureToken } from '../src/lib/server/first-run.ts';

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
try {
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

// No token anywhere: make one and keep it, rather than exit on a first start.
let madeToken = false;
if (!process.env.TSUNDOKU_TOKEN) {
	const { token, created } = ensureToken(homeEnv);
	process.env.TSUNDOKU_TOKEN = token;
	madeToken = created;
}

const port = Number(process.env.PORT ?? 42143);
if (!Number.isInteger(port) || port < 1 || port > 65535)
	fail(`PORT=${process.env.PORT} is not a usable port.`);

const tailscale = (...args: string[]) => execFileSync('tailscale', args, { encoding: 'utf8' });

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
			'`tailscale status` failed: is tailscaled up? TSUNDOKU_SERVE=http serves plain http instead.'
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
					`  tailscale serve --bg --https=${httpsPort} ${target}\n` +
					`(it may need \`sudo tailscale set --operator=$USER\` first).`
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
process.env.ORIGIN = origin!;
process.env.NODE_ENV = 'production';

if (snapshotting) {
	// Older copies belong to servers that have stopped; this one replaces them.
	for (const old of existsSync(servingDir) ? readdirSync(servingDir) : [])
		rmSync(new URL(old, servingDir), { recursive: true, force: true });
	cpSync(built, snapshot, { recursive: true });
}

console.log(`tsundoku  ${origin!}  (${note!})`);
if (madeToken)
	console.log(
		`First start: your sign-in token is ${process.env.TSUNDOKU_TOKEN}\n` +
			`It's kept in ${homeEnv}; sign in once per browser.`
	);

await import(entry.href);
