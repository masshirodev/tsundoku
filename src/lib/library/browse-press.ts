import { count } from './labels.ts';
import { SOURCE_KINDS, kindFacts } from './kinds.ts';
import { sourcesOf, type Tick, type TickSource } from './browse-select.ts';

/**
 * The press (card c868; doc/BROWSE.md, "The press"): a selection added to the
 * library in one run, each source in its own lane. Pure: the lanes, the
 * runner (its one call per series injected, so the spec drives it without a
 * server), and every line the band says while it runs, when it ends, and
 * after UNDO. The store (`browse-selection.svelte.ts`) holds a run and calls
 * these; the server's one door per series is `POST /api/browse/press`.
 */

/** How much of each series the press downloads: nothing, FIRST 10 (the preview's NEXT 10), or ALL. */
export type Which = 'none' | 'first' | 'all';

/** Why a series was not added, in a word the band can say. */
export type FailReason = 'refused' | 'no-answer' | 'gone' | 'deleted' | 'clash' | 'failed';

/** What the server answered for one series (`pressOne`). */
export type PressAnswer =
	| {
			status: 'added';
			seriesId: number;
			/** This ADD hid it: its source adds hidden (c505, `addWatchingHidden`). */
			hidden: boolean;
			/** Its source is mostly hidden outside reveal now (the add itself can make it so). */
			sourceHidden: boolean;
			/** Chapters or episodes queued; 'down' when the queue did not answer; null when nothing was asked. */
			queued: number | 'down' | null;
	  }
	| { status: 'skipped'; reason: 'in-library' | 'adding' }
	| { status: 'failed'; reason: FailReason };

/** One series of a press and its last answer: null while it waits in its lane. */
export type PressItem = { tick: Tick; answer: PressAnswer | null };

/** The words for a reason: `ASURA SCANS REFUSED 2`, `KAGURABACHI DID NOT ANSWER`. */
export const FAIL_WORDS: Record<FailReason, string> = {
	refused: 'REFUSED',
	'no-answer': 'DID NOT ANSWER',
	gone: 'IS NOT AT ITS SOURCE',
	deleted: 'WAS DELETED HERE ONCE',
	clash: 'IS ANOTHER SERIES HERE',
	failed: 'FAILED'
};

/**
 * Asked once more at the end of its lane (the Main board, "While it runs"):
 * a refusal or no answer may be a moment's. A series deleted here once, whose
 * chapters are another series', or that its source no longer has would answer
 * the same again, so it is not asked twice.
 */
export const retriable = (r: FailReason) => r === 'refused' || r === 'no-answer' || r === 'failed';

/** The selection as lanes: one per source, each in the order it was ticked. */
export function lanesOf(ticks: readonly Tick[]): Tick[][] {
	const by = new Map<string, Tick[]>();
	for (const t of ticks) {
		const lane = by.get(t.source.id);
		if (lane) lane.push(t);
		else by.set(t.source.id, [t]);
	}
	return [...by.values()];
}

/**
 * Runs a press: every lane at once, one series at a time within a lane (a
 * slow site doesn't hold a quick one up, and no site is asked twice at once
 * by the press), then each lane's retriable failures once more at its end.
 * `ask` is the server's door for one series; one that throws (offline, the
 * request refused) is a failure that did not answer. `report` hears every
 * answer as it lands, `final` false for one that will be asked again.
 */
export async function runLanes(
	ticks: readonly Tick[],
	ask: (t: Tick) => Promise<PressAnswer>,
	report: (t: Tick, answer: PressAnswer, final: boolean) => void
): Promise<void> {
	const safe = async (t: Tick): Promise<PressAnswer> => {
		try {
			return await ask(t);
		} catch {
			return { status: 'failed', reason: 'no-answer' };
		}
	};
	await Promise.all(
		lanesOf(ticks).map(async (lane) => {
			const again: Tick[] = [];
			for (const t of lane) {
				const a = await safe(t);
				const later = a.status === 'failed' && retriable(a.reason);
				if (later) again.push(t);
				report(t, a, !later);
			}
			for (const t of again) report(t, await safe(t), true);
		})
	);
}

/**
 * The items this viewer may see: outside reveal, nothing of a hidden source
 * (a press made inside reveal goes on after it ends, and its band then counts
 * only what can be seen: Rules board). An empty answer draws no band.
 */
export const visibleItems = (items: readonly PressItem[], reveal: boolean) =>
	reveal ? [...items] : items.filter((i) => !i.tick.source.hidden);

/** `ADDING 14 SERIES`, and how far: done of all, for the ink line. */
export function runningTitle(items: readonly PressItem[]): { title: string; done: number } {
	return {
		title: `ADDING ${count(items.length)} SERIES`,
		done: items.filter((i) => i.answer !== null).length
	};
}

