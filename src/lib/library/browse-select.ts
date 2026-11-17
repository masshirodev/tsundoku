import { count } from './labels.ts';
import { SOURCE_KINDS, kindFacts, type SourceFamily } from './kinds.ts';
import { INCLUDE, type FilterField } from './browse-filters.ts';

/**
 * SELECT in a source's catalog (doc/BROWSE.md, "SELECT in a catalog"). Pure: what can be
 * ticked, what a tick keeps, and every line the bar, the bulk bar, SHOW and the
 * press's band say. The store that holds a selection in this tab's memory is
 * `browse-selection.svelte.ts`; the server's half of a press is
 * `src/lib/server/browse-press.ts`.
 */

/** A source, as a tick notes it: what the press and its lines need to know of it. */
export type TickSource = {
	id: string;
	name: string;
	family: SourceFamily;
	/** Its ADDED HIDDEN switch: a series added from it arrives hidden. */
	addsHidden: boolean;
	/** Only listed inside reveal (`BrowseSource.mostlyHidden`): nothing of it is drawn outside. */
	hidden: boolean;
};

/**
 * What SELECT keeps about a result it ticked, noted when it was ticked (the
 * library's `Picked`, for a catalog): the selection outlives the list it was
 * ticked in, so SHOW and the bulk bar read these, never the tiles on screen.
 * The server stays the judge at the press: a fact gone stale only words a
 * line, never decides a write.
 */
export type Tick = {
	/** The result's id, the preview's key (`sourceMangaId`): what the press adds. */
	id: string;
	title: string;
	cover: string;
	hue: number;
	/** The tile's own meta line (status and author), as the source gave it. */
	meta: string;
	source: TickSource;
	/** SAME TITLE · FROM …: another source's copy is in the library. */
	twin: boolean;
	/** Where it was ticked, as SHOW says it: `POPULAR`, `SEARCH "solo"`, `GENRE: ACTION`. */
	where: string;
	/** The list it was ticked in (`listKey`), to tell whether the list on screen draws it. */
	list: string;
};

/** What the library says of a result, as far as SELECT asks: `SearchHit`'s match, and whether it is being added. */
export type TickableHit = {
	match: { kind: 'in-library' | 'same-title' | 'new' };
	adding?: boolean;
};

/**
 * Only what the press could add: a
 * result IN LIBRARY (with HIDDEN too, inside reveal) is not, and one being
 * ADDING by an earlier press or a preview's ADD is not either. SAME TITLE is:
 * it is another source's copy, and the bulk bar counts it.
 */
export function tickable(hit: TickableHit, adding = false): boolean {
	return hit.match.kind !== 'in-library' && !hit.adding && !adding;
}

/**
 * Where a list is, in SHOW's words: the tab, a search, or the one tag a tag
 * arrival filtered by. `tag` is the genre's name when the filtered list is a
 * tag's (one tri-state included, nothing else moved), else null.
 */
export function whereLabel(mode: 'popular' | 'latest' | 'filtered', q: string, tag: string | null) {
	if (q) return `SEARCH "${q}"`;
	if (mode === 'filtered') return tag ? `GENRE: ${tag.toUpperCase()}` : 'FILTERED';
	return mode.toUpperCase();
}

/**
 * The tag a filtered list is, when it is one (a tag's arrival: one
 * tri-state included or one checkbox ticked, nothing else moved from the
 * source's own choices): its name, for SHOW's `TICKED IN GENRE: ACTION`.
 * Null for any other filtered list, which SHOW calls FILTERED.
 */
export function oneTag(
	schema: readonly FilterField[],
	applied: readonly FilterField[]
): string | null {
	const moved: FilterField[] = [];
	const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
	schema.forEach((f, i) => {
		const g = applied[i];
		if (!g) return;
		if (f.type === 'group')
			(f.children ?? []).forEach((c, j) => {
				const d = g.children?.[j];
				if (d && !same(c.state, d.state)) moved.push(d);
			});
		else if (f.type !== 'header' && f.type !== 'separator' && !same(f.state, g.state))
			moved.push(g);
	});
	if (moved.length !== 1) return null;
	const [f] = moved;
	return (f.type === 'tristate' && f.state === INCLUDE) ||
		(f.type === 'checkbox' && f.state === true)
		? f.name
		: null;
}

