import { CACHE_NAME, offline } from '$lib/offline.svelte';
import {
	EPISODE_BUDGET_BYTES,
	episodeMarkerPath,
	evict,
	keepEpisodes,
	keepFor,
	markerPath,
	parseEpisodeMarker,
	parseMarker,
	type Cached,
	type EntryRef
} from './policy';

/**
 * The device cache (doc/OFFLINE.md): an entry is cached as its manifest,
 * every page image, the reader's page and its data, and a marker saying what
 * it belongs to. The service worker (src/service-worker.ts) serves them when
 * the workstation can't be reached; this module fills and empties the bucket.
 *
 * Never called for a hidden series, while reveal is on, or while incognito:
 * the cache is something left on the tablet, and those leave nothing.
 */

type Marker = Cached & { version: string; pages: number };

const pageUrl = (entryId: number, n: number, version: string) =>
	`/api/entries/${entryId}/pages/${n}?v=${encodeURIComponent(version)}`;

async function open(): Promise<Cache | null> {
	if (!('caches' in globalThis)) return null;
	try {
		return await caches.open(CACHE_NAME);
	} catch {
		return null;
	}
}

export async function listCached(): Promise<Marker[]> {
	const cache = await open();
	if (!cache) return [];
	const out: Marker[] = [];
	for (const req of await cache.keys()) {
		if (!parseMarker(new URL(req.url).pathname)) continue;
		const res = await cache.match(req);
		if (res) out.push((await res.json()) as Marker);
	}
	return out;
}

const inFlight = new Set<number>();

/** Cache one entry, whole. Already cached at this version: nothing to do. */
export async function cacheEntry(seriesId: number, entryId: number): Promise<boolean> {
	const cache = await open();
	if (!cache || inFlight.has(entryId)) return false;
	inFlight.add(entryId);
	try {
		const manifestRes = await fetch(`/api/entries/${entryId}/pages`);
		if (!manifestRes.ok) return false;
		const manifest = (await manifestRes.clone().json()) as { version: string; pages: unknown[] };
		// Its OCR'd text, for lookups offline (doc/JAPANESE.md): refreshed every
		// time, since OCR reads a chapter after it's kept.
		const text = await fetch(`/api/entries/${entryId}/text`, { credentials: 'same-origin' });
		if (text.ok) await cache.put(`/api/entries/${entryId}/text`, text);
		const marker = markerPath(seriesId, entryId);
		const had = await cache.match(marker);
		if (had && ((await had.json()) as Marker).version === manifest.version) return true;

		let bytes = 0;
		for (let n = 0; n < manifest.pages.length; n++) {
			const url = pageUrl(entryId, n, manifest.version);
			const res = await fetch(url);
			if (!res.ok) return false;
			const body = await res.blob();
			bytes += body.size;
			await cache.put(url, new Response(body, { headers: res.headers }));
		}
		await cache.put(`/api/entries/${entryId}/pages`, manifestRes);
		// The reader's own page and data, so it opens without the workstation.
		for (const url of [`/read/${entryId}`, `/read/${entryId}/__data.json`]) {
			const res = await fetch(url, { credentials: 'same-origin' });
			if (res.ok) await cache.put(url, res);
		}
		const m: Marker = {
			seriesId,
			entryId,
			at: Date.now(),
			bytes,
			version: manifest.version,
			pages: manifest.pages.length
		};
		await cache.put(
			marker,
			new Response(JSON.stringify(m), { headers: { 'content-type': 'application/json' } })
		);
		return true;
	} catch {
		// Offline, or the workstation went away mid-way: the marker is written
		// last, so a half-cached entry is never counted as cached.
		return false;
	} finally {
		inFlight.delete(entryId);
	}
}

export async function dropEntry(entryId: number): Promise<void> {
	const cache = await open();
	if (!cache) return;
	for (const req of await cache.keys()) {
		const path = new URL(req.url).pathname;
		const marker = parseMarker(path);
		if (
			(marker && marker.entryId === entryId) ||
			path.startsWith(`/api/entries/${entryId}/pages`) ||
			path === `/api/entries/${entryId}/text` ||
			path === `/read/${entryId}` ||
			path === `/read/${entryId}/__data.json`
		)
			await cache.delete(req);
	}
}

