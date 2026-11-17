/**
 * A title's trailing season marker, as a name rule (doc/WORKS.md, "Per-season
 * sources"). Migration 55 inlines the same shapes in SQL to stamp
 * `entries.season` (`src/lib/server/db.ts`, v55): a migration must say the
 * same thing in ten years, whatever this module has learned by then, so the
 * frozen SQL stays untouched and this is the rule the grouping sheet reads.
 *
 * Only a **trailing** marker is a name's: "Frieren Season 2" is the second
 * season of Frieren, while "Season 2 of the Witch" names its own show. Pure,
 * so `tests/season-name.spec.ts` holds every shape and the near misses.
 */

export type SeasonMark = {
	/** The number the marker says: 2 for "Season 2", "2nd Season", "S2", "Part 2" or "II". */
	season: number;
	/** The marker as the title wrote it, trailing spaces trimmed. */
	marker: string;
};

const ROMAN: Record<string, number> = {
	II: 2,
	III: 3,
	IV: 4,
	V: 5,
	VI: 6,
	VII: 7,
	VIII: 8,
	IX: 9,
	X: 10,
	XI: 11,
	XII: 12,
	XIII: 13,
	XIV: 14,
	XV: 15,
	XVI: 16,
	XVII: 17,
	XVIII: 18,
	XIX: 19,
	XX: 20
};

/** A trailing marker's match, or null when the whole title is the marker. */
const trailing = (re: RegExp, title: string): RegExpExecArray | null => {
	const m = re.exec(title);
	// `(?:^|\s)` matches at 0 only when nothing precedes the marker: "Season 2"
	// alone is a show whose title starts with the word, not a second season.
	return m && m.index > 0 ? m : null;
};

/**
 * The season a title's trailing marker names, or null. A marker is trailing
 * only: the whole title may not be the marker ("Season 2" alone names a show
 * whose title starts with the word, and stripping it would leave nothing).
 */
export function seasonMark(title: string): SeasonMark | null {
	const t = title.trim();
	if (t === '') return null;
	// A part after a season belongs to the same marker: "Title Season 3 Part 2"
	// is the whole suffix, and the show's name is "Title".
	let m = trailing(/(?:^|\s)season\s*(\d{1,3})\s+part\s*(\d{1,2}|[IVX]{2,5})$/i, t);
	if (m) return { season: Number(m[1]), marker: t.slice(m.index).trim() };
	m = trailing(/(?:^|\s)season\s+([IVX]{2,5})\s+part\s*(\d{1,2}|[IVX]{2,5})$/i, t);
	if (m && ROMAN[m[1].toUpperCase()] !== undefined)
		return { season: ROMAN[m[1].toUpperCase()], marker: t.slice(m.index).trim() };
	m = trailing(/(?:^|\s)(\d{1,2})(?:st|nd|rd|th)\s+season$/i, t);
	if (m) return { season: Number(m[1]), marker: t.slice(m.index).trim() };
	m = trailing(/(?:^|\s)season\s*(\d{1,3})$/i, t);
	if (m) return { season: Number(m[1]), marker: t.slice(m.index).trim() };
	m = trailing(/(?:^|\s)season\s+([IVX]{2,5})$/i, t);
	if (m && ROMAN[m[1].toUpperCase()] !== undefined)
		return { season: ROMAN[m[1].toUpperCase()], marker: t.slice(m.index).trim() };
	m = trailing(/(?:^|\s)s\s*(\d{1,3})$/i, t);
	if (m) return { season: Number(m[1]), marker: t.slice(m.index).trim() };
	m = trailing(/(?:^|\s)part\s*(\d{1,2})$/i, t);
	if (m) return { season: Number(m[1]), marker: t.slice(m.index).trim() };
	m = trailing(/(?:^|\s)part\s+([IVX]{2,5})$/i, t);
	if (m && ROMAN[m[1].toUpperCase()] !== undefined)
		return { season: ROMAN[m[1].toUpperCase()], marker: t.slice(m.index).trim() };
	// A bare "II" is the card's own shape; a longer numeral is a title's own
	// ("Final Fantasy VII" is not a seventh season).
	m = trailing(/(?:^|\s)ii$/i, t);
	if (m) return { season: 2, marker: t.slice(m.index).trim() };
	return null;
}

/**
 * A title without its trailing season marker, and the marker it lost. A title
 * that is only a marker (or empty after stripping) keeps its own text: a show
 * called "Season 2" has no name left to fall back to.
 */
export function stripSeason(title: string): { name: string; mark: SeasonMark | null } {
	const t = title.trim();
	const mark = seasonMark(t);
	if (!mark) return { name: t, mark: null };
	const name = t
		.slice(0, t.length - mark.marker.length)
		.replace(/[\s:–—-]+$/u, '')
		.trim();
	return name === '' ? { name: t, mark: null } : { name, mark };
}

/**
 * The grouping sheet's default name: **the shortest title**, with its trailing
 * season marker taken off, and that marker worded for the label
 * (`WITHOUT “SEASON 2”`). The marker comes from the chosen title when it has
 * one, else from the first title in the selection that does: a base title
 * beside its "Season 2" names the same show, and the label says which suffix
 * the set is without. Ties keep the first of the titles as selected; a
 * selection with no marker leaves the label empty.
 */
export function defaultShowName(titles: string[]): { name: string; without: string | null } {
	const stripped = titles
		.map((t) => t.trim())
		.filter((t) => t !== '')
		.map((t) => stripSeason(t));
	if (stripped.length === 0) return { name: '', without: null };
	let best = stripped[0];
	for (const s of stripped) if (s.name.length < best.name.length) best = s;
	const marked = best.mark ? best : stripped.find((s) => s.mark);
	return { name: best.name, without: marked?.mark ? marked.mark.marker.toUpperCase() : null };
}
