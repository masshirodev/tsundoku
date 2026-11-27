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
	type AllowRefusal,
	type FetcherEdition,
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
	/** The build's edition, which decides the origins served. */
	edition: FetcherEdition;
	/**
	 * Whether the reader is pressing something on the page right now
	 * (`navigator.userActivation.isActive`): an ask to allow a host is
	 * forwarded only then, so a page can't raise the fetcher's window on its own.
	 */
	pressed(): boolean;
}

export interface Relay {
	/** How bodies cross to the background in this browser. */
	transport: Promise<Transport>;
	stop(): void;
}

/** Starts the relay, or does nothing and returns null on any other origin. */
export function startRelay({ win, send, version, edition, pressed }: RelayDeps): Relay | null {
	const origin = win.location.origin;
	if (!isAllowedOrigin(origin, edition)) return null;

	const post = (message: FetcherMessage, transfer: Transferable[] = []) =>
		win.postMessage(message, origin, transfer);

	/** Asks the background how bytes cross and how much access it has; null if it cannot answer. */
	const probe = () =>
		send({ kind: 'probe', bytes: probeBytes() }).then(
			(reply) =>
				reply?.kind === 'probe'
					? {
							transport: (probeSurvived(reply.bytes) ? 'binary' : 'base64') as Transport,
							access: reply.access
						}
					: null,
			() => null
		);
	// The first probe settles how bodies cross; a browser does not change that.
	const transport: Promise<Transport> = probe().then((answer) => answer?.transport ?? 'base64');

	// Said only once the background has answered, so a hello means it is
	// there. Every ping probes again: access granted since the page loaded is
	// seen at the page's next connectFetcher(), with no reload. A hello
	// answers its ping by nonce, so an answer probed before the grant never
	// reaches a client that asked after it.
	const hello = (to: string) =>
		void probe().then((found) => {
			if (!found) return;
			post({
				channel: FETCHER_CHANNEL,
				from: 'fetcher',
				kind: 'hello',
				to,
				protocol: FETCHER_PROTOCOL,
				version,
				transport: found.transport,
				access: found.access
			});
		});

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
			if (!reply.ok) {
				post({
					channel: FETCHER_CHANNEL,
					from: 'fetcher',
					kind: 'error',
					id,
					message: reply.message,
					...(reply.refused ? { refused: reply.refused } : {})
				});
				return;
			}
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

	/** Carries an ask to allow a host to the background, which asks the reader. */
	async function ask(id: string, host: string, port: string | undefined) {
		const answer = (allowed: boolean, why?: AllowRefusal) =>
			post({
				channel: FETCHER_CHANNEL,
				from: 'fetcher',
				kind: 'allowed',
				id,
				allowed,
				...(why ? { why } : {})
			});
		// Read at once: the press is over by the time anything else has run.
		if (!pressed()) return answer(false, 'no-press');
		try {
			const reply = await send({ kind: 'allow', host, ...(port === undefined ? {} : { port }) });
			if (reply?.kind !== 'allowed') return answer(false, 'cancelled');
			answer(reply.allowed, reply.allowed ? undefined : reply.why);
		} catch {
			answer(false, 'cancelled');
		}
	}

	const listener = (event: MessageEvent) => {
		if (event.source !== win || event.origin !== origin) return;
		const message = event.data;
		if (!isPageMessage(message)) return;
		if (message.kind === 'ping' && typeof message.nonce === 'string') hello(message.nonce);
		else if (message.kind === 'request' && typeof message.id === 'string' && message.request) {
			void relay(message.id, message.request);
		} else if (
			message.kind === 'allow' &&
			typeof message.id === 'string' &&
			typeof message.host === 'string' &&
			(message.port === undefined || typeof message.port === 'string')
		) {
			void ask(message.id, message.host, message.port);
		}
	};
	win.addEventListener('message', listener);
	return { transport, stop: () => win.removeEventListener('message', listener) };
}
