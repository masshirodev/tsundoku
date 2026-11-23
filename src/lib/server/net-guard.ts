import { lookup as lookupEach, type LookupAddress, type LookupOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';

/**
 * Fetching an address someone else chose (doc/NOVELS.md): a novel's cover, a
 * chapter's pictures, a stream's segments, an extension's icon. A plugin, a
 * source or a repository index names these, so each one could aim the server
 * at the machine it runs on, or at the tailnet behind it. The rule: http(s)
 * only, every redirect hop checked, and every address a name resolves to must
 * be a global one.
 *
 * Checking the name and then letting fetch resolve it again is not enough: a
 * name can answer a public address to the check and a private one to the
 * connection (DNS rebinding). So the check runs a second time where it cannot
 * be raced, on the very addresses the socket is about to connect to
 * (`publicLookup`, given to the dispatcher every guarded fetch uses). The
 * first check stays for its clearer error and because a literal address never
 * reaches a lookup at all.
 *
 * The plugin host (novels/plugin-host.cjs) loads this same file, so there is
 * one definition of "on the internet". It must stay plain TypeScript Node can
 * strip: no enums, no parameter properties, relative imports only.
 */

// ---- which addresses are on the internet ----------------------------------------------------

/** [prefix, length] pairs of IPv4 space that is not global (IANA special-purpose registry). */
const V4_NOT_GLOBAL: [number[], number][] = [
	[[0, 0, 0, 0], 8], // "this network", 0.0.0.0 included
	[[10, 0, 0, 0], 8], // private
	[[100, 64, 0, 0], 10], // carrier-grade NAT, which is also where a tailnet lives
	[[127, 0, 0, 0], 8], // loopback
	[[169, 254, 0, 0], 16], // link-local, cloud metadata services included
	[[172, 16, 0, 0], 12], // private
	[[192, 0, 0, 0], 24], // IETF protocol assignments
	[[192, 0, 2, 0], 24], // documentation
	[[192, 88, 99, 0], 24], // the retired 6to4 relay anycast
	[[192, 168, 0, 0], 16], // private
	[[198, 18, 0, 0], 15], // benchmarking
	[[198, 51, 100, 0], 24], // documentation
	[[203, 0, 113, 0], 24], // documentation
	[[224, 0, 0, 0], 4], // multicast
	[[240, 0, 0, 0], 4] // reserved, and the broadcast address
];

function inPrefix(bytes: number[], prefix: number[], bits: number): boolean {
	for (let i = 0; i < prefix.length && bits > 0; i++, bits -= 8) {
		const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
		if ((bytes[i] & mask) !== (prefix[i] & mask)) return false;
	}
	return true;
}

const globalV4 = (b: number[]) => !V4_NOT_GLOBAL.some(([p, n]) => inPrefix(b, p, n));

/** An address `isIP` already accepted as IPv6, as its 16 bytes. */
function v6Bytes(ip: string): number[] {
	let s = ip;
	// A trailing dotted quad (`::ffff:127.0.0.1`) is the last two groups.
	const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
	if (dotted) {
		const [a, b, c, d] = dotted.slice(1).map(Number);
		s = s.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
	}
	const [head, tail] = s.split('::');
	const left = head ? head.split(':') : [];
	const right = tail ? tail.split(':') : [];
	const groups =
		tail === undefined
			? left
			: [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
	return groups.flatMap((g) => {
		const n = parseInt(g, 16);
		return [n >> 8, n & 0xff];
	});
}

/**
 * IPv6 is public only inside global unicast (2000::/3), and not in the parts
 * of it that are documentation or protocol space. The forms that carry an
 * IPv4 address inside (mapped, NAT64, 6to4) are judged by that address: the
 * connection ends up there.
 */
function globalV6(b: number[]): boolean {
	const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
	const v4 = (at: number) => globalV4(b.slice(at, at + 4));
	// ::ffff:a.b.c.d, mapped: what an IPv4 connection looks like from an IPv6 socket.
	if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return v4(12);
	// The rest of ::/96: unspecified, loopback, and the deprecated IPv4-compatible
	// form, which nothing routes. None of it is anyone's website.
	if (zeros(0, 12)) return false;
	// 64:ff9b::/96, NAT64's well-known prefix: the gateway connects to the address inside.
	if (inPrefix(b, [0, 0x64, 0xff, 0x9b], 32) && zeros(4, 12)) return v4(12);
	// 2002::/16, 6to4: the IPv4 address follows the prefix.
	if (b[0] === 0x20 && b[1] === 0x02) return v4(2);
	if ((b[0] & 0xe0) !== 0x20) return false;
	// 2001::/23, IETF protocol assignments (Teredo among them), and 2001:db8::/32
	// and 3fff::/20, documentation.
	if (inPrefix(b, [0x20, 0x01, 0x00], 23)) return false;
	if (inPrefix(b, [0x20, 0x01, 0x0d, 0xb8], 32)) return false;
	if (inPrefix(b, [0x3f, 0xff, 0x00], 20)) return false;
	return true;
}

/**
 * Whether [ip] is a global, routable address: anything else (loopback,
 * private, link-local, carrier-grade NAT, unique-local, multicast,
 * unspecified, documentation, reserved) is the workstation's own side of the
 * network. Not an address at all is not public either.
 */
export function isPublicIp(ip: string): boolean {
	const bare = ip.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
	switch (isIP(bare)) {
		case 4:
			return globalV4(bare.split('.').map(Number));
		case 6:
			return globalV6(v6Bytes(bare));
		default:
			return false;
	}
}

/** The opposite of `isPublicIp`, kept by name for the callers that ask it this way round. */
export const isPrivateIp = (ip: string): boolean => !isPublicIp(ip);

export class NotPublicError extends Error {}

// ---- checking an address --------------------------------------------------------------------

/** Throws unless [url] is http(s) and its host resolves only to public addresses. */
export async function checkPublic(url: string): Promise<URL> {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		throw new NotPublicError('not an address');
	}
	if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new NotPublicError(u.protocol);
	const host = u.hostname.replace(/^\[|\]$/g, '');
	const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
	if (addrs.length === 0 || !addrs.every(isPublicIp))
		throw new NotPublicError(`${u.hostname} is not on the internet`);
	return u;
}

type LookupCallback = (
	err: NodeJS.ErrnoException | null,
	address: string | LookupAddress[],
	family?: number
) => void;

/**
 * `dns.lookup` as a socket calls it, refusing a name that resolves to any
 * address that is not public. Given to the dispatcher below, it is the check
 * on the addresses actually connected to, so a name can't answer one thing to
 * `checkPublic` and another to the connection.
 */
export function publicLookup(
	hostname: string,
	options: LookupOptions | LookupCallback,
	callback?: LookupCallback
): void {
	const opts: LookupOptions = typeof options === 'function' ? {} : options;
	const done = (typeof options === 'function' ? options : callback) as LookupCallback;
	lookupEach(hostname, { ...opts, all: true }, (err, addresses) => {
		if (err) return done(err, []);
		const list = addresses as LookupAddress[];
		if (list.length === 0 || !list.every((a) => isPublicIp(a.address)))
			return done(new NotPublicError(`${hostname} is not on the internet`), []);
		if (opts.all) done(null, list);
		else done(null, list[0].address, list[0].family);
	});
}

let dispatcher: Agent | null = null;

/** The connection pool every guarded fetch goes through: its sockets connect only to public addresses. */
export function publicDispatcher(): Agent {
	dispatcher ??= new Agent({ connect: { lookup: publicLookup } });
	return dispatcher;
}

/** fetch's own failure, with the guard's refusal brought to the top when that is what it was. */
function refusal(e: unknown): unknown {
	const cause = (e as { cause?: unknown } | null)?.cause;
	return cause instanceof NotPublicError ? cause : e;
}

// ---- fetching ------------------------------------------------------------------------------

/** fetch, refusing local addresses on every hop. */
export async function publicFetch(url: string, init: RequestInit = {}): Promise<Response> {
	return (await publicFetchAt(url, init)).res;
}

/** publicFetch, and the address it ended at: a playlist's relative addresses resolve against it. */
export async function publicFetchAt(
	url: string,
	init: RequestInit = {}
): Promise<{ res: Response; url: string }> {
	return guardedFetchAt(url, init, null);
}

/** The origin of [address] (scheme, host and port), or null for anything that isn't one. */
export function originOf(address: string): string | null {
	try {
		const o = new URL(address).origin;
		return o === 'null' ? null : o;
	} catch {
		return null;
	}
}

/**
 * publicFetch, except that a hop on [trusted] may reach a local address. For
 * a repository the user typed in BROWSE › EXTENSIONS, which may be their own
 * server (doc/EXTENSION-ENGINE.md, "Repositories on your own network"):
 * [trusted] is that address's origin, so the index and what it serves from
 * the same host load, while an address the index names on any other host,
 * or a redirect to one, still has to be on the internet.
 */
export async function trustingFetch(
	url: string,
	trusted: string | null,
	init: RequestInit = {}
): Promise<Response> {
	return (await guardedFetchAt(url, init, trusted)).res;
}

async function guardedFetchAt(
	url: string,
	init: RequestInit,
	trusted: string | null
): Promise<{ res: Response; url: string }> {
	let at = url;
	for (let hop = 0; hop < 6; hop++) {
		const local = trusted !== null && originOf(at) === trusted;
		if (!local) await checkPublic(at);
		let res: Response;
		try {
			// The dispatcher is a Node fetch option the DOM's RequestInit doesn't name.
			res = await fetch(at, {
				...init,
				redirect: 'manual',
				...(local ? {} : { dispatcher: publicDispatcher() })
			} as RequestInit);
		} catch (e) {
			throw refusal(e);
		}
		const to = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
		if (!to) return { res, url: at };
		await res.body?.cancel().catch(() => {});
		at = new URL(to, at).href;
	}
	throw new NotPublicError('too many redirects');
}

// ---- reading a body, to a limit ------------------------------------------------------------

export class TooLargeError extends Error {}

/**
 * [res]'s body, refused past [max] bytes. A Content-Length over the limit is
 * refused before anything is read, but a body sent in chunks has none, and
 * one that lies is only caught by counting: so the count is what decides, and
 * the stream is cancelled the moment it passes the limit.
 */
export async function readCapped(res: Response, max: number): Promise<Buffer> {
	const declared = Number(res.headers.get('content-length') ?? '');
	if (Number.isFinite(declared) && declared > max) {
		await res.body?.cancel().catch(() => {});
		throw new TooLargeError(`the answer is ${declared} bytes, over the ${max} allowed`);
	}
	if (!res.body) return Buffer.alloc(0);
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > max) {
			await reader.cancel().catch(() => {});
			throw new TooLargeError(`the answer runs past the ${max} bytes allowed`);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks, total);
}

/** readCapped, as UTF-8 text: what `res.text()` gives, with the limit. */
export async function readCappedText(res: Response, max: number): Promise<string> {
	return new TextDecoder().decode(await readCapped(res, max));
}
