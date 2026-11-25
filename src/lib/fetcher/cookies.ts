// The Cookie header the fetcher sends: the one a page of the site itself would
// send, built from the browser's own jars. A request made by an extension
// belongs to no site, so the browser leaves out the cookies a site keeps in
// its own partition (CHIPS), and Cloudflare's `cf_clearance` is one of them.
// The fetcher reads both jars and writes the header itself; nothing is copied
// between jars.

/** The fields of a `cookies.Cookie` the header needs, in either browser. */
export interface CookieLike {
	name: string;
	value: string;
	domain: string;
	path: string;
	partitionKey?: { topLevelSite?: string } | null;
}

/** The cookie Cloudflare sets once its challenge is passed. */
export const CLEARANCE_COOKIE = 'cf_clearance';

/**
 * One header from the unpartitioned cookies and those of the site's own
 * partition. A cookie both reads return (Chromium may include unpartitioned
 * cookies when asked for a partition) is sent once. Order follows RFC 6265
 * §5.4: longer paths first, otherwise as the browser listed them, which is
 * oldest first.
 */
export function cookieHeader(unpartitioned: CookieLike[], partitioned: CookieLike[]): string {
	const seen = new Set<string>();
	const cookies: CookieLike[] = [];
	for (const cookie of [...unpartitioned, ...partitioned]) {
		const key = [
			cookie.name,
			cookie.domain,
			cookie.path,
			cookie.partitionKey?.topLevelSite ?? ''
		].join('\n');
		if (seen.has(key)) continue;
		seen.add(key);
		cookies.push(cookie);
	}
	// Array.prototype.sort is stable, so equal paths keep the browser's order.
	cookies.sort((a, b) => b.path.length - a.path.length);
	return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * The URLs to ask the cookies API about for a request to `url`. Usually just
 * the URL. Over plain http to a loopback host, its https form too: browsers
 * count loopback as a secure context and send it Secure cookies (a partitioned
 * one is always Secure), but Firefox's `cookies.getAll({ url })` matches the
 * scheme strictly and leaves them out. Asking for both and sending each cookie
 * once (cookieHeader) gives what the browser itself would send there.
 */
export function cookieUrls(url: string): string[] {
	const parsed = new URL(url);
	if (parsed.protocol !== 'http:' || !isLoopback(parsed.hostname)) return [url];
	parsed.protocol = 'https:';
	return [url, parsed.href];
}

function isLoopback(host: string): boolean {
	return (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host === '[::1]' ||
		/^127\.\d+\.\d+\.\d+$/.test(host)
	);
}

/** Whether the visitor holds a Cloudflare clearance for the host. */
export function hasClearance(cookies: CookieLike[]): boolean {
	return cookies.some((c) => c.name === CLEARANCE_COOKIE);
}
