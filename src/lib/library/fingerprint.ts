import type { Range } from './streams.ts';

/**
 * Fingerprints of episodes, the pure part (doc/ANIME.md, "Openings and
 * endings"; card c239). Two episodes of a season share their opening and
 * their ending, so a run of chromaprint points both have, at the same place
 * in time, is one of them. The fingerprinting itself is the server's; this
 * only compares points, which is what the specs can do without a video.
 *
 * Chromaprint turns a second of audio into about eight 32-bit points (the
 * exact rate depends on the tool, so a print carries its length). Two points
 * are the same music when at most `BIT_TOLERANCE` bits differ.
 */

/** The grid two prints are compared on: 8 points a second. */
export const POINT_HZ = 8;
/** Chromaprint's own advice: one bit of noise is common, six is still the same track. */
export const BIT_TOLERANCE = 6;

/** What is fingerprinted: the first quarter of an episode (a first half-hour cap), and its last four minutes. */
export const INTRO_FRACTION = 0.25;
export const INTRO_CAP_S = 10 * 60;
export const ENDING_WINDOW_S = 4 * 60;

/** The longest a shared run may be; a longer one is a recap, a film, or the whole episode. */
export const INTRO_MIN_S = 15;
export const INTRO_MAX_S = 120;
export const ENDING_MIN_S = 15;
export const ENDING_MAX_S = 180;

/** How far apart the same opening or ending may sit in two episodes, in seconds. */
export const INTRO_SHIFT_S = 30;
export const ENDING_SHIFT_S = 180;

export type Fingerprint = {
	/** Chromaprint's points, in order. */
	points: Uint32Array;
	/** How many seconds of audio they cover. */
	seconds: number;
	/**
	 * Where the fingerprinted window starts in its episode. A run is returned
	 * in the episode's own timeline, not the window's: an ending window starts
	 * at `duration - 4 min`, not at 0.
	 */
	start?: number;
};

export type SharedRun = {
	/** The run in the first print's own timeline. */
	a: Range;
	/** The same run in the second. */
	b: Range;
	seconds: number;
};

/** The two windows of an episode a fingerprint is taken from. */
export function regions(durationS: number): {
	intro: { start: number; seconds: number };
	ending: { start: number; seconds: number };
} | null {
	if (!Number.isFinite(durationS) || durationS <= 0) return null;
	const intro = Math.min(durationS * INTRO_FRACTION, INTRO_CAP_S);
	const endingStart = Math.max(0, durationS - ENDING_WINDOW_S);
	return {
		intro: { start: 0, seconds: intro },
		ending: { start: endingStart, seconds: durationS - endingStart }
	};
}

/** Bits set in a 32-bit point. */
export function popcount(x: number): number {
	let v = x >>> 0;
	v = v - ((v >>> 1) & 0x55555555);
	v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
	return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export const closeEnough = (a: number, b: number, tolerance = BIT_TOLERANCE): boolean =>
	popcount((a ^ b) >>> 0) <= tolerance;

/**
 * A print resampled to `POINT_HZ`, so two prints from tools with slightly
 * different rates can be compared point for point. Nearest point wins; a
 * shorter source print is stretched, which repeats points but keeps the
 * times right.
 */
export function normalise(p: Fingerprint): Uint32Array {
	if (!p.points.length || !(p.seconds > 0)) return new Uint32Array();
	const n = Math.max(1, Math.round(p.seconds * POINT_HZ));
	const out = new Uint32Array(n);
	const rate = p.points.length / p.seconds;
	for (let i = 0; i < n; i++) {
		const j = Math.min(p.points.length - 1, Math.max(0, Math.round((i / POINT_HZ) * rate)));
		out[i] = p.points[j];
	}
	return out;
}

/**
 * The longest run of points the two prints share, shifted by at most
 * `maxShiftS`, whose length is a sane opening or ending. Both are compared on
 * the normalised grid; a run is a stretch where every point matches within
 * `BIT_TOLERANCE`.
 *
 * The caller asks for one bound or the other: an intro (15–120 s) with a
 * small shift, since an opening sits at about the same time in every
 * episode, or an ending (15–180 s) with a wide one, since episodes differ in
 * length.
 */
export function longestSharedRun(
	a: Fingerprint,
	b: Fingerprint,
	opts: { minS: number; maxS: number; maxShiftS: number; tolerance?: number }
): SharedRun | null {
	const A = normalise(a);
	const B = normalise(b);
	if (!A.length || !B.length) return null;
	const aStart = a.start ?? 0;
	const bStart = b.start ?? 0;
	const tolerance = opts.tolerance ?? BIT_TOLERANCE;
	const shiftMax = Math.max(0, Math.round(opts.maxShiftS * POINT_HZ));
	let best: SharedRun | null = null;
	let bestShift = Infinity;
	const consider = (from: number, to: number, shift: number) => {
		const seconds = (to - from) / POINT_HZ;
		if (seconds < opts.minS || seconds > opts.maxS) return;
		if (
			best &&
			(seconds < best.seconds || (seconds === best.seconds && Math.abs(shift) >= bestShift))
		)
			return;
		best = {
			a: { start: aStart + from / POINT_HZ, end: aStart + to / POINT_HZ },
			b: { start: bStart + (from + shift) / POINT_HZ, end: bStart + (to + shift) / POINT_HZ },
			seconds
		};
		bestShift = Math.abs(shift);
	};
	for (let shift = -shiftMax; shift <= shiftMax; shift++) {
		const from = Math.max(0, -shift);
		const to = Math.min(A.length, B.length - shift);
		let run = -1;
		for (let i = from; i < to; i++) {
			if (closeEnough(A[i], B[i + shift], tolerance)) {
				if (run < 0) run = i;
			} else if (run >= 0) {
				consider(run, i, shift);
				run = -1;
			}
		}
		if (run >= 0) consider(run, to, shift);
	}
	return best;
}

/** The opening two episodes share, or null. */
export const sharedIntro = (a: Fingerprint, b: Fingerprint): SharedRun | null =>
	longestSharedRun(a, b, {
		minS: INTRO_MIN_S,
		maxS: INTRO_MAX_S,
		maxShiftS: INTRO_SHIFT_S
	});

/** The ending two episodes share, or null. */
export const sharedEnding = (a: Fingerprint, b: Fingerprint): SharedRun | null =>
	longestSharedRun(a, b, {
		minS: ENDING_MIN_S,
		maxS: ENDING_MAX_S,
		maxShiftS: ENDING_SHIFT_S
	});