/**
 * The policy for one series while an entry of it is open: cache what should
 * be ahead, drop this series' entries that shouldn't be, then keep the whole
 * cache under budget. Runs in the background; a failure only means less is
 * cached.
 */
export async function keepAhead(
	seriesId: number,
	entries: EntryRef[],
	currentId: number
): Promise<void> {
	if (!offline.online) return;
	const keep = keepFor(entries, currentId);
	const cached = await listCached();
	for (const c of cached)
		if (c.seriesId === seriesId && !keep.includes(c.entryId)) await dropEntry(c.entryId);
	for (const id of keep) await cacheEntry(seriesId, id);
	for (const id of evict(await listCached(), keep)) await dropEntry(id);
	await offline.refresh();
}

/**
 * A novel is kept whole (doc/TEXT-READER.md): the EPUB the reader already
 * downloaded, the open entry's reader page and data, and a marker for every
 * entry, so the offline screens count the book as read-offline-able. The
 * book's size goes on the first marker, so the budget weighs it once.
 */
export async function cacheBook(o: {
	seriesId: number;
	entryIds: number[];
	openEntryId: number;
	url: string;
	bytes: Uint8Array;
	version: string;
}): Promise<void> {
	if (!offline.online) return;
	const cache = await open();
	if (!cache) return;
	try {
		if (!(await cache.match(o.url)))
			await cache.put(
				o.url,
				new Response(o.bytes as BodyInit, {
					headers: {
						'content-type': 'application/epub+zip',
						'content-length': String(o.bytes.length)
					}
				})
			);
		for (const url of [`/read/${o.openEntryId}`, `/read/${o.openEntryId}/__data.json`]) {
			const res = await fetch(url, { credentials: 'same-origin' });
			if (res.ok && !/no-store/.test(res.headers.get('cache-control') ?? ''))
				await cache.put(url, res);
		}
		const now = Date.now();
		for (const [i, entryId] of o.entryIds.entries()) {
			const marker = markerPath(o.seriesId, entryId);
			if (await cache.match(marker)) continue;
			const m: Marker = {
				seriesId: o.seriesId,
				entryId,
				at: now,
				bytes: i === 0 ? o.bytes.length : 0,
				version: o.version,
				pages: 0
			};
			await cache.put(
				marker,
				new Response(JSON.stringify(m), { headers: { 'content-type': 'application/json' } })
			);
		}
		await offline.refresh();
	} catch {
		// Storage full or refused: the book still reads this session.
	}
}

/** ↓ CACHE and REMOVE CACHE from the series screen's selection. */
/** ↓ CACHE in SELECT: chapters, or an anime's downloaded episodes into their own bucket. */
export async function cacheMany(seriesId: number, ids: number[], episodes = false): Promise<void> {
	for (const id of ids) await (episodes ? cacheEpisode(seriesId, id) : cacheEntry(seriesId, id));
	await offline.refresh();
}

export async function dropMany(ids: number[]): Promise<void> {
	for (const id of ids) {
		await dropEntry(id);
		await dropEpisode(id);
	}
	await offline.refresh();
}

// ---- episodes (doc/ANIME.md, "Offline") ------------------------------------------------------------

/** Episodes are a bucket of their own, with their own budget (policy.ts). */
export const EPISODE_CACHE = 'tsundoku-episodes';

type EpisodeMarker = Cached & { subtitles: number };

async function openEpisodes(): Promise<Cache | null> {
	if (!('caches' in globalThis)) return null;
	try {
		return await caches.open(EPISODE_CACHE);
	} catch {
		return null;
	}
}

