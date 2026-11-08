import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import {
	PROBE_KEEP_MS,
	QUIET_MS,
	firewallCommands,
	firewallFound,
	forgetProbe,
	noPhoneYet,
	platformOf,
	probeFirewall,
	quietMs,
	readFirewalld,
	readUfw,
	runCommand,
	serverPlatform,
	type Ran
} from '../src/lib/server/firewall';
import { homeSubnet, networkOf, privateBlock } from '../src/lib/server/lan';

/**
 * A firewall on the computer (c721; doc/WIFI.md, "A firewall on the
 * computer"): what the unprivileged probe reads from each answer, that a
 * missing command, a refusal and a timeout are all "unknown", the lines to
 * copy with the port and the computer's own network, and when the panel
 * asks whether a firewall is in the way.
 */

const ran = (out: string, code = 0): Ran => ({ code, out });

describe('the platform is the server’s', () => {
	it('maps every platform Node names', () => {
		expect(platformOf('linux')).toBe('linux');
		expect(platformOf('win32')).toBe('windows');
		for (const p of ['darwin', 'freebsd', 'openbsd', 'sunos', 'aix', 'android', ''])
			expect(platformOf(p)).toBe('other');
	});
	it('is process.platform unless the e2e names one', () => {
		expect(serverPlatform({})).toBe(platformOf(process.platform));
		expect(serverPlatform({ TSUNDOKU_FIREWALL_PLATFORM: 'win32' })).toBe('windows');
		expect(serverPlatform({ TSUNDOKU_FIREWALL_PLATFORM: '' })).toBe(platformOf(process.platform));
	});
});

describe('ufw, read without root', () => {
	const on = 'ENABLED=yes\nLOGLEVEL=low\n';
	it('is on only with its unit active and ENABLED=yes', () => {
		expect(readUfw(ran('active\n'), on)).toBe('on');
		expect(readUfw(ran('active\n'), '# comment\n  ENABLED = YES \n')).toBe('on');
	});
	it('is off when either says so (Arch ships ENABLED=yes with the unit not enabled)', () => {
		// This box, 2026-11-07: ENABLED=yes in /etc/ufw/ufw.conf, `systemctl is-active ufw` inactive (exit 3).
		expect(readUfw(ran('inactive\n', 3), on)).toBe('off');
		expect(readUfw(ran('failed\n', 3), on)).toBe('off');
		// Ubuntu after `ufw disable`: the unit stays active.
		expect(readUfw(ran('active\n'), 'ENABLED=no\n')).toBe('off');
	});
	it('is unknown when nothing can be read', () => {
		expect(readUfw(null, on)).toBe('unknown');
		expect(readUfw(ran('active\n'), null)).toBe('unknown');
		expect(readUfw(ran('active\n'), 'LOGLEVEL=low\n')).toBe('unknown');
		expect(readUfw(ran('activating\n', 3), on)).toBe('unknown');
		expect(readUfw(ran(''), on)).toBe('unknown');
	});
});

describe('firewalld, read without root', () => {
	it('reads firewall-cmd --state', () => {
		expect(readFirewalld(ran('running\n'))).toBe('on');
		expect(readFirewalld(ran('not running\n', 252))).toBe('off');
		expect(readFirewalld(null)).toBe('unknown');
		expect(readFirewalld(ran('Authorization failed.\n', 1))).toBe('unknown');
	});
});

describe('running a probe command', () => {
	it('gives the exit code and output of a command that ran', async () => {
		expect(await runCommand(process.execPath, ['-e', 'process.stdout.write("running")'])).toEqual({
			code: 0,
			out: 'running'
		});
		expect(
			await runCommand(process.execPath, [
				'-e',
				'process.stdout.write("inactive"); process.exit(3)'
			])
		).toEqual({ code: 3, out: 'inactive' });
	});
	it('is null for a missing binary', async () => {
		expect(await runCommand('tsundoku-no-such-firewall-cmd', ['--state'])).toBeNull();
	});
	it('is null for one that runs past its time, and returns within it', async () => {
		const t = Date.now();
		expect(
			await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 300)
		).toBeNull();
		expect(Date.now() - t).toBeLessThan(5000);
	});
});

