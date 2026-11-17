import { beforeAll, describe, expect, it, vi } from 'vitest';

// FOLD AS LANGUAGES ends in the duplicates review, which reads the books'
// pages; the seed has none on disk. What the action asks it to fold is the
// answer under test (c558's round 2), so the review's door only records it.
const folded = vi.hoisted(() => [] as number[][]);
vi.mock('$lib/server/dupes', async (original) => ({
	...(await original<typeof import('$lib/server/dupes')>()),
	offerFold: async (entryIds: number[]) => {
		folded.push(entryIds);
		return 'pair';
	}
}));

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample, SAMPLE_ROWS, HIDDEN_TITLES, BOOK_SERIES_TITLE } =
	await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const filtersMod = await import('$lib/library/filters');
const { NO_FILTERS } = filtersMod;
type Filters = import('$lib/library/filters').Filters;
const only = (patch: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...patch });

beforeAll(() => {
	seedSample(getDb(), Date.UTC(2026, 8, 22));
});

const titles = (cards: { title: string }[]) => cards.map((c) => c.title);
const hiddenTitles = HIDDEN_TITLES;

describe('hidden means hidden', () => {
	it('lists, counts and searches nothing hidden while reveal is off', () => {
		expect(lib.countSeries(false)).toBe(SAMPLE_ROWS.length);
		const all = lib.listSeries({ reveal: false });
		for (const t of hiddenTitles) expect(titles(all)).not.toContain(t);
		expect(lib.search('Onsen', false).titles).toEqual([]);
		expect(lib.search('Onsen', false).titleTotal).toBe(0);
	});

	it('does not even name a hidden root as a shelf while reveal is off', () => {
		const names = lib.listShelves({ reveal: false, withNew: false }).map((s) => s.name);
		expect(names).not.toContain('Hentoid');
	});

	it('shows hidden series, marked, and the hidden root as a shelf, while reveal is on', () => {
		expect(lib.countSeries(true)).toBe(SAMPLE_ROWS.length + HIDDEN_TITLES.length);
		const hidden = lib.listSeries({ reveal: true }).filter((c) => c.hidden);
		expect(titles(hidden).sort()).toEqual([...hiddenTitles].sort());
		const root = lib
			.listShelves({ reveal: true, withNew: false })
			.find((s) => s.name === 'Hentoid');
		expect(root).toMatchObject({ kind: 'root', count: HIDDEN_TITLES.length });
	});

	it('refuses the sheet for a hidden series while reveal is off', () => {
		const id = lib.listSeries({ reveal: true }).find((c) => c.hidden)!.id;
		expect(lib.seriesDetail(id, false)).toBeNull();
		expect(lib.seriesDetail(id, true)).not.toBeNull();
	});
});

describe('one book out of a hidden root', () => {
	const idOf = (title: string) =>
		lib.listSeries({ reveal: true }).find((s) => s.title === title)!.id;

	it('UNHIDE makes it public while the rest of the root stays hidden, and HIDE takes it back', () => {
		const book = 'Kōhai no Himitsu Nikki';
		const id = idOf(book);
		lib.setHidden([id], false);
		const shown = titles(lib.listSeries({ reveal: false }));
		expect(shown).toContain(book);
		// Its neighbours in the Hentoid root are still hidden.
		for (const t of hiddenTitles.filter((t) => t !== book)) expect(shown).not.toContain(t);
		expect(lib.listSeries({ reveal: true }).find((s) => s.id === id)?.hidden).toBe(false);

		lib.setHidden([id], true);
		expect(titles(lib.listSeries({ reveal: false }))).not.toContain(book);
		lib.setHidden([id], false);
		lib.setHidden([id], true);
		expect(countPublic()).toBe(0);
	});
});

const countPublic = () =>
	(getDb().prepare(`SELECT COUNT(*) AS n FROM series WHERE public = 1`).get() as { n: number }).n;

describe('shelves', () => {
	it('counts the smart shelves from the data', () => {
		const shelves = lib.listShelves({ reveal: false, withNew: false });
		const byKey = Object.fromEntries(shelves.map((s) => [s.key, s.count]));
		expect(byKey.all).toBe(SAMPLE_ROWS.length);
		// FAVOURITES, RATED and DOWNLOADED are filters since c68, not shelves.
		expect(byKey.favourites).toBeUndefined();
		expect(byKey.rated4).toBeUndefined();
		expect(byKey.downloaded).toBeUndefined();
		// Shelves only since c436: SERIES and ONE-OFF are FILTER's FORM, and the
		// kinds the library's KIND band. Every key left is ALL, NEW, a collection
		// or a hidden root.
		expect(shelves.every((s) => /^(all|new|c:\d+|r:\d+)$/.test(s.key))).toBe(true);
		expect(byKey.series).toBeUndefined();
		expect(byKey.oneoff).toBeUndefined();
		const form = (x: 'series' | 'oneoff') =>
			lib.countListed({ reveal: false, filters: only({ form: x }) });
		expect(form('series') + form('oneoff')).toBe(byKey.all);
		expect(form('oneoff')).toBeGreaterThan(0);
	});

	it('narrows the listing to a collection', () => {
		const toFinish = lib
			.listShelves({ reveal: false, withNew: false })
			.find((s) => s.name === 'To finish')!;
		const listed = lib.listSeries({ reveal: false, shelf: toFinish.key });
		expect(listed).toHaveLength(toFinish.count);
		expect(titles(listed)).toContain('Tower of God');
	});
});

