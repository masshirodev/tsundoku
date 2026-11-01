import { describe, expect, it } from 'vitest';
import { frameAt, isBlankFrame } from '$lib/library/episode-pictures';

// Where a frame of an episode is taken, and which frames don't count
// (doc/ANIME.md, "Episode pictures"; card c225).
describe('a frame of an episode', () => {
	it('is taken a quarter in, then further on when that one is blank', () => {
		expect(frameAt(1440, 0)).toBe(360);
		expect(frameAt(1440, 1)).toBe(576);
		expect(frameAt(1440, 2)).toBe(864);
		expect(frameAt(1440, 3)).toBeNull();
		expect(frameAt(8, 0)).toBe(2);
	});

	it('is taken at seconds past an opening when the length is unknown', () => {
		expect(frameAt(null, 0)).toBe(150);
		expect(frameAt(0, 1)).toBe(300);
		expect(frameAt(null, -1)).toBeNull();
	});

	it('is blank when dark or flat, and kept otherwise', () => {
		const c = (mean: number, stdev: number) => [
			{ mean, stdev },
			{ mean, stdev },
			{ mean, stdev }
		];
		expect(isBlankFrame(c(4, 2))).toBe(true); // a fade to black
		expect(isBlankFrame(c(230, 3))).toBe(true); // a white card
		expect(isBlankFrame(c(110, 45))).toBe(false); // a scene
		expect(isBlankFrame(c(15, 30))).toBe(true); // a night too dark to read at 96px
		expect(isBlankFrame([])).toBe(true);
	});
});
