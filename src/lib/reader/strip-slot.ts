/**
 * The vertical strip's block under a point: a page slot or a chapter band.
 *
 * Every element under the point is looked through, not only the topmost
 * (c568): READING's sheet, the controls, the lookup or a banner can cover the
 * middle of the screen, and the strip's block under them is still the place
 * being read. Wave 24 traced the strip losing a chapter that way: VERTICAL
 * picked in READING's sheet, the chapter above arriving while the sheet still
 * covered the middle, `elementFromPoint` finding the sheet, and nothing kept.
 *
 * Only blocks inside the strip (`data-role="strip"`) count: the shared `Band`, `SaveBand` and
 * `Banner` also carry `.band`, and one drawn over the strip is not a place.
 * Nothing under the point (a gap, the end page) is `null`, and the caller
 * keeps nothing, as before.
 */
export const STRIP_SLOT = '[data-role="page"], .band';

export function stripSlotAt(x: number, y: number, root?: Element | null): HTMLElement | null {
	for (const e of document.elementsFromPoint(x, y)) {
		const slot = e.closest<HTMLElement>(STRIP_SLOT);
		if (!slot) continue;
		if (root ? root.contains(slot) : slot.closest('[data-role="strip"]')) return slot;
	}
	return null;
}

/** The block under the middle of the screen. */
export const stripSlotAtMiddle = (root?: Element | null) =>
	stripSlotAt(innerWidth / 2, innerHeight / 2, root);