describe('continue reading', () => {
	it('lists series opened and not finished, most recent first', () => {
		const { items, total } = lib.continueReading(false);
		expect(items.map((i) => i.title).slice(0, 2)).toEqual([
			'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
			"Omniscient Reader's Viewpoint"
		]);
		expect(items[0].entryLabel).toBe('Ch. 41');
		expect(total).toBeGreaterThanOrEqual(items.length);
		for (const item of items) expect(item.readCount).toBeLessThan(item.entryCount);
	});

	it('names a book in a series of books by its place in the owner order', () => {
		const book = lib.continueReading(true, 50).items.find((i) => i.title === BOOK_SERIES_TITLE);
		expect(book?.entryLabel).toMatch(/^Book \d+$/);
	});
});

describe('search', () => {
	it('matches titles and tags, ranking title matches first and saying why', () => {
		const result = lib.search('isekai', false);
		expect(result.titles[0].why).toBe('TITLE');
		const byTag = result.titles.find((t) => t.title === 'Mushoku Tensei');
		expect(byTag?.why).toBe('TAG genre · isekai');
		expect(result.tags[0]).toMatchObject({ namespace: 'genre', value: 'isekai' });
		expect(result.shelves.map((s) => s.name)).toContain('Isekai pile');
	});
});

describe('writes touch only what was asked', () => {
	it('rates, clears to unrated (0), and leaves other series alone', () => {
		const [a, b] = lib.listSeries({ reveal: false, sort: 'title' });
		const before = lib.seriesDetail(b.id, false)!.rating;
		expect(lib.setRating([a.id], 3)).toBe(1);
		expect(lib.seriesDetail(a.id, false)!.rating).toBe(3);
		expect(lib.setRating([a.id], 0)).toBe(1);
		expect(lib.seriesDetail(a.id, false)!.rating).toBe(0);
		expect(lib.seriesDetail(b.id, false)!.rating).toBe(before);
	});

	it('never leaves a NULL rating behind after the migrations', () => {
		const { n } = getDb()
			.prepare('SELECT COUNT(*) AS n FROM series WHERE rating IS NULL')
			.get() as { n: number };
		expect(n).toBe(0);
	});

	it('applies a bulk action to exactly the selected series', () => {
		const ids = lib
			.listSeries({ reveal: false, sort: 'title' })
			.slice(0, 3)
			.map((c) => c.id);
		const favs = () => lib.countListed({ reveal: false, filters: only({ fav: 1 }) });
		const favBefore = favs();
		const alreadyFav = ids.filter((id) => lib.seriesDetail(id, false)!.favourite).length;
		expect(lib.setFavourite(ids, true)).toBe(3);
		const favAfter = favs();
		expect(favAfter - favBefore).toBe(3 - alreadyFav);
	});

	it('hides a series so it vanishes from every reveal-off read', () => {
		const target = lib.listSeries({ reveal: false }).find((c) => c.title === 'Lookism')!;
		lib.setHidden([target.id], true);
		expect(titles(lib.listSeries({ reveal: false }))).not.toContain('Lookism');
		expect(lib.search('Lookism', false).titleTotal).toBe(0);
		lib.setHidden([target.id], false);
		expect(titles(lib.listSeries({ reveal: false }))).toContain('Lookism');
	});

	it('adds to and removes from a shelf, creating it once', () => {
		const id = lib.createCollection('Reread someday');
		expect(lib.createCollection('reread someday')).toBe(id);
		const target = lib.listSeries({ reveal: false })[0];
		expect(lib.setInCollection([target.id], id, true)).toBe(1);
		expect(lib.setInCollection([target.id], id, true)).toBe(0);
		expect(lib.seriesDetail(target.id, false)!.collections).toContain(id);
		expect(lib.setInCollection([target.id], id, false)).toBe(1);
		expect(() => lib.createCollection('   ')).toThrow();
	});
});

