// What the page and the fetcher extension say to each other, shared by both
// sides so they cannot drift: the extension's build bundles this file, and the
// page's client (src/lib/web/fetcher-client.ts) imports it. doc/WEB-EDITION.md,
// "The fetcher", describes the protocol.

/**
 * The protocol's version. It goes up only when a message changes shape; the
 * page refuses a fetcher whose number differs from its own
 * (fetcher-client.ts), so a stale extension is reported, never half-used.
 */
export const FETCHER_PROTOCOL = 3;
// 3 (2026-11-27, c1156): an error says what it refused (`Refusal`), and the
// page may ask the reader, through the fetcher, to allow a host (`allow`).

/** Every window message of the protocol carries this, so others are ignored. */
export const FETCHER_CHANNEL = 'tsundoku-fetcher';

/**
 * Which build of the extension this is. The store build answers production
 * only. The development build also answers a development server on the
 * loopback address at any port, and must never be published: any page there
 * (a dev server, a local tool, something an npm package started) would get a
 * fetcher that sends the visitor's cookies for every site. The build picks
 * one (fetcher/build.ts) and passes it to every check below and to the
 * manifest, so this file is the one place the decision lives.
 */
export type FetcherEdition = 'store' | 'development';

/**
 * The origins the fetcher answers. Anything else, any site that is not
 * tsundoku, gets no fetcher: one that fetched for any page would let every site
 * act inside the visitor's sessions elsewhere.
 */
export const PRODUCTION_ORIGINS: readonly string[] = ['https://tsundoku.lt'];
/** Added in the development build only, over http, at any port. */
export const DEVELOPMENT_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

export function isAllowedOrigin(
	origin: string | undefined | null,
	edition: FetcherEdition
): boolean {
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
	return (
		edition === 'development' &&
		url.protocol === 'http:' &&
		DEVELOPMENT_HOSTS.includes(url.hostname)
	);
}

/**
 * The content script's match patterns for an edition. None carries a port:
 * Firefox ignores a pattern with one, and one without matches every port.
 */
export function contentScriptMatches(edition: FetcherEdition): string[] {
	const production = PRODUCTION_ORIGINS.map((origin) => `${origin}/*`);
	if (edition === 'store') return production;
	return [...production, ...DEVELOPMENT_HOSTS.map((host) => `http://${host}/*`)];
}

/** The two browsers the fetcher is built for; each gets its own manifest (fetcher/build.ts). */
export type FetcherBrowser = 'chromium' | 'firefox';

/**
 * What Firefox alone is asked for: resolving a name before a request is sent,
 * and waiting on that answer, so a public name that leads to the reader's own
 * network is refused before anything is sent (reach.ts, check 3). Chromium
 * has neither for an extension like this one, and would flag them as unknown.
 */
export const FIREFOX_PERMISSIONS = ['dns', 'webRequestBlocking'];

/**
 * The manifest an edition ships in a browser: the template
 * (fetcher/manifest.json) with the content script's matches filled in, the
 * development build named as one so the two are never confused in a
 * browser's list, each browser's own background, and Firefox's own
 * permissions in Firefox's.
 */
export function manifestFor<
	T extends {
		name: string;
		content_scripts: object[];
		permissions: string[];
		background: { service_worker?: string; scripts?: string[] };
	}
>(template: T, edition: FetcherEdition, browser: FetcherBrowser = 'chromium'): T {
	const manifest = structuredClone(template);
	manifest.content_scripts = manifest.content_scripts.map((script) => ({
		...script,
		matches: contentScriptMatches(edition)
	}));
	if (edition === 'development') manifest.name = `${manifest.name} (development)`;
	// The template names both backgrounds; each browser keeps its own, since
	// each warns about the other's (Firefox runs an event page, Chromium a
	// service worker).
	if (browser === 'firefox') {
		manifest.permissions = [...manifest.permissions, ...FIREFOX_PERMISSIONS];
		delete manifest.background.service_worker;
	} else {
		delete manifest.background.scripts;
	}
	return manifest;
}

/**
 * How much of the web the visitor let the extension reach. Firefox makes
 * host permissions opt-in, and Chromium lets a visitor narrow them to some
 * sites; without access a fetch fails as a bare network error, so the hello
 * says which it is.
 */
export type SiteAccess = 'all' | 'some' | 'none';

