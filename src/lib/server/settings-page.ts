import { getDb } from './db.ts';
import { clearSetting, getSetting, isSet, isSettingKey, setSetting } from './settings.ts';
import { libraryWhere } from './visibility.ts';
import { kindDirection } from './series.ts';
import { overrides } from './anime/choices.ts';
import {
	SECTIONS,
	VALUES,
	equal,
	parseKept,
	valueDef,
	type Json,
	type ValueId,
	type Values
} from '../settings/catalog.ts';
import type { Kind } from '../library/types.ts';

/**
 * The SETTINGS page's library half (doc/SETTINGS.md; card c171): the values
 * kept on the workstation, how many series differ from each default, and
 * one checked way to set or reset any of them. A device's own values are
 * its browser's and devices.ts'.
 */

const LIBRARY_IDS = (Object.keys(VALUES) as ValueId[]).filter(
	(id) => valueDef(id).where === 'library'
);

export const isLibraryValue = (id: string): id is ValueId => (LIBRARY_IDS as string[]).includes(id);

/** What's set, by value id; a value at its default because nothing set it is left out. */
export function libraryValues(): Values {
	const out: Values = {};
	for (const id of LIBRARY_IDS) {
		const key = valueDef(id).key;
		if (isSettingKey(key) && isSet(key)) out[id] = getSetting(key);
	}
	return out;
}

/** Every option a segmented row offers for [id]. */
function optionsOf(id: ValueId): Json[] | null {
	for (const s of SECTIONS)
		for (const r of s.rows)
			if (r.control.type === 'seg')
				for (const g of r.control.groups) if (g.value === id) return g.opts.map((o) => o.value);
	return null;
}

export { parseKept };

/**
 * A library value set from the page, or reset (undefined). Only what its
 * row offers is taken; the default itself is stored as a reset, so a later
 * change of default reaches it. Returns what it was, for UNDO.
 */
export function setLibraryValue(id: ValueId, v: Json | undefined): Json | undefined | false {
	const key = valueDef(id).key;
	if (!isSettingKey(key)) return false;
	const was = isSet(key) ? getSetting(key) : undefined;
	if (v !== undefined) {
		if (id === 'dl.audio') {
			if (typeof v !== 'string') return false;
			const langs = parseKept(v);
			if (langs.join(',') !== v.toUpperCase()) return false;
			v = langs.join(',');
		} else {
			const want = v;
			if (!(optionsOf(id) ?? []).some((o) => equal(o, want))) return false;
		}
	}
	if (v === undefined || equal(v, valueDef(id).def)) clearSetting(key);
	else setSetting(key, String(v));
	return was;
}

export type OverrideCounts = {
	mode: Partial<Record<Kind, number>>;
	audio: number;
	subs: number;
	edition: number;
};

/** N SERIES DIFFER: per default, how many series keep their own. */
export function overrideCounts(reveal: boolean): OverrideCounts {
	const db = getDb();
	const mode: Partial<Record<Kind, number>> = {};
	for (const kind of ['manga', 'manhwa', 'doujin', 'novel'] as Kind[]) {
		const def = kindDirection(kind);
		mode[kind] = (
			db
				.prepare(
					`SELECT COUNT(*) AS n FROM series s JOIN roots r ON r.id = s.root_id
					WHERE ${libraryWhere(reveal)} AND s.kind = ? AND s.direction IS NOT NULL AND s.direction != ?`
				)
				.get(kind, def ?? '') as { n: number }
		).n;
	}
	const edition = (
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM series s JOIN roots r ON r.id = s.root_id
				WHERE ${libraryWhere(reveal)} AND s.edition_lang IS NOT NULL
				AND EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.edition_of IS NOT NULL)`
			)
			.get() as { n: number }
	).n;
	return {
		mode,
		audio: overrides('audio', reveal).length,
		subs: overrides('subs', reveal).length,
		edition
	};
}

/** MODE's N SERIES DIFFER → opened: each series reading against its kind's default. */
export function modeOverrides(
	reveal: boolean
): { seriesId: number; title: string; kind: Kind; direction: string }[] {
	return (
		getDb()
			.prepare(
				`SELECT s.id, s.title, s.kind, s.direction FROM series s JOIN roots r ON r.id = s.root_id
				WHERE ${libraryWhere(reveal)} AND s.kind IN ('manga', 'manhwa', 'doujin', 'novel')
				AND s.direction IS NOT NULL ORDER BY s.title COLLATE NOCASE`
			)
			.all() as { id: number; title: string; kind: Kind; direction: string }[]
	)
		.filter((r) => r.direction !== kindDirection(r.kind))
		.map((r) => ({ seriesId: r.id, title: r.title, kind: r.kind, direction: r.direction }));
}

/** ✕ on a series that reads its own way: back to its kind's default. */
export function clearModes(seriesIds: number[]): void {
	const put = getDb().prepare(`UPDATE series SET direction = NULL WHERE id = ?`);
	getDb().transaction(() => seriesIds.forEach((id) => put.run(id)))();
}
