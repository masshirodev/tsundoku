import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// The server's fetch for addresses a plugin hands over (doc/NOVELS.md): the
// internet only, every redirect hop included. Names resolve as the stub says:
// `checkPublic` asks node:dns/promises, the connection asks node:dns, and a
// name that rebinds answers the two differently.
const ADDRESSES: Record<string, string[]> = {
	'site.example': ['93.184.215.14'],
	'inside.example': ['10.0.0.5'],
	'mixed.example': ['93.184.215.14', '127.0.0.1'],
	'v6.example': ['fd00::1'],
	'mapped.example': ['::ffff:127.0.0.1'],
	'rebind.example': ['93.184.215.14']
};
const AT_CONNECT: Record<string, string[]> = {
	...ADDRESSES,
	'rebind.example': ['127.0.0.1']
};
const answers = (table: Record<string, string[]>, host: string) =>
	(table[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
vi.mock('node:dns/promises', () => ({
	lookup: async (host: string) => answers(ADDRESSES, host)
}));
vi.mock('node:dns', () => ({
	lookup: (
		host: string,
		_opts: unknown,
		cb: (e: Error | null, a: { address: string; family: number }[]) => void
	) => {
		const found = answers(AT_CONNECT, host);
		if (found.length === 0)
			cb(Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' }), []);
		else cb(null, found);
	}
}));

const {
	checkPublic,
	isPrivateIp,
	isPublicIp,
	NotPublicError,
	publicFetch,
	publicLookup,
	readCapped,
	readCappedText,
	TooLargeError
} = await import('$lib/server/net-guard');

afterEach(() => vi.unstubAllGlobals());

describe('an address', () => {
	it('is private on the workstation’s own networks, and public elsewhere', () => {
		for (const ip of [
			'127.0.0.1',
			'10.1.2.3',
			'172.16.0.1',
			'172.31.255.255',
			'192.168.1.1',
			'169.254.169.254',
			'100.64.0.1',
			'100.101.102.103',
			'0.0.0.0',
			'224.0.0.1',
			'::1',
			'::',
			'fd7a:115c:a1e0::1',
			'fe80::1',
			'::ffff:127.0.0.1'
		])
			expect(isPrivateIp(ip), ip).toBe(true);
		for (const ip of ['93.184.215.14', '172.32.0.1', '100.128.0.1', '2606:4700::1111'])
			expect(isPrivateIp(ip), ip).toBe(false);
	});

	it('is judged by the IPv4 address inside it, however it is spelled', () => {
		// `new URL('http://[::ffff:127.0.0.1]/')` gives the hostname `[::ffff:7f00:1]`:
		// the hex spelling of the same loopback address, and the same for NAT64 and 6to4.
		for (const ip of [
			'::ffff:7f00:1',
			'[::ffff:7f00:1]',
			'::ffff:a00:5',
			'::ffff:6440:1',
			'::ffff:0:0',
			'0:0:0:0:0:ffff:7f00:1',
			'64:ff9b::7f00:1',
			'64:ff9b::127.0.0.1',
			'64:ff9b::a9fe:a9fe',
			'2002:7f00:1::',
			'2002:c0a8:101::1',
			'::127.0.0.1',
			'::7f00:1',
			'::8.8.8.8'
		])
			expect(isPublicIp(ip), ip).toBe(false);
		for (const ip of [
			'::ffff:5db8:d70e',
			'::ffff:93.184.215.14',
			'64:ff9b::808:808',
			'2002:808:808::1'
		])
			expect(isPublicIp(ip), ip).toBe(true);
	});

	it('is public only in global space: no documentation, benchmark, reserved or protocol ranges', () => {
		for (const ip of [
			'192.0.0.8',
			'192.0.2.1',
			'198.18.0.1',
			'198.19.255.255',
			'198.51.100.7',
			'203.0.113.9',
			'240.0.0.1',
			'255.255.255.255',
			'239.255.255.250',
			'2001:db8::1',
			'2001::1',
			'2001:1ff::1',
			'3fff::1',
			'ff02::1',
			'fc00::1',
			'febf::1',
			'100::1',
			'64:ff9b:1::1',
			'fe80::1%eth0',
			'not an address',
			''
		])
			expect(isPublicIp(ip), ip).toBe(false);
		for (const ip of ['1.1.1.1', '198.20.0.1', '223.255.255.255', '2001:200::1', '2a00:1450::1'])
			expect(isPublicIp(ip), ip).toBe(true);
	});

	it('is refused unless every address its name has is public, and it’s http(s)', async () => {
		await expect(checkPublic('https://site.example/a.jpg')).resolves.toBeInstanceOf(URL);
		for (const url of [
			'https://inside.example/',
			'https://mixed.example/',
			'https://v6.example/',
			'http://127.0.0.1:8080/',
			'http://[::1]/',
			'http://[::ffff:127.0.0.1]/',
			'http://[::ffff:7f00:1]/',
			'http://[64:ff9b::a9fe:a9fe]/',
			'http://100.100.100.100/',
			'https://mapped.example/',
			'https://unknown.example/',
			'file:///etc/passwd',
			'not a url'
		])
			await expect(checkPublic(url), url).rejects.toBeInstanceOf(NotPublicError);
	});
});

describe('a public fetch', () => {
	it('follows a redirect on the internet, and refuses one into the workstation', async () => {
		const fetch = vi.fn(async (url: string) =>
			url === 'https://site.example/a'
				? new Response(null, { status: 302, headers: { location: '/b' } })
				: url === 'https://site.example/b'
					? new Response(null, { status: 301, headers: { location: 'http://inside.example/c' } })
					: new Response('ok')
		);
		vi.stubGlobal('fetch', fetch);
		await expect(publicFetch('https://site.example/a')).rejects.toBeInstanceOf(NotPublicError);
		expect(fetch.mock.calls.map((c) => c[0])).toEqual([
			'https://site.example/a',
			'https://site.example/b'
		]);
		// Each hop is asked without fetch's own following, which would skip the check.
		expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual');
	});

	it('gives up on a redirect loop', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } }))
		);
		await expect(publicFetch('https://site.example/')).rejects.toThrow(/too many redirects/);
	});
});

