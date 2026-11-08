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
	ORIGINAL_ONLY,
	valueDef,
	type Json,
	type ValueId,
	type Values
} from '../settings/catalog.ts';
import type { Kind } from '../library/types.ts';
import { KINDS, kindFacts } from '../library/kinds.ts';

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
			if (v.toUpperCase() === ORIGINAL_ONLY) v = ORIGINAL_ONLY;
			else {
				const langs = parseKept(v);
				if (langs.join(',') !== v.toUpperCase()) return false;
				v = langs.join(',');
			}
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
					WHERE ${libraryWhere(reveal)} AND s.kind = ?
					AND ((s.direction IS NOT NULL AND s.direction != ?) OR (? AND s.text_direction = 'rtl'))`
				)
				.get(kind, def ?? '', takesTextDirection(kind) ? 1 : 0) as { n: number }
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

/**
 * A book of text keeps its page direction in a column of its own
 * (`series.text_direction`, c440; doc/TEXT-READER.md, "Direction"): NULL is
 * L→R, the only default, since the owner chose no SETTINGS default for it
 * (c552). So a novel differs when it is kept R→L; a stored 'ltr' reads as
 * NULL does and is not counted. The registry says which kinds read text.
 */
const TEXT_KINDS = KINDS.filter((k) => kindFacts(k).medium === 'text');
const takesTextDirection = (kind: Kind) => TEXT_KINDS.includes(kind);

/** A stored mode or layout that is not its kind's default: what the list shows and ✕ clears. */
const layoutDiffers = (kind: Kind, direction: string | null) =>
	direction !== null && direction !== kindDirection(kind);

export type ModeOverride = {
	seriesId: number;
	title: string;
	kind: Kind;
	/** Its own mode (a comic) or layout (a novel), where it differs from the kind's default. */
	direction: string | null;
	/** A novel kept R→L (c552): its page direction differs from L→R. */
	rtl: boolean;
};

/**
 * MODE's and LAYOUT's N SERIES DIFFER → opened: each series reading against
 * its kind's default, a novel kept R→L among them (c552).
 */
export function modeOverrides(reveal: boolean): ModeOverride[] {
	return (
		getDb()
			.prepare(
				`SELECT s.id, s.title, s.kind, s.direction, s.text_direction FROM series s
				JOIN roots r ON r.id = s.root_id
				WHERE ${libraryWhere(reveal)} AND s.kind IN ('manga', 'manhwa', 'doujin', 'novel')
				AND (s.direction IS NOT NULL OR s.text_direction = 'rtl') ORDER BY s.title COLLATE NOCASE`
			)
			.all() as {
			id: number;
			title: string;
			kind: Kind;
			direction: string | null;
			text_direction: string | null;
		}[]
	)
		.map((r) => ({
			seriesId: r.id,
			title: r.title,
			kind: r.kind,
			direction: layoutDiffers(r.kind, r.direction) ? r.direction : null,
			rtl: takesTextDirection(r.kind) && r.text_direction === 'rtl'
		}))
		.filter((o) => o.direction !== null || o.rtl);
}

/**
 * ✕ on a series that reads its own way: back to its kind's defaults, and only
 * what its line names (c637; doc/SETTINGS.md). A `direction` equal to the
 * kind's default is not on the line and stays: REMEMBER stored it as a choice,
 * so it must not start following a later change of default. A novel's R→L goes
 * (c552); a stored 'ltr' reads as NULL does and is not on the line either. A
 * comic's `text_direction`, left from a time it was a novel, is not its to
 * clear. A kind with no default (`kindDirection` undefined) is never listed.
 */
export function clearModes(seriesIds: number[]): void {
	const db = getDb();
	const read = db.prepare(`SELECT kind, direction FROM series WHERE id = ?`);
	const clearLayout = db.prepare(`UPDATE series SET direction = NULL WHERE id = ?`);
	const clearRtl = db.prepare(
		`UPDATE series SET text_direction = NULL WHERE id = ? AND text_direction = 'rtl'`
	);
	db.transaction(() => {
		for (const id of seriesIds) {
			const row = read.get(id) as { kind: Kind; direction: string | null } | undefined;
			if (!row || kindDirection(row.kind) === undefined) continue;
			if (layoutDiffers(row.kind, row.direction)) clearLayout.run(id);
			if (takesTextDirection(row.kind)) clearRtl.run(id);
		}
	})();
}
