import { KINDS, kindFacts, type Kind } from '$lib/library/kinds';

/**
 * SEARCH THE SOURCES' KIND band (c699; doc/DOWNLOADS.md, "Finding a series, and
 * adding it"): which kinds the installed sources serve, and which sources a
 * kind asks. A source's kind is its family's, from the registry
 * (`kinds.server.ts` beside this file), never a kind's name here.
 */
export type KindedSource = { id: string; name: string; lang: string; kind: Kind | null };

/** The band's word for a kind: the library's KIND band's words, in English as `/downloads` is. */
export const KIND_TAB = {
	manga: 'MANGA',
	manhwa: 'MANHWA',
	doujin: 'DOUJINS',
	novel: 'NOVELS',
	anime: 'ANIME',
	movie: 'MOVIES',
	show: 'SHOWS'
} satisfies Record<Kind, string>;

/** The kinds at least one source serves, in the registry's order (the band's cells after ALL). */
export function kindsServed(sources: readonly { kind: Kind | null }[]): Kind[] {
	const served = new Set(sources.map((s) => s.kind));
	return KINDS.filter((k) => served.has(k));
}

/**
 * The source kind a `?kind=` asks, of those a source serves. A kind no source
 * family stores (a library filtered to MANHWA or DOUJINS, c736) asks the kind
 * that serves its medium: the registry says a manhwa is pages, and pages are
 * what the Mihon sources' kind serves. A word that is no kind, or a kind whose
 * medium no installed source serves, is ALL, today's search, rather than a
 * band with nothing under it.
 */
export function kindAsked(raw: string | null, served: readonly Kind[]): Kind | null {
	const asked = KINDS.find((k) => k === raw);
	if (!asked) return null;
	const medium = kindFacts(asked).medium;
	return (
		served.find((k) => k === asked) ?? served.find((k) => kindFacts(k).medium === medium) ?? null
	);
}

/** The sources a kind asks; every one under ALL. */
export function sourcesOfKind<S extends { kind: Kind | null }>(
	sources: readonly S[],
	kind: Kind | null
): S[] {
	return kind === null ? [...sources] : sources.filter((s) => s.kind !== null && s.kind === kind);
}
