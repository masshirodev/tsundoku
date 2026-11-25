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

interface WebExtApi {
	runtime: {
		id: string;
		getManifest(): { name: string; version: string };
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
}

declare const chrome: WebExtApi;

/** Set by fetcher/build.ts: which origins this build answers (src/lib/fetcher/protocol.ts). */
declare const __FETCHER_EDITION__: 'store' | 'development';
declare const browser: WebExtApi | undefined;
