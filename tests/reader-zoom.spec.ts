import { describe, expect, it } from 'vitest';
import {
	clampZoom,
	keptZoom,
	pinchZoom,
	resetZoom,
	screenClass,
	stepZoom,
	zoomKey,
	zoomLabel,
	DoubleTap,
	DOUBLE_TAP_MS,
	DOUBLE_TAP_PX,
	doubleTapZoom,
	fractionOn,
	keepUnder
} from '$lib/reader/zoom';

// Zoom in the image reader (doc/READER.md, "Zoom"; card c169).
describe('zoom', () => {
	it('steps through round numbers from wherever a pinch left it, within 50%–300%', () => {
		expect(stepZoom(1, 1)).toBe(1.25);
		expect(stepZoom(1, -1)).toBe(0.75);
		expect(stepZoom(1.33, 1)).toBe(1.5);
		expect(stepZoom(1.33, -1)).toBe(1.25);
		expect(stepZoom(3, 1)).toBe(3);
		expect(stepZoom(0.5, -1)).toBe(0.5);
		expect(clampZoom(9)).toBe(3);
		expect(clampZoom(0.1)).toBe(0.5);
		expect(clampZoom(Number.NaN)).toBe(1);
		expect(pinchZoom(1, 100, 150)).toBe(1.5);
		expect(pinchZoom(1, 0, 150)).toBe(1);
		expect(zoomLabel(1.25)).toBe('125%');
	});

	it('resets to the kept zoom first, then to 100%', () => {
		expect(resetZoom(2, 1.5)).toBe(1.5);
		expect(resetZoom(1.5, 1.5)).toBe(1);
		expect(resetZoom(1.5, 1)).toBe(1);
	});

	it('is kept per mode and per screen class, so a phone never overwrites the desktop', () => {
		expect(zoomKey('paged', screenClass(1440))).toBe('zoom.paged.wide');
		expect(zoomKey('vertical', screenClass(390))).toBe('zoom.vertical.phone');
		expect(screenClass(599)).toBe('phone');
		expect(screenClass(600)).toBe('wide');
		expect(keptZoom(1.5)).toBe(1.5);
		expect(keptZoom(7)).toBeNull();
		expect(keptZoom('1.5')).toBeNull();
	});
});

describe('double tap (c185)', () => {
	it('goes to 100% from either side, and to 200% from 100%', () => {
		expect(doubleTapZoom(0.5)).toBe(1);
		expect(doubleTapZoom(0.75)).toBe(1);
		expect(doubleTapZoom(1)).toBe(2);
		expect(doubleTapZoom(1.25)).toBe(1);
		expect(doubleTapZoom(3)).toBe(1);
	});

	it('is two taps close in time and place', () => {
		const d = new DoubleTap();
		expect(d.tap(100, 100, 0)).toBe('single');
		expect(d.tap(110, 105, DOUBLE_TAP_MS)).toBe('double');
		// A third starts over.
		expect(d.tap(110, 105, DOUBLE_TAP_MS + 50)).toBe('single');
	});

	it('is two single taps when too slow or too far apart', () => {
		const d = new DoubleTap();
		d.tap(100, 100, 0);
		expect(d.tap(100, 100, DOUBLE_TAP_MS + 1)).toBe('single');
		expect(d.tap(100 + DOUBLE_TAP_PX + 1, 100, DOUBLE_TAP_MS + 50)).toBe('single');
		d.reset();
		expect(d.tap(0, 0, 10_000)).toBe('single');
	});

	it('keeps the tapped point under the finger', () => {
		// A 400 × 600 page at (200, 100); a tap at (300, 250) is a quarter across, a quarter down.
		const at = fractionOn({ left: 200, top: 100, width: 400, height: 600 }, 300, 250);
		expect(at).toEqual({ fx: 0.25, fy: 0.25 });
		// Twice the size, grown from its top left: that point moved to (400, 400), so scroll by (100, 150).
		expect(
			keepUnder(at.fx, at.fy, { left: 200, top: 100, width: 800, height: 1200 }, 300, 250)
		).toEqual({
			dx: 100,
			dy: 150
		});
	});

	it('counts a tap in the margin from the page’s edge', () => {
		expect(fractionOn({ left: 100, top: 0, width: 200, height: 300 }, 20, 400)).toEqual({
			fx: 0,
			fy: 1
		});
	});
});
