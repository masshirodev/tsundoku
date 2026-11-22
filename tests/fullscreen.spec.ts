import { describe, expect, it } from 'vitest';
import { fullscreenOffered } from '$lib/reader/fullscreen.svelte';

// FULL in the readers and the player (doc/READER.md, "Full screen";
// doc/ANIME.md, "Portrait"): offered where the browser can take its bars away,
// and only there. An installed app is the screen already, and so is
// tsundoku's own Android app: there is no browser frame to take away, and a
// fullscreen element there only swaps the page for a black picture
// (doc/ANDROID.md, "A fullscreen picture").

const plain = { enabled: true, userAgent: 'Mozilla/5.0 (Linux; Android 14)', installed: false };

describe('fullscreenOffered', () => {
	it('is offered in a browser that can take its bars away', () => {
		expect(fullscreenOffered(plain)).toBe(true);
	});

	it("is not offered where document.fullscreenEnabled is false (an iPhone's Safari)", () => {
		expect(fullscreenOffered({ ...plain, enabled: false })).toBe(false);
	});

	it('is not offered in an installed app, which is full screen already', () => {
		expect(fullscreenOffered({ ...plain, installed: true })).toBe(false);
	});

	it("is not offered in tsundoku's own Android app, phone or TV", () => {
		expect(
			fullscreenOffered({
				...plain,
				userAgent: 'Mozilla/5.0 (Linux; Android 14) TsundokuApp/2026.11.12'
			})
		).toBe(false);
		expect(
			fullscreenOffered({
				...plain,
				userAgent: 'Mozilla/5.0 (Linux; Android 14) TsundokuTV/2026.11.12'
			})
		).toBe(false);
	});
});
