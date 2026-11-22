import { isTsundokuApp } from '$lib/settings/catalog';

/**
 * FULL SCREEN in the readers (doc/READER.md, "Full screen") and FULL in the
 * player (doc/ANIME.md, "Portrait"): the browser's bars gone while the
 * picture is on the screen. A phone over home Wi-Fi gets plain http, where a
 * browser won't install tsundoku as an app (doc/WIFI.md), so this is how it
 * loses the browser's frame. Android's browsers do
 * it over http; an iPhone's Safari can't (only for video), and there the
 * control isn't offered.
 *
 * Nor in an installed app, which is full screen already — and not in
 * tsundoku's own Android app either (doc/ANDROID.md): its window is the
 * screen, so FULL has no frame to take away, and a fullscreen element there
 * is a bare picture the WebView swaps itself for, which only flashes black.
 */
export function fullscreenOffered(where: {
	/** `document.fullscreenEnabled`. */
	enabled: boolean;
	userAgent: string;
	/** `matchMedia('(display-mode: standalone), (display-mode: fullscreen)')`. */
	installed: boolean;
}): boolean {
	return where.enabled && !where.installed && !isTsundokuApp(where.userAgent);
}

class Fullscreen {
	on = $state(false);
	/** The browser can, and isn't already an app's window. */
	available = $state(false);

	constructor() {
		if (typeof document === 'undefined') return;
		// After hydration, not during it: the server can't know, and drew no control.
		setTimeout(() => {
			this.available = fullscreenOffered({
				enabled: document.fullscreenEnabled,
				userAgent: navigator.userAgent,
				installed: matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
			});
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
