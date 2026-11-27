// What the fetcher may reach on the reader's own network (c1140).
//
// The self-hosted server never fetches a private address on a source's or a
// repository's say-so (src/lib/server/net-guard.ts). In the web edition every
// such fetch is the fetcher's, from the reader's own browser, inside their
// home network. An extension, an index or a redirect could name the router,
// a NAS or a printer, and the browser would send it the reader's cookies for
// that host. So the fetcher refuses the reader's own network as the server
// does, with one way back: hosts the reader allows, one at a time, in the
// fetcher's own options (never from the page, which runs the extensions it
// would be protecting the reader from).
//
// Three checks, because no single place sees everything:
//
// 1. Before fetching, the URL asked for (`refusal`): an address that is not
//    public, or a name that can only be local (`isLocalName`). This gives the
//    clearest error.
// 2. Every redirect hop, by the browser (`guardRules`): `fetch()` follows
//    redirects itself and an extension can't read a redirect's Location, so
//    declarativeNetRequest session rules block the same addresses and names
//    on each request the extension makes, the first and every hop after it.
// 3. Where a public name led (`refusedAddress`): a name can resolve to a
//    private address (DNS rebinding). The address connected to is checked when
//    the browser reports it, and the answer is thrown away. Firefox resolves
//    the name first and refuses before sending; Chromium can only report
//    afterwards, so there one request reaches the device (doc/WEB-EDITION.md,
//    "The reader's own network").
import { ipVersion, isLocalName, isPublicIp, LOCAL_SUFFIXES } from '../server/public-ip.ts';
import { NO_TAB, RULE_PRIORITY } from './plan.ts';
import type { FetcherEdition } from './protocol.ts';

/**
 * Hosts the development build may always reach: the browser test's server
 * is on loopback (fetcher/test/server.ts). The store build has none.
 */
export function builtInAllowed(edition: FetcherEdition): string[] {
	return edition === 'development' ? ['localhost', '127.0.0.1', '[::1]'] : [];
}

/** Where the fetcher's options keep the reader's allowed hosts (`storage.local`). */
export const ALLOWED_HOSTS_KEY = 'allowedHosts';

/** The allowed hosts from what storage holds: a list of strings, anything else none. */
export function readAllowedHosts(stored: Record<string, unknown>): string[] {
	const list = stored[ALLOWED_HOSTS_KEY];
	return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string') : [];
}

/**
 * One entry of the allow list as the reader typed it, made canonical: the
 * host as a URL writes it (lower case, IPv6 in brackets), and the port when
 * one was given. `nas.lan` allows every port on that host; `nas.lan:8080`
 * only that one. A full address is accepted and cut down to its host and
 * port. Null for anything that names no host.
 */
export function parseAllowEntry(text: string): string | null {
	const typed = text.trim();
	if (!typed || /\s/.test(typed)) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `http://${typed}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (!url.hostname || url.username || url.password) return null;
	// A port typed explicitly is kept even when it is the scheme's default,
	// which URL drops: `nas.lan:80` means that port, not every port.
	const authority = withScheme.replace(/^[^:]+:\/\//, '').split(/[/?#]/)[0];
	const port = /:(\d+)$/.exec(authority);
	return port ? `${url.hostname}:${Number(port[1])}` : url.hostname;
}

/** The host and the port a URL connects to, as an allow entry names them. */
function hostAndPort(url: URL): { host: string; port: string } {
	return { host: url.hostname, port: url.port || (url.protocol === 'https:' ? '443' : '80') };
}

/**
 * An entry's host and its port, or null for every port. A canonical entry
 * writes an IPv6 host in brackets, so a colon after the host is a port's.
 */
function splitEntry(entry: string): { host: string; port: string | null } {
	const m = /^(\[[^\]]+\]|[^:[\]]+):(\d+)$/.exec(entry);
	return m ? { host: m[1], port: m[2] } : { host: entry, port: null };
}

/** Whether [entry] (canonical, from `parseAllowEntry`) allows [url]. */
export function entryAllows(entry: string, url: URL): boolean {
	const { host, port } = hostAndPort(url);
	const allow = splitEntry(entry);
	return allow.host === host && (allow.port === null || allow.port === port);
}

const allowedBy = (url: URL, allowed: readonly string[]) =>
	allowed.some((e) => entryAllows(e, url));

/** An address as a URL writes it, so `::1` and `0:0::1` compare equal. */
function canonicalIp(ip: string): string {
	const bare = ip.replace(/^\[|\]$/g, '');
	return ipVersion(bare) === 6 ? new URL(`http://[${bare}]/`).hostname : bare;
}

