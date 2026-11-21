import { describe, expect, it } from 'vitest';
import { fullscreenOffered } from '$lib/reader/fullscreen.svelte';

// FULL SCREEN in the readers (doc/READER.md, "Full screen"): offered where the
// browser can take the bars away, and only there. An installed app is the
// screen already, and in tsundoku's own Android app a fullscreen element
// swaps the page for a bare picture that turns with the phone (MainActivity,
// followPhoneForVideo), so reading there must not ask for it.

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
