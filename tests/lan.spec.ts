import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
	isPrivateV4,
	isPublicV4,
	lanAddresses,
	lanOrigin,
	lanReach,
	publicAddresses
} from '../src/lib/server/lan.ts';
import { CODE_MS, Pairing, minutesLeft, pairedLabel } from '../src/lib/server/pairing.ts';

const v4 = (address: string, internal = false) =>
	({ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null }) as NetworkInterfaceInfo;

describe('the home network (doc/WIFI.md)', () => {
	it('knows a private address from a public one', () => {
		for (const ip of ['10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.23'])
			expect(isPrivateV4(ip)).toBe(true);
		for (const ip of ['172.15.0.1', '172.32.0.1', '8.8.8.8', '100.101.102.103', 'nope'])
			expect(isPrivateV4(ip)).toBe(false);
		expect(isPublicV4('203.0.113.17')).toBe(true);
		// Tailscale's CGNAT range, link-local and loopback face nobody.
		for (const ip of ['100.64.1.1', '169.254.3.4', '127.0.0.1', '192.168.1.2'])
			expect(isPublicV4(ip)).toBe(false);
	});

	it('takes the Wi-Fi first, and never a virtual adapter’s address', () => {
		const found = lanAddresses({
			lo: [v4('127.0.0.1', true)],
			docker0: [v4('172.17.0.1')],
			'VirtualBox Host-Only Network': [v4('192.168.56.1')],
			'vEthernet (WSL)': [v4('172.29.0.1')],
			tailscale0: [v4('100.101.1.2')],
			Ethernet: [v4('10.0.0.7')],
			'Wi-Fi': [v4('192.168.1.23')]
		});
		expect(found).toEqual([
			{ address: '192.168.1.23', name: 'Wi-Fi' },
			{ address: '10.0.0.7', name: 'Ethernet' }
		]);
	});

	it('says what Wi-Fi mode can do: listen, only a public address, or nothing yet', () => {
		expect(lanReach({ wlan0: [v4('192.168.1.23')], eth0: [v4('203.0.113.17')] })).toEqual({
			kind: 'home',
			address: '192.168.1.23',
			all: ['192.168.1.23']
		});
		expect(lanReach({ Ethernet: [v4('203.0.113.17')] })).toEqual({
			kind: 'public',
			address: '203.0.113.17'
		});
		expect(lanReach({ lo: [v4('127.0.0.1', true)], docker0: [v4('172.17.0.1')] })).toEqual({
			kind: 'none'
		});
		expect(publicAddresses({ docker0: [v4('203.0.113.9')] })).toEqual([]);
		expect(lanOrigin('192.168.1.23', 42143)).toBe('http://192.168.1.23:42143');
	});
});

describe('a pairing code (doc/WIFI.md)', () => {
	let n = 0;
	const make = () => new Pairing(() => `code-${++n}`);

	it('signs in one phone, once, within 10 minutes', () => {
		const p = make();
		expect(p.state(0)).toBe('none');
		const c = p.fresh(1000);
		expect(p.state(1000)).toBe('live');
		expect(p.redeem('not-it', 2000, 'x')).toBe('unknown');
		expect(p.redeem(c.code, 2000, 'Android phone · Chrome')).toBe('ok');
		expect(p.state(2000)).toBe('used');
		expect(p.current()?.used).toEqual({ at: 2000, who: 'Android phone · Chrome' });
		// The same code again, from the same phone or another.
		expect(p.redeem(c.code, 3000, 'iPad')).toBe('used');
	});

	it('expires unscanned, and a new code replaces the old', () => {
		const p = make();
		const old = p.fresh(0);
		expect(p.redeem(old.code, CODE_MS, 'x')).toBe('expired');
		expect(p.state(CODE_MS)).toBe('expired');
		const next = p.fresh(CODE_MS + 1);
		expect(p.redeem(old.code, CODE_MS + 2, 'x')).toBe('unknown');
		expect(p.redeem(next.code, CODE_MS + 2, 'x')).toBe('ok');
	});

	it('counts down in whole minutes: GOOD FOR 9 MIN, then under a minute', () => {
		const c = make().fresh(0);
		expect(minutesLeft(c, 0)).toBe(9);
		expect(minutesLeft(c, 30_000)).toBe(9);
		expect(minutesLeft(c, 61_000)).toBe(8);
		expect(minutesLeft(c, CODE_MS - 30_000)).toBe(0);
		expect(minutesLeft(c, CODE_MS + 5)).toBe(0);
	});

	it('names a phone from its user agent alone', () => {
		expect(
			pairedLabel('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit Chrome/131 Mobile Safari')
		).toBe('Android phone · Chrome');
		expect(
			pairedLabel('Mozilla/5.0 (Linux; Android 13; SM-X205) AppleWebKit Chrome/131 Safari')
		).toBe('Android tablet · Chrome');
		expect(pairedLabel('Mozilla/5.0 (iPad; CPU OS 17_0) AppleWebKit Version/17 Safari/605')).toBe(
			'iOS tablet · Safari'
		);
	});
});
