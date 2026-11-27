/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, prerendered, version } from '$service-worker';
import { byteRange } from '$lib/cache/policy';
import { builds as buildsOf, shellName, stale } from '$lib/web/builds';
import { MESSAGES, postedForm, relay } from '$lib/web/relay';

/**
 * Offline (doc/OFFLINE.md). Three caches:
 *
 * - the app shell for this build: its scripts, styles and fonts;
 * - `tsundoku-entries`: chapters the reader or ↓ CACHE put there, served
 *   first, so a cached chapter opens with no network at all;
 * - `tsundoku-screens`: the last copy of each screen and its data, used only
 *   when the workstation can't be reached.
 *
 * Nothing rendered while reveal is on is kept: the server marks those
 * responses `no-store` (src/hooks.server.ts), and a `no-store` response is
 * never written here. Only same-origin GETs are handled; writes always go to
 * the network.
 *
 * The web edition (doc/WEB-EDITION.md) builds this same worker with
 * `__WEB_EDITION__`. Its server is not on the network but in one open tab,
 * so where this worker would fetch from the server it asks that tab instead
 * (`$lib/web/relay`), and every request the server answers is answered
 * here, since nothing else could: writes, `/api/*`, a screen's data. Its
 * navigations get the app's shell, which then loads its data the same way.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

const web = __WEB_EDITION__ ? relay(sw.clients) : null;
/** The web edition's builds: which one to serve, which ones' files to keep (c1138). */
const builds = __WEB_EDITION__ ? buildsOf(version) : null;

/** The app's server: the network, or in the web edition the leading tab. */
const server = (req: Request): Promise<Response> => (web ? web.send(req) : fetch(req));

/**
 * The web edition's own files beside the client's: its shell, `boot.js` and
 * the server worker's code. Plain network files, like the client's.
 */
const webFile = (path: string) =>
	path === '/index.html' ||
	path === '/boot.js' ||
	path === '/engine-worker.js' ||
	path.startsWith('/server/') ||
	path.startsWith('/engine/');

/**
 * A file of the web edition's shell, from the build being served (c1138):
 * the leader's while its server runs an older one, so a tab opened meanwhile
 * runs that build too. A file named by its content (`/_app/immutable/`, a
 * server chunk) is the same file in any build that has it, so any kept build
 * answers it; a fixed name (`/index.html`, `/boot.js`, `/server/worker.js`)
 * comes from the served build only, or the network.
 */
async function webShellFile(req: Request | string, path: string): Promise<Response> {
	const served = shellName(builds?.serving() ?? version);
	for (const name of new Set([served, SHELL])) {
		const hit = await (await caches.open(name)).match(req);
		if (hit) return hit;
	}
	const named = path.startsWith('/_app/immutable/') || isServerChunk(path);
	return (named && (await caches.match(req))) || fetch(req);
}
const isServerChunk = (path: string) =>
	path.startsWith('/server/') && path !== '/server/worker.js' && path !== '/server/files.json';

/** Every file the build puts on the network, kept or not (the dictionary is
 * one): in the web edition, the requests that are not the server's. */
const STATIC = new Set([...build, ...files, ...prerendered]);

const SHELL = shellName(version);
const ENTRIES = 'tsundoku-entries';
const SCREENS = 'tsundoku-screens';
/** An anime's episodes kept on the device (doc/ANIME.md, "Offline"): written by the player only. */
const EPISODES = 'tsundoku-episodes';
// kuromoji's dictionary (~18MB, static/dict) is fetched when a lookup first
// needs it (doc/JAPANESE.md), never precached with the app shell.
const ASSETS = new Set([...build, ...files.filter((f) => !f.startsWith('/dict/'))]);

/** The app shell, kept for this build. The web edition keeps its own files too, listed by its build. */
async function precache(): Promise<void> {
	const own: string[] = __WEB_EDITION__
		? await fetch('/server/files.json').then((r) => r.json() as Promise<string[]>)
		: [];
	await (await caches.open(SHELL)).addAll([...ASSETS, ...own]);
}

sw.addEventListener('install', (event) => {
	// The web edition's tab cannot start until this worker controls it, and
	// keeping the whole app first would hold every first visit for it: its
	// tab asks for the copy once it runs (MESSAGES.precache) instead.
	if (__WEB_EDITION__) event.waitUntil(sw.skipWaiting());
	else event.waitUntil(precache().then(() => sw.skipWaiting()));
});

