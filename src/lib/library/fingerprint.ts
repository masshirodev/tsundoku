import type { Range } from './streams.ts';

/**
 * Fingerprints of episodes, the pure part (doc/ANIME.md, "Openings and
 * endings"). Two episodes of a season share their opening and their ending,
 * so a run of chromaprint points both have, wherever each episode has it, is
 * one of them (the rule for a run: longestSharedRun). The fingerprinting
 * itself is the server's; this only compares points, which is what the specs
 * can do without a video.
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

/**
 * How far apart the same opening or ending may sit in two episodes, in
 * seconds. An opening's is the whole intro window: where it starts depends on
 * each episode's cold open, and Ranma ½ (2024) puts it at 30.75 s in one
 * episode and 83.1 s in another, 52 s apart, past a 30 s limit. A pair that
 * cannot align returns whatever shorter run it meets by chance.
 * The full cross-match of two 6-minute windows is about 8 million point
 * comparisons, tens of milliseconds.
 */
export const INTRO_SHIFT_S = INTRO_CAP_S;
export const ENDING_SHIFT_S = 180;

/**
 * The longest stretch of unmatched points a run carries on through, counted
 * in its length. Two encodes of the same song differ by more than
 * BIT_TOLERANCE at scattered points, a stream's 360p audio especially, and a
 * run that ends at the first one breaks a 90 s opening into 30-50 s pieces.
 * Jellyfin's Intro Skipper, the method this follows, joins matches up to 3.5 s
 * apart (its MaximumTimeSkip) into one region; so does this.
 */
export const MAX_GAP_S = 3.5;

/**
 * What a gap is bridged between, and how much of a run must match. Bridging
 * alone chains chance: two unrelated stretches of pink noise (the db spec's
 * own) match at 8-11 % of points within BIT_TOLERANCE, so some point matches
 * in nearly every 3.5 s and every pair would chain into one false run. So a
 * run is built only from streaks of at least MIN_STREAK consecutive matching
 * points (half a second), and kept only when MIN_DENSITY of its points are in
 * them. Measured on that noise (the spec's opening and ending against
 * unrelated noise, every shift): chance streaks still reach 3 s, and the
 * chains they make are 12-20 s at a density of 0.30-0.43, while the shared
 * 20 s opening and ending come out at 0.97-1.00. A 90 s opening with a bad
 * point every 3 s is 0.96.
 */
export const MIN_STREAK = 4;
export const MIN_DENSITY = 0.7;

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
 * the normalised grid; a run is a stretch that starts and ends on points that
 * match within `BIT_TOLERANCE`, with no more than `maxGapS` (MAX_GAP_S) of
 * unmatched points anywhere inside it.
 *
 * The caller asks for one bound or the other: an intro (15–120 s) shifted
 * across its whole window, since a cold open moves the opening, or an ending
 * (15–180 s) with a shift of most of its own, since episodes differ in
 * length. Both bridge the same gaps: the noise is the encode's, not the
 * song's.
 */
export function longestSharedRun(
	a: Fingerprint,
	b: Fingerprint,
	opts: {
		minS: number;
		maxS: number;
		maxShiftS: number;
		tolerance?: number;
		maxGapS?: number;
		minStreak?: number;
		minDensity?: number;
	}
): SharedRun | null {
	const A = normalise(a);
	const B = normalise(b);
	if (!A.length || !B.length) return null;
	const aStart = a.start ?? 0;
	const bStart = b.start ?? 0;
	const tolerance = opts.tolerance ?? BIT_TOLERANCE;
	const gap = Math.max(0, Math.round((opts.maxGapS ?? MAX_GAP_S) * POINT_HZ));
	const minStreak = Math.max(1, opts.minStreak ?? MIN_STREAK);
	const minDensity = opts.minDensity ?? MIN_DENSITY;
	const shiftMax = Math.max(0, Math.round(opts.maxShiftS * POINT_HZ));
	let best: SharedRun | null = null;
	let bestShift = Infinity;
	const consider = (from: number, to: number, shift: number, matched: number) => {
		const seconds = (to - from) / POINT_HZ;
		if (seconds < opts.minS || seconds > opts.maxS) return;
		if (matched / (to - from) < minDensity) return;
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
		// [run] is where the current run starts, [end] where its last streak
		// ended and [matched] how many points its streaks hold; [streak] is
		// where the consecutive matches now running began.
		let run = -1;
		let end = -1;
		let matched = 0;
		let streak = -1;
		const close = (at: number) => {
			if (streak < 0) return;
			if (at - streak >= minStreak) {
				if (run >= 0 && streak - end > gap) {
					consider(run, end, shift, matched);
					run = -1;
				}
				if (run < 0) {
					run = streak;
					matched = 0;
				}
				matched += at - streak;
				end = at;
			}
			streak = -1;
		};
		for (let i = from; i < to; i++) {
			if (closeEnough(A[i], B[i + shift], tolerance)) {
				if (streak < 0) streak = i;
			} else close(i);
		}
		close(to);
		if (run >= 0) consider(run, end, shift, matched);
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

/**
 * The span an episode keeps of the ones its pairs found: the one most of the
 * others overlap, and the longest of those. Each pair of a season gives the
 * episode a span; taking the longest would let one pair's chance run decide
 * the episode however the rest disagree. Agreement is what one
 * pair cannot fake: the same opening found against two other episodes lands
 * on the same seconds.
 */
export function agreedSpan(spans: { span: Range; seconds: number }[]): {
	span: Range;
	seconds: number;
} | null {
	let best: { span: Range; seconds: number } | null = null;
	let bestVotes = -1;
	for (const s of spans) {
		const votes = spans.filter(
			(o) => o !== s && o.span.start < s.span.end && s.span.start < o.span.end
		).length;
		if (votes > bestVotes || (votes === bestVotes && best && s.seconds > best.seconds)) {
			best = s;
			bestVotes = votes;
		}
	}
	return best;
}
