import { getDb } from '$lib/server/db';
import { downloadsBackend } from '$lib/server/engine/run';
import { browseSource, filterSchema } from '$lib/server/engine/browse';
import { sourceOfKey } from '$lib/library/downloads';
import type { FilterField } from '$lib/library/browse-filters';

/**
 * The source a series' tags search (card c313; doc/SERIES.md, the TAGS row):
 * its origin key's source, when BROWSE can open that source's page. Decided by
 * what can be asked, never by kind (doc/KINDS.md):
 *
 * - the key names a source (`sourceOfKey`: a Mihon or Aniyomi source's
 *   number, an LNReader plugin's `ln:<plugin>`); a Hentoid, folder, EPUB or
 *   import key, or none, is no family's and names none;
 * - that source is installed and BROWSE lists it with this reveal
 *   (`browseSource`: a mostly-hidden source is not found with reveal off);
 * - it loaded (`failed` is empty: a broken extension's page only says why);
 * - and BROWSE is there at all (the engine is configured; its pages 404
 *   otherwise).
 *
 * Null is "no sheet": a tag goes to the library, as it always did.
 */
export function tagSourceOf(
	seriesId: number,
	reveal: boolean
): { id: string; name: string } | null {
	if (downloadsBackend() !== 'engine') return null;
	const row = getDb().prepare(`SELECT origin_key FROM series WHERE id = ?`).get(seriesId) as
		{ origin_key: string | null } | undefined;
	const id = sourceOfKey(row?.origin_key ?? null);
	if (!id) return null;
	const source = browseSource(id, reveal);
	if (!source || source.failed) return null;
	return { id: source.id, name: source.name };
}

/**
 * The source's filters, for a tag to find its genre there, asked when the
 * sheet first opens (`tag-filters/+server.ts`), never by the screen's load:
 * calls into one extension run one at a time (`inLane`, engine/client.ts),
 * so a screen nobody taps a tag on asks the source nothing, and its own calls
 * (reading online, a refresh) never wait behind this one. A failure is no
 * schema, which searches for the value instead; `filterSchema` keeps the
 * answer per source (`keep`).
 */
export async function tagFiltersOf(seriesId: number, reveal: boolean): Promise<FilterField[]> {
	const source = tagSourceOf(seriesId, reveal);
	return source ? filterSchema(source.id).catch(() => []) : [];
}