/**
 * Site access from what the browser reports: whether `<all_urls>` is held,
 * and the origins granted. The content script's own matches do not count:
 * Chromium lists them as granted origins, but they are tsundoku's pages, not
 * sites to fetch from.
 */
export function siteAccessFrom(
	all: boolean,
	granted: readonly string[],
	edition: FetcherEdition
): SiteAccess {
	if (all) return 'all';
	const own = new Set(contentScriptMatches(edition));
	return granted.some((origin) => !own.has(origin)) ? 'some' : 'none';
}

/** The part of a runtime.onMessage sender the origin check reads. */
export interface MessageSenderLike {
	id?: string;
	origin?: string;
	url?: string;
	frameId?: number;
	tab?: { id?: number };
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
export function mayAnswer(
	sender: MessageSenderLike,
	extensionId: string,
	edition: FetcherEdition
): boolean {
	return (
		sender.id === extensionId &&
		sender.tab !== undefined &&
		sender.frameId === 0 &&
		isAllowedOrigin(senderOrigin(sender), edition)
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

/**
 * What the fetcher refused, on the reader's own network (reach.ts), as data:
 * a page shows the host in its own case, offers ALLOW for it, and tells a
 * proxy apart, none of which it should read out of a sentence.
 */
export interface Refusal {
	/** The host refused, as a URL writes it (IPv6 in brackets). */
	host: string;
	/** The port it would have connected to, the scheme's own when none was written. */
	port: string;
	/**
	 * Whether it is the host the page asked for. A redirect's or an answer's
	 * landing on the reader's network is not: the page then says where the
	 * request was sent, and offers nothing to allow.
	 */
	asked: boolean;
	/** Where the answer came from, when a name led to the reader's network (check 3). */
	answeredFrom?: string;
}

/**
 * Why an ask to allow a host was not granted. `cancelled`: the reader said
 * no, or closed the window. `busy`: another ask is open. `declined`: the
 * reader cancelled this host in this tab already. `no-press`: the page asked
 * without a press of the reader's behind it. `not-local`: the host is on the
 * internet, so there is nothing to allow.
 */
export type AllowRefusal = 'cancelled' | 'busy' | 'declined' | 'no-press' | 'not-local';

/** Page and content script, over window.postMessage on the page itself. */
export type PageMessage =
	/** `nonce` is echoed by the hello that answers it, so a client takes only its own answer. */
	| { channel: typeof FETCHER_CHANNEL; from: 'page'; kind: 'ping'; nonce: string }
	| {
			channel: typeof FETCHER_CHANNEL;
			from: 'page';
			kind: 'request';
			id: string;
			request: FetcherRequest;
	  }
	| {
			channel: typeof FETCHER_CHANNEL;
			from: 'page';
			/**
			 * Asks the reader, in the fetcher's own window, to allow this host:
			 * on [port], or on every port when it is absent (a proxy's address).
			 */
			kind: 'allow';
			id: string;
			host: string;
			port?: string;
	  };

export type FetcherMessage =
	| {
			channel: typeof FETCHER_CHANNEL;
			from: 'fetcher';
			kind: 'hello';
			/** The ping's nonce: a hello answers one ping, never another client's. */
			to: string;
			protocol: number;
			version: string;
			/** How bodies cross inside the extension in this browser (bytes.ts). */
			transport: 'binary' | 'base64';
			/** Checked afresh for every hello, so access granted later is seen. */
			access: SiteAccess;
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
			/** Set when the error is a refusal of the reader's own network. */
			refused?: Refusal;
	  }
	| {
			channel: typeof FETCHER_CHANNEL;
			from: 'fetcher';
			/** The answer to an `allow`: what the reader chose, never the list itself. */
			kind: 'allowed';
			id: string;
			allowed: boolean;
			why?: AllowRefusal;
	  };

export function isPageMessage(data: unknown): data is PageMessage {
	const m = data as Partial<PageMessage> | null;
	return !!m && typeof m === 'object' && m.channel === FETCHER_CHANNEL && m.from === 'page';
}

export function isFetcherMessage(data: unknown): data is FetcherMessage {
	const m = data as Partial<FetcherMessage> | null;
	return !!m && typeof m === 'object' && m.channel === FETCHER_CHANNEL && m.from === 'fetcher';
}
