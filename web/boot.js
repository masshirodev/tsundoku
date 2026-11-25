// Runs before SvelteKit's client in the web edition's shell (the adapter
// rewrites index.html to call it), in every tab (doc/WEB-EDITION.md):
//
// 1. The app's service worker must control the tab: every request the app
//    makes for data is the server's, and only that worker can send it there.
// 2. One tab leads: it holds the `tsundoku-server` Web Lock, starts the server
//    worker and answers the service worker's requests with it. SQLite's OPFS
//    pool lets one connection hold the database, so a second tab must not
//    open its own; it asks for the lock too and waits, and whichever tab is
//    first in line takes over when the leader closes.
// 3. Then the app starts. A leader starts it once its server is ready, so a
//    failure to start is shown; a tab that does not lead starts it at once,
//    and its requests wait in the service worker until a leader is ready.
//
// The message names are `MESSAGES` in src/lib/web/relay.ts.
import { connectFetcher } from '$lib/web/fetcher-client';
import { ENGINE_ORIGIN } from './engine-port.js';
import { ENGINE_JAR, engineStarter } from './engine-start.js';

const LOCK = 'tsundoku-server';
const MSG = {
	request: 'tsundoku-request',
	leader: 'tsundoku-leader',
	whoLeads: 'tsundoku-who-leads',
	precache: 'tsundoku-precache'
};

/** @param {string} text */
const status = (text) => {
	document.documentElement.dataset.webBoot = text;
};

/** @type {Worker | null} the server worker, once this tab leads and it is ready */
let server = null;

/** Tells the service worker this tab's server takes the requests. */
function announce() {
	navigator.serviceWorker.controller?.postMessage({ type: MSG.leader });
}

/** Starts the server worker; resolves once it is ready to answer. */
function startServer() {
	status('starting the server');
	const worker = new Worker('/server/worker.js', { type: 'module' });
	/** @type {Map<number, MessagePort>} */
	const pending = new Map();
	let next = 1;
	/** @type {(message: any, ports: readonly MessagePort[]) => void} */
	const relay = (data, ports) => {
		const id = next++;
		pending.set(id, ports[0]);
		worker.postMessage({ ...data, id }, data.body ? [data.body] : []);
	};
	return new Promise((resolve, reject) => {
		worker.onmessage = ({ data }) => {
			if (data.type === 'tsundoku-ready') resolve(relay);
			else if (data.type === 'tsundoku-failed') reject(new Error(data.error));
			else if (data.type === 'tsundoku-response') {
				const port = pending.get(data.id);
				pending.delete(data.id);
				port?.postMessage(data, data.body ? [data.body] : []);
			}
		};
		worker.onerror = (e) => reject(new Error(e.message || 'the server worker failed to load'));
		server = worker;
	});
}

/** @type {((message: any, ports: readonly MessagePort[]) => void) | null} */
let relayTo = null;

/**
 * Asks for the lead, and keeps it for as long as this tab is open: the lock
 * is held by a promise that never settles, and the browser lets it go with
 * the tab. A server that fails to start gives the lock up, so another tab
 * can try.
 *
 * @param {{ ifAvailable?: boolean }} options `ifAvailable` asks without queueing
 * @returns {{ got: Promise<boolean>, serving: Promise<void> }} whether this
 *   tab got the lock, once that is decided; and its server being ready
 */
function lead(options) {
	/** @type {(got: boolean) => void} */ let decide = () => {};
	/** @type {(e: unknown) => void} */ let refuse = () => {};
	/** @type {() => void} */ let ready = () => {};
	/** @type {(e: unknown) => void} */ let fail = () => {};
	const got = new Promise((resolve, reject) => ((decide = resolve), (refuse = reject)));
	const serving = new Promise((resolve, reject) => ((ready = () => resolve()), (fail = reject)));
	navigator.locks
		.request(LOCK, options, async (lock) => {
			if (!lock) return decide(false);
			decide(true);
			relayTo = await startServer();
			status('ready');
			announce();
			ready();
			startEngine();
			return new Promise(() => {});
		})
		.catch((e) => {
			refuse(e);
			fail(e);
		});
	return { got, serving };
}

/**
 * The extension engine, once this tab's server is up (doc/WEB-EDITION.md,
 * "The engine"): started in its own worker, only when a fetcher answers, and
 * tried again when the tab is focused (a fetcher installed meanwhile).
 */
function startEngine() {
	if (!server) return;
	const starter = engineStarter({
		server,
		connect: () => connectFetcher(),
		makeWorker: () => new Worker('/engine-worker.js'),
		// A static host may answer a missing file with the app's page: only a
		// jar is a jar.
		hasJar: () =>
			fetch(ENGINE_JAR, { headers: { range: 'bytes=0-0' } }).then(
				(r) => r.ok && (r.headers.get('content-type') ?? '').includes('java-archive'),
				() => false
			),
		origin: ENGINE_ORIGIN,
		onNews: (news) => {
			document.documentElement.dataset.webEngine = news.state;
		}
	});
	void starter.attempt();
	window.addEventListener('focus', () => void starter.attempt());
}

async function boot() {
	status('registering');
	await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
	await navigator.serviceWorker.ready;
	if (!navigator.serviceWorker.controller) {
		// A first visit is not controlled until it loads again.
		status('reloading');
		location.reload();
		return;
	}

	navigator.serviceWorker.onmessage = ({ data, ports }) => {
		if (data?.type === MSG.request && relayTo) relayTo(data, ports);
		// The service worker was stopped and forgot who leads: say so again.
		else if (data?.type === MSG.whoLeads && relayTo) announce();
	};

	const first = lead({ ifAvailable: true });
	if (await first.got) await first.serving;
	else {
		status('ready');
		// First in line for when the leader closes. A failure then is logged:
		// the app is already running, and the next tab in line takes over.
		const later = lead({});
		later.got.catch(() => {});
		later.serving.catch((e) => console.error('the web edition could not take over', e));
	}
	// Keep the app for offline use, now that this tab has what it needs.
	navigator.serviceWorker.controller?.postMessage({ type: MSG.precache });
	window.__tsundokuStart();
}

boot().catch((e) => {
	status('failed');
	server?.terminate();
	document.body.textContent = `The web edition could not start: ${e?.message ?? e}`;
	console.error(e);
});
