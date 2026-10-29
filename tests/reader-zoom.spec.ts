import { describe, expect, it } from 'vitest';
import {
	clampZoom,
	keptZoom,
	pinchZoom,
	resetZoom,
	screenClass,
	stepZoom,
	zoomKey,
	zoomLabel
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