/** How many sources a selection spans, in the order each was first ticked. */
export function sourcesOf(ticks: readonly Tick[]): TickSource[] {
	const seen = new Map<string, TickSource>();
	for (const t of ticks) if (!seen.has(t.source.id)) seen.set(t.source.id, t.source);
	return [...seen.values()];
}

/** `N SOURCES`, `1 SOURCE`. */
export const sourcesWord = (n: number) => `${count(n)} SOURCE${n === 1 ? '' : 'S'}`;

/**
 * The selecting bar's count: `9 SELECTED`, and `· 2 SOURCES` beside it once
 * the selection spans more than one (tablet and desktop; a phone's bar has no
 * room, and the bulk bar's line says it there).
 */
export function barCount(ticks: readonly Tick[]): { count: string; sources: string } {
	const n = sourcesOf(ticks).length;
	return { count: `${count(ticks.length)} SELECTED`, sources: n > 1 ? `· ${sourcesWord(n)}` : '' };
}

/** CHAPTERS or EPISODES: what a source's series is made of (an Aniyomi source's are episodes). */
const unitOf = (family: SourceFamily) =>
	kindFacts(SOURCE_KINDS[family]).medium === 'video' ? 'EPISODES' : 'CHAPTERS';

/** The kind a source's row names (MANGA, NOVEL, ANIME). */
const kindWord = (family: SourceFamily) => SOURCE_KINDS[family].toUpperCase();

/**
 * The bulk bar's line: what the press will do, counted from the
 * ticks' facts. `lead` is in ink; `rest` follows it, joined by ` · `; `right`
 * sits at the line's other end. Two forms, since device layout is CSS: the
 * wide (tablet and desktop) and the phone's, which says less.
 *
 * - `14 TO ADD`; with more than one kind, `3 MANGA · 1 NOVEL · 2 ANIME`;
 * - with two or more sources, each source's count (`MANGADEX 9 · ASURA SCANS 5`), wide only;
 * - `1 HAS A TWIN IN LIBRARY` (the phone's `1 TWIN IN LIBRARY`);
 * - per source with ADDED HIDDEN, `WEEB CENTRAL ADDS ITS 3 HIDDEN`, wide only;
 * - ticks the list on screen does not draw (`here`, the list's key; none on
 *   BROWSE): `4 OF THEM TICKED IN LATEST` when they share one list, else
 *   `11 NOT IN THIS LIST`, wide only.
 *
 * `right` is the one source's name, or `2 SOURCES`; the phone's is `1 SOURCE`.
 */
export function pressLine(
	ticks: readonly Tick[],
	here: string | null
): { lead: string; wide: string[]; phone: string[]; right: string; rightPhone: string } {
	const sources = sourcesOf(ticks);
	const lead = `${count(ticks.length)} TO ADD`;
	const wide: string[] = [];
	const phone: string[] = [];
	const kinds = new Map<string, number>();
	for (const t of ticks)
		kinds.set(kindWord(t.source.family), (kinds.get(kindWord(t.source.family)) ?? 0) + 1);
	if (kinds.size > 1) {
		const k = [...kinds].map(([w, n]) => `${count(n)} ${w}`).join(' · ');
		wide.push(k);
		phone.push(k);
	}
	if (sources.length > 1)
		wide.push(
			sources
				.map(
					(s) =>
						`${s.name.toUpperCase()} ${count(ticks.filter((t) => t.source.id === s.id).length)}`
				)
				.join(' · ')
		);
	const twins = ticks.filter((t) => t.twin).length;
	if (twins > 0) {
		wide.push(`${count(twins)} ${twins === 1 ? 'HAS A TWIN' : 'HAVE A TWIN'} IN LIBRARY`);
		phone.push(`${count(twins)} TWIN${twins === 1 ? '' : 'S'} IN LIBRARY`);
	}
	for (const s of sources) {
		if (!s.addsHidden) continue;
		const n = ticks.filter((t) => t.source.id === s.id).length;
		wide.push(`${s.name.toUpperCase()} ADDS ${n === 1 ? 'IT' : `ITS ${count(n)}`} HIDDEN`);
	}
	if (here !== null) {
		const away = ticks.filter((t) => t.list !== here);
		if (away.length > 0) {
			const wheres = new Set(away.map((t) => t.where));
			wide.push(
				wheres.size === 1
					? `${count(away.length)} OF THEM TICKED IN ${[...wheres][0]}`
					: `${count(away.length)} NOT IN THIS LIST`
			);
		}
	}
	const right = sources.length === 1 ? sources[0].name.toUpperCase() : sourcesWord(sources.length);
	return { lead, wide, phone, right, rightPhone: sourcesWord(sources.length) };
}

