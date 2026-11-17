import { SOURCE_KINDS, type Kind } from '$lib/library/kinds';
import { sourceFamily } from '$lib/server/engine/backend';
import { sourceKind } from '$lib/server/engine/source-kind';

/**
 * The kind a search source serves: the kind the user set on it,
 * else its family's kind from the registry (`SOURCE_KINDS`, doc/KINDS.md), so
 * an LNReader plugin's is a novel, an Aniyomi extension's an anime and a Mihon
 * one's a manga. A Mihon source marked MANHWA here is a manhwa source, and
 * MANHWA is a cell of SEARCH THE SOURCES' band. Null for a source the engine
 * has no row for.
 */
export function kindOfSource(sourceId: string): Kind | null {
	const family = sourceFamily(sourceId);
	if (!family) return null;
	return sourceKind(sourceId, family) ?? SOURCE_KINDS[family];
}