describe('the probe', () => {
	type Answers = Record<string, Ran>;
	const runner = (a: Answers) => async (cmd: string, args: string[]) =>
		a[`${cmd} ${args.join(' ')}`] ?? null;
	const conf = (text: string | null) => async () => text;

	it('names ufw, then firewalld, and neither when both are off or unknown', async () => {
		const ufwOn = { 'systemctl is-active ufw': ran('active\n') };
		const fwdOn = { 'firewall-cmd --state': ran('running\n') };
		expect(await probeFirewall({ run: runner(ufwOn), read: conf('ENABLED=yes') })).toBe('ufw');
		expect(
			await probeFirewall({ run: runner({ ...ufwOn, ...fwdOn }), read: conf('ENABLED=yes') })
		).toBe('ufw');
		expect(await probeFirewall({ run: runner(fwdOn), read: conf(null) })).toBe('firewalld');
		expect(await probeFirewall({ run: runner({}), read: conf(null) })).toBeNull();
		expect(
			await probeFirewall({
				run: runner({
					'systemctl is-active ufw': ran('inactive\n', 3),
					'firewall-cmd --state': ran('not running\n', 252)
				}),
				read: conf('ENABLED=yes')
			})
		).toBeNull();
	});
	it('asks only these commands, never sudo, ufw status or nft', async () => {
		const asked: string[] = [];
		await probeFirewall({
			run: async (cmd, args) => (asked.push([cmd, ...args].join(' ')), null),
			read: conf(null)
		});
		expect(asked.sort()).toEqual(['firewall-cmd --state', 'systemctl is-active ufw']);
	});
});

describe('the probe the panel reads', () => {
	beforeEach(() => {
		forgetProbe();
		delete process.env.TSUNDOKU_FIREWALL_PROBE;
	});
	it('takes the e2e’s stand-in whatever the platform', async () => {
		expect(await firewallFound('linux', 0, { TSUNDOKU_FIREWALL_PROBE: 'ufw' })).toBe('ufw');
		expect(await firewallFound('windows', 0, { TSUNDOKU_FIREWALL_PROBE: 'firewalld' })).toBe(
			'firewalld'
		);
		expect(await firewallFound('linux', 0, { TSUNDOKU_FIREWALL_PROBE: 'none' })).toBeNull();
		expect(await firewallFound('linux', 0, { TSUNDOKU_FIREWALL_PROBE: 'nftables' })).toBeNull();
	});
	it('probes nothing off Linux', async () => {
		expect(await firewallFound('windows', 0, {})).toBeNull();
		expect(await firewallFound('other', 0, {})).toBeNull();
	});
	it('keeps one answer for 30 s, shared by every ask in that time', async () => {
		const a = firewallFound('linux', 1000, {});
		expect(firewallFound('linux', 1000 + PROBE_KEEP_MS - 1, {})).toBe(a);
		expect(firewallFound('linux', 1000 + PROBE_KEEP_MS, {})).not.toBe(a);
		// Whatever this box answers, it is a name or null, never a throw.
		expect([null, 'ufw', 'firewalld']).toContain(await a);
	});
});

describe('the lines to copy', () => {
	it('carry the port and the home network, and nothing wider', () => {
		expect(firewallCommands(42143, '192.168.1.0/24')).toEqual({
			ufw: 'sudo ufw allow from 192.168.1.0/24 to any port 42143 proto tcp',
			firewalld:
				`sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" ` +
				`port port="42143" protocol="tcp" accept' && sudo firewall-cmd --reload`
		});
		expect(firewallCommands(4397, '10.0.0.0/16').ufw).toBe(
			'sudo ufw allow from 10.0.0.0/16 to any port 4397 proto tcp'
		);
	});
});

describe('the home network', () => {
	it('is the address and its netmask, as CIDR', () => {
		expect(networkOf('192.168.1.23', '255.255.255.0')).toBe('192.168.1.0/24');
		expect(networkOf('10.0.5.7', '255.255.0.0')).toBe('10.0.0.0/16');
		expect(networkOf('172.20.13.9', '255.255.240.0')).toBe('172.20.0.0/20');
		expect(networkOf('192.168.1.23', '255.255.255.255')).toBe('192.168.1.23/32');
		expect(networkOf('10.1.2.3', '0.0.0.0')).toBe('0.0.0.0/0');
	});
	it('is null for a mask that isn’t one run of ones, or no address', () => {
		expect(networkOf('192.168.1.23', '255.0.255.0')).toBeNull();
		expect(networkOf('192.168.1.23', 'ffff:ffff::')).toBeNull();
		expect(networkOf('nope', '255.255.255.0')).toBeNull();
	});

	const iface = (address: string, netmask: string): NetworkInterfaceInfo => ({
		address,
		netmask,
		family: 'IPv4',
		mac: '00:00:00:00:00:00',
		internal: false,
		cidr: null
	});
	it('reads the adapter that carries the address: a /24 and a /16', () => {
		const two = {
			wlan0: [iface('192.168.1.23', '255.255.255.0')],
			eth0: [iface('10.0.5.7', '255.255.0.0')]
		};
		expect(homeSubnet('192.168.1.23', two)).toBe('192.168.1.0/24');
		expect(homeSubnet('10.0.5.7', two)).toBe('10.0.0.0/16');
	});
	it('falls back to the private block when no adapter carries it or its mask can’t be read', () => {
		expect(homeSubnet('192.168.1.23', {})).toBe('192.168.0.0/16');
		expect(homeSubnet('172.20.1.2', { e: [iface('172.20.1.2', '255.0.255.0')] })).toBe(
			'172.16.0.0/12'
		);
		expect(homeSubnet('10.9.8.7', {})).toBe('10.0.0.0/8');
		expect(privateBlock('8.8.8.8')).toBeNull();
		expect(homeSubnet('8.8.8.8', {})).toBe('8.8.8.8/32');
	});
});

