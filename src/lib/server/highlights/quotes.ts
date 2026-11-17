import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { HIDDEN_SQL, IN_LIBRARY_SQL, VISIBLE_SQL } from '../visibility.ts';
import { purgeDeleted, removeHighlightRows, UNDO_MS } from '../highlights.ts';
import {
	COLOURS,
	contains,
	mergeNotes,
	NOTE_LIMIT,
	type AnchorChange,
	type Colour,
	type KeptQuote,
	type QuoteBody,
	type TextSpan
} from '../../library/highlights.ts';

/**
 * A highlight's passage kept from the text reader (doc/HIGHLIGHTS.md,
 * "Quotes"). A quote's copy is its words, so there is no
 * file and nothing to fetch: the reader sends the words it read, and this
 * keeps them.
 *
 * The rules this keeps:
 *
 * - **One highlight per place, recognised by columns that exist** (no migration):
 *   `kind`, `entry_id`, `block`, `block_offset`, `end_block`, `end_offset`.
 *   Those four numbers and not the words, because the same words twice in a
 *   chapter are two highlights, and the words are not a place. A repeat
 *   (the reader's queue resends after a tab dies between its POST and its removal;
 *   a second device; a double press) answers the one already there, `made:
 *   false`, and writes nothing but a note it did not have.
 * - **A note in the body is never dropped** (`mergeNotes`): on all three paths
 *   that don't insert, a note written while the press waited on the device is
 *   kept. A true resend carries a note the row already holds, and writes nothing.
 * - **What a new ask covers folds into it** (a selection overlapping a highlight
 *   joins it, wherever it is made: the reader sends the joined span, so the
 *   code that sees a contained row is this one). The oldest of them survives, with
 *   the oldest note there is, its colour and its `made_at`; the rest are removed. A row only
 *   partly inside the span is left alone: no ask from a reader that knew of it
 *   makes that shape, and the words of a union can't be made here without the
 *   chapter's text.
 * - **DETACHED rows never fold**: their numbers are where the words used to be.
 * - **Inside its UNDO window, the same place is the same highlight brought
 *   back** (as a page is): its note with it, on the words and in the
 *   colour just asked.
 * - **Hidden is copied from the series and kept**.
 * - **Incognito makes none**: the route refuses before this runs.
 * - **A browsing record makes none** (a series opened from a source's preview
 *   without ADD), as it has no rating: nothing would keep it on a shelf.
 */

const COLUMNS = `h.id, h.block, h.block_offset, h.end_block, h.end_offset, h.quote, h.quote_before,
	h.quote_after, h.paragraph, h.context, h.colour, h.note, h.made_at, h.state`;

type Row = {
	id: number;
	block: number;
	block_offset: number;
	end_block: number;
	end_offset: number;
	quote: string;
	quote_before: string;
	quote_after: string;
	paragraph: string;
	context: string;
	colour: Colour;
	note: string;
	made_at: number;
	state: 'ok' | 'detached';
};

const toQuote = (r: Row): KeptQuote => ({
	id: r.id,
	block: r.block,
	offset: r.block_offset,
	endBlock: r.end_block,
	endOffset: r.end_offset,
	quote: r.quote,
	before: r.quote_before,
	after: r.quote_after,
	paragraph: r.paragraph,
	context: r.context,
	colour: r.colour,
	note: r.note,
	madeAt: r.made_at,
	state: r.state
});

/** An entry's quotes, for the reader's markers: every one the viewer may see, DETACHED included. */
export function quoteHighlights(
	entryId: number,
	reveal: boolean,
	db: Database.Database = getDb()
): KeptQuote[] {
	return (
		db
			.prepare(
				`SELECT ${COLUMNS} FROM highlights h
				WHERE h.kind = 'quote' AND h.entry_id = ? AND h.deleted_at IS NULL
					AND h.state IN ('ok', 'detached') ${reveal ? '' : 'AND h.hidden = 0'}
				ORDER BY h.block, h.block_offset, h.id`
			)
			.all(entryId) as Row[]
	).map(toQuote);
}

const LIMIT = { quote: 20_000, side: 256, paragraph: 40_000, note: NOTE_LIMIT };

export class QuoteError extends Error {
	constructor(
		message: string,
		readonly why: 'bad' | 'not_found'
	) {
		super(message);
	}
}

/** A span's numbers are whole, not negative, and run forward. */
function validSpan(s: TextSpan): boolean {
	const n = [s.block, s.offset, s.endBlock, s.endOffset];
	if (!n.every((v) => Number.isInteger(v) && v >= 0)) return false;
	return s.endBlock > s.block || (s.endBlock === s.block && s.endOffset > s.offset);
}

