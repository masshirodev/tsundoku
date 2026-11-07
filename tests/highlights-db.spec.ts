import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads these once.
process.env.DATABASE_PATH = ':memory:';
const work = mkdtempSync(join(tmpdir(), 'tsundoku-highlights-'));
process.env.HIGHLIGHTS_DIR = join(work, 'highlights');
process.env.LIBRARY_ROOT = join(work, 'library');
process.env.TRASH_DIR = join(work, 'trash');
process.env.COVER_DIR = join(work, 'covers');

const { getDb } = await import('$lib/server/db');
const hl = await import('$lib/server/highlights');
const { deleteBook, deleteSeries } = await import('$lib/server/delete');
const { writeSeries } = await import('$lib/server/import/write');
const { keepOrPromote } = await import('$lib/server/browsing');
const { applyMove, applyMoveBack } = await import('$lib/server/move');
const { buildMoveMap } = await import('$lib/library/move');

/**
 * Highlights' life (c701; doc/HIGHLIGHTS.md): rung 72's record and its
 * triggers, reached through the app's own doors. Every highlight here is
 * seeded straight into the table, because H1 has no way to make one; every
 * change to a pointer comes from a door the app has (delete.ts, the
 * importer's writeSeries, browse's ADD, MOVE and MOVE BACK, a fold).
 */

const NOW = Date.UTC(2026, 10, 7, 12);
const db = getDb();
let root = 0;
let hiddenRoot = 0;

afterAll(() => rmSync(work, { recursive: true, force: true }));

beforeAll(() => {
	root = Number(
		db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Library', '/l', 0)`).run()
			.lastInsertRowid
	);
	hiddenRoot = Number(
		db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Hentoid', '/h', 1)`).run()
			.lastInsertRowid
	);
	for (const [id, pkg, name] of [
		['100', 'e2e.asura', 'Asura Scans'],
		['200', 'e2e.weeb', 'Weeb Central']
	]) {
		db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
			VALUES (?, ?, 'manga', 1, '1', '1', ?, 0, 0, '')`
		).run(pkg, name, pkg.padEnd(64, '0'));
		db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', '')`
		).run(id, pkg, name);
	}
});

function series(
	title: string,
	o: {
		key?: string | null;
		kind?: string;
		hidden?: number;
		rootId?: number;
		inLibrary?: number;
	} = {}
): number {
	return Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, source, added_at, indexed_at, origin_key, hidden, in_library)
				VALUES (?, ?, ?, 'mihon', ?, ?, ?, ?, ?)`
			)
			.run(
				o.rootId ?? root,
				title,
				o.kind ?? 'manga',
				NOW,
				NOW,
				o.key === undefined ? `mihon:100:/${title}` : o.key,
				o.hidden ?? 0,
				o.inLibrary ?? 1
			).lastInsertRowid
	);
}

function entry(seriesId: number, n: number, o: { file?: string; url?: string } = {}): number {
	return Number(
		db
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, available, file, source_url)
				VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run(seriesId, n, `Ch. ${n}`, NOW, o.file ? 1 : 0, o.file ?? '', o.url ?? `/c${n}`)
			.lastInsertRowid
	);
}

/** A highlight as H2-H4 will make one: the pointer, the snapshot, hidden copied from the series. */
function highlight(
	seriesId: number,
	entryId: number,
	o: { kind?: 'quote' | 'page' | 'clip'; page?: number; note?: string; copy?: string } = {}
): number {
	const s = db
		.prepare(
			`SELECT s.title, s.kind, s.origin_key, CASE WHEN s.hidden = 1 OR (r.hidden = 1 AND s.public = 0) THEN 1 ELSE 0 END AS hidden
			FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ?`
		)
		.get(seriesId) as { title: string; kind: string; origin_key: string | null; hidden: number };
	const e = db
		.prepare(`SELECT position, season, episode_number, label FROM entries WHERE id = ?`)
		.get(entryId) as {
		position: number;
		season: number | null;
		episode_number: number | null;
		label: string;
	};
	const kind = o.kind ?? 'page';
	return Number(
		db
			.prepare(
				`INSERT INTO highlights (kind, series_id, entry_id, origin_key, number, season, page, block,
					block_offset, quote, colour, series_title, series_kind, entry_label, note, made_at, hidden,
					copy_path, copy_bytes)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				kind,
				seriesId,
				entryId,
				s.origin_key,
				e.episode_number ?? e.position,
				e.season,
				kind === 'page' ? (o.page ?? 0) : null,
				kind === 'quote' ? 0 : null,
				kind === 'quote' ? 0 : null,
				kind === 'quote' ? 'the lamps went out' : '',
				kind === 'quote' ? 'yellow' : null,
				s.title,
				s.kind,
				e.label,
				o.note ?? '',
				NOW,
				s.hidden,
				o.copy ?? '',
				o.copy ? 4 : 0
			).lastInsertRowid
	);
}

