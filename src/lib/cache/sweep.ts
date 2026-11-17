import { resolve } from '$app/paths';
import { CACHE_NAME, offline } from '$lib/offline.svelte';
import { EPISODE_CACHE } from './device';
import { parseEpisodeMarker, parseMarker } from './policy';

/**
 * Hiding takes a series off the device (doc/OFFLINE.md). Nothing is cached
 * for a hidden series, but what was cached before it was hidden stays, and
 * the service worker serves page images and a novel's EPUB cache-first, and
 * the last copy of a screen whenever the workstation can't be reached. So a
 * series hidden after it was read would still open from the tablet, offline,
 * with reveal off.
 *
 * The sweep asks the workstation which of the series and entries the caches
 * hold may no longer be kept (`/api/cache/gone`), and drops them. Asking,
 * rather than having each HIDE drop its own, covers every way a series is
 * hidden (the series screen, a Work, the library's and search's SELECT, a
 * root) and a series hidden from another device.
 */

/** The service worker's last copies of screens (src/service-worker.ts, `SCREENS`). */
export const SCREENS_CACHE = 'tsundoku-screens';

export type Held = { series: number[]; entries: number[] };

async function bucket(name: string): Promise<Cache | null> {
	if (!('caches' in globalThis)) return null;
	try {
		return (await caches.has(name)) ? await caches.open(name) : null;
	} catch {
		return null;
	}
}

const ENTRY_PATHS = [
	/^\/api\/entries\/(\d+)\//,
	/^\/read\/(\d+)(\/|$)/,
	/^\/api\/anime\/episode\/(\d+)\//,
	/^\/api\/anime\/file\/(\d+)(\/|$)/
];
const SERIES_PATHS = [/^\/api\/series\/(\d+)\/epub$/, /^\/series\/(\d+)(\/|$)/];

/** The ids a cached URL belongs to, read off its path. */
export function idsInPath(path: string): { series?: number; entry?: number } {
	const m = parseMarker(path) ?? parseEpisodeMarker(path);
	if (m) return { series: m.seriesId, entry: m.entryId };
	for (const re of ENTRY_PATHS) {
		const hit = re.exec(path);
		if (hit) return { entry: Number(hit[1]) };
	}
	for (const re of SERIES_PATHS) {
		const hit = re.exec(path);
		if (hit) return { series: Number(hit[1]) };
	}
	return {};
}

const pathOf = (req: Request) => new URL(req.url).pathname;

/** Every series and entry the device's caches hold anything of. */
export async function heldOnDevice(): Promise<Held> {
	const series = new Set<number>();
	const entries = new Set<number>();
	for (const name of [CACHE_NAME, EPISODE_CACHE, SCREENS_CACHE]) {
		const cache = await bucket(name);
		if (!cache) continue;
		for (const req of await cache.keys()) {
			const ids = idsInPath(pathOf(req));
			if (ids.series !== undefined) series.add(ids.series);
			if (ids.entry !== undefined) entries.add(ids.entry);
		}
	}
	return { series: [...series], entries: [...entries] };
}

/** Drop everything the device keeps of these series and entries. */
export async function forget(gone: Held): Promise<void> {
	if (!gone.series.length && !gone.entries.length) return;
	const series = new Set(gone.series);
	const entries = new Set(gone.entries);
	const buckets = (await Promise.all([CACHE_NAME, EPISODE_CACHE].map(bucket))).filter(
		(c): c is Cache => c !== null
	);
	// A gone series takes every entry its markers name, half-kept ones aside:
	// those have no marker, and the device names them by entry id instead.
	for (const cache of buckets)
		for (const req of await cache.keys()) {
			const ids = idsInPath(pathOf(req));
			if (ids.series !== undefined && ids.entry !== undefined && series.has(ids.series))
				entries.add(ids.entry);
		}
	// Then one pass over each bucket: pages, manifests, text, reader pages,
	// episode files and subtitles, EPUBs and markers alike.
	for (const cache of buckets)
		for (const req of await cache.keys()) {
			const ids = idsInPath(pathOf(req));
			if (
				(ids.entry !== undefined && entries.has(ids.entry)) ||
				(ids.series !== undefined && series.has(ids.series))
			)
				await cache.delete(req);
		}
	// Every screen copy goes, not only the series' own: the library, CONTINUE,
	// HISTORY and search copies name a series too, and nothing in a copy says
	// which. They are only the offline fallback, and the next screen opened
	// online is kept again.
	if ('caches' in globalThis) await caches.delete(SCREENS_CACHE).catch(() => false);
	await offline.refresh();
}

/** Ask the workstation what to let go, and let it go. Answers how many ids went. */
export async function sweepHidden(fetcher: typeof fetch = fetch): Promise<number> {
	const held = await heldOnDevice();
	if (!held.series.length && !held.entries.length) return 0;
	let gone: Held;
	try {
		const res = await fetcher(resolve('/api/cache/gone'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(held)
		});
		if (!res.ok) return 0;
		gone = (await res.json()) as Held;
	} catch {
		// The workstation can't be reached: nothing can have been hidden from here.
		return 0;
	}
	await forget(gone);
	return gone.series.length + gone.entries.length;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * A sweep shortly after the last call: the layout calls it on opening and on
 * every screen change, and a burst of those (a redirect after HIDE, a reader
 * moving between chapters) asks the workstation once.
 */
export function sweepSoon(ms = 1500): void {
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => {
		timer = null;
		void sweepHidden().catch(() => {});
	}, ms);
}
