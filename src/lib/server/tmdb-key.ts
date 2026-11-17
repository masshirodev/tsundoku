import { getDb } from './db.ts';
import { envTmdbKey } from './catalogues.ts';
import { clearSetting, getSetting, setSetting } from './settings.ts';
import { checkTmdbKey } from './tmdb.ts';
import { IN_LIBRARY_SQL, VISIBLE_SQL } from './visibility.ts';
import { TMDB_KINDS } from './tmdb-links.ts';
import { catalogueType } from '../library/catalogues.ts';
import type { Kind } from '../library/kinds.ts';

/**
 * The TMDB key typed in SETTINGS › CATALOGUES. Kept as a setting, in the
 * database, as the trackers' OAuth tokens are (`tracker_accounts`), and not in
 * the data folder's `.env`: that file is the user's own and only ever appended
 * to (`ensureSetting`, first-run.ts), and REPLACE and REMOVE would have to
 * rewrite it. Where `.env` is pulled from a secrets manager, a pull replaces
 * it whole (doc/SECRETS.md), which would silently drop a key saved there.
 *
 * **The environment's key wins**, so a key set there is never
 * overridden or removed from a screen: the row then says it is set there.
 * A saved key is never shown again, only its last four characters.
 */

export type TmdbKeyRow = {
	/** Where the key in use comes from: the environment, SETTINGS, or nowhere. */
	source: 'env' | 'saved' | null;
	/** The last four characters, so two keys can be told apart; '' with none. */
	endsIn: string;
	/** When it last passed TMDB's check, and when TMDB last refused it (Keys-Key 3G). */
	checkedAt: number | null;
	refusedAt: number | null;
};

const at = (v: string) => (v ? Number(v) : null);

export function tmdbKeyRow(): TmdbKeyRow {
	const env = envTmdbKey();
	const saved = getSetting('tmdb_key').trim();
	const key = env || saved;
	return {
		source: env ? 'env' : saved ? 'saved' : null,
		endsIn: key.slice(-4),
		checkedAt: at(getSetting('tmdb_key_checked_at')),
		refusedAt: key ? at(getSetting('tmdb_key_refused_at')) : null
	};
}

/**
 * SAVE (Keys-Key 3B, 3C): checked with TMDB first, and kept only if TMDB takes
 * it; a refused key writes nothing, and the one in use stays (REPLACE keeps
 * the old key until a new one passes). Offline, the check throws: nothing is
 * written and the screen says SAVE waits for the connection.
 */
export async function saveTmdbKey(
	raw: string,
	now = Date.now()
): Promise<'ok' | 'refused' | 'empty'> {
	const key = raw.trim();
	if (!key) return 'empty';
	if ((await checkTmdbKey(key)) === 'refused') return 'refused';
	setSetting('tmdb_key', key);
	setSetting('tmdb_key_checked_at', String(now));
	clearSetting('tmdb_key_refused_at');
	return 'ok';
}

/**
 * REMOVE KEY (Keys-Key 3F): the key goes, and only the key. Links already
 * made stay, and a film keeps its overview; nothing new is looked up.
 */
export function removeTmdbKey(): void {
	clearSetting('tmdb_key');
	clearSetting('tmdb_key_checked_at');
	clearSetting('tmdb_key_refused_at');
}

/**
 * What a new key will look up (Keys-Key 3E's band): the films and shows in the
 * library, visible and never searched, which the next pass backfills.
 */
export function waitingForAKey(): { films: number; shows: number } {
	const rows = getDb()
		.prepare(
			`SELECT s.kind, COUNT(*) AS n FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.kind IN (${TMDB_KINDS.map((k) => `'${k}'`).join(', ')}) AND ${IN_LIBRARY_SQL} AND ${VISIBLE_SQL}
				AND NOT EXISTS (SELECT 1 FROM series_tmdb_links l WHERE l.series_id = s.id)
				AND NOT EXISTS (SELECT 1 FROM tmdb_link_searches x WHERE x.series_id = s.id AND x.searched_at IS NOT NULL)
			GROUP BY s.kind`
		)
		.all() as { kind: string; n: number }[];
	const of = (type: 'movie' | 'tv') =>
		rows.filter((r) => catalogueType(r.kind as Kind) === type).reduce((a, r) => a + r.n, 0);
	return { films: of('movie'), shows: of('tv') };
}
