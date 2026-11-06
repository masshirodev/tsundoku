import { describe, expect, it, vi } from 'vitest';

// The cover pass is what a carried-out decision queues, off the request: this
// spec counts the calls rather than making covers (c648).
const refresh = vi.hoisted(() => vi.fn(async () => ({ made: 0, kept: 0, none: 0, failed: 0 })));
vi.mock('$lib/server/covers', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/covers')>()),
	refreshCovers: refresh
}));
import type { PlannedEntry, PlannedSeries } from '$lib/import/plan';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { ensureRoot, writeSeries } = await import('$lib/server/import/write');
const { reconcileDuplicates, setScanlator } = await import('$lib/server/duplicates');
const { seriesPage, markEntries } = await import('$lib/server/series');
const { listSeries, resumeEntry } = await import('$lib/server/library');

const entry = (n: number, scanlator: string, o: Partial<PlannedEntry> = {}): PlannedEntry => ({
	position: n,
	label: `Ch. ${n}`,
	title: '',
	sourceUrl: `/ch/${n}/${scanlator}`,
	scanlator,
	available: false,
	file: '',
	bytes: 0,
	pageCount: 0,
	addedAt: 1_700_000_000_000,
	readAt: null,
	lastPosition: null,
	lastOpenedAt: null,
	history: null,
	...o
});

const plan = (entries: PlannedEntry[], o: Partial<PlannedSeries> = {}): PlannedSeries => ({
	originKey: 'mihon:1:/two-scanlators',
	source: 'mihon',
	title: 'Two Scanlators',
	kind: 'manhwa',
	rating: 0,
	favourite: false,
	hidden: false,
	shelves: [],
	tags: [],
	description: '',
	status: '',
	direction: null,
	addedAt: 1_700_000_000_000,
	sourceUrl: '/two-scanlators',
	path: '',
	entries,
	...o
});

const db = getDb();
const root = ensureRoot(db, 'Mihon', '/nowhere/Mihon', false);
const write = (p: PlannedSeries) =>
	writeSeries(p, { rootId: root, jobId: null, now: 1_800_000_000_000, markMissing: false }, db);

// Chapter 2 from both groups: Asura's copy read, Flame's the one on disk.
write(
	plan([
		entry(1, 'Asura', { readAt: 10 }),
		entry(2, 'Asura', { readAt: 20, lastOpenedAt: 20 }),
		entry(2, 'Flame', { available: true, file: 'c2.cbz' }),
		entry(3, 'Asura'),
		entry(3, 'Flame')
	])
);
const id = (
	db.prepare(`SELECT id FROM series WHERE title = 'Two Scanlators'`).get() as { id: number }
).id;
reconcileDuplicates();

const rows = () =>
	db
		.prepare(
			`SELECT position, scanlator, shadowed, read_at FROM entries WHERE series_id = ? ORDER BY position, scanlator`
		)
		.all(id) as { position: number; scanlator: string; shadowed: number; read_at: number | null }[];
const page = () => seriesPage(id, false)!;

describe('a chapter from two scanlators', () => {
	it('is one row, and the copy on disk is the one shown', () => {
		expect(page().entries.map((e) => e.label)).toEqual(['Ch. 1', 'Ch. 2', 'Ch. 3']);
		const ch2 = page().entries[1];
		expect(ch2.available).toBe(true);
		expect(page().duplicates).toBe(2);
	});

	it('counts as read when the other copy was read, so CONTINUE moves on', () => {
		expect(page().entries[1].readAt).toBe(20);
		const card = listSeries({ reveal: false, shelf: 'all', sort: 'title' }).find(
			(s) => s.id === id
		)!;
		expect(card.entryCount).toBe(3);
		expect(card.readCount).toBe(2);
		expect(resumeEntry(id)?.label).toBe('Ch. 3');
	});

	it('follows the preferred scanlator where neither copy is on disk, and AUTO goes back', () => {
		// Automatic: Flame has the only file, so Flame's chapter 3.
		const ch3 = () => rows().filter((r) => r.position === 3 && r.shadowed === 0)[0].scanlator;
		expect(ch3()).toBe('Flame');
		setScanlator(id, 'Asura');
		expect(ch3()).toBe('Asura');
		// Chapter 2 stays Flame's: a copy you can open beats a preference.
		expect(rows().filter((r) => r.position === 2 && r.shadowed === 0)[0].scanlator).toBe('Flame');
		setScanlator(id, null);
		expect(ch3()).toBe('Flame');
	});

	it('marks unread through every copy, so a rescan cannot bring "read" back', () => {
		const ch2 = page().entries[1].id;
		markEntries(id, [ch2], false);
		reconcileDuplicates([id]);
		expect(
			rows()
				.filter((r) => r.position === 2)
				.map((r) => r.read_at)
		).toEqual([null, null]);
	});

	it('never collapses books', () => {
		write(
			plan([entry(1, '', { sourceUrl: '/book/a' }), entry(1, '', { sourceUrl: '/book/b' })], {
				originKey: 'hentoid:x',
				title: 'Two Books',
				kind: 'doujin'
			})
		);
		reconcileDuplicates();
		const books = db
			.prepare(
				`SELECT COUNT(*) AS n FROM entries e JOIN series s ON s.id = e.series_id
				WHERE s.title = 'Two Books' AND e.shadowed = 0`
			)
			.get() as { n: number };
		expect(books.n).toBe(2);
	});
});

