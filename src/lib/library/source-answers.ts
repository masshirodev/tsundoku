import type { Settled } from './settled.ts';

/**
 * A list of sources asked one query, arranged as their answers arrive
 * (doc/MOVE.md, "The candidates"; doc/READING-ONLINE.md, the search page): the
 * sources with matches first, the ones still asking after them, and at
 * the end the ones that found nothing and the ones that did not answer, each
 * folded. MOVE's candidates and DOWNLOADS' search share it so both read alike.
 *
 * It works over the list's own data, each source's `Settled` answer, and knows
 * nothing about where an answer came from (the load's stream, a TRY AGAIN, a
 * comparison picked beside it).
 */

export type AskedSource = { id: string; name: string; lang?: string };

export type ArrangedAnswers<S extends AskedSource, T> = {
	/**
	 * Sources that answered with at least one hit, **in the order they
	 * answered** (the map's insertion order), so a source that answers late
	 * joins below the hits already drawn and never shoves the one under the
	 * pointer. A hit that is the series itself still counts as a match.
	 */
	matches: { source: S; hits: T[] }[];
	/**
	 * A kept source (the chosen candidate's) that answered with nothing or
	 * failed this time: drawn open after the matches, never folded away.
	 */
	kept: { source: S; answer: Settled<T[]> }[];
	/** Not answered yet, in the list's own order. */
	asking: S[];
	/** Answered with no hit, in the list's own order: folded. */
	nothing: S[];
	/** Did not answer, in the list's own order: folded, with TRY AGAIN. */
	failed: { source: S; error: string }[];
};

/**
 * Arranges [sources] by [answers]. `answers` is keyed by source id, and its
 * iteration order is the order the answers arrived (a `Map` keeps insertion
 * order; a retried source is deleted and set again, so it counts as new).
 * An answer for a source not in [sources] is ignored. [keep] names a source
 * that must stay in sight whatever it answered.
 */
export function arrangeAnswers<S extends AskedSource, T>(
	sources: readonly S[],
	answers: ReadonlyMap<string, Settled<T[]>>,
	keep: string | null = null
): ArrangedAnswers<S, T> {
	const byId = new Map(sources.map((s) => [s.id, s]));
	const matches: ArrangedAnswers<S, T>['matches'] = [];
	for (const [id, a] of answers) {
		const source = byId.get(id);
		if (source && a.ok && a.value.length > 0) matches.push({ source, hits: a.value });
	}
	const kept: ArrangedAnswers<S, T>['kept'] = [];
	const asking: S[] = [];
	const nothing: S[] = [];
	const failed: ArrangedAnswers<S, T>['failed'] = [];
	for (const s of sources) {
		const a = answers.get(s.id);
		if (!a) asking.push(s);
		else if (a.ok && a.value.length > 0) continue;
		else if (s.id === keep) kept.push({ source: s, answer: a });
		else if (a.ok) nothing.push(s);
		else failed.push({ source: s, error: a.error });
	}
	return { matches, kept, asking, nothing, failed };
}

/** How many answered (a failure is not an answer) and how many hits they found. */
export function answerCounts(answers: ReadonlyMap<string, Settled<unknown[]>>): {
	answered: number;
	found: number;
} {
	let answered = 0;
	let found = 0;
	for (const a of answers.values()) {
		if (!a.ok) continue;
		answered++;
		found += a.value.length;
	}
	return { answered, found };
}

/**
 * A source's name as the list draws it, with its language (`MANGADEX · EN`):
 * one extension often installs a source per language under one name, and
 * which one a series moves to is a real choice. A source with no language
 * says its name alone.
 */
export function sourceTitle(s: AskedSource): string {
	const name = s.name.toUpperCase();
	const lang = (s.lang ?? '').trim().toUpperCase();
	return lang ? `${name} · ${lang}` : name;
}
