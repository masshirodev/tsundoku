/**
 * A source's answer to a search, kept a short while (doc/DOWNLOADS.md,
 * "One search, asked once"; c1141).
 *
 * SEARCH THE SOURCES starts on ALL, which asks every source, and each kind
 * cell (ANIME, MANGA, NOVELS) is its own load. Each asked its sources again,
 * though ALL had just had their answers, and so did going back to ALL. In the
 * web edition a source's answer costs seconds of Java in the tab, one call
 * at a time, so a search across 90 sources asked twice was minutes, fighting
 * the reader's other requests for the engine.
 *
 * So one source's answer to one query is kept for ten minutes, the promise
 * itself: a kind picked while ALL is still asking waits on ALL's call
 * rather than starting its own. What is kept is the source's own answer, not
 * the hits made from it, so IN LIBRARY and SAME TITLE are worked out again
 * each time (an ADD in between shows). A failure is not kept: the next load
 * asks again. TRY AGAIN asks afresh (`fresh`), and its answer is the one kept.
 * Nothing here is written to the library; a restart forgets it all.
 */

/** How long an answer stays: a search, its kinds, and a look at a result or two. */
export const KEEP_SEARCH_MS = 10 * 60 * 1000;
/** At most this many answers, the oldest going first: a search across 90 sources is 90. */
const MAX_KEPT = 1000;

const kept = new Map<string, { at: number; answer: Promise<unknown> }>();

/** For tests: forget every kept answer. */
export const forgetSearches = () => kept.clear();

/**
 * `ask()`'s answer for this source and query: the one kept, when it is recent
 * and `fresh` is not asked for, else asked now and kept.
 */
export function keptSearch<T>(
	sourceId: string,
	query: string,
	fresh: boolean,
	ask: () => Promise<T>,
	now = Date.now()
): Promise<T> {
	const key = `${sourceId}\n${query}`;
	const hit = kept.get(key);
	if (!fresh && hit && now - hit.at < KEEP_SEARCH_MS) return hit.answer as Promise<T>;
	const answer = ask();
	// Newest last, so the oldest is the first to go.
	kept.delete(key);
	kept.set(key, { at: now, answer });
	if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value!);
	// A failure is not an answer: the next load asks again. Only this call's
	// own entry goes, not a fresher one made meanwhile.
	answer.catch(() => {
		if (kept.get(key)?.answer === answer) kept.delete(key);
	});
	return answer;
}
