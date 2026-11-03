import type { TransitionConfig } from 'svelte/transition';

/**
 * Motion's shared pieces (doc/MOTION.md, card c396): the curves as functions
 * Svelte's transitions can use, how something on screen leaves, and which way
 * one screen gives way to the next. The values are the tokens in
 * src/lib/styles/spacing.css; keep the two in step.
 */

/** A CSS `cubic-bezier()` as a function of time, for Svelte's `easing`. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
	const cx = 3 * x1;
	const bx = 3 * (x2 - x1) - cx;
	const ax = 1 - cx - bx;
	const cy = 3 * y1;
	const by = 3 * (y2 - y1) - cy;
	const ay = 1 - cy - by;
	const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
	const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
	const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
	// The curve's parameter for an x: Newton's method, then bisection when the
	// slope is too flat for Newton to be trusted.
	const solve = (x: number) => {
		let s = x;
		for (let i = 0; i < 8; i++) {
			const err = sampleX(s) - x;
			if (Math.abs(err) < 1e-6) return s;
			const d = slopeX(s);
			if (Math.abs(d) < 1e-6) break;
			s -= err / d;
		}
		let lo = 0;
		let hi = 1;
		s = x;
		while (hi - lo > 1e-6) {
			if (sampleX(s) < x) lo = s;
			else hi = s;
			s = (lo + hi) / 2;
		}
		return s;
	};
	return (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : sampleY(solve(t)));
}

/** `--ease-out`: anything entering or leaving. */
export const easeOut = cubicBezier(0.23, 1, 0.32, 1);
/** `--ease-drawer`: sheets and panels. */
export const easeDrawer = cubicBezier(0.32, 0.72, 0, 1);

/** `--motion-leave`, in milliseconds. */
export const LEAVE_MS = 180;

/**
 * Where a thing goes when it leaves: the way it came.
 *
 * - `fade`: scrims, the readers' bars, anything that only faded in (`.appear`).
 * - `down`: a bottom sheet (`.rise`). On a TV, where every sheet is a panel
 *   from the right, it leaves to the right instead.
 * - `right`: a panel from the right (`.rise-right`).
 * - `pop`: a centred dialog (`.pop`).
 */
export type Leave = 'fade' | 'down' | 'right' | 'pop';

const prefers = (query: string) => typeof matchMedia === 'function' && matchMedia(query).matches;

/** Whether this device draws sheets as TV panels (the same query as the sheets' CSS). */
const isTvPanel = () => prefers('(pointer: none) and (min-width: 900px)');

/**
 * The CSS for one frame of a leave, `u` running from 0 (still there) to 1
 * (gone). Reduced motion keeps the fade and drops the movement, the same rule
 * `.appear` follows: a fade doesn't move.
 */
export function leaveFrame(kind: Leave, u: number, reduced: boolean, tv: boolean): string {
	const opacity = `opacity: ${1 - u};`;
	if (reduced || kind === 'fade') return opacity;
	if (kind === 'pop') return `${opacity} scale: ${1 - 0.04 * u};`;
	const toRight = kind === 'right' || tv;
	// A sheet is opaque and slides right off the screen; it doesn't fade.
	return toRight ? `translate: ${u * 100}% 0;` : `translate: 0 ${u * 100}%;`;
}

/**
 * Svelte's `out:` for anything that appeared over the page, so it leaves the
 * way it came instead of vanishing. Use it beside the entrance class:
 * `class="sheet rise" out:leave={'down'}`.
 */
export function leave(_node: Element, kind: Leave = 'fade'): TransitionConfig {
	const reduced = prefers('(prefers-reduced-motion: reduce)');
	const tv = isTvPanel();
	const slides = !reduced && kind !== 'fade' && kind !== 'pop';
	return {
		duration: LEAVE_MS,
		easing: slides ? easeDrawer : easeOut,
		// On its way out it takes no taps: a second tap on a closing scrim must
		// not land. In the frames, not on the node, so a leave that's called off
		// (the sheet opened again before it was gone, and Svelte keeps the same
		// element) gives the taps back with the rest of its style.
		css: (_t, u) => `${leaveFrame(kind, u, reduced, tv)} pointer-events: none;`
	};
}

// ---- one screen to the next ----------------------------------------------------

export type ScreenMove = 'forward' | 'back' | 'fade';

/**
 * How deep a route sits. A screen deeper than the one left slides in from the
 * right, a shallower one from the left, and one at the same depth fades in.
 */
export function depthOf(routeId: string): number {
	return routeId.split('/').filter(Boolean).length;
}

/** The readers and the player: full-screen and fixed, so they never slide. */
const isReader = (routeId: string) => routeId.startsWith('/read/');

/**
 * Which way the screen moves, or null for not at all. The root layout draws
 * it (src/lib/styles/motion.css, "Screens").
 *
 * - The same screen with other parameters (a shelf tab, a filter, the reader's
 *   next chapter, the player's next episode) doesn't move: it is the same
 *   place, and the readers' turns stay instant.
 * - Back and forward through history move the way history went.
 * - When the next screen's outline was already showing, the outline was the
 *   screen arriving, so the screen only fades over it; sliding would arrive twice.
 * - Into or out of a reader it fades. A reader is fixed to the screen, and a
 *   moving ancestor would hold everything fixed inside it to its own box for
 *   the length of the slide (doc/MOTION.md, "Screens").
 */
export function screenMove(nav: {
	type: string;
	delta?: number;
	from: string | null;
	to: string | null;
	covered: boolean;
}): ScreenMove | null {
	if (!nav.from || !nav.to || nav.from === nav.to) return null;
	if (nav.covered || isReader(nav.from) || isReader(nav.to)) return 'fade';
	if (nav.type === 'popstate') {
		if (nav.delta && nav.delta < 0) return 'back';
		if (nav.delta && nav.delta > 0) return 'forward';
		return 'fade';
	}
	const d = depthOf(nav.to) - depthOf(nav.from);
	return d > 0 ? 'forward' : d < 0 ? 'back' : 'fade';
}
