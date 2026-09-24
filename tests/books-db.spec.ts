import { beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample, BOOK_ROWS, BOOK_SERIES_TITLE } = await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const series = await import('$lib/server/series');
const books = await import('$lib/server/books');

/** A fresh library per test: grouping reshapes the data under test. */
beforeEach(() => {
	const db = getDb();
	db.exec(`DELETE FROM roots; DELETE FROM collections; DELETE FROM tags; DELETE FROM scan_jobs;
		DELETE FROM suggestion_dismissals; DELETE FROM person_favourites; DELETE FROM history_removed;`);
	seedSample(db, Date.UTC(2026, 8, 22));
});

const idOf = (title: string) => lib.listSeries({ reveal: true }).find((s) => s.title === title)?.id;
const logRows = (entryId: number) =>
	getDb().prepare(`SELECT series_id FROM reading_events WHERE entry_id = ?`).all(entryId) as {
		series_id: number;
	}[];

describe('a seeded series of books', () => {
	it('keeps each book’s own rating, favourite, title and tags', () => {
		const s = series.seriesPage(idOf(BOOK_SERIES_TITLE)!, true)!;
		expect(s.entries.map((e) => e.title)).toEqual(BOOK_ROWS.slice(0, 4).map((r) => r.title));
		expect(s.entries.map((e) => e.rating)).toEqual([4, 3, 0, 4]);
		expect(s.entries.map((e) => e.favourite)).toEqual([false, false, true, false]);
		expect(s.entries[0].tags).toContainEqual({ namespace: 'circle', value: 'Hakka Kousha' });
		// The series has its own rating, unrated until set: nothing was averaged.
		expect(s.rating).toBe(0);
	});
});

describe('grouping', () => {
	it('moves books in, in order, with their log rows, and deletes the emptied singletons', () => {
		const a = idOf(BOOK_ROWS[4].title)!;
		const b = idOf(BOOK_ROWS[5].title)!;
		const entryA = series.seriesPage(a, true)!.entries[0].id;
		getDb()
			.prepare(
				`INSERT INTO reading_events (at, series_id, entry_id, kind) VALUES (1, ?, ?, 'open')`
			)
			.run(a, entryA);
		const { seriesId } = books.groupIntoSeries({ seriesIds: [b, a], name: 'Extras' });
		const s = series.seriesPage(seriesId, true)!;
		expect(s.title).toBe('Extras');
		expect(s.entries.map((e) => e.title)).toEqual([BOOK_ROWS[5].title, BOOK_ROWS[4].title]);
		expect(idOf(BOOK_ROWS[4].title)).toBeUndefined();
		// The book's reading history followed it instead of cascading away.
		expect(logRows(entryA)).toEqual([{ series_id: seriesId }]);
	});

	it('adds singletons to the end of an existing series', () => {
		const km = idOf(BOOK_SERIES_TITLE)!;
		books.groupIntoSeries({ seriesIds: [idOf(BOOK_ROWS[4].title)!], into: km });
		const s = series.seriesPage(km, true)!;
		expect(s.entries).toHaveLength(5);
		expect(s.entries[4].title).toBe(BOOK_ROWS[4].title);
		expect(s.entries.map((e) => e.number)).toEqual([1, 2, 3, 4, 5]);
	});

	it('refuses what is not a single doujin book, or a series of one, or no name', () => {
		const manga = idOf('Dungeon Meshi')!;
		const single = idOf(BOOK_ROWS[4].title)!;
		expect(() => books.groupIntoSeries({ seriesIds: [manga, single], name: 'X' })).toThrow(
			books.GroupingError
		);
		expect(() => books.groupIntoSeries({ seriesIds: [single], name: 'X' })).toThrow(
			books.GroupingError
		);
		expect(() =>
			books.groupIntoSeries({ seriesIds: [single, idOf(BOOK_ROWS[5].title)!], name: '  ' })
		).toThrow(books.GroupingError);
	});

	it('refuses to mix hidden and visible, so a hidden book never joins a visible series', () => {
		const visible = idOf('Hoshi no Umi no Tabibito')!;
		const hidden = idOf(BOOK_ROWS[4].title)!;
		expect(() => books.groupIntoSeries({ seriesIds: [visible, hidden], name: 'Mixed' })).toThrow(
			/hidden and visible/
		);
	});
});

