import { SvelteMap } from 'svelte/reactivity';
import { inBrowseWorld, type Tick } from './browse-select.ts';
import {
	resultLines,
	runLanes,
	undoBefore,
	undoneLines,
	visibleItems,
	type PressAnswer,
	type PressItem,
	type UndoAnswer,
	type Which
} from './browse-press.ts';

/**
 * SELECT in a source's catalog, held in this tab's memory (doc/BROWSE.md,
 * "Where a selection lives").
 *
 * The library's idiom (`carrySelection` / `takeCarried`, selection.ts) keeps
 * a selection in this tab's memory and nowhere else: not the URL (a link or a
 * new tab must not arrive selecting), not history state (a reload must end
 * SELECT, and a browser keeps history state across one), not storage. A
 * catalog's selection lasts across three screens (BROWSE, any source's page,
 * and a preview opened by a long press) and a run outlives each of them, so
 * the same memory is held here once, in one module, rather than handed from
 * screen to screen: a client-side navigation keeps it, a reload or a new tab
 * starts with none, and leaving the browse world ends it (`follow`).
 *
 * Only the browser writes it: on the server this module is shared by every
 * request, so every write refuses to run there.
 */

const inBrowser = () => typeof window !== 'undefined';

/** How one series is asked of the server (`POST /api/browse/press`). */
async function askOne(t: Tick, which: Which): Promise<PressAnswer> {
	const res = await fetch('/api/browse/press', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id: t.id, which })
	});
	if (res.status === 404) return { status: 'failed', reason: 'gone' };
	if (!res.ok) return { status: 'failed', reason: 'no-answer' };
	return (await res.json()) as PressAnswer;
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
	try {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		return res.ok ? ((await res.json()) as T) : null;
	} catch {
		return null;
	}
}

/** A shelf chosen on a run's band: its collection id and name. */
export type RunShelf = { id: number; name: string };

/**
 * One press, from its start to its result (the band's whole life). Driven by
 * this page in cut 1: it lives as long as the tab does, and a tab closed
 * mid-run leaves every series asked so far added whole and the rest not asked.
 */
export class PressRun {
	readonly which: Which;
	items = $state<PressItem[]>([]);
	finished = $state(false);
	/** The shelves chosen on the band, applied to every series added, before or after the choice. */
	shelves = $state<RunShelf[]>([]);
	/** The press's series with something downloaded or read now: UNDO leaves them. */
	touched = $state<number[]>([]);
	undone = $state<UndoAnswer | null>(null);
	undoing = $state(false);
	/** Why the last UNDO or shelf could not be done, if one could not. */
	refusal = $state('');
	#onEnd: () => void;

	constructor(ticks: readonly Tick[], which: Which, onEnd: () => void = () => {}) {
		this.which = which;
		this.items = ticks.map((tick) => ({ tick, answer: null }));
		this.#onEnd = onEnd;
	}

	/** Every series of the press this run added, as the server's endpoints read them. */
	#addedSeries() {
		return this.items.flatMap((i) =>
			i.answer?.status === 'added' ? [{ series: i.answer.seriesId, preview: i.tick.id }] : []
		);
	}

	/** Runs the lanes for `ticks` (all of the press, or RETRY's failures). */
	async go(ticks: readonly Tick[] = this.items.map((i) => i.tick)) {
		this.finished = false;
		await runLanes(
			ticks,
			(t) => askOne(t, this.which),
			(t, answer) => {
				const i = this.items.findIndex((x) => x.tick.id === t.id);
				if (i >= 0) this.items[i] = { tick: this.items[i].tick, answer };
				// A shelf chosen while it runs reaches the series added after it too.
				if (answer.status === 'added')
					for (const s of this.shelves)
						void post('/api/browse/press/shelve', {
							items: [{ series: answer.seriesId, preview: t.id }],
							collection: s.id,
							on: true
						});
			}
		);
		this.finished = true;
		await this.readTouched();
		this.#onEnd();
	}

	/** RETRY n: the failed ones asked again, each in its source's lane. */
	retry() {
		const failed = this.items.filter((i) => i.answer?.status === 'failed').map((i) => i.tick);
		for (const t of failed) {
			const i = this.items.findIndex((x) => x.tick.id === t.id);
			this.items[i] = { tick: t, answer: null };
		}
		void this.go(failed);
	}

	/** Which added series UNDO would leave: read when the run ends, and again before UNDO is offered. */
	async readTouched() {
		const items = this.#addedSeries();
		if (items.length === 0) return;
		const got = await post<{ touched: number[] }>('/api/browse/press/touched', { items });
		if (got) this.touched = got.touched;
	}

	/** One chip: on or off for every series added so far, and for the rest as they are added. */
	async shelve(s: RunShelf, on: boolean) {
		this.shelves = on ? [...this.shelves, s] : this.shelves.filter((x) => x.id !== s.id);
		const items = this.#addedSeries();
		if (items.length === 0) return;
		const r = await post('/api/browse/press/shelve', { items, collection: s.id, on });
		this.refusal = r ? '' : 'NOT SHELVED · TRY AGAIN';
	}

	/** UNDO for the whole press: only what this viewer can see (`visible`). */
	async undo(reveal: boolean) {
		const items = visibleItems(this.items, reveal).flatMap((i) =>
			i.answer?.status === 'added' ? [{ series: i.answer.seriesId, preview: i.tick.id }] : []
		);
		if (items.length === 0 || this.undoing) return;
		this.undoing = true;
		const got = await post<UndoAnswer>('/api/browse/press/undo', { items });
		this.undoing = false;
		if (!got) {
			this.refusal = 'UNDO DID NOT ANSWER · TRY AGAIN';
			return;
		}
		this.refusal = '';
		this.undone = got;
		this.#onEnd();
	}

	/** The band's words for this viewer, now. Null when nothing of it may be drawn. */
	lines(reveal: boolean) {
		const items = visibleItems(this.items, reveal);
		if (items.length === 0) return null;
		if (this.undone) return { kind: 'undone' as const, ...undoneLines(this.undone, items) };
		if (!this.finished) return { kind: 'running' as const, items };
		const r = resultLines(this.items, {
			reveal,
			which: this.which,
			shelves: this.shelves.map((s) => s.name)
		});
		if (!r) return null;
		const u = undoBefore(r.added, this.touched);
		return { kind: 'result' as const, ...r, undo: u };
	}
}

