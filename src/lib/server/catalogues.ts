import {
	catalogueName,
	catalogueOf,
	catalogueType,
	type CatalogueProvider
} from '../library/catalogues.ts';
import type { Kind } from '../library/kinds.ts';

/**
 * Which catalogues this install can ask (card c988; `doc/LINKS.md`, "Which
 * catalogue"). The pure half (`library/catalogues.ts`) says which provider a
 * kind's metadata and link come from; this half says whether that provider
 * can answer **here**.
 *
 * - **AniList** is public: it answers on every install, and needs no key.
 * - **TMDB** is the install's own key, the v4 read token when it is there
 *   and the v3 key otherwise (`TMDB_API_RC_TOKEN`, then `TMDB_API_KEY`, the
 *   data folder's `.env`). A friend's install has neither, and that is a
 *   state, not an error: a door says `SET UP →`, the film still works, and no
 *   call is made.
 *
 * Read at call time, never at import: a key added in SETTINGS takes effect
 * without a restart, and a test can set one.
 */

/** The install's TMDB key, the v4 read token first. Empty when it has none. */
export function tmdbKey(): string {
	return (process.env.TMDB_API_RC_TOKEN ?? '').trim() || (process.env.TMDB_API_KEY ?? '').trim();
}

/** Whether a provider can answer on this install. AniList always can. */
export const catalogueConfigured = (provider: CatalogueProvider): boolean =>
	provider === 'anilist' || tmdbKey() !== '';

export type CatalogueState = {
	provider: CatalogueProvider;
	name: string;
	type: 'MANGA' | 'ANIME' | 'movie' | 'tv';
	/** False when this install has no key for it: every door answers "not linked", never an error. */
	configured: boolean;
};

/** What a kind's catalogue is here: which, its word for the kind, and whether it can answer. */
export function catalogueFor(kind: Kind): CatalogueState {
	const provider = catalogueOf(kind);
	return {
		provider,
		name: catalogueName(provider),
		type: catalogueType(kind),
		configured: catalogueConfigured(provider)
	};
}

/** Why a kind's catalogue cannot answer, or null when it can. */
export function catalogueMissing(kind: Kind): 'no-key' | null {
	return catalogueFor(kind).configured ? null : 'no-key';
}
