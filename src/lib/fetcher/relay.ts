// The content script's work: on one of tsundoku's own pages, carry the page's
// requests to the background and the answers back. The page and the content
// script share the window, so they talk by window.postMessage on it; the
// content script and the background talk by runtime messages.

import { decodeBody, encodeBody, probeBytes, probeSurvived, type Transport } from './bytes.ts';
import {
	FETCHER_CHANNEL,
	FETCHER_PROTOCOL,
	isAllowedOrigin,
	isPageMessage,
	type FetcherMessage,
	type FetcherRequest
} from './protocol.ts';
import type { RuntimeReply, RuntimeRequest } from './service.ts';

/** The part of a window both sides use; a spec passes a fake. */
export interface MessageWindow {
	location: { origin: string };
	postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
	addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
	removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface RelayDeps {
	win: MessageWindow;
	/** runtime.sendMessage to the background. */
	send(message: RuntimeRequest): Promise<RuntimeReply | undefined>;
	/** The extension's own version, from its manifest, for the page to show. */
	version: string;
}

export interface Relay {
	/** How bodies cross to the background in this browser. */
	transport: Promise<Transport>;
	stop(): void;
}

/** Starts the relay, or does nothing and returns null on any other origin. */
export function startRelay({ win, send, version }: RelayDeps): Relay | null {
	const origin = win.location.origin;
	if (!isAllowedOrigin(origin)) return null;

	const post = (message: FetcherMessage, transfer: Transferable[] = []) =>
		win.postMessage(message, origin, transfer);
	const transport: Promise<Transport> = send({ kind: 'probe', bytes: probeBytes() }).then(
		(reply) => (reply?.kind === 'probe' && probeSurvived(reply.bytes) ? 'binary' : 'base64'),
		() => 'base64'
	);
	// Said once the probe is back, so a hello also means the background answers.
	const hello = () =>
		void transport.then((form) =>
			post({
				channel: FETCHER_CHANNEL,
				from: 'fetcher',
				kind: 'hello',
				protocol: FETCHER_PROTOCOL,
				version,
				transport: form
			})
		);

	async function relay(id: string, request: FetcherRequest) {
		try {
			const form = await transport;
			const reply = await send({
				kind: 'fetch',
				transport: form,
				request: {
					url: request.url,
					method: request.method,
					headers: request.headers,
					body: request.body?.length ? encodeBody(request.body, form) : null
				}
			});
			if (reply?.kind !== 'fetched') throw new Error('the fetcher gave no answer');
			if (!reply.ok) throw new Error(reply.message);
			const body = decodeBody(reply.response.body);
			post(
				{
					channel: FETCHER_CHANNEL,
					from: 'fetcher',
					kind: 'response',
					id,
					response: { ...reply.response, body }
				},
				[body.buffer]
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			post({ channel: FETCHER_CHANNEL, from: 'fetcher', kind: 'error', id, message });
		}
	}

	const listener = (event: MessageEvent) => {
		if (event.source !== win || event.origin !== origin) return;
		const message = event.data;
		if (!isPageMessage(message)) return;
		if (message.kind === 'ping') hello();
		else if (message.kind === 'request' && typeof message.id === 'string' && message.request) {
			void relay(message.id, message.request);
		}
	};
	win.addEventListener('message', listener);
	// For a page already listening; one that starts later asks with a ping.
	hello();
	return { transport, stop: () => win.removeEventListener('message', listener) };
}
