import type Database from 'better-sqlite3';
import { existsSync, rmSync } from 'node:fs';
import { getDb } from './db.ts';
import { highlightsArea } from './data-dirs.ts';
import { isUnder } from './paths.ts';
import { join } from './fspath.ts';
import { COLOURS, isLost, type Colour, type Highlight } from '../library/highlights.ts';

/**
 * Highlights' store (doc/HIGHLIGHTS.md; card c701, H1 of c444). The record is
 * rung 72's table, and its life (a delete marks ORPHAN, a re-add re-resolves,
 * a key follows its series, hidden follows the series while it exists) is the
 * rung's triggers, so every door that deletes or re-adds reaches it without
 * calling anything here. This is what the screens read and the few writes the
 * owner makes: the note, the colour, DELETE and its UNDO.
 *
 * Hidden means hidden, by the stored flag (Main 02): it is copied from the
 * series when a highlight is made and kept after the series is gone, so a
 * deleted hidden series' highlights stay hidden. Every list, count, disk
 * line and export here filters on it in SQL, never in the page.
 *
 * H1 makes no highlight: the readers and the player gain HIGHLIGHT, MARK IN
 * and KEEP in H2 to H4.
 */

type Row = {
	id: number;
	kind: Highlight['kind'];
	series_id: number | null;
	entry_id: number | null;
	number: number | null;
	season: number | null;
	block: number | null;
	block_offset: number | null;
	end_block: number | null;
	end_offset: number | null;
	page: number | null;
	page_end: number | null;
	clip_in: number | null;
	clip_out: number | null;
	series_title: string;
	live_title: string | null;
	series_kind: string;
	entry_label: string;
	entry_title: string;
	volume: string;
	quote: string;
	paragraph: string;
	context: string;
	colour: Colour | null;
	note: string;
	made_at: number;
	hidden: number;
	copy_path: string;
	still_path: string;
	copy_bytes: number;
	copy_width: number | null;
	copy_height: number | null;
	quality: string;
	tracks: string;
	track: string | null;
	state: Highlight['state'];
	orphaned_at: number | null;
};

const COLUMNS = `h.id, h.kind, h.series_id, h.entry_id, h.number, h.season, h.block, h.block_offset,
	h.end_block, h.end_offset, h.page, h.page_end, h.clip_in, h.clip_out, h.series_title,
	s.title AS live_title, h.series_kind, h.entry_label, h.entry_title, h.volume, h.quote, h.paragraph,
	h.context, h.colour, h.note, h.made_at, h.hidden, h.copy_path, h.still_path, h.copy_bytes,
	h.copy_width, h.copy_height, h.quality, h.tracks, h.track, h.state, h.orphaned_at`;

/** The live series' name while it is there (a rename shows), the snapshot's once it's gone. */
const FROM = `FROM highlights h LEFT JOIN series s ON s.id = h.series_id`;

/** Not the owner's own deleted ones, and not a hidden series' unless revealed. */
const shown = (reveal: boolean) =>
	reveal ? `h.deleted_at IS NULL` : `h.deleted_at IS NULL AND h.hidden = 0`;

function tracksOf(json: string): string[] {
	try {
		const v = JSON.parse(json) as unknown;
		return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
	} catch {
		return [];
	}
}

export function toHighlight(r: Row): Highlight {
	return {
		id: r.id,
		kind: r.kind,
		seriesId: r.series_id,
		entryId: r.entry_id,
		number: r.number,
		season: r.season,
		block: r.block,
		offset: r.block_offset,
		endBlock: r.end_block,
		endOffset: r.end_offset,
		page: r.page,
		pageEnd: r.page_end,
		clipIn: r.clip_in,
		clipOut: r.clip_out,
		seriesTitle: r.live_title ?? r.series_title,
		seriesKind: r.series_kind,
		entryLabel: r.entry_label,
		entryTitle: r.entry_title,
		volume: r.volume,
		quote: r.quote,
		paragraph: r.paragraph,
		context: r.context,
		colour: r.colour,
		note: r.note,
		madeAt: r.made_at,
		hidden: r.hidden === 1,
		copyPath: r.copy_path,
		stillPath: r.still_path,
		copyBytes: r.copy_bytes,
		width: r.copy_width,
		height: r.copy_height,
		quality: r.quality,
		tracks: tracksOf(r.tracks),
		track: r.track,
		state: r.state,
		orphanedAt: r.orphaned_at
	};
}

/** Every highlight the viewer may see, newest first. */
export function listHighlights(reveal: boolean, db: Database.Database = getDb()): Highlight[] {
	purgeDeleted(Date.now(), db);
	return (
		db
			.prepare(
				`SELECT ${COLUMNS} ${FROM} WHERE ${shown(reveal)} ORDER BY h.made_at DESC, h.id DESC`
			)
			.all() as Row[]
	).map(toHighlight);
}