/** A body from outside: what it must be before anything is asked of the database. */
export function validQuote(b: Partial<QuoteBody> | null): QuoteBody {
	const text = (v: unknown) => (typeof v === 'string' ? v : '');
	const num = (v: unknown) => (typeof v === 'number' ? v : Number.NaN);
	if (!b) throw new QuoteError('a quote', 'bad');
	const q: QuoteBody = {
		entry: num(b.entry),
		block: num(b.block),
		offset: num(b.offset),
		endBlock: num(b.endBlock),
		endOffset: num(b.endOffset),
		quote: text(b.quote),
		before: text(b.before),
		after: text(b.after),
		paragraph: text(b.paragraph),
		context: text(b.context),
		colour: (COLOURS as readonly string[]).includes(b.colour as string)
			? (b.colour as Colour)
			: 'yellow',
		note: text(b.note).trim().slice(0, LIMIT.note)
	};
	if (!Number.isInteger(q.entry) || q.entry <= 0) throw new QuoteError('an entry', 'bad');
	if (!validSpan(q)) throw new QuoteError('a place', 'bad');
	if (q.quote.trim() === '') throw new QuoteError('some words', 'bad');
	if (q.quote.length > LIMIT.quote) throw new QuoteError('too long', 'bad');
	if (q.before.length > LIMIT.side || q.after.length > LIMIT.side)
		throw new QuoteError('too much around it', 'bad');
	if (q.paragraph.length > LIMIT.paragraph || q.context.length > LIMIT.paragraph)
		throw new QuoteError('too long', 'bad');
	return q;
}

type Snap = {
	series_id: number;
	entry_id: number;
	label: string;
	title: string;
	volume: string;
	number: number;
	season: number | null;
	series_title: string;
	series_kind: string;
	origin_key: string | null;
	hidden: number;
};

function snapshot(entryId: number, reveal: boolean, db: Database.Database): Snap | null {
	return (
		(db
			.prepare(
				`SELECT e.id AS entry_id, s.id AS series_id, e.label, COALESCE(e.title, '') AS title,
					COALESCE(e.volume, '') AS volume, COALESCE(e.episode_number, e.position) AS number,
					e.season, s.title AS series_title, s.kind AS series_kind, s.origin_key,
					CASE WHEN ${HIDDEN_SQL} THEN 1 ELSE 0 END AS hidden
				FROM entries e JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
				WHERE e.id = ? AND ${IN_LIBRARY_SQL} ${reveal ? '' : `AND ${VISIBLE_SQL}`}`
			)
			.get(entryId) as Snap | undefined) ?? null
	);
}

/** A quote's live rows of an entry, oldest first. */
const live = (db: Database.Database, entryId: number) =>
	db
		.prepare(
			`SELECT ${COLUMNS} FROM highlights h
			WHERE h.kind = 'quote' AND h.entry_id = ? AND h.deleted_at IS NULL AND h.state = 'ok'
			ORDER BY h.made_at, h.id`
		)
		.all(entryId) as Row[];

/** A quote's number columns as a span. */
const spanOf = (r: Row): TextSpan => ({
	block: r.block,
	offset: r.block_offset,
	endBlock: r.end_block,
	endOffset: r.end_offset
});

/** The same place, set aside by DELETE no longer ago than its UNDO window. */
const inWindow = (db: Database.Database, entryId: number, s: TextSpan, now: number) =>
	db
		.prepare(
			`SELECT id, note FROM highlights
			WHERE kind = 'quote' AND entry_id = ? AND block = ? AND block_offset = ?
				AND end_block = ? AND end_offset = ? AND deleted_at IS NOT NULL AND deleted_at >= ?
			ORDER BY deleted_at DESC, id DESC LIMIT 1`
		)
		.get(entryId, s.block, s.offset, s.endBlock, s.endOffset, now - UNDO_MS) as
		{ id: number; note: string } | undefined;

const byId = (db: Database.Database, id: number) =>
	toQuote(db.prepare(`SELECT ${COLUMNS} FROM highlights h WHERE h.id = ?`).get(id) as Row);

export type Kept = {
	highlight: KeptQuote;
	/** Inserted now, rather than an answer of what was there. */
	made: boolean;
	/** The other rows this took in: they are gone. */
	folded: number[];
};

/**
 * HIGHLIGHT: keep the words. One immediate transaction reads and writes, so two
 * asks that slip past each other (a second tab, a resend) end as one row.
 * Throws QuoteError when the entry is not there for this viewer.
 */
