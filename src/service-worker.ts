/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';
import { byteRange } from '$lib/cache/policy';

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
/** An anime's episodes kept on the device (doc/ANIME.md, "Offline"): written by the player only. */
const EPISODES = 'tsundoku-episodes';
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

/** A kept episode's file, whole or the range asked for; the network when it isn't kept. */
async function episodeFile(req: Request): Promise<Response> {
	const hit = await (await caches.open(EPISODES)).match(req.url);
	if (!hit) return fetch(req);
	const range = req.headers.get('range');
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
			'content-type': hit.headers.get('content-type') ?? 'video/x-matroska',
			'content-length': String(r.end - r.start + 1),
			'content-range': `bytes ${r.start}-${r.end}/${blob.size}`,
			'accept-ranges': 'bytes'
		}
	});
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
	if (path.startsWith('/api/')) return;
	// Screens and their data: the network, with the last copy kept.
	if (req.mode === 'navigate' || path.endsWith('/__data.json')) {
		event.respondWith(networkFirst(req, [SCREENS], SCREENS));
	}
});
