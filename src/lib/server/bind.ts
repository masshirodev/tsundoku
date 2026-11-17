import { networkInterfaces } from 'node:os';

type Interfaces = ReturnType<typeof networkInterfaces>;

/**
 * Tailscale hands out addresses from the CGNAT range 100.64.0.0/10, so an
 * IPv4 address is on the tailnet exactly when its first octet is 100 and its
 * second is 64..127. That is worth matching on rather than matching on the
 * interface being named "tailscale0": the name is a default, the range is the
 * protocol.
 */
export function isTailnetAddress(address: string): boolean {
	const parts = address.split('.');
	if (parts.length !== 4) return false;
	const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1));
	if (octets.some((n) => n < 0 || n > 255)) return false;
	return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

/**
 * A wildcard bind is the one outcome this whole module exists to prevent. The
 * workstation has no firewall active, so listening on 0.0.0.0 publishes the
 * reading library to every device on the LAN, not just to the tailnet.
 */
export function isWildcard(host: string): boolean {
	const trimmed = host.trim().replace(/^\[|\]$/g, '');
	return trimmed === '' || trimmed === '*' || trimmed === '0.0.0.0' || trimmed === '::';
}

export function tailnetAddresses(interfaces: Interfaces = networkInterfaces()): string[] {
	return Object.values(interfaces)
		.flatMap((addrs) => addrs ?? [])
		.filter((a) => a.family === 'IPv4' && !a.internal && isTailnetAddress(a.address))
		.map((a) => a.address);
}

export type Bind = {
	host: string;
	/** Where the address came from, for the line the server prints on startup. */
	source: 'requested' | 'tailnet' | 'wildcard-override';
};

export class BindRefused extends Error {}

/**
 * Decide what to listen on.
 *
 * Unset is the common case and resolves to the tailnet address, because that
 * is the only answer that is ever wanted here -- adapter-node's own default is
 * 0.0.0.0, which is why leaving HOST unset must not fall through to it.
 *
 * An explicit non-wildcard host is honoured as-is: 127.0.0.1 for a local smoke
 * test is legitimate and is not this function's business to second-guess.
 */
export function resolveBindHost(opts: {
	requested?: string;
	allowAny?: boolean;
	interfaces?: Interfaces;
}): Bind {
	const requested = opts.requested?.trim() ?? '';

	if (requested !== '' && !isWildcard(requested)) return { host: requested, source: 'requested' };

	if (requested !== '' && isWildcard(requested)) {
		if (opts.allowAny) return { host: '0.0.0.0', source: 'wildcard-override' };
		throw new BindRefused(
			`refusing to bind to ${requested}: this box has no firewall active, so a wildcard ` +
				`bind serves the library to the LAN as well as the tailnet. ` +
				`Set TSUNDOKU_BIND_ANY=1 if that is genuinely what you want.`
		);
	}

	const found = tailnetAddresses(opts.interfaces);

	if (found.length === 0) {
		throw new BindRefused(
			'no tailnet address found (is tailscaled up?). Refusing to fall back to a wildcard bind; ' +
				'set HOST explicitly to listen on something else.'
		);
	}

	if (found.length > 1) {
		throw new BindRefused(
			`several tailnet addresses found (${found.join(', ')}); set HOST to pick one.`
		);
	}

	return { host: found[0], source: 'tailnet' };
}

/**
 * ORIGIN has to be exact. adapter-node checks it against the Origin header on
 * every mutating request, so an unset or mismatched value 403s every POST --
 * the app loads perfectly, and then no rating saves. Deriving it from the
 * host and port that were actually bound is the only way it cannot drift.
 */
export function originFor(host: string, port: number): string {
	const authority = host.includes(':') ? `[${host}]` : host;
	return `http://${authority}:${port}`;
}

// ---- HTTPS through `tailscale serve` ----------------------------------------------
//
// The reader needs a secure context: WebAuthn (the /reveal fingerprint gate),
// the screen wake lock, and service workers all refuse plain http. Tailscale
// already holds a certificate for this machine's tailnet name and renews it
// itself; `tailscale serve` terminates TLS with it and proxies to the app,
// which then only needs to listen on 127.0.0.1 -- tighter than the tailnet
// bind, since nothing but the proxy can reach it. doc/SERVING.md.