type Pointer = {
	series_id: number | null;
	entry_id: number | null;
	state: string;
	origin_key: string | null;
	number: number | null;
	hidden: number;
	rejoin: number;
};
const pointer = (id: number) =>
	db
		.prepare(
			`SELECT series_id, entry_id, state, origin_key, number, hidden, rejoin FROM highlights WHERE id = ?`
		)
		.get(id) as Pointer;

describe('nothing cascades into a highlight', () => {
	it('SQLite fires a child table’s triggers for a cascade: measured here', () => {
		const s = series('Cascade Measure');
		const e = entry(s, 1);
		db.exec(`CREATE TEMP TABLE seen (id INTEGER)`);
		db.exec(
			`CREATE TEMP TRIGGER seen_entry AFTER DELETE ON main.entries BEGIN INSERT INTO seen VALUES (OLD.id); END`
		);
		try {
			db.prepare(`DELETE FROM series WHERE id = ?`).run(s);
			expect(db.prepare(`SELECT id FROM seen`).all()).toEqual([{ id: e }]);
		} finally {
			db.exec(`DROP TRIGGER seen_entry; DROP TABLE seen`);
		}
	});

	it('a series deleted with its entries leaves their highlights ORPHAN (series), copy and note kept', () => {
		const s = series('Kaze no Tou');
		const e = entry(s, 42);
		const id = highlight(s, e, { page: 13, note: 'the tower from above' });
		db.prepare(`DELETE FROM series WHERE id = ?`).run(s);
		expect(pointer(id)).toMatchObject({ series_id: null, entry_id: null, state: 'orphan_series' });
		const kept = hl.getHighlight(id, false)!;
		expect(kept).toMatchObject({
			note: 'the tower from above',
			seriesTitle: 'Kaze no Tou',
			entryLabel: 'Ch. 42',
			page: 13,
			state: 'orphan_series'
		});
		expect(kept.orphanedAt).toBeGreaterThan(0);
	});

	it('a root deleted takes its series and entries by cascade, and still only orphans', () => {
		const r = Number(
			db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Gone', '/g', 0)`).run()
				.lastInsertRowid
		);
		const s = series('Root Gone', { rootId: r });
		const id = highlight(s, entry(s, 1));
		db.prepare(`DELETE FROM roots WHERE id = ?`).run(r);
		expect(pointer(id).state).toBe('orphan_series');
	});
});

