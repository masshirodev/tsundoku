import { browser } from '$app/environment';

/**
 * Whether the tablet has the network, and which series have chapters cached
 * on it.
 *
 * The cache is the Cache Storage bucket the reader will fill when it saves the
 * next chapters for offline reading (doc/ARCHITECTURE.md, phase 1 and 4). The
 * reader does not exist yet, so the bucket is always empty and every series
 * honestly reports nothing cached. The screen's offline state is fully drawn
 * against that; it simply has nothing to show as available.
 */
export const CACHE_NAME = 'tsundoku-entries';

class OfflineState {
	online = $state(true);
	/**
	 * Series id -> cached entry count. A plain record replaced wholesale on
	 * refresh, never mutated in place, so it needs no reactive collection.
	 */
	cached = $state<Record<number, number>>({});

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
			for (const request of await cache.keys()) {
				const match = /\/series\/(\d+)\//.exec(new URL(request.url).pathname);
				if (match) counts[Number(match[1])] = (counts[Number(match[1])] ?? 0) + 1;
			}
			this.cached = counts;
		} catch {
			// No cache access (private window, insecure context): nothing is cached.
		}
	}
}

export const offline = new OfflineState();
