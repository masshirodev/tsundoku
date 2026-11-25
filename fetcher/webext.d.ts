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
		getManifest(): { version: string };
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
	declarativeNetRequest: {
		getSessionRules(): Promise<WebExtRule[]>;
		updateSessionRules(options: { addRules?: object[]; removeRuleIds?: number[] }): Promise<void>;
	};
}

declare const chrome: WebExtApi;
declare const browser: WebExtApi | undefined;
