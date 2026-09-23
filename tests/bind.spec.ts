import { describe, expect, it } from 'vitest';
import {
	BindRefused,
	isTailnetAddress,
	isWildcard,
	originFor,
	httpsOrigin,
	serveState,
	tailnetName,
	resolveBindHost
} from '$lib/server/bind';

const iface = (address: string, extra: Partial<{ family: string; internal: boolean }> = {}) => ({
	address,
	netmask: '255.192.0.0',
	family: 'IPv4',
	mac: '00:00:00:00:00:00',
	internal: false,
	cidr: `${address}/10`,
	...extra
});

// What this box actually reports: loopback, the LAN, the tailnet and docker0.
const interfaces = {
	lo: [iface('127.0.0.1', { internal: true })],
	enp6s0: [iface('192.168.1.25')],
	tailscale0: [iface('100.65.33.2')],
	docker0: [iface('172.17.0.1')]
} as unknown as Parameters<typeof resolveBindHost>[0]['interfaces'];

describe('isTailnetAddress', () => {
	it('accepts the CGNAT range Tailscale allocates from', () => {
		expect(isTailnetAddress('100.65.33.2')).toBe(true);
		expect(isTailnetAddress('100.64.0.0')).toBe(true);
		expect(isTailnetAddress('100.127.255.255')).toBe(true);
	});

	// 100.0.0.0/8 is ordinary public space; only 100.64/10 is CGNAT. Matching the
	// first octet alone would claim addresses that are not on the tailnet at all.
	it('rejects addresses that merely start with 100', () => {
		expect(isTailnetAddress('100.63.0.1')).toBe(false);
		expect(isTailnetAddress('100.128.0.1')).toBe(false);
		expect(isTailnetAddress('192.168.1.25')).toBe(false);
	});

	it('rejects malformed input rather than coercing it', () => {
		expect(isTailnetAddress('100.65.33')).toBe(false);
		expect(isTailnetAddress('100.65.33.999')).toBe(false);
		expect(isTailnetAddress('100.0x41.33.2')).toBe(false);
		expect(isTailnetAddress('fd7a:115c:a1e0::b901:2195')).toBe(false);
	});
});

describe('isWildcard', () => {
	it('catches every spelling that listens on everything', () => {
		for (const host of ['0.0.0.0', '::', '[::]', '*', '', '  ']) {
			expect(isWildcard(host), host).toBe(true);
		}
	});

	it('leaves real addresses alone', () => {
		expect(isWildcard('100.65.33.2')).toBe(false);
		expect(isWildcard('127.0.0.1')).toBe(false);
	});
});

describe('resolveBindHost', () => {
	it('finds the tailnet address when HOST is unset', () => {
		expect(resolveBindHost({ interfaces })).toEqual({ host: '100.65.33.2', source: 'tailnet' });
	});

	it('honours an explicit non-wildcard host', () => {
		expect(resolveBindHost({ requested: '127.0.0.1', interfaces })).toEqual({
			host: '127.0.0.1',
			source: 'requested'
		});
	});

	// The point of the module: adapter-node defaults to 0.0.0.0, and on a box
	// with no firewall that is the whole reading library on the LAN.
	it('refuses a wildcard host', () => {
		expect(() => resolveBindHost({ requested: '0.0.0.0', interfaces })).toThrow(BindRefused);
		expect(() => resolveBindHost({ requested: '::', interfaces })).toThrow(BindRefused);
	});

	it('allows a wildcard only when it is asked for by name', () => {
		expect(resolveBindHost({ requested: '0.0.0.0', allowAny: true, interfaces })).toEqual({
			host: '0.0.0.0',
			source: 'wildcard-override'
		});
	});

	it('refuses rather than falling back when tailscaled is down', () => {
		const noTailnet = { lo: interfaces!.lo, enp6s0: interfaces!.enp6s0 };
		expect(() => resolveBindHost({ interfaces: noTailnet })).toThrow(/no tailnet address/);
	});

	it('refuses to guess between two tailnet addresses', () => {
		const two = { ...interfaces, tailscale1: [iface('100.70.0.9')] } as typeof interfaces;
		expect(() => resolveBindHost({ interfaces: two })).toThrow(/set HOST to pick one/);
	});
});

describe('originFor', () => {
	it('matches what the browser will send', () => {
		expect(originFor('100.65.33.2', 42141)).toBe('http://100.65.33.2:42141');
	});

	it('brackets an IPv6 host', () => {
		expect(originFor('fd7a:115c:a1e0::b901:2195', 42141)).toBe(
			'http://[fd7a:115c:a1e0::b901:2195]:42141'
		);
	});
});

describe('https through tailscale serve', () => {
	const name = 'workstation.example.ts.net';

	it('reads the tailnet name only when it has a certificate', () => {
		expect(tailnetName({ Self: { DNSName: `${name}.` }, CertDomains: [name] })).toBe(name);
		expect(tailnetName({ Self: { DNSName: `${name}.` }, CertDomains: null })).toBeNull();
		expect(tailnetName(null)).toBeNull();
	});

	it('writes the origin, without :443', () => {
		expect(httpsOrigin(name, 8443)).toBe(`https://${name}:8443`);
		expect(httpsOrigin(name, 443)).toBe(`https://${name}`);
	});

	it('never takes over a port something else serves', () => {
		const status = {
			TCP: { '443': { HTTPS: true }, '8443': { HTTPS: true } },
			Web: {
				[`${name}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:42138' } } },
				[`${name}:8443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:42143' } } }
			}
		};
		expect(serveState(status, name, 443, 'http://127.0.0.1:42143')).toBe('taken');
		expect(serveState(status, name, 8443, 'http://127.0.0.1:42143')).toBe('ours');
		expect(serveState(status, name, 10000, 'http://127.0.0.1:42143')).toBe('free');
		expect(serveState({}, name, 8443, 'http://127.0.0.1:42143')).toBe('free');
	});
});
