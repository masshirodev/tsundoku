import { describe, expect, it } from 'vitest';
import {
	BIT_TOLERANCE,
	agreedSpan,
	ENDING_SHIFT_S,
	INTRO_SHIFT_S,
	MAX_GAP_S,
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

	it('finds an ending 70 s apart, and a narrow shift sees only what overlaps', () => {
		const shared = unique(3000, 90 * POINT_HZ);
		const a = print([...unique(1, 20 * POINT_HZ), ...shared, ...unique(2, 70 * POINT_HZ)]);
		const b = print([...unique(3, 90 * POINT_HZ), ...shared, ...unique(4, 20 * POINT_HZ)]);
		// 70 s apart: inside an ending's 180 s, and an opening's whole window
		// since c384 (it was 30 s, which is how a cold open lost the opening).
		expect(ENDING_SHIFT_S).toBeGreaterThan(70);
		expect(INTRO_SHIFT_S).toBeGreaterThanOrEqual(regions(1440)!.intro.seconds);
		expect(sharedEnding(a, b)?.seconds).toBeCloseTo(90, 5);
		// The bound is still a bound: 30 s of shift sees only the 50 s the songs overlap by.
		const near = longestSharedRun(a, b, { minS: 15, maxS: 120, maxShiftS: 30 });
		expect(near?.seconds ?? 0).toBeLessThan(60);
	});

	it('returns null with nothing shared', () => {
		expect(
			sharedEnding(print(unique(1, 300 * POINT_HZ)), print(unique(9, 300 * POINT_HZ)))
		).toBeNull();
	});
});