describe('the connection itself', () => {
	it('refuses a name whose answer at connect time is not public, whatever the check was told', async () => {
		const asked: string[] = [];
		const local = createServer((req, res) => {
			asked.push(req.url ?? '');
			res.end('the workstation');
		});
		await new Promise<void>((ok) => local.listen(0, '127.0.0.1', ok));
		const { port } = local.address() as AddressInfo;
		try {
			// The check sees a public address; the socket would see loopback.
			await expect(checkPublic(`http://rebind.example:${port}/`)).resolves.toBeInstanceOf(URL);
			await expect(publicFetch(`http://rebind.example:${port}/secret`)).rejects.toBeInstanceOf(
				NotPublicError
			);
			expect(asked).toEqual([]);
		} finally {
			local.close();
		}
	});

	it('answers a socket’s lookup in both of its shapes, and refuses any private answer', async () => {
		const ask = (host: string, all: boolean) =>
			new Promise<unknown>((ok, fail) =>
				publicLookup(host, { all }, (e, address, family) => (e ? fail(e) : ok({ address, family })))
			);
		expect(await ask('site.example', false)).toEqual({ address: '93.184.215.14', family: 4 });
		expect(await ask('site.example', true)).toEqual({
			address: [{ address: '93.184.215.14', family: 4 }],
			family: undefined
		});
		for (const host of ['mixed.example', 'v6.example', 'mapped.example', 'rebind.example'])
			await expect(ask(host, true), host).rejects.toBeInstanceOf(NotPublicError);
		await expect(ask('unknown.example', false)).rejects.toThrow(/ENOTFOUND/);
	});
});

describe('a body read to a limit', () => {
	/** A body with no length, sent in [n] chunks of [size] bytes; counts how many were pulled. */
	const chunked = (n: number, size: number) => {
		let pulled = 0;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			pull(c) {
				if (pulled === n) return c.close();
				pulled++;
				c.enqueue(new Uint8Array(size).fill(97));
			},
			cancel() {
				cancelled = true;
			}
		});
		return { res: new Response(body), pulled: () => pulled, cancelled: () => cancelled };
	};

	it('gives a body within the limit whole', async () => {
		expect((await readCapped(new Response('hello'), 5)).toString()).toBe('hello');
		expect(await readCappedText(chunked(3, 4).res, 12)).toBe('a'.repeat(12));
		expect((await readCapped(new Response(null), 1)).length).toBe(0);
	});

	it('stops a chunked body the moment it passes the limit, and cancels the rest', async () => {
		const big = chunked(1000, 1024);
		await expect(readCapped(big.res, 4096)).rejects.toBeInstanceOf(TooLargeError);
		expect(big.pulled()).toBeLessThan(10);
		expect(big.cancelled()).toBe(true);
	});

	it('refuses a declared length over the limit before reading anything', async () => {
		const big = chunked(1000, 1024);
		const res = new Response(big.res.body, { headers: { 'content-length': '1024000' } });
		await expect(readCapped(res, 4096)).rejects.toBeInstanceOf(TooLargeError);
		expect(big.pulled()).toBeLessThanOrEqual(1);
	});

	it('counts a body whose declared length lies', async () => {
		const liar = chunked(10, 1024);
		const res = new Response(liar.res.body, { headers: { 'content-length': '10' } });
		await expect(readCapped(res, 4096)).rejects.toBeInstanceOf(TooLargeError);
	});
});
