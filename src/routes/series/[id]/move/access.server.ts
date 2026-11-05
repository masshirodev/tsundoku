import { error, type Cookies } from '@sveltejs/kit';
import { isRevealed } from '$lib/server/prefs';
import { seriesPage } from '$lib/server/series';
import { isDownloadsError, searchSource } from '$lib/server/downloads';
import {
	moveComparison,
	moveSources,
	moveState,
	MoveError,
	type MoveComparison,
	type MoveState
} from '$lib/server/move';
import type { Settled } from '$lib/library/settled';
import type { SearchHit } from '$lib/server/download-types';

/**
 * The doors of the move page (doc/MOVE.md): the page, its comparison and its
 * one-source ask (card c491) all answer the same 404 for a series that is
 * hidden with reveal off, or isn't one MOVE is offered for.
 */
export function movable(
	raw: string,
	cookies: Cookies
): {
	id: number;
	reveal: boolean;
	state: MoveState;
	series: NonNullable<ReturnType<typeof seriesPage>>;
} {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(404, 'not found');
	const reveal = isRevealed(cookies);
	const series = seriesPage(id, reveal);
	if (!series) error(404, 'not found');
	const state = moveState(id);
	if (!state.eligible) error(404, 'not found');
	return { id, reveal, state, series };
}

/** The offset the URL or the form names, when it is a whole number. */
export const offsetOf = (raw: string | null | undefined): number | null =>
	raw && /^\d+$/.test(raw) ? Number(raw) : null;

/**
 * The comparison for one candidate as a Settled, never rejecting on a source
 * that wouldn't say: the page draws that as its own state, with TRY AGAIN.
 *
 * `signal` is the request's (c539): a pick the owner has already left. The
 * engine answers one call per extension at a time (`inLane`,
 * engine/client.ts), and neither it nor `moveComparison` takes a signal, so a
 * call that has started runs to its end and its answer is dropped. What can
 * be spared is the wait: compares take turns here, one source at a time, and
 * an ask dropped while it waits for its turn never reaches the engine, so the
 * last pick waits behind the one call already running, not behind every pick
 * made before it.
 *
 * And a waiting ask whose turn comes after a newer pick of the same series
 * from the same source was queued is dropped too, whatever its socket says
 * (c567, doc/MOVE.md, "Picks take turns"): the server hears of a dropped
 * request's abort only when its socket closes, up to 279 ms after the page
 * gave it up (wave 24's measure), and a turn could come in that gap.
 */
export async function compared(
	id: number,
	to: string,
	reveal: boolean,
	offset: number | null,
	signal?: AbortSignal
): Promise<Settled<MoveComparison>> {
	return inTurn({ source: to.split('~')[0] ?? '', series: id, signal }, async () => {
		try {
			const value = await moveComparison(id, to, reveal, offset);
			return value ? { ok: true, value } : { ok: false, error: 'This series does not move' };
		} catch (e) {
			if (e instanceof MoveError || isDownloadsError(e))
				return { ok: false, error: (e as Error).message };
			throw e;
		}
	});
}

/** What a dropped ask answers: nobody reads it, the page that asked has moved on. */
export const DROPPED: Settled<MoveComparison> = { ok: false, error: 'Asked for another candidate' };

/** The compare in front, per source: each waits for the one before it. */
const turns = new Map<string, Promise<void>>();

/**
 * The newest pick per source and series: the number of the last ask queued
 * for that pair. "Newer" is exactly that, a later ask of the same series from
 * the same source, which is a later pick on the same move page (or the same
 * series' page on another device: see doc/MOVE.md). A pick of the same series
 * from another source waits in another lane and is never behind this one, so
 * it drops nothing here; a pick of another series is another page's.
 */
const newest = new Map<string, number>();
let asks = 0;
/** Asks in each source's lane, waiting or running: none means a new one's turn is now. */
const inLane = new Map<string, number>();

/**
 * Run [ask] after the source's earlier compares. It is skipped, answering
 * DROPPED without asking, when [signal] aborts while it waits, or when a
 * newer ask of the same series from the same source was queued by the time
 * its turn comes. An ask with no signal (the page's own load, which nothing
 * can drop) is never skipped, but it is still newer than the ones before it.
 */
export async function inTurn<T>(
	at: { source: string; series: number; signal?: AbortSignal },
	ask: () => Promise<T | Settled<MoveComparison>>
): Promise<T | Settled<MoveComparison>> {
	const { source, signal } = at;
	const pick = `${source}\u0000${at.series}`;
	const n = ++asks;
	newest.set(pick, n);
	// Only an ask that waited can be overtaken: with nobody in front its turn
	// came as it arrived, and a pick queued a moment later is behind it.
	const waits = (inLane.get(source) ?? 0) > 0;
	inLane.set(source, (inLane.get(source) ?? 0) + 1);
	const before = turns.get(source) ?? Promise.resolve();
	let done!: () => void;
	const mine = new Promise<void>((ok) => (done = ok));
	// The next one waits for this one and everything before it, so dropping
	// this one early never lets the next overtake a call still running.
	const queue = before.then(() => mine);
	turns.set(source, queue);
	try {
		if (signal && !signal.aborted) {
			await Promise.race([
				before,
				new Promise<void>((ok) => signal.addEventListener('abort', () => ok(), { once: true }))
			]);
		} else await before;
		if (signal?.aborted) return DROPPED;
		// A newer pick is queued behind this one: the page has moved on, even if
		// its abort has not reached the server yet.
		if (signal && waits && newest.get(pick) !== n) return DROPPED;
		return await ask();
	} finally {
		if (newest.get(pick) === n) newest.delete(pick);
		const left = (inLane.get(source) ?? 1) - 1;
		if (left > 0) inLane.set(source, left);
		else inLane.delete(source);
		done();
		void queue.then(() => {
			if (turns.get(source) === queue) turns.delete(source);
		});
	}
}

/** One source's answer to the query, as the list keeps it (never rejecting). */
export const askOne = (sourceId: string, q: string, reveal: boolean) =>
	searchSource(sourceId, q, reveal).then(
		(value): Settled<SearchHit[]> => ({ ok: true, value }),
		(e): Settled<SearchHit[]> => ({ ok: false, error: (e as Error).message })
	);

/** Whether [sourceId] is one MOVE asks for this series (its medium's installed sources). */
export async function asksSource(state: MoveState, reveal: boolean, sourceId: string) {
	const sources = await moveSources(state.kind, reveal, state.formerSourceId).catch(() => []);
	return sources.some((s) => s.id === sourceId);
}
