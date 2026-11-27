/**
 * Which addresses are on the internet: one definition for everything tsundoku
 * fetches on someone else's say-so. The server's guard (net-guard.ts), the
 * novel plugin host (through net-guard.ts) and the web edition's fetcher
 * extension (src/lib/fetcher/reach.ts) all ask it, so the self-hosted server
 * and the reader's browser refuse the same addresses.
 *
 * Plain TypeScript with no imports at all: the plugin host's Node strips its
 * types and reads it under the permission model, and the fetcher bundles it
 * into an extension, where there is no `node:net`.
 */

const V4_PART = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** 4 for a dotted-quad IPv4 address, 6 for an IPv6 one, 0 for anything else, as `node:net`'s `isIP`. */
export function ipVersion(ip: string): 0 | 4 | 6 {
	const parts = ip.split('.');
	if (parts.length === 4 && parts.every((p) => V4_PART.test(p))) return 4;
	return isV6(ip) ? 6 : 0;
}

function isV6(ip: string): boolean {
	if (!ip.includes(':') || !/^[0-9a-fA-F:.]+$/.test(ip) || ip.includes(':::')) return false;
	let s = ip;
	let groupsFromV4 = 0;
	const lastColon = s.lastIndexOf(':');
	const tail = s.slice(lastColon + 1);
	if (tail.includes('.')) {
		if (ipVersion(tail) !== 4) return false;
		s = s.slice(0, lastColon + 1) + '0';
		groupsFromV4 = 1;
	}
	if (s.includes('.')) return false;
	const halves = s.split('::');
	if (halves.length > 2) return false;
	const groups = (h: string) => (h === '' ? [] : h.split(':'));
	const all = halves.flatMap(groups);
	if (!all.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
	const count = all.length + groupsFromV4;
	return halves.length === 2 ? count <= 7 : count === 8;
}

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

/** An address `ipVersion` already accepted as IPv6, as its 16 bytes. */
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
	switch (ipVersion(bare)) {
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

/**
 * The suffixes of names that only ever mean the reader's own side of the
 * network: loopback (RFC 6761), mDNS (RFC 6762), the special-use home network
 * name (RFC 8375), and the two names routers and companies hand out without
 * owning them, `.lan` and `.internal` (the latter reserved for that, 2024).
 */
const LOCAL_SUFFIXES = ['localhost', 'local', 'lan', 'internal', 'home.arpa'];

/**
 * Whether a host name (not an address) can only be on the reader's own
 * network: one of the suffixes above, or a name with no dot at all (`router`,
 * `nas`), which no public DNS answers. A trailing dot changes nothing.
 */
export function isLocalName(host: string): boolean {
	const name = host.toLowerCase().replace(/\.$/, '');
	if (!name.includes('.')) return true;
	return LOCAL_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

export { LOCAL_SUFFIXES };
