import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnchorChange, QuoteBody, TextSpan } from '$lib/library/highlights';

// Before anything imports db.ts: getDb() reads these once.
process.env.DATABASE_PATH = ':memory:';
const work = mkdtempSync(join(tmpdir(), 'tsundoku-highlight-quotes-'));
process.env.HIGHLIGHTS_DIR = join(work, 'highlights');
process.env.LIBRARY_ROOT = join(work, 'library');
process.env.TRASH_DIR = join(work, 'trash');
process.env.COVER_DIR = join(work, 'covers');

const { getDb } = await import('$lib/server/db');
const hl = await import('$lib/server/highlights');
const { keepQuote, quoteHighlights, QuoteError, setAnchors, validQuote } =
	await import('$lib/server/highlights/quotes');

/**
 * Highlights H2, the store's half (doc/HIGHLIGHTS.md, "Quotes"):
 * what the reader's HIGHLIGHT reaches. The body is the shape `TextReader`
 * posts; the rules that read the book are in `highlights-domain.spec.ts`.
 */

const NOW = Date.UTC(2026, 10, 9, 12);
const db = getDb();
let root = 0;
afterAll(() => rmSync(work, { recursive: true, force: true }));
beforeAll(() => {
	root = Number(
		db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Library', '/l', 0)`).run()
			.lastInsertRowid
	);
});

let next = 0;
function novel(opts: { hidden?: boolean; record?: boolean } = {}) {
	next++;
	const series = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, source, path, added_at, indexed_at, origin_key,
					hidden, in_library)
				VALUES (?, ?, 'novel', 'mihon', ?, ?, ?, ?, ?, ?)`
			)
			.run(
				root,
				`Novel ${next}`,
				`/l/n${next}`,
				NOW,
				NOW,
				`key:${next}`,
				opts.hidden ? 1 : 0,
				opts.record ? 0 : 1
			).lastInsertRowid
	);
	const entry = Number(
		db
			.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, available, file)
				VALUES (?, 3, 'Ch. 3', 'The Lamp', ?, 1, 'a.epub')`
			)
			.run(series, NOW).lastInsertRowid
	);
	return { series, entry };
}

const span = (a: number, b: number, block = 0, endBlock = block): TextSpan => ({
	block,
	offset: a,
	endBlock,
	endOffset: b
});
const body = (entry: number, s: TextSpan, over: Partial<QuoteBody> = {}): QuoteBody => ({
	entry,
	...s,
	quote: `words ${s.block}.${s.offset}-${s.endBlock}.${s.endOffset}`,
	before: 'before',
	after: 'after',
	paragraph: 'a paragraph',
	context: 'the one before',
	colour: 'yellow',
	note: '',
	...over
});
const at = (n: number) => () => NOW + n;
const count = (entry: number) =>
	(
		db.prepare(`SELECT COUNT(*) AS n FROM highlights WHERE entry_id = ?`).get(entry) as {
			n: number;
		}
	).n;