describe('the FILTER panel (doc/FILTERS.md)', () => {
	const list = (filters: Filters, reveal = false, shelf = 'all') =>
		lib.listSeries({ reveal, shelf, filters });
	const everything = (reveal = false) => lib.listSeries({ reveal });

	it('DOWNLOADED: a chapter on disk, and NO its complement, counted the same way', () => {
		const db = getDb();
		const target = everything().find((c) => c.title === 'Chainsaw Man')!;
		const before = list(only({ dl: 1 }));
		expect(titles(before)).toContain('Chainsaw Man');
		expect(target.downloaded).toBe(true);
		// Only known from a backup: every chapter read online, none on disk.
		db.prepare(`UPDATE entries SET available = 0 WHERE series_id = ?`).run(target.id);
		const after = list(only({ dl: 1 }));
		expect(titles(after)).not.toContain('Chainsaw Man');
		expect(after.length).toBe(before.length - 1);
		expect(titles(list(only({ dl: 0 })))).toContain('Chainsaw Man');
		expect(lib.countListed({ reveal: false, filters: only({ dl: 1 }) })).toBe(after.length);
		expect(after.length + list(only({ dl: 0 })).length).toBe(everything().length);
		db.prepare(`UPDATE entries SET available = 1 WHERE series_id = ?`).run(target.id);
	});

	it('RATING: at least a threshold, or unrated, and the two split the rated from the rest', () => {
		const all = everything();
		expect(list(only({ min: 8 })).every((c) => c.rating >= 8)).toBe(true);
		expect(list(only({ min: 8 })).length).toBe(all.filter((c) => c.rating >= 8).length);
		expect(list(only({ unrated: true })).length).toBe(all.filter((c) => c.rating === 0).length);
		expect(list(only({ min: 1 })).length + list(only({ unrated: true })).length).toBe(all.length);
	});

	it('FAV and NOT FAV split the shelf', () => {
		const shelf = 'k:manga';
		const whole = lib.countListed({ reveal: false, shelf });
		const fav = lib.countListed({ reveal: false, shelf, filters: only({ fav: 1 }) });
		const not = lib.countListed({ reveal: false, shelf, filters: only({ fav: 0 }) });
		expect(fav + not).toBe(whole);
		expect(list(only({ fav: 0 }), false, shelf).some((c) => c.favourite)).toBe(false);
	});

	it('combine with each other and with the shelf', () => {
		const combined = list(only({ min: 6, fav: 1 }), false, 'k:manga');
		const byHand = everything().filter((c) => c.kind === 'manga' && c.rating >= 6 && c.favourite);
		expect(titles(combined).sort()).toEqual(titles(byHand).sort());
	});

	it('DATE ADDED: on or after the start of that day', () => {
		const all = everything();
		const days = [...new Set(all.map((c) => c.addedAt))].sort((a, b) => a - b);
		const mid = new Date(days[Math.floor(days.length / 2)]);
		const day = `${mid.getFullYear()}-${String(mid.getMonth() + 1).padStart(2, '0')}-${String(mid.getDate()).padStart(2, '0')}`;
		const start = new Date(mid.getFullYear(), mid.getMonth(), mid.getDate()).getTime();
		expect(list(only({ added: day })).length).toBe(all.filter((c) => c.addedAt >= start).length);
	});

	it('LANGUAGE: only what the shelf holds, never "translated", and nothing while reveal is off', () => {
		// The sample's languages are all on hidden books, as the real library's are.
		expect(lib.languagesOn({ reveal: false, shelf: 'all' })).toEqual([]);
		const langs = lib.languagesOn({ reveal: true, shelf: 'all' });
		expect(langs).toEqual(expect.arrayContaining(['ja', 'en']));
		expect(langs).not.toContain('tr');
		expect(lib.languagesOn({ reveal: true, shelf: 'k:manhwa' })).toEqual([]);
		const ja = list(only({ lang: 'ja' }), true);
		expect(ja.length).toBeGreaterThan(0);
		expect(ja.every((c) => c.hidden)).toBe(true);
		// Hidden means hidden: with reveal off, a language finds nothing.
		expect(list(only({ lang: 'ja' }), false)).toEqual([]);
	});

	it('KIND: one kind inside any shelf, offering only the kinds the shelf holds', () => {
		const all = list(only({}), true);
		// What the band offers: the kinds counted on the shelf (kindCounts, since c436).
		const kindsOn = (shelf: string) =>
			filtersMod.FILTER_KINDS.filter(
				(k) => (lib.kindCounts({ reveal: true, shelf }).kinds[k] ?? 0) > 0
			);
		const kinds = kindsOn('all');
		expect(kinds).toEqual(filtersMod.FILTER_KINDS.filter((k) => all.some((c) => c.kind === k)));
		expect(kinds.length).toBeGreaterThan(1);
		for (const kind of kinds) {
			const got = list(only({ kind }), true);
			expect(got.length).toBe(all.filter((c) => c.kind === kind).length);
			expect(got.every((c) => c.kind === kind)).toBe(true);
		}
		// A kind shelf holds one kind: nothing to tell apart.
		expect(kindsOn('k:manhwa').length).toBeLessThanOrEqual(1);
	});

	it('READING: UNREAD and READ, in SQL as the device decides them, hidden included', () => {
		const { progressOf } = filtersMod;
		const state = { unread: 'unread', read: 'finished' } as const;
		for (const reveal of [false, true]) {
			const all = everything(reveal);
			for (const progress of ['unread', 'read'] as const) {
				const got = list(only({ progress }), reveal);
				expect(titles(got).sort()).toEqual(
					titles(all.filter((c) => progressOf(c) === state[progress])).sort()
				);
				expect(lib.countListed({ reveal, filters: only({ progress }) })).toBe(got.length);
			}
		}
		// Hidden ones are what it's for: with reveal on, it reaches them.
		const both = only({ hidden: true, progress: 'unread' });
		expect(list(both, true).every((c) => c.hidden && !c.opened && c.readCount === 0)).toBe(true);
		expect(list(only({ progress: 'read' }), true).length).toBeGreaterThan(0);
	});

	it('HIDDEN: only hidden, and only ever with reveal on', () => {
		const hidden = list(only({ hidden: true }), true);
		expect(titles(hidden).sort()).toEqual([...hiddenTitles].sort());
		// Asked for with reveal off, it narrows nothing to hidden ones.
		expect(list(only({ hidden: true }), false).some((c) => c.hidden)).toBe(false);
	});
});

describe('SERIES and ONE-OFF', () => {
	it('split the library: a single doujin book is a one-off, everything else a series', () => {
		const oneoff = lib.listSeries({ reveal: true, shelf: 'oneoff' });
		const series = lib.listSeries({ reveal: true, shelf: 'series' });
		expect(oneoff.length + series.length).toBe(lib.countListed({ reveal: true }));
		expect(oneoff.every((c) => c.kind === 'doujin' && c.entryCount <= 1)).toBe(true);
		expect(titles(series)).toContain(BOOK_SERIES_TITLE);
		// A Mihon series is a series whatever it holds so far.
		expect(series.filter((c) => c.kind !== 'doujin').length).toBe(
			lib.listSeries({ reveal: true }).filter((c) => c.kind !== 'doujin').length
		);
	});
});

