import { SvelteSet } from 'svelte/reactivity';
import { hueFor } from './cover.ts';
import { count, kindLabel, sheetMeta, unitLabel } from './labels.ts';
import { isFinished, type LibraryCard, type WorkPart } from './works.ts';
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
 * The drawn series to note facts from (c740): none while SELECT is off or
 * nothing is ticked, without calling `drawn` at all. Building a Picked record
 * for every loaded series and Work part (`sheetMeta` included) on each load
 * was an O(n) pass the page paid on every reload with nothing selected. What
 * the skipped pass would have dropped is still dropped: `refreshFacts` with no
 * drawn series forgets every fact not selected or held, which is how SHOW's
 * held rows keep theirs while the last tick is undone in the sheet.
 */
export function drawnToNote(
	selecting: boolean,
	selected: ReadonlySet<number>,
	drawn: () => Iterable<Picked>
): Iterable<Picked> {
	return selecting && selected.size > 0 ? drawn() : [];
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

/** A Work as the page names it: what `Picked.work` holds. */
type WorkName = { id: number; name: string };

/**
 * A series card's facts, as a selection keeps them: a library tile in no
 * Work, or a search's title hit (the search answers the same card shape,
 * `LibraryCard & { why }`). `work` is the Work it is a part of, where the
 * page knows it.
 */
export function pickedOfCard(c: LibraryCard, work: WorkName | null): Picked {
	return {
		id: c.id,
		title: c.title,
		hue: c.hue,
		addedAt: c.addedAt,
		cover: c.cover,
		kind: c.kind,
		entryCount: c.entryCount,
		meta: sheetMeta(c),
		work,
		inWork: work?.name ?? null,
		hidden: c.hidden,
		language: c.language ?? null,
		languages: c.languages
	};
}

/**
 * A Work's part, as a selection keeps it: a part of a Work tile in the
 * library, or of a Work the search found by name. `inWork` is the Work's own
 * name, which GROUP's row reads ("IN <WORK> · MOVES HERE").
 */
export function pickedOfPart(p: WorkPart, inWork: string, work: WorkName | null): Picked {
	return {
		id: p.seriesId,
		title: p.title,
		hue: hueFor(p.title),
		addedAt: p.addedAt,
		cover: p.cover,
		kind: p.kind,
		entryCount: p.entries,
		meta: `${kindLabel(p.kind)} · ${count(p.entries)} ${unitLabel(p.kind)}${isFinished(p) ? ' · READ ✓' : ''}`,
		work,
		inWork,
		hidden: p.hidden,
		// FOLD is the grid's: a Work's part is never folded from a selection.
		language: null,
		languages: undefined
	};
}

/**
 * How a Work's row stands in a selection (the search's Work hit, c698): every
 * part ticked, some, or none. A tap on a row not wholly ticked ticks the rest,
 * as a Work tile's does; a tap on a wholly ticked one unticks every part.
 */
export function workTicks(
	parts: readonly number[],
	selected: ReadonlySet<number>
): { ticked: number; total: number; state: 'all' | 'some' | 'none' } {
	const ticked = parts.filter((id) => selected.has(id)).length;
	const total = parts.length;
	const state = total > 0 && ticked === total ? 'all' : ticked > 0 ? 'some' : 'none';
	return { ticked, total, state };
}

/** The ids a tap on a Work's row ticks (`add`) or unticks (`remove`). */
export function workTap(
	parts: readonly number[],
	selected: ReadonlySet<number>
): { add: number[]; remove: number[] } {
	if (workTicks(parts, selected).state === 'all') return { add: [], remove: [...parts] };
	return { add: parts.filter((id) => !selected.has(id)), remove: [] };
}

/**
 * A selection on its way between the library and the search (c698;
 * doc/LIBRARY.md, "What ends SELECT"): the ids in the order they were ticked,
 * their facts, and the address it is going to.
 */
export type Carried = {
	ids: number[];
	facts: Picked[];
	/** Where the navigation that carries it lands: `pathname + search`. */
	to: string;
};

/**
 * The one selection in flight, in this tab's memory and nowhere else: not the
 * URL (a link or a new tab must not arrive selecting), not history state (a
 * reload must end SELECT, and a browser keeps history state across one), not
 * storage. So a reload or a new tab starts with none, and a client-side
 * navigation -- a tap, ←, Android's back, the browser's forward -- carries it.
 * Only the browser writes it: on the server this module is shared by every
 * request, so `carrySelection` refuses to write there.
 */
let inFlight: Carried | null = null;

export function carrySelection(c: Carried): void {
	if (typeof window === 'undefined') return;
	inFlight = { ids: [...c.ids], facts: [...c.facts], to: c.to };
}

/**
 * The selection carried to `here` (`pathname + search`), taken once. One
 * carried anywhere else is dropped: a navigation that was cancelled or
 * redirected must not leave a selection for the next arrival to pick up.
 */
export function takeCarried(here: string): Carried | null {
	const c = inFlight;
	inFlight = null;
	return c && c.to === here ? c : null;
}

/** Where a URL lands, as `Carried.to` and `takeCarried` compare it. */
export const landing = (u: URL): string => `${u.pathname}${u.search}`;

/**
 * The facts of `want` among cards the library answered by id (c737; POST
 * `/api/library`, the grid's own card shape): a series in no Work as itself,
 * a Work tile's wanted parts as parts. A wanted id the answer does not hold
 * (deleted since, or hidden with reveal off) is simply absent.
 */
export function pickedOfCards(cards: readonly LibraryCard[], want: ReadonlySet<number>): Picked[] {
	const out: Picked[] = [];
	for (const c of cards) {
		if (!c.tile) {
			if (want.has(c.id)) out.push(pickedOfCard(c, null));
			continue;
		}
		const work = { id: c.tile.id, name: c.tile.name };
		for (const p of c.tile.parts)
			if (want.has(p.seriesId)) out.push(pickedOfPart(p, c.tile.name, work));
	}
	return out;
}

/** How many ids at most one by-id read answers: the grid's own cap. */
export const FACTS_MAX = 10_000;

/** The facts of `ids` from the library by id (c737), or null when it could not be asked. */
export async function readFacts(ids: readonly number[]): Promise<Picked[] | null> {
	try {
		const res = await fetch('/api/library', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ids })
		});
		if (!res.ok) return null;
		const { series } = (await res.json()) as { series: LibraryCard[] };
		return pickedOfCards(series, new Set(ids));
	} catch {
		return null;
	}
}

