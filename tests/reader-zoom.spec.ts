import { describe, expect, it } from 'vitest';
import {
	clampZoom,
	keptZoom,
	pinchZoom,
	resetZoom,
	screenClass,
	showsDouble,
	stepZoom,
	zoomKey,
	zoomLabel,
	DoubleTap,
	DOUBLE_TAP_MS,
	DOUBLE_TAP_PX,
	doubleTapZoom,
	fractionOn,
	keepUnder,
	ZOOM_MAX,
	ZOOM_MIN,
	ZOOM_STEPS
} from '$lib/reader/zoom';

// Zoom in the image reader (doc/READER.md, "Zoom").
describe('zoom', () => {
	it('steps through round numbers from wherever a pinch left it, within 20%–500%', () => {
		expect(stepZoom(1, 1)).toBe(1.25);
		expect(stepZoom(1, -1)).toBe(0.75);
		expect(stepZoom(1.33, 1)).toBe(1.5);
		expect(stepZoom(1.33, -1)).toBe(1.25);
		expect(stepZoom(0.3, -1)).toBe(0.25);
		expect(stepZoom(0.3, 1)).toBe(0.33);
		expect(stepZoom(3.5, 1)).toBe(4);
		expect(stepZoom(3.5, -1)).toBe(3);
		expect(clampZoom(Number.NaN)).toBe(1);
		expect(pinchZoom(1, 100, 150)).toBe(1.5);
		expect(pinchZoom(1, 0, 150)).toBe(1);
		expect(zoomLabel(1.25)).toBe('125%');
	});

	// The step list is a finite domain: all of it, both ways, both ends.
	it('walks the whole list up from 20% and down from 500%, and stops at each end', () => {
		const list = [0.2, 0.25, 0.33, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
		expect([...ZOOM_STEPS]).toEqual(list);
		expect([ZOOM_MIN, ZOOM_MAX]).toEqual([0.2, 5]);
		const walk = (from: number, dir: 1 | -1) => {
			const seen = [from];
			for (let z = from, i = 0; i < 40; i++) {
				const next = stepZoom(z, dir);
				if (next === z) break;
				seen.push((z = next));
			}
			return seen;
		};
		expect(walk(ZOOM_MIN, 1)).toEqual(list);
		expect(walk(ZOOM_MAX, -1)).toEqual([...list].reverse());
		expect(stepZoom(5, 1)).toBe(5);
		expect(stepZoom(0.2, -1)).toBe(0.2);
		// Every step is its own clamp, and reads back as kept.
		for (const z of list) {
			expect(clampZoom(z)).toBe(z);
			expect(keptZoom(z)).toBe(z);
		}
		expect(list.map(zoomLabel)).toEqual([
			'20%',
			'25%',
			'33%',
			'50%',
			'75%',
			'100%',
			'125%',
			'150%',
			'175%',
			'200%',
			'250%',
			'300%',
			'400%',
			'500%'
		]);
	});

	it('clamps a pinch and Ctrl + wheel to 20%–500%, and moves freely inside it', () => {
		expect(clampZoom(9)).toBe(5);
		expect(clampZoom(5.004)).toBe(5);
		expect(clampZoom(0.1)).toBe(0.2);
		expect(clampZoom(0)).toBe(0.2);
		expect(clampZoom(-3)).toBe(0.2);
		expect(clampZoom(0.37)).toBe(0.37);
		expect(clampZoom(4.6)).toBe(4.6);
		// A pinch from 50% closing to two fifths of the spread lands on 20%, and no lower.
		expect(pinchZoom(0.5, 100, 40)).toBe(0.2);
		expect(pinchZoom(0.5, 100, 20)).toBe(0.2);
		expect(pinchZoom(2, 100, 300)).toBe(5);
		expect(pinchZoom(1, 100, 37)).toBe(0.37);
	});

	it('reads back a zoom saved anywhere in the range, and one saved under 50%–300% unchanged', () => {
		expect(keptZoom(0.2)).toBe(0.2);
		expect(keptZoom(0.3)).toBe(0.3);
		expect(keptZoom(5)).toBe(5);
		expect(keptZoom(0.19)).toBeNull();
		expect(keptZoom(5.01)).toBeNull();
		// The old range's values, its steps and a pinch's in between: none migrates.
		for (const z of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 0.62, 2.37])
			expect(keptZoom(z)).toBe(z);
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

	it('keeps a double page’s zoom apart, per screen class (the owner, 2026-11-11)', () => {
		expect(zoomKey('double', screenClass(1440))).toBe('zoom.double.wide');
		expect(zoomKey('double', screenClass(390))).toBe('zoom.double.phone');
	});

	it('reads the double zoom only for one wide page shown whole on a paged screen', () => {
		const base = { vertical: false, pages: 1, wide: true, whole: true };
		expect(showsDouble(base)).toBe(true);
		// A single page, the strip, a spread of two, or a wide page split or turned: the page's zoom.
		expect(showsDouble({ ...base, wide: false })).toBe(false);
		expect(showsDouble({ ...base, vertical: true })).toBe(false);
		expect(showsDouble({ ...base, pages: 2 })).toBe(false);
		expect(showsDouble({ ...base, whole: false })).toBe(false);
	});
});

describe('double tap', () => {
	it('goes to 100% from either side, and to 200% from 100%', () => {
		expect(doubleTapZoom(0.2)).toBe(1);
		expect(doubleTapZoom(0.5)).toBe(1);
		expect(doubleTapZoom(0.75)).toBe(1);
		expect(doubleTapZoom(1)).toBe(2);
		expect(doubleTapZoom(1.25)).toBe(1);
		expect(doubleTapZoom(3)).toBe(1);
		expect(doubleTapZoom(5)).toBe(1);
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