/**
 * Whether an answer from [ip] is allowed whatever name led there: an entry
 * that is that address (any port). That is how a proxy on the reader's own
 * network is allowed, since the browser reports the proxy's address as the
 * one connected to, and how the development build's loopback test sites are.
 */
function addressAllowed(ip: string, allowed: readonly string[]): boolean {
	const wanted = canonicalIp(ip);
	return allowed.some((entry) => splitEntry(entry).host === wanted);
}

/** Whether [url]'s host is on the reader's own side of the network, by its name or its address. */
export function isOwnNetwork(url: URL): boolean {
	const bare = url.hostname.replace(/^\[|\]$/g, '');
	return ipVersion(bare) ? !isPublicIp(bare) : isLocalName(bare);
}

/** The refusal's words, one sentence for every check, so the page reads the same whichever caught it. */
export function refusedMessage(host: string, via?: string): string {
	const where = via ? `${host} led to ${via}, which` : host;
	return `refused: ${where} is on your own network; allow it in the fetcher's options to reach it`;
}

/** Check 1: why [address] is refused before fetching, or null when it may be fetched. */
export function refusal(address: string, allowed: readonly string[]): string | null {
	const url = new URL(address);
	if (!isOwnNetwork(url) || allowedBy(url, allowed)) return null;
	return refusedMessage(url.hostname);
}

/**
 * Check 3: why the answer from [ip] for [address] is refused, or null. The
 * allow list names hosts, so a name the reader allowed may resolve to
 * whatever it does; any other name must have led to a public address, or to
 * one the reader allowed as an address.
 */
export function refusedAddress(
	address: string,
	ip: string | undefined,
	allowed: readonly string[]
): string | null {
	if (!ip) return null;
	const url = new URL(address);
	if (allowedBy(url, allowed) || isPublicIp(ip) || addressAllowed(ip, allowed)) return null;
	return refusedMessage(url.hostname, canonicalIp(ip));
}

/**
 * Check 3 before sending, where the browser can resolve a name for an
 * extension (Firefox's `dns.resolve`): why a request for [address] is
 * refused, or null. An address written as one, a local name and an allowed
 * host are the other checks' business, and need no lookup.
 */
export async function lookupRefusal(
	address: string,
	allowed: readonly string[],
	resolve: (host: string) => Promise<string[]>
): Promise<string | null> {
	const url = new URL(address);
	const bare = url.hostname.replace(/^\[|\]$/g, '');
	if (ipVersion(bare) || isLocalName(bare) || allowedBy(url, allowed)) return null;
	const addresses = await resolve(bare);
	const local = addresses.find((ip) => !isPublicIp(ip) && !addressAllowed(ip, allowed));
	return local ? refusedMessage(url.hostname, canonicalIp(local)) : null;
}

// ---- check 2: the browser's rules -----------------------------------------------------------

/**
 * The guard's rule ids, far above the per-request ones (`RuleIds` hands out
 * the smallest free id, so those stay small), so the two never meet.
 */
export const GUARD_FIRST_ID = 1_000_000;

/** The rules' priorities, kept with the per-request rule's (plan.ts). */
export const PRIORITY = RULE_PRIORITY;

/** The scheme and any userinfo before the host, as the browser writes a request's URL. */
const START = '^https?://([^/?#@]*@)?';
/** Whatever may follow the host: a port, then the path the browser always writes. */
const END = '(:[0-9]+)?/';

/** An alternation matching the decimal numbers lo..hi, as a URL writes them (no leading zeros). */
function numbers(lo: number, hi: number): string {
	if (lo === 0 && hi === 255) return '[0-9]{1,3}';
	const all: string[] = [];
	for (let n = lo; n <= hi; n++) all.push(String(n));
	return all.length === 1 ? all[0] : `(${all.join('|')})`;
}

/** A regex for the dotted quads inside [prefix]/[bits]. */
export function v4Pattern(prefix: number[], bits: number): string {
	const parts: string[] = [];
	for (let i = 0; i < 4; i++) {
		const fixed = Math.max(0, Math.min(8, bits - 8 * i));
		const mask = fixed === 0 ? 0 : (0xff << (8 - fixed)) & 0xff;
		const lo = (prefix[i] ?? 0) & mask;
		parts.push(numbers(lo, lo | (~mask & 0xff)));
	}
	return parts.join('\\.');
}

