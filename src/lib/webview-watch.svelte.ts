import { resolve } from '$app/paths';
import type { WebViewView } from '$lib/server/engine/webview';

/**
 * Asks how the engine's WebView is (`/api/browse/webview`) every couple of
 * seconds while a screen has something to say about it: EXTENSIONS after a
 * WebView extension was installed, a WebView source's page while it waits or
 * after a call failed for want of the browser, and SETTINGS' WEBVIEW row
 * while it changes (doc/EXTENSION-ENGINE.md, "WebView support"). Like
 * `SiteCheck`, it says nothing until the engine answers, and a failed ask
 * leaves the last answer standing.
 */
export class WebViewWatch {
	view = $state<WebViewView | null>(null);
	#timer: ReturnType<typeof setInterval> | null = null;

	start(everyMs = 2_000): void {
		this.stop();
		const url = resolve('/api/browse/webview');
		const tick = async () => {
			try {
				const res = await fetch(url, { cache: 'no-store' });
				if (res.ok) this.view = (await res.json()) as WebViewView;
			} catch {
				// Not answering: the last answer stands until the next tick.
			}
		};
		void tick();
		this.#timer = setInterval(() => void tick(), everyMs);
	}

	stop(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}
}