describe('every door that deletes (delete.ts, MOVE BACK, a fold)', () => {
	it('DELETE keeps them by default, ORPHAN; DELETE THEM TOO removes rows and copies', async () => {
		mkdirSync(join(work, 'highlights', 'pages'), { recursive: true });
		const copy = join(work, 'highlights', 'pages', 'keep.webp');
		writeFileSync(copy, 'webp');
		const a = series('Delete Keeps');
		const kept = highlight(a, entry(a, 1), { copy: 'pages/keep.webp' });
		const r1 = await deleteSeries([a], false, { now: NOW });
		expect(r1).toMatchObject({ series: 1, highlights: 0 });
		expect(pointer(kept).state).toBe('orphan_series');
		expect(existsSync(copy)).toBe(true);

		const tooCopy = join(work, 'highlights', 'pages', 'too.webp');
		writeFileSync(tooCopy, 'webp');
		const b = series('Delete Too');
		const too = highlight(b, entry(b, 1), { copy: 'pages/too.webp' });
		const u = series('Unrelated');
		const other = highlight(u, entry(u, 1));
		const r2 = await deleteSeries([b], false, { now: NOW, highlights: true });
		expect(r2).toMatchObject({ series: 1, highlights: 1 });
		expect(db.prepare(`SELECT id FROM highlights WHERE id = ?`).get(too)).toBeUndefined();
		expect(existsSync(tooCopy)).toBe(false);
		expect(pointer(other).state).toBe('ok');
	});

	it('DELETE THEM TOO never removes a hidden one the viewer cannot see', async () => {
		const s = series('Hidden Delete');
		const id = highlight(s, entry(s, 1));
		// The series is visible, its highlight hidden by an older flag: only reveal sees it.
		db.prepare(`UPDATE highlights SET hidden = 1 WHERE id = ?`).run(id);
		const r = await deleteSeries([s], false, { now: NOW, highlights: true });
		expect(r.highlights).toBe(0);
		expect(pointer(id).state).toBe('orphan_series');
	});

	it('a book deleted orphans its own (entry); the last book takes the series and says so', async () => {
		const s = series('Two Books');
		const first = entry(s, 1);
		const second = entry(s, 2);
		const h1 = highlight(s, first);
		const h2 = highlight(s, second);
		await deleteBook(s, first, false, { now: NOW });
		expect(pointer(h1)).toMatchObject({ series_id: s, entry_id: null, state: 'orphan_entry' });
		// The books' resequence renumbers book 2 to position 1, and its highlight's
		// number follows, so book 1's orphan is never taken for it.
		expect(pointer(h2)).toMatchObject({ entry_id: second, state: 'ok', number: 1 });
		expect(pointer(h1).number).toBe(1);
		expect(pointer(h1).rejoin).toBe(0);
		await deleteBook(s, second, false, { now: NOW });
		expect(pointer(h2).state).toBe('orphan_series');
		expect(pointer(h1).state).toBe('orphan_series');
	});

	it('a fold (entries moved to another series, the first deleted) takes them along', () => {
		const from = series('Fold From');
		const into = series('Fold Into', { key: 'mihon:100:/into' });
		const e = entry(from, 3);
		const id = highlight(from, e);
		db.prepare(`UPDATE entries SET series_id = ? WHERE id = ?`).run(into, e);
		db.prepare(`DELETE FROM series WHERE id = ?`).run(from);
		expect(pointer(id)).toMatchObject({
			series_id: into,
			entry_id: e,
			state: 'ok',
			origin_key: 'mihon:100:/into'
		});
	});
});

describe('a series re-added from the same source re-resolves by its keys', () => {
	const plan = (title: string, key: string, numbers: number[]) => ({
		originKey: key,
		source: 'mihon',
		title,
		kind: 'manga' as const,
		rating: 0,
		favourite: false,
		hidden: false,
		shelves: [],
		tags: [],
		description: '',
		status: '',
		direction: null,
		addedAt: NOW,
		sourceUrl: '/x',
		path: '',
		entries: numbers.map((n) => ({
			position: n,
			label: `Ch. ${n}`,
			title: '',
			sourceUrl: `/re/c${n}`,
			available: false,
			file: '',
			bytes: 0,
			pageCount: 0,
			addedAt: NOW,
			readAt: null,
			lastPosition: null
		}))
	});

	it('through the importer’s writeSeries: a new id, the entry found by number', () => {
		const key = 'mihon:100:/readded';
		const s = series('Readded', { key });
		const keep = highlight(s, entry(s, 5));
		const lost = highlight(s, entry(s, 9));
		// A door that deletes without a tombstone (browse's UNDO of an ADD).
		db.prepare(`DELETE FROM series WHERE id = ?`).run(s);
		expect(pointer(keep).state).toBe('orphan_series');
		writeSeries(
			plan('Readded', key, [4, 5, 6]) as never,
			{ rootId: root, jobId: null, now: NOW, markMissing: false },
			db
		);
		// SQLite may hand the new row the old one's id (no AUTOINCREMENT): a
		// pointer never trusts one, which is why the delete nulled it.
		const again = (
			db.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(key) as { id: number }
		).id;
		const five = (
			db.prepare(`SELECT id FROM entries WHERE series_id = ? AND position = 5`).get(again) as {
				id: number;
			}
		).id;
		expect(pointer(keep)).toMatchObject({
			series_id: again,
			entry_id: five,
			state: 'ok',
			rejoin: 0
		});
		// Ch. 9 is not on the source any more: the series is back, the chapter isn't.
		expect(pointer(lost)).toMatchObject({
			series_id: again,
			entry_id: null,
			state: 'orphan_entry'
		});
	});

	it('through browse’s ADD: a browsing record made the library’s finds its entries already there', () => {
		const key = 'mihon:100:/browsed';
		const s = series('Browsed', { key });
		const id = highlight(s, entry(s, 2));
		db.prepare(`DELETE FROM series WHERE id = ?`).run(s);
		// The source opened again, without ADD: a record, which does not re-resolve.
		const record = series('Browsed', { key, inLibrary: 0 });
		const two = entry(record, 2);
		expect(pointer(id).series_id).toBeNull();
		keepOrPromote({ id: record, in_library: 0 }, false, NOW, db);
		expect(pointer(id)).toMatchObject({ series_id: record, entry_id: two, state: 'ok' });
	});

	it('a deleteSeries’ tombstone keeps the series gone, and so its highlights stay ORPHAN', async () => {
		const key = 'mihon:100:/buried';
		const s = series('Buried', { key });
		const id = highlight(s, entry(s, 1));
		await deleteSeries([s], false, { now: NOW });
		writeSeries(
			plan('Buried', key, [1]) as never,
			{ rootId: root, jobId: null, now: NOW, markMissing: false },
			db
		);
		expect(db.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(key)).toBeUndefined();
		expect(pointer(id).state).toBe('orphan_series');
	});
});