class BrowseSelection {
	selecting = $state(false);
	/** The ticks, in the order they were ticked (a map keeps insertion order). */
	readonly ticks = new SvelteMap<string, Tick>();
	/** Reveal as it was when SELECT started: a selection never outlives the reveal it was made in. */
	#reveal = false;
	/** The newest press, while its band is up. */
	run = $state<PressRun | null>(null);

	get list(): Tick[] {
		return [...this.ticks.values()];
	}

	has(id: string) {
		return this.ticks.has(id);
	}

	start(reveal: boolean) {
		if (!inBrowser()) return;
		this.ticks.clear();
		this.#reveal = reveal;
		this.selecting = true;
	}

	/** ✕, Escape, a press, leaving the browse world, reveal changing: nothing stays ticked. */
	end() {
		if (!inBrowser()) return;
		this.selecting = false;
		this.ticks.clear();
	}

	toggle(t: Tick) {
		if (!inBrowser() || !this.selecting) return;
		if (this.ticks.has(t.id)) this.ticks.delete(t.id);
		else this.ticks.set(t.id, t);
	}

	/** A SHOW row's box: out, and back in where it was ticked (its facts kept by the sheet). */
	untick(id: string) {
		if (!inBrowser()) return;
		this.ticks.delete(id);
	}

	/**
	 * Where a navigation goes: anywhere outside the browse world ends SELECT
	 * (the library, a series, settings, a source's SETTINGS, the queue). A
	 * reload needs nothing: this memory does not survive one.
	 */
	follow(routeId: string | null | undefined) {
		if (this.selecting && !inBrowseWorld(routeId)) this.end();
	}

	/** Reveal turned on or off since SELECT started (HIDE AGAIN, /reveal): it ends. */
	checkReveal(reveal: boolean) {
		if (this.selecting && reveal !== this.#reveal) this.end();
	}

	/**
	 * The press: SELECT ends, and the ticks become one run, newest first in the
	 * band. Answers land as they come; `onEnd` re-reads the screen's loads so
	 * tiles say IN LIBRARY.
	 */
	press(which: Which, onEnd: () => void) {
		// One press at a time in cut 1: the band holds one run, and a second
		// would take its band (and its UNDO) away from the first.
		if (!inBrowser() || this.running) return;
		const ticks = this.list;
		if (ticks.length === 0) return;
		this.end();
		const run = new PressRun(ticks, which, onEnd);
		this.run = run;
		void run.go();
	}

	/** A press is still adding (or retrying): the bulk bar waits for it. */
	get running(): boolean {
		return !!this.run && !this.run.finished;
	}

	/** ✕ on a finished band. */
	closeRun() {
		this.run = null;
	}

	/** The ids the newest run is still to add (waiting or being asked): ADDING on their tiles. */
	addingIds(): Set<string> {
		const r = this.run;
		if (!r || r.finished) return new Set();

		return new Set(r.items.filter((i) => i.answer === null).map((i) => i.tick.id));
	}
}

/** The one selection in this tab. */
export const browseSelection = new BrowseSelection();
