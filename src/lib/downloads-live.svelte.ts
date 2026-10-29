import { browser } from '$app/environment';
import { resolve } from '$app/paths';
import type { LiveMessage } from '$lib/server/downloads-watch';
import type { DownloadState } from '$lib/library/downloads';

/**
 * Live, but quiet (Download States, "Live, but quiet"; doc/DOWNLOADING.md):
 * only the chapter being downloaded moves, its row's bar and the queue's
 * band. Anything else that changes makes the screen read its data again,
 * and a row turns QUEUED → IMPORTING → plain without animation. Without
 * script none of this runs, and a screen is as of its last load.
 */
export const live = $state<{ downloading: LiveMessage['downloading'] }>({ downloading: null });

/**
 * Listen while a screen that shows the queue is open. `onchange` runs when
 * something other than the downloading chapter's progress moved, at most
 * every two seconds. Returns the way to stop.
 */
export function watchQueue(onchange: () => void): () => void {
	if (!browser || typeof EventSource === 'undefined') return () => {};
	const es = new EventSource(resolve('/api/downloads/events'));
	let base: string | null = null;
	let wait: ReturnType<typeof setTimeout> | null = null;
	es.onmessage = (e) => {
		const m = JSON.parse(e.data) as LiveMessage;
		live.downloading = m.downloading;
		if (base === null) base = m.version;
		else if (m.version !== base && !wait) {
			base = m.version;
			wait = setTimeout(() => {
				wait = null;
				onchange();
			}, 2000);
		}
	};
	return () => {
		es.close();
		if (wait) clearTimeout(wait);
		live.downloading = null;
	};
}

/** A row's state with the live progress folded in, when it's the chapter downloading. */
export function withLive(s: DownloadState | undefined): DownloadState | undefined {
	const d = live.downloading;
	if (s?.kind !== 'downloading' || !d || d.chapterId !== s.chapterId) return s;
	return { ...s, fraction: d.fraction, page: d.page, pages: d.pages || s.pages };
}