export async function listCachedEpisodes(): Promise<EpisodeMarker[]> {
	const cache = await openEpisodes();
	if (!cache) return [];
	const out: EpisodeMarker[] = [];
	for (const req of await cache.keys()) {
		if (!parseEpisodeMarker(new URL(req.url).pathname)) continue;
		const res = await cache.match(req);
		if (res) out.push((await res.json()) as EpisodeMarker);
	}
	return out;
}

const episodeFiles = (entryId: number) => [
	`/api/anime/episode/${entryId}/videos`,
	`/read/${entryId}`,
	`/read/${entryId}/__data.json`
];

/**
 * Keep one downloaded episode on the device: its file (streamed into the
 * cache, never into memory), its subtitles, the answer the player asks for
 * (which names the file), and the player's page. The marker goes last, so a
 * half-kept episode is never counted.
 */
export async function cacheEpisode(seriesId: number, entryId: number): Promise<boolean> {
	const cache = await openEpisodes();
	if (!cache || inFlight.has(entryId)) return false;
	inFlight.add(entryId);
	try {
		if (await cache.match(episodeMarkerPath(seriesId, entryId))) return true;
		const videos = await fetch(`/api/anime/episode/${entryId}/videos`, {
			credentials: 'same-origin'
		});
		if (!videos.ok) return false;
		const answer = (await videos.clone().json()) as {
			servers: { name: string; qualities: { src: string; subtitles: { src: string }[] }[] }[];
		};
		const local = answer.servers.find((s) => s.name === 'DOWNLOADED')?.qualities[0];
		// Only a downloaded episode is kept: a stream can't be.
		if (!local) return false;
		const file = await fetch(local.src, { credentials: 'same-origin' });
		if (!file.ok) return false;
		const bytes = Number(file.headers.get('content-length') ?? 0);
		await cache.put(local.src, file);
		for (const t of local.subtitles) {
			const r = await fetch(t.src, { credentials: 'same-origin' });
			if (r.ok) await cache.put(t.src, r);
		}
		await cache.put(`/api/anime/episode/${entryId}/videos`, videos);
		for (const url of episodeFiles(entryId).slice(1)) {
			const r = await fetch(url, { credentials: 'same-origin' });
			if (r.ok) await cache.put(url, r);
		}
		const m: EpisodeMarker = {
			seriesId,
			entryId,
			at: Date.now(),
			bytes,
			subtitles: local.subtitles.length
		};
		await cache.put(
			episodeMarkerPath(seriesId, entryId),
			new Response(JSON.stringify(m), { headers: { 'content-type': 'application/json' } })
		);
		return true;
	} catch {
		return false;
	} finally {
		inFlight.delete(entryId);
	}
}

export async function dropEpisode(entryId: number): Promise<void> {
	const cache = await openEpisodes();
	if (!cache) return;
	for (const req of await cache.keys()) {
		const path = new URL(req.url).pathname;
		const marker = parseEpisodeMarker(path);
		if (
			(marker && marker.entryId === entryId) ||
			path === `/api/anime/file/${entryId}` ||
			path.startsWith(`/api/anime/file/${entryId}/`) ||
			episodeFiles(entryId).includes(path)
		)
			await cache.delete(req);
	}
}

/**
 * While an episode plays (Anime Calls 01, default 5): keep the next one if
 * it's downloaded, let this series' watched ones go, and keep the episodes'
 * bucket under its own budget. Never for a hidden series, while reveal is
 * on, or incognito: the caller doesn't ask then.
 */
export async function keepEpisodesAhead(
	seriesId: number,
	entries: EntryRef[],
	currentId: number
): Promise<void> {
	if (!offline.online) return;
	const keep = keepEpisodes(entries, currentId);
	const watched = new Set(entries.filter((e) => e.readAt !== null).map((e) => e.id));
	for (const c of await listCachedEpisodes())
		if (c.seriesId === seriesId && watched.has(c.entryId) && !keep.includes(c.entryId))
			await dropEpisode(c.entryId);
	for (const id of keep) await cacheEpisode(seriesId, id);
	for (const id of evict(await listCachedEpisodes(), keep, EPISODE_BUDGET_BYTES))
		await dropEpisode(id);
	await offline.refresh();
}
