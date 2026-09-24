/**
 * Cropping a page's plain border (doc/READER.md, "Crop borders"). Pure: the
 * workstation measures (src/lib/server/pages/crops.ts), these decide.
 */

/** A page's margins as fractions of its width and height: top, right, bottom, left. */
export type Inset = [number, number, number, number];

export const NO_INSET: Inset = [0, 0, 0, 0];

/** Under this, a margin isn't worth cropping: the page would only twitch. */
const MIN = 0.01;
/** At least this much of each dimension stays: a mostly blank page is art, not border. */
const KEEP = 0.6;

/**
 * What to crop, from where a trim found the content: `x`, `y`, `w`, `h` of
 * the content inside a `width` × `height` image. None when the margins are
 * negligible, or when cropping would take too much of the page.
 */
export function insetOf(m: {
	width: number;
	height: number;
	x: number;
	y: number;
	w: number;
	h: number;
}): Inset {
	if (m.width <= 0 || m.height <= 0 || m.w <= 0 || m.h <= 0) return NO_INSET;
	if (m.w / m.width < KEEP || m.h / m.height < KEEP) return NO_INSET;
	const round = (n: number) => (n < MIN ? 0 : Math.round(n * 1000) / 1000);
	const inset: Inset = [
		round(m.y / m.height),
		round((m.width - m.x - m.w) / m.width),
		round((m.height - m.y - m.h) / m.height),
		round(m.x / m.width)
	];
	return inset;
}

/** The page's shape once cropped, for its box, so nothing jumps when the image arrives. */
export function croppedSize(w: number, h: number, i: Inset): { w: number; h: number } {
	return { w: w * (1 - i[1] - i[3]), h: h * (1 - i[0] - i[2]) };
}

/** CSS `object-view-box` for the inset, or undefined when there is nothing to crop. */
export function viewBox(i: Inset | null | undefined): string | undefined {
	if (!i || i.every((n) => n === 0)) return undefined;
	const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
	return `inset(${pct(i[0])} ${pct(i[1])} ${pct(i[2])} ${pct(i[3])})`;
}
