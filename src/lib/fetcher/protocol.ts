// What the page and the fetcher extension say to each other, shared by both
// sides so they cannot drift: the extension's build bundles this file, and the
// page's client (src/lib/web/fetcher-client.ts) imports it. doc/WEB-EDITION.md,
// "The fetcher", describes the protocol.

/**
 * The protocol's version. It goes up only when a message changes shape; the
 * page refuses a fetcher whose number differs from its own
 * (fetcher-client.ts), so a stale extension is reported, never half-used.
 */
export const FETCHER_PROTOCOL = 1;

/** Every window message of the protocol carries this, so others are ignored. */
export const FETCHER_CHANNEL = 'tsundoku-fetcher';

/**
 * The origins the fetcher answers. Production, and a development server on
 * the loopback address at any port. Anything else, any site that is not
 * tsundoku, gets no fetcher: one that fetched for any page would let every site
 * act inside the visitor's sessions elsewhere.
 */
export const PRODUCTION_ORIGINS: readonly string[] = ['https://tsundoku.lt'];
export const DEVELOPMENT_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

export function isAllowedOrigin(origin: string | undefined | null): boolean {
	if (!origin) return false;
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	// An origin is exactly scheme://host[:port]; a path or credentials mean
	// the caller passed a URL where an origin was expected.
	if (url.origin !== origin) return false;
	if (PRODUCTION_ORIGINS.includes(origin)) return true;
	return url.protocol === 'http:' && DEVELOPMENT_HOSTS.includes(url.hostname);
}

/** The part of a runtime.onMessage sender the origin check reads. */
export interface MessageSenderLike {
	id?: string;
	origin?: string;
	url?: string;
	frameId?: number;
	tab?: unknown;
}

/**
 * The origin of the page a runtime message came from. Chromium gives
 * `sender.origin`; Firefox gives only `sender.url`.
 */
export function senderOrigin(sender: MessageSenderLike): string | null {
	if (sender.origin) return sender.origin;
	if (!sender.url) return null;
	try {
		return new URL(sender.url).origin;
	} catch {
		return null;
	}
}

/**
 * Whether a runtime message may be answered: it comes from this extension's
 * own content script, in a tab's top frame, on an allowed origin. The content
 * script checks the origin too; this second check holds even if a content
 * script ever runs somewhere it should not.
 */
export function mayAnswer(sender: MessageSenderLike, extensionId: string): boolean {
	return (
		sender.id === extensionId &&
		sender.tab !== undefined &&
		sender.frameId === 0 &&
		isAllowedOrigin(senderOrigin(sender))
	);
}

/** A header list keeps order and repeats, which a plain object cannot. */
export type HeaderList = [name: string, value: string][];

/** What the page asks the fetcher to send. */
export interface FetcherRequest {
	url: string;
	/** GET when absent. */
	method?: string;
	headers?: HeaderList;
	body?: Uint8Array | null;
}

/** What the fetcher answers. */
export interface FetcherResponse {
	status: number;
	statusText: string;
	/** The final URL, after any redirect the browser followed. */
	url: string;
	redirected: boolean;
	headers: HeaderList;
	body: Uint8Array;
}

/** Page and content script, over window.postMessage on the page itself. */
export type PageMessage =
	| { channel: typeof FETCHER_CHANNEL; from: 'page'; kind: 'ping' }
	| {
			channel: typeof FETCHER_CHANNEL;
			from: 'page';
			kind: 'request';
			id: string;
			request: FetcherRequest;
	  };

export type FetcherMessage =
	| {
			channel: typeof FETCHER_CHANNEL;
			from: 'fetcher';
			kind: 'hello';
			protocol: number;
			version: string;
			/** How bodies cross inside the extension in this browser (bytes.ts). */
			transport: 'binary' | 'base64';
	  }
	| {
			channel: typeof FETCHER_CHANNEL;
			from: 'fetcher';
			kind: 'response';
			id: string;
			response: FetcherResponse;
	  }
	| {
			channel: typeof FETCHER_CHANNEL;
			from: 'fetcher';
			kind: 'error';
			id: string;
			message: string;
	  };

export function isPageMessage(data: unknown): data is PageMessage {
	const m = data as Partial<PageMessage> | null;
	return !!m && typeof m === 'object' && m.channel === FETCHER_CHANNEL && m.from === 'page';
}

export function isFetcherMessage(data: unknown): data is FetcherMessage {
	const m = data as Partial<FetcherMessage> | null;
	return !!m && typeof m === 'object' && m.channel === FETCHER_CHANNEL && m.from === 'fetcher';
}
