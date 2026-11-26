/**
 * The web edition's request relay, the service worker's half
 * (doc/WEB-EDITION.md, "How a request travels"). In the web edition the app's
 * server is not on the network: it runs in a worker of one open tab, the
 * leader, which holds the `tsundoku-server` Web Lock (web/boot.js). A
 * request the server answers is posted to that tab, which hands it to its
 * server worker and posts the answer back on the request's own channel.
 *
 * One tab leads because SQLite's OPFS pool lets one connection hold the
 * database. Every tab's requests, and every navigation's, go to it. When it
 * closes, the lock passes to a tab that was waiting for it, which starts its
 * own server and says so; until a leader says it is ready, requests wait.
 *
 * The service worker can be stopped and started again at any time, which
 * forgets the leader; it then asks the open windows, and the leader answers.
 *
 * Only `src/service-worker.ts` uses this, and only when `__WEB_EDITION__`.
 */

import { lostAnswer } from './takeover.ts';

/** The page messages of the relay, both ways (web/boot.js speaks the other side). */
export const MESSAGES = {
	/** service worker → leader: a request for the server, with a port for its answer */
	request: 'tsundoku-request',
	/** leader → service worker: "my server is ready, send me the requests" */
	leader: 'tsundoku-leader',
	/** service worker → every window: "which of you leads?" (the leader answers `leader`) */
	whoLeads: 'tsundoku-who-leads',
	/** any page → service worker: keep the app's files for offline use */
	precache: 'tsundoku-precache'
} as const;

/** How long a request waits for a leader before it is answered 503. A first
 * visit climbs every migration before its server is ready, about 4 s. */
export const LEADER_WAIT_MS = 60_000;

/** What the leader posts back for a request. */
export type RelayAnswer = {
	status: number;
	statusText: string;
	headers: [string, string][];
	body: ArrayBuffer | null;
};

// The service worker's own types, as far as the relay uses them. Not
// `/// <reference lib="webworker" />`: that reaches every file of the
// program, and retypes the DOM's events for every page.
/** A window the service worker controls (the webworker lib's `Client`). */
export type Client = {
	readonly id: string;
	postMessage(message: unknown, transfer: Transferable[]): void;
	postMessage(message: unknown): void;
};
/** The service worker's `clients`, as far as the relay asks it. */
export type Clients = {
	get(id: string): Promise<Client | undefined>;
	matchAll(options: { type: 'window' }): Promise<readonly Client[]>;
};

/** The relay's memory: one per service worker. Built by `relay()`, a function
 * rather than module state so the spec can make a fresh one per case. */
export function relay(clients: Clients, { waitMs = LEADER_WAIT_MS } = {}) {
	let leaderId: string | null = null;
	let waiting: ((client: Client) => void)[] = [];
	/** Requests sent to a leader and not yet answered, by that leader's id:
	 * each one's settling, and what it is answered with if it is lost. */
	const inFlight = new Map<string, Map<(answer: Response) => void, () => Response>>();
	let next = 1;

	/**
	 * A leader is gone (its lock passed on, or its window closed): what it was
	 * sent is lost with its server. Answered, not left hanging; a retry
	 * reaches the next one.
	 */
	function lose(id: string) {
		for (const [settle, lost] of inFlight.get(id) ?? []) settle(lost());
		inFlight.delete(id);
	}

	/** A leader said it is ready (or answered "which of you leads?"). */
	function setLeader(client: Client) {
		if (leaderId && leaderId !== client.id) lose(leaderId);
		leaderId = client.id;
		const woken = waiting;
		waiting = [];
		for (const wake of woken) wake(client);
	}

	async function leader(): Promise<Client | null> {
		if (leaderId) {
			const id = leaderId;
			const known = await clients.get(id);
			if (known) return known;
			// Its window closed. Found here first when another request comes
			// before the next leader says it is ready, which then has no old
			// leader to compare with: its requests are lost now.
			lose(id);
			if (leaderId === id) leaderId = null;
		}
		const found = new Promise<Client | null>((resolve) => {
			const timer = setTimeout(() => {
				waiting = waiting.filter((w) => w !== wake);
				resolve(null);
			}, waitMs);
			const wake = (client: Client) => {
				clearTimeout(timer);
				resolve(client);
			};
			waiting.push(wake);
		});
		for (const w of await clients.matchAll({ type: 'window' }))
			w.postMessage({ type: MESSAGES.whoLeads });
		return found;
	}

	/** The server's answer to `request`, through the leading tab. */
	async function send(request: Request): Promise<Response> {
		const body =
			request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
		const client = await leader();
		if (!client) return text(503, 'no open tab is running the web edition’s server');
		const channel = new MessageChannel();
		const id = client.id;
		const settles = inFlight.get(id) ?? new Map();
		inFlight.set(id, settles);
		return new Promise<Response>((resolve) => {
			const settle = (r: Response) => {
				settles.delete(settle);
				channel.port1.close();
				resolve(r);
			};
			settles.set(settle, () => lostAnswer(request));
			channel.port1.onmessage = ({ data }: MessageEvent<RelayAnswer>) => settle(answer(data));
			client.postMessage(
				{
					type: MESSAGES.request,
					id: next++,
					url: request.url,
					method: request.method,
					headers: [...request.headers],
					body
				},
				[channel.port2, ...(body ? [body] : [])]
			);
		});
	}

	/** The service worker's `message` events that are the relay's. */
	function onMessage(event: { data: unknown; source: unknown }): boolean {
		const data = event.data as { type?: unknown } | null;
		if (data?.type !== MESSAGES.leader) return false;
		const source = event.source as Partial<Client> | null;
		// Only a window has an id; a message from another worker names no tab.
		if (source && typeof source.id === 'string' && typeof source.postMessage === 'function')
			setLeader(source as Client);
		return true;
	}

	return { send, onMessage };
}

/**
 * A form posted without script is a navigation, and a navigation's answer is
 * what the tab shows. The web edition shows only its shell, so the only answer
 * a navigation can take from the server is a redirect, which the shell then
 * loads; anything else is sent back to the page's own address, its result
 * lost. Every form in the app posts with `use:enhance`, so this is only the
 * no-script case.
 */
export function postedForm(answer: Response, url: string): Response {
	if (answer.status >= 300 && answer.status < 400) return answer;
	return Response.redirect(url, 303);
}

function answer(r: RelayAnswer): Response {
	// A body is not allowed with these, and the Response constructor refuses one.
	const empty = r.status === 204 || r.status === 205 || r.status === 304;
	return new Response(empty ? null : r.body, {
		status: r.status,
		statusText: r.statusText,
		headers: r.headers
	});
}

function text(status: number, body: string): Response {
	return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
