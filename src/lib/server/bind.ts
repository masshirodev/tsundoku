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
