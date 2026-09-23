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