describe('hidden is copied when made and kept', () => {
	it('a hidden series’ highlights are not listed or counted without reveal, after the delete too', async () => {
		const before = hl.highlightCount(false);
		const s = series('Secret', { hidden: 1 });
		const id = highlight(s, entry(s, 1), { copy: 'pages/secret.webp' });
		expect(hl.highlightCount(false)).toBe(before);
		expect(hl.listHighlights(false).some((h) => h.id === id)).toBe(false);
		expect(hl.getHighlight(id, false)).toBeNull();
		expect(hl.listHighlights(true).find((h) => h.id === id)?.hidden).toBe(true);
		await deleteSeries([s], true, { now: NOW });
		expect(hl.highlightCount(false)).toBe(before);
		expect(hl.getHighlight(id, false)).toBeNull();
		expect(hl.getHighlight(id, true)?.state).toBe('orphan_series');
		// The disk line counts only what shows.
		const shown = hl.diskUse(false).pages;
		expect(hl.diskUse(true).pages).toBe(shown + 4);
	});

	it('follows the series while it exists: HIDE, UNHIDE, a hidden root and PUBLIC', () => {
		const s = series('Follows Hide');
		const id = highlight(s, entry(s, 1));
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(s);
		expect(pointer(id).hidden).toBe(1);
		db.prepare(`UPDATE series SET hidden = 0 WHERE id = ?`).run(s);
		expect(pointer(id).hidden).toBe(0);
		const h = series('In Hentoid', { rootId: hiddenRoot });
		const hid = highlight(h, entry(h, 1));
		expect(pointer(hid).hidden).toBe(1);
		db.prepare(`UPDATE series SET public = 1 WHERE id = ?`).run(h);
		expect(pointer(hid).hidden).toBe(0);
		db.prepare(`UPDATE series SET public = 0 WHERE id = ?`).run(h);
		db.prepare(`UPDATE roots SET hidden = 0 WHERE id = ?`).run(hiddenRoot);
		expect(pointer(hid).hidden).toBe(0);
		db.prepare(`UPDATE roots SET hidden = 1 WHERE id = ?`).run(hiddenRoot);
		expect(pointer(hid).hidden).toBe(1);
	});
});

