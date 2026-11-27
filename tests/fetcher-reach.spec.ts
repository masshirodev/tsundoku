import { isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
	allowPattern,
	blockPatterns,
	builtInAllowed,
	entryAllows,
	GUARD_FIRST_ID,
	guardRules,
	isOwnNetwork,
	lookupRefusal,
	parseAllowEntry,
	PRIORITY,
	refusal,
	refusedAddress,
	v4Pattern
} from '../src/lib/fetcher/reach.ts';
import { NO_TAB } from '../src/lib/fetcher/plan.ts';
import { ipVersion, isLocalName, isPublicIp } from '../src/lib/server/public-ip.ts';

const compiled = new Map<string, { priority: number; type: string; re: RegExp }[]>();

/** What the browser's rules would do to a request for [url], read as declarativeNetRequest reads them. */
function decide(url: string, allowed: string[] = []) {
	const key = allowed.join(',');
	let rules = compiled.get(key);
	if (!rules) {
		rules = guardRules(allowed).map((r) => ({
			priority: r.priority,
			type: r.action.type,
			re: new RegExp(r.condition.regexFilter, 'i')
		}));
		compiled.set(key, rules);
	}
	const href = new URL(url).href;
	const top = rules.filter((r) => r.re.test(href)).sort((a, b) => b.priority - a.priority)[0];
	return top?.type ?? 'none';
}

/** A tiny seeded generator, so a failure names an address that fails again. */
function random(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s;
	};
}

describe('ipVersion', () => {
	it('reads addresses as node:net does', () => {
		for (const ip of ['1.2.3.4', '0.0.0.0', '255.255.255.255']) expect(ipVersion(ip), ip).toBe(4);
		for (const ip of ['::', '::1', 'fe80::1', '2001:db8::', '::ffff:1.2.3.4', '1:2:3:4:5:6:7:8'])
			expect(ipVersion(ip), ip).toBe(6);
		for (const ip of [
			'1.2.3',
			'1.2.3.256',
			'01.2.3.4',
			'a.b.c.d',
			'1:2:3:4:5:6:7:8:9',
			':::1',
			'1::2::3',
			'nas.lan',
			''
		])
			expect(ipVersion(ip), ip).toBe(0);
	});

	it('agrees with node:net on a spread of near-misses', () => {
		const pieces = [
			'',
			':',
			'::',
			'1',
			'ffff',
			'12345',
			'g',
			'.',
			'1.2.3.4',
			'0',
			'00',
			'255',
			'256'
		];
		const next = random(6);
		for (let i = 0; i < 20_000; i++) {
			const n = 1 + (next() % 9);
			let s = '';
			for (let j = 0; j < n; j++) s += pieces[next() % pieces.length];
			expect(ipVersion(s), s).toBe(isIP(s));
		}
	});
});

describe('isLocalName', () => {
	it('knows the names that can only be on the reader’s own network', () => {
		for (const host of [
			'localhost',
			'a.localhost',
			'nas.local',
			'router.lan',
			'x.internal',
			'printer.home.arpa',
			'router',
			'nas.lan.'
		])
			expect(isLocalName(host), host).toBe(true);
		for (const host of ['example.com', 'lan.example.com', 'local.example.org', 'mangadex.org'])
			expect(isLocalName(host), host).toBe(false);
	});
});

