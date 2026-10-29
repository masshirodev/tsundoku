import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Fetching an address a plugin handed over (doc/NOVELS.md): a novel's cover,
 * later a chapter's images. The plugin host refuses local addresses for the
 * plugins' own requests (plugin-host.cjs); the app has to do the same for
 * the URLs plugins give it, or a plugin could aim the server at the
 * workstation's own services. Same rule, every redirect hop checked.
 */

/** Loopback, private, link-local, carrier-grade, unique-local, multicast and unspecified. */
export function isPrivateIp(ip: string): boolean {
	if (isIP(ip) === 4) {
		const [a, b] = ip.split('.').map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a >= 224
		);
	}
	const v = ip.toLowerCase();
	if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
	return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

export class NotPublicError extends Error {}

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
	if (addrs.length === 0 || addrs.some(isPrivateIp))
		throw new NotPublicError(`${u.hostname} is not on the internet`);
	return u;
}

/** fetch, refusing local addresses on every hop. */
export async function publicFetch(url: string, init: RequestInit = {}): Promise<Response> {
	let at = url;
	for (let hop = 0; hop < 6; hop++) {
		await checkPublic(at);
		const res = await fetch(at, { ...init, redirect: 'manual' });
		const to = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
		if (!to) return res;
		at = new URL(to, at).href;
	}
	throw new NotPublicError('too many redirects');
}
