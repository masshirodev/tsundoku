/**
 * FULL SCREEN in the readers (doc/READER.md, "Full screen"): the browser's
 * bars gone while reading. A phone over home Wi-Fi gets plain http, where a
 * browser won't install tsundoku as an app (doc/WIFI.md), so this is how it
 * loses the browser's frame (the owner, 2026-10-30). Android's browsers do
 * it over http; an iPhone's Safari can't (only for video), and there the
 * control isn't offered. Nor in an installed app, which is full screen already.
 */
class Fullscreen {
	on = $state(false);
	/** The browser can, and isn't already an app's window. */
	available = $state(false);

	constructor() {
		if (typeof document === 'undefined') return;
		// After hydration, not during it: the server can't know, and drew no control.
		setTimeout(() => {
			this.available =
				document.fullscreenEnabled &&
				!matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
			this.on = !!document.fullscreenElement;
		});
		document.addEventListener('fullscreenchange', () => {
			this.on = !!document.fullscreenElement;
		});
	}

	async toggle() {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
		} catch {
			// Refused (not from a tap, or the browser's own rule): nothing changes.
		}
	}
}

export const fullscreen = new Fullscreen();