sw.addEventListener('message', (event) => {
	if (!web || !builds) return;
	const data = event.data as { type?: string; build?: unknown } | null;
	const from = event.source as { id?: unknown } | null;
	const id = typeof from?.id === 'string' ? from.id : null;
	// A tab's build, said on its own (every tab, at its start and when asked)
	// or with its leading: kept while it is open, and the leader's served.
	const build = typeof data?.build === 'string' ? data.build : null;
	if (data?.type === MESSAGES.leader) builds.leader(build);
	if ((data?.type === MESSAGES.leader || data?.type === MESSAGES.build) && id && build) {
		builds.report(id, build);
		event.waitUntil(prune());
	}
	if (web.onMessage(event) || data?.type === MESSAGES.build) return;
	if (data?.type === MESSAGES.precache) event.waitUntil(precache());
	else if (data?.type === MESSAGES.workerBuild) event.ports[0]?.postMessage(version);
	else if (data?.type === MESSAGES.moving) {
		// One tab is going to the new build: every other goes with it, so no
		// tab is left talking to a server of another build.
		builds.move();
		event.ports[0]?.postMessage(true);
		event.waitUntil(
			sw.clients.matchAll({ type: 'window' }).then((all) => {
				for (const w of all) if (w.id !== id) w.postMessage({ type: MESSAGES.reload });
			})
		);
	}
});

/**
 * The web edition deletes a build's files only once no open tab runs it: a
 * tab's server loads its route chunks lazily, and a deploy takes the old ones
 * off the host (c1138). Asked of every open tab when it is not known.
 */
async function prune(): Promise<void> {
	if (!builds) return;
	const open = await sw.clients.matchAll({ type: 'window' });
	const keep = builds.keep(open.map((c) => c.id));
	if (keep) {
		await Promise.all(stale(await caches.keys(), keep).map((k) => caches.delete(k)));
		return;
	}
	// Asked once each: a tab too old to answer must not have every other
	// tab's answer ask again, round and round. Its build stays until it closes.
	for (const w of open)
		if (!askedBuild.has(w.id)) {
			askedBuild.add(w.id);
			w.postMessage({ type: MESSAGES.whichBuild });
		}
}
/** The tabs already asked which build they run, by this worker. */
const askedBuild = new Set<string>();

sw.addEventListener('activate', (event) => {
	// The web edition keeps older builds' files while a tab runs them (prune).
	if (__WEB_EDITION__) {
		event.waitUntil(sw.clients.claim().then(prune));
		return;
	}
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((k) => k.startsWith('tsundoku-shell-') && k !== SHELL)
						.map((k) => caches.delete(k))
				)
			)
			.then(() => sw.clients.claim())
	);
});

const storable = (res: Response) =>
	res.ok && res.type === 'basic' && !/no-store/.test(res.headers.get('cache-control') ?? '');

/** The network, and a copy kept for when it's gone. */
async function networkFirst(
	req: Request,
	fallbackCaches: string[],
	keepIn?: string
): Promise<Response> {
	try {
		const res = await server(req);
		if (keepIn && storable(res)) {
			const copy = res.clone();
			void caches.open(keepIn).then((c) => c.put(req, copy));
		}
		return res;
	} catch {
		for (const name of fallbackCaches) {
			const hit = await (await caches.open(name)).match(req, { ignoreSearch: true });
			if (hit) return hit;
		}
		if (req.mode === 'navigate') {
			// Nothing kept for this screen: the library, if it was ever seen.
			const home = await (await caches.open(SCREENS)).match('/');
			if (home) return home;
		}
		return new Response('offline', { status: 503, headers: { 'content-type': 'text/plain' } });
	}
}

/** A kept episode's file, whole or the range asked for; the network when it isn't kept. */
async function episodeFile(req: Request): Promise<Response> {
	const hit = await (await caches.open(EPISODES)).match(req.url);
	if (!hit) return server(req);
	return sliced(hit, req.headers.get('range'), 'video/x-matroska');
}

/**
 * The web edition's engine jar (doc/WEB-EDITION.md, "The engine"). CheerpJ
 * reads a jar by byte ranges, and the browser's HTTP cache keeps no ranged
 * answer, so every visit would fetch the whole jar again in pieces. The jar
 * is kept whole, with the shell's copy (a new build, a new jar), and each
 * range is cut from it here.
 */
async function engineFile(req: Request): Promise<Response> {
	const shell = await caches.open(shellName(builds?.serving() ?? version));
	let whole = await shell.match(req.url);
	if (!whole) {
		const res = await fetch(req.url);
		// A static host may answer a missing file with the app's page; that is
		// not a jar, and must never be kept as one.
		if (!res.ok || !(res.headers.get('content-type') ?? '').includes('java-archive'))
			return new Response('no engine in this build', { status: 404 });
		await shell.put(req.url, res.clone());
		whole = res;
	}
	return sliced(whole, req.headers.get('range'), 'application/java-archive');
}

