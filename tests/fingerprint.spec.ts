import { describe, expect, it } from 'vitest';
import {
	BIT_TOLERANCE,
	ENDING_SHIFT_S,
	INTRO_SHIFT_S,
	POINT_HZ,
	closeEnough,
	longestSharedRun,
	normalise,
	popcount,
	regions,
	sharedEnding,
	sharedIntro,
	type Fingerprint
} from '$lib/library/fingerprint';

// Comparing two episodes' fingerprints (doc/ANIME.md, "Openings and
// endings"; card c239). Synthetic points stand in for chromaprint's, so the
// matcher can be asked about runs, bit errors and bounds without a video.

const print = (values: number[]): Fingerprint => ({
	points: Uint32Array.from(values),
	seconds: values.length / POINT_HZ
});
// A seeded PRNG, not a linear one: two seeds' points must not differ by a
// constant, or every shifted pair would look like the same music.
const unique = (seed: number, n: number) => {
	let s = seed >>> 0;
	return Array.from({ length: n }, () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = Math.imul(s ^ (s >>> 15), s | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (t ^ (t >>> 14)) >>> 0;
	});
};

describe('fingerprint points', () => {
	it('counts the bits two points differ by, and tolerates a few', () => {
		expect(popcount(0)).toBe(0);
		expect(popcount(0xffffffff)).toBe(32);
		expect(popcount(0b1011)).toBe(3);
		expect(closeEnough(0b1010, 0b1010)).toBe(true);
		expect(closeEnough(0b1010, 0b1011)).toBe(true);
		expect(closeEnough(0, 0b1111111, BIT_TOLERANCE)).toBe(false);
		expect(closeEnough(0, 0b111111, BIT_TOLERANCE)).toBe(true);
	});

	it('resamples a print onto the common 8-a-second grid', () => {
		const p: Fingerprint = { points: Uint32Array.from([1, 2, 3, 4]), seconds: 8 };
		const n = normalise(p);
		expect(n.length).toBe(64);
		// The source's four points are stretched evenly across eight seconds.
		expect([n[0], n[16], n[32], n[63]]).toEqual([1, 2, 3, 4]);
		expect(normalise({ points: new Uint32Array(), seconds: 8 }).length).toBe(0);
	});

	it('reads the two windows a fingerprint is taken from', () => {
		expect(regions(1440)).toEqual({
			intro: { start: 0, seconds: 360 },
			ending: { start: 1200, seconds: 240 }
		});
		// A first half-hour is the cap, not three quarters of a film.
		expect(regions(3600)!.intro).toEqual({ start: 0, seconds: 600 });
		expect(regions(100)).toEqual({
			intro: { start: 0, seconds: 25 },
			ending: { start: 0, seconds: 100 }
		});
		expect(regions(0)).toBeNull();
	});
});

describe('the run two episodes share', () => {
	it('finds a shared opening, at the times each episode has it', () => {
		const shared = unique(1000, 30 * POINT_HZ);
		const a = print([...unique(1, 10 * POINT_HZ), ...shared, ...unique(2, 20 * POINT_HZ)]);
		const b = print([...unique(3, 5 * POINT_HZ), ...shared, ...unique(4, 15 * POINT_HZ)]);
		const found = sharedIntro(a, b)!;
		expect(found.seconds).toBeCloseTo(30, 5);
		expect(found.a).toEqual({ start: 10, end: 40 });
		expect(found.b).toEqual({ start: 5, end: 35 });
	});

	it('still matches when a few bits of a point are noise', () => {
		const shared = unique(1000, 30 * POINT_HZ);
		const noisy = shared.map((v, i) => (i % 37 === 0 ? (v ^ 0b111) >>> 0 : v));
		const a = print([...unique(1, 10 * POINT_HZ), ...shared, ...unique(2, 20 * POINT_HZ)]);
		const b = print([...unique(3, 5 * POINT_HZ), ...noisy, ...unique(4, 15 * POINT_HZ)]);
		expect(sharedIntro(a, b)?.seconds).toBeCloseTo(30, 5);
	});

	it('ignores a run too short to be an opening, and one too long', () => {
		const short = unique(1000, 10 * POINT_HZ);
		expect(
			sharedIntro(
				print([...unique(1, 10 * POINT_HZ), ...short, ...unique(2, 20 * POINT_HZ)]),
				print([...unique(3, 5 * POINT_HZ), ...short, ...unique(4, 15 * POINT_HZ)])
			)
		).toBeNull();
		const long = unique(2000, 150 * POINT_HZ);
		expect(
			sharedIntro(
				print([...unique(1, 10 * POINT_HZ), ...long, ...unique(2, 20 * POINT_HZ)]),
				print([...unique(3, 5 * POINT_HZ), ...long, ...unique(4, 15 * POINT_HZ)])
			)
		).toBeNull();
	});

	it('finds an ending with a wider shift than an opening allows', () => {
		const shared = unique(3000, 90 * POINT_HZ);
		const a = print([...unique(1, 20 * POINT_HZ), ...shared, ...unique(2, 70 * POINT_HZ)]);
		const b = print([...unique(3, 90 * POINT_HZ), ...shared, ...unique(4, 20 * POINT_HZ)]);
		// 70 s apart: far past an opening's 30 s, inside an ending's 180 s.
		expect(INTRO_SHIFT_S).toBeLessThan(70);
		expect(ENDING_SHIFT_S).toBeGreaterThan(70);
		expect(sharedEnding(a, b)?.seconds).toBeCloseTo(90, 5);
		// An intro's narrow shift sees only the 50 s the endings overlap by.
		const near = longestSharedRun(a, b, {
			minS: 15,
			maxS: 120,
			maxShiftS: INTRO_SHIFT_S
		});
		expect(near?.seconds ?? 0).toBeLessThan(60);
	});

	it('returns null with nothing shared', () => {
		expect(
			sharedEnding(print(unique(1, 300 * POINT_HZ)), print(unique(9, 300 * POINT_HZ)))
		).toBeNull();
	});
});