/**
 * Filling in the facts of selected series the page never drew (c737): SELECT
 * ALL's pages not loaded, so SHOW lists them and GROUP counts them. One read
 * for every selected id without facts that is not already being asked or
 * already answered as gone. An id the library does not answer (deleted
 * since, or hidden with reveal off: hidden means hidden) is taken out of the
 * selection and counted in `gone`, so no bulk action posts a series the
 * owner can no longer see. A read that answers after `reset` (✕, a bulk
 * action's success) is dropped. Reactive sets, so SHOW redraws as it lands.
 */
export class UnseenFacts {
	/** Ids being asked for now. */
	readonly asking = new SvelteSet<number>();
	/** Ids the library answered nothing for, taken out of the selection. */
	readonly gone = new SvelteSet<number>();
	#gen = 0;
	readonly #read: (ids: readonly number[]) => Promise<Picked[] | null>;

	constructor(read: (ids: readonly number[]) => Promise<Picked[] | null> = readFacts) {
		this.#read = read;
	}

	async fill(
		selected: Set<number>,
		facts: Map<number, Picked>,
		held: () => ReadonlySet<number> = () => new Set()
	): Promise<void> {
		const want = [...selected].filter(
			(id) => !facts.has(id) && !this.asking.has(id) && !this.gone.has(id)
		);
		if (want.length === 0) return;
		const gen = this.#gen;
		for (const id of want) this.asking.add(id);
		const got = await this.#read(want);
		if (gen !== this.#gen) return;
		for (const id of want) this.asking.delete(id);
		// Not asked: offline, or the server refused. They stay selected and
		// unlisted, and the next SHOW asks again.
		if (!got) return;
		const keep = held();
		const answered = new Set<number>();
		for (const p of got) {
			answered.add(p.id);
			if (selected.has(p.id) || keep.has(p.id)) facts.set(p.id, p);
		}
		for (const id of want) {
			if (answered.has(id)) continue;
			this.gone.add(id);
			selected.delete(id);
		}
	}

	reset(): void {
		this.#gen++;
		this.asking.clear();
		this.gone.clear();
	}
}
