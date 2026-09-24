/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

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
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL = `tsundoku-shell-${version}`;
const ENTRIES = 'tsundoku-entries';
const SCREENS = 'tsundoku-screens';
// kuromoji's dictionary (~18MB, static/dict) is fetched when a lookup first
// needs it (doc/JAPANESE.md), never precached with the app shell.
const ASSETS = new Set([...build, ...files.filter((f) => !f.startsWith('/dict/'))]);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(SHELL)
			.then((c) => c.addAll([...ASSETS]))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
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
		const res = await fetch(req);
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

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== sw.location.origin) return;
	const path = url.pathname;

	if (ASSETS.has(path)) {
		event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
		return;
	}
	// A page image: the cached copy first -- a turn back, or a chapter read
	// offline, never waits on the network.
	if (/^\/api\/entries\/\d+\/pages\/\d+$/.test(path)) {
		event.respondWith(
			caches
				.open(ENTRIES)
				.then((c) => c.match(req, { ignoreSearch: true }))
				.then((hit) => hit ?? fetch(req))
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
				.then((hit) => hit ?? fetch(req))
		);
		return;
	}
	// A cached chapter's manifest and reader page: fresh when online.
	if (/^\/api\/entries\/\d+\/pages$/.test(path) || /^\/read\/\d+(\/__data\.json)?$/.test(path)) {
		event.respondWith(networkFirst(req, [ENTRIES, SCREENS]));
		return;
	}
	if (path.startsWith('/api/') || path === '/leave') return;
	// Screens and their data: the network, with the last copy kept.
	if (req.mode === 'navigate' || path.endsWith('/__data.json')) {
		event.respondWith(networkFirst(req, [SCREENS], SCREENS));
	}
});
