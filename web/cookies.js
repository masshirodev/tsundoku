// Cookies in the web edition (doc/WEB-EDITION.md, "Cookies"). The server code
// keeps a few things in cookies (the theme, reveal, incognito, the sign-in
// ceremony, a TV's pairing) and reads them from the request's `Cookie`
// header. A browser forbids script both ways: a `Request` made in script
// drops a `Cookie` header, and a `Response` made in script drops `Set-Cookie`,
// silently. In the in-tab server every request and response is made in
// script, so without this the server never saw a cookie and none it set was
// ever kept: the theme could not be switched.
//
// The browser's own cookie jar stays the jar: the leading tab, which can read
// and write it (`document.cookie`), sends its cookies along with each request
// and writes back what the server set. In the server worker, this:
//
// - gives SvelteKit a request whose headers carry that `Cookie` (a standalone
//   `Headers` has no such guard), and
// - records every `Set-Cookie` written to a `Headers`, the browser keeping it
//   or not, so the worker can hand them to the tab (`setCookiesOf`).

/** @type {WeakMap<Headers, string[]>} */
const recorded = new WeakMap();

/** @param {Headers} h */
const list = (h) => {
	let l = recorded.get(h);
	if (!l) recorded.set(h, (l = []));
	return l;
};

const isSetCookie = (/** @type {unknown} */ name) => String(name).toLowerCase() === 'set-cookie';

/**
 * Every `Set-Cookie` of a header list in any of its shapes: what the browser
 * kept, and what it dropped but was recorded here.
 * @param {HeadersInit | undefined} init
 * @returns {string[]}
 */
export function setCookiesOf(init) {
	if (!init) return [];
	if (init instanceof Headers) {
		const own = init.getSetCookie?.() ?? [];
		const kept = recorded.get(init) ?? [];
		return [...own, ...kept.filter((c) => !own.includes(c))];
	}
	const entries = Array.isArray(init) ? init : Object.entries(init);
	return entries
		.filter(([k]) => isSetCookie(k))
		.flatMap(([, v]) => (Array.isArray(v) ? v : [String(v)]));
}

/**
 * Teaches this global scope's `Headers` and `Response` to remember the
 * cookies they are given. Idempotent.
 * @param {typeof globalThis} [g]
 */
export function keepCookies(g = globalThis) {
	const proto = /** @type {any} */ (g.Headers.prototype);
	if (proto.__tsundokuCookies) return;
	proto.__tsundokuCookies = true;
	const { append, set, delete: remove } = proto;
	proto.append = function (/** @type {string} */ name, /** @type {string} */ value) {
		if (isSetCookie(name)) list(this).push(String(value));
		return append.call(this, name, value);
	};
	proto.set = function (/** @type {string} */ name, /** @type {string} */ value) {
		if (isSetCookie(name)) recorded.set(this, [String(value)]);
		return set.call(this, name, value);
	};
	proto.delete = function (/** @type {string} */ name) {
		if (isSetCookie(name)) recorded.delete(this);
		return remove.call(this, name);
	};
	// A Response copies its init's headers into its own; what the browser
	// dropped on the way is carried over here.
	const Native = g.Response;
	g.Response = class Response extends Native {
		/** @param {BodyInit | null} [body] @param {ResponseInit} [init] */
		constructor(body, init) {
			super(body, init);
			const keep = setCookiesOf(init?.headers);
			const have = setCookiesOf(this.headers);
			for (const c of keep) if (!have.includes(c)) list(this.headers).push(c);
		}
	};
}

/**
 * The request SvelteKit is handed: the one given, with the tab's cookies as
 * its `Cookie` header, which a script-made `Request` cannot carry itself.
 * @param {Request} request
 * @param {string} cookie the leading tab's `document.cookie`
 */
export function withCookie(request, cookie) {
	if (!cookie) return request;
	const headers = new Headers(request.headers);
	headers.set('cookie', cookie);
	Object.defineProperty(request, 'headers', { value: headers });
	return request;
}

/**
 * A `Set-Cookie` as `document.cookie` takes it. HttpOnly is dropped: script
 * cannot set it, and in the web edition there is no network server for it to
 * keep the cookie from; the tab's own code is the only reader either way.
 * @param {string} setCookie
 */
export function forDocument(setCookie) {
	return setCookie
		.split(';')
		.map((part) => part.trim())
		.filter((part) => part && part.toLowerCase() !== 'httponly')
		.join('; ');
}