/** IPv4 space that is not on the internet: the same list as public-ip.ts, as prefixes. */
const V4_BLOCKS: [number[], number][] = [
	[[0], 8],
	[[10], 8],
	[[100, 64], 10],
	[[127], 8],
	[[169, 254], 16],
	[[172, 16], 12],
	[[192, 0, 0], 24],
	[[192, 0, 2], 24],
	[[192, 88, 99], 24],
	[[192, 168], 16],
	[[198, 18], 15],
	[[198, 51, 100], 24],
	[[203, 0, 113], 24],
	[[224], 4],
	[[240], 4]
];

/**
 * IPv6 addresses as a URL writes them (compressed, lower case), that are not
 * on the internet. Wider than public-ip.ts in two places, on purpose: every
 * IPv4-mapped address, and all of 6to4 (2002::/16) and NAT64 (64:ff9b::/96),
 * whose public uses are rare enough that blocking a redirect into them costs
 * nothing, while matching the IPv4 address inside by a regex would be easy
 * to get wrong.
 */
const V6_BLOCKS = [
	// Everything that starts with ::, mapped and loopback among it.
	'::',
	// A first group under 0x1000 is outside 2000::/3: 64:ff9b:: among them.
	'[0-9a-f]{1,3}:',
	// A four-digit first group outside 2000..3fff: unique-local, link-local, multicast.
	'[014-9a-f][0-9a-f]{3}:',
	// 2001::/23 (IETF protocol assignments): a second group 0..1ff, or none.
	'2001:(1?[0-9a-f]{1,2})?:',
	'2001:db8:',
	'2002:',
	// 3fff::/20, documentation: a second group 0..fff, or none.
	'3fff:([0-9a-f]{1,3})?:'
];

/** The regexFilters of check 2, one rule each, so each stays well under RE2's size limit. */
export function blockPatterns(): string[] {
	const names = LOCAL_SUFFIXES.map((s) => s.replace('.', '\\.')).join('|');
	return [
		...V4_BLOCKS.map(([p, n]) => `${START}${v4Pattern(p, n)}${END}`),
		...V6_BLOCKS.map((b) => `${START}\\[${b}[^\\]]*\\]${END}`),
		// The local names, a trailing dot included.
		`${START}([^/?#@:\\[]*\\.)?(${names})\\.?${END}`,
		// A name with no dot at all (`router`), and not an IPv6 address.
		`${START}[^/?#@:.\\[]+\\.?${END}`
	];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A regexFilter for the requests [entry] allows. Without a port it is every
 * port; with one, that port, written or, for the scheme's own, left out.
 */
export function allowPattern(entry: string): string {
	const { host, port } = splitEntry(entry);
	const name = escape(host);
	if (port === null) return `${START}${name}${END}`;
	if (port === '80') return `^http://([^/?#@]*@)?${name}(:80)?/`;
	if (port === '443') return `^https://([^/?#@]*@)?${name}(:443)?/`;
	return `${START}${name}:${port}/`;
}

type GuardRule = {
	id: number;
	priority: number;
	action: { type: 'block' | 'allow' };
	condition: {
		regexFilter: string;
		isUrlFilterCaseSensitive: false;
		tabIds: number[];
		resourceTypes: ('xmlhttprequest' | 'other')[];
	};
};

/**
 * Check 2's session rules: a block for each of `blockPatterns`, and an allow
 * above them for each allowed host. Only requests outside every tab, which
 * are the extension's own: the reader's own browsing of their router is not
 * the fetcher's business.
 */
export function guardRules(allowed: readonly string[]): GuardRule[] {
	const condition = (regexFilter: string) => ({
		regexFilter,
		isUrlFilterCaseSensitive: false as const,
		tabIds: [NO_TAB],
		resourceTypes: ['xmlhttprequest' as const, 'other' as const]
	});
	const blocks = blockPatterns().map((pattern) => ({
		priority: PRIORITY.block,
		action: { type: 'block' as const },
		condition: condition(pattern)
	}));
	const allows = allowed.map((entry) => ({
		priority: PRIORITY.allow,
		action: { type: 'allow' as const },
		condition: condition(allowPattern(entry))
	}));
	return [...blocks, ...allows].map((rule, i) => ({ id: GUARD_FIRST_ID + i, ...rule }));
}
