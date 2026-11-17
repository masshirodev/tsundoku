import { getDb } from './db.ts';
import {
	addToLibrary,
	isDownloadsError,
	isSourceMangaId,
	mangaKey,
	queueSeries,
	seriesForKey,
	sourceOfMangaId,
	undoAdd
} from './downloads.ts';
import { isAdding } from './engine/adding.ts';
import { AddError } from './engine/backend.ts';
import { browseSource } from './engine/browse.ts';
import { EngineError } from './engine/client.ts';
import { addWatchingHidden, addedHere, sourceFlags } from './engine/source-flags.ts';
import { collectionExists, setInCollection } from './library.ts';
import { NovelAddError, NovelSourceError } from './novels/source.ts';
import { seriesPage } from './series.ts';
import type { FailReason, PressAnswer, UndoAnswer, Which } from '../library/browse-press.ts';

/**
 * The server's half of a SELECT press (doc/BROWSE.md, "The
 * press"). The page drives the run: it asks this function once per
 * series, a lane per source, and keeps the answers for the band, UNDO and the
 * shelves. Every path here is a preview's own, for many: ADD through
 * `addToLibrary` (the families' add paths, `keepOrPromote` and ADDED HIDDEN's
 * `hideIfAddedHidden` within), FIRST 10 and ALL through `queueSeries` as
 * ADD AND DOWNLOAD queues them, UNDO through `undoAdd`, and a shelf through
 * `setInCollection`. So a press can't add, queue or undo differently from
 * one series' own ADD.
 *
 * Each series is one request and one add: a tab closed mid-run leaves every
 * series either added whole (with its queue) or not asked at all.
 */

/** The ids one UNDO, shelf or touched read takes at most: a press is a person's ticks, not a catalog. */
export const PRESS_MAX = 500;

/** A failed add, in the word the band says. */
function reasonOf(e: unknown): FailReason {
	if (e instanceof EngineError) {
		if (e.failure === 'down' || e.failure === 'unauthorized' || e.failure === 'not-loaded')
			return 'no-answer';
		if (e.failure === 'rate-limited' || e.failure === 'refused') return 'refused';
		if (e.failure === 'not-found' || e.failure === 'not-at-source') return 'gone';
		return 'failed';
	}
	if (e instanceof AddError || e instanceof NovelAddError) {
		const m = (e as Error).message;
		if (/deleted here once/.test(m)) return 'deleted';
		if (/another series here/.test(m)) return 'clash';
		if (/isn’t at its source/.test(m)) return 'gone';
		return 'failed';
	}
	if (e instanceof NovelSourceError || isDownloadsError(e)) return 'no-answer';
	return 'failed';
}

/**
 * Whether the press may add from a source for this viewer. Hidden means
 * hidden: outside reveal a mostly-hidden source is not found, as its page and
 * its previews are not. One exception: a source whose ADDED HIDDEN switch is
 * on (and not HIDDEN SOURCE) becomes mostly hidden *by the press itself*,
 * after its first series or two are added hidden, and the rest of its lane is
 * still the viewer's own to add (the rule for one ADD, for many).
 */
function mayAddFrom(sourceId: string, reveal: boolean): boolean {
	if (browseSource(sourceId, reveal)) return true;
	if (!browseSource(sourceId, true)) return false;
	const f = sourceFlags(sourceId);
	return f.addedHidden && !f.hidden;
}

/**
 * One series of a press: checked again now, then added, then queued.
 *
 * - IN LIBRARY since it was ticked (another tab, a preview): skipped, said.
 * - ADDING now, by a preview's ADD or another press: skipped, said.
 * - added through the add path, watching whether this add hid it, and
 *   for FIRST 10 or ALL queued as ADD AND DOWNLOAD queues ("next" is what the
 *   preview's FIRST 10 asks of a series with nothing downloaded).
 *
 * An add that stands while the queue doesn't answer is still an add
 * (`queued: 'down'`), as the preview's ADD AND DOWNLOAD says.
 */
