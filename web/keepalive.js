// The page's fetch, minus `keepalive` for its own address (doc/WEB-EDITION.md,
// "One service worker").
//
// The web edition's server answers through the app's service worker, and
// Firefox does not send a keepalive request through a service worker: it goes
// to the network, where a static host answers it with the app's page, 200.
// Every reading event, device check-in and choice the app sends with
// `keepalive: true` was lost that way in Firefox, each looking saved
// (c1123, 2026-11-26). Keepalive buys nothing here anyway: what it keeps
// alive is a request to a server that runs in this same tab.
//
// Other addresses keep it: a request to another site is not the app's.

/**
 * @param {typeof fetch} fetch the page's own
 * @param {string} origin the page's origin
 * @returns {typeof fetch}
 */
export function withoutKeepalive(fetch, origin) {
	return function (input, init) {
		if (!init?.keepalive) return fetch(input, init);
		let url;
		try {
			url = new URL(input instanceof Request ? input.url : String(input), origin);
		} catch {
			return fetch(input, init);
		}
		if (url.origin !== origin) return fetch(input, init);
		return fetch(input, { ...init, keepalive: false });
	};
}
