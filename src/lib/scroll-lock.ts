/**
 * Holds the page still under whatever covers it: a sheet, the image reader's
 * lookup panel or page menu. A finger dragging over a scrim, or a sheet's own
 * scroll reaching its end, otherwise scrolls the library underneath.
 *
 * Counted, because covers stack (a reader's menu with a sheet over it): each
 * caller writing `overflow` itself let the first to close unlock the page
 * under the one still open. The page is unlocked when the last one lets go,
 * and gets back whatever it had before the first.
 *
 * `overflow: hidden` on the root is also what the focus layer reads as a
 * locked page (src/lib/focus/layer.ts, `stepScroll`, c618), so the arrow keys
 * stop scrolling it too. `scrollbar-gutter: stable` keeps the space of a
 * desktop scrollbar while it is hidden, so the page doesn't shift sideways.
 */
let holders = 0;
let before: { overflow: string; gutter: string } | null = null;

export function lockPage(): () => void {
	if (typeof document === 'undefined') return () => {};
	const html = document.documentElement;
	if (holders++ === 0) {
		before = { overflow: html.style.overflow, gutter: html.style.scrollbarGutter };
		html.style.overflow = 'hidden';
		html.style.scrollbarGutter = 'stable';
	}
	let released = false;
	return () => {
		// A release called twice (an effect's cleanup and a destroy) counts once.
		if (released) return;
		released = true;
		if (--holders === 0 && before) {
			html.style.overflow = before.overflow;
			html.style.scrollbarGutter = before.gutter;
			before = null;
		}
	};
}

/** How many covers hold the page now: for tests. */
export function pageLocks(): number {
	return holders;
}