/** A kept file, whole, or the range asked for (206), or 416 when it is past the end. */
async function sliced(hit: Response, range: string | null, type: string): Promise<Response> {
	if (!range) return hit;
	const blob = await hit.blob();
	const r = byteRange(range, blob.size);
	if (!r)
		return new Response(null, {
			status: 416,
			headers: { 'content-range': `bytes */${blob.size}` }
		});
	return new Response(blob.slice(r.start, r.end + 1), {
		status: 206,
		headers: {
			'content-type': hit.headers.get('content-type') ?? type,
			'content-length': String(r.end - r.start + 1),
			'content-range': `bytes ${r.start}-${r.end}/${blob.size}`,
			'accept-ranges': 'bytes'
		}
	});
}

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	const url = new URL(req.url);
	if (url.origin !== sw.location.origin) return;
	const path = url.pathname;
	if (req.method !== 'GET') {
		if (!web) return;
		// A write is the server's. A form posted without script is a
		// navigation, whose answer the shell must be able to show.
		if (req.mode === 'navigate')
			event.respondWith(web.send(req).then((r) => postedForm(r, req.url)));
		else event.respondWith(web.send(req));
		return;
	}

	if (web && path.startsWith('/engine/')) {
		event.respondWith(engineFile(req));
		return;
	}
	// The build's version, always from the host: the app compares it with its
	// own to learn a deploy happened (vite.config.ts). The server in the tab
	// knows only the build it runs.
	if (web && path === '/_app/version.json') return;
	if (web && (webFile(path) || path.startsWith('/_app/immutable/'))) {
		event.respondWith(webShellFile(req, path));
		return;
	}
	if (ASSETS.has(path)) {
		event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
		return;
	}
	if (web && STATIC.has(path)) return;
	if (web && req.mode === 'navigate') {
		// Every screen is the shell, which then asks the server for its data.
		event.respondWith(webShellFile('/index.html', '/index.html'));
		return;
	}
	// A page image: the cached copy first -- a turn back, or a chapter read
	// offline, never waits on the network.
	if (/^\/api\/entries\/\d+\/pages\/\d+$/.test(path)) {
		event.respondWith(
			caches
				.open(ENTRIES)
				.then((c) => c.match(req, { ignoreSearch: true }))
				.then((hit) => hit ?? server(req))
		);
		return;
	}
	// A novel's EPUB, whole (doc/TEXT-READER.md): the kept copy first, by its
	// exact versioned URL. Only the reader writes it (src/lib/cache/device.ts),
	// never this worker, so incognito and hidden books leave nothing behind.
	if (/^\/api\/series\/\d+\/epub$/.test(path)) {
		event.respondWith(
			caches
				.open(ENTRIES)
				.then((c) => c.match(req))
				.then((hit) => hit ?? server(req))
		);
		return;
	}
	// A downloaded episode kept on the device (doc/ANIME.md, "Offline"): the
	// kept copy first, sliced for the player's Range requests, since a video
	// seeks. Only the player writes it, never this worker.
	if (/^\/api\/anime\/file\/\d+$/.test(path)) {
		event.respondWith(episodeFile(req));
		return;
	}
	// Its subtitles and the answer naming its file: fresh when online, kept when not.
	if (/^\/api\/anime\/(file\/\d+\/subtitle\/\d+|episode\/\d+\/videos)$/.test(path)) {
		event.respondWith(networkFirst(req, [EPISODES]));
		return;
	}
	// A cached chapter's manifest, OCR'd text and reader page: fresh when online.
	if (
		/^\/api\/entries\/\d+\/(pages|text)$/.test(path) ||
		/^\/read\/\d+(\/__data\.json)?$/.test(path)
	) {
		event.respondWith(networkFirst(req, [ENTRIES, EPISODES, SCREENS]));
		return;
	}
	if (path.startsWith('/api/')) {
		if (web) event.respondWith(web.send(req));
		return;
	}
	// Screens and their data: the network, with the last copy kept. The web
	// edition's server is in the tab and never out of reach, so it keeps none.
	if (req.mode === 'navigate' || path.endsWith('/__data.json')) {
		event.respondWith(networkFirst(req, [SCREENS], web ? undefined : SCREENS));
		return;
	}
	// Anything else of this origin is the server's too (a route's own file,
	// an endpoint outside /api/): the self-hosted app's goes to the network.
	if (web) event.respondWith(web.send(req));
});