/** A series' highlights, for its row and `/highlights?series=` (in reading order there). */
export function seriesHighlights(
	seriesId: number,
	reveal: boolean,
	db: Database.Database = getDb()
): Highlight[] {
	return (
		db
			.prepare(`SELECT ${COLUMNS} ${FROM} WHERE h.series_id = ? AND ${shown(reveal)}`)
			.all(seriesId) as Row[]
	).map(toHighlight);
}

export function getHighlight(
	id: number,
	reveal: boolean,
	db: Database.Database = getDb()
): Highlight | null {
	const r = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE h.id = ? AND ${shown(reveal)}`).get(id) as
		Row | undefined;
	return r ? toHighlight(r) : null;
}

/** The sidebar's and MORE's count (Main Q2): absent at zero, a hidden series' not counted. */
export function highlightCount(reveal: boolean, db: Database.Database = getDb()): number {
	return (
		db.prepare(`SELECT COUNT(*) AS n FROM highlights h WHERE ${shown(reveal)}`).get() as {
			n: number;
		}
	).n;
}

/** The disk line (Page P1): what pages and clips keep on the workstation, of what shows. */
export function diskUse(
	reveal: boolean,
	db: Database.Database = getDb()
): { pages: number; clips: number } {
	const rows = db
		.prepare(
			`SELECT h.kind, COALESCE(SUM(h.copy_bytes), 0) AS bytes FROM highlights h
			WHERE ${shown(reveal)} GROUP BY h.kind`
		)
		.all() as { kind: Highlight['kind']; bytes: number }[];
	const of = (k: Highlight['kind']) => rows.find((r) => r.kind === k)?.bytes ?? 0;
	return { pages: of('page'), clips: of('clip') };
}

export class HighlightError extends Error {}

function mustSee(id: number, reveal: boolean, db: Database.Database): void {
	if (!getHighlight(id, reveal, db)) throw new HighlightError('no such highlight');
}

/** The note: a few lines of plain text, the one thing besides the colour a highlight changes. */
export function setNote(
	id: number,
	note: string,
	reveal: boolean,
	db: Database.Database = getDb()
): void {
	mustSee(id, reveal, db);
	db.prepare(`UPDATE highlights SET note = ? WHERE id = ?`).run(note.trim().slice(0, 4000), id);
}

/** A quote's colour; a page and a clip have none (Main Q1). */
export function setColour(
	id: number,
	colour: string,
	reveal: boolean,
	db: Database.Database = getDb()
): void {
	if (!(COLOURS as readonly string[]).includes(colour)) throw new HighlightError('no such colour');
	mustSee(id, reveal, db);
	const changed = db
		.prepare(`UPDATE highlights SET colour = ? WHERE id = ? AND kind = 'quote'`)
		.run(colour, id).changes;
	if (changed === 0) throw new HighlightError('only a quote has a colour');
}

/** How long a deleted highlight waits for UNDO before its row and copy go. */
export const UNDO_MS = 10 * 60_000;

/** DELETE, at once, with the band's UNDO (Main 02): the row is set aside, not yet gone. */
export function deleteHighlight(
	id: number,
	reveal: boolean,
	now = Date.now(),
	db: Database.Database = getDb()
): void {
	mustSee(id, reveal, db);
	db.prepare(`UPDATE highlights SET deleted_at = ? WHERE id = ?`).run(now, id);
}

export function undoDeleteHighlight(
	id: number,
	reveal: boolean,
	db: Database.Database = getDb()
): boolean {
	return (
		db
			.prepare(
				`UPDATE highlights SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL
				${reveal ? '' : 'AND hidden = 0'}`
			)
			.run(id).changes === 1
	);
}

/** A copy's file, inside the highlights folder only; '' when it has none. */
export function copyFile(relative: string, area = highlightsArea()): string {
	if (relative === '') return '';
	const abs = join(area.root, relative);
	return isUnder(abs, area.root) && abs !== area.root ? abs : '';
}

/** Rows and their copies, gone for good (DELETE THEM TOO, and the UNDO window's end). */
export function removeHighlights(ids: number[], db: Database.Database = getDb()): number {
	if (ids.length === 0) return 0;
	const area = highlightsArea();
	const get = db.prepare(`SELECT copy_path, still_path FROM highlights WHERE id = ?`);
	const del = db.prepare(`DELETE FROM highlights WHERE id = ?`);
	let gone = 0;
	const files: string[] = [];
	db.transaction(() => {
		for (const id of ids) {
			const r = get.get(id) as { copy_path: string; still_path: string } | undefined;
			if (!r) continue;
			for (const f of [r.copy_path, r.still_path]) {
				const abs = copyFile(f, area);
				if (abs) files.push(abs);
			}
			gone += del.run(id).changes;
		}
	}).immediate();
	// The rows went first: a copy left behind by a failed unlink is litter, a
	// row left pointing at a missing copy would be a broken highlight.
	for (const f of files) if (existsSync(f)) rmSync(f, { force: true });
	return gone;
}

/** The deleted ones whose UNDO has passed. */
export function purgeDeleted(now = Date.now(), db: Database.Database = getDb()): number {
	const ids = (
		db
			.prepare(`SELECT id FROM highlights WHERE deleted_at IS NOT NULL AND deleted_at < ?`)
			.all(now - UNDO_MS) as { id: number }[]
	).map((r) => r.id);
	return removeHighlights(ids, db);
}

/**
 * What DELETE's sheet says (Out X4): how many highlights the series hold, and
 * in how many series. Only what the viewer can see is counted, as only a
 * series they can see can be deleted.
 */
export function heldBy(
	seriesIds: number[],
	reveal: boolean,
	db: Database.Database = getDb()
): { n: number; series: number; ids: number[] } {
	if (seriesIds.length === 0) return { n: 0, series: 0, ids: [] };
	const rows = db
		.prepare(
			`SELECT h.id, h.series_id FROM highlights h
			WHERE h.series_id IN (${seriesIds.map(() => '?').join(', ')}) AND ${shown(reveal)}`
		)
		.all(...seriesIds) as { id: number; series_id: number }[];
	return {
		n: rows.length,
		series: new Set(rows.map((r) => r.series_id)).size,
		ids: rows.map((r) => r.id)
	};
}

/** A book's or an entry's own, for its delete (`2 HIGHLIGHTS ARE KEPT`). */
export function heldByEntry(
	entryId: number,
	reveal: boolean,
	db: Database.Database = getDb()
): number[] {
	return (
		db
			.prepare(`SELECT h.id FROM highlights h WHERE h.entry_id = ? AND ${shown(reveal)}`)
			.all(entryId) as { id: number }[]
	).map((r) => r.id);
}

// ---- MOVE ---------------------------------------------------------------------------------

export type MoveHighlights = {
	follow: number;
	lose: number;
	/** The ones that don't simply follow, named under the summary (Out X5). */
	named: { id: number; place: string; why: string }[];
};

/**
 * MOVE's line (Out X5), from the same by-number map the move applies
 * (`buildMoveMap`, move.ts): a highlight on a matched entry follows it; one on
 * an entry the map keeps from the old source follows too (the entry stays,
 * with its file, so its way back still works) and is named; one on an entry
 * the move takes away (MOVE BACK's chapter with no file and no partner) loses
 * its way back, keeping its copy and note.
 */
export function moveHighlights(
	seriesId: number,
	plan: { matches: { entry: { id: number } }[]; kept: { id: number; label: string }[] },
	opts: { gone?: Set<number>; from: string; to: string },
	db: Database.Database = getDb()
): MoveHighlights {
	const rows = db
		.prepare(
			`SELECT h.id, h.entry_id, h.kind, h.page, h.clip_in, h.entry_label FROM highlights h
			WHERE h.series_id = ? AND h.deleted_at IS NULL AND h.entry_id IS NOT NULL`
		)
		.all(seriesId) as {
		id: number;
		entry_id: number;
		kind: Highlight['kind'];
		page: number | null;
		clip_in: number | null;
		entry_label: string;
	}[];
	const kept = new Map(plan.kept.map((e) => [e.id, e.label]));
	const out: MoveHighlights = { follow: 0, lose: 0, named: [] };
	for (const r of rows) {
		const label = (r.entry_label || kept.get(r.entry_id) || '').toUpperCase();
		const place = r.kind === 'page' && r.page !== null ? `${label} · P. ${r.page + 1}` : label;
		if (opts.gone?.has(r.entry_id)) {
			out.lose += 1;
			out.named.push({
				id: r.id,
				place,
				why: `NO ${label} ON ${opts.to.toUpperCase()} · ITS COPY STAYS`
			});
		} else {
			out.follow += 1;
			if (kept.has(r.entry_id))
				out.named.push({
					id: r.id,
					place,
					why: `NO ${label} ON ${opts.to.toUpperCase()} · KEPT FROM ${opts.from.toUpperCase()}`
				});
		}
	}
	return out;
}

/**
 * MOVE and MOVE BACK re-point by number (doc/HIGHLIGHTS.md, "A move"): an
 * entry the move adds back (MOVE BACK's chapters deleted while away, the old
 * source listing them again) takes the highlights its series lost by that
 * chapter's number and season. Called inside the move's own transaction with
 * the ids it inserted. A highlight on an entry the move keeps or matches
 * needs nothing: the entry is the same row, and its series' key follows by
 * rung 72's trigger.
 */
export function repointAdded(db: Database.Database, seriesId: number, added: number[]): number {
	let n = 0;
	const attach = db.prepare(
		`UPDATE highlights SET entry_id = ?, state = 'ok', rejoin = 0, orphaned_at = NULL
		WHERE series_id = ? AND entry_id IS NULL AND state = 'orphan_entry'
			AND number = (SELECT COALESCE(episode_number, position) FROM entries WHERE id = ?)
			AND season IS (SELECT season FROM entries WHERE id = ?)`
	);
	for (const id of added) n += attach.run(id, seriesId, id, id).changes;
	return n;
}

/** The highlights a move left on no entry: the count its band says. */
export const lostCount = (list: Highlight[]) => list.filter(isLost).length;
