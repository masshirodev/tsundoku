// How one request from the page becomes one request on the network: which
// headers fetch() sends, which a declarativeNetRequest session rule applies
// because fetch() may not, and which are never sent. Pure, so every rule here
// is tested without a browser (tests/fetcher-plan.spec.ts).

import type { FetcherRequest, HeaderList } from './protocol.ts';

/** A failure the page is told about in words, never a crash of the extension. */
export class FetcherError extends Error {}

/** The methods a session rule can be scoped to in both browsers. */
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/**
 * Never sent. `Accept-Encoding` because the browser decodes the body itself
 * and sends its own; the connection's framing headers because the browser
 * writes them; `Sec-*` because they are the browser's account of the request.
 * The page's `Cookie` is not here: it is replaced, below.
 */
const DROPPED = new Set([
	'accept-encoding',
	'access-control-request-headers',
	'access-control-request-method',
	'connection',
	'content-length',
	'cookie2',
	'expect',
	'host',
	'keep-alive',
	'set-cookie',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade'
]);
const DROPPED_PREFIXES = ['proxy-', 'sec-'];

/**
 * Forbidden to fetch(), which drops them without a word, so the rule sets
 * them. `Cookie` is the rule's too, but built from the browser's jars, and
 * `User-Agent` is decided by chooseUserAgent().
 */
const VIA_RULE = new Set(['accept-charset', 'date', 'dnt', 'origin', 'referer', 'via']);

export interface RuleHeader {
	header: string;
	operation: 'set' | 'remove';
	value?: string;
}

export interface RequestPlan {
	/** Without its fragment, which never reaches the network. */
	url: string;
	method: string;
	/** Sent by fetch() itself. */
	headers: HeaderList;
	/** Applied by the request's session rule. */
	ruleHeaders: RuleHeader[];
	/** Whose User-Agent goes out: the browser's, or the one the page asked for. */
	userAgent: 'browser' | 'requested';
}

/** What the browser's jars say about the request's host (cookies.ts). */
export interface CookieFacts {
	header: string;
	clearance: boolean;
}

/** Checks a request's URL and method; the cookies are read for the URL this returns. */
export function normaliseTarget(request: FetcherRequest): { url: string; method: string } {
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		throw new FetcherError(`not a URL: ${request.url}`);
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new FetcherError(`only http and https are fetched, not ${url.protocol}`);
	}
	url.hash = '';
	const method = (request.method ?? 'GET').toUpperCase();
	if (!METHODS.has(method)) throw new FetcherError(`method ${method} is not fetched`);
	if ((method === 'GET' || method === 'HEAD') && request.body?.length) {
		throw new FetcherError(`a ${method} request has no body`);
	}
	return { url: url.href, method };
}

/**
 * The User-Agent to send. A Cloudflare clearance is valid only with the
 * User-Agent that earned it, which is the browser's, so a host holding one
 * gets the browser's whatever the page asked. Elsewhere the page's (the
 * engine's) is sent, and the browser's when it asked for none.
 */
export function chooseUserAgent(
	requested: string | undefined,
	clearance: boolean
): RequestPlan['userAgent'] {
	return requested && !clearance ? 'requested' : 'browser';
}

export function planRequest(request: FetcherRequest, cookies: CookieFacts): RequestPlan {
	const { url, method } = normaliseTarget(request);
	const headers: HeaderList = [];
	const viaRule = new Map<string, string[]>();
	let requestedAgent: string | undefined;
	let origin: string | undefined;
	for (const [rawName, value] of request.headers ?? []) {
		const name = rawName.trim().toLowerCase();
		if (!name || name === 'cookie') continue;
		if (DROPPED.has(name) || DROPPED_PREFIXES.some((p) => name.startsWith(p))) continue;
		if (name === 'user-agent') requestedAgent = value;
		else if (name === 'origin') origin = value;
		else if (VIA_RULE.has(name)) viaRule.set(name, [...(viaRule.get(name) ?? []), value]);
		else headers.push([rawName.trim(), value]);
	}

	const userAgent = chooseUserAgent(requestedAgent, cookies.clearance);
	const ruleHeaders: RuleHeader[] = [];
	if (userAgent === 'requested') {
		ruleHeaders.push({ header: 'user-agent', operation: 'set', value: requestedAgent });
	}
	for (const [name, values] of viaRule) {
		ruleHeaders.push({ header: name, operation: 'set', value: values.join(', ') });
	}
	// An extension's own Origin (chrome-extension://, moz-extension://) is
	// not the page's to send: absent a request for one, none goes out.
	ruleHeaders.push(
		origin === undefined
			? { header: 'origin', operation: 'remove' }
			: { header: 'origin', operation: 'set', value: origin }
	);
	// The browser's cookies are the only cookies.
	ruleHeaders.push(
		cookies.header
			? { header: 'cookie', operation: 'set', value: cookies.header }
			: { header: 'cookie', operation: 'remove' }
	);
	return { url, method, headers, ruleHeaders, userAgent };
}

/** `chrome.tabs.TAB_ID_NONE`: requests an extension makes itself belong to no tab. */
export const NO_TAB = -1;

/**
 * The session rule for one planned request: this URL, this method, and only
 * requests outside every tab, so nothing a tab loads is ever touched. A URL
 * with `*` or `^` in it is matched by a regular expression instead, because a
 * urlFilter reads those as wildcards and would match other URLs too.
 */
export function buildRule(id: number, plan: RequestPlan) {
	const exact = /[*^]/.test(plan.url)
		? { regexFilter: `^${plan.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` }
		: { urlFilter: `|${plan.url}|` };
	return {
		id,
		priority: 1,
		action: { type: 'modifyHeaders' as const, requestHeaders: plan.ruleHeaders },
		condition: {
			...exact,
			isUrlFilterCaseSensitive: true,
			tabIds: [NO_TAB],
			requestMethods: [plan.method.toLowerCase()],
			resourceTypes: ['xmlhttprequest', 'other']
		}
	};
}

/**
 * The response's headers as the page should read them. The browser has
 * already decoded the body, so a `Content-Encoding` and the `Content-Length`
 * of the encoded body would both describe bytes the page never gets.
 */
export function responseHeaders(headers: HeaderList): HeaderList {
	const decoded = headers.some(([name]) => name.toLowerCase() === 'content-encoding');
	if (!decoded) return headers;
	return headers.filter(([name]) => {
		const lower = name.toLowerCase();
		return lower !== 'content-encoding' && lower !== 'content-length';
	});
}