/** The lanes' line: `MANGADEX 6 OF 9 · ASURA SCANS 2 OF 5`. */
export function lanesLine(items: readonly PressItem[]): string {
	return sourcesOf(items.map((i) => i.tick))
		.map((s) => {
			const mine = items.filter((i) => i.tick.source.id === s.id);
			const done = mine.filter((i) => i.answer !== null).length;
			return `${s.name.toUpperCase()} ${count(done)} OF ${count(mine.length)}`;
		})
		.join(' · ');
}

const isVideo = (s: TickSource) => kindFacts(SOURCE_KINDS[s.family]).medium === 'video';

/** What was queued, by unit: `140 CHAPTERS`, `40 CHAPTERS · 20 EPISODES`; '' for none. */
function queuedWords(items: readonly PressItem[]): string {
	let chapters = 0;
	let episodes = 0;
	for (const i of items) {
		const a = i.answer;
		if (a?.status !== 'added' || typeof a.queued !== 'number') continue;
		if (isVideo(i.tick.source)) episodes += a.queued;
		else chapters += a.queued;
	}
	const parts: string[] = [];
	if (chapters > 0) parts.push(`${count(chapters)} CHAPTER${chapters === 1 ? '' : 'S'}`);
	if (episodes > 0) parts.push(`${count(episodes)} EPISODE${episodes === 1 ? '' : 'S'}`);
	return parts.join(' · ');
}

/** The run's result, in the band's words (Results board). */
export type ResultLines = {
	title: string;
	detail: string;
	/** Failed series RETRY n asks again. */
	failed: Tick[];
	/** The added series, as UNDO and the shelves act on them. */
	added: { tick: Tick; seriesId: number }[];
};

/**
 * The band once a run has ended (Results A to D):
 *
 * - `ADDED 14 SERIES · 140 CHAPTERS QUEUED`, or `ADDED 11 OF 14 · …` when some were not;
 * - its detail: what failed in a word each (`3 NOT ADDED · ASURA SCANS REFUSED 2 ·
 *   KAGURABACHI DID NOT ANSWER`), what was skipped as stale (`2 SKIPPED · 1 WAS IN
 *   THE LIBRARY BY THEN · 1 WAS ALREADY BEING ADDED`), or, all added, each
 *   source's count and the shelves chosen (`MANGADEX 9 · ASURA SCANS 5 · ON LATER`);
 * - series this press added hidden (ADDED HIDDEN, c505): `· 3 OF THEM HIDDEN`,
 *   and c505's words for many. Outside reveal the tail points at reveal, and a
 *   source the press left mostly hidden is not named; inside reveal the source
 *   is named and there is no tail (c605).
 *
 * Null when nothing of the press can be seen (a run of hidden sources only, outside reveal).
 */
