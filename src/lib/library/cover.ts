/**
 * The striped placeholder a cover shows until (or instead of) its image: 135°
 * stripes tinted by a per-series hue, with lightness and chroma from the theme
 * (`--cover-l`, `--cover-c`), so one hue reads correctly in dark and light.
 */
export function coverPlaceholder(hue: number, stripe = 6): string {
	const h = ((Math.round(hue) % 360) + 360) % 360;
	return (
		`repeating-linear-gradient(135deg, ` +
		`oklch(var(--cover-l) var(--cover-c) ${h}) 0 ${stripe}px, ` +
		`oklch(calc(var(--cover-l) - 0.04) var(--cover-c) ${h}) ${stripe}px ${stripe * 2}px)`
	);
}

/** A stable hue from a title, for series the scanner found without artwork. */
export function hueFor(seed: string): number {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0) % 360;
}