describe('taking out, moving and reordering', () => {
	it('takes a book back out as a singleton with its rating, favourite, tags, progress and log', () => {
		const km = idOf(BOOK_SERIES_TITLE)!;
		const night = series.seriesPage(km, true)!.entries[2];
		const before = logRows(night.id).length;
		const [single] = books.takeOut(km, [night.id]);
		const s = series.seriesPage(single, true)!;
		expect(s.title).toBe('Kaori Mama on Night Duty');
		expect(s.favourite).toBe(true);
		expect(s.entries[0]).toMatchObject({ id: night.id, lastPosition: night.lastPosition });
		expect(s.tags).toContainEqual({ namespace: 'artist', value: 'Aoi Rin' });
		expect(logRows(night.id)).toHaveLength(before);
		expect(logRows(night.id).every((r) => r.series_id === single)).toBe(true);
		expect(series.seriesPage(km, true)!.entries.map((e) => e.number)).toEqual([1, 2, 3]);
	});

	it('deletes a series that every book was taken out of', () => {
		const km = idOf(BOOK_SERIES_TITLE)!;
		const ids = series.seriesPage(km, true)!.entries.map((e) => e.id);
		expect(books.takeOut(km, ids)).toHaveLength(4);
		expect(idOf(BOOK_SERIES_TITLE)).toBeUndefined();
	});

	it('reorders, keeping anything left out at the end', () => {
		const km = idOf(BOOK_SERIES_TITLE)!;
		const [a, b, c, d] = series.seriesPage(km, true)!.entries.map((e) => e.id);
		books.reorderBooks(km, [c, a]);
		expect(series.seriesPage(km, true)!.entries.map((e) => e.id)).toEqual([c, a, b, d]);
	});

	it('moves a book into another series of books', () => {
		const km = idOf(BOOK_SERIES_TITLE)!;
		const other = books.groupIntoSeries({
			seriesIds: [idOf(BOOK_ROWS[4].title)!, idOf(BOOK_ROWS[5].title)!],
			name: 'Extras'
		}).seriesId;
		const bath = series.seriesPage(km, true)!.entries[0].id;
		books.moveBook(km, bath, other);
		expect(series.seriesPage(other, true)!.entries.map((e) => e.id)).toContain(bath);
		expect(series.seriesPage(km, true)!.entries).toHaveLength(3);
	});

	it('rates and favourites a book without touching the series or its siblings', () => {
		const km = idOf(BOOK_SERIES_TITLE)!;
		const [first, second] = series.seriesPage(km, true)!.entries;
		books.setBookRating(km, first.id, 1);
		books.setBookFavourite(km, first.id, true);
		const s = series.seriesPage(km, true)!;
		expect(s.entries[0]).toMatchObject({ rating: 1, favourite: true });
		expect(s.entries[1]).toMatchObject({ rating: second.rating, favourite: second.favourite });
		expect(s.rating).toBe(0);
		// A book of another series cannot be reached through this one.
		const stranger = series.seriesPage(idOf(BOOK_ROWS[4].title)!, true)!.entries[0].id;
		expect(books.setBookRating(km, stranger, 5)).toBe(0);
	});
});

describe('suggestions', () => {
	it('offers the singletons that share a stem, and only those', () => {
		const holiday = idOf(BOOK_ROWS[4].title)!;
		const sugg = books.suggestionFor(holiday, true)!;
		expect(sugg.books.map((b) => b.title).sort()).toEqual(
			[BOOK_ROWS[4].title, BOOK_ROWS[5].title].sort()
		);
		// The grouped series is not a singleton, so it is never suggested.
		expect(books.suggestionFor(idOf(BOOK_SERIES_TITLE)!, true)).toBeNull();
	});

	it('never mentions a hidden book while reveal is off', () => {
		expect(books.suggestionFor(idOf(BOOK_ROWS[4].title)!, false)).toBeNull();
	});

	it('stays dismissed, and can be undone', () => {
		const holiday = idOf(BOOK_ROWS[4].title)!;
		const key = books.dismissSuggestion(
			books.suggestionFor(holiday, true)!.books.map((b) => b.seriesId)
		);
		expect(books.suggestionFor(holiday, true)).toBeNull();
		books.undoDismissal(key);
		expect(books.suggestionFor(holiday, true)).not.toBeNull();
	});
});
