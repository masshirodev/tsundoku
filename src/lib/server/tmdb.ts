import { tmdbKey } from './catalogues.ts';
import type { TmdbTitle } from '../library/tmdb.ts';

/**
 * TMDB, the films' and shows' catalogue (card c989; doc/MOVIES-TV.md,
 * "Decided"; doc/LINKS.md, "Which catalogue"). This is the client only: the
 * link row, the review and the backfill pass are the rest of c989's card.
 *
 * **The key is the install's own** (`TMDB_API_RC_TOKEN`, the v4 read token,
 * else `TMDB_API_KEY`, the v3 key). With none, every call refuses with
 * `NoTmdbKey`: no key is a state, and a screen says `SET UP →`, never an
 * error page. Nothing here is called without `catalogueConfigured('tmdb')`.
 */

const API = () => process.env.TMDB_API_URL ?? 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p/w500';

/** The catalogue has no key here: the caller says SET UP, it does not fail. */
export class NoTmdbKey extends Error {
	constructor() {
		super('TMDB needs a key');
		this.name = 'NoTmdbKey';
	}
}

// The shape is the pure half's: the review draws it (library/tmdb.ts).
export type { TmdbTitle };

type Fetch = typeof fetch;
let fetcher: Fetch = (...a) => fetch(...a);

/** For specs: a stand-in for the network. */
export function setTmdbFetch(f: Fetch | null): void {
	fetcher = f ?? ((...a) => fetch(...a));
}

async function get(path: string, params: Record<string, string> = {}): Promise<unknown> {
	const key = tmdbKey();
	if (!key) throw new NoTmdbKey();
	const url = new URL(`${API()}${path}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	// The v4 read token travels as a bearer; the v3 key is the query's own.
	if (process.env.TMDB_API_RC_TOKEN?.trim()) url.searchParams.delete('api_key');
	else url.searchParams.set('api_key', key);
	const res = await fetcher(url, {
		headers: {
			accept: 'application/json',
			...(process.env.TMDB_API_RC_TOKEN?.trim() ? { authorization: `Bearer ${key}` } : {})
		}
	});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`TMDB answered ${res.status}`);
	return res.json();
}

const yearOf = (date: unknown): number | null => {
	const y = Number(String(date ?? '').slice(0, 4));
	return Number.isInteger(y) && y > 0 ? y : null;
};

const posterOf = (path: unknown): string | null =>
	typeof path === 'string' && path ? `${IMAGE}${path}` : null;

type Row = {
	id: number;
	title?: string;
	name?: string;
	original_title?: string;
	original_name?: string;
	release_date?: string;
	first_air_date?: string;
	overview?: string;
	poster_path?: string | null;
	runtime?: number | null;
	number_of_seasons?: number;
	belongs_to_collection?: { id: number; name: string } | null;
};

/** One result, for the kind the search ran in. */
function toTitle(r: Row, media: 'movie' | 'tv'): TmdbTitle {
	return {
		id: r.id,
		media,
		title: (r.title ?? r.name ?? '').trim(),
		originalTitle: (r.original_title ?? r.original_name ?? '').trim(),
		year: yearOf(r.release_date ?? r.first_air_date),
		overview: (r.overview ?? '').trim(),
		poster: posterOf(r.poster_path),
		runtime: media === 'movie' && Number.isInteger(r.runtime) ? r.runtime! : null,
		seasons: media === 'tv' && Number.isInteger(r.number_of_seasons) ? r.number_of_seasons! : null,
		// Only what the type declares: TMDB's object carries its own images too,
		// and a stored candidate should hold no more than tsundoku reads.
		collection:
			media === 'movie' && r.belongs_to_collection
				? { id: r.belongs_to_collection.id, name: r.belongs_to_collection.name }
				: null
	};
}

/** The kind a series kind is on TMDB. */
export const tmdbMedia = (kind: 'movie' | 'show'): 'movie' | 'tv' =>
	kind === 'show' ? 'tv' : 'movie';

/**
 * Search by title, ten at most, best match first. The caller cleans the
 * source's release-group tail before it gets here (`cleanTitle`,
 * library/catalogue.ts); a year narrows it when the source or the owner knows
 * one, which is how a remake stops matching the original.
 */
export async function tmdbSearch(
	kind: 'movie' | 'show',
	query: string,
	year: number | null = null
): Promise<TmdbTitle[]> {
	const media = tmdbMedia(kind);
	const params: Record<string, string> = { query, language: 'en-US', include_adult: 'false' };
	if (year) params[media === 'movie' ? 'year' : 'first_air_date_year'] = String(year);
	const data = (await get(`/search/${media}`, params)) as { results?: Row[] } | null;
	return (data?.results ?? []).slice(0, 10).map((r) => toTitle(r, media));
}

/** One entry by its TMDB id: details, runtime or seasons, and a film's collection. */
export async function tmdbById(kind: 'movie' | 'show', id: number): Promise<TmdbTitle | null> {
	const media = tmdbMedia(kind);
	const data = (await get(`/${media}/${id}`)) as Row | null;
	return data ? toTitle(data, media) : null;
}
