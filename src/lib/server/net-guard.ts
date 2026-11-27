import { lookup as lookupEach, type LookupAddress, type LookupOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import { isLocalName, isPublicIp } from './public-ip.ts';

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

// Which addresses are on the internet lives in public-ip.ts, shared with the
// web edition's fetcher; it is re-exported here for the server's callers.
export { isPrivateIp, isPublicIp } from './public-ip.ts';

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
	// The web edition has no DNS: the tab cannot resolve a name, and its fetch
	// goes through the reader's own browser, not a server's network. An address
	// written as one is still checked, and so is a name that can only be on the
	// reader's own network (`isLocalName`); any other name is the browser's to
	// resolve, and the fetcher checks what it resolved to (doc/WEB-EDITION.md,
	// "The reader's own network").
	if (__WEB_EDITION__ && !isIP(host)) {
		if (isLocalName(host)) throw new NotPublicError(`${u.hostname} is not on the internet`);
		return u;
	}
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