describe('whether a firewall may be in the way', () => {
	const at = { live: true, madeAt: 1000, reachedAt: null, now: 1000 + QUIET_MS, quiet: QUIET_MS };
	it('asks once a live code has waited its 30 s with no phone since it was made', () => {
		expect(noPhoneYet(at)).toBe(true);
		expect(noPhoneYet({ ...at, now: 1000 + QUIET_MS - 1 })).toBe(false);
		// A phone that reached an earlier code says nothing about this one.
		expect(noPhoneYet({ ...at, reachedAt: 999 })).toBe(true);
	});
	it('says nothing once anything reached it, or no code waits', () => {
		expect(noPhoneYet({ ...at, reachedAt: 1000 })).toBe(false);
		expect(noPhoneYet({ ...at, reachedAt: 5000 })).toBe(false);
		expect(noPhoneYet({ ...at, live: false })).toBe(false);
		expect(noPhoneYet({ ...at, madeAt: null })).toBe(false);
	});
	it('waits 30 s unless the e2e shortens it', () => {
		expect(quietMs({})).toBe(30_000);
		expect(quietMs({ TSUNDOKU_FIREWALL_QUIET_MS: '4000' })).toBe(4000);
		for (const v of ['', '0', '-5', 'soon'])
			expect(quietMs({ TSUNDOKU_FIREWALL_QUIET_MS: v })).toBe(30_000);
	});
});

// A friend's local install, as wifi-db.spec.ts stands one up, for the panel's answer.
process.env.DATABASE_PATH = ':memory:';
process.env.TSUNDOKU_LOGIN = 'password';
process.env.TSUNDOKU_SERVE = 'local';
vi.mock('$env/dynamic/private', () => ({ env: process.env }));
const { pairing } = await import('$lib/server/pairing');
const { wifiAnswer } = await import('$lib/server/wifi');
const api = await import('../src/routes/api/wifi/+server');
type LanStatus = import('$lib/server/lan-listen').LanStatus;

describe('the panel’s answer (wifiAnswer)', () => {
	let status: LanStatus;
	(globalThis as { __tsundokuLan?: unknown }).__tsundokuLan = {
		status: () => status,
		setOn: async () => status,
		close: async () => {},
		port: 42143
	};
	const T0 = Date.now();
	beforeEach(() => {
		process.env.TSUNDOKU_FIREWALL_PROBE = 'ufw';
		status = {
			on: true,
			// An address no adapter of this machine carries: the block it is in.
			reach: { kind: 'home', address: '192.168.77.23', all: ['192.168.77.23'] },
			listening: ['192.168.77.23:42143'],
			changed: null,
			error: null,
			firstTime: false,
			reachedAt: null
		};
		pairing.fresh(T0);
	});

	it('names the firewall with the port and the home network', async () => {
		const w = (await wifiAnswer({ now: T0 }))!;
		expect(w.firewall).toMatchObject({ found: 'ufw', port: 42143, subnet: '192.168.0.0/16' });
		expect(w.firewall!.commands.ufw).toBe(
			'sudo ufw allow from 192.168.0.0/16 to any port 42143 proto tcp'
		);
	});
	it('asks about a firewall 30 s after the code, until a request comes in by Wi-Fi', async () => {
		expect((await wifiAnswer({ now: T0 + QUIET_MS - 1 }))!.noPhoneYet).toBe(false);
		expect((await wifiAnswer({ now: T0 + QUIET_MS }))!.noPhoneYet).toBe(true);
		status = { ...status, reachedAt: T0 + 5 };
		expect((await wifiAnswer({ now: T0 + QUIET_MS }))!.noPhoneYet).toBe(false);
		// A used code waits for no one.
		status = { ...status, reachedAt: null };
		pairing.redeem(pairing.current()!.code, T0 + 10, 'Phone');
		expect((await wifiAnswer({ now: T0 + QUIET_MS }))!.noPhoneYet).toBe(false);
	});
	it('names nothing with no home address', async () => {
		status = { ...status, reach: { kind: 'none' }, listening: [] };
		const w = (await wifiAnswer({ now: T0 }))!;
		expect(w.firewall).toBeNull();
		expect(w.noPhoneYet).toBe(false);
	});
	it('gives a phone over Wi-Fi none of it', async () => {
		const res = await api.GET({ locals: { via: 'lan' } } as never);
		const body = await res.json();
		expect(body.firewall).toBeNull();
		expect(body.noPhoneYet).toBe(false);
		const local = await (await api.GET({ locals: { via: 'local' } } as never)).json();
		expect(local.firewall.found).toBe('ufw');
	});
});