/** `tailscale serve` accepts HTTPS on these ports only. */
export const TAILSCALE_HTTPS_PORTS = [443, 8443, 10000] as const;

/** This machine's tailnet name from `tailscale status --json`, if HTTPS certificates are enabled for it. */
export function tailnetName(status: unknown): string | null {
	const s = status as { Self?: { DNSName?: string }; CertDomains?: string[] | null } | null;
	const name = s?.Self?.DNSName?.replace(/\.$/, '') ?? '';
	if (!name) return null;
	return (s?.CertDomains ?? []).includes(name) ? name : null;
}

export function httpsOrigin(name: string, port: number): string {
	return port === 443 ? `https://${name}` : `https://${name}:${port}`;
}

/**
 * What `tailscale serve status --json` says about an HTTPS port: free, already
 * proxying to `target` (nothing to do), or taken by something else -- which
 * is never overwritten; the port has to be chosen again.
 */
export function serveState(
	status: unknown,
	name: string,
	httpsPort: number,
	target: string
): 'free' | 'ours' | 'taken' {
	const s = status as {
		TCP?: Record<string, unknown>;
		Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
	} | null;
	const web = s?.Web?.[`${name}:${httpsPort}`];
	if (!web && !s?.TCP?.[String(httpsPort)]) return 'free';
	const handlers = Object.entries(web?.Handlers ?? {});
	return handlers.length === 1 && handlers[0][0] === '/' && handlers[0][1].Proxy === target
		? 'ours'
		: 'taken';
}

// ---- How serve.ts serves ----------------------------------------------------------

/**
 * - `https`: the app on 127.0.0.1 behind `tailscale serve` (the workstation).
 * - `http`: plain http on the tailnet address, the old way.
 * - `local`: plain http on 127.0.0.1, opened as http://localhost on the same
 *   computer, no Tailscale at all. A friend's install (doc/DISTRIBUTION.md).
 *   Browsers treat localhost as a secure context, so installing the app,
 *   offline chapters and the fingerprint gate all work without a certificate.
 */
export const SERVE_MODES = ['https', 'http', 'local'] as const;
export type ServeMode = (typeof SERVE_MODES)[number];

/**
 * TSUNDOKU_SERVE, unset meaning https. Anything else is refused by name, so a
 * typo never serves another mode without a word.
 */
export function serveMode(value: string | undefined): ServeMode {
	const v = (value ?? '').trim() || 'https';
	if ((SERVE_MODES as readonly string[]).includes(v)) return v as ServeMode;
	throw new BindRefused(`TSUNDOKU_SERVE=${value} is not one of ${SERVE_MODES.join(', ')}.`);
}

/**
 * Local mode's origin. Browsers treat both localhost and 127.0.0.1 as secure,
 * but ORIGIN has one value, and the name is the one people type and the
 * launcher opens. 127.0.0.1 in the address bar loads and then can't save
 * (adapter-node's origin check): SERVING.md says to use localhost.
 */
export const localOrigin = (port: number) => `http://localhost:${port}`;

/**
 * In local mode, where a request that came in under another loopback name
 * (127.0.0.1, [::1]) should go instead: the same path on the origin's host.
 * Null when it already is the origin's host, or isn't loopback at all. Pages
 * opened under the other name would load and then fail every save on the
 * origin check, so they're sent to localhost before anything is drawn.
 */
export function loopbackRedirect(hostHeader: string | null, origin: string): string | null {
	if (!hostHeader) return null;
	const want = new URL(origin);
	let got: URL;
	try {
		got = new URL(`http://${hostHeader}`);
	} catch {
		return null;
	}
	if (got.host === want.host) return null;
	return ['127.0.0.1', '[::1]'].includes(got.hostname) ? want.host : null;
}

// ---- Finding the tailscale CLI ----------------------------------------------------

/**
 * The `tailscale` command. On Linux and macOS it's on PATH. Windows' installer
 * puts it in Program Files and leaves PATH alone, so https mode would look
 * for a `tailscale` that isn't there; Program Files is checked first, then PATH, for an install somewhere else.
 */
