import { getDb } from '../db.ts';
import { sourceKindChoices, type Kind, type SourceFamily } from '../../library/kinds.ts';
import { keyFamily, sourceOfKey } from '../../library/downloads.ts';

/**
 * The kind a source serves (doc/KINDS.md, "The kind a source serves"), kept per
 * source in the `settings` table as
 * `source.kind:<id>` = a kind's name. **No row is AUTO**: the plan's own
 * inference (a gallery's doujin, a "Manhwa" genre, a webtoon-only source),
 * which is what a friend never has to think about. A row is the user's
 * explicit word, and it wins over every inference — including `manga` on a
 * gallery source, which is why the default is not "no row".
 *
 * What it decides is **new** series from that source, at the importers' one
 * writer (`import/write.ts`), which every path goes through: a Mihon backup, ADD
 * from BROWSE, an anime's ADD, a novel's, a sync and FOLLOW. A series already in
 * the library keeps its own kind: this is a default, never a rewrite, and the
 * series screen has its own switch.
 *
 * `sourceFamilyOf` in the registry is the inverse of `SOURCE_KINDS`, one
 * family per kind, and that is still true: it decodes the word an APK family
 * stores (`engine_extensions.kind`), not what a source serves. A source that
 * serves `manhwa` is still a Mihon source.
 */

const PREFIX = 'source.kind:';

/** The key one source's kind is kept under. */
export const sourceKindKey = (sourceId: string) => `${PREFIX}${sourceId}`;

/**
 * The kind this source serves, or null for AUTO (the plan's inference). A
 * stored word the family cannot serve (a kind removed from the registry, a
 * hand-edited row) is null too, so nothing is ever written with it.
 */
export function sourceKind(sourceId: string, family: SourceFamily, db = getDb()): Kind | null {
	const row = db
		.prepare(`SELECT value FROM settings WHERE key = ?`)
		.get(sourceKindKey(sourceId)) as { value: string } | undefined;
	const kind = row?.value as Kind | undefined;
	return kind && sourceKindChoices(family).includes(kind) ? kind : null;
}

/**
 * Writes a source's kind: `null` (AUTO) deletes the row. A kind the family
 * cannot serve is refused here, before anything is stored, so the settings
 * page and any later path cannot disagree about it.
 */
export function setSourceKind(
	sourceId: string,
	family: SourceFamily,
	kind: Kind | null,
	db = getDb()
): void {
	if (kind !== null && !sourceKindChoices(family).includes(kind))
		throw new Error(`${kind} is not a kind a ${family} source can serve`);
	const key = sourceKindKey(sourceId);
	if (kind === null) db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
	else
		db.prepare(
			`INSERT INTO settings (key, value) VALUES (?, ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`
		).run(key, kind);
}

/**
 * The kind the source a series' key names serves, or null for a key no family
 * parses (`hentoid:`, `mihon-dir:`, `epub:`, none) and for a source nothing
 * was set on. What `import/write.ts` asks once, at the insert.
 */
export function sourceKindOfKey(key: string | null, db = getDb()): Kind | null {
	const family = keyFamily(key);
	const sourceId = sourceOfKey(key);
	if (!family || !sourceId) return null;
	return sourceKind(sourceId, family, db);
}
