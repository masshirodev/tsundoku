/**
 * Zoom in the image reader, the pure part (doc/READER.md, "Zoom"; card c169,
 * asked for by the owner on 2026-10-29). A zoom is a factor of the page as
 * fitted: paged, the page box grows past the screen and scrolls; vertical,
 * the strip grows wider (or narrower) than the screen.
 *
 * A kept zoom is a default per reading mode and per screen class, on this
 * device: manga (paged) and manhwa (the strip) keep different values, and a
 * phone-width window keeps its own, so neither overwrites the other.
 */

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
/** What − and + step through: round numbers a person can return to. */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export const clampZoom = (z: number) =>
	Number.isFinite(z) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100)) : 1;

/** The next step up or down from [z], which needn't be a step itself (a pinch lands anywhere). */
export function stepZoom(z: number, dir: 1 | -1): number {
	if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? ZOOM_MAX;
	return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_MIN;
}

export type ZoomMode = 'paged' | 'vertical';
export type ScreenClass = 'phone' | 'wide';

/** Phone below 600px, as everywhere else in tsundoku. */
export const screenClass = (width: number): ScreenClass => (width < 600 ? 'phone' : 'wide');

/** Where a kept zoom lives in this device's storage, under the reader's prefix. */
export const zoomKey = (mode: ZoomMode, screen: ScreenClass) => `zoom.${mode}.${screen}`;

/**
 * RESET: back to the kept zoom, and from the kept zoom to 100%. The kept
 * one is where a session starts, so it's the first place to return to.
 */
export const resetZoom = (z: number, kept: number) => (Math.abs(z - kept) > 0.001 ? kept : 1);

/** "125%" */
export const zoomLabel = (z: number) => `${Math.round(z * 100)}%`;

/** A pinch: the zoom at its start, scaled by how far the fingers moved apart. */
export const pinchZoom = (start: number, startDist: number, dist: number) =>
	startDist > 0 ? clampZoom((start * dist) / startDist) : start;

/** A stored value read back: a number in range, else none. */
export function keptZoom(raw: unknown): number | null {
	return typeof raw === 'number' && raw >= ZOOM_MIN && raw <= ZOOM_MAX ? raw : null;
}

// ---- double tap (card c185) -----------------------------------------------------------

/**
 * Where a double tap in the middle of the page goes (the owner's rule,
 * 2026-10-29): under 100% up to it, at 100% to 200%, over 100% back to it.
 */
export const doubleTapZoom = (z: number) => (Math.abs(z - 1) < 0.005 ? 2 : 1);

/** How soon, and how near, a second tap must land to make a double tap. */
export const DOUBLE_TAP_MS = 250;
export const DOUBLE_TAP_PX = 32;

/**
 * Tells a double tap from two single ones. `tap` answers 'double' for the
 * second of two taps within DOUBLE_TAP_MS and DOUBLE_TAP_PX, and 'single' for
 * any other, whose action the reader then holds back DOUBLE_TAP_MS in case a
 * second follows. A third tap starts over: two double taps need four.
 */
export class DoubleTap {
	private last: { x: number; y: number; t: number } | null = null;

	tap(x: number, y: number, t: number): 'single' | 'double' {
		const l = this.last;
		if (l && t - l.t <= DOUBLE_TAP_MS && Math.hypot(x - l.x, y - l.y) <= DOUBLE_TAP_PX) {
			this.last = null;
			return 'double';
		}
		this.last = { x, y, t };
		return 'single';
	}

	reset() {
		this.last = null;
	}
}

/**
 * The scroll that keeps a point of the page under the same spot of the screen
 * across a zoom (a double tap's point, a pinch's middle): `fx`, `fy` are where
 * the point was on the page as fractions, `after` the page's box once zoomed,
 * and (x, y) the spot. What to scroll by, each way.
 */
export function keepUnder(
	fx: number,
	fy: number,
	after: { left: number; top: number; width: number; height: number },
	x: number,
	y: number
) {
	return { dx: after.left + fx * after.width - x, dy: after.top + fy * after.height - y };
}

/** Where (x, y) falls on a box, as fractions, held to the box: a tap in the margin counts from its edge. */
export function fractionOn(
	box: { left: number; top: number; width: number; height: number },
	x: number,
	y: number
) {
	const f = (v: number, start: number, size: number) =>
		size > 0 ? Math.min(1, Math.max(0, (v - start) / size)) : 0.5;
	return { fx: f(x, box.left, box.width), fy: f(y, box.top, box.height) };
}
