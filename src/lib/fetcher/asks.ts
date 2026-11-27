// Asking the reader to allow a host on their own network (c1156). tsundoku's
// page may ask; only the reader answers, in a window the fetcher opens itself
// (fetcher/confirm.html), which nothing on the page can press. The page learns
// what the reader chose, never the list (handoff `fetcher-options`, revision 1).
//
// The rules, all here so a spec holds them:
// - One ask at a time. A second, while a window is open, brings that window
//   forward and is answered `busy`.
// - A host and port the reader cancelled in a tab isn't asked again in that
//   tab until it loads a new page (`declined`); closing the window is
//   cancelling.
// - A host on the internet has nothing to allow (`not-local`), and one
//   already allowed is answered `allowed` without a window.
// - The window shows only what the fetcher knows itself: the origin of the
//   tab that asked, and the host and port. Nothing else the page sent.
import type { AllowRefusal } from './protocol.ts';
import { entryAllows, isOwnNetwork } from './reach.ts';

/** What the confirmation window shows, read by it from the background. */
export interface AskDetails {
	/** The origin of the tab that asked (`https://tsundoku.lt`). */
	origin: string;
	host: string;
	/** Null for every port: a proxy's address. */
	port: string | null;
	/**
	 * What the fetcher itself saw of this address, when it refused answers
	 * from it: how many sites, since when (ms). How a proxy shows itself.
	 */
	seen?: { sites: number; since: number };
}

export type AskAnswer = { allowed: true } | { allowed: false; why: AllowRefusal };

export interface AskDeps {
	/** Opens the confirmation window for ask [id]; resolves to an id `closed` will name. */
	open(id: string): Promise<number>;
	/** Brings an open window forward. */
	focus(windowId: number): Promise<void>;
	close(windowId: number): Promise<void>;
	/** The hosts allowed now, built-in ones included. */
	allowed(): readonly string[];
	/** Adds [entry] to the reader's list and puts it in force before resolving. */
	allow(entry: string): Promise<void>;
	/** What the fetcher saw of answers from [address] it refused, if any. */
	seen(address: string): AskDetails['seen'];
}

interface Pending extends Omit<AskDetails, 'seen'> {
	id: string;
	tabId: number;
	windowId: number | null;
	settle(answer: AskAnswer): void;
}

/** The entry an ask allows: exactly the host and port asked, or the host on every port. */
export const entryFor = (host: string, port: string | null) => (port ? `${host}:${port}` : host);

export class Asks {
	private pending: Pending | null = null;
	/** `<tabId> <host>:<port>`, cancelled in that tab since it last loaded a page. */
	private readonly declined = new Set<string>();
	private next = 0;

	constructor(private readonly deps: AskDeps) {}

	/** The reader is asked about [host]:[port], on behalf of tab [tabId] at [origin]. */
	async ask(tabId: number, origin: string, host: string, port: string | null): Promise<AskAnswer> {
		let url: URL;
		try {
			url = new URL(`http://${host}/`);
		} catch {
			return { allowed: false, why: 'not-local' };
		}
		if (url.hostname !== host) return { allowed: false, why: 'not-local' };
		if (port !== null && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535))
			return { allowed: false, why: 'not-local' };
		if (!isOwnNetwork(url)) return { allowed: false, why: 'not-local' };
		const wanted = entryFor(host, port);
		const covered =
			port === null
				? this.deps.allowed().includes(host)
				: this.deps.allowed().some((entry) => {
						const at = new URL(`http://${host}/`);
						at.port = port === '80' ? '' : port;
						return entryAllows(entry, at);
					});
		if (covered) return { allowed: true };
		if (this.declined.has(`${tabId} ${wanted}`)) return { allowed: false, why: 'declined' };
		if (this.pending) {
			if (this.pending.windowId !== null)
				await this.deps.focus(this.pending.windowId).catch(() => {});
			return { allowed: false, why: 'busy' };
		}
		const id = `ask-${++this.next}`;
		let settle: (answer: AskAnswer) => void = () => {};
		const answer = new Promise<AskAnswer>((resolve) => (settle = resolve));
		const pending: Pending = { id, tabId, origin, host, port, windowId: null, settle };
		this.pending = pending;
		try {
			const windowId = await this.deps.open(id);
			if (this.pending === pending) pending.windowId = windowId;
			else await this.deps.close(windowId).catch(() => {});
		} catch {
			this.finish(id, { allowed: false, why: 'cancelled' });
		}
		return answer;
	}

	/** What the window for ask [id] shows; null for an ask that is over. */
	details(id: string): AskDetails | null {
		const p = this.pending;
		if (p?.id !== id) return null;
		const seen = this.deps.seen(p.host);
		return { origin: p.origin, host: p.host, port: p.port, ...(seen ? { seen } : {}) };
	}

	/** The reader pressed ALLOW or CANCEL in the window for ask [id]. */
	async answer(id: string, allowed: boolean): Promise<void> {
		const p = this.pending;
		if (p?.id !== id) return;
		if (allowed) {
			try {
				await this.deps.allow(entryFor(p.host, p.port));
			} catch {
				this.finish(id, { allowed: false, why: 'cancelled' });
				return;
			}
			this.finish(id, { allowed: true });
		} else {
			this.finish(id, { allowed: false, why: 'cancelled' });
		}
		if (p.windowId !== null) await this.deps.close(p.windowId).catch(() => {});
	}

	/** A window closed: if it was the open ask's, the reader cancelled. */
	closed(windowId: number): void {
		const p = this.pending;
		if (p && p.windowId === windowId) this.finish(p.id, { allowed: false, why: 'cancelled' });
	}

	/** Tab [tabId] loaded a new page: what it cancelled may be asked again. */
	reloaded(tabId: number): void {
		for (const key of this.declined) if (key.startsWith(`${tabId} `)) this.declined.delete(key);
	}

	private finish(id: string, answer: AskAnswer) {
		const p = this.pending;
		if (p?.id !== id) return;
		this.pending = null;
		if (!answer.allowed) this.declined.add(`${p.tabId} ${entryFor(p.host, p.port)}`);
		p.settle(answer);
	}
}
