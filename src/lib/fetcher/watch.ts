// Watching the fetcher's own requests as the browser makes them (c1140): every
// redirect hop, and the address each one connected to. `fetch()` reports
// neither, so the background hands the browser's webRequest events here
// (fetcher/background.ts), and the service asks, once its fetch has settled,
// whether anything along the way was refused (reach.ts, checks 2 and 3).
import { refusal, refusedAddress } from './reach.ts';

/** What the background passes from a webRequest event, in both browsers' terms. */
export interface RequestEvent {
	requestId: string;
	url: string;
	method: string;
	tabId: number;
	/** Whether this extension made the request: Chromium's `initiator`, Firefox's `originUrl`. */
	fromExtension: boolean;
	/** The address connected to, where the event carries one. */
	ip?: string;
	/** Where a redirect sends the request next (onBeforeRedirect). */
	redirectUrl?: string;
	/**
	 * Whether the request went through a proxy, where the browser says
	 * (Firefox's `proxyInfo`): the address is then the proxy's, and says
	 * nothing about where the name led. Chromium doesn't say.
	 */
	proxied?: boolean;
}

interface Watched {
	refused: string | null;
	/** Whether the browser has reported this request at all. */
	linked: boolean;
	/** Resolves when the browser reports the request finished, or failed. */
	settled: Promise<void>;
	settle(): void;
}

/**
 * How long a fetch that has settled waits for the browser's own report that
 * the request finished. The events come from another process (Firefox's
 * parent, Chromium's browser process) and may land after `fetch()` has
 * already answered; a redirect's report, the one that names a refused hop,
 * among them. A browser that never reports costs this once per request.
 */
export const SETTLE_MS = 1000;

/** The key a request is watched under: one at a time per method and URL (schedule.ts). */
const keyOf = (method: string, url: string) => `${method.toUpperCase()} ${url}`;

export class RequestWatch {
	/** Requests the service is about to send, by method and URL. */
	private readonly expected = new Map<string, Watched>();
	/** The browser's requests, linked to the one the service sent. */
	private readonly byId = new Map<string, Watched>();

	constructor(private readonly allowed: () => readonly string[]) {}

	/**
	 * Call before fetching. Once the fetch has settled, `done` waits for the
	 * browser's report that the request finished (when the browser reported
	 * it at all), hands back what was refused, if anything, and stops watching.
	 */
	expect(method: string, url: string): { done(): Promise<string | null> } {
		const key = keyOf(method, url);
		let settle = () => {};
		const settled = new Promise<void>((resolve) => (settle = resolve));
		const watched: Watched = { refused: null, linked: false, settled, settle };
		this.expected.set(key, watched);
		return {
			done: async () => {
				if (watched.linked) {
					let timer: ReturnType<typeof setTimeout> | undefined;
					const cap = new Promise<void>((resolve) => (timer = setTimeout(resolve, SETTLE_MS)));
					await Promise.race([watched.settled, cap]);
					clearTimeout(timer);
				}
				if (this.expected.get(key) === watched) this.expected.delete(key);
				for (const [id, w] of this.byId) if (w === watched) this.byId.delete(id);
				return watched.refused;
			}
		};
	}

	/**
	 * A request is about to be sent: the first hop of one the service
	 * expects, or a redirect hop of one already linked. A hop the guard's
	 * rules block is marked refused here, so the failed fetch says why.
	 */
	started(event: RequestEvent): Watched | null {
		if (!event.fromExtension) return null;
		let watched = this.byId.get(event.requestId);
		if (!watched) {
			const key = keyOf(event.method, event.url);
			watched = this.expected.get(key);
			if (!watched) return null;
			// Linked once: the next request to this URL is another fetch.
			this.expected.delete(key);
			this.byId.set(event.requestId, watched);
			watched.linked = true;
		}
		watched.refused ??= refusal(event.url, this.allowed());
		return watched;
	}

	/** The browser connected to `event.ip` for `event.url`: a redirect, or the answer. */
	connected(event: RequestEvent): void {
		const watched = this.byId.get(event.requestId);
		if (!watched) return;
		// The hop a redirect leads to is judged here as well as when it starts:
		// a browser that blocks it by the guard's rules may never report it
		// starting (Firefox evaluates the rules first).
		if (event.redirectUrl) watched.refused ??= refusal(event.redirectUrl, this.allowed());
		if (event.proxied) return;
		watched.refused ??= refusedAddress(event.url, event.ip, this.allowed());
	}

	/** The browser reports the request finished or failed (onCompleted, onErrorOccurred). */
	finished(event: RequestEvent): void {
		this.byId.get(event.requestId)?.settle();
	}

	/** Marks a request refused by a check made outside (Firefox's lookup before sending). */
	refuse(event: RequestEvent, message: string): void {
		const watched = this.byId.get(event.requestId);
		if (watched) watched.refused ??= message;
	}

	/** For specs: how many requests are being watched. */
	get size(): number {
		return this.expected.size + this.byId.size;
	}
}