describe('keepQuote', () => {
	it('keeps the words and the snapshot, with the kind its own', () => {
		const { entry, series } = novel();
		const { highlight, made } = keepQuote(body(entry, span(2, 9), { colour: 'orange' }), false, {
			db,
			now: at(0)
		});
		expect(made).toBe(true);
		expect(highlight).toMatchObject({
			block: 0,
			offset: 2,
			endOffset: 9,
			colour: 'orange',
			state: 'ok',
			quote: 'words 0.2-0.9',
			madeAt: NOW
		});
		const row = hl.getHighlight(highlight.id, false, db)!;
		expect(row).toMatchObject({
			kind: 'quote',
			seriesId: series,
			entryId: entry,
			seriesKind: 'novel',
			entryLabel: 'Ch. 3',
			entryTitle: 'The Lamp',
			paragraph: 'a paragraph',
			context: 'the one before',
			hidden: false
		});
		// A quote keeps no file.
		expect(row.copyPath).toBe('');
		expect(row.copyBytes).toBe(0);
	});

	it('the same place twice is one highlight: a queue may resend', () => {
		const { entry } = novel();
		const b = body(entry, span(4, 12));
		const first = keepQuote(b, false, { db, now: at(0) });
		const again = keepQuote({ ...b, colour: 'blue', quote: 'other words' }, false, {
			db,
			now: at(1000)
		});
		expect(again.made).toBe(false);
		expect(again.highlight.id).toBe(first.highlight.id);
		// An answer of what was there, and nothing written.
		expect(again.highlight.colour).toBe('yellow');
		expect(again.highlight.note).toBe('');
		expect(again.highlight.quote).toBe(first.highlight.quote);
		expect(count(entry)).toBe(1);
	});

	describe('a note in the body is never dropped', () => {
		it('same place: the row with none takes it, and the resend writes nothing', () => {
			const { entry } = novel();
			const first = keepQuote(body(entry, span(4, 12)), false, { db, now: at(0) }).highlight;
			const b = body(entry, span(4, 12), { note: 'written while it waited' });
			const told = keepQuote(b, false, { db, now: at(1000) });
			expect(told.made).toBe(false);
			expect(told.highlight).toMatchObject({ id: first.id, note: 'written while it waited' });
			expect(quoteHighlights(entry, false, db)[0].note).toBe('written while it waited');
			// A resend of that same body: nothing written, and no note twice.
			const changes = db.prepare('SELECT total_changes() AS n').pluck();
			const before = changes.get();
			const again = keepQuote(b, false, { db, now: at(2000) });
			expect(changes.get()).toBe(before);
			expect(again.highlight.note).toBe('written while it waited');
		});
		it('same place, both have one: the row’s, then the new, a blank line between', () => {
			const { entry } = novel();
			keepQuote(body(entry, span(4, 12), { note: 'the first' }), false, { db, now: at(0) });
			const told = keepQuote(body(entry, span(4, 12), { note: 'the second' }), false, {
				db,
				now: at(1)
			});
			expect(told.highlight.note).toBe('the first\n\nthe second');
			const again = keepQuote(body(entry, span(4, 12), { note: 'the second' }), false, {
				db,
				now: at(2)
			});
			expect(again.highlight.note).toBe('the first\n\nthe second');
		});
		it('same place, a true resend of an unchanged body is a no-op', () => {
			const { entry } = novel();
			const b = body(entry, span(4, 12), { note: 'the same' });
			const first = keepQuote(b, false, { db, now: at(0) }).highlight;
			const again = keepQuote(b, false, { db, now: at(1) });
			expect(again.highlight).toEqual(first);
		});
		it('a fold: the note written while it waited joins the oldest note there is', () => {
			const { entry } = novel();
			const a = keepQuote(body(entry, span(0, 5)), false, { db, now: at(0) }).highlight;
			keepQuote(body(entry, span(8, 12)), false, { db, now: at(1) });
			const joined = keepQuote(body(entry, span(0, 12), { note: 'written waiting' }), false, {
				db,
				now: at(2)
			});
			expect(joined.highlight).toMatchObject({ id: a.id, note: 'written waiting' });
		});
		it('a revive: the note written while it waited joins the row’s', () => {
			const { entry } = novel();
			const b = body(entry, span(1, 7), { note: 'kept note' });
			const first = keepQuote(b, false, { db, now: at(0) }).highlight;
			hl.deleteHighlight(first.id, false, NOW + 1000, db);
			const again = keepQuote({ ...b, note: 'and this' }, false, { db, now: at(2000) });
			expect(again.highlight).toMatchObject({ id: first.id, note: 'kept note\n\nand this' });
		});
		it('a revive of a row with none takes it', () => {
			const { entry } = novel();
			const first = keepQuote(body(entry, span(1, 7)), false, { db, now: at(0) }).highlight;
			hl.deleteHighlight(first.id, false, NOW + 1000, db);
			const again = keepQuote(body(entry, span(1, 7), { note: 'only now' }), false, {
				db,
				now: at(2000)
			});
			expect(again.highlight.note).toBe('only now');
		});
		it('a revive of a row set aside DETACHED comes back on the words just asked', () => {
			const { entry } = novel();
			const first = keepQuote(body(entry, span(1, 7)), false, { db, now: at(0) }).highlight;
			setAnchors(entry, [{ id: first.id, state: 'detached' }], false, db);
			hl.deleteHighlight(first.id, false, NOW + 1000, db);
			const again = keepQuote(body(entry, span(1, 7), { quote: 'the words now' }), false, {
				db,
				now: at(2000)
			});
			expect(again.highlight).toMatchObject({
				id: first.id,
				state: 'ok',
				quote: 'the words now'
			});
		});
	});

	it('the same words at two places are two highlights', () => {
		const { entry } = novel();
		keepQuote(body(entry, span(0, 4), { quote: 'lamp' }), false, { db, now: at(0) });
		const other = keepQuote(body(entry, span(40, 44), { quote: 'lamp' }), false, {
			db,
			now: at(1)
		});
		expect(other.made).toBe(true);
		expect(count(entry)).toBe(2);
	});

	it('a span taking in highlights folds them: one row, the oldest, its note and colour', () => {
		const { entry } = novel();
		const a = keepQuote(body(entry, span(0, 5), { note: 'mine', colour: 'blue' }), false, {
			db,
			now: at(0)
		}).highlight;
		const b = keepQuote(body(entry, span(8, 12), { note: 'newer' }), false, {
			db,
			now: at(1)
		}).highlight;
		const joined = keepQuote(body(entry, span(0, 12), { quote: 'the union' }), false, {
			db,
			now: at(2)
		});
		expect(joined.made).toBe(false);
		expect(joined.highlight.id).toBe(a.id);
		expect(joined.folded).toEqual([b.id]);
		expect(joined.highlight).toMatchObject({
			quote: 'the union',
			offset: 0,
			endOffset: 12,
			note: 'mine',
			colour: 'blue',
			madeAt: NOW
		});
		expect(count(entry)).toBe(1);
		// The answer a resend of that join gets is the same row.
		const resend = keepQuote(body(entry, span(0, 12), { quote: 'the union' }), false, {
			db,
			now: at(3)
		});
		expect(resend.highlight.id).toBe(a.id);
		expect(resend.folded).toEqual([]);
		expect(count(entry)).toBe(1);
	});

	it('a fold keeps the oldest note there is: an older row with none loses nothing', () => {
		const { entry } = novel();
		const older = keepQuote(body(entry, span(0, 5)), false, { db, now: at(0) }).highlight;
		const newer = keepQuote(body(entry, span(8, 12), { note: 'the newer one' }), false, {
			db,
			now: at(1)
		}).highlight;
		const joined = keepQuote(body(entry, span(0, 12)), false, { db, now: at(2) });
		expect(joined.highlight.id).toBe(older.id);
		expect(joined.folded).toEqual([newer.id]);
		expect(joined.highlight.note).toBe('the newer one');
		expect(quoteHighlights(entry, false, db)[0].note).toBe('the newer one');
	});

	it('of three, the oldest with a note wins, whichever row survives', () => {
		const { entry } = novel();
		const a = keepQuote(body(entry, span(0, 3)), false, { db, now: at(0) }).highlight;
		keepQuote(body(entry, span(5, 7), { note: 'second' }), false, { db, now: at(1) });
		keepQuote(body(entry, span(9, 11), { note: 'third' }), false, { db, now: at(2) });
		const joined = keepQuote(body(entry, span(0, 11)), false, { db, now: at(3) });
		expect(joined.highlight).toMatchObject({ id: a.id, note: 'second' });
	});

	it('across blocks: a row between the two ends folds', () => {
		const { entry } = novel();
		const inner = keepQuote(body(entry, span(3, 9, 2)), false, { db, now: at(0) }).highlight;
		const joined = keepQuote(
			body(entry, { block: 1, offset: 4, endBlock: 3, endOffset: 1 }),
			false,
			{
				db,
				now: at(1)
			}
		);
		expect(joined.highlight.id).toBe(inner.id);
		expect(joined.highlight).toMatchObject({ block: 1, offset: 4, endBlock: 3, endOffset: 1 });
	});

	it('a row only partly inside stands apart: its words could not be made here', () => {
		const { entry } = novel();
		const a = keepQuote(body(entry, span(0, 10)), false, { db, now: at(0) }).highlight;
		const b = keepQuote(body(entry, span(5, 15)), false, { db, now: at(1) });
		expect(b.made).toBe(true);
		expect(b.highlight.id).not.toBe(a.id);
		expect(count(entry)).toBe(2);
	});

	it('the join arriving first: a body inside it is that row, its span and its note kept', () => {
		const { entry } = novel();
		// The join's POST reached the workstation first, so its row is there
		// before the waiting quote's own body.
		const join = keepQuote(
			body(entry, span(0, 20), { quote: 'the union', note: 'the join’s note' }),
			false,
			{ db, now: at(0) }
		);
		expect(join.made).toBe(true);
		const waiting = keepQuote(
			body(entry, span(2, 9), { quote: 'the waiting words', note: 'written while waiting' }),
			false,
			{ db, now: at(1) }
		);
		expect(waiting.made).toBe(false);
		expect(waiting.highlight.id).toBe(join.highlight.id);
		expect(waiting.folded).toEqual([]);
		// The join's own span and words are not shrunk to the body's.
		expect(waiting.highlight).toMatchObject({
			block: 0,
			offset: 0,
			endBlock: 0,
			endOffset: 20,
			quote: 'the union'
		});
		expect(waiting.highlight.note).toBe('the join’s note\n\nwritten while waiting');
		expect(quoteHighlights(entry, false, db)).toHaveLength(1);
	});

	it('the join arriving first with no note takes the body’s', () => {
		const { entry } = novel();
		const join = keepQuote(body(entry, span(0, 20), { quote: 'the union' }), false, {
			db,
			now: at(0)
		}).highlight;
		const waiting = keepQuote(body(entry, span(2, 9), { note: 'only now' }), false, {
			db,
			now: at(1)
		});
		expect(waiting.highlight.id).toBe(join.id);
		expect(waiting.highlight.note).toBe('only now');
	});

	it('a body inside a live row answers it, not a revive of a deleted row', () => {
		const { entry } = novel();
		const gone = keepQuote(body(entry, span(2, 9)), false, { db, now: at(0) }).highlight;
		hl.deleteHighlight(gone.id, false, NOW + 1000, db);
		const join = keepQuote(body(entry, span(0, 20), { quote: 'the union' }), false, {
			db,
			now: at(2000)
		}).highlight;
		const waiting = keepQuote(body(entry, span(2, 9)), false, { db, now: at(3000) });
		expect(waiting.made).toBe(false);
		expect(waiting.highlight.id).toBe(join.id);
		expect(quoteHighlights(entry, false, db)).toHaveLength(1);
	});

	it('the join deleted before the waiting body arrives: the body makes a row again', () => {
		const { entry } = novel();
		// The window the queue can be in: the join's DELETE landed, and only then
		// did the waiting quote's POST reach the workstation. The body is inside a
		// row that is no longer live, so there is nothing to answer it with.
		const join = keepQuote(body(entry, span(0, 20), { quote: 'the union' }), false, {
			db,
			now: at(0)
		}).highlight;
		hl.deleteHighlight(join.id, false, NOW + 1000, db);
		const waiting = keepQuote(
			body(entry, span(2, 9), { quote: 'the waiting words', note: 'written while waiting' }),
			false,
			{ db, now: at(2000) }
		);
		expect(waiting.made).toBe(true);
		expect(waiting.highlight.id).not.toBe(join.id);
		expect(waiting.highlight).toMatchObject({
			offset: 2,
			endOffset: 9,
			note: 'written while waiting'
		});
		expect(quoteHighlights(entry, false, db)).toHaveLength(1);
	});

	it('a DETACHED row is not folded: its numbers are where the words used to be', () => {
		const { entry } = novel();
		const a = keepQuote(body(entry, span(2, 6)), false, { db, now: at(0) }).highlight;
		setAnchors(entry, [{ id: a.id, state: 'detached' }], false, db);
		const b = keepQuote(body(entry, span(0, 20)), false, { db, now: at(1) });
		expect(b.made).toBe(true);
		expect(b.folded).toEqual([]);
		expect(hl.getHighlight(a.id, false, db)!.state).toBe('detached');
	});

	it('deleted and kept again inside the window: the same one back, with its note', () => {
		const { entry } = novel();
		const b = body(entry, span(1, 7), { note: 'kept note' });
		const first = keepQuote(b, false, { db, now: at(0) }).highlight;
		hl.deleteHighlight(first.id, false, NOW + 1000, db);
		const again = keepQuote({ ...b, colour: 'orange', note: '' }, false, { db, now: at(2000) });
		expect(again.made).toBe(false);
		expect(again.highlight.id).toBe(first.id);
		expect(again.highlight).toMatchObject({ note: 'kept note', colour: 'orange' });
		expect(count(entry)).toBe(1);
	});

	it('kept again after the window: a new one', () => {
		const { entry } = novel();
		const b = body(entry, span(1, 7), { note: 'gone note' });
		const first = keepQuote(b, false, { db, now: at(0) }).highlight;
		hl.deleteHighlight(first.id, false, NOW, db);
		const later = NOW + hl.UNDO_MS + 1;
		const again = keepQuote({ ...b, note: '' }, false, { db, now: () => later });
		expect(again.made).toBe(true);
		expect(again.highlight.note).toBe('');
		expect(count(entry)).toBe(1);
	});

	it('a window edge: exactly UNDO_MS ago is still inside it', () => {
		const { entry } = novel();
		const b = body(entry, span(2, 9));
		const first = keepQuote(b, false, { db, now: at(0) }).highlight;
		hl.deleteHighlight(first.id, false, NOW, db);
		const again = keepQuote(b, false, { db, now: () => NOW + hl.UNDO_MS });
		expect(again.highlight.id).toBe(first.id);
		expect(again.made).toBe(false);
	});

	it('hidden is copied from the series and kept, and a hidden entry is 404 without reveal', () => {
		const { entry } = novel({ hidden: true });
		expect(() => keepQuote(body(entry, span(0, 3)), false, { db })).toThrow(QuoteError);
		const k = keepQuote(body(entry, span(0, 3)), true, { db }).highlight;
		expect(hl.getHighlight(k.id, false, db)).toBeNull();
		expect(hl.getHighlight(k.id, true, db)!.hidden).toBe(true);
		expect(quoteHighlights(entry, false, db)).toEqual([]);
		expect(quoteHighlights(entry, true, db)).toHaveLength(1);
	});

	it('a browsing record makes none: it is on no shelf, as it has no rating', () => {
		const { entry } = novel({ record: true });
		expect(() => keepQuote(body(entry, span(0, 3)), true, { db })).toThrow(QuoteError);
		expect(count(entry)).toBe(0);
	});

	it('no such entry is the same 404', () => {
		expect(() => keepQuote(body(999_999, span(0, 3)), false, { db })).toThrow(QuoteError);
	});
});