describe('pages of a shelf', () => {
	it('page through the same list the whole shelf is, without gaps or repeats', () => {
		for (const sort of ['recent', 'progress', 'title', 'rating', 'added', 'random'] as const)
			for (const dir of ['asc', 'desc'] as const) {
				const whole = lib.listSeries({ reveal: true, sort, dir }).map((c) => c.id);
				const paged: number[] = [];
				for (let offset = 0; offset < whole.length; offset += 7)
					paged.push(
						...lib.listSeries({ reveal: true, sort, dir, limit: 7, offset }).map((c) => c.id)
					);
				expect(paged).toEqual(whole);
			}
	});

	it('PROGRESS: begun and unfinished, then never opened, then the read; ↑ sends the begun last', () => {
		const { progressOf } = filtersMod;
		const tiers = (dir: 'asc' | 'desc') =>
			lib.listSeries({ reveal: true, sort: 'progress', dir }).map((c) => progressOf(c));
		const runs = (xs: string[]) => xs.filter((x, i) => i === 0 || xs[i - 1] !== x);
		expect(runs(tiers('desc'))).toEqual(['reading', 'unread', 'finished']);
		expect(runs(tiers('asc'))).toEqual(['unread', 'finished', 'reading']);
		// Inside a tier, the most recent first either way: the same begun series, in the same order.
		const begun = (dir: 'asc' | 'desc') =>
			lib
				.listSeries({ reveal: true, sort: 'progress', dir })
				.filter((c) => progressOf(c) === 'reading')
				.map((c) => c.id);
		expect(begun('asc')).toEqual(begun('desc'));
	});

	it('turn each sort round with ?dir=, RECENTLY READ included (an add counts as a read)', () => {
		for (const sort of ['title', 'added', 'recent'] as const) {
			const down = lib.listSeries({ reveal: true, sort, dir: 'desc' }).map((c) => c.id);
			const up = lib.listSeries({ reveal: true, sort, dir: 'asc' }).map((c) => c.id);
			expect(up).toEqual([...down].reverse());
		}
		expect(lib.listSeries({ reveal: true, sort: 'title' })).toEqual(
			lib.listSeries({ reveal: true, sort: 'title', dir: 'asc' })
		);
		// Never opened is no longer a block at one end: the sample's unread
		// series sit among the read, by when they were added.
		const up = lib.listSeries({ reveal: true, sort: 'recent', dir: 'asc' });
		const firstNever = up.findIndex((c) => !c.opened);
		expect(up.slice(firstNever).some((c) => c.opened)).toBe(true);
		const ratings = lib
			.listSeries({ reveal: true, sort: 'rating', dir: 'asc' })
			.map((c) => c.rating);
		expect(ratings).toEqual([...ratings].sort((a, b) => a - b));
	});

	it('RANDOM is one shuffle per seed: the same every time, another with another seed', () => {
		const ids = (seed: number) =>
			lib.listSeries({ reveal: false, sort: 'random', seed }).map((c) => c.id);
		const byTitle = lib.listSeries({ reveal: false, sort: 'title' }).map((c) => c.id);
		expect(ids(42)).toEqual(ids(42));
		expect(ids(42)).not.toEqual(ids(43));
		expect([...ids(42)].sort()).toEqual([...byTitle].sort());
		expect(ids(42)).not.toEqual(byTitle);
		// Paged with a seed, as the grid asks for it: the same cards, in order.
		const paged = [0, 5, 10, 15, 20, 25].flatMap((offset) =>
			lib.listSeries({ reveal: false, sort: 'random', seed: 42, limit: 5, offset }).map((c) => c.id)
		);
		expect(paged).toEqual(ids(42));
	});

	it('counts exactly what the shelf shows, hidden left out', () => {
		// A tile count against a tile list: a Work is one tile, however many
		// series it holds (tests/works-library-db.spec.ts has that fixture).
		for (const filters of [
			NO_FILTERS,
			only({ form: 'series' }),
			only({ form: 'oneoff' }),
			only({ kind: 'novel' })
		]) {
			const cards = lib.listTiles({ reveal: false, filters, limit: 1000 });
			expect(lib.countListed({ reveal: false, filters })).toBe(cards.length);
		}
		expect(lib.countListed({ reveal: true })).toBeGreaterThan(lib.countListed({ reveal: false }));
	});
});

describe('the kinds, a band on the library since c436', () => {
	it('still read an old kind shelf’s key as its kind, never as all: a page asked by a tab loaded before', () => {
		const novels = lib.listSeries({ reveal: true, shelf: 'k:novel' });
		expect(novels.length).toBeGreaterThan(0);
		expect(novels.every((c) => c.kind === 'novel')).toBe(true);
		expect(lib.listSeries({ reveal: true, shelf: 'k:novel' })).toEqual(
			lib.listSeries({ reveal: true, filters: only({ kind: 'novel' }) })
		);
		// Any kind the registry names, doujin included; a key naming none is all.
		expect(lib.listSeries({ reveal: false, shelf: 'k:doujin' })).toEqual(
			lib.listSeries({ reveal: false, filters: only({ kind: 'doujin' }) })
		);
		expect(lib.listSeries({ reveal: false, shelf: 'k:comic' })).toEqual(
			lib.listSeries({ reveal: false })
		);
	});

	it('the band counts each kind as its tiles, every other filter applied, and ALL as the shelf', () => {
		const { FILTER_KINDS } = filtersMod;
		for (const reveal of [false, true])
			for (const filters of [NO_FILTERS, only({ min: 6 }), only({ fav: 1, kind: 'manga' })]) {
				const band = lib.kindCounts({ reveal, filters });
				// The kind chosen is no part of what the band counts: every cell keeps its count.
				const loose = { ...filters, kind: null };
				expect(band.all).toBe(lib.countListed({ reveal, filters: loose }));
				// Every kind of the registry, so a kind missing from the counts is one with none.
				for (const kind of FILTER_KINDS) {
					const n = lib.countListed({ reveal, filters: { ...loose, kind } });
					expect(band.kinds[kind] ?? 0).toBe(n);
				}
			}
		// The sample has manga, manhwa, doujin and novels, so none of that was vacuous.
		const band = lib.kindCounts({ reveal: false });
		expect(Object.keys(band.kinds).length).toBeGreaterThanOrEqual(3);
	});

	it('counts on a collection, which holds only some kinds', () => {
		const toFinish = lib
			.listShelves({ reveal: false, withNew: false })
			.find((s) => s.name === 'To finish')!;
		const band = lib.kindCounts({ reveal: false, shelf: toFinish.key });
		expect(band.all).toBe(toFinish.count);
		const sum = Object.values(band.kinds).reduce((a, b) => a + (b ?? 0), 0);
		expect(sum).toBe(toFinish.count);
	});
});

