import { KINDS, type Kind } from '$lib/library/kinds';

/**
 * SEARCH THE SOURCES' KIND band (c699; doc/DOWNLOADING.md, "Searching the
 * sources"): which kinds the installed sources serve, and which sources a
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
	anime: 'ANIME'
} satisfies Record<Kind, string>;

/** The kinds at least one source serves, in the registry's order (the band's cells after ALL). */
export function kindsServed(sources: readonly { kind: Kind | null }[]): Kind[] {
	const served = new Set(sources.map((s) => s.kind));
	return KINDS.filter((k) => served.has(k));
}

/**
 * The kind a `?kind=` names, if a source serves it: any other word (a kind no
 * installed source serves, a library kind like DOUJINS, a typo) is ALL, today's
 * search, rather than a band with nothing under it.
 */
export function kindAsked(raw: string | null, served: readonly Kind[]): Kind | null {
	return served.find((k) => k === raw) ?? null;
}

/** The sources a kind asks; every one under ALL. */
export function sourcesOfKind<S extends { kind: Kind | null }>(
	sources: readonly S[],
	kind: Kind | null
): S[] {
	return kind === null ? [...sources] : sources.filter((s) => s.kind !== null && s.kind === kind);
}