// The owner's Ranma ½ (2024), 2026-11-03: every opening the fingerprint
// found was a third to a half of the song, and where it starts moved by 52 s
// between episodes with their cold opens.
describe('a whole opening, not a fragment of it', () => {
	/** Flips enough bits that the point is past BIT_TOLERANCE: a point of noise. */
	const spoil = (v: number) => (v ^ 0x00ff00ff) >>> 0;

	it('bridges a bad point every few seconds: a 90 s opening comes back whole', () => {
		const song = unique(5000, 90 * POINT_HZ);
		// One point in 24 (every 3 s) is noise in the second encode, as a 360p
		// stream's audio gives against a file's.
		const heard = song.map((v, i) => (i % 24 === 11 ? spoil(v) : v));
		const a = print([...unique(11, 30 * POINT_HZ), ...song, ...unique(12, 120 * POINT_HZ)]);
		const b = print([...unique(13, 30 * POINT_HZ), ...heard, ...unique(14, 120 * POINT_HZ)]);
		const found = sharedIntro(a, b)!;
		expect(found.seconds).toBeCloseTo(90, 5);
		expect(found.a).toEqual({ start: 30, end: 120 });
		expect(found.b).toEqual({ start: 30, end: 120 });
	});

	it('finds two openings 55 s apart, as a long cold open puts them', () => {
		const song = unique(6000, 90 * POINT_HZ);
		// Episode 7's opening at 30.75 s against episode 6's at 83.1 s, rounded to the grid.
		const a = print([...unique(21, 30 * POINT_HZ), ...song, ...unique(22, 200 * POINT_HZ)]);
		const b = print([...unique(23, 85 * POINT_HZ), ...song, ...unique(24, 145 * POINT_HZ)]);
		const found = sharedIntro(a, b)!;
		expect(found.seconds).toBeCloseTo(90, 5);
		expect(found.a).toEqual({ start: 30, end: 120 });
		expect(found.b).toEqual({ start: 85, end: 175 });
	});

	it('does not bridge a gap longer than MAX_GAP_S: two songs stay two', () => {
		const first = unique(7000, 40 * POINT_HZ);
		const second = unique(7001, 30 * POINT_HZ);
		// 5 s of difference between them, and then 3 s: Intro Skipper's 3.5 s lies between.
		expect(MAX_GAP_S).toBeGreaterThan(3);
		expect(MAX_GAP_S).toBeLessThan(5);
		const gapA = unique(31, 5 * POINT_HZ);
		const gapB = unique(32, gapA.length);
		const a = print([
			...unique(33, 20 * POINT_HZ),
			...first,
			...gapA,
			...second,
			...unique(34, 60 * POINT_HZ)
		]);
		const b = print([
			...unique(35, 20 * POINT_HZ),
			...first,
			...gapB,
			...second,
			...unique(36, 60 * POINT_HZ)
		]);
		expect(sharedIntro(a, b)?.seconds).toBeCloseTo(40, 5);
		// A gap inside the bound is bridged, and counts toward the run.
		const near = unique(37, 3 * POINT_HZ);
		const nearB = unique(38, near.length);
		const c = print([
			...unique(33, 20 * POINT_HZ),
			...first,
			...near,
			...second,
			...unique(34, 60 * POINT_HZ)
		]);
		const d = print([
			...unique(35, 20 * POINT_HZ),
			...first,
			...nearB,
			...second,
			...unique(36, 60 * POINT_HZ)
		]);
		expect(sharedIntro(c, d)?.seconds).toBeCloseTo(73, 5);
	});

	it('does not chain chance: streaks too sparse to be one song are not a run', () => {
		// A third of the points match, in streaks of four with eight between:
		// every gap is bridgeable, and 60 s of it is still not an opening.
		const base = unique(9000, 60 * POINT_HZ);
		const other = base.map((v, i) => (i % 12 < 4 ? v : spoil(v)));
		const a = print([...unique(51, 20 * POINT_HZ), ...base, ...unique(52, 60 * POINT_HZ)]);
		const b = print([...unique(53, 20 * POINT_HZ), ...other, ...unique(54, 60 * POINT_HZ)]);
		expect(sharedIntro(a, b)).toBeNull();
	});

	it('ends a run on its last streak, not on a lone point that matched by chance', () => {
		const song = unique(9100, 30 * POINT_HZ);
		const afterA = unique(55, 40 * POINT_HZ);
		// One point 2 s after the song happens to match: within MAX_GAP_S, but alone.
		const afterB = unique(56, 40 * POINT_HZ);
		afterB[16] = afterA[16];
		const a = print([...unique(57, 20 * POINT_HZ), ...song, ...afterA]);
		const b = print([...unique(58, 20 * POINT_HZ), ...song, ...afterB]);
		expect(sharedIntro(a, b)!.a).toEqual({ start: 20, end: 50 });
	});

	it('bridges an ending’s bad points the same way', () => {
		const song = unique(8000, 85 * POINT_HZ);
		const heard = song.map((v, i) => (i % 20 === 7 ? spoil(v) : v));
		const a: Fingerprint = {
			...print([...unique(41, 40 * POINT_HZ), ...song, ...unique(42, 115 * POINT_HZ)]),
			start: 1200
		};
		const b: Fingerprint = {
			...print([...unique(43, 100 * POINT_HZ), ...heard, ...unique(44, 55 * POINT_HZ)]),
			start: 1180
		};
		const found = sharedEnding(a, b)!;
		expect(found.seconds).toBeCloseTo(85, 5);
		expect(found.a).toEqual({ start: 1240, end: 1325 });
		expect(found.b).toEqual({ start: 1280, end: 1365 });
	});
});

describe('the span an episode keeps of its pairs’', () => {
	const at = (start: number, end: number) => ({ span: { start, end }, seconds: end - start });

	it('takes the one most pairs agree on over a longer one only one pair found', () => {
		// Three pairs: two land on the opening at 83 s, one on a longer chance run.
		const opening = at(83, 173);
		expect(agreedSpan([at(300, 410), opening, at(85, 170)])).toEqual(opening);
	});

	it('takes the longest of those that agree, and the longest when none do', () => {
		expect(agreedSpan([at(83, 131.5), at(83, 173), at(90, 160)])).toEqual(at(83, 173));
		expect(agreedSpan([at(10, 40), at(100, 160)])).toEqual(at(100, 160));
		expect(agreedSpan([at(10, 40)])).toEqual(at(10, 40));
		expect(agreedSpan([])).toBeNull();
	});
});
