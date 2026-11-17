/**
 * The page's background, said to tsundoku's own Android app so the camera band
 * and the strip above the keyboard take it (c521; doc/ANDROID.md, "The
 * camera band and the keyboard"; the app's Insets.kt).
 *
 * The app reads the colour itself when a page finishes loading, but a theme
 * switched in place (/light, /dark, a device's synced setting) changes it with
 * no load, so the layout tells it again on every change. A browser has no
 * bridge, and nothing here runs there.
 */
type SurfaceBridge = { surface?: (css: string) => void };

const bridge = (): SurfaceBridge | null =>
	(window as unknown as { TsundokuTV?: SurfaceBridge }).TsundokuTV ?? null;

/**
 * A CSS colour as `rgb(r, g, b)`, or '' when it is not solid. The computed
 * colour may be oklch() (the light theme's paper), which the app does not
 * parse, so it is drawn on a 1x1 canvas and read back as pixels.
 */
export function solidRgb(css: string): string {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 1;
	const g = canvas.getContext('2d', { willReadFrequently: true });
	if (!g || !css) return '';
	g.clearRect(0, 0, 1, 1);
	g.fillStyle = 'rgba(0, 0, 0, 0)';
	g.fillStyle = css;
	g.fillRect(0, 0, 1, 1);
	const [r, gr, b, a] = g.getImageData(0, 0, 1, 1).data;
	return a < 255 ? '' : `rgb(${r}, ${gr}, ${b})`;
}

/** The page's own background: the body's, else the root's when the body is clear. */
export function pageSurface(): string {
	const of = (el: Element | null) => (el ? getComputedStyle(el).backgroundColor : '');
	return solidRgb(of(document.body)) || solidRgb(of(document.documentElement));
}

/**
 * Tell the app now and on every theme change; returns the undo. The theme is
 * `data-theme` on <html>, set by more than one path, so the attribute is what
 * is watched rather than any one of them.
 */
export function followSurface(): () => void {
	const b = bridge();
	if (!b || typeof b.surface !== 'function') return () => {};
	const tell = () => {
		const css = pageSurface();
		if (css) b.surface?.(css);
	};
	tell();
	const watch = new MutationObserver(() => requestAnimationFrame(tell));
	watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	return () => watch.disconnect();
}

/**
 * Draw this page under the camera while it is open (c521; doc/ANDROID.md,
 * "Drawn under the camera"): the phone app drops its cutout and gesture
 * padding, and the page keeps its own bars out of the band from
 * `--app-inset-*`. Returns the undo, which pads the page again. A browser, or
 * an app older than this, has no `edge` and nothing happens.
 */
export function drawUnderCamera(): () => void {
	const b = (window as unknown as { TsundokuTV?: { edge?: (on: boolean) => void } }).TsundokuTV;
	if (!b || typeof b.edge !== 'function') return () => {};
	b.edge(true);
	return () => b.edge?.(false);
}