describe('the block rules agree with public-ip.ts', () => {
	it('IPv4 prefixes become the dotted quads inside them', () => {
		const re = new RegExp(`^${v4Pattern([100, 64], 10)}$`);
		expect(re.test('100.64.0.0')).toBe(true);
		expect(re.test('100.127.255.255')).toBe(true);
		expect(re.test('100.63.255.255')).toBe(false);
		expect(re.test('100.128.0.0')).toBe(false);
	});

	it('block every IPv4 address that is not public, and no public one', () => {
		const next = random(1140);
		const samples: string[] = [];
		for (let i = 0; i < 20_000; i++) {
			const n = next();
			samples.push([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
		}
		// The edges of every range, where an off-by-one would hide.
		for (const edge of [
			'0.0.0.0',
			'0.255.255.255',
			'1.0.0.0',
			'9.255.255.255',
			'10.0.0.0',
			'11.0.0.0',
			'100.63.255.255',
			'100.64.0.0',
			'100.127.255.255',
			'100.128.0.0',
			'126.255.255.255',
			'127.0.0.1',
			'128.0.0.0',
			'169.253.255.255',
			'169.254.0.0',
			'169.255.0.0',
			'172.15.255.255',
			'172.16.0.0',
			'172.31.255.255',
			'172.32.0.0',
			'192.0.0.0',
			'192.0.1.0',
			'192.0.2.255',
			'192.0.3.0',
			'192.88.98.255',
			'192.88.99.0',
			'192.88.100.0',
			'192.167.255.255',
			'192.168.0.0',
			'192.169.0.0',
			'198.17.255.255',
			'198.18.0.0',
			'198.19.255.255',
			'198.20.0.0',
			'198.51.100.7',
			'203.0.113.9',
			'203.0.114.0',
			'223.255.255.255',
			'224.0.0.0',
			'239.255.255.255',
			'240.0.0.0',
			'255.255.255.255'
		])
			samples.push(edge);
		for (const ip of samples) {
			const expected = isPublicIp(ip) ? 'none' : 'block';
			expect(decide(`http://${ip}:8080/x`), ip).toBe(expected);
		}
	});

	it('block every IPv6 address that is not public; the wider places are on purpose', () => {
		const notPublic = [
			'::',
			'::1',
			'::ffff:127.0.0.1',
			'::ffff:8.8.8.8',
			'::127.0.0.1',
			'fc00::1',
			'fd12:3456::1',
			'fe80::1',
			'febf::1',
			'ff02::1',
			'64:ff9b::8.8.8.8',
			'100::1',
			'2001::1',
			'2001:1ff::1',
			'2001:db8::1',
			'2002:808:808::1',
			'3fff::1',
			'3fff:fff::1',
			'1000::1',
			'4000::1',
			'e000::1'
		];
		for (const ip of notPublic) expect(decide(`http://[${ip}]/`), ip).toBe('block');
		const pub = [
			'2001:200::1',
			'2001:4860:4860::8888',
			'2606:4700::1111',
			'2a00:1450::1',
			'3ffe::1',
			'3fff:1000::1'
		];
		for (const ip of pub) {
			expect(isPublicIp(ip), ip).toBe(true);
			expect(decide(`http://[${ip}]/`), ip).toBe('none');
		}
		// Blocked although public-ip.ts calls them public: mapped, 6to4 and
		// NAT64 forms of a public IPv4 address (reach.ts, V6_BLOCKS).
		for (const ip of ['::ffff:8.8.8.8', '2002:808:808::1', '64:ff9b::8.8.8.8']) {
			expect(isPublicIp(ip), ip).toBe(true);
			expect(decide(`http://[${ip}]/`), ip).toBe('block');
		}
	});

	it('block the local names and single-label names, and leave the internet alone', () => {
		for (const url of [
			'http://localhost:3000/',
			'http://router/',
			'http://router./',
			'https://nas.lan/x',
			'http://nas.lan.:8080/',
			'http://printer.home.arpa/',
			'http://box.local/',
			'http://x.internal/',
			'http://user@nas.lan/'
		])
			expect(decide(url), url).toBe('block');
		for (const url of [
			'https://mangadex.org/',
			'https://lan.example.com/',
			'https://example.com:8443/a',
			'https://1.1.1.1/'
		])
			expect(decide(url), url).toBe('none');
	});

	it('every block is a regex the browsers can hold', () => {
		for (const pattern of blockPatterns()) {
			expect(() => new RegExp(pattern)).not.toThrow();
			// Chromium refuses a regexFilter whose compiled form passes 2 KB;
			// the source is a fair proxy well under that.
			expect(pattern.length, pattern).toBeLessThan(700);
		}
	});
});

describe('the allow list', () => {
	it('keeps a typed entry as its host, and its port when one was typed', () => {
		expect(parseAllowEntry('NAS.lan')).toBe('nas.lan');
		expect(parseAllowEntry(' nas.lan:8080 ')).toBe('nas.lan:8080');
		expect(parseAllowEntry('nas.lan:80')).toBe('nas.lan:80');
		expect(parseAllowEntry('http://nas.lan:8080/repo/index.min.json')).toBe('nas.lan:8080');
		expect(parseAllowEntry('192.168.1.20:8080')).toBe('192.168.1.20:8080');
		expect(parseAllowEntry('[FD00::1]:8080')).toBe('[fd00::1]:8080');
		expect(parseAllowEntry('[fd00::1]')).toBe('[fd00::1]');
		for (const bad of [
			'',
			'  ',
			'two words',
			'ftp://nas.lan',
			'http://user:pw@nas.lan',
			'::1',
			'http://'
		])
			expect(parseAllowEntry(bad), bad).toBe(null);
	});

	it('an entry without a port allows every port; with one, only that port', () => {
		const at = (u: string) => new URL(u);
		expect(entryAllows('nas.lan', at('http://nas.lan:8080/'))).toBe(true);
		expect(entryAllows('nas.lan', at('https://nas.lan/'))).toBe(true);
		expect(entryAllows('nas.lan', at('http://other.lan/'))).toBe(false);
		expect(entryAllows('nas.lan:8080', at('http://nas.lan:8080/'))).toBe(true);
		expect(entryAllows('nas.lan:8080', at('http://nas.lan:8081/'))).toBe(false);
		expect(entryAllows('nas.lan:80', at('http://nas.lan/'))).toBe(true);
		expect(entryAllows('nas.lan:443', at('https://nas.lan/'))).toBe(true);
		expect(entryAllows('[fd00::1]:8080', at('http://[fd00::1]:8080/'))).toBe(true);
		expect(entryAllows('[fd00::1]', at('http://[fd00::1]:9/'))).toBe(true);
	});

	it('the allow rules open exactly what entryAllows does, above the blocks', () => {
		const allowed = ['nas.lan:8080', '192.168.1.20', '[fd00::1]:80'];
		const cases: [string, string][] = [
			['http://nas.lan:8080/repo', 'allow'],
			['http://nas.lan:8081/repo', 'block'],
			['http://nas.lan/repo', 'block'],
			['http://192.168.1.20/', 'allow'],
			['http://192.168.1.20:5000/', 'allow'],
			['http://192.168.1.21/', 'block'],
			['http://[fd00::1]/', 'allow'],
			['http://[fd00::1]:80/', 'allow'],
			['http://[fd00::1]:81/', 'block'],
			// An entry doesn't open a host that merely ends like it.
			['http://xnas.lan:8080/', 'block']
		];
		for (const [url, expected] of cases) {
			expect(decide(url, allowed), url).toBe(expected);
			expect(
				entryAllows(allowed[0], new URL(url)) ||
					entryAllows(allowed[1], new URL(url)) ||
					entryAllows(allowed[2], new URL(url)),
				url
			).toBe(expected === 'allow');
		}
		expect(allowPattern('nas.lan:443')).toBe('^https://([^/?#@]*@)?nas\\.lan(:443)?/');
	});

	it('the development build always reaches loopback, the store build nothing', () => {
		expect(builtInAllowed('store')).toEqual([]);
		const dev = builtInAllowed('development');
		for (const url of ['http://localhost:9/', 'http://127.0.0.1:9/', 'http://[::1]:9/'])
			expect(decide(url, dev), url).toBe('allow');
		expect(decide('http://127.0.0.2:9/', dev)).toBe('block');
	});
});

describe('the checks before and after fetching', () => {
	it('refuses the reader’s own network before fetching, unless allowed', () => {
		expect(refusal('http://192.168.1.1/', [])).toMatch(
			/^refused: 192\.168\.1\.1 is on your own network/
		);
		expect(refusal('http://router.lan/', [])).toMatch(/router\.lan/);
		expect(refusal('http://[::1]:9/', [])).toMatch(/\[::1\]/);
		expect(refusal('http://router.lan/', ['router.lan'])).toBe(null);
		expect(refusal('https://mangadex.org/', [])).toBe(null);
		expect(refusal('http://192.168.1.1/', [])).toBe(
			"refused: 192.168.1.1 is on your own network; allow it in the fetcher's options to reach it"
		);
		expect(isOwnNetwork(new URL('https://1.1.1.1/'))).toBe(false);
	});

	it('refuses an answer from a private address a public name led to', () => {
		expect(refusedAddress('https://evil.example/', '192.168.1.1', [])).toMatch(/evil\.example/);
		expect(refusedAddress('https://evil.example/', '::1', [])).toMatch(/evil\.example/);
		expect(refusedAddress('https://good.example/', '93.184.216.34', [])).toBe(null);
		expect(refusedAddress('https://good.example/', undefined, [])).toBe(null);
		expect(refusedAddress('https://evil.example/', '192.168.1.1', [])).toBe(
			"refused: evil.example led to 192.168.1.1, which is on your own network; allow it in the fetcher's options to reach it"
		);
		// A host the reader allowed may resolve wherever it does.
		expect(refusedAddress('http://nas.example/', '192.168.1.5', ['nas.example'])).toBe(null);
		// An allowed address covers whatever name led there: a proxy on the
		// reader's network, or the development build's loopback test sites.
		expect(refusedAddress('https://mangadex.org/', '10.0.0.3', ['10.0.0.3:3128'])).toBe(null);
		expect(
			refusedAddress('https://www.webtoons.com/', '127.0.0.1', builtInAllowed('development'))
		).toBe(null);
		expect(
			refusedAddress('https://www.webtoons.com/', '0:0::1', builtInAllowed('development'))
		).toBe(null);
		expect(
			refusedAddress('https://rebind.test/', '127.0.0.2', builtInAllowed('development'))
		).toMatch(/127\.0\.0\.2/);
	});

	it('the rules are the extension’s own requests only, ranked below the per-request header rule', () => {
		const rules = guardRules(['nas.lan']);
		expect(rules[0].id).toBe(GUARD_FIRST_ID);
		expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
		for (const r of rules) expect(r.condition.tabIds).toEqual([NO_TAB]);
		expect(PRIORITY.headers).toBeGreaterThan(PRIORITY.allow);
		expect(PRIORITY.allow).toBeGreaterThan(PRIORITY.block);
	});
});

describe('the lookup before sending', () => {
	const resolve = (answers: Record<string, string[]>) => async (host: string) =>
		answers[host] ?? [];

	it('refuses a public name that resolves to the reader’s own network, naming the address', async () => {
		const at = resolve({
			'rebind.example': ['93.184.216.34', '192.168.0.9'],
			'ok.example': ['93.184.216.34']
		});
		expect(await lookupRefusal('https://rebind.example/', [], at)).toMatch(
			/^refused: rebind\.example led to 192\.168\.0\.9/
		);
		expect(await lookupRefusal('https://ok.example/', [], at)).toBe(null);
		expect(await lookupRefusal('https://rebind.example/', ['192.168.0.9'], at)).toBe(null);
		expect(await lookupRefusal('https://rebind.example/', ['rebind.example'], at)).toBe(null);
	});

	it('asks nothing for an address, a local name or an allowed host', async () => {
		const asked: string[] = [];
		const at = async (host: string) => {
			asked.push(host);
			return ['10.0.0.1'];
		};
		for (const url of ['http://10.0.0.1/', 'http://nas.lan/', 'http://[::1]/'])
			expect(await lookupRefusal(url, [], at)).toBe(null);
		expect(await lookupRefusal('http://nas.example/', ['nas.example'], at)).toBe(null);
		expect(asked).toEqual([]);
	});
});
