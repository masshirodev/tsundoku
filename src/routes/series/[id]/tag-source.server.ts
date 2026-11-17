import { getDb } from '$lib/server/db';
import { VISIBLE_SQL } from '$lib/server/visibility';
import { downloadsBackend } from '$lib/server/engine/run';
import { browseSource } from '$lib/server/engine/browse';
import { sourceOfKey } from '$lib/library/downloads';
import { followOrigin } from '$lib/server/season-facts';

/**
 * The source a series' tags search (doc/SERIES.md, the TAGS row):
 * its origin key's source, when BROWSE can open that source's page. Decided by
 * what can be asked, never by kind (doc/KINDS.md):
 *
 * - the series is there, and shown with this reveal (one row, read here: a
 *   hidden series is not found with reveal off);
 * - the key names a source (`sourceOfKey`: a Mihon or Aniyomi source's
 *   number, an LNReader plugin's `ln:<plugin>`); a Hentoid, folder, EPUB or
 *   import key, or none, is no family's and names none;
 * - that source is installed and BROWSE lists it with this reveal
 *   (`browseSource`: a mostly-hidden source is not found with reveal off);
 * - it loaded (`failed` is empty: a broken extension's page only says why);
 * - and BROWSE is there at all (the engine is configured; its pages 404
 *   otherwise).
 *
 * Null is "no sheet": a tag goes to the library. Nothing
 * here asks the source: its filters are asked by `tag-search/+server.ts`,
 * when the user follows IN <SOURCE>, never by the screen's load.
 */
export function tagSourceOf(
	seriesId: number,
	reveal: boolean
): { id: string; name: string } | null {
	if (downloadsBackend() !== 'engine') return null;
	const row = getDb()
		.prepare(
			`SELECT 1 FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.id = ? AND (? OR ${VISIBLE_SQL})`
		)
		.get(seriesId, reveal ? 1 : 0);
	// A merged show's tags come from its last season's source: the key
	// the series itself holds names the first season, which may have no tag
	// page. `followOrigin` is the same rule FOLLOW uses.
	const id = sourceOfKey(row ? followOrigin(seriesId).key : null);
	if (!id) return null;
	const source = browseSource(id, reveal);
	if (!source || source.failed) return null;
	return { id: source.id, name: source.name };
}
