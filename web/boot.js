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
//
// While it does, the tab shows the starting screen the shell painted
// (web/start.js): the header's rule fills one step at a time as each step
// really finishes, and a start that fails says why in its place.
import { connectFetcher } from '$lib/web/fetcher-client';
import { forDocument } from './cookies.js';
import { ENGINE_ORIGIN } from './engine-port.js';
import { ENGINE_JAR, engineStarter, relay as relayToSite } from './engine-start.js';
import { NO_FETCHER, fetcherConnection } from './site-fetch.js';
import { pathOf, timingOn, timings } from './timing.js';
import { withoutKeepalive } from './keepalive.js';

/** This tab's fetcher, shared by the engine and the server's site requests. */
const fetcherLink = fetcherConnection(() => connectFetcher());

/**
 * A site request of the server's (web/site-fetch.js), sent through the
 * fetcher; without one, the server worker falls back to the browser's fetch.
 * @param {Worker} worker
 * @param {{ id: number, head: string, body: string }} data
 */
async function answerSite(worker, data) {
	const connection = await fetcherLink.get();
	const answer =
		connection.state === 'ready' && connection.fetcher
			? await relayToSite(connection.fetcher, data.head, data.body)
			: NO_FETCHER;
	worker.postMessage({ type: 'tsundoku-site-fetched', id: data.id, answer });
}
import {
	OPENED_KEY,
	REVEAL_MS,
	START_KEY,
	classify,
	drawFailure,
	drawStart,
	failScreen,
	startView
} from './start.js';

// Before the app runs a single request: its own keepalive requests would
// skip the service worker in Firefox, and with it the server (web/keepalive.js).
window.fetch = withoutKeepalive(window.fetch.bind(window), location.origin);

const LOCK = 'tsundoku-server';
const MSG = {
	request: 'tsundoku-request',
	leader: 'tsundoku-leader',
	whoLeads: 'tsundoku-who-leads',
	precache: 'tsundoku-precache',
	build: 'tsundoku-build',
	whichBuild: 'tsundoku-which-build',
	reload: 'tsundoku-reload'
};

/** The build this tab runs (the adapter writes it into the shell): said to the
 * service worker, which keeps its files while the tab is open (c1138). */
const BUILD = document.getElementById('web-start')?.dataset.build ?? '';
// Kept on <html> too, where it stays once the starting screen is gone: the
// tests read it, and so can anyone asking which build a tab runs.
document.documentElement.dataset.webBuild = BUILD;

/** Where the start is, for the tests (`data-web-boot`) and for the unknown failure's report. */
let stage = 'registering';
/** @param {string} text */
const status = (text) => {
	stage = text;
	document.documentElement.dataset.webBoot = text;
};

/** Where this start is, carried over the first visit's reload (web/start.js). */
const view = startView(window, Date.now());

/** @param {() => void} attempt */
const quietly = (attempt) => {
	try {
		attempt();
	} catch {
		// Storage refused: the start still runs, it only forgets its place.
	}
};

/** A step finished: the rule moves on, and the place is kept for a reload. */
function reached(/** @type {number} */ done) {
	view.done = Math.max(view.done, done);
	quietly(() =>
		sessionStorage.setItem(
			START_KEY,
			JSON.stringify({ first: view.first, done: view.done, since: view.since })
		)
	);
	drawStart(document, view);
}

// A first visit says what this is once it has taken a moment (handoff
// `web-edition-start`, s1); a reload in between keeps the same moment.
if (view.first && !view.revealed)
	setTimeout(
		() => {
			view.revealed = true;
			drawStart(document, view);
		},
		Math.max(0, REVEAL_MS - (Date.now() - view.since))
	);

/** @type {Worker | null} the server worker, once this tab leads and it is ready */
let server = null;

// Where the time goes, when this browser asked (web/timing.js): a test or a
// console reads window.__tsundokuTimings.
const timing = timings({ on: timingOn(), into: (globalThis.__tsundokuTimings = []) });

/** Tells the service worker this tab's server takes the requests. */
function announce() {
	navigator.serviceWorker.controller?.postMessage({ type: MSG.leader, build: BUILD });
}