describe('scan state', () => {
	it('reports a running scan over a finished one, and a dismissed one hands the band to nobody', () => {
		const db = getDb();
		expect(lib.currentScan()).toBeNull();
		const done = Number(
			db
				.prepare(
					`INSERT INTO scan_jobs (started_at, finished_at, series_found, failed_files) VALUES (1, 2, 847, 3)`
				)
				.run().lastInsertRowid
		);
		expect(lib.currentScan()).toMatchObject({ id: done, seriesFound: 847, failedFiles: 3 });
		const running = Number(
			db
				.prepare(`INSERT INTO scan_jobs (started_at, bytes_done, bytes_total) VALUES (3, 10, 100)`)
				.run().lastInsertRowid
		);
		expect(lib.currentScan()?.id).toBe(running);
		db.prepare(`UPDATE scan_jobs SET finished_at = 4 WHERE id = ?`).run(running);
		expect(lib.currentScan()?.id).toBe(running);
		lib.dismissScan(running);
		// Not back to the older band: only the newest import is ever shown.
		expect(lib.currentScan()).toBeNull();
	});
});

describe('the NEW shelf', () => {
	// What arrived (rung 34) in the last NEW_DAYS and hasn't been opened since:
	// not the import the band is about, so neither a later import nor TIDY NEW
	// empties it.
	const db = () => getDb();
	const idOf = (title: string) =>
		lib.listSeries({ reveal: false }).find((s) => s.title === title)!.id;
	const onNew = () => titles(lib.listSeries({ reveal: false, shelf: 'new' }));
	const arrive = (id: number, at: number) =>
		db().prepare(`UPDATE series SET arrived_at = ? WHERE id = ?`).run(at, id);
	const opened = (id: number) =>
		(
			db().prepare(`SELECT MAX(last_opened_at) AS at FROM entries WHERE series_id = ?`).get(id) as {
				at: number | null;
			}
		).at;

	it('holds an arrival, whatever the band does', () => {
		const id = idOf('Dungeon Meshi');
		arrive(id, Math.max(Date.now() - 60_000, (opened(id) ?? 0) + 1));
		expect(onNew()).toContain('Dungeon Meshi');
		const job = Number(
			db()
				.prepare(`INSERT INTO scan_jobs (started_at, finished_at, series_found) VALUES (20, 21, 1)`)
				.run().lastInsertRowid
		);
		lib.dismissScan(job);
		expect(onNew()).toContain('Dungeon Meshi');
		// Listed with no import to show, as long as something is new.
		const shelf = lib.listShelves({ reveal: false, withNew: false }).find((s) => s.key === 'new');
		expect(shelf?.count).toBeGreaterThanOrEqual(1);
	});

	it('lets it go once it is opened', () => {
		const id = idOf('Dungeon Meshi');
		const at = Date.now() - 60_000;
		arrive(id, at);
		db()
			.prepare(
				`UPDATE entries SET last_opened_at = ? WHERE id = (SELECT id FROM entries WHERE series_id = ? LIMIT 1)`
			)
			.run(at + 1, id);
		expect(onNew()).not.toContain('Dungeon Meshi');
	});

	it(`lets it go after ${lib.NEW_DAYS} days unopened`, () => {
		const id = idOf('Isekai Yakkyoku');
		expect(opened(id)).toBeNull();
		arrive(id, Date.now() - (lib.NEW_DAYS - 1) * 86_400_000);
		expect(onNew()).toContain('Isekai Yakkyoku');
		arrive(id, Date.now() - (lib.NEW_DAYS + 1) * 86_400_000);
		expect(onNew()).not.toContain('Isekai Yakkyoku');
		arrive(id, 0);
		expect(lib.listShelves({ reveal: false, withNew: false }).some((s) => s.key === 'new')).toBe(
			false
		);
	});
});

describe('new chapters', () => {
	// "+3" means three chapters arrived since the series was last opened. It is
	// not the unread count: Drawing has 18 unread and 3 new.
	it('counts entries that arrived after the last open, not everything unread', () => {
		const byTitle = new Map(lib.listSeries({ reveal: false }).map((c) => [c.title, c]));
		const drawing = byTitle.get('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru')!;
		expect(drawing.entryCount - drawing.readCount).toBe(18);
		expect(drawing.newCount).toBe(3);
		expect(byTitle.get("Omniscient Reader's Viewpoint")!.newCount).toBe(0);
		// Never opened: unread, but nothing is "new" to someone who has not started.
		expect(byTitle.get('Isekai Yakkyoku')!.newCount).toBe(0);
	});

	it('counts a chapter downloaded since, unless it was already read', () => {
		const title = 'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru';
		const drawing = () => lib.listSeries({ reveal: false }).find((c) => c.title === title)!;
		const db = getDb();
		// An old chapter, listed long before the last open, downloaded just now.
		const old = db
			.prepare(
				`SELECT id, read_at FROM entries WHERE series_id = ? AND added_at <
					(SELECT MAX(last_opened_at) FROM entries WHERE series_id = ?) ORDER BY position LIMIT 1`
			)
			.get(drawing().id, drawing().id) as { id: number; read_at: number | null };
		const now = Date.now();
		db.prepare(`UPDATE entries SET arrived_at = ?, read_at = 1 WHERE id = ?`).run(now, old.id);
		expect(drawing().newCount).toBe(3);
		db.prepare(`UPDATE entries SET read_at = NULL WHERE id = ?`).run(old.id);
		expect(drawing().newCount).toBe(4);
		db.prepare(`UPDATE entries SET arrived_at = NULL, read_at = ? WHERE id = ?`).run(
			old.read_at,
			old.id
		);
	});
});