export function keepQuote(
	body: QuoteBody,
	reveal: boolean,
	opts: { db?: Database.Database; now?: () => number } = {}
): Kept {
	const db = opts.db ?? getDb();
	const now = (opts.now ?? Date.now)();
	const snap = snapshot(body.entry, reveal, db);
	if (!snap) throw new QuoteError('no such entry', 'not_found');
	purgeDeleted(now, db);
	return db
		.transaction((): Kept => {
			const rows = live(db, body.entry);
			const same = rows.find(
				(r) =>
					r.block === body.block &&
					r.block_offset === body.offset &&
					r.end_block === body.endBlock &&
					r.end_offset === body.endOffset
			);
			if (same) {
				const note = mergeNotes(same.note, body.note);
				if (note === same.note) return { highlight: toQuote(same), made: false, folded: [] };
				db.prepare(`UPDATE highlights SET note = ? WHERE id = ?`).run(note, same.id);
				return { highlight: byId(db, same.id), made: false, folded: [] };
			}

			const inside = rows.filter((r) => contains(body, spanOf(r)));
			if (inside.length) {
				const [oldest, ...rest] = inside;
				// The oldest note there is: an older highlight with none doesn't lose a newer's.
				const note = mergeNotes(inside.find((r) => r.note.trim() !== '')?.note ?? '', body.note);
				db.prepare(
					`UPDATE highlights SET block = ?, block_offset = ?, end_block = ?, end_offset = ?,
						quote = ?, quote_before = ?, quote_after = ?, paragraph = ?, context = ?, note = ?
					WHERE id = ?`
				).run(
					body.block,
					body.offset,
					body.endBlock,
					body.endOffset,
					body.quote,
					body.before,
					body.after,
					body.paragraph,
					body.context,
					note,
					oldest.id
				);
				const folded = rest.map((r) => r.id);
				// No file to unlink: a quote's copy is its words.
				removeHighlightRows(folded, db);
				return { highlight: byId(db, oldest.id), made: false, folded };
			}

			// The other order of a join: it reached the workstation first, so this
			// body lies inside a row already there. It is that row — the join's own
			// span and id stay — not a second, nested one. (A DETACHED row is not
			// here: `live` keeps only 'ok', and its numbers are where words were.)
			const covering = rows.find((r) => contains(spanOf(r), body));
			if (covering) {
				const note = mergeNotes(covering.note, body.note);
				if (note === covering.note)
					return { highlight: toQuote(covering), made: false, folded: [] };
				db.prepare(`UPDATE highlights SET note = ? WHERE id = ?`).run(note, covering.id);
				return { highlight: byId(db, covering.id), made: false, folded: [] };
			}

			const back = inWindow(db, body.entry, body, now);
			if (back) {
				// On the words just asked: a row set aside DETACHED has its old ones.
				db.prepare(
					`UPDATE highlights SET deleted_at = NULL, state = 'ok', colour = ?, note = ?, quote = ?,
						quote_before = ?, quote_after = ?, paragraph = ?, context = ?
					WHERE id = ?`
				).run(
					body.colour,
					mergeNotes(back.note, body.note),
					body.quote,
					body.before,
					body.after,
					body.paragraph,
					body.context,
					back.id
				);
				return { highlight: byId(db, back.id), made: false, folded: [] };
			}

			const id = Number(
				db
					.prepare(
						`INSERT INTO highlights (kind, series_id, entry_id, origin_key, number, season, block,
							block_offset, end_block, end_offset, series_title, series_kind, entry_label, entry_title,
							volume, quote, quote_before, quote_after, paragraph, context, colour, note, made_at, hidden)
						VALUES ('quote', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.run(
						snap.series_id,
						snap.entry_id,
						snap.origin_key,
						snap.number,
						snap.season,
						body.block,
						body.offset,
						body.endBlock,
						body.endOffset,
						snap.series_title,
						snap.series_kind,
						snap.label,
						snap.title,
						snap.volume,
						body.quote,
						body.before,
						body.after,
						body.paragraph,
						body.context,
						body.colour,
						body.note,
						now,
						snap.hidden
					).lastInsertRowid
			);
			return { highlight: byId(db, id), made: true, folded: [] };
		})
		.immediate();
}

/**
 * What a chapter opened found (the words are only ever read on the device, so
 * this is told, never worked out here): a quote that moved, or that its
 * chapter no longer holds, or that came back. Only a quote of this entry the
 * viewer may see, still in that state's life: an orphan has no entry to be
 * re-found in, and a deleted row waits for its UNDO as it was.
 */
export function setAnchors(
	entryId: number,
	changes: AnchorChange[],
	reveal: boolean,
	db: Database.Database = getDb()
): number {
	const place = db.prepare(
		`UPDATE highlights SET state = 'ok', block = ?, block_offset = ?, end_block = ?, end_offset = ?
		WHERE id = ? AND kind = 'quote' AND entry_id = ? AND deleted_at IS NULL
			AND state IN ('ok', 'detached') ${reveal ? '' : 'AND hidden = 0'}`
	);
	const lost = db.prepare(
		`UPDATE highlights SET state = 'detached'
		WHERE id = ? AND kind = 'quote' AND entry_id = ? AND deleted_at IS NULL
			AND state IN ('ok', 'detached') ${reveal ? '' : 'AND hidden = 0'}`
	);
	return db
		.transaction(() => {
			let n = 0;
			for (const c of changes) {
				// From outside: `[null]` is a 400's shape, not a server error.
				if (!c || !Number.isInteger(c.id)) continue;
				if (c.state === 'detached') n += lost.run(c.id, entryId).changes;
				else if (validSpan(c))
					n += place.run(c.block, c.offset, c.endBlock, c.endOffset, c.id, entryId).changes;
			}
			return n;
		})
		.immediate();
}