export function resultLines(
	all: readonly PressItem[],
	opts: { reveal: boolean; which: Which; shelves: readonly string[] }
): ResultLines | null {
	const items = visibleItems(all, opts.reveal);
	if (items.length === 0) return null;
	const added = items.flatMap((i) =>
		i.answer?.status === 'added' ? [{ tick: i.tick, seriesId: i.answer.seriesId }] : []
	);
	const failedItems = items.filter((i) => i.answer?.status === 'failed');
	const skipped = items.filter((i) => i.answer?.status === 'skipped');
	const hiddenAdds = items.filter((i) => i.answer?.status === 'added' && i.answer.hidden);
	const head =
		added.length === items.length
			? `ADDED ${count(added.length)} SERIES`
			: `ADDED ${count(added.length)} OF ${count(items.length)}`;
	const queued = opts.which === 'none' ? '' : queuedWords(items);
	const down = items.some((i) => i.answer?.status === 'added' && i.answer.queued === 'down');
	const queuedTail = queued ? `${queued} QUEUED` : '';
	const title = [
		head,
		hiddenAdds.length ? `${count(hiddenAdds.length)} OF THEM HIDDEN` : queuedTail
	]
		.filter(Boolean)
		.join(' · ');

	const detail: string[] = [];
	if (failedItems.length) {
		detail.push(`${count(failedItems.length)} NOT ADDED`);
		const groups = new Map<string, PressItem[]>();
		for (const i of failedItems) {
			const r = i.answer?.status === 'failed' ? i.answer.reason : 'failed';
			const k = `${i.tick.source.id}|${r}`;
			const g = groups.get(k);
			if (g) g.push(i);
			else groups.set(k, [i]);
		}
		for (const g of groups.values()) {
			const r = g[0].answer?.status === 'failed' ? g[0].answer.reason : 'failed';
			detail.push(
				g.length === 1
					? `${g[0].tick.title.toUpperCase()} ${FAIL_WORDS[r]}`
					: `${g[0].tick.source.name.toUpperCase()} ${FAIL_WORDS[r]} ${count(g.length)}`
			);
		}
	}
	if (skipped.length) {
		const was = skipped.filter(
			(i) => i.answer?.status === 'skipped' && i.answer.reason === 'in-library'
		).length;
		const being = skipped.length - was;
		detail.push(`${count(skipped.length)} SKIPPED`);
		if (was) detail.push(`${count(was)} WAS IN THE LIBRARY BY THEN`);
		if (being) detail.push(`${count(being)} WAS ALREADY BEING ADDED`);
	}
	if (hiddenAdds.length) {
		const sources = sourcesOf(hiddenAdds.map((i) => i.tick));
		const unnamed =
			!opts.reveal && hiddenAdds.some((i) => i.answer?.status === 'added' && i.answer.sourceHidden);
		if (unnamed) detail.push(`${count(hiddenAdds.length)} OF THEM HIDDEN BY THEIR SOURCE`);
		else
			detail.push(
				`${sources.map((s) => s.name.toUpperCase()).join(', ')} ADD${sources.length === 1 ? 'S' : ''} ITS SERIES HIDDEN`
			);
		if (queuedTail) detail.push(queuedTail);
		if (!opts.reveal)
			detail.push(
				unnamed ? 'THE SOURCE IS HIDDEN WITH THEM · REVEAL SHOWS BOTH' : 'REVEAL SHOWS THEM'
			);
	}
	if (down) detail.push('SOME NOT QUEUED · DOWNLOADING ISN’T ANSWERING');
	if (!failedItems.length && !skipped.length && !hiddenAdds.length) {
		const sources = sourcesOf(added.map((a) => a.tick));
		if (sources.length > 1)
			detail.push(
				sources
					.map(
						(s) =>
							`${s.name.toUpperCase()} ${count(added.filter((a) => a.tick.source.id === s.id).length)}`
					)
					.join(' · ')
			);
		if (opts.shelves.length)
			detail.push(`ON ${opts.shelves.map((s) => s.toUpperCase()).join(', ')}`);
	}
	return {
		title,
		detail: detail.join(' · '),
		failed: failedItems.map((i) => i.tick),
		added
	};
}

/**
 * UNDO before it is pressed (Results E): the added series with something of
 * them downloaded or read (`touched`) stay, so the cell says how many it takes
 * out, and the line what stays. Null words when nothing stays.
 */
export function undoBefore(
	added: readonly { seriesId: number }[],
	touched: readonly number[]
): { cell: string; detail: string; out: number } {
	const kept = new Set(touched);
	const stay = added.filter((a) => kept.has(a.seriesId)).length;
	const out = added.length - stay;
	if (stay === 0) return { cell: 'UNDO', detail: '', out };
	return {
		cell: out > 0 ? `UNDO ${count(out)}` : '',
		detail:
			out > 0
				? `${count(stay)} ${stay === 1 ? 'HAS' : 'HAVE'} A CHAPTER DOWNLOADED NOW · UNDO LEAVES ${stay === 1 ? 'IT' : `THOSE ${count(stay)}`}`
				: 'NO UNDO: EVERY ONE HAS SOMETHING DOWNLOADED OR READ',
		out
	};
}

/** What UNDO answered (`undoPress`). */
export type UndoAnswer = { out: number; stayed: number; gone: number; queuedOut: number };

/**
 * The band after UNDO (Results E, after): `UNDONE · 12 TAKEN OUT, WITH THEIR
 * 120 QUEUED CHAPTERS`. The queue counts rows, so the unit is the press's
 * when it has one (CHAPTERS, or EPISODES for an anime source's), and plain
 * QUEUED when it mixed both.
 */
export function undoneLines(
	u: UndoAnswer,
	items: readonly PressItem[] = []
): { title: string; detail: string } {
	const video = new Set(items.map((i) => isVideo(i.tick.source)));
	const unit = video.size !== 1 ? '' : video.has(true) ? ' EPISODES' : ' CHAPTERS';
	const title =
		u.queuedOut > 0
			? `UNDONE · ${count(u.out)} TAKEN OUT, WITH THEIR ${count(u.queuedOut)} QUEUED${unit}`
			: `UNDONE · ${count(u.out)} TAKEN OUT`;
	const detail =
		u.stayed > 0
			? `${count(u.stayed)} ${u.stayed === 1 ? 'STAYS' : 'STAY'}: SOMETHING OF ${u.stayed === 1 ? 'IT' : 'THEM'} IS DOWNLOADED OR READ · THE LIBRARY'S DELETE TAKES ${u.stayed === 1 ? 'IT' : 'THEM'} OUT`
			: '';
	return { title, detail };
}