describe('validQuote: what a body from outside must be', () => {
	const ok = body(5, span(1, 3));
	it('passes a good one, its note trimmed', () => {
		expect(validQuote({ ...ok, note: '  hi  ' })).toEqual({ ...ok, note: 'hi' });
	});
	it('an unknown colour is the default', () => {
		expect(validQuote({ ...ok, colour: 'green' as never }).colour).toBe('yellow');
	});
	it.each([
		['null', null],
		['no entry', { ...ok, entry: 0 }],
		['a fractional offset', { ...ok, offset: 1.5 }],
		['a negative block', { ...ok, block: -1 }],
		['an end before its start', { ...ok, offset: 9, endOffset: 3 }],
		['an empty span', { ...ok, offset: 3, endOffset: 3 }],
		['an end block before its start', { ...ok, block: 2, endBlock: 1 }],
		['no words', { ...ok, quote: '   ' }],
		['a quote too long', { ...ok, quote: 'x'.repeat(20_001) }],
		['a side too long', { ...ok, before: 'x'.repeat(257) }],
		['a paragraph too long', { ...ok, paragraph: 'x'.repeat(40_001) }]
	])('%s is refused', (_, b) => {
		expect(() => validQuote(b as never)).toThrow(QuoteError);
	});
	it('the limits themselves are allowed', () => {
		expect(() =>
			validQuote({
				...ok,
				quote: 'x'.repeat(20_000),
				before: 'x'.repeat(256),
				paragraph: 'x'.repeat(40_000)
			})
		).not.toThrow();
	});
});

