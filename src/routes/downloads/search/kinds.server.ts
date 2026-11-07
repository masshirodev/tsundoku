import { SOURCE_KINDS, type Kind } from '$lib/library/kinds';
import { sourceFamily } from '$lib/server/engine/backend';

/**
 * The kind a search source serves: its family's kind, from the registry
 * (`SOURCE_KINDS`, doc/KINDS.md), so an LNReader plugin's is a novel, an
 * Aniyomi extension's an anime and a Mihon one's a manga. Null for a source
 * the engine has no row for. A Mihon source of manhwa is still a Mihon
 * source: nothing stored says a source serves manhwa, so MANHWA is never a
 * cell of SEARCH THE SOURCES' band.
 */
export function kindOfSource(sourceId: string): Kind | null {
	const family = sourceFamily(sourceId);
	return family ? SOURCE_KINDS[family] : null;
}
