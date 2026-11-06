import { describe, expect, it } from 'vitest';
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

// c558's round 3: a fold the review cannot carry out is not marked applied.
// FOLD AS LANGUAGES now refuses a book with an extra or a set-aside duplicate
// beside it up front, but a pending decision made before that (or from another
// door) can still reach `foldEditions`, which counts `edition_of IS NULL`.
describe('a fold decision the review cannot carry out (c558)', () => {
	const idOf = (title: string) =>
		(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
	const bookOf = (seriesId: number) =>
		(
			db
				.prepare(`SELECT id FROM entries WHERE series_id = ? AND edition_of IS NULL`)
				.get(seriesId) as { id: number }
		).id;
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

	it('stays waiting, then folds once nothing sits beside the book', async () => {
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
		const { applyPending } = await import('$lib/server/dupes');
		// `foldEditions` counts the extra (`entryIdsOf`), so the fold refuses:
		// the decision must not claim to have been carried out.
		expect(await applyPending()).toBe(0);
		expect(
			(
				db.prepare(`SELECT applied_at FROM dupe_decisions WHERE pair = ?`).get(key) as {
					applied_at: number | null;
				}
			).applied_at
		).toBeNull();
		const seriesOf = (entryId: number) =>
			(
				db.prepare(`SELECT series_id FROM entries WHERE id = ?`).get(entryId) as {
					series_id: number;
				}
			).series_id;
		expect(seriesOf(ea)).not.toBe(seriesOf(eb));
		// The extra gone, the same decision goes through: waiting was right.
		db.prepare(`DELETE FROM entries WHERE id = ?`).run(extra);
		expect(await applyPending()).toBe(1);
		expect(seriesOf(ea)).toBe(seriesOf(eb));
		const base = Math.min(ea, eb);
		const other = Math.max(ea, eb);
		expect(
			db.prepare(`SELECT edition_of, shadowed FROM entries WHERE id = ?`).get(other)
		).toMatchObject({ edition_of: base, shadowed: 1 });
	});
});
