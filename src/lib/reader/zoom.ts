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
