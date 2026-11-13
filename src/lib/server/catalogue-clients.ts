import { byIds, searchMany } from './catalogue.ts';
import { tmdbById, tmdbSearch } from './tmdb.ts';
import type { Candidate } from '../library/catalogue.ts';
import { catalogueOf, type CatalogueProvider } from '../library/catalogues.ts';
import type { Kind } from '../library/kinds.ts';
import type { TmdbTitle } from '../library/tmdb.ts';

/**
 * The one contract a catalogue answers (card c989, extracted when TMDB became
 * the second; doc/LINKS.md, "The contract"): **search** a kind by a title,
 * with a year when one is known, best match first; and read **one entry by
 * id**, or null when the catalogue has none. Each answers in its own entry
 * shape, AniList's `Candidate` and TMDB's `TmdbTitle`, because each review
 * draws what only its catalogue knows (an anime's season, a film's runtime);
 * `entryOf` is the projection every screen can draw for either.
 *
 * Who goes through it: TMDB's every door (`tmdb-links.ts`), and AniList's
 * one-title doors, the review's SEARCH AGAIN on a season and a pasted
 * AniList id. AniList's background pass does not: it packs five titles into
 * each request (`searchMany`), and AniList's rate limit is the reason that
 * shape exists, so a one-title contract would cost it five requests for one.
 *
 * With no key, TMDB's calls refuse with `NoTmdbKey`, and every caller asks
 * `catalogueConfigured` before it gets here.
 */
export type CatalogueClient<E> = {
	provider: CatalogueProvider;
	search(kind: Kind, query: string, year?: number | null): Promise<E[]>;
	byId(kind: Kind, id: number): Promise<E | null>;
};

/** An entry as any screen can draw it, whichever catalogue answered. */
export type CatalogueEntry = {
	provider: CatalogueProvider;
	id: number;
	title: string;
	/** Its other titles, never the one in `title`. */
	alts: string[];
	year: number | null;
	/** A full image URL, or null. */
	poster: string | null;
};

const anilist: CatalogueClient<Candidate> = {
	provider: 'anilist',
	// AniList's search takes no year: a year is the review's to compare, not the query's.
	search: async (kind, query) => (await searchMany([{ title: query, kind }]))[0] ?? [],
	byId: async (kind, id) =>
		(await byIds([id], 'id_in', kind)).find((c) => c.anilistId === id) ?? null
};

const asTmdbKind = (kind: Kind): 'movie' | 'show' => {
	if (catalogueOf(kind) !== 'tmdb') throw new Error(`TMDB does not hold a ${kind}`);
	return kind as 'movie' | 'show';
};

const tmdb: CatalogueClient<TmdbTitle> = {
	provider: 'tmdb',
	// Async, so a kind TMDB does not hold rejects like any other failure, never throws.
	search: async (kind, query, year = null) => tmdbSearch(asTmdbKind(kind), query, year),
	byId: async (kind, id) => tmdbById(asTmdbKind(kind), id)
};

type Clients = { anilist: CatalogueClient<Candidate>; tmdb: CatalogueClient<TmdbTitle> };
const CLIENTS: Clients = { anilist, tmdb };

/** The client for a provider: `catalogueClient(catalogueOf(kind))` when a door holds a kind. */
export const catalogueClient = <P extends CatalogueProvider>(provider: P): Clients[P] =>
	CLIENTS[provider];

/** Either catalogue's entry, as the shape every screen can draw. */
export function entryOf(e: Candidate | TmdbTitle): CatalogueEntry {
	if ('anilistId' in e)
		return {
			provider: 'anilist',
			id: e.anilistId,
			title: e.title,
			alts: e.alts,
			year: e.year,
			poster: e.coverUrl || null
		};
	return {
		provider: 'tmdb',
		id: e.id,
		title: e.title,
		alts: e.originalTitle && e.originalTitle !== e.title ? [e.originalTitle] : [],
		year: e.year,
		poster: e.poster
	};
}
