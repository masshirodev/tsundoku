import { afterEach, describe, expect, it, vi } from 'vitest';

// The server's fetch for addresses a plugin hands over (doc/NOVELS.md): the
// internet only, every redirect hop included. Names resolve as the stub says.
const ADDRESSES: Record<string, string[]> = {
	'site.example': ['93.184.215.14'],
	'inside.example': ['10.0.0.5'],
	'mixed.example': ['93.184.215.14', '127.0.0.1'],
	'v6.example': ['fd00::1']
};
vi.mock('node:dns/promises', () => ({
	lookup: async (host: string) =>
		(ADDRESSES[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
}));

const { checkPublic, isPrivateIp, NotPublicError, publicFetch } =
	await import('$lib/server/net-guard');

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

	it('is refused unless every address its name has is public, and it’s http(s)', async () => {
		await expect(checkPublic('https://site.example/a.jpg')).resolves.toBeInstanceOf(URL);
		for (const url of [
			'https://inside.example/',
			'https://mixed.example/',
			'https://v6.example/',
			'http://127.0.0.1:8080/',
			'http://[::1]/',
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