describe('MOVE and MOVE BACK re-point by number', () => {
	const candidate = (n: number, url = `/new/c${n}`) => ({
		number: n,
		season: null,
		title: `Chapter ${n}`,
		url,
		name: `Chapter ${n}`,
		uploaded: NOW,
		order: n
	});

	it('MOVE keeps every entry: a matched one and a kept one both follow, the key follows the series', () => {
		const s = series('Movenberg', { key: 'mihon:100:/old' });
		const e1 = entry(s, 1, { url: '/old/c1' });
		const e2 = entry(s, 2, { url: '/old/c2', file: 'c2.cbz' });
		const matched = highlight(s, e1, { note: 'n' });
		const kept = highlight(s, e2);
		const target = { key: 'mihon:200:/new', source: 'Weeb Central', sourceId: '200', url: '/new' };
		// The same map the comparison shows and the apply builds again.
		const yours = [e1, e2].map((id, i) => ({
			id,
			number: i + 1,
			season: null,
			title: '',
			label: `Ch. ${i + 1}`,
			readAt: null,
			lastPosition: null,
			lastOpenedAt: null,
			available: i === 1,
			queued: false
		}));
		const plan = buildMoveMap(yours, [candidate(1)], {
			kind: 'manga',
			offset: 1,
			from: 'Asura Scans',
			to: 'Weeb Central'
		});
		const summary = hl.moveHighlights(s, plan, { from: 'Asura Scans', to: 'Weeb Central' });
		expect(summary).toMatchObject({ follow: 2, lose: 0 });
		expect(summary.named).toEqual([
			{ id: kept, place: 'CH. 2 · P. 1', why: 'NO CH. 2 ON WEEB CENTRAL · KEPT FROM ASURA SCANS' }
		]);
		const r = applyMove(s, target, [candidate(1)], { now: NOW, db });
		expect(r.highlightsLost).toBe(0);
		expect(pointer(matched)).toMatchObject({
			entry_id: e1,
			state: 'ok',
			origin_key: 'mihon:200:/new'
		});
		expect(pointer(kept)).toMatchObject({
			entry_id: e2,
			state: 'ok',
			origin_key: 'mihon:200:/new'
		});
		expect(hl.getHighlight(matched, false)?.note).toBe('n');
	});

	it('MOVE BACK takes a fileless chapter only the new source had: ORPHAN (entry), counted from the plan', () => {
		const s = series('Back And Forth', { key: 'mihon:100:/bf' });
		const e1 = entry(s, 1, { url: '/bf/c1' });
		const target = { key: 'mihon:200:/bf2', source: 'Weeb Central', sourceId: '200', url: '/bf2' };
		applyMove(s, target, [candidate(1, '/bf2/c1'), candidate(2, '/bf2/c2')], { now: NOW, db });
		const added = (
			db.prepare(`SELECT id FROM entries WHERE series_id = ? AND position = 2`).get(s) as {
				id: number;
			}
		).id;
		const onAdded = highlight(s, added);
		const onFirst = highlight(s, e1);
		const r = applyMoveBack(s, [candidate(1, '/bf/c1')], { now: NOW + 1, db });
		expect(r.highlightsLost).toBe(1);
		expect(pointer(onAdded)).toMatchObject({ entry_id: null, state: 'orphan_entry', series_id: s });
		expect(pointer(onFirst)).toMatchObject({
			entry_id: e1,
			state: 'ok',
			origin_key: 'mihon:100:/bf'
		});
		// Its copy and note never change: the row is the same, only the pointer moved.
		expect(hl.getHighlight(onAdded, false)?.entryLabel).toBe('Ch. 2');

		// Moving again to the source that lists Ch. 2 adds it back, and the
		// highlight finds its way back by that number.
		applyMove(s, target, [candidate(1, '/bf2/c1'), candidate(2, '/bf2/c2')], { now: NOW + 2, db });
		expect(pointer(onAdded)).toMatchObject({ state: 'ok', series_id: s });
		expect(pointer(onAdded).entry_id).not.toBeNull();
	});
});

describe('the owner’s own changes', () => {
	it('a note and a quote’s colour change; a page has no colour; DELETE waits for UNDO, then goes', () => {
		const s = series('Notes');
		const e = entry(s, 1);
		const quote = highlight(s, e, { kind: 'quote' });
		const page = highlight(s, e);
		hl.setNote(quote, '  her mother’s line  ', false);
		hl.setColour(quote, 'blue', false);
		expect(hl.getHighlight(quote, false)).toMatchObject({
			note: 'her mother’s line',
			colour: 'blue'
		});
		expect(() => hl.setColour(page, 'blue', false)).toThrow(/only a quote/);
		expect(() => hl.setColour(quote, 'green', false)).toThrow(/no such colour/);

		hl.deleteHighlight(page, false, NOW);
		expect(hl.getHighlight(page, false)).toBeNull();
		expect(hl.undoDeleteHighlight(page, false)).toBe(true);
		expect(hl.getHighlight(page, false)).not.toBeNull();
		hl.deleteHighlight(page, false, NOW);
		// Within the window it waits; past it, the row and its copy go.
		expect(hl.purgeDeleted(NOW + hl.UNDO_MS - 1)).toBe(0);
		expect(hl.purgeDeleted(NOW + hl.UNDO_MS + 1)).toBe(1);
		expect(hl.undoDeleteHighlight(page, false)).toBe(false);
	});

	it('a copy is only ever a file inside the highlights folder', () => {
		const area = { root: '/h', pages: '/h/pages', clips: '/h/clips', stills: '/h/stills' };
		expect(hl.copyFile('pages/1.webp', area)).toBe('/h/pages/1.webp');
		expect(hl.copyFile('../library/x.cbz', area)).toBe('');
		expect(hl.copyFile('', area)).toBe('');
	});
});
