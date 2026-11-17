import {
	catalogueName,
	catalogueOf,
	catalogueType,
	type CatalogueProvider
} from '../library/catalogues.ts';
import type { Kind } from '../library/kinds.ts';
import { getSetting } from './settings.ts';

/**
 * Which catalogues this install can ask (`doc/LINKS.md`, "Which
 * catalogue"). The pure half (`library/catalogues.ts`) says which provider a
 * kind's metadata and link come from; this half says whether that provider
 * can answer **here**.
 *
 * - **AniList** is public: it answers on every install, and needs no key.
 * - **TMDB** is the install's own key, the v4 read token when it is there
 *   and the v3 key otherwise (`TMDB_API_RC_TOKEN`, then `TMDB_API_KEY`, the
 *   data folder's `.env`). An install may have neither, and that is a
 *   state, not an error: a screen says `SET UP →`, the film still works, and no
 *   call is made.
 *
 * Read at call time, never at import: a key added in SETTINGS takes effect
 * without a restart, and a test can set one.
 */

/** The environment's TMDB key, the v4 read token first; '' for none. */
export const envTmdbKey = (): string =>
	(process.env.TMDB_API_RC_TOKEN ?? '').trim() || (process.env.TMDB_API_KEY ?? '').trim();

/**
 * The install's TMDB key: the environment's, else the one typed in SETTINGS.
 * Empty when it has none. Read at every call, so a key saved or removed takes
 * effect without a restart.
 */
export function tmdbKey(): string {
	return envTmdbKey() || getSetting('tmdb_key').trim();
}

/** A v4 read token is a JWT (three dot-separated parts) and goes as a bearer; a v3 key goes in the URL. */
export const isBearerKey = (key: string): boolean => key.split('.').length === 3;

/** Whether a provider can answer on this install. AniList always can. */
export const catalogueConfigured = (provider: CatalogueProvider): boolean =>
	provider === 'anilist' || tmdbKey() !== '';

export type CatalogueState = {
	provider: CatalogueProvider;
	name: string;
	type: 'MANGA' | 'ANIME' | 'movie' | 'tv';
	/** False when this install has no key for it: every screen answers "not linked", never an error. */
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