/**
 * c558: FILTER's FORM had three rules for ONE-OFF -- the server's
 * (`ONE_OFF_SQL`) counted an extra as a book, the device's (`isOneOff`, over
 * the card's `entryCount`) did not, and the binder's (`isSingleton`) counted
 * a shadowed duplicate. The owner decided (2026-11-05) that an extra doesn't
 * make a series, so a doujin with one book and one extra is a ONE-OFF on the
 * shelf's count, its grid, the device's filter and the binder alike. A
 * shadowed entry (an edition, a duplicate set aside) is no book either.
 */
describe('ONE-OFF counts one book the same way everywhere', () => {
	/** A visible doujin single from the seed, by the server's own rule. */
	const single = () => {
		const card = lib
			.listSeries({ reveal: false, filters: only({ form: 'oneoff' }) })
			.find((c) => c.entryCount === 1);
		if (!card) throw new Error('the seed has no visible single book');
		return card;
	};

	/** Adds an entry beside the book, runs `check`, and takes the entry away again. */
	async function beside(
		seriesId: number,
		row: { matter: string; shadowed: number },
		check: () => Promise<void> | void
	) {
		const db = getDb();
		// A copy of the book's own row, as an importer would write a second
		// entry, with only what makes it an extra or a shadow changed.
		const cols = (db.prepare(`PRAGMA table_info(entries)`).all() as { name: string }[])
			.map((c) => c.name)
			.filter((c) => c !== 'id');
		const set: Record<string, string> = {
			title: `'Afterword'`,
			label: `'Afterword'`,
			position: '2',
			matter: '@matter',
			shadowed: '@shadowed',
			edition_of: 'NULL',
			read_at: 'NULL'
		};
		const id = Number(
			db
				.prepare(
					`INSERT INTO entries (${cols.join(', ')})
						SELECT ${cols.map((c) => set[c] ?? c).join(', ')} FROM entries
						WHERE series_id = @series ORDER BY id LIMIT 1`
				)
				.run({ matter: row.matter, shadowed: row.shadowed, series: seriesId }).lastInsertRowid
		);
		try {
			await check();
		} finally {
			db.prepare(`DELETE FROM entries WHERE id = ?`).run(id);
		}
	}

	/** The series' book entry: the one a folded edition leaves out. */
	const bookOf = (seriesId: number) =>
		(
			getDb()
				.prepare(`SELECT MIN(id) AS id FROM entries WHERE series_id = ? AND edition_of IS NULL`)
				.get(seriesId) as { id: number }
		).id;

	/** Adds a folded edition beside the book (shadowed, `edition_of` set), and leaves it there. */
	function addEdition(seriesId: number, book: number): number {
		const db = getDb();
		const cols = (db.prepare(`PRAGMA table_info(entries)`).all() as { name: string }[])
			.map((c) => c.name)
			.filter((c) => c !== 'id');
		const set: Record<string, string> = {
			title: `'Edition'`,
			label: `'Edition'`,
			position: '1',
			matter: `''`,
			shadowed: '1',
			edition_of: '@book',
			read_at: 'NULL'
		};
		return Number(
			db
				.prepare(
					`INSERT INTO entries (${cols.join(', ')})
						SELECT ${cols.map((c) => set[c] ?? c).join(', ')} FROM entries WHERE id = @book`
				)
				.run({ book }).lastInsertRowid
		);
	}

	/** The same, around `check`, taking the edition away again. */
	async function besideEdition(seriesId: number, check: () => Promise<void> | void) {
		const id = addEdition(seriesId, bookOf(seriesId));
		try {
			await check();
		} finally {
			getDb().prepare(`DELETE FROM entries WHERE id = ?`).run(id);
		}
	}

	const entryPages = (id: number) =>
		(getDb().prepare(`SELECT page_count AS n FROM entries WHERE id = ?`).get(id) as { n: number })
			.n;

	it.each([
		['an extra (back matter)', { matter: 'back', shadowed: 0 }],
		['a duplicate set aside (shadowed)', { matter: '', shadowed: 1 }]
	])('keeps a doujin with one book and %s a ONE-OFF', async (_, row) => {
		const { isSingleton } = await import('$lib/server/books');
		const { isOneOff } = filtersMod;
		const book = single();
		const oneoff = only({ form: 'oneoff' });
		const series = only({ form: 'series' });
		const before = {
			oneoff: lib.countListed({ reveal: false, filters: oneoff }),
			series: lib.countListed({ reveal: false, filters: series })
		};
		await beside(book.id, row, () => {
			// FORM's count and its filtered grid, on the server.
			const grid = lib.listTiles({ reveal: false, filters: oneoff, limit: 1000 });
			expect(grid.map((c) => c.id)).toContain(book.id);
			expect(lib.countListed({ reveal: false, filters: oneoff })).toBe(grid.length);
			expect(lib.countListed({ reveal: false, filters: oneoff })).toBe(before.oneoff);
			const rest = lib.listTiles({ reveal: false, filters: series, limit: 1000 });
			expect(rest.map((c) => c.id)).not.toContain(book.id);
			expect(lib.countListed({ reveal: false, filters: series })).toBe(before.series);
			// The device's rule over the same card, as CACHED filters it.
			const card = grid.find((c) => c.id === book.id)!;
			expect(card.entryCount).toBe(1);
			expect(isOneOff(card)).toBe(true);
			// And the binder's.
			expect(isSingleton(book.id)).toBe(true);
		});
	});

	it('makes a second book a SERIES on all three', async () => {
		const { isSingleton } = await import('$lib/server/books');
		const book = single();
		await beside(book.id, { matter: '', shadowed: 0 }, () => {
			const grid = lib.listTiles({ reveal: false, filters: only({ form: 'series' }), limit: 1000 });
			const card = grid.find((c) => c.id === book.id);
			expect(card?.entryCount).toBe(2);
			expect(filtersMod.isOneOff(card!)).toBe(false);
			expect(isSingleton(book.id)).toBe(false);
		});
	});

	it('refuses to bind a book with an extra beside it, rather than lose the extra', async () => {
		const { groupIntoSeries } = await import('$lib/server/books');
		const [a, b] = lib
			.listSeries({ reveal: false, filters: only({ form: 'oneoff' }) })
			.filter((c) => c.entryCount === 1);
		await beside(a.id, { matter: 'back', shadowed: 0 }, () => {
			expect(() => groupIntoSeries({ seriesIds: [a.id, b.id], name: 'Bound' })).toThrow(
				/holds an extra or a duplicate beside its book/
			);
			expect(
				(
					getDb().prepare(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ?`).get(a.id) as {
						n: number;
					}
				).n
			).toBe(2);
		});
	});

	// c558's round 2: the rule's other readers in this slot's files.

	// c558's round 3, Gap 2: a person's page counts a series by the same rule,
	// and offers GROUP only where GROUP can take the book.
	it('draws a person’s page by the same count, and offers GROUP only where GROUP can take it', async () => {
		const { tagPage } = await import('$lib/server/people');
		const grouped = lib.listSeries({ reveal: true }).find((c) => c.title === BOOK_SERIES_TITLE)!;
		const page = () => tagPage('circle:Hakka Kousha', true)!;
		const tileOf = (id: number) =>
			page().items.find((i) => i.seriesId === id && i.entryId === null)!;
		// The grouped series' books each wear the series' count, and it is the
		// books' count: an extra beside one of them is not a fifth book.
		const total = () =>
			page().items.find((i) => i.seriesId === grouped.id && i.entryId !== null)!.total;
		const books = total();
		expect(books).toBeGreaterThan(1);
		await beside(grouped.id, { matter: 'back', shadowed: 0 }, () => {
			expect(total()).toBe(books);
		});
		// The lone book on the same page: one book, whatever sits beside it, and
		// a singleton only when nothing does (what `groupIntoSeries` binds).
		const alone = page().items.find((i) => i.entryId === null && i.kind === 'doujin')!;
		expect(alone.entries).toBe(1);
		expect(alone.groupable).toBe(true);
		await beside(alone.seriesId, { matter: 'back', shadowed: 0 }, () => {
			expect(tileOf(alone.seriesId).entries).toBe(1);
			expect(tileOf(alone.seriesId).groupable).toBe(false);
		});
		await beside(alone.seriesId, { matter: '', shadowed: 1 }, () => {
			expect(tileOf(alone.seriesId).entries).toBe(1);
			expect(tileOf(alone.seriesId).groupable).toBe(false);
		});
		// A folded edition is the book's own, not something beside it.
		await besideEdition(alone.seriesId, () => {
			expect(tileOf(alone.seriesId).entries).toBe(1);
			expect(tileOf(alone.seriesId).groupable).toBe(true);
		});
	});

	it('offers a book with an extra to no MOVE TO or ADD TO EXISTING as a series of 2 BOOKS', async () => {
		const { seriesOfBooks } = await import('$lib/server/books');
		const book = single();
		for (const row of [
			{ matter: 'back', shadowed: 0 },
			{ matter: '', shadowed: 1 }
		])
			await beside(book.id, row, () => {
				expect(seriesOfBooks(true).map((s) => s.id)).not.toContain(book.id);
			});
		// A real series of books keeps its count with an extra beside it.
		const bound = lib.listSeries({ reveal: true }).find((c) => c.title === BOOK_SERIES_TITLE)!;
		const count = () => seriesOfBooks(true).find((s) => s.id === bound.id)?.books;
		const books = count();
		expect(books).toBeGreaterThan(1);
		await beside(bound.id, { matter: 'back', shadowed: 0 }, () => {
			expect(count()).toBe(books);
		});
	});

	it('suggests no book with an extra or a set-aside duplicate beside it', async () => {
		const { suggestionFor } = await import('$lib/server/books');
		// Two hidden books that share a stem: the seed's own suggestion.
		const pair = lib
			.listSeries({ reveal: true })
			.filter((c) => c.title.startsWith('Kaori Mama') && c.entryCount === 1);
		const one = pair.find((c) => suggestionFor(c.id, true) !== null);
		if (!one) throw new Error('the seed suggests no pair of books');
		const before = suggestionFor(one.id, true)!.books.map((b) => b.seriesId);
		expect(before.length).toBeGreaterThan(1);
		// c558's round 3: a suggestion has to be something GROUP can bind, and
		// GROUP refuses a book with anything beside it, so neither is offered.
		for (const row of [
			{ matter: 'back', shadowed: 0 },
			{ matter: '', shadowed: 1 }
		])
			await beside(one.id, row, () => {
				expect(suggestionFor(one.id, true)).toBeNull();
			});
		// A folded edition is not beside the book for this: it is the book's.
		await besideEdition(one.id, () => {
			expect(suggestionFor(one.id, true)?.books.map((b) => b.seriesId)).toEqual(before);
		});
	});

	it('refuses FOLD over a book with an extra or a set-aside duplicate beside it', async () => {
		const library = await import('../src/routes/+page.server');
		const [a, b] = lib
			.listSeries({ reveal: false, filters: only({ form: 'oneoff' }) })
			.filter((c) => c.entryCount === 1);
		const fold = async () => {
			const body = new FormData();
			for (const id of [a.id, b.id]) body.append('id', String(id));
			try {
				return await (library.actions.fold as (e: unknown) => Promise<unknown>)({
					request: new Request('http://localhost/', { method: 'POST', body })
				});
			} catch (e) {
				// The review's own page is SvelteKit's success for FOLD.
				if (e && typeof e === 'object' && 'location' in e) return { location: e.location };
				throw e;
			}
		};
		// `foldEditions` (books.ts) folds one `edition_of IS NULL` entry, so a
		// book with an extra or a set-aside duplicate beside it cannot be
		// folded; the review would swallow it (`applyPending`), so FOLD refuses
		// it here, with a sentence, instead (`doc/FILTERS.md`).
		for (const row of [
			{ matter: 'back', shadowed: 0 },
			{ matter: '', shadowed: 1 }
		])
			await beside(a.id, row, async () => {
				folded.length = 0;
				expect(await fold()).toMatchObject({
					status: 400,
					data: { foldMessage: 'A BOOK WITH AN EXTRA OR A DUPLICATE BESIDE IT CAN’T FOLD' }
				});
				expect(folded).toEqual([]);
			});
		// The extra written before the book is still an extra, not the book.
		await beside(a.id, { matter: '', shadowed: 0 }, async () => {
			const db = getDb();
			const own = bookOf(a.id);
			db.prepare(`UPDATE entries SET matter = 'front' WHERE id = ?`).run(own);
			try {
				folded.length = 0;
				expect(await fold()).toMatchObject({ status: 400 });
				expect(folded).toEqual([]);
			} finally {
				db.prepare(`UPDATE entries SET matter = '' WHERE id = ?`).run(own);
			}
		});
	});

	it('takes a book with a folded edition beside it, through FOLD and the review’s own fold', async () => {
		const library = await import('../src/routes/+page.server');
		const db = getDb();
		// Two visible singles, the one with the lower book entry first: the pair
		// key orders by entry id, and `fold` folds the first into the second's
		// series. The first gets a folded edition (shadowed, as `foldEditions`
		// leaves one), which `entryIdsOf` leaves out.
		const singles = lib
			.listSeries({ reveal: false, filters: only({ form: 'oneoff' }) })
			.filter((c) => c.entryCount === 1)
			.map((c) => ({ card: c, entry: bookOf(c.id) }))
			.sort((x, y) => x.entry - y.entry);
		const a = singles[0];
		const b = singles[1];
		const own = a.entry;
		const other = b.entry;
		const edition = addEdition(a.card.id, own);
		const body = new FormData();
		for (const id of [a.card.id, b.card.id]) body.append('id', String(id));
		folded.length = 0;
		const answer = await (library.actions.fold as (e: unknown) => Promise<unknown>)({
			request: new Request('http://localhost/', { method: 'POST', body })
		}).catch((e: unknown) => {
			if (e && typeof e === 'object' && 'location' in e) return { location: e.location };
			throw e;
		});
		expect(answer).toEqual({ location: '/duplicates?pair=pair' });
		expect(folded).toEqual([[own, other]]);

		// Now drive the review's own fold for that accepted pair, from a pair row
		// as the review would have made it (`decide` -> `applyPending` -> `fold`
		// -> `foldEditions`), and the two really become one book.
		const lang = (id: number, value: string) => {
			db.prepare(
				`INSERT INTO tags (namespace, value) VALUES ('language', ?) ON CONFLICT DO UPDATE SET value = value`
			).run(value);
			const tagId = (
				db.prepare(`SELECT id FROM tags WHERE namespace = 'language' AND value = ?`).get(value) as {
					id: number;
				}
			).id;
			db.prepare(`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
				id,
				tagId
			);
		};
		lang(a.card.id, 'english');
		lang(b.card.id, 'japanese');
		const pages = Math.min(entryPages(own), entryPages(other));
		const rows = Array.from({ length: pages }, (_, i) => ({ a: i + 1, b: i + 1 }));
		db.prepare(
			`INSERT OR REPLACE INTO dupe_pairs (a, b, bits, rows, found_at) VALUES (?, ?, -1, ?, ?)`
		).run(own, other, JSON.stringify({ rows, sizes: { [own]: [0, 0], [other]: [0, 0] } }), 1);
		const dupes = await import('$lib/server/dupes');
		await dupes.decide(`${own},${other}`, 'fold', null, true);
		expect(await dupes.applyPending()).toEqual({ applied: 1, refused: [], failed: [] });
		// The pair is one series now, the other's entry an edition of the book.
		const where = db.prepare(`SELECT series_id FROM entries WHERE id = ?`);
		expect((where.get(own) as { series_id: number }).series_id).toBe(
			(where.get(other) as { series_id: number }).series_id
		);
		expect(
			db.prepare(`SELECT edition_of, shadowed FROM entries WHERE id = ?`).get(other)
		).toMatchObject({
			edition_of: own,
			shadowed: 1
		});
		// The edition this case added is not part of what the fold carried.
		db.prepare(`DELETE FROM entries WHERE id = ?`).run(edition);
	});
});
