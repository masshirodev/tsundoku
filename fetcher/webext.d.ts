// The WebExtension calls the fetcher makes, and nothing else: it is the whole
// surface the extension uses, written down where a reviewer can see it.
// Chromium's `chrome` and Firefox's `browser` both have this shape, with
// promises, in Manifest V3.

declare module '*?raw' {
	const text: string;
	export default text;
}

interface WebExtSender {
	id?: string;
	origin?: string;
	url?: string;
	frameId?: number;
	tab?: unknown;
}

interface WebExtCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	partitionKey?: { topLevelSite?: string; hasCrossSiteAncestor?: boolean } | null;
}

interface WebExtRule {
	id: number;
}

/** A webRequest event's details, as far as the fetcher reads them (src/lib/fetcher/watch.ts). */
interface WebExtRequestDetails {
	requestId: string;
	url: string;
	method: string;
	tabId: number;
	/** Chromium: the origin that made the request (`chrome-extension://<id>` for the fetcher's own). */
	initiator?: string;
	/** Firefox: the URL that made the request (`moz-extension://<uuid>/…` for the fetcher's own). */
	originUrl?: string;
	/** The address connected to (onBeforeRedirect, onResponseStarted). */
	ip?: string;
	/** onBeforeRedirect: where the redirect sends the request. */
	redirectUrl?: string;
	/** Firefox: the proxy the request went through, null for none. */
	proxyInfo?: { type: string } | null;
}

interface WebExtRequestEvent<R> {
	addListener(
		listener: (details: WebExtRequestDetails) => R,
		filter: { urls: string[]; tabId?: number; types?: string[] },
		extraInfoSpec?: string[]
	): void;
}

interface WebExtApi {
	runtime: {
		id: string;
		getManifest(): { name: string; version: string };
		getURL(path: string): string;
		sendMessage(message: unknown): Promise<unknown>;
		onMessage: {
			addListener(
				listener: (
					message: unknown,
					sender: WebExtSender,
					sendResponse: (reply: unknown) => void
				) => boolean
			): void;
		};
	};
	cookies: {
		getAll(details: {
			url: string;
			partitionKey?: { topLevelSite: string; hasCrossSiteAncestor?: boolean };
		}): Promise<WebExtCookie[]>;
	};
	permissions: {
		contains(permissions: { origins: string[] }): Promise<boolean>;
		getAll(): Promise<{ origins?: string[] }>;
	};
	declarativeNetRequest: {
		getSessionRules(): Promise<WebExtRule[]>;
		updateSessionRules(options: { addRules?: object[]; removeRuleIds?: number[] }): Promise<void>;
	};
	/** Watching the fetcher's own requests (src/lib/fetcher/reach.ts, checks 2 and 3). */
	webRequest: {
		/** Blocking in Firefox (`webRequestBlocking`), for the lookup before sending. */
		onBeforeRequest: WebExtRequestEvent<Promise<{ cancel: boolean }> | void>;
		onBeforeRedirect: WebExtRequestEvent<void>;
		onResponseStarted: WebExtRequestEvent<void>;
		onCompleted: WebExtRequestEvent<void>;
		onErrorOccurred: WebExtRequestEvent<void>;
	};
	/** The reader's allowed hosts (the fetcher's options). */
	storage: {
		local: { get(key: string): Promise<Record<string, unknown>> };
		onChanged: {
			addListener(
				listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void
			): void;
		};
	};
	/** Firefox only: resolving a name before a request is sent. */
	dns?: { resolve(host: string): Promise<{ addresses: string[] }> };
}

declare const chrome: WebExtApi;

/** Set by fetcher/build.ts: which origins this build answers (src/lib/fetcher/protocol.ts). */
declare const __FETCHER_EDITION__: 'store' | 'development';
declare const browser: WebExtApi | undefined;
