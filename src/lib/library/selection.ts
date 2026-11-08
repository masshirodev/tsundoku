import type { Kind } from './types.ts';

/**
 * What the library's SELECT keeps about a series it ticked (c698;
 * doc/LIBRARY.md, "A selection outlives the shelf").
 *
 * The selection outlives a shelf, a kind, a filter or a tag changing, so it
 * holds series the grid no longer draws. Every bulk action that reads facts
 * off a selected series (GROUP's rows and its BY HAND order, HIDE's question
 * about a Work, FOLD's languages, UNHIDE's "all hidden", DELETE's titles,
 * SHOW's list) used to read them off the cards on screen, so a series ticked
 * on one shelf and then out of sight was silently left out of GROUP. These
 * are those facts, noted while the series was on screen and refreshed each
 * time it is drawn again. The server stays the judge of every action: a fact
 * gone stale since it was noted only words a sheet, never decides a write.
 */
export type Picked = {
	id: number;
	title: string;
	hue: number;
	addedAt: number;
	cover: number | null;
	kind: Kind;
	entryCount: number;
	/** The row's second line, as GROUP's sheet draws it: "MANGA · 58 CH. · 41 READ". */
	meta: string;
	/**
	 * The Work the page's `workFeet` said it is a part of: HIDE asks first
	 * about a Work (W4). Only the feet, as the bulk bar has always read them:
	 * a deep Work tile's parts have none, and its HIDE posts at once.
	 */
	work: { id: number; name: string } | null;
	/** The Work GROUP's row names ("IN <WORK> · MOVES HERE"): a Work tile's own name too. */
	inWork: string | null;
	hidden: boolean;
	/** FOLD AS LANGUAGES reads these two (doc/EDITIONS.md). */
	language: string | null;
	languages: string[] | undefined;
};

/** The facts of what is selected, in the order it was selected; ids never seen are left out. */
export function pickedInOrder(ids: Iterable<number>, facts: ReadonlyMap<number, Picked>): Picked[] {
	const out: Picked[] = [];
	for (const id of ids) {
		const f = facts.get(id);
		if (f) out.push(f);
	}
	return out;
}

/**
 * How many selected ids the page has never drawn: SELECT ALL takes the
 * shelf's pages not yet loaded by id alone (doc/LIBRARY.md, "Pages").
 */
export function unseenCount(ids: Iterable<number>, facts: ReadonlyMap<number, Picked>): number {
	let n = 0;
	for (const id of ids) if (!facts.has(id)) n++;
	return n;
}

/**
 * The first few titles, so DELETE's question names what it is about:
 * "A, B, C AND 4 MORE". The count is the whole selection's, seen or not.
 */
export function titlesLine(ids: Iterable<number>, facts: ReadonlyMap<number, Picked>): string {
	const all = [...ids];
	const names = pickedInOrder(all, facts).map((p) => p.title);
	if (names.length === 0) return '';
	const shown = names.slice(0, 3);
	const rest = all.length - shown.length;
	const line = shown.join(', ').toUpperCase();
	return rest > 0 ? `${line} AND ${rest} MORE` : line;
}

/**
 * The Work a selected series is in: the page's own answer for a series it
 * draws (`workFeet`, fresh with each load), else what was noted when it was
 * ticked.
 */
export function workOf(
	id: number,
	feet: Readonly<Record<string, { id: number; name: string } | undefined>>,
	facts: ReadonlyMap<number, Picked>
): { id: number; name: string } | null {
	const here = feet[String(id)];
	if (here) return { id: here.id, name: here.name };
	return facts.get(id)?.work ?? null;
}

/**
 * Note the facts of every drawn series that is selected, and forget those of
 * series no longer selected -- except `held`, the rows SHOW lists while it is
 * open, whose untick is undone where it was made. Returns the changes, so a
 * reactive map is only written when something changed (writing it each time
 * would re-run every reader of it).
 */
export function refreshFacts(
	selected: ReadonlySet<number>,
	facts: ReadonlyMap<number, Picked>,
	drawn: Iterable<Picked>,
	held: ReadonlySet<number> = new Set()
): { set: Picked[]; drop: number[] } {
	const set: Picked[] = [];
	for (const p of drawn) {
		if (!selected.has(p.id)) continue;
		const had = facts.get(p.id);
		if (!had || !samePicked(had, p)) set.push(p);
	}
	const drop: number[] = [];
	for (const id of facts.keys()) if (!selected.has(id) && !held.has(id)) drop.push(id);
	return { set, drop };
}

function samePicked(a: Picked, b: Picked): boolean {
	return (
		a.title === b.title &&
		a.hue === b.hue &&
		a.addedAt === b.addedAt &&
		a.cover === b.cover &&
		a.kind === b.kind &&
		a.entryCount === b.entryCount &&
		a.meta === b.meta &&
		a.work?.id === b.work?.id &&
		a.work?.name === b.work?.name &&
		a.inWork === b.inWork &&
		a.hidden === b.hidden &&
		a.language === b.language &&
		(a.languages ?? []).join(',') === (b.languages ?? []).join(',')
	);
}
