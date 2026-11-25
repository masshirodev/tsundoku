// The page's side of the fetcher extension (doc/WEB-EDITION.md, "The
// fetcher"): find it, check that it speaks this page's protocol, and send it
// requests. A fetcher on another protocol version is refused with the reason,
// so the page can say which side to update instead of failing mid-request.

import {
	FETCHER_CHANNEL,
	FETCHER_PROTOCOL,
	isFetcherMessage,
	type FetcherRequest,
	type FetcherResponse,
	type PageMessage
} from '../fetcher/protocol.ts';
import type { MessageWindow } from '../fetcher/relay.ts';

export interface Fetcher {
	protocol: number;
	/** The extension's version, for the page to show. */
	version: string;
	/** How the extension moves bodies inside itself in this browser. */
	transport: 'binary' | 'base64';
	fetch(request: FetcherRequest): Promise<FetcherResponse>;
	/** Stops listening; requests still pending are rejected. */
	close(): void;
}

export type FetcherConnection =
	| { state: 'ready'; fetcher: Fetcher }
	/** No fetcher answered: not installed, or not allowed on this origin. */
	| { state: 'missing' }
	/** The extension speaks an older protocol than this page: update the extension. */
	| { state: 'too-old'; protocol: number; version: string }
	/** The extension is newer than this page: reload the page for the new app. */
	| { state: 'too-new'; protocol: number; version: string };

export interface ConnectOptions {
	/** How long to wait for the fetcher's hello. */
	timeoutMs?: number;
}

/**
 * Asks for the fetcher and waits for its hello. The content script runs at
 * document start, so on a page that has loaded it answers at once; the
 * timeout only decides how long "missing" takes to say.
 */
export function connectFetcher(
	win: MessageWindow = window,
	{ timeoutMs = 1500 }: ConnectOptions = {}
): Promise<FetcherConnection> {
	const origin = win.location.origin;
	const post = (message: PageMessage) => win.postMessage(message, origin);
	// Unique per client: two clients on one page see each other's answers.
	const prefix = crypto.randomUUID();
	let next = 0;
	const pending = new Map<
		string,
		{ resolve(response: FetcherResponse): void; reject(error: Error): void }
	>();

	return new Promise((resolve) => {
		let connected = false;
		const listener = (event: MessageEvent) => {
			if (event.source !== win || event.origin !== origin) return;
			const message = event.data;
			if (!isFetcherMessage(message)) return;
			if (message.kind === 'hello') {
				if (connected) return;
				connected = true;
				clearTimeout(timer);
				const { protocol, version, transport } = message;
				if (protocol !== FETCHER_PROTOCOL) {
					win.removeEventListener('message', listener);
					resolve({
						state: protocol < FETCHER_PROTOCOL ? 'too-old' : 'too-new',
						protocol,
						version
					});
					return;
				}
				resolve({ state: 'ready', fetcher: fetcher(protocol, version, transport) });
				return;
			}
			const waiting = pending.get(message.id);
			if (!waiting) return;
			pending.delete(message.id);
			if (message.kind === 'response') waiting.resolve(message.response);
			else waiting.reject(new Error(message.message));
		};

		const fetcher = (
			protocol: number,
			version: string,
			transport: Fetcher['transport']
		): Fetcher => ({
			protocol,
			version,
			transport,
			fetch(request) {
				const id = `${prefix}:${next++}`;
				return new Promise((resolve, reject) => {
					pending.set(id, { resolve, reject });
					post({ channel: FETCHER_CHANNEL, from: 'page', kind: 'request', id, request });
				});
			},
			close() {
				win.removeEventListener('message', listener);
				for (const waiting of pending.values()) waiting.reject(new Error('the fetcher was closed'));
				pending.clear();
			}
		});

		const timer = setTimeout(() => {
			win.removeEventListener('message', listener);
			resolve({ state: 'missing' });
		}, timeoutMs);
		win.addEventListener('message', listener);
		post({ channel: FETCHER_CHANNEL, from: 'page', kind: 'ping' });
	});
}
