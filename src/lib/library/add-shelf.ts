/**
 * PUT ON A SHELF, in the band ADD leaves (card c724; doc/BROWSE.md, "Shelves
 * in the ADD band"): the owner's shelves as chips, one tap each, several
 * allowed, the last one chosen on this device first. Pure: the band's
 * markup and its action (`src/routes/browse/AddedBand.svelte`, `shelve` on
 * the source page and BROWSE) are built on these, and so is the series
 * screen's band once its owner takes the patch (doc/handoff-notes/browse.md,
 * wave 33, Gaps). No storage of its own beyond one localStorage key: the
 * shelves are the library's collections, written by `setInCollection`, the
 * SHELVES sheet's own write.
 */

/** The localStorage key: the id of the shelf last chosen from an ADD band, on this device. */
export const SHELF_KEY = 'tsundoku:add-shelf';

/** How many shelves the band draws as chips before the rest go to the SHELVES sheet (`ShelfPicker`). */
export const BAND_SHELVES = 6;

/** A shelf the band can offer: a library collection, by its id and name. */
export type BandShelf = { id: number; name: string };

/**
 * The library's collections out of the layout's shelves (`c:<id>` keys,
 * `types.ts`'s `Shelf`), in the order the library lists them. Every other
 * kind of shelf (ALL, NEW, a kind, a root, PEOPLE) is not one a series is
 * put on.
 */
export function collectionShelves(
	shelves: readonly { key: string; name: string; kind: string }[]
): BandShelf[] {
	const out: BandShelf[] = [];
	for (const s of shelves) {
		if (s.kind !== 'collection') continue;
		const m = /^c:(\d+)$/.exec(s.key);
		if (m) out.push({ id: Number(m[1]), name: s.name });
	}
	return out;
}

/** The stored word, read back: a shelf id, or null for nothing, junk or a non-id. */
export function lastShelf(stored: string | null | undefined): number | null {
	if (!stored || !/^[1-9]\d{0,15}$/.test(stored)) return null;
	return Number(stored);
}

/**
 * The shelves in the band's order: the last one chosen first (when it still
 * exists), then the rest as the library lists them. A shelf deleted since
 * it was chosen is simply not first: nothing stale is drawn.
 */
export function bandOrder(shelves: readonly BandShelf[], last: number | null): BandShelf[] {
	const i = last === null ? -1 : shelves.findIndex((s) => s.id === last);
	if (i <= 0) return [...shelves];
	return [shelves[i], ...shelves.slice(0, i), ...shelves.slice(i + 1)];
}

/**
 * What the band draws: the first `BAND_SHELVES` as chips, and whether the
 * rest wait in the SHELVES sheet (`more`, its count). A shelf the series is
 * already on is always drawn, even past the limit, so the band never hides
 * that it is on one: it goes in place of the last chip that is not.
 */
export function bandChips(
	ordered: readonly BandShelf[],
	on: ReadonlySet<number>,
	max = BAND_SHELVES
): { chips: BandShelf[]; more: number } {
	if (ordered.length <= max) return { chips: [...ordered], more: 0 };
	const chips = ordered.slice(0, max);
	for (const s of ordered.slice(max)) {
		if (!on.has(s.id)) continue;
		const j = chips.findLastIndex((c) => !on.has(c.id));
		if (j >= 0) chips.splice(j, 1);
		chips.push(s);
	}
	const shown = new Set(chips.map((c) => c.id));
	return { chips, more: ordered.filter((s) => !shown.has(s.id)).length };
}

/** The chip that opens the SHELVES sheet for the rest: `1 OTHER SHELF`, `3 OTHER SHELVES`. */
export const otherShelves = (n: number): string => `${n} OTHER SHEL${n === 1 ? 'F' : 'VES'}`;

/** The band's shelf line: what it asks, or which shelves the series is on now. */
export function shelfLine(chips: readonly BandShelf[], on: ReadonlySet<number>): string {
	const names = chips.filter((c) => on.has(c.id)).map((c) => c.name.toUpperCase());
	return names.length ? `ON ${names.join(', ')}` : 'PUT ON A SHELF:';
}
