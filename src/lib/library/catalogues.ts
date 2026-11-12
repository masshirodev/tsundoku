import { kindFacts, type Kind } from './kinds.ts';

/**
 * Which catalogue a kind is looked up in, and what a link to it is (card
 * c988; doc/KINDS.md, "Movies and TV shows", and `doc/LINKS.md`, "Which
 * catalogue"). The registry already says it per kind (`catalogue`); this is
 * the one answer the doors ask, so a film's link is never read as AniList's.
 *
 * **Pure.** Whether a catalogue can answer **here** (a TMDB key, a friend's
 * missing one) is `server/catalogues.ts`'s question: it reads the install's
 * environment, and the pure half must not.
 */

/** The catalogues tsundoku links to: AniList for comics and anime, TMDB for films and shows. */
export type CatalogueProvider = 'anilist' | 'tmdb';

const NAME: Record<CatalogueProvider, string> = { anilist: 'AniList', tmdb: 'TMDB' };

/** The provider's own name, as a screen says it. */
export const catalogueName = (p: CatalogueProvider): string => NAME[p];

/** The catalogue a kind's metadata and its link come from. */
export const catalogueOf = (kind: Kind): CatalogueProvider => kindFacts(kind).catalogue.provider;

/** The provider's word for the kind: AniList's `MANGA`/`ANIME`, TMDB's `movie`/`tv`. */
export const catalogueType = (kind: Kind): 'MANGA' | 'ANIME' | 'movie' | 'tv' =>
	kindFacts(kind).catalogue.type;

/** Whether a provider holds this kind at all: AniList never holds a film, TMDB never a manga. */
export const catalogueHolds = (p: CatalogueProvider, kind: Kind): boolean =>
	catalogueOf(kind) === p;

/**
 * The entry's own page, for the OPEN ↗ cell: AniList's path for a comic or an
 * anime, TMDB's `movie`/`tv` path for a film or a show. The safe door — a
 * kind is never asked of the wrong provider, so this cannot throw the way
 * `anilistUrl` (library/catalogue.ts) does for a kind AniList does not hold.
 */
export function catalogueUrl(kind: Kind, id: number): string {
	const type = catalogueType(kind);
	if (catalogueOf(kind) === 'anilist') return `https://anilist.co/${type.toLowerCase()}/${id}`;
	return `https://www.themoviedb.org/${type}/${id}`;
}
