import { describe, expect, it } from 'vitest';
import { croppedSize, insetOf, NO_INSET, viewBox } from '$lib/reader/crop';

describe('crop borders', () => {
	it('crops the margins a trim found, as fractions of the page', () => {
		expect(insetOf({ width: 300, height: 426, x: 15, y: 21, w: 270, h: 384 })).toEqual([
			0.049, 0.05, 0.049, 0.05
		]);
	});

	it('leaves a page alone when the margins are slight, or the art mostly blank', () => {
		expect(insetOf({ width: 300, height: 400, x: 1, y: 2, w: 298, h: 396 })).toEqual(NO_INSET);
		// A lone figure on white: cropping would keep 30% of the width.
		expect(insetOf({ width: 300, height: 400, x: 100, y: 0, w: 90, h: 400 })).toEqual(NO_INSET);
	});

	it('keeps the rest when only one side has a margin', () => {
		expect(insetOf({ width: 300, height: 400, x: 0, y: 40, w: 300, h: 360 })).toEqual([
			0.1, 0, 0, 0
		]);
	});

	it('sizes the box to what is left, and says it in CSS', () => {
		const size = croppedSize(800, 1000, [0.1, 0.05, 0.1, 0.05]);
		expect(size.w).toBeCloseTo(720);
		expect(size.h).toBeCloseTo(800);
		expect(viewBox([0.1, 0.05, 0.1, 0.05])).toBe('inset(10% 5% 10% 5%)');
		expect(viewBox(NO_INSET)).toBeUndefined();
		expect(viewBox(null)).toBeUndefined();
	});
});
