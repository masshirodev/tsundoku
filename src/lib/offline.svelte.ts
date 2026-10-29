import { browser } from '$app/environment';
import { parseEpisodeMarker, parseMarker } from '$lib/cache/policy';

/**
 * Whether the tablet has the network, and which series have chapters cached
 * on it.
 *
 * The cache is the Cache Storage bucket the reader fills with the next
 * chapters of whatever is open, and the series screen with ↓ CACHE
 * (doc/OFFLINE.md). The service worker serves it when the workstation can't
 * be reached.
 */
export const CACHE_NAME = 'tsundoku-entries';
/** An anime's episodes, a bucket of their own (doc/ANIME.md, "Offline"). */
const EPISODE_CACHE = 'tsundoku-episodes';

class OfflineState {
	online = $state(true);
	/**
	 * Series id -> cached entry count. A plain record replaced wholesale on
	 * refresh, never mutated in place, so it needs no reactive collection.
	 */
	cached = $state<Record<number, number>>({});
	/** Series id -> the entry ids cached, for the series screen's ↓ column. */
	entries = $state<Record<number, number[]>>({});

	constructor() {
		if (!browser) return;
		this.online = navigator.onLine;
		addEventListener('online', () => (this.online = true));
		addEventListener('offline', () => {
			this.online = false;
			void this.refresh();
		});
		void this.refresh();
	}

	async refresh(): Promise<void> {
		if (!browser || !('caches' in globalThis)) return;
		try {
			const cache = await caches.open(CACHE_NAME);
			const counts: Record<number, number> = {};
			const entries: Record<number, number[]> = {};
			// One marker per cached entry (src/lib/cache/policy.ts), written only
			// once all its pages are in: a half-cached entry isn't counted.
			for (const request of await cache.keys()) {
				const m = parseMarker(new URL(request.url).pathname);
				if (!m) continue;
				counts[m.seriesId] = (counts[m.seriesId] ?? 0) + 1;
				(entries[m.seriesId] ??= []).push(m.entryId);
			}
			// Episodes kept on the device count as cached entries of their series too.
			const episodes = await caches.open(EPISODE_CACHE);
			for (const request of await episodes.keys()) {
				const m = parseEpisodeMarker(new URL(request.url).pathname);
				if (!m) continue;
				counts[m.seriesId] = (counts[m.seriesId] ?? 0) + 1;
				(entries[m.seriesId] ??= []).push(m.entryId);
			}
			this.cached = counts;
			this.entries = entries;
		} catch {
			// No cache access (private window, insecure context): nothing is cached.
		}
	}
}

export const offline = new OfflineState();