describe('setAnchors: what a chapter opened found', () => {
	it('moves it, detaches it, and brings it back', () => {
		const { entry } = novel();
		const k = keepQuote(body(entry, span(2, 6)), false, { db, now: at(0) }).highlight;
		expect(
			setAnchors(
				entry,
				[{ id: k.id, state: 'ok', block: 4, offset: 1, endBlock: 4, endOffset: 5 }],
				false,
				db
			)
		).toBe(1);
		expect(hl.getHighlight(k.id, false, db)).toMatchObject({ block: 4, offset: 1, state: 'ok' });
		setAnchors(entry, [{ id: k.id, state: 'detached' }], false, db);
		const gone = hl.getHighlight(k.id, false, db)!;
		// Its words and its place stay: the way back opens the paragraph where it was.
		expect(gone).toMatchObject({ state: 'detached', block: 4, quote: 'words 0.2-0.6' });
		setAnchors(
			entry,
			[{ id: k.id, state: 'ok', block: 0, offset: 2, endBlock: 0, endOffset: 6 }],
			false,
			db
		);
		expect(hl.getHighlight(k.id, false, db)).toMatchObject({ state: 'ok', block: 0 });
	});
	it('a note on a detached highlight, and its colour', () => {
		const { entry } = novel();
		const k = keepQuote(body(entry, span(0, 5)), false, { db, now: at(0) }).highlight;
		setAnchors(entry, [{ id: k.id, state: 'detached' }], false, db);
		hl.setNote(k.id, 'still mine', false, db);
		hl.setColour(k.id, 'blue', false, db);
		expect(hl.getHighlight(k.id, false, db)).toMatchObject({
			state: 'detached',
			note: 'still mine',
			colour: 'blue'
		});
	});
	it('UNDO of a DELETE after the text changed comes back as it was, for the next open to find', () => {
		const { entry } = novel();
		const k = keepQuote(body(entry, span(0, 5)), false, { db, now: at(0) }).highlight;
		hl.deleteHighlight(k.id, false, NOW, db);
		// While it is set aside a chapter opened tells nothing about it.
		expect(setAnchors(entry, [{ id: k.id, state: 'detached' }], false, db)).toBe(0);
		expect(hl.undoDeleteHighlight(k.id, false, db)).toBe(true);
		expect(hl.getHighlight(k.id, false, db)!.state).toBe('ok');
		setAnchors(entry, [{ id: k.id, state: 'detached' }], false, db);
		expect(hl.getHighlight(k.id, false, db)!.state).toBe('detached');
	});
	it('an orphan is left alone: it has no entry to be re-found in', () => {
		const { entry, series } = novel();
		const k = keepQuote(body(entry, span(0, 5)), false, { db, now: at(0) }).highlight;
		db.prepare(`DELETE FROM series WHERE id = ?`).run(series);
		expect(hl.getHighlight(k.id, false, db)!.state).toBe('orphan_series');
		expect(setAnchors(entry, [{ id: k.id, state: 'detached' }], false, db)).toBe(0);
		expect(hl.getHighlight(k.id, false, db)!.state).toBe('orphan_series');
	});
	it('a hidden series is the same nothing without reveal', () => {
		const { entry } = novel({ hidden: true });
		const k = keepQuote(body(entry, span(0, 5)), true, { db, now: at(0) }).highlight;
		expect(setAnchors(entry, [{ id: k.id, state: 'detached' }], false, db)).toBe(0);
		expect(setAnchors(entry, [{ id: k.id, state: 'detached' }], true, db)).toBe(1);
	});
	it('only its own entry, and a bad span is not written', () => {
		const a = novel();
		const b = novel();
		const k = keepQuote(body(a.entry, span(0, 5)), false, { db, now: at(0) }).highlight;
		expect(setAnchors(b.entry, [{ id: k.id, state: 'detached' }], false, db)).toBe(0);
		expect(
			setAnchors(
				a.entry,
				[{ id: k.id, state: 'ok', block: -1, offset: 0, endBlock: 0, endOffset: 1 }],
				false,
				db
			)
		).toBe(0);
		expect(hl.getHighlight(k.id, false, db)).toMatchObject({ state: 'ok', block: 0 });
	});
	it('lists DETACHED too, for the reader to search again, and no deleted one', () => {
		const { entry } = novel();
		const a = keepQuote(body(entry, span(0, 5)), false, { db, now: at(0) }).highlight;
		const b = keepQuote(body(entry, span(9, 12)), false, { db, now: at(1) }).highlight;
		setAnchors(entry, [{ id: a.id, state: 'detached' }], false, db);
		hl.deleteHighlight(b.id, false, NOW, db);
		expect(quoteHighlights(entry, false, db).map((q) => [q.id, q.state])).toEqual([
			[a.id, 'detached']
		]);
	});

	it('an element that is not an object is skipped, not a server error', () => {
		const { entry } = novel();
		expect(setAnchors(entry, [null as unknown as AnchorChange], false, db)).toBe(0);
	});
});
