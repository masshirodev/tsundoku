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
	/** leader → service worker: "my server is ready, send me the requests" (with its `build`) */
	leader: 'tsundoku-leader',
	/** service worker → every window: "which of you leads?" (the leader answers `leader`) */
	whoLeads: 'tsundoku-who-leads',
	/** any page → service worker: keep the app's files for offline use */
	precache: 'tsundoku-precache',
	/** every page → service worker: "I run this build" (`build`); kept while I am open (c1138) */
	build: 'tsundoku-build',
	/** service worker → every window: "which build do you run?" (each answers `build`) */
	whichBuild: 'tsundoku-which-build',
	/** a page → service worker, with a port: every tab to the new build now; I am going there myself (answered once it holds) */
	moving: 'tsundoku-moving',
	/** service worker → every other window: reload, onto the new build */
	reload: 'tsundoku-reload',
	/** a page → service worker, with a port: which build are you? (answers its version) */
	workerBuild: 'tsundoku-worker-build'
} as const;

/** How long a request waits for a leader before it is answered 503. A first
 * visit climbs every migration before its server is ready, about 4 s. */
export const LEADER_WAIT_MS = 60_000;

/** What the leader posts back for a request. */
export type RelayAnswer = {
	status: number;
	statusText: string;
	headers: [string, string][];
	/** The whole body, unless `stream`: then it follows in chunks. */
	body: ArrayBuffer | null;
	/**
	 * The body comes after, as `RELAY_CHUNK` messages and one `RELAY_END`
	 * (web/worker.js). SvelteKit streams a load's promises (a source's
	 * series, a search's results): buffered whole, a page waited for its
	 * slowest part before drawing anything (c1121, 2026-11-26).
	 */
	stream?: boolean;
};

/** A piece of a streamed body, after its `RelayAnswer`. */
export const RELAY_CHUNK = 'tsundoku-chunk';
/** The end of a streamed body; `error` when the server failed part-way. */
export const RELAY_END = 'tsundoku-end';

/** What closes a stream whose tab went away mid-answer. */
export const LOST_STREAM = 'the tab running the server closed while it answered';

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
	/** Requests sent to a leader and not finished, by that leader's id: what
	 * each does if that leader is lost (answered, or its stream ended). */
	const inFlight = new Map<string, Set<() => void>>();
	let next = 1;

	/**
	 * A leader is gone (its lock passed on, or its window closed): what it was
	 * sent is lost with its server. Answered, not left hanging; a retry
	 * reaches the next one.
	 */
	function lose(id: string) {
		for (const lost of inFlight.get(id) ?? []) lost();
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
		const pending = inFlight.get(id) ?? new Set();
		inFlight.set(id, pending);
		return new Promise<Response>((resolve) => {
			let answered = false;
			/** The streamed body's controller, once the head said there is one. */
			const streamed: { c?: ReadableStreamDefaultController<Uint8Array> } = {};
			const done = () => {
				pending.delete(onLost);
				channel.port1.close();
			};
			// Lost before its answer: answered as lost. Lost part-way through a
			// streamed body: that body ends in an error, never hangs.
			const onLost = () => {
				if (!answered) {
					answered = true;
					resolve(lostAnswer(request));
				} else streamed.c?.error(new Error(LOST_STREAM));
				done();
			};
			pending.add(onLost);
			channel.port1.onmessage = ({ data }: MessageEvent<RelayMessage>) => {
				if ('type' in data && data.type === RELAY_CHUNK) {
					streamed.c?.enqueue(new Uint8Array(data.chunk));
					return;
				}
				if ('type' in data && data.type === RELAY_END) {
					if (data.error) streamed.c?.error(new Error(data.error));
					else streamed.c?.close();
					done();
					return;
				}
				const head = data as RelayAnswer;
				answered = true;
				if (!head.stream) {
					done();
					resolve(answer(head));
					return;
				}
				const stream = new ReadableStream<Uint8Array>({
					start: (c) => void (streamed.c = c),
					// The page stopped reading (it navigated away): nothing more to pass on.
					cancel: done
				});
				resolve(answer(head, stream));
			};
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

/** What the leading tab posts on a request's port: the head, then a streamed body's pieces. */
type RelayMessage =
	| RelayAnswer
	| { type: typeof RELAY_CHUNK; chunk: ArrayBuffer }
	| { type: typeof RELAY_END; error?: string };

function answer(r: RelayAnswer, stream?: ReadableStream<Uint8Array>): Response {
	// A body is not allowed with these, and the Response constructor refuses one.
	const empty = r.status === 204 || r.status === 205 || r.status === 304;
	return new Response(empty ? null : (stream ?? r.body), {
		status: r.status,
		statusText: r.statusText,
		headers: r.headers
	});
}

function text(status: number, body: string): Response {
	return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