/** How many chapters FIRST 10 EACH asks for at most, by unit: `UP TO 90 CHAPTERS`, `UP TO 40 CHAPTERS · 20 EPISODES`. */
export function firstTenLine(ticks: readonly Tick[]): string {
	const by = new Map<string, number>();
	for (const t of ticks) {
		const u = unitOf(t.source.family);
		by.set(u, (by.get(u) ?? 0) + 10);
	}
	const parts = ['CHAPTERS', 'EPISODES']
		.filter((u) => by.has(u))
		.map((u) => `${count(by.get(u) ?? 0)} ${u}`);
	return parts.length ? `UP TO ${parts.join(' · ')}` : '';
}

/** ADD TO LIBRARY's second line: `9 SERIES · NOTHING DOWNLOADS`. */
export const addOnlyLine = (n: number) => `${count(n)} SERIES · NOTHING DOWNLOADS`;

/** One source's rows in SHOW: in the order ticked, and how many the list on screen doesn't draw. */
export type ShowGroup = { source: TickSource; ticks: Tick[]; away: number };

/**
 * SHOW's groups: the whole selection by source, each in the order it was
 * ticked, the sources in the order their first tick was made. `ids` is what
 * the sheet listed when it opened (an untick there keeps its row until the
 * sheet closes), `facts` every tick's facts.
 */
export function showGroups(
	ids: readonly string[],
	facts: ReadonlyMap<string, Tick>,
	here: string | null
): ShowGroup[] {
	const groups = new Map<string, ShowGroup>();
	for (const id of ids) {
		const t = facts.get(id);
		if (!t) continue;
		let g = groups.get(t.source.id);
		if (!g) groups.set(t.source.id, (g = { source: t.source, ticks: [], away: 0 }));
		g.ticks.push(t);
		if (here !== null && t.list !== here) g.away++;
	}
	return [...groups.values()];
}

/** A SHOW row's second line: `MANGA · TICKED IN POPULAR · SAME TITLE IN LIBRARY`. */
export function showMeta(t: Tick): string {
	return [kindWord(t.source.family), `TICKED IN ${t.where}`, t.twin ? 'SAME TITLE IN LIBRARY' : '']
		.filter(Boolean)
		.join(' · ');
}

/** BROWSE's row: how many of a source's series are ticked (`9 TICKED`), or nothing. */
export function tickedHere(ticks: readonly Tick[], sourceId: string): string {
	const n = ticks.filter((t) => t.source.id === sourceId).length;
	return n > 0 ? `${count(n)} TICKED` : '';
}

/**
 * Whether a navigation stays in the browse world, where a selection lasts:
 * BROWSE, a source's page (its search, FILTER and a tag's arrival are the same
 * route), and a preview, which a long press opens. A source's SETTINGS, the
 * library, a series, the queue and everything else end it.
 */
export const BROWSE_WORLD: ReadonlySet<string> = new Set([
	'/browse',
	'/browse/[source]',
	'/downloads/source/[id]'
]);

export const inBrowseWorld = (routeId: string | null | undefined) =>
	!!routeId && BROWSE_WORLD.has(routeId);