// c648 (works' review r1 low; works' Gap 1, wave 27's c558): a decision the
// state refuses is answered and dropped, not left waiting. Left waiting it was
// invisible -- `reviewQueue` and the scan's `settled` leave out every decided
// pair, applied or not -- it could not be undone once the review's session
// ended, and every library load tried it again and queued a cover refresh,
// because `touched` was filled before the try. A library that holds no such
// pair any more gets it back at the review, undecided.
describe('a decision the review cannot carry out (c648)', () => {
	const idOf = (title: string) =>
		(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
	const bookOf = (seriesId: number) =>
		(
			db
				.prepare(`SELECT id FROM entries WHERE series_id = ? AND edition_of IS NULL`)
				.get(seriesId) as { id: number }
		).id;
	const seriesOf = (entryId: number) =>
		(
			db.prepare(`SELECT series_id FROM entries WHERE id = ?`).get(entryId) as {
				series_id: number;
			}
		).series_id;
	const waiting = (key: string) =>
		db.prepare(`SELECT decision FROM dupe_decisions WHERE pair = ?`).get(key) as
			{ decision: string } | undefined;
	const tagLanguage = (seriesId: number, value: string) => {
		db.prepare(
			`INSERT INTO tags (namespace, value) VALUES ('language', ?) ON CONFLICT DO UPDATE SET value = value`
		).run(value);
		const tagId = (
			db.prepare(`SELECT id FROM tags WHERE namespace = 'language' AND value = ?`).get(value) as {
				id: number;
			}
		).id;
		db.prepare(`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
			seriesId,
			tagId
		);
	};
	/** A second entry beside a book: an extra, which makes `foldEditions` refuse it. */
	const addExtra = (seriesId: number) => {
		const cols = (db.prepare(`PRAGMA table_info(entries)`).all() as { name: string }[])
			.map((c) => c.name)
			.filter((c) => c !== 'id');
		const set: Record<string, string> = {
			title: `'Afterword'`,
			label: `'Afterword'`,
			position: '2',
			matter: `'back'`,
			shadowed: '0',
			edition_of: 'NULL',
			read_at: 'NULL'
		};
		return Number(
			db
				.prepare(
					`INSERT INTO entries (${cols.join(', ')})
						SELECT ${cols.map((c) => set[c] ?? c).join(', ')} FROM entries
						WHERE series_id = ? ORDER BY id LIMIT 1`
				)
				.run(seriesId).lastInsertRowid
		);
	};

	it('a refused fold is answered, dropped, and not tried again', async () => {
		write(
			plan([entry(1, '', { sourceUrl: '/fold/a', pageCount: 3 })], {
				originKey: 'hentoid:fold-a',
				title: 'Fold A',
				kind: 'doujin'
			})
		);
		write(
			plan([entry(1, '', { sourceUrl: '/fold/b', pageCount: 3 })], {
				originKey: 'hentoid:fold-b',
				title: 'Fold B',
				kind: 'doujin'
			})
		);
		const a = idOf('Fold A');
		const b = idOf('Fold B');
		const ea = bookOf(a);
		const eb = bookOf(b);
		tagLanguage(a, 'english');
		tagLanguage(b, 'japanese');
		const extra = addExtra(a);
		const rows = [1, 2, 3].map((n) => ({ a: n, b: n }));
		db.prepare(`INSERT INTO dupe_pairs (a, b, bits, rows, found_at) VALUES (?, ?, 0, ?, 1)`).run(
			Math.min(ea, eb),
			Math.max(ea, eb),
			JSON.stringify({ rows, sizes: { [ea]: [0, 0], [eb]: [0, 0] } })
		);
		const key = `${Math.min(ea, eb)},${Math.max(ea, eb)}`;
		db.prepare(
			`INSERT INTO dupe_decisions (pair, decision, keep, at) VALUES (?, 'fold', NULL, 1)`
		).run(key);
		const { applyPending, reviewQueue } = await import('$lib/server/dupes');
		refresh.mockClear();
		// `foldEditions` counts the extra (`entryIdsOf`), so the fold refuses.
		const first = await applyPending();
		expect(first.applied).toBe(0);
		expect(first.refused).toEqual([
			{
				pair: key,
				decision: 'fold',
				reason: 'only a single book folds: this is a series of books'
			}
		]);
		// Dropped, not waiting and not applied: the pair is the review's again.
		expect(waiting(key)).toBeUndefined();
		expect(reviewQueue(false).map((p) => p.key)).toContain(key);
		// And the answer queued no cover: a pair that was never carried out
		// touches no series.
		expect(refresh).not.toHaveBeenCalled();
		expect(seriesOf(ea)).not.toBe(seriesOf(eb));
		// The extra gone, the next load does not fold it behind the owner's
		// back: the decision is gone with the refusal.
		db.prepare(`DELETE FROM entries WHERE id = ?`).run(extra);
		expect(await applyPending()).toEqual({ applied: 0, refused: [] });
		expect(refresh).not.toHaveBeenCalled();
		expect(seriesOf(ea)).not.toBe(seriesOf(eb));
		expect(waiting(key)).toBeUndefined();
	});

	it('a KEEP refused partway leaves no half-written row', async () => {
		// KEEP moves the kept single into the other's series of books, which
		// `moveBook` refuses when the two are in roots of a different kind
		// (hidden and visible): the shelf it copies a moment earlier must not
		// stay behind (c648).
		const hiddenRoot = ensureRoot(db, 'Hidden', '/nowhere/Hidden', true);
		write(
			plan([entry(1, '', { sourceUrl: '/keep/a', pageCount: 3 })], {
				originKey: 'hentoid:keep-a',
				title: 'Keep A',
				kind: 'doujin',
				shelves: ['Weekend']
			})
		);
		const keep = idOf('Keep A');
		const keepEntry = bookOf(keep);
		const lose = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, hue, added_at, origin_key, in_library, cover_key)
					VALUES (?, 'Lose Books', 'doujin', 'hentoid', 0, 1, 'hentoid:lose-books', 1, '')`
				)
				.run(hiddenRoot).lastInsertRowid
		);
		const putBook = db.prepare(
			`INSERT INTO entries (series_id, position, label, title, added_at, file, bytes, page_count, available, source_url)
			VALUES (?, ?, ?, ?, 1, '', 0, 3, 1, ?)`
		);
		putBook.run(lose, 1, 'Book 1', 'Lose One', '/keep/lose-1');
		putBook.run(lose, 2, 'Book 2', 'Lose Two', '/keep/lose-2');
		const loseEntry = (
			db.prepare(`SELECT id FROM entries WHERE series_id = ? ORDER BY position`).get(lose) as {
				id: number;
			}
		).id;
		const key = `${Math.min(keepEntry, loseEntry)},${Math.max(keepEntry, loseEntry)}`;
		db.prepare(
			`INSERT INTO dupe_decisions (pair, decision, keep, at) VALUES (?, 'keep', ?, 1)`
		).run(key, keepEntry);
		const shelf = (
			db.prepare(`SELECT collection_id FROM collection_series WHERE series_id = ?`).get(keep) as {
				collection_id: number;
			}
		).collection_id;
		const { applyPending } = await import('$lib/server/dupes');
		refresh.mockClear();
		const r = await applyPending();
		expect(r.applied).toBe(0);
		expect(r.refused).toEqual([
			{
				pair: key,
				decision: 'keep',
				reason: "hidden and visible books can't share a series"
			}
		]);
		// The shelf the carry-over copied before the move is not there: nothing
		// of a KEEP that refused itself is left.
		expect(
			db
				.prepare(`SELECT 1 FROM collection_series WHERE collection_id = ? AND series_id = ?`)
				.get(shelf, lose)
		).toBeUndefined();
		// And the books are where they were, with the decision gone.
		expect(seriesOf(keepEntry)).toBe(keep);
		expect(seriesOf(loseEntry)).toBe(lose);
		expect(waiting(key)).toBeUndefined();
		expect(refresh).not.toHaveBeenCalled();
	});
});