/** Tells the service worker which build this tab runs. */
function sayBuild() {
	navigator.serviceWorker.controller?.postMessage({ type: MSG.build, build: BUILD });
}

/** Starts the server worker; resolves once it is ready to answer. */
function startServer() {
	status('starting the server');
	const worker = new Worker('/server/worker.js', { type: 'module' });
	/** @type {Map<number, MessagePort>} */
	const pending = new Map();
	/** @type {Map<number, { path: string, sent: number, head?: number, status?: number }>} when each request left (and its head came back), for the timing log */
	const sentAt = new Map();
	let next = 1;
	/** @type {(message: any, ports: readonly MessagePort[]) => void} */
	const relay = (data, ports) => {
		const id = next++;
		pending.set(id, ports[0]);
		if (timing.on) sentAt.set(id, { path: pathOf(String(data.url)), sent: performance.now() });
		// The browser's cookies go with the request, read now, so a cookie set
		// by the answer before this one is in it (web/cookies.js).
		worker.postMessage({ ...data, id, cookie: document.cookie }, data.body ? [data.body] : []);
	};
	/** A request answered whole: its port let go, and its time logged (web/timing.js). @param {number} id @param {number} [status] */
	const finish = (id, status) => {
		pending.delete(id);
		const sent = sentAt.get(id);
		if (!sent) return;
		sentAt.delete(id);
		const now = performance.now();
		timing.record({
			kind: 'request',
			path: sent.path,
			ms: Math.round(now - sent.sent),
			// A streamed answer's head, when the page could start drawing.
			...(sent.head ? { head: Math.round(sent.head - sent.sent) } : {}),
			status: status ?? sent.status
		});
	};
	return new Promise((resolve, reject) => {
		worker.onmessage = ({ data }) => {
			if (data.type === 'tsundoku-ready') resolve(relay);
			else if (data.type === 'tsundoku-step') reached(data.step === 'server' ? 2 : 3);
			else if (data.type === 'tsundoku-failed')
				reject(
					Object.assign(new Error(data.error), {
						name: data.name || 'Error',
						missing: data.missing
					})
				);
			else if (data.type === 'tsundoku-site-fetch') void answerSite(worker, data);
			else if (data.type === 'tsundoku-response') {
				// What the server set goes into the browser's own jar before the
				// answer is passed on, so the next request carries it.
				for (const c of data.setCookies ?? []) document.cookie = forDocument(c);
				pending.get(data.id)?.postMessage(data, data.body ? [data.body] : []);
				// A streamed body follows in pieces, passed on as they come.
				if (data.stream) {
					const sent = sentAt.get(data.id);
					if (sent) Object.assign(sent, { head: performance.now(), status: data.status });
				} else finish(data.id, data.status);
			} else if (data.type === 'tsundoku-chunk') {
				pending.get(data.id)?.postMessage(data, [data.chunk]);
			} else if (data.type === 'tsundoku-end') {
				pending.get(data.id)?.postMessage(data);
				finish(data.id);
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
			reached(4);
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
		connect: () => fetcherLink.get(),
		makeWorker: () => new Worker('/engine-worker.js'),
		// A static host may answer a missing file with the app's page: only a
		// jar is a jar.
		hasJar: () =>
			fetch(ENGINE_JAR, { headers: { range: 'bytes=0-0' } }).then(
				(r) => r.ok && (r.headers.get('content-type') ?? '').includes('java-archive'),
				() => false
			),
		origin: ENGINE_ORIGIN,
		timing,
		onNews: (news) => {
			document.documentElement.dataset.webEngine = news.state;
		}
	});
	void starter.attempt();
	// A fetcher installed or granted meanwhile is noticed when the tab is
	// focused again, by the engine and the site requests alike.
	window.addEventListener('focus', () => void fetcherLink.retry().then(() => starter.attempt()));
}

/** Whether `new Worker(url, { type: 'module' })` is understood: a browser
 * that does not know module workers never reads the option. */
function moduleWorkers() {
	let read = false;
	const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
	try {
		new Worker(url, {
			get type() {
				read = true;
				return /** @type {const} */ ('module');
			}
		}).terminate();
	} catch {
		// Refused after reading the option still counts as understood.
	} finally {
		URL.revokeObjectURL(url);
	}
	return read;
}

/** What the browser offers, looked at before anything starts (web/start.js, Probe). */
const probe = {
	serviceWorker: !!navigator.serviceWorker,
	moduleWorkers: typeof Worker === 'function' && moduleWorkers(),
	locks: !!navigator.locks,
	storageDirectory: typeof navigator.storage?.getDirectory === 'function'
};

/**
 * The app has drawn its first screen: the starting screen goes in the same
 * frame, so the app opens in place, its bar and wordmark where these were.
 * An app that fails before it draws anything is a failure to start.
 */
function handOver() {
	const screen = document.getElementById('web-start');
	const target = document.querySelector('body > div[style="display: contents"]');
	if (!screen || !target) return;
	const drawn = () => [...target.children].some((c) => c.tagName !== 'SCRIPT');
	/** @param {ErrorEvent | PromiseRejectionEvent} e */
	const broke = (e) => fail('reason' in e ? e.reason : (e.error ?? e.message));
	const done = () => {
		observer.disconnect();
		removeEventListener('error', broke);
		removeEventListener('unhandledrejection', broke);
		requestAnimationFrame(() => screen.remove());
	};
	const observer = new MutationObserver(() => drawn() && done());
	observer.observe(target, { childList: true });
	addEventListener('error', broke);
	addEventListener('unhandledrejection', broke);
}

async function boot() {
	status('registering');
	if (!probe.serviceWorker || !probe.moduleWorkers || !probe.locks || !probe.storageDirectory)
		throw new Error('the browser lacks a part the web edition needs');
	// Storage refused shows here first, before anything is registered: OPFS
	// refuses with a SecurityError when the site may not keep data.
	await navigator.storage.getDirectory();
	await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
	await navigator.serviceWorker.ready;
	if (!navigator.serviceWorker.controller) {
		// A first visit is not controlled until it loads again.
		// The reload is not a step: the page after it carries the same picture
		// on (the step reached is kept for it).
		reached(1);
		status('reloading');
		location.reload();
		return;
	}
	reached(1);

	navigator.serviceWorker.onmessage = ({ data, ports }) => {
		if (data?.type === MSG.request && relayTo) relayTo(data, ports);
		// The service worker was stopped and forgot who leads: say so again.
		else if (data?.type === MSG.whoLeads && relayTo) announce();
		else if (data?.type === MSG.whichBuild) sayBuild();
		// Another tab is going to a new build: every tab goes, so none is left
		// talking to a server of another build (doc/WEB-EDITION.md, "A new build").
		else if (data?.type === MSG.reload) location.reload();
	};
	sayBuild();

	const first = lead({ ifAvailable: true });
	if (await first.got) await first.serving;
	else {
		// Another tab's server answers this one: nothing more of its own to start.
		reached(4);
		status('ready');
		// First in line for when the leader closes. A failure then is logged:
		// the app is already running, and the next tab in line takes over.
		const later = lead({});
		later.got.catch(() => {});
		later.serving.catch((e) => console.error('the web edition could not take over', e));
	}
	// Keep the app for offline use, now that this tab has what it needs.
	navigator.serviceWorker.controller?.postMessage({ type: MSG.precache });
	// The library has opened here: the next visit is a later one, and a
	// reload of this one starts again rather than carrying a finished start.
	quietly(() => localStorage.setItem(OPENED_KEY, '1'));
	quietly(() => sessionStorage.removeItem(START_KEY));
	handOver();
	window.__tsundokuStart();
}

let failed = false;
/** Shows why the tab could not start, in place of the starting line. */
function fail(/** @type {unknown} */ e) {
	if (failed) return;
	failed = true;
	const at = stage;
	status('failed');
	server?.terminate();
	quietly(() => sessionStorage.removeItem(START_KEY));
	const f = classify({ error: e, at, probe, userAgent: navigator.userAgent });
	const build = document.getElementById('web-start')?.dataset.build ?? '';
	drawFailure(
		document,
		f.kind,
		failScreen(f, { host: location.host, userAgent: navigator.userAgent, build }),
		{
			primary: () => location.reload(),
			copy: (text) => navigator.clipboard.writeText(text)
		}
	);
	console.error(e);
}

boot().catch(fail);