export async function pressOne(id: string, which: Which, reveal: boolean): Promise<PressAnswer> {
	const sourceId = isSourceMangaId(id) ? sourceOfMangaId(id) : null;
	if (!sourceId || !mayAddFrom(sourceId, reveal)) return { status: 'failed', reason: 'gone' };
	let key: string | null;
	try {
		key = await mangaKey(id);
	} catch (e) {
		return { status: 'failed', reason: reasonOf(e) };
	}
	if (!key) return { status: 'failed', reason: 'gone' };
	if (seriesForKey(key)) return { status: 'skipped', reason: 'in-library' };
	// Nothing waits between this question and the add's own mark (`whileAdding`).
	if (isAdding(id)) return { status: 'skipped', reason: 'adding' };
	let added: { seriesId: number; hidByThisAdd: boolean };
	try {
		added = await addWatchingHidden(key, () => addToLibrary(id));
	} catch (e) {
		return { status: 'failed', reason: reasonOf(e) };
	}
	let queued: number | 'down' | null = null;
	if (which !== 'none') {
		// The series this add hid is the viewer's to queue, reveal or not.
		const s = seriesPage(added.seriesId, reveal || added.hidByThisAdd);
		try {
			const r = s
				? await queueSeries(added.seriesId, s.entries, which === 'all' ? 'all' : 'next')
				: null;
			queued = r ? r.queued : 0;
		} catch (e) {
			if (!isDownloadsError(e)) throw e;
			queued = 'down';
		}
	}
	return {
		status: 'added',
		seriesId: added.seriesId,
		hidden: added.hidByThisAdd,
		// Asked after the add: `addToLibrary` forgets BROWSE's counts, so this is fresh.
		sourceHidden: !browseSource(sourceId, false),
		queued
	};
}

/** A series a press added, as the page holds it: its id and the result it was added from. */
export type PressSeries = { series: number; preview: string };

/** The press's series that are still the ones it added (their id and key both, `addedHere`). */
async function stillOurs(items: readonly PressSeries[]) {
	const out: { series: number; touched: boolean }[] = [];
	let gone = 0;
	for (const { series, preview } of items.slice(0, PRESS_MAX)) {
		const key = isSourceMangaId(preview) ? await mangaKey(preview).catch(() => null) : null;
		const here = key && Number.isInteger(series) && series > 0 ? addedHere(series, key) : null;
		if (here) out.push({ series, touched: here.touched });
		else gone++;
	}
	return { out, gone };
}

/**
 * Which of a press's series have something downloaded or read now: UNDO
 * leaves those (Results E, before), so the band says so before it is pressed.
 */
export async function touchedOf(items: readonly PressSeries[]): Promise<number[]> {
	return (await stillOurs(items)).out.filter((s) => s.touched).map((s) => s.series);
}

/**
 * UNDO for a whole press (Results E): every series of it with nothing
 * downloaded or read leaves the library, and its queued chapters with it (the
 * queue's rows go with their series). A series is trusted only while its id
 * and its key are still the ones the press added (`addedHere`): an id is
 * reused once its series is gone, so the id alone could name a later one.
 * What stays is counted, and so is what is gone already (UNDO twice).
 */
export async function undoPress(items: readonly PressSeries[]): Promise<UndoAnswer> {
	const { out: ours, gone } = await stillOurs(items);
	const queuedOf = getDb().prepare(`SELECT COUNT(*) AS n FROM download_queue WHERE series_id = ?`);
	const answer: UndoAnswer = { out: 0, stayed: 0, gone, queuedOut: 0 };
	for (const s of ours) {
		if (s.touched) {
			answer.stayed++;
			continue;
		}
		const queued = (queuedOf.get(s.series) as { n: number }).n;
		if (await undoAdd(s.series)) {
			answer.out++;
			answer.queuedOut += queued;
		} else answer.stayed++;
	}
	return answer;
}

/**
 * PUT ON A SHELF for a press (the ADD band's chips, for many): one
 * chip's tap, on or off, for every series of the press still its own. The
 * SHELVES sheet's own write.
 */
export async function shelvePress(
	items: readonly PressSeries[],
	collection: number,
	on: boolean
): Promise<{ shelved: number } | { status: 400; message: string }> {
	if (!Number.isInteger(collection) || !collectionExists(collection))
		return { status: 400, message: 'no such shelf' };
	const { out } = await stillOurs(items);
	setInCollection(
		out.map((s) => s.series),
		collection,
		on
	);
	return { shelved: out.length };
}

/** A press's series from a request's body, at most `PRESS_MAX`, junk dropped. */
export function readPressSeries(body: unknown): PressSeries[] {
	const list = (body as { items?: unknown } | null)?.items;
	if (!Array.isArray(list)) return [];
	const out: PressSeries[] = [];
	for (const v of list.slice(0, PRESS_MAX)) {
		const series = Number((v as { series?: unknown })?.series);
		const preview = String((v as { preview?: unknown })?.preview ?? '');
		if (Number.isInteger(series) && series > 0 && isSourceMangaId(preview))
			out.push({ series, preview });
	}
	return out;
}
