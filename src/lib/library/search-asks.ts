/**
 * Which sources a search asks first (c1142; doc/DOWNLOADS.md, "Which of them
 * a search asks first"). A search used to ask every installed source of its kind:
 * dozens of sites per search, and in the web edition seconds of Java each.
 * Now it asks the pinned ones, and the rest only when asked to (ASK THEM, or
 * ALL SOURCES in the KIND band: `?all=1`, so back and reload keep it and the
 * next search starts at pinned again).
 *
 * With none of the kind pinned, a search asks the kind's last browsed (up to
 * four, as BROWSE's RECENT keeps), and with none of those either, every
 * source of the kind, saying so in a band that offers a way to pin.
 */

/** The sources the search asks first, by how they were chosen. */
export type AskMode = 'pinned' | 'recent' | 'all';

/**
 * Why the band shows, if it does:
 * - `nothing-pinned`: no source is pinned at all, so the last browsed were asked;
 * - `kind-none-pinned`: sources are pinned, none of this kind;
 * - `nothing-browsed`: nothing pinned or browsed, so every source was asked.
 */
export type AskBand = 'nothing-pinned' | 'kind-none-pinned' | 'nothing-browsed';

/**
 * What the band offers to pin, in one press:
 * - `read-from`: the sources the library reads from (never pinned on their own);
 * - `found`: the sources whose answers found the title, known once they land.
 */
export type AskOffer = 'read-from' | 'found';

export type AskPlan<S> = {
	mode: AskMode;
	band: AskBand | null;
	/** Asked by default: 01. */
	first: S[];
	/** Not asked unless `askRest`: ASK THEM's count, and 02 once asked. */
	rest: S[];
	askRest: boolean;
	/** The band's offer; the sources it pins are `offered` (for `found`, those of `first` that find something). */
	offer: AskOffer | null;
	offered: S[];
};

/** How many of the last browsed a search with nothing pinned asks: BROWSE's RECENT. */
export const LAST_BROWSED = 4;

/**
 * @param sources the sources the search's kind asks, in their usual order
 * @param pinned every pinned source's id, of any kind
 * @param recent ids of the browsed sources, most recent first, any kind
 * @param readFrom ids of the sources the library holds series from
 * @param askRest `?all=1`: the rest are asked too
 */
export function planAsks<S extends { id: string }>(
	sources: readonly S[],
	pinned: ReadonlySet<string>,
	recent: readonly string[],
	readFrom: ReadonlySet<string>,
	askRest: boolean
): AskPlan<S> {
	const byId = new Map(sources.map((s) => [s.id, s]));
	const pinnedHere = sources.filter((s) => pinned.has(s.id));
	let mode: AskMode;
	let first: S[];
	if (pinnedHere.length) {
		mode = 'pinned';
		first = pinnedHere;
	} else {
		const browsed = recent
			.map((id) => byId.get(id))
			.filter((s): s is S => s !== undefined)
			.slice(0, LAST_BROWSED);
		mode = browsed.length ? 'recent' : 'all';
		first = browsed.length ? browsed : [...sources];
	}
	const firstIds = new Set(first.map((s) => s.id));
	const rest = sources.filter((s) => !firstIds.has(s.id));
	const band: AskBand | null =
		mode === 'pinned'
			? null
			: pinned.size
				? 'kind-none-pinned'
				: mode === 'recent'
					? 'nothing-pinned'
					: 'nothing-browsed';
	// Sources the library reads from aren't pinned on their own (the owner's
	// call, 2026-11-27): they're offered, once, in the band.
	// With nothing pinned or browsed there's no telling which matter, so the
	// offer waits for the answers: the ones that found it.
	const readHere = sources.filter((s) => readFrom.has(s.id));
	const offer: AskOffer | null =
		band === null ? null : band !== 'nothing-browsed' && readHere.length ? 'read-from' : 'found';
	return {
		mode,
		band,
		first,
		rest,
		askRest,
		offer,
		offered: offer === 'read-from' ? readHere : first
	};
}
