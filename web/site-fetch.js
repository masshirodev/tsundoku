// Fetching another site from the web edition's server (doc/WEB-EDITION.md,
// "Other sites"). Server code fetches sites as it does on a computer: a
// repository's index, an extension, a catalogue's API. In a browser that
// fetch is held to the browser's cross-site rules, which most sites refuse,
// and it carries none of the site's cookies. So, in the server worker:
//
//   this origin      → the browser's own fetch (the app's static files)
//   anything else    → the leading tab's fetcher extension, with the
//                      browser's cookies, through web/boot.js
//   no fetcher       → the browser's own fetch after all: a site that allows
//                      cross-site reads (a repository on GitHub's raw files
//                      does) still answers; one that does not fails as a
//                      network error, as it would for the self-hosted app
//                      with no network.
//
// The tab answers in the same text frame as the engine (web/engine-frame.js).
import { decodeAnswer, encodeHead, toBase64 } from './engine-frame.js';

/** What the tab answers when it has no fetcher to send a request through. */
export const NO_FETCHER = 'ERR no fetcher';

/**
 * @param {{
 *   native: typeof fetch,
 *   origin: string,
 *   post: (message: { type: 'tsundoku-site-fetch', id: number, head: string, body: string }) => void
 * }} deps `origin` is this worker's own; `post` reaches the leading tab
 */
export function siteFetch({ native, origin, post }) {
	/** @type {Map<number, (answer: string) => void>} */
	const pending = new Map();
	let next = 1;

	/** The tab's answer to a request (`tsundoku-site-fetched`). @param {{ id: number, answer: string }} data */
	function answered(data) {
		const settle = pending.get(data.id);
		pending.delete(data.id);
		settle?.(String(data.answer));
	}

	/**
	 * @param {RequestInfo | URL} input
	 * @param {RequestInit} [init]
	 * @returns {Promise<Response>}
	 */
	async function fetchSite(input, init) {
		const request = new Request(input, init);
		if (new URL(request.url).origin === origin) return native(request);
		const body =
			request.method === 'GET' || request.method === 'HEAD'
				? ''
				: toBase64(new Uint8Array(await request.clone().arrayBuffer()));
		const head = encodeHead(request.method, request.url, [...request.headers]);
		const id = next++;
		const answer = await new Promise((resolve) => {
			pending.set(id, resolve);
			post({ type: 'tsundoku-site-fetch', id, head, body });
		});
		if (answer === NO_FETCHER) return native(request);
		const r = decodeAnswer(answer);
		// What fetch throws when the network fails: the server code already
		// says "the site did not answer" for it.
		if ('error' in r) throw new TypeError(`fetch failed: ${r.error}`);
		const empty = r.status === 204 || r.status === 205 || r.status === 304;
		return new Response(empty ? null : r.body, { status: r.status, headers: r.headers });
	}

	return { fetch: fetchSite, answered };
}

/**
 * The leading tab's one connection to the fetcher, shared by the engine and
 * the server's site requests. A missing fetcher is remembered until `retry()`
 * (the tab calls it on focus), so a page of site requests does not wait for
 * the fetcher's hello once per request.
 * @template F
 * @param {() => Promise<{ state: string, fetcher?: F }>} connect
 */
export function fetcherConnection(connect) {
	/** @type {Promise<{ state: string, fetcher?: F }> | null} */
	let connection = null;
	return {
		get() {
			connection ??= connect();
			return connection;
		},
		/** Ask again on the next `get()`, unless one is ready already. */
		async retry() {
			const now = await connection;
			if (now?.state !== 'ready') connection = null;
		}
	};
}
