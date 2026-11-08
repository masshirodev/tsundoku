import { networkInterfaces } from 'node:os';

/**
 * The home network, for reading on a phone over Wi-Fi (doc/WIFI.md; card
 * c188): which of this computer's addresses a phone on the same Wi-Fi can
 * reach, and whether there is one. Pure where it can be: the interfaces are
 * passed in, so a spec draws any computer it likes.
 */

type Interfaces = ReturnType<typeof networkInterfaces>;

const octets = (ip: string) => {
	const p = ip.split('.').map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : -1));
	return p.length === 4 && p.every((n) => n >= 0 && n <= 255) ? p : null;
};

/** RFC 1918: 10/8, 172.16/12, 192.168/16. The only addresses Wi-Fi mode listens on. */
export function isPrivateV4(ip: string): boolean {
	const o = octets(ip);
	if (!o) return false;
	return (
		o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168)
	);
}

/** An address the internet could reach: not private, loopback, link-local, CGNAT (Tailscale) or reserved. */
export function isPublicV4(ip: string): boolean {
	const o = octets(ip);
	if (!o || isPrivateV4(ip)) return false;
	if (o[0] === 127 || o[0] === 0 || o[0] >= 224) return false;
	if (o[0] === 169 && o[1] === 254) return false;
	if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return false;
	return true;
}

/**
 * Adapters that are private but not the home network: Docker's bridges,
 * VirtualBox's and VMware's host-only networks, WSL's and Hyper-V's switch,
 * VPNs. A phone can't reach those, and a code pointing at one opens nothing.
 */
const VIRTUAL =
	/docker|^br-|^veth|virbr|vboxnet|virtualbox|vmnet|vmware|vethernet|hyper-v|wsl|tailscale|zerotier|wireguard|^wg\d|^tun|^tap|utun/i;

export type LanAddress = { address: string; name: string };

/** The home-network addresses, the likeliest first (Wi-Fi, then Ethernet, then the rest). */
export function lanAddresses(interfaces: Interfaces = networkInterfaces()): LanAddress[] {
	const found: LanAddress[] = [];
	for (const [name, addrs] of Object.entries(interfaces)) {
		if (VIRTUAL.test(name)) continue;
		for (const a of addrs ?? [])
			if (a.family === 'IPv4' && !a.internal && isPrivateV4(a.address))
				found.push({ address: a.address, name });
	}
	const rank = (n: string) =>
		/wi-?fi|wlan|wireless|^wl/i.test(n) ? 0 : /eth|^en|ethernet/i.test(n) ? 1 : 2;
	return found.sort((a, b) => rank(a.name) - rank(b.name));
}

/** Public addresses on real adapters: why Wi-Fi mode can't switch on, when it can't. */
export function publicAddresses(interfaces: Interfaces = networkInterfaces()): string[] {
	return Object.entries(interfaces)
		.filter(([name]) => !VIRTUAL.test(name))
		.flatMap(([, addrs]) => addrs ?? [])
		.filter((a) => a.family === 'IPv4' && !a.internal && isPublicV4(a.address))
		.map((a) => a.address);
}

/**
 * What Wi-Fi mode can do on this computer right now: listen at `address`
 * (and every other home-network address), or not, and why. `public` is the
 * handoff's "only a public address" (2D): the sign-in page would face the
 * internet, so ON can't be pressed.
 */
export type LanReach =
	| { kind: 'home'; address: string; all: string[] }
	| { kind: 'public'; address: string }
	| { kind: 'none' };

export function lanReach(interfaces: Interfaces = networkInterfaces()): LanReach {
	const home = lanAddresses(interfaces);
	if (home.length)
		return { kind: 'home', address: home[0].address, all: home.map((a) => a.address) };
	const pub = publicAddresses(interfaces);
	return pub.length ? { kind: 'public', address: pub[0] } : { kind: 'none' };
}

/** The address a phone opens: http, since a home address has no certificate (doc/WIFI.md). */
export const lanOrigin = (address: string, port: number) => `http://${address}:${port}`;

/** The private block an address sits in: 10/8, 172.16/12 or 192.168/16, or null for any other. */
export function privateBlock(ip: string): string | null {
	const o = octets(ip);
	if (!o || !isPrivateV4(ip)) return null;
	return o[0] === 10 ? '10.0.0.0/8' : o[0] === 172 ? '172.16.0.0/12' : '192.168.0.0/16';
}

/**
 * The network an address and its netmask make, as CIDR (`192.168.1.23` and
 * `255.255.255.0` are `192.168.1.0/24`; `10.0.5.7` and `255.255.0.0` are
 * `10.0.0.0/16`). Null for a mask that isn't one run of ones, or either part
 * not an IPv4 address.
 */
export function networkOf(ip: string, netmask: string): string | null {
	const a = octets(ip);
	const m = octets(netmask);
	if (!a || !m) return null;
	const mask = m.reduce((n, x) => n * 256 + x, 0);
	const bits = mask.toString(2).padStart(32, '0');
	if (!/^1*0*$/.test(bits)) return null;
	const prefix = bits.indexOf('0') === -1 ? 32 : bits.indexOf('0');
	return `${a.map((x, i) => x & m[i]).join('.')}/${prefix}`;
}

/**
 * The home network a phone is on, for the firewall line SETTINGS offers to
 * copy (c721; doc/WIFI.md, "A firewall on the computer"): the computer's own
 * address with its own adapter's netmask, so a /24 home network is let in as
 * that /24 and nothing wider. An address no adapter carries any more, or a
 * mask that can't be read, falls back to the private block it is in, which is
 * still only the home side of the router.
 */
export function homeSubnet(address: string, interfaces: Interfaces = networkInterfaces()): string {
	for (const addrs of Object.values(interfaces))
		for (const a of addrs ?? [])
			if (a.family === 'IPv4' && a.address === address) {
				const net = networkOf(a.address, a.netmask);
				if (net) return net;
			}
	return privateBlock(address) ?? `${address}/32`;
}