export function tailscaleCommand(
	platform: NodeJS.Platform,
	env: Record<string, string | undefined>,
	exists: (file: string) => boolean
): string {
	if (platform !== 'win32') return 'tailscale';
	const installed = `${env.ProgramFiles || 'C:\\Program Files'}\\Tailscale\\tailscale.exe`;
	return exists(installed) ? installed : 'tailscale';
}

// ---- Where it serves, for the launcher ----------------------------------------------

/**
 * Where a running server can be reached, written by serve.ts to `serving.json`
 * in the data folder before the app starts. A release's launcher reads it
 * (doc/RELEASE.md, "The launcher"): the address to open is the origin, which in
 * https mode is the tailnet name and in http mode the tailnet address, and
 * only `local` mode's is localhost. `listen` is where the app itself answers,
 * for a probe that needn't go through Tailscale. `pid` says which start wrote it.
 */
export type Serving = { pid: number; mode: ServeMode; origin: string; listen: string };

export const SERVING_FILE = 'serving.json';

/** A serving.json's contents, or null for anything that isn't one (absent, torn, older). */
export function readServing(text: string | null | undefined): Serving | null {
	if (!text) return null;
	try {
		const s = JSON.parse(text) as Partial<Serving>;
		if (
			Number.isInteger(s.pid) &&
			(SERVE_MODES as readonly unknown[]).includes(s.mode) &&
			typeof s.origin === 'string' &&
			/^https?:\/\//.test(s.origin) &&
			typeof s.listen === 'string' &&
			/^http:\/\//.test(s.listen)
		)
			return s as Serving;
	} catch {
		// Torn mid-write, or not ours: as good as absent.
	}
	return null;
}

/**
 * In local mode, whether a request names a host that isn't this app at all:
 * anything but the origin's host and the loopback names `loopbackRedirect`
 * sends there. A web page can point a name of its own at 127.0.0.1 (DNS
 * rebinding) and then talk to the app as if it were its own site, the
 * origin check none the wiser, since to the browser it is the same origin.
 * The Host header still says the page's name, so it's refused on that:
 * with no password set, this check is all there is.
 */
export function foreignHost(hostHeader: string | null, origin: string): boolean {
	if (!hostHeader) return true;
	if (hostHeader === new URL(origin).host) return false;
	return loopbackRedirect(hostHeader, origin) === null;
}

// ---- What one start must not leave to the next ---------------------------------------

/**
 * What the launcher and serve.ts set in the server's environment for that
 * one run (ops/release/launcher/plan.ts, scripts/serve.ts). An update starts
 * the installer from the server, and the installer starts the new version:
 * each inherits the one before's environment, so the new serve.ts would find
 * the old one's ORIGIN, take the old one's path, and lose WI-FI. None of these is a friend's to
 * set: their settings live in the data folder's .env.
 */
export const SERVER_ENV = [
	'ORIGIN',
	'HOST',
	'PORT',
	'PROTOCOL_HEADER',
	'TSUNDOKU_ORIGIN',
	'NODE_ENV',
	'TSUNDOKU_SERVE',
	'TSUNDOKU_SNAPSHOT',
	'TSUNDOKU_LOGIN',
	'TSUNDOKU_HOME',
	'TSUNDOKU_UPDATES',
	'TSUNDOKU_INSTALLED',
	'TSUNDOKU_TOKEN',
	'DATABASE_PATH',
	'ENGINE_URL',
	'ENGINE_TOKEN',
	'ENGINE_SOLVER_URL',
	// The address a signed-in user's AniList token is posted to: only the
	// e2e's stand-in sets it, and it must never be inherited.
	'TSUNDOKU_ANILIST_URL',
	'FFMPEG',
	'FFPROBE'
] as const;

/** The variables that change how serve.ts serves: what a launcher drops if it finds them inherited. */
export const SERVE_SHAPING = [
	'ORIGIN',
	'HOST',
	'PROTOCOL_HEADER',
	'TSUNDOKU_ORIGIN',
	'NODE_ENV'
] as const;

/** An environment without the server's own variables: for a process that starts the next tsundoku. */
export function withoutServerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const out = { ...env };
	for (const k of SERVER_ENV) delete out[k];
	return out;
}
