import { isBearerKey, tmdbKey } from './catalogues.ts';
import { setSetting } from './settings.ts';
import { catalogueType } from '../library/catalogues.ts';
import type { TmdbCollection, TmdbSeason, TmdbShowFacts, TmdbTitle } from '../library/tmdb.ts';

/**
 * TMDB, the films' and shows' catalogue (doc/FILMS-SHOWS.md, "How it is shaped, and why";
 * doc/LINKS.md, "Which catalogue"). This is the client only: the link row, the
 * review and the backfill pass live elsewhere.
 *
 * **The key is the install's own** (`TMDB_API_RC_TOKEN`, the v4 read token,
 * else `TMDB_API_KEY`, the v3 key). With none, every call refuses with
 * `NoTmdbKey`: no key is a state, and a screen says `SET UP →`, never an
 * error page. Nothing here is called without `catalogueConfigured('tmdb')`.
 */

const API = () => process.env.TMDB_API_URL ?? 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p/w500';
/** A backdrop fills the stage's width, so it is asked for wider than a poster. */
const BACKDROP = 'https://image.tmdb.org/t/p/w1280';

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

/**
 * How a key goes: the environment's v4 read token always as a bearer, as it
 * always went; any other key by its shape (a v4 token is a JWT), so a v4 token
 * pasted in SETTINGS works as well as a v3 key.
 */
const sendsAsBearer = (key: string): boolean =>
	(process.env.TMDB_API_RC_TOKEN ?? '').trim() === key || isBearerKey(key);

async function ask(key: string, path: string, params: Record<string, string> = {}) {
	const url = new URL(`${API()}${path}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const bearer = sendsAsBearer(key);
	if (bearer) url.searchParams.delete('api_key');
	else url.searchParams.set('api_key', key);
	return fetcher(url, {
		headers: { accept: 'application/json', ...(bearer ? { authorization: `Bearer ${key}` } : {}) }
	});
}

async function get(path: string, params: Record<string, string> = {}): Promise<unknown> {
	const key = tmdbKey();
	if (!key) throw new NoTmdbKey();
	const res = await ask(key, path, params);
	if (res.status === 404) return null;
	// The key stopped working (Keys-Key 3G): said once on SETTINGS' row, with the time.
	if (res.status === 401) setSetting('tmdb_key_refused_at', String(Date.now()));
	if (!res.ok) throw new Error(`TMDB answered ${res.status}`);
	return res.json();
}

/**
 * Whether TMDB takes a key, before it is kept (Keys-Key 3B): one request for
 * TMDB's own configuration. `refused` for a key TMDB turned down; a network
 * failure or a 5xx throws, so the screen can say it is offline rather than
 * call a good key wrong.
 */
export async function checkTmdbKey(key: string): Promise<'ok' | 'refused'> {
	const res = await ask(key.trim(), '/configuration');
	if (res.status === 401 || res.status === 403) return 'refused';
	if (!res.ok) throw new Error(`TMDB answered ${res.status}`);
	return 'ok';
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
	backdrop_path?: string | null;
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
		backdrop:
			typeof r.backdrop_path === 'string' && r.backdrop_path
				? `${BACKDROP}${r.backdrop_path}`
				: null,
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
	catalogueType(kind) as 'movie' | 'tv';

/**
 * Search by title, ten at most, best match first. The caller cleans the
 * source's release-group tail before it gets here (`cleanTitle`,
 * library/catalogue.ts); a year narrows it when the source or the user knows
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

// ---- what surrounds an entry ---------------------------------------------------

export type { TmdbCollection, TmdbSeason, TmdbShowFacts };

const dateOf = (d: unknown): string | null =>
	typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;

/** A show's seasons and next episode: `/tv/{id}`, the same call `tmdbById` makes, read for more. */
export async function tmdbShowFacts(id: number): Promise<TmdbShowFacts | null> {
	const data = (await get(`/tv/${id}`)) as {
		id: number;
		in_production?: boolean;
		seasons?: { season_number: number; episode_count?: number; air_date?: string; name?: string }[];
		next_episode_to_air?: {
			season_number: number;
			episode_number: number;
			air_date?: string;
		} | null;
	} | null;
	if (!data) return null;
	return {
		id: data.id,
		seasons: (data.seasons ?? [])
			.filter((s) => Number.isInteger(s.season_number) && s.season_number > 0)
			.map((s) => ({
				season: s.season_number,
				episodes: Number.isInteger(s.episode_count) ? s.episode_count! : 0,
				airDate: dateOf(s.air_date),
				name: (s.name ?? '').trim()
			}))
			.sort((a, b) => a.season - b.season),
		inProduction: !!data.in_production,
		next: data.next_episode_to_air
			? {
					season: data.next_episode_to_air.season_number,
					episode: data.next_episode_to_air.episode_number,
					airDate: dateOf(data.next_episode_to_air.air_date)
				}
			: null
	};
}

/** A collection's parts, in release order: TMDB's own list is in no promised order. */
export async function tmdbCollection(id: number): Promise<TmdbCollection | null> {
	const data = (await get(`/collection/${id}`)) as {
		id: number;
		name?: string;
		parts?: { id: number; title?: string; release_date?: string }[];
	} | null;
	if (!data) return null;
	const parts = (data.parts ?? []).map((p) => ({
		id: p.id,
		title: (p.title ?? '').trim(),
		year: yearOf(p.release_date),
		date: dateOf(p.release_date)
	}));
	parts.sort((a, b) =>
		a.date && b.date ? a.date.localeCompare(b.date) : a.date ? -1 : b.date ? 1 : a.id - b.id
	);
	return { id: data.id, name: (data.name ?? '').trim(), parts };
}
